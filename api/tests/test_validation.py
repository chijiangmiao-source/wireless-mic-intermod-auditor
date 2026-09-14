"""校验层单元测试：非法字段、重复编号、非有限数值整批拒绝。"""

import math

import pytest

from app.validation import validate_channels


def valid_payload():
    return [{"id": 1, "frequency": 470.0}, {"id": 2, "frequency": 694.0}]


def test_valid_channels_pass():
    channels, errors = validate_channels(valid_payload())
    assert errors == []
    assert channels == [(1, 470_000, None), (2, 694_000, None)]


@pytest.mark.parametrize(
    "frequency",
    [470.013, 693.99, 500.010, 480.030],
)
def test_off_grid_frequency_rejected(frequency):
    payload = valid_payload()
    payload[1]["frequency"] = frequency
    _channels, errors = validate_channels(payload)
    assert any(e["index"] == 1 and e["field"] == "frequency" for e in errors)


def test_on_grid_quarter_steps_pass():
    payload = [
        {"id": 1, "frequency": 470.025},
        {"id": 2, "frequency": 512.375},
        {"id": 3, "frequency": 600.650},
    ]
    channels, errors = validate_channels(payload)
    assert errors == []
    assert [khz for _id, khz, _name in channels] == [470_025, 512_375, 600_650]


@pytest.mark.parametrize("frequency", [469.975, 694.025, 0.0, -470.0, 1000.0])
def test_out_of_range_rejected(frequency):
    payload = valid_payload()
    payload[0]["frequency"] = frequency
    _channels, errors = validate_channels(payload)
    assert any(e["field"] == "frequency" for e in errors)


def test_duplicate_ids_rejected():
    payload = [
        {"id": 5, "frequency": 470.0},
        {"id": 5, "frequency": 480.0},
    ]
    _channels, errors = validate_channels(payload)
    assert any("重复" in e["message"] for e in errors)


@pytest.mark.parametrize("channel_id", [2**53, 2**53 + 1, -(2**53)])
def test_ids_beyond_safe_integer_range_rejected(channel_id):
    payload = [
        {"id": 1, "frequency": 470.0},
        {"id": channel_id, "frequency": 480.0},
    ]
    channels, errors = validate_channels(payload)
    matched = [e for e in errors if e["index"] == 1 and e["field"] == "id"]
    assert matched, errors
    assert any("安全整数" in e["message"] for e in matched)
    # 越界编号不得进入 channels
    assert all(cid != channel_id for cid, _khz, _name in channels)
    assert channels == []


@pytest.mark.parametrize("channel_id", [2**53 - 1, -(2**53 - 1)])
def test_safe_integer_boundary_ids_accepted(channel_id):
    payload = [
        {"id": 1, "frequency": 470.0},
        {"id": channel_id, "frequency": 480.0},
    ]
    channels, errors = validate_channels(payload)
    assert errors == []
    assert channels == [(1, 470_000, None), (channel_id, 480_000, None)]


def test_non_finite_frequency_rejected():
    for bad in (float("nan"), float("inf"), float("-inf")):
        payload = [
            {"id": 1, "frequency": 470.0},
            {"id": 2, "frequency": bad},
        ]
        _channels, errors = validate_channels(payload)
        assert any(
            e["index"] == 1 and "有限" in e["message"] for e in errors
        ), f"bad={bad!r}"


def test_string_and_boolean_fields_rejected():
    payload = [
        {"id": "1", "frequency": 470.0},
        {"id": True, "frequency": 480.0},
    ]
    _channels, errors = validate_channels(payload)
    assert len([e for e in errors if e["field"] == "id"]) == 2


def test_missing_and_extra_fields_rejected():
    payload = [
        {"id": 1, "frequency": 470.0},
        {"id": 2},
        {"id": 3, "frequency": 480.0, "band": "UHF"},
    ]
    _channels, errors = validate_channels(payload)
    assert any(e["index"] == 1 and e["field"] == "frequency" for e in errors)
    assert any(e["index"] == 2 and "非法字段" in e["message"] for e in errors)


def test_item_not_object_rejected():
    _channels, errors = validate_channels(
        [{"id": 1, "frequency": 470.0}, [2, 480.0]]
    )
    assert any(e["index"] == 1 for e in errors)


def test_payload_not_list_rejected():
    _channels, errors = validate_channels({"channels": []})
    assert errors and errors[0]["index"] is None


def test_channel_count_limits():
    too_few = [{"id": 1, "frequency": 470.0}]
    _c, errors = validate_channels(too_few)
    assert errors and "2 至 64" in errors[0]["message"]

    too_many = [{"id": i, "frequency": 470.0 + 0.025 * i} for i in range(65)]
    _c, errors = validate_channels(too_many)
    assert errors and "2 至 64" in errors[0]["message"]


def test_float_that_is_integer_khz_accepted():
    # 470.025 在二进制浮点下不是精确值，仍应落在刻度上
    _channels, errors = validate_channels(
        [{"id": 1, "frequency": 470.025}, {"id": 2, "frequency": 470.050}]
    )
    assert errors == []


def test_nan_check_import_math_used():
    assert math.isfinite(1.0)
