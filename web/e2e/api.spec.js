// 经真实 nginx 代理访问 FastAPI 的 HTTP 验收测试（不模拟任何服务）。
import { expect, test } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4173';

test('健康检查经 web 代理到达 api', async ({ request }) => {
  const resp = await request.get(`${baseURL}/api/health`);
  expect(resp.status()).toBe(200);
  expect((await resp.json()).status).toBe('ok');
});

test('真实 POST 返回可用结论', async ({ request }) => {
  const resp = await request.post(`${baseURL}/api/conflicts`, {
    data: [
      { id: 1, frequency: 470.0 },
      { id: 2, frequency: 600.0 },
      { id: 3, frequency: 690.0 },
    ],
  });
  expect(resp.status()).toBe(200);
  const body = await resp.json();
  expect(body.status).toBe('clear');
});

test('真实 POST 返回冲突结论且产物为整数 kHz', async ({ request }) => {
  const resp = await request.post(`${baseURL}/api/conflicts`, {
    data: [
      { id: 11, frequency: 480.0 },
      { id: 22, frequency: 500.0 },
      { id: 33, frequency: 520.0 },
    ],
  });
  expect(resp.status()).toBe(200);
  const body = await resp.json();
  expect(body.status).toBe('conflict');
  expect(body.conflicts.length).toBeGreaterThan(0);
  for (const c of body.conflicts) {
    expect(Number.isInteger(c.product_khz)).toBe(true);
    expect(c.victim.id).not.toBe(c.sources[0].id);
    expect(c.victim.id).not.toBe(c.sources[1].id);
  }
});

test('离格频率整批 422', async ({ request }) => {
  const resp = await request.post(`${baseURL}/api/conflicts`, {
    data: [
      { id: 1, frequency: 470.013 },
      { id: 2, frequency: 480.0 },
    ],
  });
  expect(resp.status()).toBe(422);
  const body = await resp.json();
  expect(body.errors.length).toBeGreaterThan(0);
  expect(body.errors[0]).toHaveProperty('message');
});
