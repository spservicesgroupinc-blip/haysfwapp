/**
 * Preload bridge for the Hays + Sons desktop app.
 *
 * Exposes a minimal, inert-in-browser `window.haysDesktop` object that the
 * renderer uses to detect the desktop shell (SW registration is skipped there,
 * and browser-only Google Drive/Sheets features are disabled).
 */
const { contextBridge, ipcRenderer } = require('electron');

let appInfo = { appVersion: '0.0.0', platform: process.platform };
try {
  const info = ipcRenderer.sendSync('hays:app-info');
  if (info && typeof info === 'object') appInfo = { ...appInfo, ...info };
} catch {
  // Fall back to the static values above.
}

contextBridge.exposeInMainWorld('haysDesktop', {
  isDesktop: true,
  platform: appInfo.platform || process.platform,
  appVersion: appInfo.appVersion || '0.0.0',
});
