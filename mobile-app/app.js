// Bongo Buddy — mobile web app (PWA). Same pairing/presence model as the
// desktop app, talking to the same Firebase Realtime Database room.

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TYPING_IDLE_MS = 1800;

function randomCode(len = 6) {
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return out;
}

function uid() {
  return 'm-' + Math.random().toString(36).slice(2, 10);
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
  typeBox: document.getElementById('type-box'),
  skinRow: document.getElementById('skin-row'),
  catsRow: document.querySelector('.cats-row'),
  pokeBtn: document.getElementById('poke-btn'),
};

const POKE_COOLDOWN_MS = 2500; // keep pokes as a light nudge, not a spam button

const partnerCat = mountBongoCat(document.getElementById('partner-cat'));
const youCat = mountBongoCat(document.getElementById('you-cat'));

let db = null;
let state = { deviceId: '', roomCode: '', nickname: '', skin: 'classic' };
let devicesRef = null;
let eventsRef = null;
let localIsTyping = false;
let partnerIsTyping = false;
let wasDuet = false;
let typingResetTimer = null;

// For scaling the animation to typing speed: track a smoothed estimate of
// the interval between keystrokes in the scratch textarea, converted to
// keystrokes/sec.
let lastInputTime = 0;
let smoothedInterval = null;

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem('bongo-buddy-settings') || '{}');
  } catch (e) {
    return {};
  }
}
function saveSettings() {
  localStorage.setItem('bongo-buddy-settings', JSON.stringify(state));
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
    youCat.syncPawPhase();
    partnerCat.syncPawPhase();
  }
  wasDuet = isDuet;
}

function initFirebase() {
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg || cfg.apiKey === 'PASTE_YOUR_API_KEY') {
    els.statusLine.textContent = 'Ask whoever set this up to add the Firebase config (see SETUP.md).';
    return false;
  }
  firebase.initializeApp(cfg);
  db = firebase.database();
  return true;
}

function showToast(message) {
  els.toast.textContent = '🎉 ' + message;
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

async function joinRoom(code) {
  if (!db) return;
  state.roomCode = code.toUpperCase();
  saveSettings();

  if (devicesRef) devicesRef.off();
  if (eventsRef) eventsRef.off();

  const deviceRef = db.ref(`rooms/${state.roomCode}/devices/${state.deviceId}`);
  deviceRef.set({
    label: state.nickname || 'Mobile',
    platform: 'mobile',
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
      els.statusLine.textContent = partner.typing
        ? `${partner.label || 'Partner'} is coding right now ✨`
        : secondsAgo < 120
        ? `${partner.label || 'Partner'} was just here`
        : `Waiting for ${partner.label || 'your partner'}…`;
    } else {
      els.partnerLabel.textContent = 'Partner';
      partnerCat.setTyping(false);
      partnerIsTyping = false;
      updateDuetState();
      els.statusLine.textContent = 'Waiting for your partner to join with this code…';
    }
  });

  const joinedAt = Date.now();
  eventsRef = db.ref(`rooms/${state.roomCode}/events`).limitToLast(20);
  eventsRef.on('child_added', (snap) => {
    const evt = snap.val();
    if (!evt || evt.from === state.deviceId) return;
    if ((evt.ts || 0) < joinedAt - 5000) return;
    if (evt.type === 'error') {
      showToast(evt.message || `${els.partnerLabel.textContent} hit an error 💥`);
      partnerCat.react('error');
    } else if (evt.type === 'terminal') {
      partnerCat.react('terminal');
    } else if (evt.type === 'poke') {
      showToast(evt.message || `${els.partnerLabel.textContent} poked you! 👉`);
      partnerCat.react('poke');
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('Bongo Buddy', { body: evt.message || 'You got poked! 👉' });
      }
    } else {
      showToast(evt.message || 'Task complete');
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

// The mobile app doesn't have system-wide keystroke access (browsers can't
// see that), so "typing" here is driven by the scratch textarea — handy if
// your partner is coding from a mobile editor, or you just want to say hi.
// We time consecutive "input" events to estimate keystrokes/sec, the same
// way the desktop app measures real keystroke speed.
els.typeBox.addEventListener('input', () => {
  const now = Date.now();
  if (lastInputTime && now - lastInputTime < 3000) {
    const interval = now - lastInputTime;
    smoothedInterval = smoothedInterval == null ? interval : smoothedInterval * 0.7 + interval * 0.3;
  } else {
    smoothedInterval = null;
  }
  lastInputTime = now;
  const speed = smoothedInterval ? 1000 / smoothedInterval : 0;

  setLocalTyping(true, speed);
  clearTimeout(typingResetTimer);
  typingResetTimer = setTimeout(() => {
    lastInputTime = 0;
    smoothedInterval = null;
    setLocalTyping(false, 0);
  }, TYPING_IDLE_MS);
});

// A quick, low-effort "hey, I'm thinking of you" nudge -- separate from the
// typing-driven presence, for when you just want to say hi without typing
// anything. Cooldown keeps it a poke, not a spam button.
function sendPoke() {
  if (!db || !state.roomCode) return;
  youCat.react('poke'); // feedback so it's clear the poke actually sent
  db.ref(`rooms/${state.roomCode}/events`).push({
    type: 'poke',
    message: `${state.nickname || 'Your partner'} poked you! 👉`,
    from: state.deviceId,
    ts: firebase.database.ServerValue.TIMESTAMP,
  });
  els.pokeBtn.disabled = true;
  setTimeout(() => { els.pokeBtn.disabled = false; }, POKE_COOLDOWN_MS);
}
els.pokeBtn.addEventListener('click', sendPoke);

els.newCodeBtn.addEventListener('click', () => {
  els.myCode.textContent = randomCode();
});

els.copyCodeBtn.addEventListener('click', () => {
  navigator.clipboard?.writeText(els.myCode.textContent).catch(() => {});
  els.copyCodeBtn.textContent = 'Copied!';
  setTimeout(() => (els.copyCodeBtn.textContent = 'Copy'), 1200);
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
    saveSettings();
    if (db && state.roomCode) {
      db.ref(`rooms/${state.roomCode}/devices/${state.deviceId}`).update({ skin: skin.id });
    }
  });
});

if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
  Notification.requestPermission();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js').catch(() => {});
}

// ---- boot ----
(function boot() {
  const saved = loadSettings();
  state.deviceId = saved.deviceId || uid();
  state.nickname = saved.nickname || '';
  state.skin = saved.skin || 'classic';
  els.nicknameInput.value = state.nickname;
  youCat.setSkin(state.skin);
  renderSkinRow();
  saveSettings();

  const ok = initFirebase();
  if (!ok) {
    els.myCode.textContent = randomCode();
    return;
  }

  if (saved.roomCode) {
    joinRoom(saved.roomCode);
  } else {
    switchToPairing();
  }
})();
