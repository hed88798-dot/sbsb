import { dialog } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS, copywritingGenerateRequestV1Schema, idRequestV1Schema, productAssetAddRequestV1Schema, productCreateRequestV1Schema, productDeleteRequestV1Schema, productUpdateRequestV1Schema, } from '@app/contracts';
function assertTrustedSender(event, window) {
    if (event.sender.id !== window.webContents.id || event.senderFrame !== event.sender.mainFrame) {
        throw new Error('UNTRUSTED_IPC_SENDER');
    }
    const url = event.senderFrame.url;
    const trusted = url.startsWith('file://') || url.startsWith('http://127.0.0.1:5173/');
    if (!trusted)
        throw new Error('UNTRUSTED_IPC_ORIGIN');
}
export function registerIpc(options) {
    const handle = (channel, handler) => {
        options.ipcMain.handle(channel, async (event, input) => {
            assertTrustedSender(event, options.window);
            return handler(input);
        });
    };
    handle(IPC_CHANNELS.productsList, () => options.products.list());
    handle(IPC_CHANNELS.productsGet, (input) => {
        const request = idRequestV1Schema.parse(input);
        return options.products.get(request.id);
    });
    handle(IPC_CHANNELS.productsCreate, (input) => {
        const request = productCreateRequestV1Schema.parse(input);
        return options.products.create(request.data);
    });
    handle(IPC_CHANNELS.productsUpdate, (input) => {
        const request = productUpdateRequestV1Schema.parse(input);
        return options.products.update(request.product_id, request.data);
    });
    handle(IPC_CHANNELS.productsDelete, (input) => {
        const request = productDeleteRequestV1Schema.parse(input);
        if (!options.products.delete(request.product_id))
            throw new Error('PRODUCT_NOT_FOUND');
        return null;
    });
    handle(IPC_CHANNELS.dialogsChooseImages, async () => {
        const result = await dialog.showOpenDialog(options.window, {
            title: '选择企业本地产品图片',
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
        });
        return result.canceled ? [] : result.filePaths;
    });
    handle(IPC_CHANNELS.productsAddAssets, (input) => {
        const request = productAssetAddRequestV1Schema.parse(input);
        return options.products.addAssets(request.product_id, request.paths, request.role);
    });
    handle(IPC_CHANNELS.copywritingGenerate, (input) => options.copywriting.enqueue(copywritingGenerateRequestV1Schema.parse(input)));
    handle(IPC_CHANNELS.copywritingGetResult, (input) => {
        const request = idRequestV1Schema.parse(input);
        return options.copywriting.getResult(request.id);
    });
    handle(IPC_CHANNELS.jobsList, () => options.jobs.list());
    handle(IPC_CHANNELS.jobsCancel, (input) => {
        const request = idRequestV1Schema.parse(input);
        return options.copywriting.cancel(request.id);
    });
    const settingRequest = z.object({
        schema_version: z.literal('1.0'),
        key: z.literal('backend_url'),
    });
    handle(IPC_CHANNELS.settingsGet, (input) => {
        const request = settingRequest.parse(input);
        return options.settings.get(request.key);
    });
    handle(IPC_CHANNELS.settingsSet, (input) => {
        const request = settingRequest.extend({ value: z.string().url().max(2000) }).parse(input);
        options.settings.set(request.key, request.value);
        return null;
    });
}
//# sourceMappingURL=ipc.js.map