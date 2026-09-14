"""可选业务名称 name 的校验：规范化、越界/空值拒绝与按索引定位。"""

import pytest

from app.validation import validate_channels


def _pair(second_name):
    return [
        {"id": 1, "frequency": 470.0},
        {"id": 2, "frequency": 600.0, "name": second_name},
    ]


def test_name_is_optional_and_defaults_to_none():
    channels, errors = validate_channels(
        [{"id": 1, "frequency": 470.0}, {"id": 2, "frequency": 600.0}],
        allow_name=True,
    )
    assert errors == []
    assert [name for _id, _khz, name in channels] == [None, None]


def test_name_is_stripped_of_surrounding_whitespace():
    channels, errors = validate_channels(
        [
            {"id": 1, "frequency": 470.0, "name": "  主唱腰包  \t"},
            {"id": 2, "frequency": 600.0},
        ],
        allow_name=True,
    )
    assert errors == []
    assert channels[0][2] == "主唱腰包"


def test_name_up_to_40_characters_accepted():
    channels, errors = validate_channels(_pair("麦" * 40), allow_name=True)
    assert errors == []
    assert channels[1][2] == "麦" * 40


def test_name_longer_than_40_characters_rejected_by_index():
    _channels, errors = validate_channels(_pair("x" * 41), allow_name=True)
    matched = [e for e in errors if e["field"] == "name"]
    assert matched and matched[0]["index"] == 1
    assert "1 至 40" in matched[0]["message"]


@pytest.mark.parametrize("bad", ["", "   ", "\t\n"])
def test_empty_or_blank_name_rejected(bad):
    _channels, errors = validate_channels(_pair(bad), allow_name=True)
    matched = [e for e in errors if e["field"] == "name"]
    assert matched and matched[0]["index"] == 1
    assert "1 至 40" in matched[0]["message"]


@pytest.mark.parametrize("bad", [5, 5.0, True, None, ["a"], {"x": 1}])
def test_non_string_name_rejected(bad):
    _channels, errors = validate_channels(_pair(bad), allow_name=True)
    matched = [e for e in errors if e["field"] == "name"]
    assert matched and matched[0]["index"] == 1
    assert "必须是字符串" in matched[0]["message"]


def test_duplicate_names_allowed_within_batch():
    channels, errors = validate_channels(
        [
            {"id": 1, "frequency": 470.0, "name": "主唱麦"},
            {"id": 2, "frequency": 600.0, "name": "主唱麦"},
        ],
        allow_name=True,
    )
    assert errors == []
    assert [name for _id, _khz, name in channels] == ["主唱麦", "主唱麦"]


def test_name_error_collected_alongside_other_field_errors():
    # 名称非法 + 频率离格：两类字段错误在同一次结果中逐项返回，频道仍按索引定位
    payload = [
        {"id": 1, "frequency": 470.0},
        {"id": 2, "frequency": 470.013, "name": "   "},
    ]
    _channels, errors = validate_channels(payload, allow_name=True)
    fields = {(e["index"], e["field"]) for e in errors}
    assert (1, "frequency") in fields
    assert (1, "name") in fields


def test_name_rejected_when_allow_name_false():
    # 候选评估请求沿用原契约：基线项里出现 name 仍按非法字段拒绝
    _channels, errors = validate_channels(_pair("主唱麦"))
    assert any("非法字段" in e["message"] and e["index"] == 1 for e in errors)
    assert all(e["field"] != "name" for e in errors)
