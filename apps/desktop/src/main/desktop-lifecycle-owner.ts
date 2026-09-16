import type { CopywritingService } from './copywriting-service.js';
import {
  RENDER_DESKTOP_SHUTDOWN_TIMEOUT_MS,
  type DesktopRenderOrchestratorV1,
  type DesktopRenderShutdownResultV1,
} from './desktop-render-orchestrator.js';

export interface DesktopShutdownResultV1 extends DesktopRenderShutdownResultV1 {
  database_closed: boolean;
}

export class DesktopLifecycleOwnerV1 {
  readonly #render: Pick<DesktopRenderOrchestratorV1, 'shutdown'>;
  readonly #copywriting: Pick<CopywritingService, 'shutdown'>;
  readonly #database: { close(): void };
  readonly #renderTimeoutMs: number;
  #shutdown: Promise<DesktopShutdownResultV1> | null = null;

  constructor(options: {
    render: Pick<DesktopRenderOrchestratorV1, 'shutdown'>;
    copywriting: Pick<CopywritingService, 'shutdown'>;
    database: { close(): void };
    renderTimeoutMs?: number;
  }) {
    this.#render = options.render;
    this.#copywriting = options.copywriting;
    this.#database = options.database;
    this.#renderTimeoutMs = options.renderTimeoutMs ?? RENDER_DESKTOP_SHUTDOWN_TIMEOUT_MS;
  }

  shutdown(): Promise<DesktopShutdownResultV1> {
    this.#shutdown ??= this.#shutdownOnce();
    return this.#shutdown;
  }

  async #shutdownOnce(): Promise<DesktopShutdownResultV1> {
    const copywritingSettlement = this.#copywriting.shutdown();
    const render = await this.#render.shutdown(this.#renderTimeoutMs);
    if (!render.settled) {
      return { ...render, database_closed: false };
    }
    await copywritingSettlement;
    this.#database.close();
    return { ...render, database_closed: true };
  }
}
