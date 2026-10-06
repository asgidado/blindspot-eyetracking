import numpy as np

from .cursor_proxy import CursorDwellConfig, MissTypeBands, dwell_ms, miss_type

CFG = CursorDwellConfig()
VP = [0, 0, 1024, 1024]


def ev(t, x=None, y=None, zoom=1.0, vp=VP):
    return {"t": t, "kind": "move", "x": x, "y": y, "zoom": zoom, "vp": vp, "loupe": False}


def test_dwell_counts_time_in_region_and_caps_dt():
    region = np.zeros((1024, 1024), bool)
    region[400:600, 400:600] = True
    events = [ev(0, 500, 500), ev(100, 501, 500), ev(2000, 503, 500), ev(2100, 10, 10)]
    # dt 100 + min(1900,250) + (last pair: e0 in region, 100ms) = 450
    assert dwell_ms(events, region, CFG) == 450


def test_idle_cap_stops_counting_a_parked_cursor():
    region = np.ones((1024, 1024), bool)
    events = [ev(i * 100, 500, 500) for i in range(40)]  # 3.9 s perfectly still
    d = dwell_ms(events, region, CFG)
    assert 1500 <= d <= 1600  # counts until still > max_still_ms


def test_off_image_pairs_are_skipped_and_zoom_adds_weighted_dwell():
    region = np.zeros((1024, 1024), bool)
    region[0:100, 0:100] = True
    events = [
        ev(0),
        ev(100),
        ev(200, 900, 900, zoom=2.5, vp=[0, 0, 100, 100]),
        ev(300, 901, 900, zoom=2.5, vp=[0, 0, 100, 100]),
    ]
    assert dwell_ms(events, region, CFG) == 50  # 0.5 * 100


def test_miss_type_bands():
    b = MissTypeBands()
    assert miss_type(0, b) == "search"
    assert miss_type(299, b) == "search"
    assert miss_type(300, b) == "recognition"
    assert miss_type(999, b) == "recognition"
    assert miss_type(1000, b) == "decision"
