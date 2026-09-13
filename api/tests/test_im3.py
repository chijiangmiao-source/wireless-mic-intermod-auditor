"""IM3 整数 kHz 计算与排序/去重单元测试。"""

from app.im3 import find_conflicts


def test_basic_pair_hits_with_reciprocal_conflict():
    # 480 / 500 -> 2*500-480 = 520，命中第三频道 520.000。
    # 互调几何上必然存在镜像冲突：2*500-520 = 480 命中频道1。
    conflicts = find_conflicts(
        [(1, 480_000), (2, 500_000), (3, 520_000)]
    )
    assert len(conflicts) == 2

    primary = next(c for c in conflicts if c["victim"]["id"] == 3)
    assert primary["product_khz"] == 520_000
    assert primary["doubled_source_id"] == 2
    assert [s["id"] for s in primary["sources"]] == [1, 2]
    assert primary["distance_khz"] == 0
    assert "2×500.000" in primary["formula"]
    assert "480.000" in primary["formula"] and "520.000" in primary["formula"]

    mirror = next(c for c in conflicts if c["victim"]["id"] == 1)
    assert mirror["product_khz"] == 480_000
    assert [s["id"] for s in mirror["sources"]] == [2, 3]
    assert mirror["distance_khz"] == 0


def test_tolerance_75khz_inclusive_boundary():
    # 产物 510.000，受影响频道 510.075 -> 距离 75 kHz，恰好命中；
    # 镜像冲突 2*500-510.075=489.925 距频道 490.000 同为 75 kHz。
    conflicts = find_conflicts([(1, 500_000), (2, 490_000), (7, 510_075)])
    assert len(conflicts) == 2
    assert {c["victim"]["id"] for c in conflicts} == {2, 7}
    assert all(c["distance_khz"] == 75 for c in conflicts)


def test_distance_100khz_misses():
    # 产物 510.000，受影响频道 510.100 -> 距离 100 kHz，不冲突
    conflicts = find_conflicts([(1, 500_000), (2, 490_000), (7, 510_100)])
    assert conflicts == []


def test_source_cannot_be_victim():
    # 480/490 -> 产物 470、500；只有来源两只频道时无第三方受害者
    conflicts = find_conflicts([(1, 480_000), (2, 490_000)])
    assert conflicts == []


def test_negative_product_never_hits_in_band():
    # 470 与 694 配对会产生 246 与 918，均落在频段外，无第三频道可命中
    conflicts = find_conflicts(
        [(1, 470_000), (2, 694_000), (3, 600_000)]
    )
    assert conflicts == []


def test_dedupe_same_product_sources_victim():
    # 两对不同来源可产生相同产物（470 = 2*480-490 = 2*475-480 等情形），
    # 相同 (产物, 来源对, 受影响频道) 只能出现一次
    conflicts = find_conflicts(
        [(1, 480_000), (2, 490_000), (3, 500_000), (9, 470_000)]
    )
    keys = [
        (c["product_khz"], tuple(s["id"] for s in c["sources"]), c["victim"]["id"])
        for c in conflicts
    ]
    assert len(keys) == len(set(keys))
    # 频道9(470) 被 2*480-490 命中
    assert (470_000, (1, 2), 9) in keys
    # 470 = 2*490-510(不存在)；2*490-480=500 命中频道3
    assert (500_000, (1, 2), 3) in keys


def test_sort_order_victim_freq_then_ids():
    conflicts = find_conflicts(
        [(10, 480_000), (20, 500_000), (30, 460_000), (40, 520_000)]
    )
    order = [
        (c["victim"]["frequency_khz"], c["victim"]["id"],
         c["sources"][0]["id"], c["sources"][1]["id"])
        for c in conflicts
    ]
    assert order == sorted(order)
    # 460 频道在 520 频道之前
    assert order[0][0] == 460_000
    assert order[-1][0] == 520_000


def test_integer_khz_no_float_drift():
    # 0.025 刻度的奇数千赫组合不能出现浮点漂移
    conflicts = find_conflicts(
        [(1, 470_025), (2, 470_075), (3, 469_975)]
    )
    assert conflicts and all(isinstance(c["product_khz"], int) for c in conflicts)
    assert conflicts[0]["product_khz"] == 469_975


def test_same_frequency_pairs_are_degenerate_and_skipped():
    # 编号不同但频率相同：2f−f=f 不构成互调产物
    assert find_conflicts([(1, 480_000), (2, 480_000)]) == []
    assert find_conflicts(
        [(1, 480_000), (2, 480_000), (3, 480_000)]
    ) == []
    # 同频对与异频对并存时，只有异频对产生互调
    conflicts = find_conflicts(
        [(1, 480_000), (2, 480_000), (3, 500_000), (4, 460_000)]
    )
    assert all(
        tuple(s["id"] for s in c["sources"]) != (1, 2)
        for c in conflicts
    )
    # 2*480-500=460 命中频道4
    assert (460_000, 3) in {(c["product_khz"], c["victim"]["id"]) for c in conflicts} or \
        any(c["victim"]["id"] == 4 for c in conflicts)
