// Bongo Buddy — desktop main process
// Handles: tiny always-on-top widget window, system tray, global keystroke
// detection (so the cat animates even while you're typing in your IDE, not
// just inside this app), a local webhook other tools/agents can hit to
// announce "task complete", and simple settings persistence.

const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { execFile } = require('child_process');

let mainWindow = null;
let tray = null;
let uiohook = null;
let typingResetTimer = null;
const TYPING_IDLE_MS = 1800; // how long without a keystroke before "typing" flips back off

// Apps that count as "a terminal" for automatic terminal-opened detection.
// Add your own here if you use something not in this list.
const TERMINAL_APP_NAMES = [
  'Terminal', 'iTerm2', 'iTerm', 'Warp', 'Alacritty', 'Hyper', 'WezTerm',
  'Ghostty', 'kitty', 'Prompt', 'Console',
];
const TERMINAL_POLL_MS = 2000;
const TERMINAL_NOTIFY_COOLDOWN_MS = 30000; // don't re-fire every time you glance back at it

// For scaling the animation to typing speed: track a smoothed estimate of
// the interval between keystrokes, converted to keystrokes/sec.
let lastKeyTime = 0;
let smoothedInterval = null;

const settingsPath = path.join(app.getPath('userData'), 'bongo-buddy-settings.json');

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (e) {
    return { roomCode: '', nickname: '', deviceId: '' };
  }
}

function saveSettings(settings) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

function createWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 520,
    height: 300,
    x: width - 540,
    y: 40,
    resizable: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

function createTray() {
  // A tiny generated icon (see assets/tray-icon.png). Falls back to an
  // empty image if missing so the app never crashes on first run.
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Bongo Buddy');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Show / Hide',
      click: () => {
        if (!mainWindow) return;
        mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
      },
    },
    {
      label: 'Test: task complete',
      click: () => broadcastTaskComplete('Test notification from the tray menu', 'task_complete'),
    },
    {
      label: 'Test: hit an error',
      click: () => broadcastTaskComplete('Something broke 💥', 'error'),
    },
    {
      label: 'Test: terminal opened',
      click: () => broadcastTaskComplete('Terminal opened', 'terminal'),
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (!mainWindow) return;
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

// ---- Global keystroke detection -------------------------------------------
// Uses uiohook-napi to see key events system-wide (e.g. while you're typing
// in VS Code), not just inside this Electron window. This is what lets the
// cat react to "you're coding" rather than only "you're clicking this app".
function startGlobalKeyListener() {
  try {
    const { uIOhook } = require('uiohook-napi');
    uiohook = uIOhook;
    uiohook.on('keydown', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;

      // Smooth the inter-keystroke interval (exponential moving average) and
      // convert to keystrokes/sec, so the cat's animation speed tracks how
      // fast you're actually typing rather than just on/off.
      const now = Date.now();
      if (lastKeyTime && now - lastKeyTime < 3000) {
        const interval = now - lastKeyTime;
        smoothedInterval = smoothedInterval == null ? interval : smoothedInterval * 0.7 + interval * 0.3;
      } else {
        smoothedInterval = null; // gap too long (or first keystroke) -- start fresh
      }
      lastKeyTime = now;
      const speed = smoothedInterval ? 1000 / smoothedInterval : 0; // keystrokes/sec

      mainWindow.webContents.send('local-typing', true, speed);
      clearTimeout(typingResetTimer);
      typingResetTimer = setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('local-typing', false, 0);
        }
        lastKeyTime = 0;
        smoothedInterval = null;
      }, TYPING_IDLE_MS);
    });
    uiohook.start();
  } catch (err) {
    console.error(
      '[bongo-buddy] Could not start global key listener. ' +
        'On macOS you must grant Accessibility permission (System Settings > ' +
        'Privacy & Security > Accessibility) to this app / your terminal. ' +
        'Falling back to in-window typing detection only.\n',
      err.message
    );
  }
}

