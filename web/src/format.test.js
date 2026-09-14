import { describe, expect, it } from 'vitest';
import {
  buildDownloadPayload,
  channelDisplayName,
  channelRoleLabel,
  conflictInvolvesChannel,
  formatMHz,
  formatMHzWithUnit,
  summarizeStatus,
} from './format.js';

describe('formatMHz', () => {
  it('按整数 kHz 渲染三位小数，无浮点漂移', () => {
    expect(formatMHz(470025)).toBe('470.025');
    expect(formatMHz(512375)).toBe('512.375');
    expect(formatMHz(470000)).toBe('470.000');
  });

  it('支持负频率（带外互调产物）', () => {
    expect(formatMHz(-10000)).toBe('-10.000');
  });

  it('非有限输入回退为破折号', () => {
    expect(formatMHz(NaN)).toBe('—');
    expect(formatMHzWithUnit(undefined)).toBe('— MHz');
  });
});

describe('summarizeStatus', () => {
  it('识别可用与冲突', () => {
    expect(summarizeStatus({ status: 'clear', channel_count: 3 })).toEqual({
      kind: 'clear',
      channelCount: 3,
    });
    const s = summarizeStatus({
      status: 'conflict',
      channel_count: 3,
      conflict_count: 2,
    });
    expect(s.kind).toBe('conflict');
    expect(s.conflictCount).toBe(2);
  });

  it('缺字段时安全回退', () => {
    expect(summarizeStatus(null)).toEqual({ kind: 'unknown' });
  });
});

describe('buildDownloadPayload', () => {
  it('同时包含输入频道与冲突明细', () => {
    const input = [{ id: 1, frequency: 480 }];
    const body = {
      status: 'conflict',
      channel_count: 3,
      conflict_count: 1,
      conflicts: [{ product_khz: 520000 }],
    };
    const payload = buildDownloadPayload(input, body);
    expect(payload.input_channels).toBe(input);
    expect(payload.conflicts).toEqual([{ product_khz: 520000 }]);
    expect(payload.status).toBe('conflict');
    expect(typeof payload.generated_at).toBe('string');
  });

  it('下载载荷结构固定，不含任何候选字段', () => {
    const payload = buildDownloadPayload([{ id: 1, frequency: 480 }], {
      status: 'clear',
      channel_count: 1,
      conflict_count: 0,
      conflicts: [],
    });
    expect(Object.keys(payload).sort()).toEqual([
      'channel_count',
      'conflict_count',
      'conflicts',
      'generated_at',
      'input_channels',
      'status',
    ]);
  });
});

describe('channelRoleLabel', () => {
  it('按后端 role 取值给出中文标签', () => {
    expect(channelRoleLabel('both')).toBe('来源 + 受影响');
    expect(channelRoleLabel('source')).toBe('来源');
    expect(channelRoleLabel('victim')).toBe('受影响');
    expect(channelRoleLabel('none')).toBe('无冲突');
  });

  it('未知或缺失角色回退为破折号（兼容未返回摘要的旧客户端数据）', () => {
    expect(channelRoleLabel(undefined)).toBe('—');
    expect(channelRoleLabel('unexpected')).toBe('—');
  });
});

describe('channelDisplayName', () => {
  it('返回去空白后的非空名称', () => {
    expect(channelDisplayName({ id: 1, name: ' 主唱麦 ' })).toBe('主唱麦');
  });

  it('缺省、非字符串或纯空白名称返回 null，调用方据此只显示编号', () => {
    expect(channelDisplayName({ id: 1 })).toBeNull();
    expect(channelDisplayName({ id: 1, name: undefined })).toBeNull();
    expect(channelDisplayName({ id: 1, name: '   ' })).toBeNull();
    expect(channelDisplayName({ id: 1, name: 5 })).toBeNull();
    expect(channelDisplayName(null)).toBeNull();
  });
});

describe('conflictInvolvesChannel', () => {
  const conflict = {
    victim: { id: 33 },
    sources: [{ id: 11 }, { id: 22 }],
  };

  it('频道作为受影响频道或任一来源都算参与', () => {
    expect(conflictInvolvesChannel(conflict, 33)).toBe(true);
    expect(conflictInvolvesChannel(conflict, 11)).toBe(true);
    expect(conflictInvolvesChannel(conflict, 22)).toBe(true);
    expect(conflictInvolvesChannel(conflict, 44)).toBe(false);
  });

  it('畸形输入安全返回 false', () => {
    expect(conflictInvolvesChannel(null, 11)).toBe(false);
    expect(conflictInvolvesChannel({}, 11)).toBe(false);
    expect(conflictInvolvesChannel({ victim: { id: 1 } }, 1)).toBe(true);
  });
});
