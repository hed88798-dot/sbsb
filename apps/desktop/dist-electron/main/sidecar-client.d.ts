import { type SidecarEventV1, type SidecarRequestV1 } from '@app/contracts';
export declare function callMockSidecar(options: {
    pythonPath: string;
    scriptPath: string;
    request: SidecarRequestV1;
    timeoutMs?: number;
}): Promise<SidecarEventV1[]>;
