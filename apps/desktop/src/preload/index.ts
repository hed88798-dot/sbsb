import { contextBridge, ipcRenderer } from 'electron';
import { z } from 'zod';
import {
  IPC_CHANNELS,
  copywritingGenerateRequestV1Schema,
  copywritingResultV1Schema,
  jobDtoV1Schema,
  productAssetAddRequestV1Schema,
  productCreateRequestV1Schema,
  productDeleteRequestV1Schema,
  productDtoV1Schema,
  productUpdateRequestV1Schema,
  renderCancelResultV1Schema,
  renderJobDtoV1Schema,
  renderJobRequestV1Schema,
  renderPrepareFromTimelineRequestV1Schema,
  renderPrepareRequestV1Schema,
  renderTimelineSourceDtoV1Schema,
  type DesktopApiV1,
} from '@app/contracts';

async function invoke<T>(channel: string, input: unknown, output: z.ZodType<T>): Promise<T> {
  return output.parse(await ipcRenderer.invoke(channel, input));
}

const api: DesktopApiV1 = {
  products: {
    list: () => invoke(IPC_CHANNELS.productsList, undefined, z.array(productDtoV1Schema)),
    get: (productId) =>
      invoke(
        IPC_CHANNELS.productsGet,
        { schema_version: '1.0', id: productId },
        productDtoV1Schema.nullable(),
      ),
    create: (request) =>
      invoke(
        IPC_CHANNELS.productsCreate,
        productCreateRequestV1Schema.parse(request),
        productDtoV1Schema,
      ),
    update: (request) =>
      invoke(
        IPC_CHANNELS.productsUpdate,
        productUpdateRequestV1Schema.parse(request),
        productDtoV1Schema,
      ),
    delete: async (request) => {
      await invoke(
        IPC_CHANNELS.productsDelete,
        productDeleteRequestV1Schema.parse(request),
        z.null(),
      );
    },
    addAssets: (request) =>
      invoke(
        IPC_CHANNELS.productsAddAssets,
        productAssetAddRequestV1Schema.parse(request),
        productDtoV1Schema,
      ),
    chooseImages: () => invoke(IPC_CHANNELS.dialogsChooseImages, undefined, z.array(z.string())),
  },
  copywriting: {
    generate: (request) =>
      invoke(
        IPC_CHANNELS.copywritingGenerate,
        copywritingGenerateRequestV1Schema.parse(request),
        jobDtoV1Schema,
      ),
    getResult: (jobId) =>
      invoke(
        IPC_CHANNELS.copywritingGetResult,
        { schema_version: '1.0', id: jobId },
        copywritingResultV1Schema.nullable(),
      ),
  },
  jobs: {
    list: () => invoke(IPC_CHANNELS.jobsList, undefined, z.array(jobDtoV1Schema)),
    cancel: (jobId) =>
      invoke(IPC_CHANNELS.jobsCancel, { schema_version: '1.0', id: jobId }, jobDtoV1Schema),
  },
  settings: {
    get: (key) =>
      invoke(IPC_CHANNELS.settingsGet, { schema_version: '1.0', key }, z.string().nullable()),
    set: async (key, value) => {
      await invoke(IPC_CHANNELS.settingsSet, { schema_version: '1.0', key, value }, z.null());
    },
  },
  render: {
    prepare: (request) =>
      invoke(
        IPC_CHANNELS.renderPrepare,
        renderPrepareRequestV1Schema.parse(request),
        renderJobDtoV1Schema,
      ),
    listTimelineSources: () =>
      invoke(
        IPC_CHANNELS.renderListTimelineSources,
        undefined,
        z.array(renderTimelineSourceDtoV1Schema),
      ),
    prepareFromTimeline: (request) =>
      invoke(
        IPC_CHANNELS.renderPrepareFromTimeline,
        renderPrepareFromTimelineRequestV1Schema.parse(request),
        renderJobDtoV1Schema,
      ),
    execute: (jobId) =>
      invoke(
        IPC_CHANNELS.renderExecute,
        renderJobRequestV1Schema.parse({ schema_version: '1.0', job_id: jobId }),
        renderJobDtoV1Schema,
      ),
    cancel: (jobId) =>
      invoke(
        IPC_CHANNELS.renderCancel,
        renderJobRequestV1Schema.parse({ schema_version: '1.0', job_id: jobId }),
        renderCancelResultV1Schema,
      ),
    get: (jobId) =>
      invoke(
        IPC_CHANNELS.renderGet,
        renderJobRequestV1Schema.parse({ schema_version: '1.0', job_id: jobId }),
        renderJobDtoV1Schema.nullable(),
      ),
  },
};

contextBridge.exposeInMainWorld('desktop', Object.freeze(api));
