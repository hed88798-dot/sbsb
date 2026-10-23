import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it, vi } from 'vitest';
import {
  TEXT_SCHEMA_MAX_BYTES,
  TEXT_SCHEMA_MAX_DEPTH,
  TEXT_SCHEMA_MAX_NODES,
  textGatewayRequestV1Schema,
  textProviderRequestV1Schema,
  textStructuredOutputV1Schema,
} from '../../packages/contracts/src/index.js';
import { structuredOutput, textRequest } from '../helpers/text-structured-output.js';

describe('generic text structured-output contract', () => {
  it('preserves old requests and carries strict schema through both contracts', () => {
    expect(textGatewayRequestV1Schema.parse(textRequest)).toEqual(textRequest);
    const strict = { ...textRequest, structured_output: structuredOutput };
    expect(textGatewayRequestV1Schema.parse(strict)).toEqual(strict);
    const { prompt, ...base } = textRequest;
    const provider = textProviderRequestV1Schema.parse({
      ...base,
      quality_tier: 'standard',
      inputs: [],
      max_cost: { amount: 1, currency: 'CNY' },
      parameters: { prompt, structured_output: structuredOutput },
    });
    expect(provider.parameters).toEqual({
      prompt: textRequest.prompt,
      max_tokens: 2048,
      temperature: 0.7,
      structured_output: structuredOutput,
    });
  });

  it.each([
    { mode: 'JSON_OBJECT' },
    { mode: 'json_schema' },
    { schema_name: '' },
    { schema_name: 'name with spaces' },
    { schema_name: '名称' },
    { schema_name: 'a'.repeat(65) },
    { strict: false },
    { schema: [] },
    { schema: null },
    { schema: true },
  ])('rejects malformed structured configuration: %j', (change) => {
    expect(textStructuredOutputV1Schema.safeParse({ ...structuredOutput, ...change }).success).toBe(
      false,
    );
  });

  it.each([
    undefined,
    () => 'code',
    Symbol('value'),
    1n,
    NaN,
    Infinity,
    -Infinity,
    new Date(),
    new Map(),
    new Set(),
    /pattern/u,
    new Uint8Array(2),
    new (class RuntimeValue {
      label = 'value';
    })(),
  ])('rejects non-JSON nested data (%s)', (value) => {
    expect(
      textStructuredOutputV1Schema.safeParse({ ...structuredOutput, schema: { value } }).success,
    ).toBe(false);
  });

  it('rejects cycles, sparse arrays, symbols and accessors without executing them', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const getter = vi.fn(() => 'unsafe');
    const toJSON = vi.fn(() => ({}));
    const accessor = Object.defineProperty({}, 'value', { enumerable: true, get: getter });
    for (const schema of [
      cycle,
      { values: new Array(2) },
      { [Symbol('key')]: 1 },
      accessor,
      { toJSON },
      Object.defineProperty({}, 'hidden', { value: 1 }),
    ]) {
      expect(textStructuredOutputV1Schema.safeParse({ ...structuredOutput, schema }).success).toBe(
        false,
      );
    }
    expect(getter).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
  });

  it('enforces exact serialized UTF-8 byte, depth and node limits', () => {
    const parse = (schema: unknown) =>
      textStructuredOutputV1Schema.safeParse({ ...structuredOutput, schema }).success;
    const emptySize = new TextEncoder().encode(JSON.stringify({ description: '' })).length;
    expect(parse({ description: 'x'.repeat(TEXT_SCHEMA_MAX_BYTES - emptySize) })).toBe(true);
    expect(parse({ description: 'x'.repeat(TEXT_SCHEMA_MAX_BYTES - emptySize + 1) })).toBe(false);
    expect(parse({ description: '猪'.repeat(22_000) })).toBe(false);
    expect(parse({ description: '\n'.repeat(33_000) })).toBe(false);
    let nested: unknown = null;
    for (let i = 0; i < TEXT_SCHEMA_MAX_DEPTH; i++) nested = { child: nested };
    expect(parse(nested)).toBe(true);
    expect(parse({ child: nested })).toBe(false);
    expect(parse({ enum: Array(TEXT_SCHEMA_MAX_NODES - 2).fill(0) })).toBe(true);
    expect(parse({ enum: Array(TEXT_SCHEMA_MAX_NODES - 1).fill(0) })).toBe(false);
  });

  it('publishes additive JSON Schema contracts without a domain schema dependency', () => {
    const root = resolve(import.meta.dirname, '../..');
    const ajv = new Ajv2020({ strict: true });
    const textSchema = JSON.parse(
      readFileSync(resolve(root, 'schemas/provider/v1/text-capability.schema.json'), 'utf8'),
    ) as object;
    const providerSchema = JSON.parse(
      readFileSync(resolve(root, 'schemas/provider/v1/request.schema.json'), 'utf8'),
    ) as object;
    const validateText = ajv.compile(textSchema);
    expect(validateText(textRequest)).toBe(true);
    expect(validateText({ ...textRequest, structured_output: structuredOutput })).toBe(true);
    expect(
      validateText({
        ...textRequest,
        structured_output: { ...structuredOutput, mode: 'JSON_OBJECT' },
      }),
    ).toBe(false);
    const validateProvider = ajv.compile(providerSchema);
    const { prompt, ...base } = textRequest;
    const provider = {
      ...base,
      quality_tier: 'standard',
      inputs: [],
      max_cost: { amount: 1, currency: 'CNY' },
      parameters: { prompt, structured_output: structuredOutput },
    };
    expect(validateProvider(provider)).toBe(true);
    expect(
      validateProvider({
        ...provider,
        parameters: { prompt, structured_output: { ...structuredOutput, strict: false } },
      }),
    ).toBe(false);
    for (const path of [
      'packages/contracts/src/text-structured-output.ts',
      'packages/provider-adapters/src/index.ts',
      'apps/gateway/src/app.ts',
    ]) {
      expect(readFileSync(resolve(root, path), 'utf8')).not.toMatch(
        /ShotPlan|shot-planning|semantic-proposer/,
      );
    }
  });
});
