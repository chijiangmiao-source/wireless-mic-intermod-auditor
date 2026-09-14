"""整批分析响应中的频道角色摘要测试。

摘要只扩展 /api/conflicts：为每个既有频道附加按规范冲突身份聚合的
source_count / victim_count / role。候选评估与冲突明细契约保持不变。
"""

from fastapi.testclient import TestClient

from app.im3 import find_conflicts, summarize_channel_roles
from app.main import app

client = TestClient(app)


def _post(payload):
    resp = client.post("/api/conflicts", json=payload)
    assert resp.status_code == 200
    return resp.json()


def _summary_by_id(body):
    return {ch["id"]: ch for ch in body["channels"]}


def test_same_channel_as_source_and_victim_is_both():
    # 2×500.000−480.000=520.000 命中 #33；镜像 2×500.000−520.000=480.000 命中 #11
    body = _post([
        {"id": 11, "frequency": 480.0},
        {"id": 22, "frequency": 500.0},
        {"id": 33, "frequency": 520.0},
    ])
    assert body["conflict_count"] == 2
    summary = _summary_by_id(body)
    # #11、#33 各自既是一条冲突的来源，又是另一条冲突的受影响频道
    assert summary[11]["source_count"] == 1
    assert summary[11]["victim_count"] == 1
    assert summary[11]["role"] == "both"
    assert summary[33]["source_count"] == 1
    assert summary[33]["victim_count"] == 1
    assert summary[33]["role"] == "both"
    # #22 在两条冲突中都只是来源（系数 2 的那只）
    assert summary[22]["source_count"] == 2
    assert summary[22]["victim_count"] == 0
    assert summary[22]["role"] == "source"


def test_repeated_hits_counted_exactly_once_per_conflict():
    # 同频不同编号：同一对来源的两个产物都命中同一只受影响频道，
    # 每条去重后的冲突只计一次，计数不重不漏
    body = _post([
        {"id": 1, "frequency": 500.0},
        {"id": 2, "frequency": 500.025},
        {"id": 3, "frequency": 500.0},
    ])
    # 对(1,2) 两个产物命中 #3；对(2,3) 两个产物命中 #1；对(1,3) 同频退化跳过
    assert body["conflict_count"] == 4
    summary = _summary_by_id(body)
    assert (summary[1]["source_count"], summary[1]["victim_count"]) == (2, 2)
    assert summary[1]["role"] == "both"
    assert (summary[2]["source_count"], summary[2]["victim_count"]) == (4, 0)
    assert summary[2]["role"] == "source"
    assert (summary[3]["source_count"], summary[3]["victim_count"]) == (2, 2)
    assert summary[3]["role"] == "both"

    # 与冲突明细逐条核对：摘要计数必须等于明细中实际出现次数
    for channel_id, entry in summary.items():
        assert entry["source_count"] == sum(
            1 for c in body["conflicts"]
            if any(s["id"] == channel_id for s in c["sources"])
        )
        assert entry["victim_count"] == sum(
            1 for c in body["conflicts"] if c["victim"]["id"] == channel_id
        )
    # 每条冲突恰有两只来源与一只受影响频道：总计数守恒
    assert sum(e["source_count"] for e in summary.values()) == 2 * 4
    assert sum(e["victim_count"] for e in summary.values()) == 4


def test_source_only_and_uninvolved_roles():
    body = _post([
        {"id": 1, "frequency": 480.0},
        {"id": 2, "frequency": 500.0},
        {"id": 3, "frequency": 520.0},
        {"id": 4, "frequency": 690.0},
    ])
    assert body["conflict_count"] == 2
    summary = _summary_by_id(body)
    # #2 在两条冲突中都只是来源（系数 2 的那只），自身从不被命中
    assert (summary[2]["source_count"], summary[2]["victim_count"]) == (2, 0)
    assert summary[2]["role"] == "source"
    # #4 与任何冲突无关
    assert (summary[4]["source_count"], summary[4]["victim_count"]) == (0, 0)
    assert summary[4]["role"] == "none"
    # #1、#3 同时承担两种角色
    assert summary[1]["role"] == "both"
    assert summary[3]["role"] == "both"
    # 镜像性质：2fb−fa 命中 v 时 2fb−v 必以相同距离命中 a，
    # 故凡受影响频道必然也是某条镜像冲突的来源，纯 victim 角色不会出现
    for entry in summary.values():
        if entry["victim_count"] > 0:
            assert entry["source_count"] > 0


