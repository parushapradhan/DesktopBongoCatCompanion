// Ties together: Firebase Realtime DB (pairing + presence), the local
// keystroke events forwarded from main.js, and the bongo cat animation.

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid mix-ups

function randomCode(len = 6) {
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return out;
}

function uid() {
  return 'd-' + Math.random().toString(36).slice(2, 10);
}

// Cosmetic cat skins -- freely selectable, no unlock requirement.
const SKINS = [
  { id: 'classic', label: 'Classic' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'sunset', label: 'Sunset' },
  { id: 'golden', label: 'Golden' },
];

const els = {
  pairingScreen: document.getElementById('pairing-screen'),
  mainScreen: document.getElementById('main-screen'),
  myCode: document.getElementById('my-code'),
  copyCodeBtn: document.getElementById('copy-code-btn'),
  newCodeBtn: document.getElementById('new-code-btn'),
  joinCodeInput: document.getElementById('join-code-input'),
  joinCodeBtn: document.getElementById('join-code-btn'),
  nicknameInput: document.getElementById('nickname-input'),
  roomLabel: document.getElementById('room-label'),
  settingsBtn: document.getElementById('settings-btn'),
  statusLine: document.getElementById('status-line'),
  toast: document.getElementById('toast'),
  partnerLabel: document.getElementById('partner-label'),
  skinRow: document.getElementById('skin-row'),
  catsRow: document.querySelector('.cats-row'),
  pokeBtn: document.getElementById('poke-btn'),
  hideBtns: [document.getElementById('hide-btn-1')],
  quitBtns: [document.getElementById('quit-btn-1'), document.getElementById('quit-btn-2'), document.getElementById('bar-quit-btn')],
  barPill: document.getElementById('bar-pill'),
  barPillIcon: document.getElementById('bar-pill-icon'),
  barStatusText: document.getElementById('bar-status-text'),
  barExpandBtn: document.getElementById('bar-expand-btn'),
  collapseBtn: document.getElementById('collapse-btn'),
};

const POKE_COOLDOWN_MS = 2500; // keep pokes as a light nudge, not a spam button

const youCat = mountBongoCat(document.getElementById('you-cat'));
const partnerCat = mountBongoCat(document.getElementById('partner-cat'));

let db = null;
let state = { deviceId: '', roomCode: '', nickname: '', skin: 'classic' };
let devicesRef = null;
let eventsRef = null;
let localIsTyping = false;
let partnerIsTyping = false;
let wasDuet = false;

// ---- View modes: bar (default) / full / ghost ----
function setViewMode(mode) {
  document.body.dataset.view = mode;
  window.buddyAPI.setViewMode(mode);
}
window.buddyAPI.onSetViewMode((mode) => {
  document.body.dataset.view = mode;
});
// A quick manual way to cycle modes without hunting for the tray icon --
// double-click anywhere that isn't a button/input.
document.body.addEventListener('dblclick', (e) => {
  if (e.target.closest('button, input')) return;
  if (els.pairingScreen && !els.pairingScreen.classList.contains('hidden')) return;
  const order = ['bar', 'full', 'ghost'];
  const next = order[(order.indexOf(document.body.dataset.view) + 1) % order.length];
  setViewMode(next);
});

function updateBarStatus(text, isTyping) {
  els.barStatusText.textContent = text;
  els.barPill.classList.toggle('typing', !!isTyping);
}

function renderSkinRow() {
  els.skinRow.querySelectorAll('.skin-swatch').forEach((btn) => {
    const skin = SKINS.find((sk) => sk.id === btn.dataset.skin);
    if (!skin) return;
    btn.classList.toggle('selected', state.skin === skin.id);
    btn.title = skin.label;
  });
}

function updateDuetState() {
  const isDuet = localIsTyping && partnerIsTyping;
  els.catsRow.classList.toggle('duet', isDuet);
  youCat.setDuet(isDuet);
  partnerCat.setDuet(isDuet);
  if (isDuet && !wasDuet) {
    // Just entered a duet -- line up both cats' paw-bounce phase so they
    // visually bounce in sync instead of independently.
    youCat.syncPawPhase();
    partnerCat.syncPawPhase();
  }
  wasDuet = isDuet;
}

