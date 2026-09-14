// 端到端：频道角色摘要与冲突收窄 —— 真实浏览器 -> nginx(web) -> FastAPI(api)。
import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = (name) => path.resolve(__dirname, 'fixtures', name);

test.describe('频道角色摘要与冲突收窄', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(fixtures('conflict.json'));
    await expect(page.getByTestId('result-conflict')).toBeVisible();
    // 展开频道表
    await page.getByText(/查看输入的 3 个频道/).click();
  });

  test('频道表显示每只频道的角色与双向次数', async ({ page }) => {
    const rows = page.getByTestId('channel-row');
    await expect(rows).toHaveCount(3);

    // #11 与 #33：各作为来源 1 次、受影响 1 次 → 双重角色
    await expect(rows.nth(0)).toContainText('#11');
    await expect(rows.nth(0)).toContainText('来源 + 受影响');
    await expect(rows.nth(0).getByRole('cell').nth(3)).toHaveText('1');
    await expect(rows.nth(0).getByRole('cell').nth(4)).toHaveText('1');
    // #22：仅来源，2 次
    await expect(rows.nth(1)).toContainText('#22');
    await expect(rows.nth(1)).toContainText('来源');
    await expect(rows.nth(1).getByRole('cell').nth(3)).toHaveText('2');
    await expect(rows.nth(1).getByRole('cell').nth(4)).toHaveText('0');
    await expect(rows.nth(2)).toContainText('#33');
    await expect(rows.nth(2)).toContainText('来源 + 受影响');
  });

  test('点击频道行收窄到该频道参与的冲突，再次点击恢复全部', async ({ page }) => {
    const rows = page.getByTestId('channel-row');

    // #11 既是一条冲突的受影响频道，又是另一条的来源：收窄后两条都在
    await rows.nth(0).click();
    await expect(page.getByTestId('channel-filter-banner')).toContainText('#11');
    await expect(page.getByTestId('filtered-conflict-count')).toHaveText('2');
    await expect(page.getByTestId('conflict-item')).toHaveCount(2);

    // 再次点击同一行：恢复全部，横幅消失
    await rows.nth(0).click();
    await expect(page.getByTestId('channel-filter-banner')).toHaveCount(0);
    await expect(page.getByTestId('conflict-item')).toHaveCount(2);
  });

  test('收窄后的明细保持原始顺序，来源与受影响两个方向都能命中', async ({ page }) => {
    // #33 作为受影响频道命中一条、作为来源命中一条；
    // 收窄后顺序与原列表一致（受影响 #11 的卡片在前）
    await page.getByTestId('channel-row').nth(2).click();

    const items = page.getByTestId('conflict-item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('受影响频道 #11');
    await expect(items.nth(1)).toContainText('受影响频道 #33');
    // 第二张卡片里 #33 以来源身份出现
    await expect(items.nth(1).getByTestId('three-channels')).toContainText('#33');
  });

  test('重新分析示例与上传新文件都会让旧选择和收窄视图立即失效', async ({ page }) => {
    await page.getByTestId('channel-row').nth(0).click();
    await expect(page.getByTestId('channel-filter-banner')).toBeVisible();

    // 重新分析示例：收窄失效，恢复全部
    await page.getByTestId('sample-button').click();
    await expect(page.getByTestId('result-conflict')).toBeVisible();
    await expect(page.getByTestId('channel-filter-banner')).toHaveCount(0);
    await expect(page.getByTestId('conflict-item')).toHaveCount(2);

    // 再次收窄后上传新文件：旧选择同样立即失效
    await page.getByText(/查看输入的 3 个频道/).click();
    await page.getByTestId('channel-row').nth(0).click();
    await expect(page.getByTestId('channel-filter-banner')).toBeVisible();
    await page.getByTestId('file-input').setInputFiles(fixtures('conflict.json'));
    await expect(page.getByTestId('result-conflict')).toBeVisible();
    await expect(page.getByTestId('channel-filter-banner')).toHaveCount(0);
    await expect(page.getByTestId('conflict-item')).toHaveCount(2);
  });

  test('收窄状态下新输入校验失败：只展示逐项错误，不残留上一批频道或冲突', async ({ page }) => {
    await page.getByTestId('channel-row').nth(0).click();
    await expect(page.getByTestId('channel-filter-banner')).toBeVisible();

    await page.getByTestId('file-input').setInputFiles(fixtures('invalid.json'));

    await expect(page.getByTestId('form-error')).toBeVisible();
    await expect(page.getByTestId('error-item')).toHaveCount(5);
    // 上一批的频道表、冲突明细与收窄横幅全部清除
    await expect(page.getByTestId('result-conflict')).toHaveCount(0);
    await expect(page.getByTestId('conflict-item')).toHaveCount(0);
    await expect(page.getByTestId('channel-row')).toHaveCount(0);
    await expect(page.getByTestId('channel-filter-banner')).toHaveCount(0);
  });

  test('收窄视图不影响 JSON 下载与候选评估契约', async ({ page }) => {
    await page.getByTestId('channel-row').nth(0).click();
    await expect(page.getByTestId('channel-filter-banner')).toBeVisible();

    // 下载仍导出全部冲突明细，不受收窄影响
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('download-button').click(),
    ]);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const report = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    expect(report.status).toBe('conflict');
    expect(report.conflicts).toHaveLength(2);
    expect(report.input_channels).toHaveLength(3);

    // 候选评估照常工作
    await page.getByTestId('candidate-id-input').fill('44');
    await page.getByTestId('candidate-frequency-input').fill('520.025');
    await page.getByTestId('candidate-evaluate-button').click();
    await expect(page.getByTestId('candidate-conflict')).toBeVisible();
    await expect(page.getByTestId('candidate-conflict-count')).toHaveText('2');
  });
});
