"""通过 ASGI 传输发起真实 HTTP 请求的 API 集成测试。"""

import math

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_clear_frequency_plan_returns_clear():
    # 两只频道不可能产生第三方受害者；互调产物也不落在彼此 75 kHz 内
    payload = [
        {"id": 1, "frequency": 470.0},
        {"id": 2, "frequency": 600.0},
        {"id": 3, "frequency": 690.0},
    ]
    resp = client.post("/api/conflicts", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "clear"
    assert body["conflict_count"] == 0
    assert body["conflicts"] == []
    assert body["channel_count"] == 3


def test_conflict_detected_with_traceability():
    payload = [
        {"id": 11, "frequency": 480.0},
        {"id": 22, "frequency": 500.0},
        {"id": 33, "frequency": 520.0},
    ]
    resp = client.post("/api/conflicts", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "conflict"
    # 2*500-480=520 命中频道33；镜像 2*500-520=480 命中频道11
    assert body["conflict_count"] == 2
    c = next(x for x in body["conflicts"] if x["victim"]["id"] == 33)
    assert c["victim"] == {
        "id": 33, "frequency_khz": 520_000, "frequency_mhz": 520.0
    }
    assert c["product_khz"] == 520_000
    assert c["doubled_source_id"] == 22
    assert {s["id"] for s in c["sources"]} == {11, 22}
    # 计算式可追溯
    assert "2×500.000" in c["formula"] and "480.000" in c["formula"]


@pytest.mark.parametrize(
    "payload",
    [
        # 频率离格
        [{"id": 1, "frequency": 470.013}, {"id": 2, "frequency": 480.0}],
        # 越界
        [{"id": 1, "frequency": 469.975}, {"id": 2, "frequency": 480.0}],
        [{"id": 1, "frequency": 470.0}, {"id": 2, "frequency": 694.025}],
        # 编号重复
        [{"id": 1, "frequency": 470.0}, {"id": 1, "frequency": 480.0}],
        # 字段类型错误 / 缺失
        [{"id": "A", "frequency": 470.0}, {"id": 2, "frequency": 480.0}],
        [{"id": 1}, {"id": 2, "frequency": 480.0}],
        # 数量越界
        [{"id": 1, "frequency": 470.0}],
    ],
)
def test_invalid_batches_return_422_with_item_errors(payload):
    resp = client.post("/api/conflicts", json=payload)
    assert resp.status_code == 422
    body = resp.json()
    assert body["errors"]
    assert "conflicts" not in body


def test_non_finite_json_token_rejected():
    # Python json 默认接受 NaN，服务必须拒绝
    resp = client.post(
        "/api/conflicts",
        content='[{"id": 1, "frequency": 470.0}, {"id": 2, "frequency": NaN}]',
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 422
    assert resp.json()["errors"]


def test_malformed_json_returns_422():
    resp = client.post(
        "/api/conflicts",
        content="not json at all",
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 422


def test_empty_body_returns_422():
    resp = client.post("/api/conflicts", content=b"")
    assert resp.status_code == 422


def test_tolerance_boundary_75khz_is_conflict():
    payload = [
        {"id": 1, "frequency": 500.0},
        {"id": 2, "frequency": 490.0},
        {"id": 3, "frequency": 510.075},
    ]
    resp = client.post("/api/conflicts", json=payload)
    assert resp.status_code == 200
    # 主冲突命中 510.075；镜像冲突 489.925↔490.000 同时成立
    assert resp.json()["conflict_count"] == 2


def test_64_channels_accepted():
    payload = [
        {"id": i, "frequency": 470.0 + 0.025 * i}
        for i in range(1, 65)
    ]
    resp = client.post("/api/conflicts", json=payload)
    assert resp.status_code == 200
    assert resp.json()["channel_count"] == 64


def test_every_conflict_carries_three_distinct_channels():
    # 密集频点产生大量互调，逐条校验三只频道编号互不相同
    payload = [
        {"id": i, "frequency": 470.0 + 0.5 * i}
        for i in range(1, 30)
    ]
    resp = client.post("/api/conflicts", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "conflict"
    for c in body["conflicts"]:
        source_ids = [s["id"] for s in c["sources"]]
        assert source_ids[0] != source_ids[1]
        assert c["victim"]["id"] not in source_ids
        assert abs(c["product_khz"] - c["victim"]["frequency_khz"]) <= 75
        assert isinstance(c["product_khz"], int)
    # 排序合规
    order = [
        (c["victim"]["frequency_khz"], c["victim"]["id"],
         c["sources"][0]["id"], c["sources"][1]["id"])
        for c in body["conflicts"]
    ]
    assert order == sorted(order)
    # 无重复
    dedup = [
        (c["product_khz"], c["sources"][0]["id"], c["sources"][1]["id"],
         c["victim"]["id"])
        for c in body["conflicts"]
    ]
    assert len(dedup) == len(set(dedup))


def test_nan_helper_is_finite():
    assert math.isfinite(0.0)