function initFirebase() {
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg || cfg.apiKey === 'PASTE_YOUR_API_KEY') {
    els.statusLine.textContent = 'Add your Firebase config in firebase-config.js first (see SETUP.md)';
    return false;
  }
  firebase.initializeApp(cfg);
  db = firebase.database();
  return true;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  setTimeout(() => els.toast.classList.add('hidden'), 3500);
}

function switchToMain() {
  els.pairingScreen.classList.add('hidden');
  els.mainScreen.classList.remove('hidden');
  els.roomLabel.textContent = 'Room ' + state.roomCode;
}

function switchToPairing() {
  els.mainScreen.classList.add('hidden');
  els.pairingScreen.classList.remove('hidden');
  els.myCode.textContent = randomCode();
}

async function joinRoom(code, { createIfMissing = true } = {}) {
  if (!db) return;
  state.roomCode = code.toUpperCase();
  await window.buddyAPI.saveSettings(state);

  if (devicesRef) devicesRef.off();
  if (eventsRef) eventsRef.off();

  const deviceRef = db.ref(`rooms/${state.roomCode}/devices/${state.deviceId}`);
  deviceRef.set({
    label: state.nickname || 'Desktop',
    platform: 'desktop',
    typing: false,
    skin: state.skin,
    lastActive: firebase.database.ServerValue.TIMESTAMP,
  });
  deviceRef.onDisconnect().update({ typing: false, lastActive: firebase.database.ServerValue.TIMESTAMP });

  devicesRef = db.ref(`rooms/${state.roomCode}/devices`);
  devicesRef.on('value', (snap) => {
    const devices = snap.val() || {};
    const partnerEntry = Object.entries(devices).find(([id]) => id !== state.deviceId);
    if (partnerEntry) {
      const [, partner] = partnerEntry;
      els.partnerLabel.textContent = partner.label || 'Partner';
      partnerCat.setTyping(!!partner.typing, partner.typingSpeed || 0);
      partnerCat.setSkin(partner.skin || 'classic');
      partnerIsTyping = !!partner.typing;
      updateDuetState();
      const secondsAgo = (Date.now() - (partner.lastActive || 0)) / 1000;
      const statusText = partner.typing
        ? `${partner.label || 'Partner'} is coding right now`
        : secondsAgo < 120
        ? `${partner.label || 'Partner'} was just here`
        : `Waiting for ${partner.label || 'your partner'}…`;
      els.statusLine.textContent = statusText;
      updateBarStatus(statusText, !!partner.typing);
    } else {
      els.partnerLabel.textContent = 'Partner';
      partnerCat.setTyping(false);
      partnerIsTyping = false;
      updateDuetState();
      els.statusLine.textContent = 'Waiting for your partner to join with this code…';
      updateBarStatus('Waiting for your partner…', false);
    }
  });

  // Only react to events created after we joined, and only ones from the
  // *other* device (our own already fired locally).
  const joinedAt = Date.now();
  eventsRef = db.ref(`rooms/${state.roomCode}/events`).limitToLast(20);
  eventsRef.on('child_added', (snap) => {
    const evt = snap.val();
    if (!evt || evt.from === state.deviceId) return;
    if ((evt.ts || 0) < joinedAt - 5000) return; // ignore old history on first load
    if (evt.type === 'error') {
      showToast(evt.message || `${els.partnerLabel.textContent} hit an error`);
      partnerCat.react('error');
    } else if (evt.type === 'terminal') {
      partnerCat.react('terminal');
    } else if (evt.type === 'poke') {
      showToast(evt.message || `${els.partnerLabel.textContent} poked you`);
      partnerCat.react('poke');
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('Bongo Buddy', { body: evt.message || 'You got poked' });
      }
    } else {
      showToast(evt.message || 'Task complete');
      youCat.celebrate();
      partnerCat.celebrate();
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('Bongo Buddy', { body: evt.message || 'Task complete' });
      }
    }
  });

  switchToMain();
}

function setLocalTyping(isTyping, keysPerSec) {
  youCat.setTyping(isTyping, keysPerSec);
  localIsTyping = isTyping;
  updateDuetState();
  if (!db || !state.roomCode) return;
  const update = {
    typing: isTyping,
    typingSpeed: keysPerSec || 0,
    lastActive: firebase.database.ServerValue.TIMESTAMP,
  };
  db.ref(`rooms/${state.roomCode}/devices/${state.deviceId}`).update(update);
}

