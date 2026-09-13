import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App.jsx';

const clearBody = {
  status: 'clear',
  channel_count: 2,
  conflict_count: 0,
  conflicts: [],
  channels: [
    { id: 1, frequency_khz: 470000, frequency_mhz: 470.0 },
    { id: 2, frequency_khz: 600000, frequency_mhz: 600.0 },
  ],
};

const conflictBody = {
  status: 'conflict',
  channel_count: 3,
  conflict_count: 2,
  channels: [
    { id: 11, frequency_khz: 480000, frequency_mhz: 480.0 },
    { id: 22, frequency_khz: 500000, frequency_mhz: 500.0 },
    { id: 33, frequency_khz: 520000, frequency_mhz: 520.0 },
  ],
  conflicts: [
    {
      victim: { id: 11, frequency_khz: 480000, frequency_mhz: 480.0 },
      sources: [
        { id: 22, frequency_khz: 500000, frequency_mhz: 500.0, coefficient: 2 },
        { id: 33, frequency_khz: 520000, frequency_mhz: 520.0, coefficient: 1 },
      ],
      doubled_source_id: 22,
      product_khz: 480000,
      product_frequency_mhz: 480.0,
      distance_khz: 0,
      formula: '2×500.000 MHz − 520.000 MHz = 480.000 MHz（2f(频道22) − f(频道33)）',
    },
    {
      victim: { id: 33, frequency_khz: 520000, frequency_mhz: 520.0 },
      sources: [
        { id: 11, frequency_khz: 480000, frequency_mhz: 480.0, coefficient: 1 },
        { id: 22, frequency_khz: 500000, frequency_mhz: 500.0, coefficient: 2 },
      ],
      doubled_source_id: 22,
      product_khz: 520000,
      product_frequency_mhz: 520.0,
      distance_khz: 0,
      formula: '2×500.000 MHz − 480.000 MHz = 520.000 MHz（2f(频道22) − f(频道11)）',
    },
  ],
};

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

describe('App 频率协调页面', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, conflictBody)),
    );
    if (!URL.createObjectURL) {
      URL.createObjectURL = vi.fn(() => 'blob:fake');
      URL.revokeObjectURL = vi.fn();
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('初始显示等待提示，不显示任何结论', () => {
    render(<App />);
    expect(screen.getByTestId('hint')).toBeInTheDocument();
    expect(screen.queryByTestId('result-clear')).not.toBeInTheDocument();
    expect(screen.queryByTestId('result-conflict')).not.toBeInTheDocument();
  });

  it('冲突时明确显示冲突，并从每条冲突追溯计算式、产物频率和三只频道', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('sample-button'));

    await waitFor(() =>
      expect(screen.getByTestId('result-conflict')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('result-clear')).not.toBeInTheDocument();
    expect(screen.getByTestId('conflict-count')).toHaveTextContent('2');

    const cards = screen.getAllByTestId('conflict-item');
    expect(cards).toHaveLength(2);

    // 第二条冲突（受影响 #33）完整追溯
    expect(screen.getAllByText('#33').length).toBeGreaterThan(0);
    const card33 = screen.getAllByTestId('conflict-item')[1];
    expect(within(card33).getByTestId('conflict-formula')).toHaveTextContent(
      '2×500.000 MHz − 480.000 MHz = 520.000 MHz',
    );
    expect(within(card33).getAllByText('520.000 MHz').length).toBeGreaterThanOrEqual(2);
    // 三只频道编号全部出现
    for (const id of ['#11', '#22', '#33']) {
      expect(within(card33).getAllByText(id).length).toBeGreaterThan(0);
    }
    // 以真实 POST 发送，而非固定响应
    expect(fetch).toHaveBeenCalledWith(
      '/api/conflicts',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('可用时明确显示可用并提供下载', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, clearBody)));
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('sample-button'));

    await waitFor(() =>
      expect(screen.getByTestId('result-clear')).toBeInTheDocument(),
    );
    expect(screen.getByText(/可用（CLEAR）/)).toBeInTheDocument();

    await user.click(screen.getByTestId('download-button'));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  it('422 时清除旧结论并逐项显示错误', async () => {
    const errorBody = {
      message: '频道数据校验未通过',
      errors: [
        { index: 0, field: 'frequency', message: '频率 470.013 MHz 必须精确落在 0.025 MHz 刻度上' },
        { index: 1, field: 'id', message: '频道编号 5 重复，每个编号必须唯一' },
        { index: null, field: null, message: 'JSON 无法解析：boom' },
      ],
    };
    const user = userEvent.setup();
    const { unmount } = render(<App />);

    // 先得到冲突结论
    await user.click(screen.getByTestId('sample-button'));
    await waitFor(() =>
      expect(screen.getByTestId('result-conflict')).toBeInTheDocument(),
    );

    // 再提交非法批次
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(422, errorBody)));
    await user.click(screen.getByTestId('sample-button'));

    await waitFor(() =>
      expect(screen.getByTestId('form-error')).toBeInTheDocument(),
    );
    // 旧结论已清除
    expect(screen.queryByTestId('result-conflict')).not.toBeInTheDocument();
    expect(screen.queryByTestId('result-clear')).not.toBeInTheDocument();
    const items = screen.getAllByTestId('error-item');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('第 1 项');
    expect(items[0]).toHaveTextContent('frequency');
    expect(items[1]).toHaveTextContent('编号 5 重复');
    expect(items[2]).toHaveTextContent('JSON 无法解析');
    unmount();
  });

  it('网络失败时给出错误提示且不残留旧结论', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('sample-button'));
    await waitFor(() =>
      expect(screen.getByTestId('form-error')).toBeInTheDocument(),
    );
    expect(screen.getByText(/无法连接分析服务/)).toBeInTheDocument();
  });
});
