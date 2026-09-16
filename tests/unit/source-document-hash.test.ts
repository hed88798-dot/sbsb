import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { computeSourceDocumentHashV1 } from '../../packages/domain-copywriting/src/index.js';

function independentHash(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

describe('SHA256_UTF8_EXACT_V1', () => {
  const exactVectors = [
    '',
    'abc',
    'abc ',
    'abc\n',
    'abc\r\n',
    ' abc',
    'abc\t',
    '\u00e9',
    'e\u0301',
    '兽药产品A：每袋100g 🐄',
  ];

  it.each(exactVectors)('hashes the exact UTF-8 bytes for %j', (text) => {
    expect(computeSourceDocumentHashV1(text)).toBe(independentHash(text));
  });

  it.each([
    ['abc', 'abc '],
    ['abc\n', 'abc\r\n'],
    ['abc', ' abc'],
    ['abc', 'abc\t'],
    ['\u00e9', 'e\u0301'],
  ])('does not normalize distinct strings %j and %j', (left, right) => {
    expect(computeSourceDocumentHashV1(left)).not.toBe(computeSourceDocumentHashV1(right));
  });
});
