import {
  copywritingGenerateRequestV1Schema,
  textGatewayRequestV1Schema,
  type CopywritingGenerateRequestV1,
  type CopywritingResultV1,
  type JobDTOv1,
} from '@app/contracts';
import { buildCopywritingPrompt, checkProductFacts } from '@app/domain-copywriting';
import { createProductFactSnapshot } from '@app/domain-product';
import type { CopywritingRepository, JobRepository, ProductRepository } from '@app/local-db';
import { isGatewayClientError } from '@app/provider-client';
import type { TextCapabilityClient } from '@app/provider-client';

export class CopywritingService {
  readonly #products: ProductRepository;
  readonly #jobs: JobRepository;
  readonly #copywriting: CopywritingRepository;
  readonly #client: TextCapabilityClient;
  readonly #controllers = new Map<string, AbortController>();
  readonly #active = new Set<Promise<void>>();

  constructor(options: {
    products: ProductRepository;
    jobs: JobRepository;
    copywriting: CopywritingRepository;
    client: TextCapabilityClient;
  }) {
    this.#products = options.products;
    this.#jobs = options.jobs;
    this.#copywriting = options.copywriting;
    this.#client = options.client;
  }

  enqueue(rawRequest: CopywritingGenerateRequestV1): JobDTOv1 {
    const request = copywritingGenerateRequestV1Schema.parse(rawRequest);
    const product = request.product_id ? this.#products.get(request.product_id) : null;
    if (request.product_id && !product) throw new Error('PRODUCT_NOT_FOUND');
    const factSnapshot = product ? createProductFactSnapshot(product) : null;
    const built = buildCopywritingPrompt(request, factSnapshot);
    const job = this.#jobs.create('COPYWRITING', built.requestHash);
    this.#copywriting.attachRequest(job.job_id, request, factSnapshot);
    const controller = new AbortController();
    this.#controllers.set(job.job_id, controller);
    queueMicrotask(() => {
      const work = this.#run({ jobId: job.job_id, request, factSnapshot, built, controller });
      this.#active.add(work);
      void work.finally(() => this.#active.delete(work));
    });
    return job;
  }

  cancel(jobId: string): JobDTOv1 {
    this.#controllers.get(jobId)?.abort();
    return this.#jobs.cancel(jobId);
  }

  getResult(jobId: string): CopywritingResultV1 | null {
    return this.#copywriting.getResult(jobId);
  }

  async shutdown(): Promise<void> {
    for (const controller of this.#controllers.values()) controller.abort();
    await Promise.allSettled([...this.#active]);
  }

  async #run(input: {
    jobId: string;
    request: CopywritingGenerateRequestV1;
    factSnapshot: ReturnType<typeof createProductFactSnapshot> | null;
    built: ReturnType<typeof buildCopywritingPrompt>;
    controller: AbortController;
  }): Promise<void> {
    try {
      if (this.#jobs.require(input.jobId).state !== 'QUEUED') return;
      this.#jobs.start(input.jobId);
      const textResult = await this.#client.generate(
        textGatewayRequestV1Schema.parse({
          schema_version: '1.0',
          request_id: input.request.request_id,
          capability: 'text.generate.v1',
          model_alias: 'text.standard',
          prompt: input.built.prompt,
          request_snapshot_hash: input.built.requestHash,
        }),
        { signal: input.controller.signal },
      );
      if (this.#jobs.require(input.jobId).state === 'CANCELLED') return;
      const conflicts = input.factSnapshot
        ? checkProductFacts(input.factSnapshot, textResult.text)
        : [];
      this.#copywriting.complete({
        jobId: input.jobId,
        productId: input.request.product_id ?? null,
        textResult,
        factSnapshot: input.factSnapshot,
        conflicts,
        promptTemplateId: input.built.template.id,
        promptTemplateVersion: input.built.template.version,
        requestSnapshotHash: input.built.requestHash,
      });
    } catch (error) {
      if (this.#jobs.require(input.jobId).state === 'CANCELLED') return;
      if (isGatewayClientError(error) && error.code === 'CANCELLED') {
        this.#jobs.cancel(input.jobId);
      } else {
        const code = isGatewayClientError(error) ? error.code : 'COPYWRITING_FAILED';
        const message = isGatewayClientError(error)
          ? error.message
          : '文案任务执行失败，请检查后重试';
        this.#jobs.fail(input.jobId, code, message);
      }
    } finally {
      this.#controllers.delete(input.jobId);
    }
  }
}
