import { z } from 'zod';

export const SCHEMA_VERSION_V1 = '1.0' as const;
export const schemaVersionV1 = z.literal(SCHEMA_VERSION_V1);

export const appErrorV1Schema = z.object({
  schema_version: schemaVersionV1,
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
  request_id: z.string().optional(),
});
export type AppErrorV1 = z.infer<typeof appErrorV1Schema>;

export const productAssetRoleSchema = z.enum(['MAIN', 'PACKAGING', 'DETAIL', 'OTHER']);
export const productAssetV1Schema = z.object({
  schema_version: schemaVersionV1,
  asset_id: z.string().min(1),
  product_id: z.string().min(1),
  path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  media_type: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  role: productAssetRoleSchema,
  created_at: z.string().datetime(),
});
export type ProductAssetV1 = z.infer<typeof productAssetV1Schema>;

export const productDataV1Schema = z.object({
  name: z.string().trim().min(1).max(200),
  aliases: z.array(z.string().trim().min(1)).default([]),
  category: z.string().trim().max(200).default(''),
  target_object: z.string().trim().max(500).default(''),
  ingredients: z.string().trim().max(4000).default(''),
  specification: z.string().trim().max(1000).default(''),
  approved_scope: z.string().trim().max(4000).default(''),
  usage: z.string().trim().max(4000).default(''),
  contraindications: z.array(z.string().trim().min(1)).default([]),
  selling_points: z.array(z.string().trim().min(1)).default([]),
  description: z.string().trim().max(8000).default(''),
  marketing_focus: z.string().trim().max(4000).default(''),
  forbidden_claims: z.array(z.string().trim().min(1)).default([]),
  notes: z.string().trim().max(4000).default(''),
  industry_metadata: z.record(z.string(), z.unknown()).default({}),
});
export type ProductDataV1 = z.infer<typeof productDataV1Schema>;

