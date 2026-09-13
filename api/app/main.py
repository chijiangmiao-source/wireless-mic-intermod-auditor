"""FastAPI 入口：接收频道 JSON，返回三阶互调冲突分析。"""

from __future__ import annotations

import json
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .im3 import find_conflicts
from .validation import validate_channels

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


@app.post("/api/conflicts")
async def analyze(request: Request) -> JSONResponse:
    raw = await request.body()
    if not raw.strip():
        return JSONResponse(
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
        return JSONResponse(
            status_code=422,
            content={
                "message": f"JSON 无法解析：{exc}",
                "errors": [{"index": None, "field": None,
                            "message": f"JSON 无法解析：{exc}"}],
            },
        )

    channels, errors = validate_channels(payload)
    if errors:
        return JSONResponse(
            status_code=422,
            content={"message": "频道数据校验未通过", "errors": errors},
        )

    conflicts = find_conflicts(channels)
    return JSONResponse(
        status_code=200,
        content={
            "status": "conflict" if conflicts else "clear",
            "channel_count": len(channels),
            "channels": [
                {"id": channel_id, "frequency_khz": khz,
                 "frequency_mhz": khz / 1000}
                for channel_id, khz in channels
            ],
            "conflict_count": len(conflicts),
            "conflicts": conflicts,
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
