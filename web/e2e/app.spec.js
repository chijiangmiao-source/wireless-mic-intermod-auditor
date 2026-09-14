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

  test('带业务名称的文件：频道表、计算式旁与下载 JSON 同步展示名称', async ({ page }) => {
    await page.getByTestId('file-input').setInputFiles(fixtures('named-conflict.json'));
    await expect(page.getByTestId('result-conflict')).toBeVisible();
    await expect(page.getByTestId('conflict-count')).toHaveText('2');

    // 频道表：名称列展示规范化后的名称，未命名频道显示破折号
    await page.getByText(/查看输入的 3 个频道/).click();
    const rows = page.getByTestId('channel-row');
    await expect(rows.nth(0).getByTestId('channel-name-cell')).toHaveText('主唱麦');
    await expect(rows.nth(1).getByTestId('channel-name-cell')).toHaveText('吉他腰包');
    await expect(rows.nth(2).getByTestId('channel-name-cell')).toHaveText('—');

    // 命中 #33（未命名）的卡片：计算式旁的名称行按业务名称辨认来源与受影响对象
    const card = page.getByTestId('conflict-item').filter({ hasText: '受影响频道 #33' });
    const namesLine = card.getByTestId('conflict-channel-names');
    await expect(namesLine).toContainText('#11 主唱麦');
    await expect(namesLine).toContainText('#22 吉他腰包');
    await expect(namesLine).toContainText('受影响：#33');
    // 计算式本身仍只含编号与频率
    await expect(card.getByTestId('conflict-formula')).not.toContainText('主唱麦');
    // 三频道表的业务名称列
    await expect(card.locator('.row-victim')).toContainText('—');
    await expect(card.locator('.row-source').first()).toContainText('主唱麦');
    await expect(card.locator('.row-source').nth(1)).toContainText('吉他腰包');

    // 下载 JSON 同步包含名称（输入项与冲突明细）
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('download-button').click(),
    ]);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const report = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    expect(report.input_channels[0].name).toBe(' 主唱麦 ');
    const hit33 = report.conflicts.find((c) => c.victim.id === 33);
    expect(hit33.victim.name).toBeUndefined();
    expect(hit33.sources.find((s) => s.id === 11).name).toBe('主唱麦');
  });

  test('含空名称与额外字段的新文件：两类错误都按同一频道定位，且不残留旧分析、收窄与候选结论', async ({ page }) => {
    // 先上传带名称的合法文件得到冲突结论
    await page.getByTestId('file-input').setInputFiles(fixtures('named-conflict.json'));
    await expect(page.getByTestId('result-conflict')).toBeVisible();

    // 制造收窄视图
    await page.getByText(/查看输入的 3 个频道/).click();
    await page.getByTestId('channel-row').nth(0).click();
    await expect(page.getByTestId('channel-filter-banner')).toBeVisible();

    // 制造一次候选结论（600 MHz 对 480/500/520 基线确实安全）
    await page.getByTestId('candidate-id-input').fill('4');
    await page.getByTestId('candidate-frequency-input').fill('600.000');
    await page.getByTestId('candidate-evaluate-button').click();
    await expect(page.getByTestId('candidate-safe')).toBeVisible();

    // 上传同一频道同时含空名称与额外字段的新文件
    await page.getByTestId('file-input').setInputFiles(fixtures('invalid-name.json'));

    await expect(page.getByTestId('form-error')).toBeVisible();
    const items = page.getByTestId('error-item');
    // 不能只报额外字段：空 name 错误必须同时定位到同一频道（第 2 项）
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('第 2 项');
    await expect(items.nth(0)).toContainText('非法字段');
    await expect(items.nth(0)).toContainText('band');
    await expect(items.nth(1)).toContainText('第 2 项');
    await expect(items.nth(1)).toContainText('name');
    await expect(items.nth(1)).toContainText('1 至 40');

    // 旧分析、频道表、收窄与候选结论无残留
    await expect(page.getByTestId('result-conflict')).toHaveCount(0);
    await expect(page.getByTestId('result-clear')).toHaveCount(0);
    await expect(page.getByTestId('conflict-item')).toHaveCount(0);
    await expect(page.getByTestId('channel-row')).toHaveCount(0);
    await expect(page.getByTestId('channel-filter-banner')).toHaveCount(0);
    await expect(page.getByTestId('candidate-panel')).toHaveCount(0);
  });
});
