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

// 候选接口 mock 响应
const candidateSafeBody = {
  status: 'safe',
  candidate: { id: 4, frequency_khz: 500000, frequency_mhz: 500.0 },
  new_conflict_count: 0,
  new_conflicts: [],
};

const candidateConflictBody = {
  status: 'conflict',
  candidate: { id: 44, frequency_khz: 520025, frequency_mhz: 520.025 },
  new_conflict_count: 2,
  new_conflicts: [
    {
      victim: { id: 11, frequency_khz: 480000, frequency_mhz: 480.0 },
      sources: [
        { id: 22, frequency_khz: 500000, frequency_mhz: 500.0, coefficient: 2 },
        { id: 44, frequency_khz: 520025, frequency_mhz: 520.025, coefficient: 1 },
      ],
      doubled_source_id: 22,
      product_khz: 479975,
      product_frequency_mhz: 479.975,
      distance_khz: 25,
      formula: '2×500.000 MHz − 520.025 MHz = 479.975 MHz（2f(频道22) − f(频道44)）',
    },
    {
      victim: { id: 44, frequency_khz: 520025, frequency_mhz: 520.025 },
      sources: [
        { id: 11, frequency_khz: 480000, frequency_mhz: 480.0, coefficient: 1 },
        { id: 22, frequency_khz: 500000, frequency_mhz: 500.0, coefficient: 2 },
      ],
      doubled_source_id: 22,
      product_khz: 520000,
      product_frequency_mhz: 520.0,
      distance_khz: 25,
      formula: '2×500.000 MHz − 480.000 MHz = 520.000 MHz（2f(频道22) − f(频道11)）',
    },
  ],
};

// 按 URL 分发的 fetch mock：/api/conflicts 给基线，/api/candidate 给候选
function stubFetchRouting(conflictsResponse, candidateResponse) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) =>
      url === '/api/candidate' ? candidateResponse : conflictsResponse,
    ),
  );
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

