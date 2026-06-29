from video_editor import (derive_output_path, derive_source_path,
                          derive_trim_offset, remap_markers)


# ── Filename scheme ──────────────────────────────────────────────────────────
# Crop keeps the plain `.edited` suffix; trim encodes the in-point (ms) so the
# merge hook can remap marker times once the file is actually primary. Both keep
# the literal ".edited." substring the orphan-scene search relies on.

def test_derive_output_path_crop_is_plain_edited():
    assert derive_output_path("/lib/clip.mp4") == "/lib/clip.edited.mp4"

def test_derive_output_path_trim_encodes_start_ms():
    assert derive_output_path("/lib/clip.mp4", start=12.5) == "/lib/clip.trim_12500.edited.mp4"

def test_derive_source_path_strips_crop_marker():
    assert derive_source_path("/lib/clip.edited.mp4") == "/lib/clip.mp4"

def test_derive_source_path_strips_trim_marker_too():
    assert derive_source_path("/lib/clip.trim_12500.edited.mp4") == "/lib/clip.mp4"

def test_derive_source_path_ignores_unrelated_files():
    assert derive_source_path("/lib/clip.mp4") is None

def test_edited_substring_present_for_orphan_search():
    # find_edited_scenes_query matches INCLUDES ".edited." — both forms must contain it.
    assert ".edited." in derive_output_path("/lib/clip.mp4")
    assert ".edited." in derive_output_path("/lib/clip.mp4", start=3.0)

def test_derive_trim_offset():
    assert derive_trim_offset("/lib/clip.trim_12500.edited.mp4") == 12.5
    assert derive_trim_offset("/lib/clip.edited.mp4") == 0.0
    assert derive_trim_offset("/lib/clip.mp4") == 0.0


# ── Marker remap (pure) ──────────────────────────────────────────────────────
def test_remap_marker_inside_range_shifts_by_start():
    actions = remap_markers([{"id": "1", "seconds": 30, "end_seconds": None}], 12, 100)
    assert actions == [{"action": "update", "id": "1", "seconds": 18, "end_seconds": None}]

def test_remap_marker_at_in_point_keeps_zero():
    actions = remap_markers([{"id": "1", "seconds": 12, "end_seconds": None}], 12, 100)
    assert actions[0]["action"] == "update"
    assert actions[0]["seconds"] == 0

def test_remap_marker_before_in_point_is_deleted():
    actions = remap_markers([{"id": "1", "seconds": 5, "end_seconds": None}], 12, 100)
    assert actions == [{"action": "delete", "id": "1"}]

def test_remap_marker_after_out_point_is_deleted():
    # new file is 100s long; a marker at orig 200s is past the kept range.
    actions = remap_markers([{"id": "1", "seconds": 200, "end_seconds": None}], 12, 100)
    assert actions == [{"action": "delete", "id": "1"}]

def test_remap_marker_end_seconds_shift_and_clamp():
    actions = remap_markers([{"id": "1", "seconds": 20, "end_seconds": 120}], 12, 100)
    assert actions[0]["seconds"] == 8
    assert actions[0]["end_seconds"] == 100  # 120-12=108, clamped to new duration

def test_remap_unknown_duration_skips_upper_cull():
    actions = remap_markers([{"id": "1", "seconds": 500, "end_seconds": None}], 12, None)
    assert actions[0]["action"] == "update"
    assert actions[0]["seconds"] == 488
