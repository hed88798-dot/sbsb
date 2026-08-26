import { type CopywritingGenerateRequestV1, type CopywritingResultV1, type JobDTOv1 } from '@app/contracts';
import type { CopywritingRepository, JobRepository, ProductRepository } from '@app/local-db';
import type { TextCapabilityClient } from '@app/provider-client';
export declare class CopywritingService {
    #private;
    constructor(options: {
        products: ProductRepository;
        jobs: JobRepository;
        copywriting: CopywritingRepository;
        client: TextCapabilityClient;
    });
    enqueue(rawRequest: CopywritingGenerateRequestV1): JobDTOv1;
    cancel(jobId: string): JobDTOv1;
    getResult(jobId: string): CopywritingResultV1 | null;
}
