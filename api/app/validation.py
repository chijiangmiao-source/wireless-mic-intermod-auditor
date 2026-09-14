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
# 编号必须能被浏览器/JSON 数字精确表示：超过该范围的整数在 JavaScript 中
# 会被静默舍入成相邻整数，故前后端一致拒绝（±(2^53−1)）
MAX_SAFE_INTEGER = 2**53 - 1


def is_int(value: Any) -> bool:
    """严格判定整数（bool 不算整数）。"""
    return isinstance(value, int) and not isinstance(value, bool)


def is_safe_integer(value: Any) -> bool:
    """判定可被浏览器精确表示的整数（bool 不算，超出安全整数范围不算）。"""
    return is_int(value) and abs(value) <= MAX_SAFE_INTEGER


def unsafe_id_error(channel_id: int) -> str:
    return (
        f"频道编号 {channel_id} 超出安全整数范围，"
        f"绝对值不能超过 {MAX_SAFE_INTEGER}（2^53−1），"
        f"否则浏览器与 JSON 无法精确表示该编号"
    )


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def check_frequency(value: Any) -> tuple[int | None, str | None]:
    """校验以 MHz 表示的数值频率。

    返回 ``(整数kHz, None)`` 或 ``(None, 错误消息)``；定位信息（index/field）
    由调用方按所在上下文补充。
    """
    if not is_number(value):
        return None, "频率必须是以 MHz 表示的数值"
    if not math.isfinite(value):
        return None, "频率必须是有限数值，不能为 NaN 或 Infinity"
    scaled = float(value) * 1000.0
    rounded = round(scaled)
    if abs(scaled - rounded) > _FREQUENCY_EPSILON_KHZ:
        return None, (f"频率 {value} MHz 必须精确落在 0.025 MHz 刻度上"
                      f"（最近刻度偏差 {abs(scaled - rounded) * 0.001:.6f} MHz）")
    khz = int(rounded)
    if khz % GRID_KHZ != 0:
        return None, f"频率 {value} MHz 必须精确落在 0.025 MHz 刻度上"
    if not (MIN_FREQUENCY_KHZ <= khz <= MAX_FREQUENCY_KHZ):
        return None, (f"频率 {value} MHz 超出允许范围 "
                      f"{MIN_FREQUENCY_KHZ // 1000}.000–"
                      f"{MAX_FREQUENCY_KHZ // 1000}.000 MHz")
    return khz, None


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
        id_ok = False
        if not is_int(channel_id):
            errors.append(
                {"index": index, "field": "id",
                 "message": "频道编号必须是整数"}
            )
        elif not is_safe_integer(channel_id):
            errors.append(
                {"index": index, "field": "id",
                 "message": unsafe_id_error(channel_id)}
            )
            seen_ids.add(channel_id)
        elif channel_id in seen_ids:
            errors.append(
                {"index": index, "field": "id",
                 "message": f"频道编号 {channel_id} 重复，每个编号必须唯一"}
            )
            seen_ids.add(channel_id)
        else:
            seen_ids.add(channel_id)
            id_ok = True

        frequency = item["frequency"]
        khz, frequency_error = check_frequency(frequency)
        if frequency_error is not None:
            errors.append(
                {"index": index, "field": "frequency", "message": frequency_error}
            )

        if id_ok and khz is not None:
            channels.append((channel_id, khz))

    if errors:
        return [], errors
    return channels, []


def extract_channel_ids(payload: Any) -> set[int]:
    """从原始频道数组收集所有可识别的整数编号（忽略结构非法项）。

    基线校验失败时 :func:`validate_channels` 会把 channels 置空；候选编号的
    重复判定仍需看到请求里**现有**的编号，因此直接从原始负载提取，
    保证基线频率非法与候选编号重复能在同一次 422 中同时定位。
    """
    ids: set[int] = set()
    if not isinstance(payload, list):
        return ids
    for item in payload:
        if isinstance(item, dict):
            value = item.get("id")
            if is_int(value):
                ids.add(value)
    return ids


def validate_candidate(
    item: Any, existing_ids: set[int]
) -> tuple[tuple[int, int] | None, list[dict]]:
    """校验单个候选频道（结构、编号、频率），并禁止与现有编号重复。

    错误沿用整批校验的 ``{index, field, message}`` 结构，``field`` 以
    ``candidate.`` 前缀定位到候选区。返回 ``((编号, 整数kHz) | None, errors)``。
    """
    errors: list[dict] = []

    if not isinstance(item, dict):
        errors.append(
            {"index": None, "field": "candidate",
             "message": "候选频道必须是包含 id 与 frequency 的对象"}
        )
        return None, errors

    extra = set(item.keys()) - {"id", "frequency"}
    missing = [f for f in ("id", "frequency") if f not in item]
    if extra:
        errors.append(
            {"index": None, "field": "candidate",
             "message": f"存在非法字段 {sorted(extra)}，每项只允许 id 与 frequency"}
        )
    for field in missing:
        errors.append(
            {"index": None, "field": f"candidate.{field}", "message": "缺少必填字段"}
        )
    if extra or missing:
        return None, errors

    candidate_id = item["id"]
    id_ok = False
    if not is_int(candidate_id):
        errors.append(
            {"index": None, "field": "candidate.id",
             "message": "频道编号必须是整数"}
        )
    elif not is_safe_integer(candidate_id):
        errors.append(
            {"index": None, "field": "candidate.id",
             "message": unsafe_id_error(candidate_id)}
        )
    elif candidate_id in existing_ids:
        errors.append(
            {"index": None, "field": "candidate.id",
             "message": f"候选编号 {candidate_id} 与现有频道重复，每个编号必须唯一"}
        )
    else:
        id_ok = True

    khz, frequency_error = check_frequency(item["frequency"])
    if frequency_error is not None:
        errors.append(
            {"index": None, "field": "candidate.frequency",
             "message": frequency_error}
        )

    if id_ok and khz is not None:
        return (candidate_id, khz), []
    return None, errors
