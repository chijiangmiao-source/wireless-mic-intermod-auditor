import { describe, expect, it } from 'vitest';
import {
  buildDownloadPayload,
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
});