// ---- Automatic "terminal opened" detection (macOS only, for now) ---------
// Polls which app is frontmost via AppleScript/System Events and fires the
// "terminal" reaction the moment you switch INTO a terminal app from
// something else -- no manual tray click or webhook call needed. The first
// time this runs, macOS will ask you to grant Automation permission for
// this app to control "System Events" (System Settings > Privacy &
// Security > Automation) -- without that, this silently no-ops and you can
// still trigger the reaction manually.
//
// Windows/Linux: not implemented yet (would need a different native check
// per platform) -- the manual tray item and webhook still work everywhere.
function startTerminalWatcher() {
  if (process.platform !== 'darwin') {
    console.log('[bongo-buddy] Automatic terminal detection is macOS-only for now; use the tray item or webhook on other platforms.');
    return;
  }

  let lastFrontmost = null;
  let lastNotifyAt = 0;

  setInterval(() => {
    execFile(
      'osascript',
      ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true'],
      (err, stdout) => {
        if (err) return; // e.g. Automation permission not granted yet
        const frontmost = stdout.trim();
        const wasTerminal = lastFrontmost !== null && TERMINAL_APP_NAMES.includes(lastFrontmost);
        const isTerminal = TERMINAL_APP_NAMES.includes(frontmost);

        if (isTerminal && !wasTerminal) {
          const now = Date.now();
          if (now - lastNotifyAt > TERMINAL_NOTIFY_COOLDOWN_MS) {
            lastNotifyAt = now;
            broadcastTaskComplete(`Opened ${frontmost}`, 'terminal');
          }
        }
        lastFrontmost = frontmost;
      }
    );
  }, TERMINAL_POLL_MS);
}

// ---- Local webhook for cat reactions (task complete, errors, etc.) --------
// Any script, cron job, CI pipeline, git hook, or editor extension can POST
// to this to trigger a cat reaction and notify your partner too (via
// Firebase, wired up in the renderer). `type` controls which reaction plays:
//   - "task_complete" (default): cat celebrates, toast shown
//   - "error": cat flinches/shakes red -- e.g. wire to a test-failure hook
//   - "terminal": cat perks up -- e.g. wire to a shell/editor "opened" hook
// Example: curl -X POST localhost:4756/notify -H "Content-Type: application/json" -d '{"message":"Build finished","type":"task_complete"}'
function startLocalWebhook() {
  const server = express();
  server.use(express.json());

  server.post('/notify', (req, res) => {
    const message = (req.body && req.body.message) || 'Task complete';
    const type = (req.body && req.body.type) || 'task_complete';
    broadcastTaskComplete(message, type);
    res.json({ ok: true });
  });

  server.listen(4756, '127.0.0.1', () => {
    console.log('[bongo-buddy] Local webhook listening on http://127.0.0.1:4756/notify');
  });
}

function broadcastTaskComplete(message, type = 'task_complete') {
  if (Notification.isSupported() && type !== 'terminal') {
    // Skip a system notification for "terminal opened" -- that one's meant
    // to be a subtle in-app perk-up, not an interruption.
    new Notification({ title: 'Bongo Buddy', body: message }).show();
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('task-complete', message, type);
  }
}

// ---- IPC: settings ----------------------------------------------------------
ipcMain.handle('settings:load', () => loadSettings());
ipcMain.handle('settings:save', (_evt, settings) => {
  saveSettings(settings);
  return true;
});
ipcMain.handle('window:hide', () => mainWindow && mainWindow.hide());
ipcMain.handle('window:quit', () => app.quit());

app.whenReady().then(() => {
  createWindow();
  createTray();
  startGlobalKeyListener();
  startLocalWebhook();
  startTerminalWatcher();
});

app.on('window-all-closed', (e) => {
  // Keep running in the tray instead of fully quitting.
  e.preventDefault?.();
});

app.on('before-quit', () => {
  if (uiohook) {
    try { uiohook.stop(); } catch (e) {}
  }
});
