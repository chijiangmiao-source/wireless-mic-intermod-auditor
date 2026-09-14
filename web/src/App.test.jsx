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
    { id: 1, frequency_khz: 470000, frequency_mhz: 470.0, source_count: 0, victim_count: 0, role: 'none' },
    { id: 2, frequency_khz: 600000, frequency_mhz: 600.0, source_count: 0, victim_count: 0, role: 'none' },
  ],
};

const conflictBody = {
  status: 'conflict',
  channel_count: 3,
  conflict_count: 2,
  channels: [
    { id: 11, frequency_khz: 480000, frequency_mhz: 480.0, source_count: 1, victim_count: 1, role: 'both' },
    { id: 22, frequency_khz: 500000, frequency_mhz: 500.0, source_count: 2, victim_count: 0, role: 'source' },
    { id: 33, frequency_khz: 520000, frequency_mhz: 520.0, source_count: 1, victim_count: 1, role: 'both' },
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

  it('边界编号带小数（2^53−1 + .1）拒绝并提示编号必须是整数，不静默舍入', async () => {
    const user = userEvent.setup();
    await runBaseline(user);

    // Number('9007199254740991.1') === 9007199254740991（恰好舍成安全整数边界），
    // 绝不能被改成相邻整数后继续评估
    await fillAndEvaluate(user, '9007199254740991.1', '500.000');

    const errorPanel = await screen.findByTestId('candidate-error');
    const items = within(errorPanel).getAllByTestId('error-item');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('candidate.id');
    expect(items[0]).toHaveTextContent('必须是整数');
    expect(items[0]).toHaveTextContent('9007199254740991.1');

    // 不发送候选请求；不产生任何结论，基线保持不变
    const candidateCalls = fetch.mock.calls.filter(([url]) => url === '/api/candidate');
    expect(candidateCalls).toHaveLength(0);
    expect(screen.queryByTestId('candidate-safe')).not.toBeInTheDocument();
    expect(screen.queryByTestId('candidate-conflict')).not.toBeInTheDocument();
    expect(screen.getByTestId('result-conflict')).toBeInTheDocument();
  });

  it('普通整数写法的小数编号（如 4.0）同样按非整数拒绝', async () => {
    const user = userEvent.setup();
    await runBaseline(user);

    await fillAndEvaluate(user, '4.0', '500.000');

    const errorPanel = await screen.findByTestId('candidate-error');
    const items = within(errorPanel).getAllByTestId('error-item');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('candidate.id');
    expect(items[0]).toHaveTextContent('必须是整数');
    const candidateCalls = fetch.mock.calls.filter(([url]) => url === '/api/candidate');
    expect(candidateCalls).toHaveLength(0);
  });
});

