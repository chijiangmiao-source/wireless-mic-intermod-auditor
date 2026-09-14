"""候选频点影响接口 /api/candidate 的真实 HTTP 集成测试。

三条主链路：安全候选、产生新增冲突的候选、非法候选（422 且错误可定位）。
另验证差集的确定性身份与原冲突接口行为不变。
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

# 基线无任何冲突的频道方案
CLEAR_CHANNELS = [
    {"id": 1, "frequency": 470.0},
    {"id": 2, "frequency": 600.0},
    {"id": 3, "frequency": 690.0},
]


def post_candidate(channels, candidate):
    return client.post(
        "/api/candidate", json={"channels": channels, "candidate": candidate}
    )


def test_safe_candidate_returns_safe_and_no_new_conflicts():
    resp = post_candidate(CLEAR_CHANNELS, {"id": 4, "frequency": 500.0})
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "safe"
    assert body["new_conflict_count"] == 0
    assert body["new_conflicts"] == []
    assert body["candidate"] == {
        "id": 4, "frequency_khz": 500_000, "frequency_mhz": 500.0
    }
    # 只返回候选结论与新增冲突，不回显基线冲突明细
    assert "conflicts" not in body
    assert "channels" not in body


def test_candidate_introducing_new_conflicts_as_source():
    # 2×535.000 − 470.000 = 600.000 命中频道2；
    # 2×535.000 − 600.000 = 470.000 命中频道1。候选 #4 均为来源。
    resp = post_candidate(CLEAR_CHANNELS, {"id": 4, "frequency": 535.0})
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "conflict"
    assert body["new_conflict_count"] == 2

    by_victim = {c["victim"]["id"]: c for c in body["new_conflicts"]}
    assert set(by_victim) == {1, 2}

    hit_600 = by_victim[2]
    assert hit_600["product_khz"] == 600_000
    assert hit_600["distance_khz"] == 0
    assert hit_600["doubled_source_id"] == 4
    assert [s["id"] for s in hit_600["sources"]] == [1, 4]
    assert "2×535.000 MHz − 470.000 MHz = 600.000 MHz" in hit_600["formula"]

    hit_470 = by_victim[1]
    assert hit_470["product_khz"] == 470_000
    assert [s["id"] for s in hit_470["sources"]] == [2, 4]


def test_candidate_can_be_victim_and_source_in_new_conflicts():
    # 基线只有两只频道（不可能有冲突）；候选 #44 落在 2×500−480=520 上
    channels = [
        {"id": 11, "frequency": 480.0},
        {"id": 22, "frequency": 500.0},
    ]
    resp = post_candidate(channels, {"id": 44, "frequency": 520.0})
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "conflict"
    assert body["new_conflict_count"] == 2

    # 候选作为受影响频道：2×500.000 − 480.000 = 520.000 命中候选 #44
    as_victim = next(c for c in body["new_conflicts"] if c["victim"]["id"] == 44)
    assert as_victim["product_khz"] == 520_000
    assert [s["id"] for s in as_victim["sources"]] == [11, 22]
    assert "2×500.000 MHz − 480.000 MHz = 520.000 MHz" in as_victim["formula"]

    # 候选作为来源：2×500.000 − 520.000 = 480.000 命中频道 #11
    as_source = next(c for c in body["new_conflicts"] if c["victim"]["id"] == 11)
    assert [s["id"] for s in as_source["sources"]] == [22, 44]
    assert as_source["doubled_source_id"] == 22


def test_new_conflicts_are_exactly_the_deterministic_diff():
    # 与 /api/conflicts 交叉验证：新增冲突 ≡ 加入后冲突 − 基线冲突（规范身份差集）
    channels = [
        {"id": 11, "frequency": 480.0},
        {"id": 22, "frequency": 500.0},
        {"id": 33, "frequency": 520.0},
    ]
    candidate = {"id": 44, "frequency": 520.025}

    baseline = client.post("/api/conflicts", json=channels).json()["conflicts"]
    after = client.post("/api/conflicts", json=[*channels, candidate]).json()["conflicts"]

    def identity(c):
        return (
            c["product_khz"],
            c["sources"][0]["id"],
            c["sources"][1]["id"],
            c["victim"]["id"],
        )

    baseline_keys = {identity(c) for c in baseline}
    expected_new = [c for c in after if identity(c) not in baseline_keys]
    assert expected_new  # 该候选确实引入新增冲突

    resp = post_candidate(channels, candidate)
    assert resp.status_code == 200
    body = resp.json()
    assert body["new_conflicts"] == expected_new
    assert body["new_conflict_count"] == len(expected_new)
    # 候选既是新增冲突里的受影响频道，也是来源
    assert any(c["victim"]["id"] == 44 for c in body["new_conflicts"])
    assert any(
        44 in (s["id"] for s in c["sources"]) for c in body["new_conflicts"]
    )
    # 新增冲突保持整批排序约定（受影响频率 → 编号 → 来源编号）
    order = [
        (c["victim"]["frequency_khz"], c["victim"]["id"],
         c["sources"][0]["id"], c["sources"][1]["id"])
        for c in body["new_conflicts"]
    ]
    assert order == sorted(order)


def test_candidate_evaluation_is_deterministic():
    payload = {"channels": CLEAR_CHANNELS, "candidate": {"id": 4, "frequency": 535.0}}
    first = client.post("/api/candidate", json=payload).json()
    second = client.post("/api/candidate", json=payload).json()
    assert first == second


@pytest.mark.parametrize(
    "candidate, field, fragment",
    [
        # 候选编号与现有频道重复
        ({"id": 2, "frequency": 500.0}, "candidate.id", "重复"),
        # 频率偏离 25 kHz 刻度
        ({"id": 4, "frequency": 500.013}, "candidate.frequency", "0.025 MHz 刻度"),
        # 频率越界
        ({"id": 4, "frequency": 469.975}, "candidate.frequency", "超出允许范围"),
        ({"id": 4, "frequency": 694.025}, "candidate.frequency", "超出允许范围"),
        # 编号不是整数
        ({"id": "4", "frequency": 500.0}, "candidate.id", "整数"),
        # 编号超出浏览器安全整数范围：不得静默舍入成相邻整数再评估
        ({"id": 2**53, "frequency": 500.0}, "candidate.id", "安全整数"),
        ({"id": 2**53 + 1, "frequency": 500.0}, "candidate.id", "安全整数"),
        ({"id": -(2**53), "frequency": 500.0}, "candidate.id", "安全整数"),
        # 频率不是数值
        ({"id": 4, "frequency": "500.0"}, "candidate.frequency", "数值"),
    ],
)
def test_invalid_candidate_returns_422_with_located_errors(
    candidate, field, fragment
):
    resp = post_candidate(CLEAR_CHANNELS, candidate)
    assert resp.status_code == 422
    body = resp.json()
    assert body["message"]
    assert "new_conflicts" not in body
    matched = [e for e in body["errors"] if e["field"] == field]
    assert matched, body["errors"]
    assert any(fragment in e["message"] for e in matched)


def test_candidate_missing_and_extra_fields_rejected():
    resp = post_candidate(CLEAR_CHANNELS, {"id": 4})
    assert resp.status_code == 422
    assert any(
        e["field"] == "candidate.frequency" and "缺少" in e["message"]
        for e in resp.json()["errors"]
    )

    resp = post_candidate(
        CLEAR_CHANNELS, {"id": 4, "frequency": 500.0, "band": "UHF"}
    )
    assert resp.status_code == 422
    assert any("非法字段" in e["message"] for e in resp.json()["errors"])

    resp = post_candidate(CLEAR_CHANNELS, "not-an-object")
    assert resp.status_code == 422
    assert any(e["field"] == "candidate" for e in resp.json()["errors"])


def test_candidate_request_structure_rejected():
    # 顶层不是对象
    resp = client.post("/api/candidate", json=[{"id": 1, "frequency": 470.0}])
    assert resp.status_code == 422
    assert resp.json()["errors"]

    # 缺少 channels / candidate
    resp = client.post("/api/candidate", json={"channels": CLEAR_CHANNELS})
    assert resp.status_code == 422
    assert any(e["field"] == "candidate" for e in resp.json()["errors"])

    resp = client.post("/api/candidate", json={"candidate": {"id": 4, "frequency": 500.0}})
    assert resp.status_code == 422
    assert any(e["field"] == "channels" for e in resp.json()["errors"])

    # 顶层多余字段
    resp = client.post(
        "/api/candidate",
        json={"channels": CLEAR_CHANNELS,
              "candidate": {"id": 4, "frequency": 500.0},
              "note": "x"},
    )
    assert resp.status_code == 422
    assert any("非法字段" in e["message"] for e in resp.json()["errors"])


def test_candidate_endpoint_reuses_batch_validation_for_channels():
    # 基线数组本身的非法项仍按整批校验规则定位（index + field）
    bad_channels = [
        {"id": 1, "frequency": 470.013},
        {"id": 1, "frequency": 480.0},
    ]
    resp = post_candidate(bad_channels, {"id": 4, "frequency": 500.0})
    assert resp.status_code == 422
    errors = resp.json()["errors"]
    assert any(e["index"] == 0 and e["field"] == "frequency" for e in errors)
    assert any(e["index"] == 1 and e["field"] == "id" for e in errors)


def test_invalid_baseline_and_duplicate_candidate_id_reported_together():
    # 基线含非法频率（validate_channels 因此返回空 channels）时，
    # 候选编号与现有频道重复仍必须被同时定位，不能只返回基线频率错误
    bad_channels = [
        {"id": 1, "frequency": 470.013},
        {"id": 2, "frequency": 600.0},
    ]
    resp = post_candidate(bad_channels, {"id": 2, "frequency": 500.0})
    assert resp.status_code == 422
    errors = resp.json()["errors"]
    assert any(
        e["index"] == 0 and e["field"] == "frequency" for e in errors
    ), errors
    duplicate = [e for e in errors if e["field"] == "candidate.id"]
    assert duplicate, errors
    assert any("重复" in e["message"] for e in duplicate)
    # 合法的候选频率不应被报错
    assert not [e for e in errors if e["field"] == "candidate.frequency"]


def test_unsafe_integer_id_rejected_over_raw_json_wire():
    # 经真实 JSON 文本传输：9007199254740993 = 2^53+1 必须原样被拒绝，
    # 绝不能在服务端被舍入成相邻整数后参与评估
    raw = (
        b'{"channels":[{"id":1,"frequency":470.000},{"id":2,"frequency":600.000}],'
        b'"candidate":{"id":9007199254740993,"frequency":500.000}}'
    )
    resp = client.post(
        "/api/candidate",
        content=raw,
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 422
    errors = resp.json()["errors"]
    assert [e["field"] for e in errors] == ["candidate.id"]
    assert "9007199254740993" in errors[0]["message"]
    assert "安全整数" in errors[0]["message"]


def test_safe_integer_boundary_ids_accepted():
    # ±(2^53−1) 是可精确表示的边界，应正常通过编号校验
    for candidate_id in (2**53 - 1, -(2**53 - 1)):
        channels = [
            {"id": 1, "frequency": 470.0},
            {"id": 2, "frequency": 600.0},
        ]
        resp = post_candidate(channels, {"id": candidate_id, "frequency": 500.0})
        assert resp.status_code == 200, (candidate_id, resp.json())
        assert resp.json()["candidate"]["id"] == candidate_id


def test_candidate_endpoint_rejects_empty_and_malformed_body():
    resp = client.post("/api/candidate", content=b"")
    assert resp.status_code == 422

    resp = client.post(
        "/api/candidate",
        content="not json at all",
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 422
    assert "JSON 无法解析" in resp.json()["message"]


def test_original_conflicts_endpoint_shape_unchanged():
    # 原冲突接口不引入任何候选字段，结论与排序保持原行为
    payload = [
        {"id": 11, "frequency": 480.0},
        {"id": 22, "frequency": 500.0},
        {"id": 33, "frequency": 520.0},
    ]
    resp = client.post("/api/conflicts", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert set(body.keys()) == {
        "status", "channel_count", "channels", "conflict_count", "conflicts",
    }
    assert body["status"] == "conflict"
    assert body["conflict_count"] == 2
    order = [
        (c["victim"]["frequency_khz"], c["victim"]["id"],
         c["sources"][0]["id"], c["sources"][1]["id"])
        for c in body["conflicts"]
    ]
    assert order == sorted(order)
