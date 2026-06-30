from offload import build_crop_spec, build_trim_spec, choose_and_encode


def test_build_crop_spec():
    s = build_crop_spec("42", "/data/a.mp4", "/data/a.edited.mp4",
                        {"x": 0, "y": 0, "width": 10, "height": 10}, 10, 10, {"output_args": []})
    assert s["op"] == "crop" and s["scene_id"] == "42" and s["src"] == "/data/a.mp4" and s["out_w"] == 10


def test_build_trim_spec():
    s = build_trim_spec("42", "/data/a.mp4", "/data/a.edited.mp4", 1.0, 2.0, {"output_args": []})
    assert s["op"] == "trim" and s["scene_id"] == "42" and s["start"] == 1.0 and s["end"] == 2.0


def test_choose_local_when_unconfigured():
    calls = []
    r = choose_and_encode({}, url=None, token=None,
                          health=lambda u, t: True, post=lambda u, t, s: True,
                          local=lambda: calls.append("local"))
    assert r == "local" and calls == ["local"]


def test_choose_local_when_unreachable():
    calls = []
    r = choose_and_encode({}, url="http://x", token="t",
                          health=lambda u, t: False, post=lambda u, t, s: True,
                          local=lambda: calls.append("local"))
    assert r == "local" and calls == ["local"]


def test_choose_local_when_post_fails():
    calls = []
    r = choose_and_encode({}, url="http://x", token="t",
                          health=lambda u, t: True, post=lambda u, t, s: False,
                          local=lambda: calls.append("local"))
    assert r == "local" and calls == ["local"]


def test_choose_offload_when_healthy_and_posted():
    calls = []
    r = choose_and_encode({}, url="http://x", token="t",
                          health=lambda u, t: True, post=lambda u, t, s: True,
                          local=lambda: calls.append("local"))
    assert r == "offload" and calls == []