function announceEvent(message, type = 'task_complete') {
  if (type === 'error') {
    showToast(message || 'Something broke');
    youCat.react('error');
  } else if (type === 'terminal') {
    youCat.react('terminal');
  } else {
    showToast(message);
    youCat.celebrate();
  }
  if (db && state.roomCode) {
    db.ref(`rooms/${state.roomCode}/events`).push({
      type,
      message,
      from: state.deviceId,
      ts: firebase.database.ServerValue.TIMESTAMP,
    });
  }
}

// A quick, low-effort "hey, I'm thinking of you" nudge -- separate from the
// typing-driven presence, for when you just want to say hi without typing
// anything. Cooldown keeps it a poke, not a spam button.
function sendPoke() {
  if (!db || !state.roomCode) return;
  partnerCat.react('poke'); // feedback on the cat next to the button, not your own
  db.ref(`rooms/${state.roomCode}/events`).push({
    type: 'poke',
    message: `${state.nickname || 'Your partner'} poked you`,
    from: state.deviceId,
    ts: firebase.database.ServerValue.TIMESTAMP,
  });
  els.pokeBtn.disabled = true;
  setTimeout(() => { els.pokeBtn.disabled = false; }, POKE_COOLDOWN_MS);
}

// ---- wire up UI ----
els.hideBtns.forEach((btn) => btn.addEventListener('click', () => window.buddyAPI.hideWindow()));
els.quitBtns.forEach((btn) => btn.addEventListener('click', () => window.buddyAPI.quit()));
els.barExpandBtn.addEventListener('click', () => setViewMode('full'));
els.collapseBtn.addEventListener('click', () => setViewMode('bar'));

els.pokeBtn.addEventListener('click', sendPoke);

els.newCodeBtn.addEventListener('click', () => {
  const code = randomCode();
  els.myCode.textContent = code;
});

els.copyCodeBtn.addEventListener('click', () => {
  navigator.clipboard?.writeText(els.myCode.textContent).catch(() => {});
  els.copyCodeBtn.textContent = 'Copied!';
  setTimeout(() => (els.copyCodeBtn.textContent = 'Copy'), 1200);
  // Copying your code also means you intend to start that room now.
  state.nickname = els.nicknameInput.value.trim();
  joinRoom(els.myCode.textContent);
});

els.joinCodeBtn.addEventListener('click', () => {
  const code = els.joinCodeInput.value.trim();
  if (code.length < 4) return;
  state.nickname = els.nicknameInput.value.trim();
  joinRoom(code);
});

els.settingsBtn.addEventListener('click', () => {
  if (devicesRef) devicesRef.off();
  if (eventsRef) eventsRef.off();
  switchToPairing();
});

els.skinRow.querySelectorAll('.skin-swatch').forEach((btn) => {
  btn.addEventListener('click', () => {
    const skin = SKINS.find((sk) => sk.id === btn.dataset.skin);
    if (!skin) return;
    state.skin = skin.id;
    youCat.setSkin(skin.id);
    renderSkinRow();
    window.buddyAPI.saveSettings(state);
    if (db && state.roomCode) {
      db.ref(`rooms/${state.roomCode}/devices/${state.deviceId}`).update({ skin: skin.id });
    }
  });
});

window.buddyAPI.onLocalTyping(setLocalTyping);
window.buddyAPI.onTaskComplete(announceEvent);

if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
  Notification.requestPermission();
}

// ---- boot ----
(async function boot() {
  const saved = await window.buddyAPI.loadSettings();
  state.deviceId = saved.deviceId || uid();
  state.nickname = saved.nickname || '';
  state.skin = saved.skin || 'classic';
  document.body.dataset.view = saved.viewMode || 'bar';
  els.nicknameInput.value = state.nickname;
  youCat.setSkin(state.skin);
  renderSkinRow();
  await window.buddyAPI.saveSettings(state);

  const ok = initFirebase();
  if (!ok) {
    els.myCode.textContent = randomCode();
    return;
  }

  if (saved.roomCode) {
    await joinRoom(saved.roomCode);
  } else {
    switchToPairing();
  }
})();
