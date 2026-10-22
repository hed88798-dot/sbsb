import { z } from 'zod';

export type TextJsonValue = null | boolean | number | string | TextJsonValue[] | TextJsonObject;
export interface TextJsonObject {
  [key: string]: TextJsonValue;
}

export const TEXT_SCHEMA_MAX_BYTES = 65_536;
export const TEXT_SCHEMA_MAX_DEPTH = 32;
export const TEXT_SCHEMA_MAX_NODES = 8_192;

// Inspect data descriptors before serialization: never invoke getters or toJSON hooks.
// Bounds apply to the expanded JSON tree, including repeated references.
function isBoundedJsonObject(input: unknown): input is TextJsonObject {
  let bytes = 0;
  let nodes = 0;
  const ancestors = new Set<object>();
  const encoder = new TextEncoder();
  const add = (text: string) => {
    bytes += encoder.encode(text).byteLength;
    return bytes <= TEXT_SCHEMA_MAX_BYTES;
  };
  const visit = (value: unknown, depth: number): boolean => {
    if (++nodes > TEXT_SCHEMA_MAX_NODES || depth > TEXT_SCHEMA_MAX_DEPTH) return false;
    if (value === null || typeof value === 'boolean') return add(JSON.stringify(value));
    if (typeof value === 'number') return Number.isFinite(value) && add(JSON.stringify(value));
    if (typeof value === 'string') {
      return value.length <= TEXT_SCHEMA_MAX_BYTES && add(JSON.stringify(value));
    }
    if (typeof value !== 'object' || ancestors.has(value)) return false;
    const array = Array.isArray(value);
    const prototype: unknown = Object.getPrototypeOf(value);
    if (
      array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null
    ) {
      return false;
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length > TEXT_SCHEMA_MAX_NODES) return false;
    ancestors.add(value);
    if (!add(array ? '[]' : '{}')) return false;
    let count = 0;
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return false;
      if (array) {
        if (key !== String(count)) return false;
      } else if (key.length > TEXT_SCHEMA_MAX_BYTES || !add(JSON.stringify(key)) || !add(':')) {
        return false;
      }
      if (count++ > 0 && !add(',')) return false;
      if (!visit(descriptor.value, depth + 1)) return false;
    }
    // Reject sparse arrays rather than silently turning holes into null.
    if (array && count !== value.length) return false;
    ancestors.delete(value);
    return true;
  };
  try {
    return input !== null && typeof input === 'object' && !Array.isArray(input) && visit(input, 0);
  } catch {
    return false;
  }
}

export const textStructuredOutputV1Schema = z
  .object({
    mode: z.literal('JSON_SCHEMA_STRICT'),
    schema_name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    schema: z.custom<TextJsonObject>(isBoundedJsonObject, {
      message: 'Schema must be a JSON object within 65536 UTF-8 bytes, depth 32 and 8192 nodes',
    }),
  })
  .strict();

export type TextStructuredOutputV1 = z.infer<typeof textStructuredOutputV1Schema>;
