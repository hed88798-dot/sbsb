import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import parse from 'spdx-expression-parse';

const require = createRequire(import.meta.url);
const licenseIds = new Set(require('spdx-license-ids'));
const deprecatedLicenseIds = new Set(require('spdx-license-ids/deprecated'));
const exceptionIds = new Set(require('spdx-exceptions'));
const deprecatedExceptionIds = new Set(require('spdx-exceptions/deprecated'));
const parserPackage = require('spdx-expression-parse/package.json');
const licensePackage = require('spdx-license-ids/package.json');
const exceptionPackage = require('spdx-exceptions/package.json');

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export const spdxParserIdentity = Object.freeze({
  parser_name: parserPackage.name,
  parser_version: parserPackage.version,
  spdx_license_list_version: '3.28.0',
  spdx_license_data_package: `${licensePackage.name}@${licensePackage.version}`,
  spdx_license_data_sha256: sha256(require.resolve('spdx-license-ids')),
  spdx_exception_list_version: '3.23',
  spdx_exception_data_package: `${exceptionPackage.name}@${exceptionPackage.version}`,
  spdx_exception_data_sha256: sha256(require.resolve('spdx-exceptions')),
});

function convert(node) {
  if (node.conjunction) {
    return {
      type: 'conjunction',
      operator: node.conjunction.toUpperCase(),
      left: convert(node.left),
      right: convert(node.right),
    };
  }
  const licenseId = node.license;
  const customReference =
    licenseId.startsWith('LicenseRef-') || licenseId.startsWith('DocumentRef-');
  return {
    type: 'license',
    license_id: licenseId,
    or_later: node.plus === true,
    exception_id: node.exception ?? null,
    identifier_status: customReference
      ? 'CUSTOM_REFERENCE'
      : licenseIds.has(licenseId)
        ? 'CURRENT'
        : deprecatedLicenseIds.has(licenseId)
          ? 'DEPRECATED'
          : 'UNKNOWN',
    exception_status: node.exception
      ? exceptionIds.has(node.exception)
        ? 'CURRENT'
        : deprecatedExceptionIds.has(node.exception)
          ? 'DEPRECATED'
          : 'UNKNOWN'
      : 'NONE',
  };
}

function precedence(node) {
  if (node.type === 'license') return 3;
  return node.operator === 'AND' ? 2 : 1;
}

export function renderSpdxAst(node, parentPrecedence = 0) {
  if (node.type === 'license') {
    const base = `${node.license_id}${node.or_later ? '+' : ''}`;
    return node.exception_id ? `${base} WITH ${node.exception_id}` : base;
  }
  const ownPrecedence = precedence(node);
  const rendered = `${renderSpdxAst(node.left, ownPrecedence)} ${node.operator} ${renderSpdxAst(
    node.right,
    ownPrecedence,
  )}`;
  return ownPrecedence < parentPrecedence ? `(${rendered})` : rendered;
}

export function parseSpdxExpression(expression) {
  if (typeof expression !== 'string' || expression.trim() === '') {
    throw new TypeError('SPDX expression must be a non-empty string');
  }
  const ast = convert(parse(expression));
  return {
    original_expression: expression,
    normalized_expression: renderSpdxAst(ast),
    ast,
    parser: spdxParserIdentity,
  };
}
