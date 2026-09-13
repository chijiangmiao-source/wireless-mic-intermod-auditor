// 经真实 nginx 代理访问 FastAPI 的 HTTP 验收测试（不模拟任何服务）。
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4173';

test('健康检查经 web 代理到达 api', async ({ request }) => {
  const resp = await request.get(`${baseURL}/api/health`);
  expect(resp.status()).toBe(200);
  expect((await resp.json()).status).toBe('ok');
});

test('web 配置契约：nginx 双栈监听且健康检查不依赖 localhost 解析', () => {
  // 回归守卫：busybox wget 访问 localhost 可能解析到 ::1，
  // 仅监听 IPv4 会使容器健康检查永远失败、verify 无法开始。
  const nginxConf = fs.readFileSync(path.join(webRoot, 'nginx.conf'), 'utf8');
  expect(nginxConf).toMatch(/listen\s+80\s*;/);
  expect(nginxConf).toMatch(/listen\s+\[::\]:80\s*;/);

  const dockerfile = fs.readFileSync(path.join(webRoot, 'Dockerfile'), 'utf8');
  expect(dockerfile).toMatch(/HEALTHCHECK/);
  expect(dockerfile).toMatch(/http:\/\/127\.0\.0\.1\/health/);
  expect(dockerfile).not.toMatch(/http:\/\/localhost\/health/);
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
