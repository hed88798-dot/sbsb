import { describe, expect, it } from 'vitest';
import { DesktopLifecycleOwnerV1 } from '../../apps/desktop/src/main/desktop-lifecycle-owner.js';

describe('Desktop lifecycle ownership', () => {
  it('closes SQLite only after normal Render and copywriting settlement', async () => {
    const events: string[] = [];
    let settleRender!: () => void;
    const renderBarrier = new Promise<void>((resolve) => {
      settleRender = resolve;
    });
    const owner = new DesktopLifecycleOwnerV1({
      render: {
        shutdown: async () => {
          events.push('render-cancel-requested');
          await renderBarrier;
          events.push('render-settled');
          return {
            settled: true,
            timed_out: false,
            cancellation_requested_job_ids: ['render_job_1'],
          };
        },
      },
      copywriting: {
        shutdown: async () => {
          events.push('copywriting-settled');
        },
      },
      database: {
        close: () => events.push('database-closed'),
      },
      renderTimeoutMs: 25,
    });

    const shutdown = owner.shutdown();
    await Promise.resolve();
    expect(events).toEqual(['copywriting-settled', 'render-cancel-requested']);
    expect(events).not.toContain('database-closed');
    settleRender();
    await expect(shutdown).resolves.toMatchObject({ settled: true, database_closed: true });
    expect(events).toEqual([
      'copywriting-settled',
      'render-cancel-requested',
      'render-settled',
      'database-closed',
    ]);
  });

  it('does not close SQLite after the bounded Render timeout escape path', async () => {
    let closeCount = 0;
    const owner = new DesktopLifecycleOwnerV1({
      render: {
        shutdown: async () => ({
          settled: false,
          timed_out: true,
          cancellation_requested_job_ids: ['render_job_timeout'],
        }),
      },
      copywriting: { shutdown: async () => undefined },
      database: { close: () => (closeCount += 1) },
      renderTimeoutMs: 5,
    });
    await expect(owner.shutdown()).resolves.toEqual({
      settled: false,
      timed_out: true,
      cancellation_requested_job_ids: ['render_job_timeout'],
      database_closed: false,
    });
    expect(closeCount).toBe(0);
  });
});
