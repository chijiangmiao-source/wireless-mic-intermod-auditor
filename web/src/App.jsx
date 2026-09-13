import React, { useCallback, useRef, useState } from 'react';
import { analyzeChannels } from './api.js';
import {
  buildDownloadPayload,
  formatMHz,
  formatMHzWithUnit,
  summarizeStatus,
} from './format.js';

const SAMPLE_JSON = `[
  { "id": 11, "frequency": 480.000 },
  { "id": 22, "frequency": 500.000 },
  { "id": 33, "frequency": 520.000 }
]`;

export default function App() {
  const [fileName, setFileName] = useState('');
  const [rawText, setRawText] = useState('');
  // result: null（尚无结论）| { kind: 'clear'|'conflict', body, input }
  const [result, setResult] = useState(null);
  const [errors, setErrors] = useState([]);
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);
  const fileInputRef = useRef(null);

  // 任何新的提交都先清除旧结论与旧错误
  const resetConclusion = useCallback(() => {
    setResult(null);
    setErrors([]);
    setFormError('');
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
          disabled={pending}
        />
        <button
          type="button"
          data-testid="sample-button"
          onClick={onAnalyzeSample}
          disabled={pending}
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
        <ConflictPanel body={result.body} onDownload={onDownload} />
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

function ConflictPanel({ body, onDownload }) {
  const summary = summarizeStatus(body);
  return (
    <section className="panel conflict" data-testid="result-conflict" role="alert">
      <h2>⚠️ 冲突（CONFLICT）</h2>
      <p>
        已分析 <strong>{summary.channelCount}</strong> 个频道，发现{' '}
        <strong data-testid="conflict-count">{summary.conflictCount}</strong>{' '}
        处三阶互调冲突。发射机上电前请调整下列来源或受影响频道。
      </p>

      <ol className="conflict-list" data-testid="conflict-list">
        {body.conflicts.map((c, idx) => (
          <li key={idx} className="conflict-card" data-testid="conflict-item">
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
        ))}
      </ol>

      <ChannelTable channels={body.channels} />
      <button type="button" data-testid="download-button" onClick={onDownload}>
        下载分析结果 JSON（含输入与冲突明细）
      </button>
    </section>
  );
}

function ChannelTable({ channels }) {
  if (!channels?.length) return null;
  return (
    <details className="channel-details">
      <summary>查看输入的 {channels.length} 个频道</summary>
      <table className="channel-table" data-testid="channel-table">
        <thead>
          <tr>
            <th>编号</th>
            <th>频率 (MHz)</th>
          </tr>
        </thead>
        <tbody>
          {channels.map((ch) => (
            <tr key={ch.id}>
              <td>#{ch.id}</td>
              <td>{formatMHz(ch.frequency_khz)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
