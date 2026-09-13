// 端到端：真实浏览器 -> nginx(web) -> FastAPI(api)，全程真实 HTTP 请求。
import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = (name) => path.resolve(__dirname, 'fixtures', name);

test.describe('三阶互调频率协调页面', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('可用频率方案明确显示 CLEAR', async ({ page }) => {
    await page.getByTestId('file-input').setInputFiles(fixtures('clear.json'));

    await expect(page.getByTestId('result-clear')).toBeVisible();
    await expect(page.getByTestId('result-conflict')).toHaveCount(0);
    await expect(page.getByText(/可用（CLEAR）/)).toBeVisible();
    await expect(page.getByTestId('result-clear').getByText(/已分析\s*3\s*个频道/)).toBeVisible();
    await expect(page.getByTestId('download-button')).toBeVisible();
  });

  test('冲突结果可从每条冲突追溯计算式、产物频率和三只频道', async ({ page }) => {
    await page.getByTestId('file-input').setInputFiles(fixtures('conflict.json'));

    await expect(page.getByTestId('result-conflict')).toBeVisible();
    await expect(page.getByText(/冲突（CONFLICT）/)).toBeVisible();
    await expect(page.getByTestId('conflict-count')).toHaveText('2');

    // 命中频道 #33 的那张卡片
    const card = page.getByTestId('conflict-item').filter({ hasText: '受影响频道 #33' });
    await expect(card).toBeVisible();
    await expect(card.getByTestId('conflict-formula')).toContainText(
      '2×500.000 MHz − 480.000 MHz = 520.000 MHz',
    );
    await expect(card).toContainText('互调产物频率：520.000 MHz');

    // 三只不同频道：来源 #11、#22 与受影响 #33
    const table = card.getByTestId('three-channels');
    await expect(table).toContainText('#11');
    await expect(table).toContainText('#22');
    await expect(table).toContainText('#33');
    await expect(table.locator('.row-source')).toHaveCount(2);
    await expect(table.locator('.row-victim')).toHaveCount(1);
  });

  test('下载按钮导出含输入与冲突明细的 JSON 文件', async ({ page }) => {
    await page.getByTestId('file-input').setInputFiles(fixtures('conflict.json'));
    await expect(page.getByTestId('result-conflict')).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('download-button').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^im3-report-.*\.json$/);

    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const report = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    expect(report.status).toBe('conflict');
    expect(report.input_channels).toHaveLength(3);
    expect(report.conflicts).toHaveLength(2);
    expect(report.conflicts[0]).toHaveProperty('formula');
    expect(report.conflicts[0]).toHaveProperty('product_khz');
  });

  test('422 时清除旧结论并逐项显示错误', async ({ page }) => {
    // 先得到冲突结论
    await page.getByTestId('file-input').setInputFiles(fixtures('conflict.json'));
    await expect(page.getByTestId('result-conflict')).toBeVisible();

    // 再上传非法批次：旧结论必须被清除
    await page.getByTestId('file-input').setInputFiles(fixtures('invalid.json'));
    await expect(page.getByTestId('form-error')).toBeVisible();
    await expect(page.getByTestId('result-conflict')).toHaveCount(0);
    await expect(page.getByTestId('result-clear')).toHaveCount(0);

    const items = page.getByTestId('error-item');
    await expect(items).toHaveCount(5);
    await expect(items.nth(0)).toContainText('第 1 项');
    await expect(items.nth(0)).toContainText('0.025 MHz 刻度');
    await expect(items.nth(1)).toContainText('编号 5 重复');
    await expect(items.nth(2)).toContainText('超出允许范围');
    await expect(items.nth(3)).toContainText('编号必须是整数');
    await expect(items.nth(4)).toContainText('缺少必填字段');
  });

  test('无效 JSON 文件整批 422', async ({ page }) => {
    await page.getByTestId('file-input').setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from('[{ not json'),
    });
    await expect(page.getByTestId('form-error')).toBeVisible();
    await expect(page.getByTestId('error-item').first()).toContainText('JSON 无法解析');
  });
});
