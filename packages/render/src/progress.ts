export interface FfmpegProgressSnapshotV1 {
  frame: number | null;
  out_time_ms: number | null;
  progress: 'continue' | 'end';
}

export class FfmpegProgressParserV1 {
  #buffer = '';
  #current: Record<string, string> = {};
  #ended = false;

  push(chunk: string): FfmpegProgressSnapshotV1[] {
    if (this.#ended && chunk.length > 0) throw new Error('FFMPEG_PROGRESS_AFTER_END');
    this.#buffer += chunk;
    const lines = this.#buffer.split(/\r?\n/u);
    this.#buffer = lines.pop() ?? '';
    const snapshots: FfmpegProgressSnapshotV1[] = [];
    for (const line of lines) {
      if (line.length === 0) continue;
      const separator = line.indexOf('=');
      if (separator <= 0) throw new Error('FFMPEG_PROGRESS_LINE_INVALID');
      const key = line.slice(0, separator);
      const value = line.slice(separator + 1);
      if (!/^[a-z0-9_]+$/u.test(key)) throw new Error('FFMPEG_PROGRESS_KEY_INVALID');
      if (key === 'progress') {
        if (value !== 'continue' && value !== 'end') {
          throw new Error('FFMPEG_PROGRESS_STATE_INVALID');
        }
        const snapshot: FfmpegProgressSnapshotV1 = {
          frame: this.#integer('frame'),
          out_time_ms: this.#integer('out_time_ms'),
          progress: value,
        };
        snapshots.push(snapshot);
        this.#current = {};
        if (value === 'end') this.#ended = true;
      } else {
        this.#current[key] = value;
      }
    }
    return snapshots;
  }

  finish(): void {
    if (this.#buffer.length > 0) {
      const trailing = this.#buffer;
      this.#buffer = '';
      this.push(`${trailing}\n`);
    }
    if (!this.#ended) throw new Error('FFMPEG_PROGRESS_END_MISSING');
  }

  get ended(): boolean {
    return this.#ended;
  }

  #integer(key: string): number | null {
    const raw = this.#current[key];
    if (raw === undefined || !/^\d+$/u.test(raw)) return null;
    const value = Number(raw);
    return Number.isSafeInteger(value) ? value : null;
  }
}

export class BoundedLogBufferV1 {
  readonly #maximumBytes: number;
  #bytes = 0;
  #chunks: Buffer[] = [];
  #truncated = false;

  constructor(maximumBytes: number) {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
      throw new Error('RENDER_LOG_LIMIT_INVALID');
    }
    this.#maximumBytes = maximumBytes;
  }

  append(value: string | Uint8Array): void {
    if (this.#bytes >= this.#maximumBytes) {
      this.#truncated = true;
      return;
    }
    const bytes = Buffer.from(value);
    const accepted = bytes.subarray(0, this.#maximumBytes - this.#bytes);
    this.#chunks.push(accepted);
    this.#bytes += accepted.length;
    if (accepted.length !== bytes.length) this.#truncated = true;
  }

  get text(): string {
    return Buffer.concat(this.#chunks).toString('utf8');
  }

  get truncated(): boolean {
    return this.#truncated;
  }
}
