import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const executablePath = argument('--executable');
const mode = argument('--mode');
const productName = argument('--product');
const screenshotDirectory = resolve(
  argument('--screenshots') ?? 'artifacts/windows-e2e/screenshots',
);
if (!executablePath || !productName || !['create', 'verify'].includes(mode)) {
  console.error(
    'desktop-ui-smoke: FAIL\nusage: --executable <installed exe> --mode <create|verify> --product <synthetic name>',
  );
  process.exit(1);
}

mkdirSync(screenshotDirectory, { recursive: true });
let application;
try {
  application = await electron.launch({ executablePath, timeout: 30_000 });
  const page = await application.firstWindow({ timeout: 30_000 });
  await page.getByText('企业内容工作台', { exact: false }).waitFor();
  await page.getByText('产品库', { exact: true }).click();

  if (mode === 'create') {
    await page.getByRole('button', { name: '新增产品' }).click();
    await page.getByLabel('产品名称').fill(productName);
    await page.getByLabel('适用对象').fill('猪');
    await page.getByLabel('规格').fill('100g/袋');
    await page.getByLabel('批准 / 事实范围').fill('仅用于 Code F 合成验收');
    await page.getByLabel('用法用量').fill('每次10g');
    await page.getByRole('button', { name: '保存' }).click();
    await page.getByText(productName, { exact: true }).first().waitFor();

    await page.getByText('AI 文案', { exact: true }).click();
    await page.getByRole('tab', { name: '产品文案' }).click();
    await page.getByLabel('产品').click();
    await page.getByText(productName, { exact: true }).last().click();
    await page.getByRole('button', { name: '创建文案任务' }).click();
    await page.locator('.fact-result').waitFor({ timeout: 30_000 });
    const result = await page.locator('.fact-result').innerText();
    if (!result.includes(productName) || !result.includes('100g/袋')) {
      throw new Error('copywriting result did not retain the locked product name/specification');
    }
  } else {
    await page.getByText(productName, { exact: true }).first().waitFor({ timeout: 15_000 });
    await page.getByText('任务记录', { exact: true }).click();
    await page.getByText('COPYWRITING', { exact: true }).first().waitFor({ timeout: 15_000 });
    await page.getByText('SUCCEEDED', { exact: true }).first().waitFor({ timeout: 15_000 });
  }

  await page.screenshot({
    path: resolve(screenshotDirectory, `${mode}-${Date.now()}.png`),
    fullPage: true,
  });
  console.log(`desktop-ui-smoke: PASS (${mode})`);
} catch (error) {
  console.error(`desktop-ui-smoke: FAIL\n${error.stack ?? error.message}`);
  process.exitCode = 1;
} finally {
  if (application) await application.close().catch(() => undefined);
}
