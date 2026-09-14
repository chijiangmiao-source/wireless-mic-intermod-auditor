"""业务名称经真实 HTTP 的嵌套传播，以及旧请求/旧响应契约不变。"""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

NAMED_PLAN = [
    {"id": 11, "frequency": 480.0, "name": " 主唱麦 "},
    {"id": 22, "frequency": 500.0, "name": "吉他腰包"},
    {"id": 33, "frequency": 520.0},
]


def test_named_plan_channels_carry_normalized_name():
    resp = client.post("/api/conflicts", json=NAMED_PLAN)
    assert resp.status_code == 200
    by_id = {ch["id"]: ch for ch in resp.json()["channels"]}
    assert by_id[11]["name"] == "主唱麦"
    assert by_id[22]["name"] == "吉他腰包"
    # 未填写名称的频道不输出 name 键
    assert "name" not in by_id[33]


def test_named_plan_conflicts_propagate_names_to_victim_and_sources():
    body = client.post("/api/conflicts", json=NAMED_PLAN).json()
    assert body["conflict_count"] == 2

    victim33 = next(c for c in body["conflicts"] if c["victim"]["id"] == 33)
    # 受影响频道 #33 未命名：不带 name 键
    assert "name" not in victim33["victim"]
    sources = {s["id"]: s for s in victim33["sources"]}
    assert sources[11]["name"] == "主唱麦"
    assert sources[22]["name"] == "吉他腰包"
    # 计算式文本不含名称，保持原样
    assert victim33["formula"] == (
        "2×500.000 MHz − 480.000 MHz = 520.000 MHz"
        "（2f(频道22) − f(频道11)）"
    )

    victim11 = next(c for c in body["conflicts"] if c["victim"]["id"] == 11)
    assert victim11["victim"]["name"] == "主唱麦"


def test_nameless_plan_response_has_no_name_keys():
    plan = [
        {"id": 11, "frequency": 480.0},
        {"id": 22, "frequency": 500.0},
        {"id": 33, "frequency": 520.0},
    ]
    body = client.post("/api/conflicts", json=plan).json()
    assert all("name" not in ch for ch in body["channels"])
    for conflict in body["conflicts"]:
        assert "name" not in conflict["victim"]
        assert all("name" not in s for s in conflict["sources"])


def test_invalid_name_returns_422_located_by_index_and_field():
    plan = [
        {"id": 11, "frequency": 480.0, "name": "主唱麦"},
        {"id": 22, "frequency": 500.0, "name": ""},
    ]
    resp = client.post("/api/conflicts", json=plan)
    assert resp.status_code == 422
    errors = resp.json()["errors"]
    matched = [e for e in errors if e["field"] == "name"]
    assert matched and matched[0]["index"] == 1
    # 合法名称所在项不报错
    assert all(e["index"] != 0 for e in errors if e["field"] == "name")


def test_blank_name_and_extra_field_on_same_item_both_reported():
    # 页面回归：同一项同时有额外字段与空名称时，不能只报额外字段
    plan = [
        {"id": 11, "frequency": 480.0},
        {"id": 22, "frequency": 500.0, "name": "", "band": "UHF"},
    ]
    resp = client.post("/api/conflicts", json=plan)
    assert resp.status_code == 422
    errors = resp.json()["errors"]
    assert any(
        e["index"] == 1 and e["field"] is None and "非法字段" in e["message"]
        for e in errors
    )
    name_errors = [e for e in errors if e["index"] == 1 and e["field"] == "name"]
    assert name_errors and "1 至 40" in name_errors[0]["message"]


def test_candidate_endpoint_rejects_named_baseline_channels():
    resp = client.post(
        "/api/candidate",
        json={
            "channels": [
                {"id": 1, "frequency": 470.0, "name": "主唱麦"},
                {"id": 2, "frequency": 600.0},
            ],
            "candidate": {"id": 3, "frequency": 500.0},
        },
    )
    assert resp.status_code == 422
    assert any("非法字段" in e["message"] for e in resp.json()["errors"])


def test_candidate_endpoint_rejects_name_on_candidate():
    resp = client.post(
        "/api/candidate",
        json={
            "channels": [
                {"id": 1, "frequency": 470.0},
                {"id": 2, "frequency": 600.0},
            ],
            "candidate": {"id": 3, "frequency": 500.0, "name": "新麦"},
        },
    )
    assert resp.status_code == 422
    assert any("非法字段" in e["message"] for e in resp.json()["errors"])


def test_legacy_candidate_request_and_response_unchanged():
    # 旧客户端：只发 id/frequency；响应仍是原四字段结构，冲突明细无名称键
    resp = client.post(
        "/api/candidate",
        json={
            "channels": [
                {"id": 1, "frequency": 470.0},
                {"id": 2, "frequency": 600.0},
                {"id": 3, "frequency": 690.0},
            ],
            "candidate": {"id": 4, "frequency": 535.0},
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert set(body.keys()) == {
        "status", "candidate", "new_conflict_count", "new_conflicts",
    }
    assert "name" not in body["candidate"]
    for conflict in body["new_conflicts"]:
        assert "name" not in conflict["victim"]
        assert all("name" not in s for s in conflict["sources"])
