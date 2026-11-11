import { z } from 'zod';
import { candidateShotPlanV1Schema } from './shot-planning.js';
import { confirmedShotPlanV1Schema } from './timeline-planning.js';

const id = z.string().trim().min(1).max(256);
export const demoProposeSchema = z
  .object({
    text: z
      .string()
      .min(1)
      .max(8000)
      .refine((text) => text.trim().length > 0),
    route: z.enum(['ANIMAL', 'PRODUCT']),
  })
  .strict();
export const demoConfirmSchema = z
  .object({
    candidate_id: id,
    candidate_revision: z.number().int().positive(),
    source_document_id: id,
    source_document_version: z.number().int().positive(),
    source_document_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
export const demoGetSchema = z.object({ candidate_id: id }).strict();
export const demoStateSchema = z
  .object({
    mode: z.literal('OFFLINE_DETERMINISTIC'),
    stage: z.enum(['PROPOSED', 'CONFIRMED']),
    candidate: candidateShotPlanV1Schema,
    confirmed: confirmedShotPlanV1Schema.nullable(),
  })
  .strict();
export type DemoState = z.infer<typeof demoStateSchema>;
export interface DemoApi {
  propose(input: z.infer<typeof demoProposeSchema>): Promise<DemoState>;
  confirm(input: z.infer<typeof demoConfirmSchema>): Promise<DemoState>;
  get(input: z.infer<typeof demoGetSchema>): Promise<DemoState | null>;
}
