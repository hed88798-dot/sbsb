const redactedKeys = new Set([
  'authorization',
  'access_token',
  'api_key',
  'prompt',
  'text',
  'path',
  'url',
]);

export function logEvent(event: string, fields: Record<string, unknown> = {}): void {
  const safeFields = Object.fromEntries(
    Object.entries(fields).filter(([key]) => !redactedKeys.has(key.toLowerCase())),
  );
  console.info(JSON.stringify({ timestamp: new Date().toISOString(), event, ...safeFields }));
}
