import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, session } from 'electron';
import {
  CopywritingRepository,
  JobRepository,
  ProductRepository,
  SettingsRepository,
  openDatabase,
} from '@app/local-db';
import { MockTextCapabilityClient } from '@app/provider-client';
import { CopywritingService } from './copywriting-service.js';
import { registerIpc } from './ipc.js';

const currentDirectory = fileURLToPath(new URL('.', import.meta.url));
let mainWindow: BrowserWindow | null = null;

if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
  app.setPath('userData', join(process.env.LOCALAPPDATA, 'Company', 'AiVideoDesktop'));
}

async function runNativeSqliteSmoke(): Promise<void> {
  const migrationsDirectory = app.isPackaged
    ? join(process.resourcesPath, 'migrations', 'desktop-sqlite')
    : resolve(app.getAppPath(), '../../migrations/desktop-sqlite');
  const directory = mkdtempSync(join(tmpdir(), 'desktop-native-smoke-'));
  const { db } = await openDatabase({
    dbPath: join(directory, 'smoke.db'),
    migrationsDirectory,
  });
  db.prepare(
    "INSERT INTO app_settings(setting_key, setting_value, updated_at) VALUES ('smoke', 'ok', ?)",
  ).run(new Date().toISOString());
  const value = db
    .prepare("SELECT setting_value FROM app_settings WHERE setting_key = 'smoke'")
    .pluck()
    .get();
  db.close();
  if (value !== 'ok') throw new Error('NATIVE_SQLITE_SMOKE_FAILED');
  console.log('NATIVE_SQLITE_SMOKE:PASS');
}

async function createWindow(): Promise<void> {
  const migrationsDirectory = app.isPackaged
    ? join(process.resourcesPath, 'migrations', 'desktop-sqlite')
    : resolve(app.getAppPath(), '../../migrations/desktop-sqlite');
  const { db } = await openDatabase({
    dbPath: join(app.getPath('userData'), 'app.db'),
    migrationsDirectory,
  });
  const products = new ProductRepository(db);
  const jobs = new JobRepository(db);
  const copywritingRepository = new CopywritingRepository(db);
  const settings = new SettingsRepository(db);
  jobs.recoverInterrupted();
  const copywriting = new CopywritingService({
    products,
    jobs,
    copywriting: copywritingRepository,
    client: new MockTextCapabilityClient(),
  });

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    webPreferences: {
      preload: join(currentDirectory, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  registerIpc({ ipcMain, window: mainWindow, products, jobs, settings, copywriting });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    void copywriting.shutdown().finally(() => db.close());
    mainWindow = null;
  });

  if (app.isPackaged) {
    await mainWindow.loadFile(join(currentDirectory, '../../dist-renderer/index.html'));
  } else {
    await mainWindow.loadURL('http://127.0.0.1:5173/');
  }
}

app.whenReady().then(async () => {
  if (process.env.DESKTOP_NATIVE_SMOKE === '1') {
    await runNativeSqliteSmoke();
    app.quit();
    return;
  }
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:5173",
        ],
      },
    });
  });
  await createWindow();
});

app.on('window-all-closed', () => app.quit());
