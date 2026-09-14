// 端到端：候选频点评估三条链路 —— 安全候选、新增冲突候选、非法候选保留基线。
import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = (name) => path.resolve(__dirname, 'fixtures', name);

test.describe('候选频点评估', () => {
  test('基线分析前不显示候选区，完成后才出现', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('candidate-panel')).toHaveCount(0);

    await page.getByTestId('file-input').setInputFiles(fixtures('clear.json'));
    await expect(page.getByTestId('result-clear')).toBeVisible();
    await expect(page.getByTestId('candidate-panel')).toBeVisible();
  });

  test('安全候选显示“可安全加入”，基线结论与下载保持不变', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(fixtures('clear.json'));
    await expect(page.getByTestId('result-clear')).toBeVisible();

    await page.getByTestId('candidate-id-input').fill('4');
    await page.getByTestId('candidate-frequency-input').fill('500.000');
    await page.getByTestId('candidate-evaluate-button').click();

    const safe = page.getByTestId('candidate-safe');
    await expect(safe).toBeVisible();
    await expect(safe).toContainText('可安全加入');
    await expect(safe).toContainText('#4');
    await expect(safe).toContainText('500.000 MHz');

    // 基线 CLEAR 结论与下载按钮不受候选评估影响
    await expect(page.getByTestId('result-clear')).toBeVisible();
    await expect(page.getByTestId('download-button')).toBeVisible();
    await expect(page.getByTestId('candidate-error')).toHaveCount(0);
  });

  test('候选引入新增冲突时逐条展示计算式与三只频道', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(fixtures('clear.json'));
    await expect(page.getByTestId('result-clear')).toBeVisible();

    await page.getByTestId('candidate-id-input').fill('4');
    await page.getByTestId('candidate-frequency-input').fill('535.000');
    await page.getByTestId('candidate-evaluate-button').click();

    const panel = page.getByTestId('candidate-conflict');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('candidate-conflict-count')).toHaveText('2');

    // 候选 #4 作为来源命中基线频道 #2：2×535.000 − 470.000 = 600.000
    const cardHit600 = panel
      .getByTestId('conflict-item')
      .filter({ hasText: '受影响频道 #2' });
    await expect(cardHit600).toBeVisible();
    await expect(cardHit600.getByTestId('conflict-formula')).toContainText(
      '2×535.000 MHz − 470.000 MHz = 600.000 MHz',
    );
    await expect(cardHit600).toContainText('互调产物频率：600.000 MHz');
    const channels600 = cardHit600.getByTestId('three-channels');
    await expect(channels600).toContainText('#1');
    await expect(channels600).toContainText('#4');
    await expect(channels600).toContainText('#2');
    await expect(channels600.locator('.row-source')).toHaveCount(2);
    await expect(channels600.locator('.row-victim')).toHaveCount(1);

    // 候选 #4 作为来源命中基线频道 #1：2×535.000 − 600.000 = 470.000
    const cardHit470 = panel
      .getByTestId('conflict-item')
      .filter({ hasText: '受影响频道 #1' });
    await expect(cardHit470.getByTestId('conflict-formula')).toContainText(
      '2×535.000 MHz − 600.000 MHz = 470.000 MHz',
    );

    // 基线 CLEAR 结论保留，候选区只列新增冲突
    await expect(page.getByTestId('result-clear')).toBeVisible();
    await expect(panel.getByTestId('conflict-item')).toHaveCount(2);
  });

  test('非法候选返回字段错误并保留已完成的基线分析', async ({ page }) => {
    await page.goto('/');
    // 先完成一次基线分析（冲突结论）
    await page.getByTestId('file-input').setInputFiles(fixtures('conflict.json'));
    await expect(page.getByTestId('result-conflict')).toBeVisible();
    await expect(page.getByTestId('conflict-count')).toHaveText('2');

    // 候选编号与现有 #11 重复，频率偏离 25 kHz 刻度
    await page.getByTestId('candidate-id-input').fill('11');
    await page.getByTestId('candidate-frequency-input').fill('520.013');
    await page.getByTestId('candidate-evaluate-button').click();

    const candidateError = page.getByTestId('candidate-error');
    await expect(candidateError).toBeVisible();
    const items = candidateError.getByTestId('error-item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('candidate.id');
    await expect(items.nth(0)).toContainText('重复');
    await expect(items.nth(1)).toContainText('candidate.frequency');
    await expect(items.nth(1)).toContainText('0.025 MHz 刻度');

    // 本次候选结论被清除，但基线冲突分析完整保留
    await expect(page.getByTestId('candidate-safe')).toHaveCount(0);
    await expect(page.getByTestId('candidate-conflict')).toHaveCount(0);
    await expect(page.getByTestId('result-conflict')).toBeVisible();
    await expect(page.getByTestId('conflict-count')).toHaveText('2');
    await expect(page.getByTestId('download-button')).toBeVisible();
  });

  test('候选频率越界同样按字段错误处理', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(fixtures('clear.json'));
    await expect(page.getByTestId('result-clear')).toBeVisible();

    await page.getByTestId('candidate-id-input').fill('9');
    await page.getByTestId('candidate-frequency-input').fill('700.000');
    await page.getByTestId('candidate-evaluate-button').click();

    const candidateError = page.getByTestId('candidate-error');
    await expect(candidateError).toBeVisible();
    await expect(candidateError.getByTestId('error-item')).toHaveCount(1);
    await expect(candidateError).toContainText('candidate.frequency');
    await expect(candidateError).toContainText('超出允许范围');
    await expect(page.getByTestId('result-clear')).toBeVisible();
  });

  test('评估成功后修改候选编号或频率，旧结论立即取消', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(fixtures('clear.json'));
    await expect(page.getByTestId('result-clear')).toBeVisible();

    await page.getByTestId('candidate-id-input').fill('4');
    await page.getByTestId('candidate-frequency-input').fill('500.000');
    await page.getByTestId('candidate-evaluate-button').click();
    await expect(page.getByTestId('candidate-safe')).toBeVisible();

    // 修改候选编号：不再次点击评估，上一次“可安全加入”结论也必须立即消失
    await page.getByTestId('candidate-id-input').fill('5');
    await expect(page.getByTestId('candidate-safe')).toHaveCount(0);
    await expect(page.getByTestId('candidate-conflict')).toHaveCount(0);
    await expect(page.getByTestId('candidate-error')).toHaveCount(0);
    // 输入的新编号保留，基线结论不受影响
    await expect(page.getByTestId('candidate-id-input')).toHaveValue('5');
    await expect(page.getByTestId('result-clear')).toBeVisible();

    // 修改候选频率同样立即取消旧结论（先重新评估一次冲突结论）
    await page.getByTestId('candidate-id-input').fill('4');
    await page.getByTestId('candidate-frequency-input').fill('535.000');
    await page.getByTestId('candidate-evaluate-button').click();
    await expect(page.getByTestId('candidate-conflict')).toBeVisible();
    await page.getByTestId('candidate-frequency-input').fill('534.000');
    await expect(page.getByTestId('candidate-conflict')).toHaveCount(0);
    await expect(page.getByTestId('candidate-safe')).toHaveCount(0);
  });

  test('候选编号超出浏览器安全整数范围时拒绝并定位 candidate.id', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(fixtures('clear.json'));
    await expect(page.getByTestId('result-clear')).toBeVisible();

    // 2^53+1：Number() 会静默舍入成相邻整数 2^53，页面必须在发请求前拒绝
    await page.getByTestId('candidate-id-input').fill('9007199254740993');
    await page.getByTestId('candidate-frequency-input').fill('500.000');
    await page.getByTestId('candidate-evaluate-button').click();

    const candidateError = page.getByTestId('candidate-error');
    await expect(candidateError).toBeVisible();
    const items = candidateError.getByTestId('error-item');
    await expect(items).toHaveCount(1);
    await expect(items).toContainText('candidate.id');
    await expect(items).toContainText('安全整数');
    await expect(items).toContainText('9007199254740993');

    // 不产生安全/冲突结论，基线分析保持不变
    await expect(page.getByTestId('candidate-safe')).toHaveCount(0);
    await expect(page.getByTestId('candidate-conflict')).toHaveCount(0);
    await expect(page.getByTestId('result-clear')).toBeVisible();
  });

  test('安全整数边界编号带小数时提示编号错误，不静默舍入', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(fixtures('clear.json'));
    await expect(page.getByTestId('result-clear')).toBeVisible();

    // Number('9007199254740991.1') === 9007199254740991（恰好舍成 2^53−1），
    // 页面必须提示编号错误，而不是改成相邻整数继续评估
    await page.getByTestId('candidate-id-input').fill('9007199254740991.1');
    await page.getByTestId('candidate-frequency-input').fill('500.000');
    await page.getByTestId('candidate-evaluate-button').click();

    const candidateError = page.getByTestId('candidate-error');
    await expect(candidateError).toBeVisible();
    const items = candidateError.getByTestId('error-item');
    await expect(items).toHaveCount(1);
    await expect(items).toContainText('candidate.id');
    await expect(items).toContainText('必须是整数');
    await expect(items).toContainText('9007199254740991.1');
    await expect(page.getByTestId('candidate-safe')).toHaveCount(0);
    await expect(page.getByTestId('candidate-conflict')).toHaveCount(0);
    await expect(page.getByTestId('result-clear')).toBeVisible();
  });
});