def test_clear_plan_marks_every_channel_none():
    body = _post([
        {"id": 1, "frequency": 470.0},
        {"id": 2, "frequency": 600.0},
        {"id": 3, "frequency": 690.0},
    ])
    assert body["status"] == "clear"
    for entry in body["channels"]:
        assert entry["source_count"] == 0
        assert entry["victim_count"] == 0
        assert entry["role"] == "none"


def test_summary_extends_channels_without_breaking_existing_contract():
    payload = [
        {"id": 33, "frequency": 520.0},
        {"id": 11, "frequency": 480.0},
        {"id": 22, "frequency": 500.0},
    ]
    body = _post(payload)
    # 顶层字段保持原契约
    assert set(body.keys()) == {
        "status", "channel_count", "channels", "conflict_count", "conflicts",
    }
    # 频道顺序与原有字段不变，摘要为纯增量字段
    assert [ch["id"] for ch in body["channels"]] == [33, 11, 22]
    for entry, item in zip(body["channels"], payload):
        assert entry["frequency_khz"] == round(item["frequency"] * 1000)
        assert entry["frequency_mhz"] == item["frequency"]
        assert set(entry.keys()) == {
            "id", "frequency_khz", "frequency_mhz",
            "source_count", "victim_count", "role",
        }
    # 冲突明细结构与排序不变，不含任何角色摘要字段
    assert body["conflicts"] == find_conflicts(
        [(item["id"], round(item["frequency"] * 1000)) for item in payload]
    )
    for conflict in body["conflicts"]:
        assert set(conflict.keys()) == {
            "victim", "sources", "doubled_source_id", "product_khz",
            "product_frequency_mhz", "distance_khz", "formula",
        }
    victim_keys = [c["victim"]["id"] for c in body["conflicts"]]
    assert victim_keys == sorted(
        victim_keys,
        key=lambda i: next(
            ch["frequency_khz"] for ch in body["channels"] if ch["id"] == i
        ),
    )


def test_summarize_channel_roles_aligns_with_channel_order():
    channels = [(33, 520_000), (11, 480_000), (22, 500_000)]
    conflicts = find_conflicts(channels)
    summary = summarize_channel_roles(channels, conflicts)
    assert [entry["id"] for entry in summary] == [33, 11, 22]
    assert summarize_channel_roles(channels, []) == [
        {"id": 33, "source_count": 0, "victim_count": 0, "role": "none"},
        {"id": 11, "source_count": 0, "victim_count": 0, "role": "none"},
        {"id": 22, "source_count": 0, "victim_count": 0, "role": "none"},
    ]


def test_candidate_contract_unaffected_by_channel_summary():
    baseline = [
        {"id": 11, "frequency": 480.0},
        {"id": 22, "frequency": 500.0},
        {"id": 33, "frequency": 520.0},
    ]
    resp = client.post(
        "/api/candidate",
        json={"channels": baseline, "candidate": {"id": 44, "frequency": 520.025}},
    )
    assert resp.status_code == 200
    body = resp.json()
    # 候选评估响应保持原契约：无角色摘要字段
    assert set(body.keys()) == {
        "status", "candidate", "new_conflict_count", "new_conflicts",
    }
    assert set(body["candidate"].keys()) == {
        "id", "frequency_khz", "frequency_mhz",
    }
    assert body["status"] == "conflict"
    assert body["new_conflict_count"] == len(body["new_conflicts"]) > 0
    for conflict in body["new_conflicts"]:
        assert set(conflict.keys()) == {
            "victim", "sources", "doubled_source_id", "product_khz",
            "product_frequency_mhz", "distance_khz", "formula",
        }
