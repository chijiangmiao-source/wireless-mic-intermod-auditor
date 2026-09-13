// 展示层格式化工具。后端所有频率都附带整数 kHz 值，
// 这里统一由整数 kHz 渲染，杜绝 0.1 + 0.2 类浮点显示误差。

export function formatMHz(khz) {
  if (typeof khz !== 'number' || !Number.isFinite(khz)) return '—';
  const sign = khz < 0 ? '-' : '';
  const abs = Math.abs(khz);
  return `${sign}${(abs / 1000).toFixed(3)}`;
}

export function formatMHzWithUnit(khz) {
  return `${formatMHz(khz)} MHz`;
}

// 与服务端一致的响应结构归一化
export function summarizeStatus(body) {
  if (!body || typeof body !== 'object') return { kind: 'unknown' };
  if (body.status === 'clear') {
    return { kind: 'clear', channelCount: body.channel_count ?? 0 };
  }
  if (body.status === 'conflict') {
    return {
      kind: 'conflict',
      channelCount: body.channel_count ?? 0,
      conflictCount: body.conflict_count ?? body.conflicts?.length ?? 0,
    };
  }
  return { kind: 'unknown' };
}

export function buildDownloadPayload(input, body) {
  return {
    generated_at: new Date().toISOString(),
    status: body.status,
    channel_count: body.channel_count,
    conflict_count: body.conflict_count,
    input_channels: input,
    conflicts: body.conflicts,
  };
}
