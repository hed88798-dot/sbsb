import { startMockGateway } from './index.js';

const gateway = await startMockGateway(Number(process.env.MOCK_GATEWAY_PORT ?? 4400));
console.log(JSON.stringify({ marker: 'NON_PRODUCTION', url: gateway.url }));
