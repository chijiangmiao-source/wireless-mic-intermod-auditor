// 与后端通信：直接发送 JSON 原文，由后端做全部整数 kHz 计算。
async function post(url, bodyText) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyText,
    });
  } catch (networkError) {
    return {
      ok: false,
      network: true,
      message: `无法连接分析服务：${networkError.message}`,
      errors: [],
    };
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (response.status === 422) {
    return {
      ok: false,
      status: 422,
      message: body?.message || '频道数据校验未通过',
      errors: Array.isArray(body?.errors) ? body.errors : [],
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: body?.message || `分析失败（HTTP ${response.status}）`,
      errors: [],
    };
  }
  return { ok: true, status: 200, body };
}

// 基线分析：发送文件原文到 /api/conflicts。
export function analyzeChannels(rawText) {
  return post('/api/conflicts', rawText);
}

// 候选评估：基线频道数组 + 单个候选频道，只返回候选结论与新增冲突。
export function evaluateCandidate(channels, candidate) {
  return post('/api/candidate', JSON.stringify({ channels, candidate }));
}
