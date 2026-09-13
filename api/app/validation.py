"""入站频道列表校验。

任一字段非法、编号重复、数值非有限或频率越界/离格，均逐条收集错误，
由调用方整批返回 HTTP 422。
"""

from __future__ import annotations

import math
from typing import Any

from .im3 import GRID_KHZ, MAX_FREQUENCY_KHZ, MIN_FREQUENCY_KHZ

MIN_CHANNELS = 2
MAX_CHANNELS = 64
# 频率解析容差（kHz），只用于吸收十进制浮点表示误差
_FREQUENCY_EPSILON_KHZ = 1e-6


def is_int(value: Any) -> bool:
    """严格判定整数（bool 不算整数）。"""
    return isinstance(value, int) and not isinstance(value, bool)


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def validate_channels(payload: Any) -> tuple[list[tuple[int, int]], list[dict]]:
    """校验已解析的 JSON 负载。

    返回 ``(channels, errors)``；channels 元素为 ``(编号, 整数kHz频率)``。
    errors 非空时 channels 为空列表。
    """
    errors: list[dict] = []

    if not isinstance(payload, list):
        errors.append(
            {
                "index": None,
                "field": None,
                "message": "请求体必须是频道数组，例如 "
                           '[{"id": 1, "frequency": 470.000}, ...]',
            }
        )
        return [], errors

    if not (MIN_CHANNELS <= len(payload) <= MAX_CHANNELS):
        errors.append(
            {
                "index": None,
                "field": None,
                "message": f"频道数量必须在 {MIN_CHANNELS} 至 {MAX_CHANNELS} 个之间，"
                           f"当前为 {len(payload)} 个",
            }
        )
        return [], errors

    channels: list[tuple[int, int]] = []
    seen_ids: set[int] = set()

    for index, item in enumerate(payload):
        if not isinstance(item, dict):
            errors.append(
                {"index": index, "field": None,
                 "message": "该频道必须是包含 id 与 frequency 的对象"}
            )
            continue

        extra = set(item.keys()) - {"id", "frequency"}
        missing = [f for f in ("id", "frequency") if f not in item]
        if extra:
            errors.append(
                {"index": index, "field": None,
                 "message": f"存在非法字段 {sorted(extra)}，每项只允许 id 与 frequency"}
            )
        for field in missing:
            errors.append(
                {"index": index, "field": field, "message": "缺少必填字段"}
            )
        if extra or missing:
            continue

        channel_id = item["id"]
        if not is_int(channel_id):
            errors.append(
                {"index": index, "field": "id",
                 "message": "频道编号必须是整数"}
            )
        elif channel_id in seen_ids:
            errors.append(
                {"index": index, "field": "id",
                 "message": f"频道编号 {channel_id} 重复，每个编号必须唯一"}
            )
            seen_ids.add(channel_id)
        else:
            seen_ids.add(channel_id)

        frequency = item["frequency"]
        khz: int | None = None
        if not is_number(frequency):
            errors.append(
                {"index": index, "field": "frequency",
                 "message": "频率必须是以 MHz 表示的数值"}
            )
        elif not math.isfinite(frequency):
            errors.append(
                {"index": index, "field": "frequency",
                 "message": "频率必须是有限数值，不能为 NaN 或 Infinity"}
            )
        else:
            scaled = float(frequency) * 1000.0
            rounded = round(scaled)
            if abs(scaled - rounded) > _FREQUENCY_EPSILON_KHZ:
                errors.append(
                    {"index": index, "field": "frequency",
                     "message": f"频率 {frequency} MHz 必须精确落在 0.025 MHz 刻度上"
                                f"（最近刻度偏差 {abs(scaled - rounded) * 0.001:.6f} MHz）"}
                )
            else:
                khz = int(rounded)
                if khz % GRID_KHZ != 0:
                    errors.append(
                        {"index": index, "field": "frequency",
                         "message": f"频率 {frequency} MHz 必须精确落在 0.025 MHz 刻度上"}
                    )
                    khz = None
                elif not (MIN_FREQUENCY_KHZ <= khz <= MAX_FREQUENCY_KHZ):
                    errors.append(
                        {"index": index, "field": "frequency",
                         "message": f"频率 {frequency} MHz 超出允许范围 "
                                    f"{MIN_FREQUENCY_KHZ // 1000}.000–"
                                    f"{MAX_FREQUENCY_KHZ // 1000}.000 MHz"}
                    )
                    khz = None

        if is_int(channel_id) and khz is not None:
            channels.append((channel_id, khz))

    if errors:
        return [], errors
    return channels, []
