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
import { DesktopLifecycleOwnerV1 } from './desktop-lifecycle-owner.js';
import { createDesktopRenderCompositionV1 } from './desktop-render-composition.js';
import { registerIpc } from './ipc.js';
import { runPackagedRenderRuntimeSmoke } from './packaged-render-runtime-smoke.js';
import { createInstalledDesktopStartupSmokeRecorder } from './installed-desktop-startup-smoke.js';

const currentDirectory = fileURLToPath(new URL('.', import.meta.url));
let mainWindow: BrowserWindow | null = null;
let lifecycleOwner: DesktopLifecycleOwnerV1 | null = null;
let shutdownInitiated = false;
let requestedExitCode = 0;
const installedDesktopStartupSmoke =
  process.env.DESKTOP_INSTALLED_STARTUP_SMOKE === '1' &&
  process.env.DESKTOP_INSTALLED_STARTUP_SMOKE_EVIDENCE_PATH
    ? createInstalledDesktopStartupSmokeRecorder({
        evidencePath: process.env.DESKTOP_INSTALLED_STARTUP_SMOKE_EVIDENCE_PATH,
        headSha: process.env.GITHUB_SHA ?? 'unknown',
        processResourcesPath: process.resourcesPath,
      })
    : null;

if (installedDesktopStartupSmoke) {
  process.on('unhandledRejection', () => installedDesktopStartupSmoke.markUnhandledMainRejection());
  process.on('uncaughtExceptionMonitor', () =>
    installedDesktopStartupSmoke.markUncaughtMainException(),
  );
}

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
  const copywriting = new CopywritingService({
    products,
    jobs,
    copywriting: copywritingRepository,
    client: new MockTextCapabilityClient(),
  });
  const controlledDevRuntimeRoot = process.env.DESKTOP_RENDER_DEV_RUNTIME_ROOT;
  const renderComposition = await createDesktopRenderCompositionV1({
    database: db,
    jobs,
    userDataPath: app.getPath('userData'),
    runtimeLocation: app.isPackaged
      ? { is_packaged: true, resources_path: process.resourcesPath }
      : controlledDevRuntimeRoot
        ? { is_packaged: false, controlled_dev_runtime_root: controlledDevRuntimeRoot }
        : { is_packaged: false },
  });
  installedDesktopStartupSmoke?.markRenderCompositionInitialized(renderComposition.available);
  await renderComposition.orchestrator.recoverStartup();
  installedDesktopStartupSmoke?.markRecoveryCompleted();

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
  installedDesktopStartupSmoke?.markBrowserWindowCreated();
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  const ipcBoundary = registerIpc({
    ipcMain,
    window: mainWindow,
    products,
    jobs,
    settings,
    copywriting,
    render: renderComposition.orchestrator,
  });
  lifecycleOwner = new DesktopLifecycleOwnerV1({
    render: renderComposition.orchestrator,
    copywriting,
    database: db,
    quiesceRenderer: () => {
      ipcBoundary.quiesce();
      const window = mainWindow;
      if (window && !window.isDestroyed()) window.destroy();
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (app.isPackaged) {
    await mainWindow.loadFile(join(currentDirectory, '../../dist-renderer/index.html'));
  } else {
    await mainWindow.loadURL('http://127.0.0.1:5173/');
  }
  if (installedDesktopStartupSmoke) {
    setTimeout(() => app.quit(), 100);
  }
}

app
  .whenReady()
  .then(async () => {
    if (process.env.DESKTOP_RENDER_RUNTIME_SMOKE === '1') {
      if (!app.isPackaged) throw new Error('PACKAGED_RENDER_RUNTIME_SMOKE_REQUIRES_PACKAGED_APP');
      const evidence = await runPackagedRenderRuntimeSmoke(process.resourcesPath);
      console.log(`PACKAGED_RENDER_RUNTIME_SMOKE_JSON:${JSON.stringify(evidence)}`);
      console.log('PACKAGED_RENDER_RUNTIME_SMOKE:PASS');
      app.quit();
      return;
    }
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
  })
  .catch((error: unknown) => {
    console.error(error);
    installedDesktopStartupSmoke?.markMainStartupFailure();
    requestedExitCode = 1;
    app.quit();
  });

app.on('window-all-closed', () => {
  if (!shutdownInitiated) app.quit();
});

app.on('before-quit', (event) => {
  if (shutdownInitiated) {
    event.preventDefault();
    return;
  }
  event.preventDefault();
  shutdownInitiated = true;
  installedDesktopStartupSmoke?.markShutdownRequested();
  const owner = lifecycleOwner;
  if (!owner) {
    void installedDesktopStartupSmoke?.write().finally(() => app.exit(requestedExitCode));
    if (!installedDesktopStartupSmoke) app.exit(requestedExitCode);
    return;
  }
  void owner.shutdown().then(
    async (result) => {
      installedDesktopStartupSmoke?.markShutdownCompleted(result.database_closed);
      await installedDesktopStartupSmoke?.write();
      app.exit(requestedExitCode);
    },
    async () => {
      installedDesktopStartupSmoke?.markShutdownCompleted(false);
      await installedDesktopStartupSmoke?.write();
      app.exit(1);
    },
  );
});