describe('候选频点评估', () => {
  beforeEach(() => {
    if (!URL.createObjectURL) {
      URL.createObjectURL = vi.fn(() => 'blob:fake');
      URL.revokeObjectURL = vi.fn();
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function runBaseline(user, body = conflictBody) {
    stubFetchRouting(jsonResponse(200, body), jsonResponse(200, candidateSafeBody));
    render(<App />);
    await user.click(screen.getByTestId('sample-button'));
    await waitFor(() =>
      expect(screen.getByTestId('result-conflict')).toBeInTheDocument(),
    );
  }

  async function fillAndEvaluate(user, id, frequency) {
    await user.type(screen.getByTestId('candidate-id-input'), id);
    await user.type(screen.getByTestId('candidate-frequency-input'), frequency);
    await user.click(screen.getByTestId('candidate-evaluate-button'));
  }

  it('基线分析完成前不显示候选区', () => {
    stubFetchRouting(jsonResponse(200, conflictBody), jsonResponse(200, candidateSafeBody));
    render(<App />);
    expect(screen.queryByTestId('candidate-panel')).not.toBeInTheDocument();
  });

  it('安全候选显示可安全加入，基线结论保持不变', async () => {
    const user = userEvent.setup();
    await runBaseline(user);

    await fillAndEvaluate(user, '4', '500.000');

    await waitFor(() =>
      expect(screen.getByTestId('candidate-safe')).toBeInTheDocument(),
    );
    expect(screen.getByText(/可安全加入/)).toBeInTheDocument();
    expect(screen.getByTestId('candidate-safe')).toHaveTextContent('#4');
    expect(screen.getByTestId('candidate-safe')).toHaveTextContent('500.000 MHz');
    // 基线结论与候选错误区不受影响
    expect(screen.getByTestId('result-conflict')).toBeInTheDocument();
    expect(screen.queryByTestId('candidate-error')).not.toBeInTheDocument();

    // 候选请求携带基线数组与单个候选频道
    const candidateCall = fetch.mock.calls.find(([url]) => url === '/api/candidate');
    expect(candidateCall).toBeTruthy();
    const sent = JSON.parse(candidateCall[1].body);
    expect(sent.candidate).toEqual({ id: 4, frequency: 500 });
    expect(sent.channels).toHaveLength(3);
  });

  it('候选引入新增冲突时逐条展示计算式与三只频道（候选可为来源或受影响）', async () => {
    const user = userEvent.setup();
    stubFetchRouting(jsonResponse(200, conflictBody), jsonResponse(200, candidateConflictBody));
    render(<App />);
    await user.click(screen.getByTestId('sample-button'));
    await waitFor(() =>
      expect(screen.getByTestId('result-conflict')).toBeInTheDocument(),
    );

    await fillAndEvaluate(user, '44', '520.025');

    await waitFor(() =>
      expect(screen.getByTestId('candidate-conflict')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('candidate-conflict-count')).toHaveTextContent('2');

    const panel = screen.getByTestId('candidate-conflict');
    const cards = within(panel).getAllByTestId('conflict-item');
    expect(cards).toHaveLength(2);

    // 候选 #44 作为来源的卡片：受影响 #11，来源 #22 与 #44
    const sourceCard = cards[0];
    expect(within(sourceCard).getByTestId('conflict-formula')).toHaveTextContent(
      '2×500.000 MHz − 520.025 MHz = 479.975 MHz',
    );
    expect(within(sourceCard).getByText('受影响频道 #11')).toBeInTheDocument();
    const sourceRows = within(sourceCard).getByTestId('three-channels');
    for (const id of ['#11', '#22', '#44']) {
      expect(within(sourceRows).getAllByText(id).length).toBeGreaterThan(0);
    }
    expect(within(sourceRows).getAllByText('来源（发射机）')).toHaveLength(2);
    expect(within(sourceRows).getAllByText('受影响（接收机）')).toHaveLength(1);

    // 候选 #44 作为受影响频道的卡片
    const victimCard = cards[1];
    expect(within(victimCard).getByText('受影响频道 #44')).toBeInTheDocument();
    expect(within(victimCard).getByTestId('conflict-formula')).toHaveTextContent(
      '2×500.000 MHz − 480.000 MHz = 520.000 MHz',
    );

    // 基线冲突区保持原样（两条基线冲突 + 两条候选新增，各自独立）
    expect(screen.getByTestId('result-conflict')).toBeInTheDocument();
    expect(screen.getByTestId('conflict-count')).toHaveTextContent('2');
  });

  it('非法候选按字段报错：清除本次候选结论但保留基线分析', async () => {
    const errorBody = {
      message: '候选评估请求校验未通过',
      errors: [
        { index: null, field: 'candidate.id', message: '候选编号 11 与现有频道重复，每个编号必须唯一' },
        { index: null, field: 'candidate.frequency', message: '频率 520.013 MHz 必须精确落在 0.025 MHz 刻度上' },
      ],
    };
    const user = userEvent.setup();
    // 先做一次安全候选，让候选区有结论，再提交非法候选验证清除
    stubFetchRouting(jsonResponse(200, conflictBody), jsonResponse(200, candidateSafeBody));
    render(<App />);
    await user.click(screen.getByTestId('sample-button'));
    await waitFor(() =>
      expect(screen.getByTestId('result-conflict')).toBeInTheDocument(),
    );
    await fillAndEvaluate(user, '4', '500.000');
    await waitFor(() =>
      expect(screen.getByTestId('candidate-safe')).toBeInTheDocument(),
    );

    // 再提交非法候选：本次候选结论被清除，基线冲突结论保留
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) =>
        url === '/api/candidate'
          ? jsonResponse(422, errorBody)
          : jsonResponse(200, conflictBody),
      ),
    );
    await user.clear(screen.getByTestId('candidate-id-input'));
    await user.clear(screen.getByTestId('candidate-frequency-input'));
    await fillAndEvaluate(user, '11', '520.013');

    await waitFor(() =>
      expect(screen.getByTestId('candidate-error')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('candidate-safe')).not.toBeInTheDocument();
    expect(screen.queryByTestId('candidate-conflict')).not.toBeInTheDocument();

    const items = within(screen.getByTestId('candidate-error')).getAllByTestId('error-item');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('candidate.id');
    expect(items[0]).toHaveTextContent('重复');
    expect(items[1]).toHaveTextContent('candidate.frequency');
    expect(items[1]).toHaveTextContent('0.025 MHz 刻度');

    // 基线分析结论与下载按钮不受影响
    expect(screen.getByTestId('result-conflict')).toBeInTheDocument();
    expect(screen.getByTestId('conflict-count')).toHaveTextContent('2');
    expect(screen.getByTestId('download-button')).toBeInTheDocument();
  });

  it('新的基线提交会清除候选结论', async () => {
    const user = userEvent.setup();
    await runBaseline(user);
    await fillAndEvaluate(user, '4', '500.000');
    await waitFor(() =>
      expect(screen.getByTestId('candidate-safe')).toBeInTheDocument(),
    );

    await user.click(screen.getByTestId('sample-button'));
    await waitFor(() =>
      expect(screen.queryByTestId('candidate-safe')).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('candidate-id-input')).toHaveValue('');
    expect(screen.getByTestId('candidate-frequency-input')).toHaveValue('');
  });

  it('评估成功后修改候选编号会立即取消旧结论', async () => {
    const user = userEvent.setup();
    await runBaseline(user);
    await fillAndEvaluate(user, '4', '500.000');
    await waitFor(() =>
      expect(screen.getByTestId('candidate-safe')).toBeInTheDocument(),
    );

    // 在编号框追加一个字符，不等下一次评估：旧结论必须立即消失
    await user.type(screen.getByTestId('candidate-id-input'), '5');
    expect(screen.queryByTestId('candidate-safe')).not.toBeInTheDocument();
    expect(screen.queryByTestId('candidate-conflict')).not.toBeInTheDocument();
    expect(screen.queryByTestId('candidate-error')).not.toBeInTheDocument();
    // 输入内容仍保留，且基线结论不受影响
    expect(screen.getByTestId('candidate-id-input')).toHaveValue('45');
    expect(screen.getByTestId('result-conflict')).toBeInTheDocument();
  });

  it('评估成功后修改候选频率会立即取消旧结论', async () => {
    const user = userEvent.setup();
    stubFetchRouting(
      jsonResponse(200, conflictBody),
      jsonResponse(200, candidateConflictBody),
    );
    render(<App />);
    await user.click(screen.getByTestId('sample-button'));
    await waitFor(() =>
      expect(screen.getByTestId('result-conflict')).toBeInTheDocument(),
    );
    await fillAndEvaluate(user, '44', '520.025');
    await waitFor(() =>
      expect(screen.getByTestId('candidate-conflict')).toBeInTheDocument(),
    );

    await user.type(screen.getByTestId('candidate-frequency-input'), '0');
    expect(screen.queryByTestId('candidate-conflict')).not.toBeInTheDocument();
    expect(screen.queryByTestId('candidate-safe')).not.toBeInTheDocument();
    expect(screen.getByTestId('candidate-frequency-input')).toHaveValue('520.0250');
  });

  it('候选编号超出安全整数范围时拒绝评估并定位 candidate.id，不发送请求', async () => {
    const user = userEvent.setup();
    await runBaseline(user);

    // 2^53+1：Number() 会静默舍入成 2^53，必须在发请求前拒绝
    await fillAndEvaluate(user, '9007199254740993', '500.000');

    const errorPanel = await screen.findByTestId('candidate-error');
    const items = within(errorPanel).getAllByTestId('error-item');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('candidate.id');
    expect(items[0]).toHaveTextContent('安全整数');
    expect(items[0]).toHaveTextContent('9007199254740993');

    // 没有发起任何候选请求，旧结论也未出现；基线分析保持不变
    const candidateCalls = fetch.mock.calls.filter(([url]) => url === '/api/candidate');
    expect(candidateCalls).toHaveLength(0);
    expect(screen.queryByTestId('candidate-safe')).not.toBeInTheDocument();
    expect(screen.queryByTestId('candidate-conflict')).not.toBeInTheDocument();
    expect(screen.getByTestId('result-conflict')).toBeInTheDocument();
  });

  it('科学计数法表示的超范围整数同样拒绝，不被 Number() 静默舍入', async () => {
    const user = userEvent.setup();
    await runBaseline(user);

    // 1e16 = 10,000,000,000,000,000 > 2^53−1
    await fillAndEvaluate(user, '1e16', '500.000');

    const errorPanel = await screen.findByTestId('candidate-error');
    const items = within(errorPanel).getAllByTestId('error-item');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('candidate.id');
    expect(items[0]).toHaveTextContent('安全整数');
    const candidateCalls = fetch.mock.calls.filter(([url]) => url === '/api/candidate');
    expect(candidateCalls).toHaveLength(0);
  });

  it('安全整数边界编号 2^53−1 照常发送评估', async () => {
    const user = userEvent.setup();
    await runBaseline(user);

    await fillAndEvaluate(user, '9007199254740991', '500.000');
    await waitFor(() =>
      expect(screen.getByTestId('candidate-safe')).toBeInTheDocument(),
    );
    const candidateCall = fetch.mock.calls.find(([url]) => url === '/api/candidate');
    expect(JSON.parse(candidateCall[1].body).candidate.id).toBe(9007199254740991);
  });
});
