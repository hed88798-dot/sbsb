import { join } from 'node:path';
import {
  MaterialSelectionRepository,
  MediaIndexRepository,
  NarrationAudioRepository,
  RenderExecutionRepository,
  RenderPolicyRepository,
  RenderPreparationRepository,
  TimelinePlanRepository,
} from '@app/local-db';
import type { JobRepository } from '@app/local-db';
import { RENDER_POLICY_V1 } from '@app/render';
import {
  resolveDesktopRenderRuntimeAuthority,
  type DesktopRenderRuntimeLocationInput,
} from './desktop-render-runtime-locator.js';
import { RenderExecutionFileService } from './render-execution-file-service.js';
import { RenderExecutionServiceV1 } from './render-execution-service.js';
import { DesktopRenderOrchestratorV1 } from './desktop-render-orchestrator.js';
import { RenderPreparationService } from './render-preparation-service.js';
import { NodeRenderProcessAdapterV1 } from './render-process-adapter.js';
import { RenderStagingService } from './render-staging-service.js';

type RuntimeAuthority = Awaited<ReturnType<typeof resolveDesktopRenderRuntimeAuthority>>;

export interface DesktopRenderCompositionV1 {
  orchestrator: DesktopRenderOrchestratorV1;
  available: boolean;
  staging_root: string;
  output_root: string;
}

type DesktopDatabaseV1 = ConstructorParameters<typeof JobRepository>[0];

export async function createDesktopRenderCompositionV1(options: {
  database: DesktopDatabaseV1;
  jobs: JobRepository;
  userDataPath: string;
  runtimeLocation: DesktopRenderRuntimeLocationInput;
  runtimeAuthorityResolver?: (
    input: DesktopRenderRuntimeLocationInput,
  ) => Promise<RuntimeAuthority>;
}): Promise<DesktopRenderCompositionV1> {
  const preparations = new RenderPreparationRepository(options.database);
  const executions = new RenderExecutionRepository(options.database);
  const stagingRoot = join(options.userDataPath, 'render', 'staging');
  const outputRoot = join(options.userDataPath, 'render', 'output');
  const runtimeAuthorityResolver =
    options.runtimeAuthorityResolver ?? resolveDesktopRenderRuntimeAuthority;

  let runtime: RuntimeAuthority;
  try {
    runtime = await runtimeAuthorityResolver(options.runtimeLocation);
  } catch {
    return {
      orchestrator: new DesktopRenderOrchestratorV1({
        jobs: options.jobs,
        preparations,
        executions,
        services: null,
      }),
      available: false,
      staging_root: stagingRoot,
      output_root: outputRoot,
    };
  }

  const policies = new RenderPolicyRepository(options.database);
  policies.register(RENDER_POLICY_V1);
  const staging = new RenderStagingService({ stagingRoot, outputRoot });
  const files = new RenderExecutionFileService({
    stagingRoot,
    outputRoot,
    runtimeRoot: runtime.runtime_root,
    runtimeManifestPath: runtime.manifest_path,
    approvalReceiptPath: runtime.approval_receipt_path,
  });
  const preparation = new RenderPreparationService({
    timelinePlans: new TimelinePlanRepository(options.database),
    materialSelections: new MaterialSelectionRepository(options.database),
    mediaIndex: new MediaIndexRepository(options.database),
    narrationAudio: new NarrationAudioRepository(options.database),
    renderPolicies: policies,
    preparations,
    staging,
    runtimeIdentity: runtime.identity,
  });
  const execution = new RenderExecutionServiceV1({
    preparations,
    policies,
    executions,
    files,
    processes: new NodeRenderProcessAdapterV1(),
  });
  return {
    orchestrator: new DesktopRenderOrchestratorV1({
      jobs: options.jobs,
      preparations,
      executions,
      services: { preparation, execution },
    }),
    available: true,
    staging_root: stagingRoot,
    output_root: outputRoot,
  };
}
