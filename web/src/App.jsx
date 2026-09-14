import React, { useCallback, useRef, useState } from 'react';
import { analyzeChannels, evaluateCandidate } from './api.js';
import {
  buildDownloadPayload,
  channelRoleLabel,
  conflictInvolvesChannel,
  formatMHz,
  formatMHzWithUnit,
  summarizeStatus,
} from './format.js';

const SAMPLE_JSON = `[
  { "id": 11, "frequency": 480.000 },
  { "id": 22, "frequency": 500.000 },
  { "id": 33, "frequency": 520.000 }
]`;

// 编号必须能被 JSON 数字精确表示：±(2^53−1)，与后端校验保持一致
const MAX_SAFE_ID = Number.MAX_SAFE_INTEGER;
const INTEGER_RE = /^[+-]?\d+$/;
// 含小数点的数值文本（如 9007199254740991.1）
const DECIMAL_RE = /^[+-]?(?:\d+\.(\d*)|\.(\d+))$/;

// 候选频率框的文本转 JSON 数值；空文本与非数值交给后端按字段错误定位
function parseCandidateField(text) {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

// 候选编号框解析：返回 { value } 或 { error }。
// 超出安全整数范围的编号不能交给 Number()——它会被静默舍入成相邻整数，
// 必须在发请求前拒绝并指出 candidate.id 字段错误。
function parseCandidateId(text) {
  const trimmed = text.trim();
  if (trimmed === '') return { value: null };
  if (INTEGER_RE.test(trimmed)) {
    // 逐位比较，避免 Number() 对 2^53 以上整数的静默舍入
    const digits = trimmed.replace(/^[+-]/, '');
    if (BigInt(digits) > BigInt(MAX_SAFE_ID)) {
      return { error: unsafeIdMessage(trimmed) };
    }
    return { value: Number(trimmed) };
  }
  // 小数文本（如 9007199254740991.1）会被 Number() 舍掉小数部分变成整数，
  // 在安全整数边界被静默改成相邻整数后继续评估；编号必须是整数，
  // 必须在 Number() 之前按字段拒绝，不能携带被改写的编号发请求
  if (DECIMAL_RE.test(trimmed)) {
    return { error: `候选编号 ${trimmed} 必须是整数，不能含小数部分` };
  }
  // 其余非整数文本（科学计数法、字母等）原则上交给后端按“必须是整数”定位；
  // 但若 Number() 已把它解析成超范围整数（如 1e16），同样必须拒绝，不能静默舍入
  const value = Number(trimmed);
  if (Number.isFinite(value) && Number.isInteger(value) && Math.abs(value) > MAX_SAFE_ID) {
    return { error: unsafeIdMessage(trimmed) };
  }
  return { value: Number.isFinite(value) ? value : null };
}

function unsafeIdMessage(text) {
  return (
    `候选编号 ${text} 超出安全整数范围，绝对值不能超过 ${MAX_SAFE_ID}` +
    '（2^53−1），否则浏览器与 JSON 无法精确表示该编号'
  );
}

export default function App() {
  const [fileName, setFileName] = useState('');
  const [rawText, setRawText] = useState('');
  // result: null（尚无结论）| { kind: 'clear'|'conflict', body, input }
  const [result, setResult] = useState(null);
  const [errors, setErrors] = useState([]);
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);
  // 候选评估拥有独立状态：候选失败绝不清除已完成的基线分析
  const [candidateIdText, setCandidateIdText] = useState('');
  const [candidateFreqText, setCandidateFreqText] = useState('');
  // candidateResult: null | { kind: 'safe'|'conflict', body }
  const [candidateResult, setCandidateResult] = useState(null);
  const [candidateErrors, setCandidateErrors] = useState([]);
  const [candidateFormError, setCandidateFormError] = useState('');
  const [candidatePending, setCandidatePending] = useState(false);
  // 频道表中当前选中的频道：选中时冲突列表只显示它参与的明细
  const [selectedChannelId, setSelectedChannelId] = useState(null);
  const fileInputRef = useRef(null);

  const resetCandidate = useCallback(() => {
    setCandidateIdText('');
    setCandidateFreqText('');
    setCandidateResult(null);
    setCandidateErrors([]);
    setCandidateFormError('');
  }, []);

  // 任何新的基线提交都先清除旧结论、旧错误、候选评估与频道选择：
  // 旧选择对应的收窄视图随旧批次一起立即失效
  const resetConclusion = useCallback(() => {
    setResult(null);
    setErrors([]);
    setFormError('');
    setSelectedChannelId(null);
    resetCandidate();
  }, [resetCandidate]);

  // 点击频道行：选中则收窄到该频道参与的冲突；再次点击同一行恢复全部
  const onToggleChannel = useCallback((channelId) => {
    setSelectedChannelId((current) => (current === channelId ? null : channelId));
  }, []);

  const handleFile = useCallback(
    async (file) => {
      resetConclusion();
      if (!file) return;
      setFileName(file.name);
      const text = await file.text();
      setRawText(text);
      await submit(text);
    },
    [resetConclusion],
  );

  const onInputChange = (event) => {
    const file = event.target.files?.[0];
    if (file) handleFile(file);
    // 清空输入值：再次选择同一文件也会触发 change，保证旧选择随之失效
    event.target.value = '';
  };

  const submit = async (text) => {
    if (!text.trim()) {
      setFormError('文件为空：请上传包含 2–64 个频道的 JSON 数组');
      return;
    }
    setPending(true);
    try {
      const outcome = await analyzeChannels(text);
      resetConclusion();
      if (outcome.ok) {
        setResult({ kind: summarizeStatus(outcome.body).kind, body: outcome.body });
      } else {
        setErrors(outcome.errors);
        setFormError(outcome.message);
      }
    } finally {
      setPending(false);
    }
  };

  const onAnalyzeSample = async () => {
    resetConclusion();
    setFileName('示例数据');
    setRawText(SAMPLE_JSON);
    await submit(SAMPLE_JSON);
  };

  // 修改候选编号或频率后，上一次评估的安全/冲突结论立即失效：
  // 输入一旦变化就清除旧结论与旧错误，避免页面残留过期结论
  const onCandidateIdChange = (text) => {
    setCandidateIdText(text);
    setCandidateResult(null);
    setCandidateErrors([]);
    setCandidateFormError('');
  };

  const onCandidateFreqChange = (text) => {
    setCandidateFreqText(text);
    setCandidateResult(null);
    setCandidateErrors([]);
    setCandidateFormError('');
  };

  // 候选评估只影响候选区：先清除本次候选结论，保留基线分析
  const onEvaluateCandidate = async () => {
    setCandidateResult(null);
    setCandidateErrors([]);
    setCandidateFormError('');

    const input = parseInputSafely(rawText);
    if (!Array.isArray(input)) {
      setCandidateFormError('基线输入不可用，请重新上传频道 JSON 文件');
      return;
    }

    // 超出安全整数范围的编号在发请求前拒绝：Number() 会静默舍入成相邻整数
    const parsedId = parseCandidateId(candidateIdText);
    if (parsedId.error) {
      setCandidateFormError('候选评估请求校验未通过');
      setCandidateErrors([
        { index: null, field: 'candidate.id', message: parsedId.error },
      ]);
      return;
    }

    setCandidatePending(true);
    try {
      const outcome = await evaluateCandidate(input, {
        id: parsedId.value,
        frequency: parseCandidateField(candidateFreqText),
      });
      if (outcome.ok) {
        setCandidateResult({
          kind: outcome.body.status === 'safe' ? 'safe' : 'conflict',
          body: outcome.body,
        });
      } else {
        setCandidateErrors(outcome.errors);
        setCandidateFormError(outcome.message);
      }
    } finally {
      setCandidatePending(false);
    }
  };

  const onDownload = () => {
    if (!result) return;
    const payload = buildDownloadPayload(parseInputSafely(rawText), result.body);
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `im3-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const busy = pending || candidatePending;

  return (
    <main className="page">
      <header>
        <h1>无线话筒三阶互调（IM3）频率协调</h1>
        <p className="subtitle">
          对每对发射频率计算 2f₁−f₂ 与 2f₂−f₁，互调产物落入第三只频道
          ±0.075 MHz 接收通道即判冲突。全部运算以整数 kHz 完成，频段 470.000–694.000
          MHz，刻度 0.025 MHz，频道数 2–64。
        </p>
      </header>

      <section className="uploader" aria-label="数据上传">
        <input
          ref={fileInputRef}
          id="file-input"
          data-testid="file-input"
          type="file"
          accept="application/json,.json"
          onChange={onInputChange}
          disabled={busy}
        />
        <button
          type="button"
          data-testid="sample-button"
          onClick={onAnalyzeSample}
          disabled={busy}
        >
          使用示例数据分析
        </button>
        {fileName && <span className="filename" data-testid="filename">已选择：{fileName}</span>}
        {pending && <span className="pending" data-testid="pending">分析中…</span>}
      </section>

      {formError && (
        <section className="panel error-panel" data-testid="form-error" role="alert">
          <h2>无法分析</h2>
          <p>{formError}</p>
          {errors.length > 0 && <ErrorList errors={errors} />}
        </section>
      )}

      {result && result.kind === 'clear' && (
        <ClearPanel body={result.body} onDownload={onDownload} />
      )}
      {result && result.kind === 'conflict' && (
        <ConflictPanel
          body={result.body}
          onDownload={onDownload}
          selectedId={selectedChannelId}
          onToggleChannel={onToggleChannel}
        />
      )}

      {result && (
        <CandidateSection
          idText={candidateIdText}
          freqText={candidateFreqText}
          onIdChange={onCandidateIdChange}
          onFreqChange={onCandidateFreqChange}
          onEvaluate={onEvaluateCandidate}
          pending={candidatePending}
          busy={busy}
          result={candidateResult}
          errors={candidateErrors}
          formError={candidateFormError}
        />
      )}

      {!result && !formError && (
        <section className="panel hint" data-testid="hint">
          <h2>等待数据</h2>
          <p>上传 JSON 文件后立即分析。文件内容示例：</p>
          <pre>{SAMPLE_JSON}</pre>
          <ul>
            <li>每项仅含 <code>id</code>（唯一整数编号）与 <code>frequency</code>（MHz 数值）</li>
            <li>任一字段非法、编号重复或数值非有限（NaN/Infinity），整批返回 422 并逐项列出错误</li>
          </ul>
        </section>
      )}
    </main>
  );
}

function parseInputSafely(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function ErrorList({ errors }) {
  return (
    <ol className="error-list" data-testid="error-list">
      {errors.map((err, idx) => (
        <li key={idx} data-testid="error-item">
          {err.index == null ? '' : `第 ${err.index + 1} 项`}
          {err.field ? `（字段 ${err.field}）` : ''}
          {err.index == null && !err.field ? '' : '：'}
          {err.message}
        </li>
      ))}
    </ol>
  );
}

function ClearPanel({ body, onDownload }) {
  return (
    <section className="panel clear" data-testid="result-clear" role="status">
      <h2>✅ 可用（CLEAR）</h2>
      <p>
        已分析 <strong>{body.channel_count}</strong> 个频道，未发现落入第三只频道
        ±0.075 MHz 接收通道的三阶互调产物，该频率方案可上电使用。
      </p>
      <ChannelTable channels={body.channels} />
      <button type="button" data-testid="download-button" onClick={onDownload}>
        下载分析结果 JSON
      </button>
    </section>
  );
}

function ConflictPanel({ body, onDownload, selectedId, onToggleChannel }) {
  const summary = summarizeStatus(body);
  // 选中频道时只保留它参与的冲突；过滤不改变原始明细顺序
  const visibleConflicts = selectedId == null
    ? body.conflicts
    : body.conflicts.filter((c) => conflictInvolvesChannel(c, selectedId));
  return (
    <section className="panel conflict" data-testid="result-conflict" role="alert">
      <h2>⚠️ 冲突（CONFLICT）</h2>
      <p>
        已分析 <strong>{summary.channelCount}</strong> 个频道，发现{' '}
        <strong data-testid="conflict-count">{summary.conflictCount}</strong>{' '}
        处三阶互调冲突。发射机上电前请调整下列来源或受影响频道。
      </p>

      {selectedId != null && (
        <p className="channel-filter" data-testid="channel-filter-banner" role="status">
          已收窄为与频道 <strong>#{selectedId}</strong> 直接相关的{' '}
          <strong data-testid="filtered-conflict-count">{visibleConflicts.length}</strong>{' '}
          条冲突（共 {body.conflicts.length} 条）。再次点击该频道行即可恢复全部。
        </p>
      )}

      <ol className="conflict-list" data-testid="conflict-list">
        {visibleConflicts.map((c, idx) => (
          <ConflictCard key={idx} conflict={c} />
        ))}
      </ol>

      <ChannelTable
        channels={body.channels}
        selectedId={selectedId}
        onToggleChannel={onToggleChannel}
      />
      <button type="button" data-testid="download-button" onClick={onDownload}>
        下载分析结果 JSON（含输入与冲突明细）
      </button>
    </section>
  );
}

function CandidateSection({
  idText,
  freqText,
  onIdChange,
  onFreqChange,
  onEvaluate,
  pending,
  busy,
  result,
  errors,
  formError,
}) {
  return (
    <section className="panel candidate" data-testid="candidate-panel" aria-label="候选频点评估">
      <h2>候选频点评估</h2>
      <p className="candidate-hint">
        基线分析已完成。填写待加入话筒的编号与频率，先确认它不会引入新的三阶互调，
        再决定上电。
      </p>
      <div className="candidate-form">
        <label>
          候选编号
          <input
            type="text"
            inputMode="numeric"
            data-testid="candidate-id-input"
            placeholder="如 44"
            value={idText}
            onChange={(e) => onIdChange(e.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          候选频率 (MHz)
          <input
            type="text"
            inputMode="decimal"
            data-testid="candidate-frequency-input"
            placeholder="如 535.000"
            value={freqText}
            onChange={(e) => onFreqChange(e.target.value)}
            disabled={busy}
          />
        </label>
        <button
          type="button"
          data-testid="candidate-evaluate-button"
          onClick={onEvaluate}
          disabled={busy}
        >
          评估候选频点
        </button>
        {pending && <span className="pending" data-testid="candidate-pending">评估中…</span>}
      </div>

      {formError && (
        <div className="candidate-error" data-testid="candidate-error" role="alert">
          <p>{formError}</p>
          {errors.length > 0 && <ErrorList errors={errors} />}
        </div>
      )}

      {result && result.kind === 'safe' && (
        <div className="candidate-safe" data-testid="candidate-safe" role="status">
          <h3>✅ 可安全加入</h3>
          <p>
            候选频道 <strong>#{result.body.candidate.id}</strong>（
            {formatMHzWithUnit(result.body.candidate.frequency_khz)}）
            不会引入新的三阶互调冲突，可上电加入当前方案。
          </p>
        </div>
      )}

      {result && result.kind === 'conflict' && (
        <div className="candidate-conflict" data-testid="candidate-conflict" role="alert">
          <h3>⚠️ 候选将引入新增冲突</h3>
          <p>
            候选频道 <strong>#{result.body.candidate.id}</strong>（
            {formatMHzWithUnit(result.body.candidate.frequency_khz)}）加入后将新增{' '}
            <strong data-testid="candidate-conflict-count">
              {result.body.new_conflict_count}
            </strong>{' '}
            处三阶互调冲突，上电前请调整。以下仅为新增冲突，不含基线已有冲突。
          </p>
          <ol className="conflict-list" data-testid="candidate-conflict-list">
            {result.body.new_conflicts.map((c, idx) => (
              <ConflictCard key={idx} conflict={c} />
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function ConflictCard({ conflict: c }) {
  return (
    <li className="conflict-card" data-testid="conflict-item">
      <div className="conflict-head">
        <span className="badge">受影响频道 #{c.victim.id}</span>
        <span className="freq">接收频率 {formatMHzWithUnit(c.victim.frequency_khz)}</span>
        <span className="distance">
          产物偏差 {c.distance_khz} kHz ＝ {(c.distance_khz / 1000).toFixed(3)} MHz
        </span>
      </div>
      <p className="formula" data-testid="conflict-formula">
        计算式：{c.formula}
      </p>
      <p className="product">
        互调产物频率：<strong>{formatMHzWithUnit(c.product_khz)}</strong>
      </p>
      <table className="three-channels" data-testid="three-channels">
        <thead>
          <tr>
            <th>角色</th>
            <th>频道编号</th>
            <th>频率</th>
            <th>系数</th>
          </tr>
        </thead>
        <tbody>
          {c.sources.map((s) => (
            <tr key={s.id} className="row-source">
              <td>来源（发射机）</td>
              <td>#{s.id}</td>
              <td>{formatMHzWithUnit(s.frequency_khz)}</td>
              <td>×{s.coefficient}</td>
            </tr>
          ))}
          <tr className="row-victim">
            <td>受影响（接收机）</td>
            <td>#{c.victim.id}</td>
            <td>{formatMHzWithUnit(c.victim.frequency_khz)}</td>
            <td>—</td>
          </tr>
        </tbody>
      </table>
    </li>
  );
}

function ChannelTable({ channels, selectedId = null, onToggleChannel = null }) {
  if (!channels?.length) return null;
  // 冲突结果中传入 onToggleChannel：点击行收窄/恢复该频道的冲突明细
  const interactive = typeof onToggleChannel === 'function';
  return (
    <details className="channel-details">
      <summary>
        查看输入的 {channels.length} 个频道
        {interactive ? '（点击行可只查看该频道参与的冲突）' : ''}
      </summary>
      <table className="channel-table" data-testid="channel-table">
        <thead>
          <tr>
            <th>编号</th>
            <th>频率 (MHz)</th>
            <th>角色</th>
            <th>来源次数</th>
            <th>受影响次数</th>
          </tr>
        </thead>
        <tbody>
          {channels.map((ch) => {
            const selected = interactive && ch.id === selectedId;
            return (
              <tr
                key={ch.id}
                data-testid="channel-row"
                data-channel-id={ch.id}
                className={[
                  interactive ? 'channel-row--interactive' : '',
                  selected ? 'channel-row--selected' : '',
                ].filter(Boolean).join(' ') || undefined}
                aria-pressed={interactive ? selected : undefined}
                tabIndex={interactive ? 0 : undefined}
                onClick={interactive ? () => onToggleChannel(ch.id) : undefined}
                onKeyDown={
                  interactive
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onToggleChannel(ch.id);
                        }
                      }
                    : undefined
                }
              >
                <td>#{ch.id}</td>
                <td>{formatMHz(ch.frequency_khz)}</td>
                <td data-testid="channel-role">{channelRoleLabel(ch.role)}</td>
                <td>{ch.source_count ?? 0}</td>
                <td>{ch.victim_count ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}
