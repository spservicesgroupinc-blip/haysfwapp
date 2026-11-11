/**
 * Electron main process for the Hays + Sons desktop app.
 *
 * - Serves the Vite build (`dist/`) over a privileged `app://` scheme so the
 *   SPA keeps absolute asset paths, workers and fetch working exactly as on
 *   the web.
 * - In development (not packaged) it prefers the Vite dev server on :3000 and
 *   falls back to the built app when the server is not running.
 * - PDF/ZIP downloads get a native "Save as" dialog; external links open in
 *   the system browser; blob windows (document print flow) open in-app.
 * - Packaged builds check a static update feed via electron-updater.
 *
 * Bundled to dist-electron/main.cjs by scripts/build-electron.mjs.
 */
const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, session, shell, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const APP_SCHEME = 'app';
const APP_ORIGIN = `${APP_SCHEME}://hays`;
const DEV_URL = process.env.ELECTRON_START_URL || 'http://localhost:3000';
const isDev = !app.isPackaged;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

// Must run before app ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
  },
]);

let mainWindow = null;

function distDir() {
  return path.join(__dirname, '..', 'dist');
}

function registerAppProtocol() {
  const root = distDir();
  protocol.handle(APP_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === '/' || pathname === '') pathname = '/index.html';

      let filePath = path.normalize(path.join(root, pathname));
      if (!filePath.startsWith(root)) {
        return new Response('Forbidden', { status: 403 });
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        // SPA navigation fallback; unknown asset requests stay 404.
        if (!path.extname(pathname)) filePath = path.join(root, 'index.html');
        else return new Response('Not found', { status: 404 });
      }
      const data = await fs.promises.readFile(filePath);
      const type = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      return new Response(data, { headers: { 'Content-Type': type } });
    } catch (err) {
      return new Response(`Failed to load resource: ${err && err.message}`, { status: 500 });
    }
  });
}

function configureDownloads() {
  session.defaultSession.on('will-download', (_event, item) => {
    const suggested = item.getFilename();
    item.setSaveDialogOptions({
      title: 'Save generated document',
      defaultPath: path.join(app.getPath('documents'), suggested),
    });
  });
}

async function canReachDevServer() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await net.fetch(DEV_URL, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#F8FAFC',
    autoHideMenuBar: true,
    title: 'Hays + Sons — Restoration Document Suite',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('blob:')) {
      // The print-preview flow opens a blob URL in a new window.
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          backgroundColor: '#FFFFFF',
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      };
    }
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    mainWindow.webContents.on('console-message', (event) => {
      if (event.level === 'error') console.log('[renderer error]', event.message);
    });
  }
  mainWindow.webContents.on('did-finish-load', () => {
    console.log(`[window] loaded ${mainWindow.webContents.getURL()}`);
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.warn(`[window] failed to load ${url} (${code} ${description})`);
  });

  const useDevServer = isDev && (await canReachDevServer());
  if (useDevServer) await mainWindow.loadURL(DEV_URL);
  else await mainWindow.loadURL(`${APP_ORIGIN}/index.html`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setupAutoUpdate() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-downloaded', (info) => {
      void dialog
        .showMessageBox({
          type: 'info',
          buttons: ['Restart now', 'Later'],
          defaultId: 0,
          cancelId: 1,
          title: 'Update ready',
          message: `Version ${info.version} has been downloaded.`,
          detail: 'Restart the app to apply the update.',
        })
        .then(({ response }) => {
          if (response === 0) autoUpdater.quitAndInstall();
        });
    });

    autoUpdater.checkForUpdates().catch((err) => {
      // Offline or feed not published yet — try again next launch.
      console.warn('Auto-update check failed:', err && err.message ? err.message : err);
    });
  } catch (err) {
    console.warn('Auto-update unavailable:', err && err.message ? err.message : err);
  }
}

ipcMain.on('hays:app-info', (event) => {
  event.returnValue = { appVersion: app.getVersion(), platform: process.platform };
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.setAppUserModelId('com.haysandsons.docsuite');

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerAppProtocol();
    configureDownloads();
    Menu.setApplicationMenu(null);
    void createWindow();
    setupAutoUpdate();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
