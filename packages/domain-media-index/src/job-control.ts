import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export class MediaIndexJobControl {
  readonly #jobDirectory: string;
  readonly pauseFile: string;
  readonly cancelFile: string;

  constructor(jobDirectory: string) {
    this.#jobDirectory = resolve(jobDirectory);
    this.pauseFile = join(this.#jobDirectory, 'PAUSE');
    this.cancelFile = join(this.#jobDirectory, 'CANCEL');
  }

  async initialize(): Promise<void> {
    await mkdir(this.#jobDirectory, { recursive: true });
  }

  async pause(): Promise<void> {
    await this.initialize();
    await writeFile(this.pauseFile, 'pause\n', { encoding: 'utf8', flag: 'w' });
  }

  async resume(): Promise<void> {
    await rm(this.pauseFile, { force: true });
  }

  async cancel(): Promise<void> {
    await this.initialize();
    await writeFile(this.cancelFile, 'cancel\n', { encoding: 'utf8', flag: 'w' });
  }
}
