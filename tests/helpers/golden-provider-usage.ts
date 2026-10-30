import { channel } from 'node:diagnostics_channel';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib';

export interface GoldenProviderUsage {
  provider_requests: number;
  http_status: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  thinking_state: 'ABSENT' | 'EMPTY' | 'NONEMPTY' | 'NOT_EXPOSED';
}

interface TransportEvent {
  request: { path: string; origin: unknown };
  response: { statusCode: number; headers: unknown[] };
  chunk: Uint8Array;
}

/** Passive test-only observer. Never replaces fetch, reads headers into evidence, or changes a response. */
export function observeGoldenProviderUsage(endpoint: string) {
  let current: string | undefined;
  const records = new Map<string, GoldenProviderUsage>();
  const requests = new WeakMap<
    object,
    { id: string; chunks: Buffer[]; size: number; encoding: string }
  >();
  const subscriptions: Array<() => void> = [];
  const subscribe = (name: string, listener: (value: TransportEvent) => void) => {
    const target = channel(name);
    const guarded = (value: unknown) => {
      try {
        listener(value as TransportEvent);
      } catch {
        /* Evidence remains unknown on malformed transport data. */
      }
    };
    target.subscribe(guarded);
    subscriptions.push(() => target.unsubscribe(guarded));
  };
  subscribe('undici:request:create', ({ request }) => {
    if (!current || new URL(request.path, String(request.origin)).href !== endpoint) return;
    records.get(current)!.provider_requests += 1;
    requests.set(request, { id: current, chunks: [], size: 0, encoding: '' });
  });
  subscribe('undici:request:headers', ({ request, response }) => {
    const state = requests.get(request);
    if (!state) return;
    records.get(state.id)!.http_status = response.statusCode;
    for (let index = 0; index < response.headers.length; index += 2) {
      if (String(response.headers[index]).toLowerCase() === 'content-encoding')
        state.encoding = String(response.headers[index + 1]);
    }
  });
  subscribe('undici:request:bodyChunkReceived', ({ request, chunk }) => {
    const state = requests.get(request);
    if (!state || records.get(state.id)!.http_status !== 200) return;
    state.size += chunk.length;
    if (state.size <= 1_048_576) state.chunks.push(Buffer.from(chunk));
  });
  subscribe('undici:request:trailers', ({ request }) => {
    const state = requests.get(request);
    if (!state) return;
    requests.delete(request);
    if (state.size > 1_048_576 || records.get(state.id)!.http_status !== 200) return;
    let bytes = Buffer.concat(state.chunks);
    const options = { maxOutputLength: 1_048_576 };
    if (state.encoding === 'gzip') bytes = gunzipSync(bytes, options);
    if (state.encoding === 'deflate') bytes = inflateSync(bytes, options);
    if (state.encoding === 'br') bytes = brotliDecompressSync(bytes, options);
    const body = JSON.parse(bytes.toString('utf8'));
    const count = (value: unknown) =>
      Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null;
    const thinking = body.choices?.[0]?.message?.reasoning_content;
    Object.assign(records.get(state.id)!, {
      prompt_tokens: count(body.usage?.prompt_tokens),
      completion_tokens: count(body.usage?.completion_tokens),
      total_tokens: count(body.usage?.total_tokens),
      thinking_state:
        thinking === undefined
          ? 'ABSENT'
          : thinking === null || thinking === ''
            ? 'EMPTY'
            : 'NONEMPTY',
    });
  });
  return {
    begin(id: string) {
      if (current || records.has(id)) throw new Error('GOLDEN_CONCURRENT_OR_DUPLICATE_REQUEST');
      current = id;
      records.set(id, {
        provider_requests: 0,
        http_status: null,
        prompt_tokens: null,
        completion_tokens: null,
        total_tokens: null,
        thinking_state: 'NOT_EXPOSED',
      });
    },
    end() {
      current = undefined;
    },
    get(id: string): GoldenProviderUsage {
      return { ...records.get(id)! };
    },
    close() {
      subscriptions.forEach((unsubscribe) => unsubscribe());
    },
  };
}
