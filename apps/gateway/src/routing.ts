import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ProviderCapabilityV1, ProviderRequestV1 } from '@app/contracts';
import type { ProviderAdapter } from '@app/provider-adapters';
import type { RoutedProvider } from './store.js';
import { GatewayStoreError } from './store.js';

export interface ProviderRouteConfig {
  capability: ProviderCapabilityV1;
  modelAlias: string;
  qualityTier: 'standard' | 'premium';
  primary: string;
  fallback?: string;
  enabled?: boolean;
  regions?: string[];
}

export interface LegalApprovalInput {
  provider: string;
  providerModel: string;
  capability: ProviderCapabilityV1;
  apiTermsVersion: string;
  modelCodeLicense: string;
  modelWeightLicense: string;
  commercialUse: boolean;
  outputOwnership: string;
  trainingOrRetentionPolicy: string;
  regionDataTransfer: string;
  prohibitedContent: string;
  attributionRequirement: string;
  approvedBy: string;
  approvedAt: string;
  expiresAt: string;
}

export function approveProvider(db: Database.Database, input: LegalApprovalInput): void {
  db.prepare(
    `INSERT OR REPLACE INTO legal_allowlist(
      provider, provider_model, capability, api_terms_version, model_code_license,
      model_weight_license, commercial_use, output_ownership,
      training_or_retention_policy, region_data_transfer, prohibited_content,
      attribution_requirement, approved_by, approved_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.provider,
    input.providerModel,
    input.capability,
    input.apiTermsVersion,
    input.modelCodeLicense,
    input.modelWeightLicense,
    input.commercialUse ? 1 : 0,
    input.outputOwnership,
    input.trainingOrRetentionPolicy,
    input.regionDataTransfer,
    input.prohibitedContent,
    input.attributionRequirement,
    input.approvedBy,
    input.approvedAt,
    input.expiresAt,
  );
  db.prepare(
    `INSERT INTO audit_events(
      audit_event_id, actor_type, actor_id, action, target_type, target_id, metadata_json, occurred_at
    ) VALUES (?, 'OPERATOR', ?, 'PROVIDER_LEGAL_APPROVED', 'PROVIDER_MODEL', ?, ?, ?)`,
  ).run(
    `audit_${randomUUID()}`,
    input.approvedBy,
    `${input.provider}:${input.providerModel}:${input.capability}`,
    JSON.stringify({ api_terms_version: input.apiTermsVersion, expires_at: input.expiresAt }),
    input.approvedAt,
  );
}

function isApproved(
  db: Database.Database,
  adapter: ProviderAdapter,
  capability: ProviderCapabilityV1,
  now: string,
): boolean {
  const row = db
    .prepare(
      `SELECT commercial_use, output_ownership, approved_by, expires_at
       FROM legal_allowlist
       WHERE provider = ? AND provider_model = ? AND capability = ?`,
    )
    .get(adapter.alias, adapter.providerModel, capability) as
    | {
        commercial_use: number;
        output_ownership: string;
        approved_by: string;
        expires_at: string;
      }
    | undefined;
  return Boolean(
    row &&
    row.commercial_use === 1 &&
    row.output_ownership.length > 0 &&
    row.approved_by.length > 0 &&
    row.expires_at > now,
  );
}

export function routeProvider(input: {
  db: Database.Database;
  request: ProviderRequestV1;
  routes: readonly ProviderRouteConfig[];
  adapters: ReadonlyMap<string, ProviderAdapter>;
  now: string;
  deploymentRegion?: string;
  unavailableProviders?: ReadonlySet<string>;
}): RoutedProvider {
  const route = input.routes.find(
    (candidate) =>
      candidate.capability === input.request.capability &&
      candidate.modelAlias === input.request.model_alias &&
      candidate.qualityTier === input.request.quality_tier,
  );
  if (!route) throw new GatewayStoreError('UNSUPPORTED_MODEL', 'model alias is not allowlisted');
  if (route.enabled === false) {
    throw new GatewayStoreError('PROVIDER_UNAVAILABLE', 'provider route is disabled');
  }
  if (
    route.regions &&
    !route.regions.includes(input.deploymentRegion ?? 'global') &&
    !route.regions.includes('global')
  ) {
    throw new GatewayStoreError(
      'REGION_NOT_ALLOWED',
      'provider route is unavailable in this region',
    );
  }
  const configuredPrimary = input.adapters.get(route.primary);
  const configuredFallback = route.fallback ? input.adapters.get(route.fallback) : undefined;
  const primaryIsUnavailable = input.unavailableProviders?.has(route.primary) ?? false;
  const primary = primaryIsUnavailable ? configuredFallback : configuredPrimary;
  const fallback = primaryIsUnavailable ? undefined : configuredFallback;
  if (!primary || !primary.capabilities.includes(input.request.capability)) {
    throw new GatewayStoreError('PROVIDER_UNAVAILABLE', 'approved provider is unavailable');
  }
  if (!isApproved(input.db, primary, input.request.capability, input.now)) {
    throw new GatewayStoreError('PROVIDER_LEGAL_BLOCKED', 'provider legal approval is missing');
  }
  if (
    configuredFallback &&
    !isApproved(input.db, configuredFallback, input.request.capability, input.now)
  ) {
    throw new GatewayStoreError('PROVIDER_LEGAL_BLOCKED', 'fallback legal approval is missing');
  }
  const primaryEstimate = primary.estimate(input.request);
  const fallbackEstimate = fallback?.estimate(input.request);
  if (
    primaryEstimate.currency !== input.request.max_cost.currency ||
    (fallbackEstimate && fallbackEstimate.currency !== input.request.max_cost.currency)
  ) {
    throw new GatewayStoreError('CURRENCY_MISMATCH', 'provider price currency does not match');
  }
  return {
    primary,
    ...(fallback ? { fallback } : {}),
    primaryEstimate,
    reservationAmount: Math.max(
      primaryEstimate.maximumAmount,
      fallbackEstimate?.maximumAmount ?? 0,
    ),
  };
}
