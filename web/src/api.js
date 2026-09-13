// 与后端 /api/conflicts 通信：直接发送文件原文，由后端做全部整数 kHz 计算。
export async function analyzeChannels(rawText) {
  let response;
  try {
    response = await fetch('/api/conflicts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: rawText,
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
