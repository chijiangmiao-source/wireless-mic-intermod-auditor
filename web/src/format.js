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

// 频道在整批冲突中的角色标签，取值与后端 summarize_channel_roles 一致
const CHANNEL_ROLE_LABELS = {
  both: '来源 + 受影响',
  source: '来源',
  victim: '受影响',
  none: '无冲突',
};

export function channelRoleLabel(role) {
  return CHANNEL_ROLE_LABELS[role] ?? '—';
}

// 频道是否参与某条冲突：作为受影响频道，或作为两只来源之一
export function conflictInvolvesChannel(conflict, channelId) {
  if (!conflict || typeof conflict !== 'object') return false;
  if (conflict.victim?.id === channelId) return true;
  return (
    Array.isArray(conflict.sources)
    && conflict.sources.some((s) => s.id === channelId)
  );
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