export const productDtoV1Schema = productDataV1Schema.extend({
  schema_version: schemaVersionV1,
  product_id: z.string().min(1),
  assets: z.array(productAssetV1Schema),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type ProductDTOv1 = z.infer<typeof productDtoV1Schema>;

export const productCreateRequestV1Schema = z.object({
  schema_version: schemaVersionV1,
  data: productDataV1Schema,
});
export type ProductCreateRequestV1 = z.infer<typeof productCreateRequestV1Schema>;

export const productUpdateRequestV1Schema = z.object({
  schema_version: schemaVersionV1,
  product_id: z.string().min(1),
  data: productDataV1Schema,
});
export type ProductUpdateRequestV1 = z.infer<typeof productUpdateRequestV1Schema>;

export const productDeleteRequestV1Schema = z.object({
  schema_version: schemaVersionV1,
  product_id: z.string().min(1),
});
export type ProductDeleteRequestV1 = z.infer<typeof productDeleteRequestV1Schema>;

export const productFactSnapshotV1Schema = z.object({
  schema_version: schemaVersionV1,
  product_id: z.string().min(1),
  name: z.string().min(1),
  aliases: z.array(z.string()),
  ingredients: z.string(),
  specification: z.string(),
  target_object: z.string(),
  approved_scope: z.string(),
  usage: z.string(),
  contraindications: z.array(z.string()),
  forbidden_claims: z.array(z.string()),
  snapshot_hash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ProductFactSnapshotV1 = z.infer<typeof productFactSnapshotV1Schema>;

export const copywritingModeSchema = z.enum(['CREATE', 'PRODUCT', 'OPTIMIZE', 'DEDUPE']);
export const optimizeOperationSchema = z.enum([
  'STRUCTURE',
  'OPENING',
  'COMPRESS',
  'EXPAND',
  'COLLOQUIAL',
]);
export const dedupeLevelSchema = z.enum(['LIGHT', 'MEDIUM', 'DEEP']);
export const copywritingGenerateRequestV1Schema = z
  .object({
    schema_version: schemaVersionV1,
    request_id: z.string().min(1),
    mode: copywritingModeSchema,
    product_id: z.string().min(1).optional(),
    direction: z.string().trim().max(1000).default(''),
    target_duration_seconds: z.number().int().min(5).max(600).default(30),
    style: z.string().trim().max(200).default('专业清晰'),
    colloquial_level: z.number().int().min(0).max(3).default(1),
    requirements: z.string().trim().max(4000).default(''),
    source_text: z.string().trim().max(20000).optional(),
    optimize_operation: optimizeOperationSchema.optional(),
    dedupe_level: dedupeLevelSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.mode === 'PRODUCT' && !value.product_id) {
      context.addIssue({ code: 'custom', message: '产品文案必须选择产品', path: ['product_id'] });
    }
    if ((value.mode === 'OPTIMIZE' || value.mode === 'DEDUPE') && !value.source_text) {
      context.addIssue({
        code: 'custom',
        message: '优化或去重必须提供原文',
        path: ['source_text'],
      });
    }
    if (value.mode === 'OPTIMIZE' && !value.optimize_operation) {
      context.addIssue({
        code: 'custom',
        message: '优化必须选择操作',
        path: ['optimize_operation'],
      });
    }
    if (value.mode === 'DEDUPE' && !value.dedupe_level) {
      context.addIssue({ code: 'custom', message: '去重必须选择强度', path: ['dedupe_level'] });
    }
  });
export type CopywritingGenerateRequestV1 = z.infer<typeof copywritingGenerateRequestV1Schema>;

export const factConflictV1Schema = z.object({
  field: z.enum([
    'name',
    'ingredients',
    'specification',
    'target_object',
    'approved_scope',
    'usage',
    'contraindications',
    'forbidden_claims',
  ]),
  expected: z.string(),
  evidence: z.string(),
  message: z.string(),
});
export type FactConflictV1 = z.infer<typeof factConflictV1Schema>;

export const copywritingResultV1Schema = z.object({
  schema_version: schemaVersionV1,
  job_id: z.string().min(1),
  script_id: z.string().min(1),
  result_status: z.enum(['SUCCEEDED', 'REVIEW_REQUIRED']),
  text: z.string(),
  raw_model_output: z.string(),
  fact_snapshot: productFactSnapshotV1Schema.nullable(),
  fact_conflicts: z.array(factConflictV1Schema),
  prompt_template_id: z.string().min(1),
  prompt_template_version: z.string().min(1),
  provider_alias: z.string().min(1),
  provider_model: z.string().min(1),
  request_snapshot_hash: z.string().regex(/^[a-f0-9]{64}$/),
  created_at: z.string().datetime(),
});
export type CopywritingResultV1 = z.infer<typeof copywritingResultV1Schema>;

export const jobStateV1Schema = z.enum([
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'INTERRUPTED',
]);
export const jobDtoV1Schema = z.object({
  schema_version: schemaVersionV1,
  job_id: z.string().min(1),
  job_type: z.string().min(1),
  state: jobStateV1Schema,
  progress: z.number().min(0).max(1),
  created_at: z.string().datetime(),
  started_at: z.string().datetime().nullable(),
  finished_at: z.string().datetime().nullable(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  request_snapshot_hash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type JobDTOv1 = z.infer<typeof jobDtoV1Schema>;

export const idRequestV1Schema = z.object({
  schema_version: schemaVersionV1,
  id: z.string().min(1),
});

export const productAssetAddRequestV1Schema = z.object({
  schema_version: schemaVersionV1,
  product_id: z.string().min(1),
  paths: z.array(z.string().min(1)).min(1),
  role: productAssetRoleSchema,
});
export type ProductAssetAddRequestV1 = z.infer<typeof productAssetAddRequestV1Schema>;

export const IPC_CHANNELS = {
  productsList: 'products:list',
  productsGet: 'products:get',
  productsCreate: 'products:create',
  productsUpdate: 'products:update',
  productsDelete: 'products:delete',
  productsAddAssets: 'products:add-assets',
  dialogsChooseImages: 'dialogs:choose-images',
  copywritingGenerate: 'copywriting:generate',
  copywritingGetResult: 'copywriting:get-result',
  jobsList: 'jobs:list',
  jobsCancel: 'jobs:cancel',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
} as const;

export const IPC_CHANNEL_ALLOWLIST = Object.freeze(Object.values(IPC_CHANNELS));

export interface DesktopApiV1 {
  products: {
    list(): Promise<ProductDTOv1[]>;
    get(productId: string): Promise<ProductDTOv1 | null>;
    create(request: ProductCreateRequestV1): Promise<ProductDTOv1>;
    update(request: ProductUpdateRequestV1): Promise<ProductDTOv1>;
    delete(request: ProductDeleteRequestV1): Promise<void>;
    addAssets(request: ProductAssetAddRequestV1): Promise<ProductDTOv1>;
    chooseImages(): Promise<string[]>;
  };
  copywriting: {
    generate(request: CopywritingGenerateRequestV1): Promise<JobDTOv1>;
    getResult(jobId: string): Promise<CopywritingResultV1 | null>;
  };
  jobs: {
    list(): Promise<JobDTOv1[]>;
    cancel(jobId: string): Promise<JobDTOv1>;
  };
  settings: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
  };
}

export const SIDECAR_PROTOCOL_VERSION_V1 = '1.0' as const;
export const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
export const mediaWorkerMethodV1Schema = z.enum([
  'hello',
  'ping',
  'echo',
  'progress',
  'cancel',
  'error',
  'media.index.asset.v1',
  'media.search.exact.v1',
]);
export const sidecarRequestV1Schema = z.object({
  type: z.literal('request'),
  protocol_version: z.literal(SIDECAR_PROTOCOL_VERSION_V1),
  request_id: z.string().min(1),
  method: mediaWorkerMethodV1Schema,
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type SidecarRequestV1 = z.infer<typeof sidecarRequestV1Schema>;

export const sidecarEventV1Schema = z.object({
  type: z.enum(['hello', 'accepted', 'progress', 'result', 'error', 'cancelled']),
  protocol_version: z.literal(SIDECAR_PROTOCOL_VERSION_V1),
  request_id: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
  error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }).optional(),
});
export type SidecarEventV1 = z.infer<typeof sidecarEventV1Schema>;

export const MEDIA_INDEX_SCHEMA_VERSION_V1 = '1.0' as const;
export const INDEX_SIGNATURE_VERSION_V1 = '1.0' as const;
export const KEYFRAME_POLICY_VERSION_V1 = 'safe-mid-best-v1' as const;

const sha256Schema = z.string().regex(SHA256_PATTERN);
const unknownableStringArraySchema = z.union([
  z.literal('unknown'),
  z.array(z.string().min(1)).min(1),
]);
const unknownableStringSchema = z.union([z.literal('unknown'), z.string().min(1)]);

export const mediaQualityV1Schema = z.object({
  score: z.number().min(0).max(1),
  blur: z.number().min(0).max(1),
  dark: z.number().min(0).max(1),
  overexposed: z.number().min(0).max(1),
});
export type MediaQualityV1 = z.infer<typeof mediaQualityV1Schema>;

export const visualEvidenceV1Schema = z.object({
  value: z.union([z.string(), z.array(z.string()), z.boolean(), z.null()]),
  confidence: z.number().min(0).max(1),
  provenance: z.string().min(1),
  temporal_evidence: z.enum(['SUFFICIENT', 'INSUFFICIENT', 'NOT_REQUIRED']),
});

export const visualDescriptorV1Schema = z.object({
  schema_version: z.literal(MEDIA_INDEX_SCHEMA_VERSION_V1),
  shot_id: z.string().min(1),
  species: unknownableStringArraySchema,
  scene: unknownableStringSchema,
  action: unknownableStringArraySchema,
  health_state: unknownableStringSchema,
  people_present: z.boolean().nullable(),
  product_present: z.boolean().nullable(),
  shot_type: unknownableStringSchema,
  description: z.string(),
  quality: mediaQualityV1Schema,
  embedding_ref: z.string().min(1),
  industry_metadata: z.record(z.string(), z.unknown()),
  confidence: z.record(z.string(), z.number().min(0).max(1)),
  provenance: z.record(z.string(), z.unknown()),
  evidence: z.record(z.string(), visualEvidenceV1Schema),
});
export type VisualDescriptorV1 = z.infer<typeof visualDescriptorV1Schema>;

export const indexSignatureInputV1Schema = z.object({
  index_schema_version: z.literal(MEDIA_INDEX_SCHEMA_VERSION_V1),
  index_signature_version: z.literal(INDEX_SIGNATURE_VERSION_V1),
  embedding_model: z.string().min(1),
  embedding_model_version: z.string().min(1),
  embedding_preprocess_version: z.string().min(1),
  vlm_model: z.string().min(1).nullable(),
  vlm_model_version: z.string().min(1).nullable(),
  vlm_prompt_version: z.string().min(1).nullable(),
  shot_detector: z.string().min(1),
  shot_detector_version: z.string().min(1),
  shot_detector_params_hash: sha256Schema,
  keyframe_policy_version: z.string().min(1),
  file_hash: sha256Schema,
});
export type IndexSignatureInputV1 = z.infer<typeof indexSignatureInputV1Schema>;

export const keyframeArtifactV1Schema = z.object({
  keyframe_id: z.string().min(1),
  role: z.enum(['SAFE_EARLY', 'MIDPOINT', 'BEST_QUALITY']),
  timestamp_ms: z.number().int().nonnegative(),
  relative_path: z.string().min(1),
  sha256: sha256Schema,
  quality: mediaQualityV1Schema,
});

export const embeddingArtifactV1Schema = z.object({
  embedding_id: z.string().min(1),
  model_id: z.literal('google/siglip2-base-patch32-256'),
  model_version: z.string().min(1),
  preprocess_version: z.string().min(1),
  dimension: z.number().int().positive(),
  dtype: z.literal('float16'),
  normalized: z.literal(true),
  relative_path: z.string().min(1),
  sha256: sha256Schema,
});

export const shotManifestV1Schema = z
  .object({
    shot_id: z.string().min(1),
    start_ms: z.number().int().nonnegative(),
    end_ms: z.number().int().positive(),
    keyframes: z.array(keyframeArtifactV1Schema).min(1).max(3),
    quality: mediaQualityV1Schema,
    descriptor: visualDescriptorV1Schema,
    embedding: embeddingArtifactV1Schema,
  })
  .refine((value) => value.start_ms < value.end_ms, {
    message: 'shot start_ms must be before end_ms',
  });
export type ShotManifestV1 = z.infer<typeof shotManifestV1Schema>;

export const assetRevisionManifestV1Schema = z.object({
  schema_version: z.literal(MEDIA_INDEX_SCHEMA_VERSION_V1),
  asset_id: z.string().min(1),
  revision: z.number().int().positive(),
  source_path: z.string().min(1),
  file_hash: sha256Schema,
  size_bytes: z.number().int().nonnegative(),
  mtime_ns: z.string().regex(/^\d+$/u),
  duration_ms: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  rotation: z.number().int(),
  fps: z.number().positive(),
  index_signature: indexSignatureInputV1Schema,
  index_signature_hash: sha256Schema,
  generation_key_hash: sha256Schema,
  artifact_root: z.string().min(1),
  shots: z.array(shotManifestV1Schema).min(1),
  worker_version: z.string().min(1),
  created_at: z.string().datetime(),
});
export type AssetRevisionManifestV1 = z.infer<typeof assetRevisionManifestV1Schema>;

export const mediaArtifactResultV1Schema = z.object({
  manifest_path: z.string().min(1),
  manifest_sha256: sha256Schema,
  index_signature_hash: sha256Schema,
});
export type MediaArtifactResultV1 = z.infer<typeof mediaArtifactResultV1Schema>;

export const shotSearchFiltersV1Schema = z.object({
  species: z.array(z.string().min(1)).optional(),
  scene: z.array(z.string().min(1)).optional(),
  people_present: z.boolean().optional(),
  product_present: z.boolean().optional(),
  minimum_quality: z.number().min(0).max(1).optional(),
  minimum_duration_ms: z.number().int().positive().optional(),
  maximum_duration_ms: z.number().int().positive().optional(),
});
export type ShotSearchFiltersV1 = z.infer<typeof shotSearchFiltersV1Schema>;
export const shotSearchRequestV1Schema = z.object({
  schema_version: z.literal(MEDIA_INDEX_SCHEMA_VERSION_V1),
  query_text: z.string().trim().min(1).max(2000),
  filters: shotSearchFiltersV1Schema.default({}),
  top_k: z.number().int().min(1).max(200),
  index_signature_hash: sha256Schema,
});
export type ShotSearchRequestV1 = z.infer<typeof shotSearchRequestV1Schema>;

export const shotSearchCandidateV1Schema = z.object({
  schema_version: z.literal(MEDIA_INDEX_SCHEMA_VERSION_V1),
  asset_id: z.string().min(1),
  shot_id: z.string().min(1),
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().positive(),
  revision: z.number().int().positive(),
  semantic_score: z.number(),
  descriptor: visualDescriptorV1Schema,
});
export type ShotSearchCandidateV1 = z.infer<typeof shotSearchCandidateV1Schema>;

export const mediaIndexStageV1Schema = z.enum([
  'INVENTORY',
  'HASH',
  'PROBE',
  'SHOT_DETECTION',
  'KEYFRAMES',
  'QUALITY',
  'EMBEDDING',
  'DESCRIPTOR',
  'MANIFEST',
  'COMMIT',
  'CACHE',
]);
export const mediaIndexJobV1Schema = z.object({
  schema_version: z.literal(MEDIA_INDEX_SCHEMA_VERSION_V1),
  job_id: z.string().min(1),
  source_folder_id: z.string().min(1).nullable(),
  profile: z.enum(['POWER_SAVER', 'BALANCED', 'FAST']),
  checkpoint: z.record(z.string(), z.unknown()),
  created_at: z.string().datetime(),
});
export type MediaIndexJobV1 = z.infer<typeof mediaIndexJobV1Schema>;

export const mediaIndexJobStepV1Schema = z.object({
  schema_version: z.literal(MEDIA_INDEX_SCHEMA_VERSION_V1),
  job_id: z.string().min(1),
  asset_id: z.string().min(1),
  revision: z.number().int().positive(),
  stage: mediaIndexStageV1Schema,
  state: jobStateV1Schema,
  checkpoint: z.record(z.string(), z.unknown()),
  error_code: z.string().min(1).nullable(),
  updated_at: z.string().datetime(),
});
export type MediaIndexJobStepV1 = z.infer<typeof mediaIndexJobStepV1Schema>;

export const textGatewayRequestV1Schema = z.object({
  schema_version: schemaVersionV1,
  request_id: z.string().min(1),
  capability: z.literal('text.generate.v1'),
  model_alias: z.string().min(1),
  prompt: z.string().min(1),
  request_snapshot_hash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type TextGatewayRequestV1 = z.infer<typeof textGatewayRequestV1Schema>;

export const textGatewayResultV1Schema = z.object({
  schema_version: schemaVersionV1,
  request_id: z.string().min(1),
  text: z.string(),
  provider_alias: z.string().min(1),
  provider_model: z.string().min(1),
  latency_ms: z.number().int().nonnegative(),
  billed_units: z.number().nonnegative(),
  request_snapshot_hash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type TextGatewayResultV1 = z.infer<typeof textGatewayResultV1Schema>;

export const PROVIDER_PROTOCOL_VERSION_V1 = '1.0' as const;

export const providerCapabilityV1Schema = z.enum([
  'text.generate.v1',
  'image.generate.v1',
  'image.edit.v1',
  'video.generate.v1',
  'tts.synthesize.v1',
  'voice.clone.v1',
  'lipsync.generate.v1',
]);
export type ProviderCapabilityV1 = z.infer<typeof providerCapabilityV1Schema>;

export const providerJobStateV1Schema = z.enum([
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'UNKNOWN',
]);
export type ProviderJobStateV1 = z.infer<typeof providerJobStateV1Schema>;

export const qualityTierV1Schema = z.enum(['standard', 'premium']);
export const currencyV1Schema = z.enum(['CNY', 'USD']);
export const sha256V1Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const requestIdV1Schema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
export const objectRefV1Schema = z.string().regex(/^obj_[A-Za-z0-9_-]{24,128}$/);

export const providerInputRefV1Schema = z
  .object({
    role: z.enum(['image', 'video', 'audio', 'voice_sample']),
    object_ref: objectRefV1Schema,
    sha256: sha256V1Schema,
  })
  .strict();
export type ProviderInputRefV1 = z.infer<typeof providerInputRefV1Schema>;

const providerRequestBase = {
  schema_version: schemaVersionV1,
  request_id: requestIdV1Schema,
  model_alias: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
  quality_tier: qualityTierV1Schema,
  request_snapshot_hash: sha256V1Schema,
  max_cost: z
    .object({ amount: z.number().nonnegative().max(10_000), currency: currencyV1Schema })
    .strict(),
};

export const textProviderRequestV1Schema = z
  .object({
    ...providerRequestBase,
    capability: z.literal('text.generate.v1'),
    inputs: z.tuple([]),
    parameters: z
      .object({
        prompt: z.string().min(1).max(40_000),
        max_tokens: z.number().int().min(1).max(8_192).default(2_048),
        temperature: z.number().min(0).max(2).default(0.7),
      })
      .strict(),
  })
  .strict();

export const imageProviderRequestV1Schema = z
  .object({
    ...providerRequestBase,
    capability: z.literal('image.generate.v1'),
    inputs: z.tuple([]),
    parameters: z
      .object({
        prompt: z.string().min(1).max(8_000),
        width: z.number().int().min(256).max(2_048),
        height: z.number().int().min(256).max(2_048),
        count: z.number().int().min(1).max(4).default(1),
        seed: z.number().int().nonnegative().max(2_147_483_647).optional(),
      })
      .strict(),
  })
  .strict();

export const imageEditProviderRequestV1Schema = z
  .object({
    ...providerRequestBase,
    capability: z.literal('image.edit.v1'),
    inputs: z.array(providerInputRefV1Schema).min(1).max(4),
    parameters: z
      .object({
        prompt: z.string().min(1).max(8_000),
        width: z.number().int().min(256).max(2_048),
        height: z.number().int().min(256).max(2_048),
        strength: z.number().min(0).max(1).default(0.75),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.inputs.some((input) => input.role !== 'image')) {
      context.addIssue({ code: 'custom', message: 'image.edit.v1 only accepts image inputs' });
    }
  });

export const videoProviderRequestV1Schema = z
  .object({
    ...providerRequestBase,
    capability: z.literal('video.generate.v1'),
    inputs: z.array(providerInputRefV1Schema).max(1),
    parameters: z
      .object({
        prompt: z.string().min(1).max(8_000),
        duration_seconds: z.number().int().min(1).max(20),
        aspect_ratio: z.enum(['9:16', '16:9', '1:1']),
        seed: z.number().int().nonnegative().max(2_147_483_647).optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.inputs.some((input) => input.role !== 'image')) {
      context.addIssue({
        code: 'custom',
        message: 'video.generate.v1 only accepts an image input',
      });
    }
  });

export const ttsProviderRequestV1Schema = z
  .object({
    ...providerRequestBase,
    capability: z.literal('tts.synthesize.v1'),
    inputs: z.tuple([]),
    parameters: z
      .object({
        text: z.string().min(1).max(20_000),
        voice_alias: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
        format: z.enum(['mp3', 'wav']),
      })
      .strict(),
  })
  .strict();

export const voiceCloneProviderRequestV1Schema = z
  .object({
    ...providerRequestBase,
    capability: z.literal('voice.clone.v1'),
    inputs: z.array(providerInputRefV1Schema).length(1),
    parameters: z
      .object({
        display_name: z.string().trim().min(1).max(100),
        consent_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.inputs[0]?.role !== 'voice_sample') {
      context.addIssue({ code: 'custom', message: 'voice.clone.v1 requires one voice sample' });
    }
  });

export const lipSyncProviderRequestV1Schema = z
  .object({
    ...providerRequestBase,
    capability: z.literal('lipsync.generate.v1'),
    inputs: z.array(providerInputRefV1Schema).length(2),
    parameters: z
      .object({
        consent_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const roles = new Set(value.inputs.map((input) => input.role));
    if (!roles.has('video') || !roles.has('audio')) {
      context.addIssue({ code: 'custom', message: 'lipsync.generate.v1 requires video and audio' });
    }
  });

export const providerRequestV1Schema = z.union([
  textProviderRequestV1Schema,
  imageProviderRequestV1Schema,
  imageEditProviderRequestV1Schema,
  videoProviderRequestV1Schema,
  ttsProviderRequestV1Schema,
  voiceCloneProviderRequestV1Schema,
  lipSyncProviderRequestV1Schema,
]);
export type ProviderRequestV1 = z.infer<typeof providerRequestV1Schema>;

export const providerArtifactV1Schema = z
  .object({
    object_ref: objectRefV1Schema,
    mime_type: z.enum(['image/png', 'image/jpeg', 'video/mp4', 'audio/mpeg', 'audio/wav']),
    sha256: sha256V1Schema,
    size_bytes: z.number().int().nonnegative(),
    expires_at: z.string().datetime(),
  })
  .strict();
export type ProviderArtifactV1 = z.infer<typeof providerArtifactV1Schema>;

export const providerJobV1Schema = z
  .object({
    schema_version: schemaVersionV1,
    protocol_version: z.literal(PROVIDER_PROTOCOL_VERSION_V1),
    job_id: z.string().min(1),
    request_id: requestIdV1Schema,
    capability: providerCapabilityV1Schema,
    model_alias: z.string().min(1),
    state: providerJobStateV1Schema,
    estimated_cost: z.number().nonnegative(),
    final_cost: z.number().nonnegative().nullable(),
    currency: currencyV1Schema,
    artifacts: z.array(providerArtifactV1Schema),
    error: z
      .object({ code: z.string().min(1), message: z.string().min(1), retryable: z.boolean() })
      .strict()
      .nullable(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict();
export type ProviderJobV1 = z.infer<typeof providerJobV1Schema>;
