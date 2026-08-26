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
export const sidecarRequestV1Schema = z.object({
  type: z.literal('request'),
  protocol_version: z.literal(SIDECAR_PROTOCOL_VERSION_V1),
  request_id: z.string().min(1),
  method: z.enum(['hello', 'ping', 'echo', 'progress', 'cancel', 'error']),
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