describe('频道角色摘要与冲突收窄', () => {
  // 5 频道 4 冲突：#1–#4 均为双重角色但参与冲突数不同，#5 与冲突无关，
  // 使收窄过滤、角色标签与计数都有可区分的表现
  const channelViewBody = {
    status: 'conflict',
    channel_count: 5,
    conflict_count: 4,
    channels: [
      { id: 1, frequency_khz: 480000, frequency_mhz: 480.0, source_count: 1, victim_count: 1, role: 'both' },
      { id: 2, frequency_khz: 500000, frequency_mhz: 500.0, source_count: 3, victim_count: 1, role: 'both' },
      { id: 3, frequency_khz: 520000, frequency_mhz: 520.0, source_count: 3, victim_count: 1, role: 'both' },
      { id: 4, frequency_khz: 540000, frequency_mhz: 540.0, source_count: 1, victim_count: 1, role: 'both' },
      { id: 5, frequency_khz: 690000, frequency_mhz: 690.0, source_count: 0, victim_count: 0, role: 'none' },
    ],
    conflicts: [
      {
        victim: { id: 1, frequency_khz: 480000, frequency_mhz: 480.0 },
        sources: [
          { id: 2, frequency_khz: 500000, frequency_mhz: 500.0, coefficient: 2 },
          { id: 3, frequency_khz: 520000, frequency_mhz: 520.0, coefficient: 1 },
        ],
        doubled_source_id: 2,
        product_khz: 480000,
        product_frequency_mhz: 480.0,
        distance_khz: 0,
        formula: '2×500.000 MHz − 520.000 MHz = 480.000 MHz（2f(频道2) − f(频道3)）',
      },
      {
        victim: { id: 2, frequency_khz: 500000, frequency_mhz: 500.0 },
        sources: [
          { id: 3, frequency_khz: 520000, frequency_mhz: 520.0, coefficient: 2 },
          { id: 4, frequency_khz: 540000, frequency_mhz: 540.0, coefficient: 1 },
        ],
        doubled_source_id: 3,
        product_khz: 500000,
        product_frequency_mhz: 500.0,
        distance_khz: 0,
        formula: '2×520.000 MHz − 540.000 MHz = 500.000 MHz（2f(频道3) − f(频道4)）',
      },
      {
        victim: { id: 3, frequency_khz: 520000, frequency_mhz: 520.0 },
        sources: [
          { id: 1, frequency_khz: 480000, frequency_mhz: 480.0, coefficient: 1 },
          { id: 2, frequency_khz: 500000, frequency_mhz: 500.0, coefficient: 2 },
        ],
        doubled_source_id: 2,
        product_khz: 520000,
        product_frequency_mhz: 520.0,
        distance_khz: 0,
        formula: '2×500.000 MHz − 480.000 MHz = 520.000 MHz（2f(频道2) − f(频道1)）',
      },
      {
        victim: { id: 4, frequency_khz: 540000, frequency_mhz: 540.0 },
        sources: [
          { id: 2, frequency_khz: 500000, frequency_mhz: 500.0, coefficient: 1 },
          { id: 3, frequency_khz: 520000, frequency_mhz: 520.0, coefficient: 2 },
        ],
        doubled_source_id: 3,
        product_khz: 540000,
        product_frequency_mhz: 540.0,
        distance_khz: 0,
        formula: '2×520.000 MHz − 500.000 MHz = 540.000 MHz（2f(频道3) − f(频道2)）',
      },
    ],
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function runBaseline(user, body) {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, body)));
    render(<App />);
    await user.click(screen.getByTestId('sample-button'));
    await waitFor(() =>
      expect(screen.getByTestId('result-conflict')).toBeInTheDocument(),
    );
    // 展开频道表
    await user.click(screen.getByText(/查看输入的 \d+ 个频道/));
  }

  it('频道表按冲突身份显示每只频道的角色与次数（双向归类）', async () => {
    const user = userEvent.setup();
    await runBaseline(user, conflictBody);

    const rows = screen.getAllByTestId('channel-row');
    expect(rows).toHaveLength(3);
    const cells = (row) => within(row).getAllByRole('cell').map((c) => c.textContent);
    // #11：来源 1 次 + 受影响 1 次 → 双重角色
    expect(cells(rows[0])).toEqual(['#11', '480.000', '来源 + 受影响', '1', '1']);
    // #22：仅来源，2 次
    expect(cells(rows[1])).toEqual(['#22', '500.000', '来源', '2', '0']);
    // #33：来源 1 次 + 受影响 1 次 → 双重角色
    expect(cells(rows[2])).toEqual(['#33', '520.000', '来源 + 受影响', '1', '1']);
  });

  it('无冲突频道显示无冲突与零计数', async () => {
    const user = userEvent.setup();
    await runBaseline(user, channelViewBody);

    const row5 = screen.getAllByTestId('channel-row')[4];
    expect(within(row5).getAllByRole('cell').map((c) => c.textContent)).toEqual([
      '#5', '690.000', '无冲突', '0', '0',
    ]);
  });

  it('点击频道行只显示该频道参与的冲突（来源与受影响都算），再次点击恢复全部', async () => {
    const user = userEvent.setup();
    await runBaseline(user, channelViewBody);

    // #1 参与 2 条：作为受影响（第一条）与作为来源（第三条）
    await user.click(screen.getAllByTestId('channel-row')[0]);

    const banner = screen.getByTestId('channel-filter-banner');
    expect(banner).toHaveTextContent('#1');
    expect(screen.getByTestId('filtered-conflict-count')).toHaveTextContent('2');
    const narrowed = screen.getAllByTestId('conflict-item');
    expect(narrowed).toHaveLength(2);
    expect(narrowed[0]).toHaveTextContent('受影响频道 #1');
    expect(narrowed[1]).toHaveTextContent('受影响频道 #3');

    // 再次点击同一行：恢复全部明细
    await user.click(screen.getAllByTestId('channel-row')[0]);
    expect(screen.queryByTestId('channel-filter-banner')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('conflict-item')).toHaveLength(4);
  });

  it('收窄后的明细保持原始顺序，未参与频道收窄后为 0 条', async () => {
    const user = userEvent.setup();
    await runBaseline(user, channelViewBody);

    // #4 参与第 2、4 条：收窄后顺序与原列表一致（受影响 #2 在前、#4 在后）
    await user.click(screen.getAllByTestId('channel-row')[3]);
    const items = screen.getAllByTestId('conflict-item');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('受影响频道 #2');
    expect(items[1]).toHaveTextContent('受影响频道 #4');

    // #5 不参与任何冲突：收窄后 0 条，横幅如实显示
    await user.click(screen.getAllByTestId('channel-row')[4]);
    expect(screen.queryAllByTestId('conflict-item')).toHaveLength(0);
    expect(screen.getByTestId('filtered-conflict-count')).toHaveTextContent('0');
  });

  it('上传新文件后旧选择与收窄视图立即失效', async () => {
    const user = userEvent.setup();
    await runBaseline(user, channelViewBody);
    await user.click(screen.getAllByTestId('channel-row')[0]);
    expect(screen.getAllByTestId('conflict-item')).toHaveLength(2);

    // jsdom 的 File 未实现 .text()，在实例上补齐
    const contents = JSON.stringify(
      channelViewBody.channels.map((ch) => ({ id: ch.id, frequency: ch.frequency_mhz })),
    );
    const file = new File([contents], 'plan.json', { type: 'application/json' });
    file.text = async () => contents;
    await user.upload(screen.getByTestId('file-input'), file);

    await waitFor(() =>
      expect(screen.getAllByTestId('conflict-item')).toHaveLength(4),
    );
    expect(screen.queryByTestId('channel-filter-banner')).not.toBeInTheDocument();
  });

  it('重新分析示例后旧选择与收窄视图立即失效', async () => {
    const user = userEvent.setup();
    await runBaseline(user, channelViewBody);
    await user.click(screen.getAllByTestId('channel-row')[0]);
    expect(screen.getAllByTestId('conflict-item')).toHaveLength(2);

    await user.click(screen.getByTestId('sample-button'));

    await waitFor(() =>
      expect(screen.getAllByTestId('conflict-item')).toHaveLength(4),
    );
    expect(screen.queryByTestId('channel-filter-banner')).not.toBeInTheDocument();
  });

  it('收窄状态下新输入校验失败：只展示逐项错误，不残留上一批频道或冲突', async () => {
    const errorBody = {
      message: '频道数据校验未通过',
      errors: [
        { index: 0, field: 'frequency', message: '频率 470.013 MHz 必须精确落在 0.025 MHz 刻度上' },
        { index: 1, field: 'id', message: '频道编号 5 重复，每个编号必须唯一' },
      ],
    };
    const user = userEvent.setup();
    await runBaseline(user, channelViewBody);
    await user.click(screen.getAllByTestId('channel-row')[0]);
    expect(screen.getAllByTestId('conflict-item')).toHaveLength(2);

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(422, errorBody)));
    await user.click(screen.getByTestId('sample-button'));

    await waitFor(() =>
      expect(screen.getByTestId('form-error')).toBeInTheDocument(),
    );
    // 上一批的频道表、冲突明细与收窄横幅全部清除，只剩逐项错误
    expect(screen.queryAllByTestId('conflict-item')).toHaveLength(0);
    expect(screen.queryAllByTestId('channel-row')).toHaveLength(0);
    expect(screen.queryByTestId('channel-filter-banner')).not.toBeInTheDocument();
    const items = screen.getAllByTestId('error-item');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('0.025 MHz 刻度');
    expect(items[1]).toHaveTextContent('编号 5 重复');
  });
});

