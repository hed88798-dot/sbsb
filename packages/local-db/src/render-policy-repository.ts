import type { Database } from 'better-sqlite3';
import { canonicalJson } from '@app/domain-media-index';
import { parseRenderPolicyV1, type RenderPolicyV1 } from '@app/render';

interface RenderPolicyRow {
  policy_id: string;
  policy_version: number;
  policy_hash: string;
  policy_json: string;
  registered_at: string;
}

export class RenderPolicyRepository {
  readonly #db: Database;
  readonly #clock: () => string;

  constructor(db: Database, options: { clock?: () => string } = {}) {
    this.#db = db;
    this.#clock = options.clock ?? (() => new Date().toISOString());
  }

  register(value: RenderPolicyV1): RenderPolicyV1 {
    const policy = parseRenderPolicyV1(value);
    const bytes = canonicalJson(policy);
    const existing = this.#row(policy.policy_id, policy.policy_version);
    if (existing) {
      if (existing.policy_hash !== policy.policy_hash || existing.policy_json !== bytes) {
        throw new Error('RENDER_POLICY_VERSION_CONFLICT');
      }
      return this.#load(existing);
    }
    this.#db
      .prepare(
        `INSERT INTO render_policy_versions(
          policy_id, policy_version, policy_hash, policy_json, registered_at
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(policy.policy_id, policy.policy_version, policy.policy_hash, bytes, this.#clock());
    return this.require(policy.policy_id, policy.policy_version);
  }

  get(policyId: string, policyVersion: number): RenderPolicyV1 | null {
    const row = this.#row(policyId, policyVersion);
    return row ? this.#load(row) : null;
  }

  require(policyId: string, policyVersion: number): RenderPolicyV1 {
    const policy = this.get(policyId, policyVersion);
    if (!policy) throw new Error('RENDER_POLICY_NOT_FOUND');
    return policy;
  }

  #row(policyId: string, policyVersion: number): RenderPolicyRow | undefined {
    return this.#db
      .prepare('SELECT * FROM render_policy_versions WHERE policy_id = ? AND policy_version = ?')
      .get(policyId, policyVersion) as RenderPolicyRow | undefined;
  }

  #load(row: RenderPolicyRow): RenderPolicyV1 {
    const value = JSON.parse(row.policy_json) as unknown;
    const policy = parseRenderPolicyV1(value);
    if (
      canonicalJson(policy) !== row.policy_json ||
      policy.policy_id !== row.policy_id ||
      policy.policy_version !== row.policy_version ||
      policy.policy_hash !== row.policy_hash
    ) {
      throw new Error('RENDER_POLICY_STORED_INTEGRITY_MISMATCH');
    }
    return policy;
  }
}
