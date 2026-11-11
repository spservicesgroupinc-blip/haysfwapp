/**
 * Bridge to the Electron desktop shell.
 *
 * The preload script (electron/preload.cjs) exposes `window.haysDesktop` in the
 * packaged app. Everything here is inert in a normal browser.
 */

export interface HaysDesktopBridge {
  isDesktop: true;
  platform: string;
  appVersion: string;
}

declare global {
  interface Window {
    haysDesktop?: HaysDesktopBridge;
  }
}

export function getDesktopBridge(): HaysDesktopBridge | undefined {
  return window.haysDesktop;
}

/** True when running inside the packaged Electron app. */
export function isDesktop(): boolean {
  return window.haysDesktop?.isDesktop === true;
}

/** True when running inside any Electron renderer (dev or packaged). */
export function isElectronRuntime(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron');
}