describe('可选业务名称 name', () => {
  // 与 conflictBody 同构，但 #11/#22 带业务名称，#33 未命名
  const namedInput = [
    { id: 11, frequency: 480.0, name: ' 主唱麦 ' },
    { id: 22, frequency: 500.0, name: '吉他腰包' },
    { id: 33, frequency: 520.0 },
  ];
  const namedConflictBody = {
    status: 'conflict',
    channel_count: 3,
    conflict_count: 2,
    channels: [
      { id: 11, frequency_khz: 480000, frequency_mhz: 480.0, name: '主唱麦', source_count: 1, victim_count: 1, role: 'both' },
      { id: 22, frequency_khz: 500000, frequency_mhz: 500.0, name: '吉他腰包', source_count: 2, victim_count: 0, role: 'source' },
      { id: 33, frequency_khz: 520000, frequency_mhz: 520.0, source_count: 1, victim_count: 1, role: 'both' },
    ],
    conflicts: [
      {
        victim: { id: 11, frequency_khz: 480000, frequency_mhz: 480.0, name: '主唱麦' },
        sources: [
          { id: 22, frequency_khz: 500000, frequency_mhz: 500.0, name: '吉他腰包', coefficient: 2 },
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
          { id: 11, frequency_khz: 480000, frequency_mhz: 480.0, name: '主唱麦', coefficient: 1 },
          { id: 22, frequency_khz: 500000, frequency_mhz: 500.0, name: '吉他腰包', coefficient: 2 },
        ],
        doubled_source_id: 22,
        product_khz: 520000,
        product_frequency_mhz: 520.0,
        distance_khz: 0,
        formula: '2×500.000 MHz − 480.000 MHz = 520.000 MHz（2f(频道22) − f(频道11)）',
      },
    ],
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, namedConflictBody)));
    if (!URL.createObjectURL) {
      URL.createObjectURL = vi.fn(() => 'blob:fake');
      URL.revokeObjectURL = vi.fn();
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function uploadNamed(user) {
    const contents = JSON.stringify(namedInput);
    const file = new File([contents], 'named-plan.json', { type: 'application/json' });
    file.text = async () => contents;
    const { unmount } = render(<App />);
    await user.upload(screen.getByTestId('file-input'), file);
    await waitFor(() =>
      expect(screen.getByTestId('result-conflict')).toBeInTheDocument(),
    );
    return unmount;
  }

  it('频道表显示业务名称，未填写时显示破折号', async () => {
    const user = userEvent.setup();
    await uploadNamed(user);
    await user.click(screen.getByText(/查看输入的 3 个频道/));

    const rows = screen.getAllByTestId('channel-row');
    const nameCells = rows.map((r) => within(r).getByTestId('channel-name-cell').textContent);
    expect(nameCells).toEqual(['主唱麦', '吉他腰包', '—']);
  });

  it('冲突卡片在受影响徽标、名称辨认行与三频道表中显示名称，计算式保持编号', async () => {
    const user = userEvent.setup();
    await uploadNamed(user);

    // 受影响频道 #33 的卡片：徽标只显示编号（#33 未命名）
    const card33 = screen.getAllByTestId('conflict-item')[1];
    expect(within(card33).getByText('受影响频道 #33')).toBeInTheDocument();
    expect(within(card33).queryAllByTestId('channel-name')).toHaveLength(0);

    // 计算式旁的名称辨认行：来源带名称、受影响只列编号
    const namesLine = within(card33).getByTestId('conflict-channel-names');
    expect(namesLine).toHaveTextContent('#11 主唱麦');
    expect(namesLine).toHaveTextContent('#22 吉他腰包');
    expect(namesLine).toHaveTextContent('受影响：#33');

    // 三频道表新增业务名称列
    const table = within(card33).getByTestId('three-channels');
    const sourceNameCells = within(table).getAllByRole('row').slice(1, 3);
    expect(sourceNameCells[0]).toHaveTextContent('主唱麦');
    expect(sourceNameCells[1]).toHaveTextContent('吉他腰包');
    expect(table.querySelector('.row-victim')).toHaveTextContent('—');

    // 受影响频道命名时（第一张卡 #11）徽标带名称
    const card11 = screen.getAllByTestId('conflict-item')[0];
    expect(within(card11).getByText('受影响频道 #11')).toBeInTheDocument();
    expect(within(card11).getByTestId('channel-name')).toHaveTextContent('（主唱麦）');
    // 计算式本身仍只含编号，不含名称
    expect(within(card11).getByTestId('conflict-formula')).not.toHaveTextContent('主唱麦');
  });

  it('候选请求只携带 id 与 frequency，name 在发请求前剥离', async () => {
    const user = userEvent.setup();
    stubFetchRouting(jsonResponse(200, namedConflictBody), jsonResponse(200, candidateSafeBody));
    render(<App />);
    const contents = JSON.stringify(namedInput);
    const file = new File([contents], 'named-plan.json', { type: 'application/json' });
    file.text = async () => contents;
    await user.upload(screen.getByTestId('file-input'), file);
    await waitFor(() =>
      expect(screen.getByTestId('result-conflict')).toBeInTheDocument(),
    );

    await user.type(screen.getByTestId('candidate-id-input'), '4');
    await user.type(screen.getByTestId('candidate-frequency-input'), '500.000');
    await user.click(screen.getByTestId('candidate-evaluate-button'));
    await waitFor(() =>
      expect(screen.getByTestId('candidate-safe')).toBeInTheDocument(),
    );

    const call = fetch.mock.calls.find(([url]) => url === '/api/candidate');
    const sent = JSON.parse(call[1].body);
    expect(sent.channels).toEqual([
      { id: 11, frequency: 480.0 },
      { id: 22, frequency: 500.0 },
      { id: 33, frequency: 520.0 },
    ]);
    expect(sent.candidate).toEqual({ id: 4, frequency: 500 });
  });

  it('JSON 下载同步携带名称：输入项与冲突明细都含 name', async () => {
    const user = userEvent.setup();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await uploadNamed(user);

    let captured = null;
    // 直接读取 createObjectURL 收到的 Blob
    URL.createObjectURL.mockImplementation((blob) => {
      captured = blob;
      return 'blob:fake';
    });

    await user.click(screen.getByTestId('download-button'));
    const text = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsText(captured);
    });
    const report = JSON.parse(text);
    clickSpy.mockRestore();

    expect(report.input_channels).toEqual(namedInput);
    const named = report.conflicts.find((c) => c.victim.id === 11);
    expect(named.victim.name).toBe('主唱麦');
    expect(named.sources.find((s) => s.id === 22).name).toBe('吉他腰包');
    const unnamed = report.conflicts.find((c) => c.victim.id === 33);
    expect(unnamed.victim.name).toBeUndefined();
  });

  it('含空名称的新文件按 name 字段定位错误，并清除旧分析、收窄与候选结论', async () => {
    const user = userEvent.setup();
    const unmount = await uploadNamed(user);
    // 先做收窄与一次候选评估，制造需要被清除的旧状态
    await user.click(screen.getByText(/查看输入的 3 个频道/));
    await user.click(screen.getAllByTestId('channel-row')[0]);
    expect(screen.getByTestId('channel-filter-banner')).toBeInTheDocument();

    stubFetchRouting(jsonResponse(200, namedConflictBody), jsonResponse(200, candidateSafeBody));
    await user.type(screen.getByTestId('candidate-id-input'), '4');
    await user.type(screen.getByTestId('candidate-frequency-input'), '500.000');
    await user.click(screen.getByTestId('candidate-evaluate-button'));
    await waitFor(() =>
      expect(screen.getByTestId('candidate-safe')).toBeInTheDocument(),
    );

    // 上传含空名称的新文件：整批 422，旧结果、收窄横幅、候选结论全部清除
    const errorBody = {
      message: '频道数据校验未通过',
      errors: [
        { index: 1, field: 'name', message: "频道名称 '' 去除首尾空白后必须为 1 至 40 个字符" },
      ],
    };
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(422, errorBody)));
    const badContents = JSON.stringify([
      { id: 11, frequency: 480.0 },
      { id: 22, frequency: 500.0, name: '' },
    ]);
    const badFile = new File([badContents], 'bad-name.json', { type: 'application/json' });
    badFile.text = async () => badContents;
    await user.upload(screen.getByTestId('file-input'), badFile);

    await waitFor(() =>
      expect(screen.getByTestId('form-error')).toBeInTheDocument(),
    );
    const items = screen.getAllByTestId('error-item');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('第 2 项');
    expect(items[0]).toHaveTextContent('name');
    expect(items[0]).toHaveTextContent('1 至 40');

    // 旧分析、频道表、收窄与候选结论无残留
    expect(screen.queryByTestId('result-conflict')).not.toBeInTheDocument();
    expect(screen.queryByTestId('result-clear')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('channel-row')).toHaveLength(0);
    expect(screen.queryByTestId('channel-filter-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('candidate-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('candidate-safe')).not.toBeInTheDocument();
    unmount();
  });
});
