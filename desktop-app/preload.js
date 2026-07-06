// Safely exposes a minimal API from the main process to the renderer.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddyAPI', {
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  quit: () => ipcRenderer.invoke('window:quit'),
  onLocalTyping: (callback) => {
    ipcRenderer.on('local-typing', (_evt, isTyping, keysPerSec) => callback(isTyping, keysPerSec));
  },
  onTaskComplete: (callback) => {
    ipcRenderer.on('task-complete', (_evt, message, type) => callback(message, type));
  },
});
