"""三阶互调（IM3）冲突计算。

所有运算均以整数 kHz 完成，避免 MHz 浮点误差：
    2*f1 - f2、2*f2 - f1
若互调产物与“编号不同于两个来源”的第三只频道距离不超过 75 kHz
（即 0.075 MHz），则记为一次冲突。
"""

from __future__ import annotations

from typing import Any, Iterable

# 以整数 kHz 表示的常量
MIN_FREQUENCY_KHZ = 470_000
MAX_FREQUENCY_KHZ = 694_000
GRID_KHZ = 25
HIT_TOLERANCE_KHZ = 75


def find_conflicts(channels: Iterable[tuple[Any, int]]) -> list[dict[str, Any]]:
    """计算所有三阶互调冲突。

    参数:
        channels: ``(频道编号, 频率kHz)`` 的有序可迭代对象，频率已由上层校验为
            落在 25 kHz 刻度上的整数。

    返回:
        冲突字典列表，按 (受影响频道频率, 受影响频道编号, 来源小编号,
        来源大编号) 升序排列；相同 (产物, 来源对, 受影响频道) 只保留一次。
    """
    chans = list(channels)
    conflicts: list[dict[str, Any]] = []
    seen: set[tuple[int, Any, Any, Any]] = set()

    n = len(chans)
    for i in range(n):
        id_a, fa = chans[i]
        for j in range(i + 1, n):
            id_b, fb = chans[j]
            # 仅对“不同发射频率”的一对频道计算互调；
            # 同频退化 2f−f=f 不属于三阶互调（同频干扰不在本工具范围）。
            if fa == fb:
                continue
            # 同一对来源的两个互调产物；doubled 是系数为 2 的那只来源
            for product, doubled_id, doubled_f in (
                (2 * fa - fb, id_a, fa),
                (2 * fb - fa, id_b, fb),
            ):
                for k in range(n):
                    if k == i or k == j:
                        continue
                    victim_id, fv = chans[k]
                    distance = abs(product - fv)
                    if distance > HIT_TOLERANCE_KHZ:
                        continue

                    low_id, high_id = sorted((id_a, id_b))
                    # 去重键：产物 + 来源对 + 受影响频道
                    dedup_key = (product, low_id, high_id, victim_id)
                    if dedup_key in seen:
                        continue
                    seen.add(dedup_key)

                    sources = [
                        {
                            "id": id_a,
                            "frequency_khz": fa,
                            "frequency_mhz": fa / 1000,
                            "coefficient": 2 if id_a == doubled_id else 1,
                        },
                        {
                            "id": id_b,
                            "frequency_khz": fb,
                            "frequency_mhz": fb / 1000,
                            "coefficient": 2 if id_b == doubled_id else 1,
                        },
                    ]
                    sources.sort(key=lambda s: s["id"])

                    conflicts.append(
                        {
                            "victim": {
                                "id": victim_id,
                                "frequency_khz": fv,
                                "frequency_mhz": fv / 1000,
                            },
                            "sources": sources,
                            "doubled_source_id": doubled_id,
                            "product_khz": product,
                            "product_frequency_mhz": product / 1000,
                            "distance_khz": distance,
                            "formula": _formula(
                                doubled_id, doubled_f,
                                id_b if doubled_id == id_a else id_a,
                                fb if doubled_id == id_a else fa,
                                product,
                            ),
                        }
                    )

    conflicts.sort(
        key=lambda c: (
            c["victim"]["frequency_khz"],
            c["victim"]["id"],
            c["sources"][0]["id"],
            c["sources"][1]["id"],
        )
    )
    return conflicts


def _format_mhz(khz: int) -> str:
    """整数 kHz 格式化为三位小数 MHz 字符串。"""
    sign = "-" if khz < 0 else ""
    value = abs(khz)
    return f"{sign}{value // 1000}.{value % 1000:03d}"


def _formula(
    doubled_id: Any, doubled_f: int,
    other_id: Any, other_f: int,
    product: int,
) -> str:
    """生成可追溯的计算式，例如 ``2×480.000 − 490.000 = 470.000 MHz``。"""
    return (
        f"2×{_format_mhz(doubled_f)} MHz − {_format_mhz(other_f)} MHz "
        f"= {_format_mhz(product)} MHz"
        f"（2f(频道{doubled_id}) − f(频道{other_id})）"
    )
