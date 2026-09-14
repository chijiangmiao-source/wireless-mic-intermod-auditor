"""FastAPI 入口：接收频道 JSON，返回三阶互调冲突分析。"""

from __future__ import annotations

import json
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .im3 import conflict_identity, find_conflicts, summarize_channel_roles
from .validation import extract_channel_ids, validate_candidate, validate_channels

app = FastAPI(
    title="无线话筒三阶互调频率协调 API",
    description="对 2–64 个电视频段无线话筒频道做 2f1−f2 / 2f2−f1 整数 kHz 互调分析",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


async def _parse_json_body(request: Request) -> tuple[Any, JSONResponse | None]:
    """读取并解析 JSON 请求体；失败时返回现成的 422 响应。"""
    raw = await request.body()
    if not raw.strip():
        return None, JSONResponse(
            status_code=422,
            content={
                "message": "请求体为空，必须提交 JSON 频道数组",
                "errors": [{"index": None, "field": None,
                            "message": "请求体为空，必须提交 JSON 频道数组"}],
            },
        )

    def _reject_non_finite(constant: str) -> None:
        raise ValueError(f"非法 JSON 常量 {constant}：频率与编号必须是有限数值")

    try:
        payload: Any = json.loads(raw.decode("utf-8"), parse_constant=_reject_non_finite)
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as exc:
        return None, JSONResponse(
            status_code=422,
            content={
                "message": f"JSON 无法解析：{exc}",
                "errors": [{"index": None, "field": None,
                            "message": f"JSON 无法解析：{exc}"}],
            },
        )
    return payload, None


@app.post("/api/conflicts")
async def analyze(request: Request) -> JSONResponse:
    payload, error_response = await _parse_json_body(request)
    if error_response is not None:
        return error_response

    channels, errors = validate_channels(payload, allow_name=True)
    if errors:
        return JSONResponse(
            status_code=422,
            content={"message": "频道数据校验未通过", "errors": errors},
        )

    conflicts = find_conflicts(channels)
    # 每个既有频道附加按规范冲突身份聚合的角色摘要（纯增量字段，
    # 未读取摘要的客户端仍可只消费原有字段）
    role_summary = summarize_channel_roles(channels, conflicts)
    channel_entries = []
    for (channel_id, khz, name), summary in zip(channels, role_summary):
        entry = {
            "id": channel_id,
            "frequency_khz": khz,
            "frequency_mhz": khz / 1000,
            "source_count": summary["source_count"],
            "victim_count": summary["victim_count"],
            "role": summary["role"],
        }
        # 规范化业务名称为纯增量字段：未填写时不输出 name 键，
        # 旧格式批次的响应与既有契约逐字段一致
        if name is not None:
            entry["name"] = name
        channel_entries.append(entry)
    return JSONResponse(
        status_code=200,
        content={
            "status": "conflict" if conflicts else "clear",
            "channel_count": len(channels),
            "channels": channel_entries,
            "conflict_count": len(conflicts),
            "conflicts": conflicts,
        },
    )


@app.post("/api/candidate")
async def candidate_impact(request: Request) -> JSONResponse:
    """评估单个候选频道加入后会**新增**哪些三阶互调冲突。

    请求体为 ``{"channels": [...], "candidate": {"id": ..., "frequency": ...}}``。
    复用整批校验与整数 kHz 计算，以 (受影响频道, 来源对, 产物) 为规范身份
    对加入前后的冲突做确定性差集，只返回候选结论与新增冲突。
    """
    payload, error_response = await _parse_json_body(request)
    if error_response is not None:
        return error_response

    if not isinstance(payload, dict):
        return JSONResponse(
            status_code=422,
            content={
                "message": "请求体必须是包含 channels 与 candidate 的对象",
                "errors": [{"index": None, "field": None,
                            "message": "请求体必须是包含 channels 与 candidate 的对象，"
                                       "例如 {\"channels\": [...], "
                                       "\"candidate\": {\"id\": 4, \"frequency\": 500.000}}"}],
            },
        )

    structural_errors: list[dict] = []
    extra_keys = sorted(set(payload.keys()) - {"channels", "candidate"})
    if extra_keys:
        structural_errors.append(
            {"index": None, "field": None,
             "message": f"存在非法字段 {extra_keys}，顶层只允许 channels 与 candidate"}
        )
    for key in ("channels", "candidate"):
        if key not in payload:
            structural_errors.append(
                {"index": None, "field": key, "message": "缺少必填字段"}
            )
    if structural_errors:
        return JSONResponse(
            status_code=422,
            content={"message": "候选评估请求校验未通过", "errors": structural_errors},
        )

    channels, errors = validate_channels(payload["channels"])
    # 基线校验失败时 channels 为空，仍需基于原始负载中的现有编号做候选重复判定，
    # 使基线频率错误与候选编号重复在同一次 422 中同时定位
    existing_ids = {channel_id for channel_id, _khz, _name in channels}
    if errors:
        existing_ids = extract_channel_ids(payload["channels"])
    candidate, candidate_errors = validate_candidate(
        payload["candidate"], existing_ids
    )
    errors.extend(candidate_errors)
    if errors:
        return JSONResponse(
            status_code=422,
            content={"message": "候选评估请求校验未通过", "errors": errors},
        )

    baseline_identities = {
        conflict_identity(conflict) for conflict in find_conflicts(channels)
    }
    after_conflicts = find_conflicts([*channels, candidate])
    new_conflicts = [
        conflict for conflict in after_conflicts
        if conflict_identity(conflict) not in baseline_identities
    ]

    candidate_id, candidate_khz = candidate
    return JSONResponse(
        status_code=200,
        content={
            "status": "conflict" if new_conflicts else "safe",
            "candidate": {"id": candidate_id,
                          "frequency_khz": candidate_khz,
                          "frequency_mhz": candidate_khz / 1000},
            "new_conflict_count": len(new_conflicts),
            "new_conflicts": new_conflicts,
        },
    )


@app.exception_handler(RequestValidationError)
async def malformed_request(_request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "message": "请求格式不合法",
            "errors": [
                {"index": None, "field": ".".join(str(p) for p in err.get("loc", [])),
                 "message": err.get("msg", "请求不合法")}
                for err in exc.errors()
            ],
        },
    )
