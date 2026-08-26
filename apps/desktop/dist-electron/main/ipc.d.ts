import type { BrowserWindow, IpcMain } from 'electron';
import type { JobRepository, ProductRepository, SettingsRepository } from '@app/local-db';
import type { CopywritingService } from './copywriting-service.js';
export declare function registerIpc(options: {
    ipcMain: IpcMain;
    window: BrowserWindow;
    products: ProductRepository;
    jobs: JobRepository;
    settings: SettingsRepository;
    copywriting: CopywritingService;
}): void;
