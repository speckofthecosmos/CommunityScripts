from stash_ops import (find_file_id_query, assign_file_mutation,
                       set_primary_mutation, generate_scene_mutation,
                       generate_image_mutation, find_image_query,
                       find_scene_query, get_configuration_query,
                       metadata_scan_mutation, scene_merge_mutation,
                       find_edited_scenes_query, scene_markers_query,
                       marker_update_mutation, marker_destroy_mutation)

def test_find_scene_query():
    q, v = find_scene_query("7")
    assert "findScene" in q
    assert v == {"id": "7"}

def test_get_configuration_query():
    q, v = get_configuration_query()
    assert "configuration" in q
    assert v == {}

def test_metadata_scan_mutation():
    q, v = metadata_scan_mutation("/x.mp4")
    assert "metadataScan" in q
    assert v == {"input": {"paths": ["/x.mp4"]}}

def test_assign_file_mutation():
    q, v = assign_file_mutation("12", "99")
    assert "sceneAssignFile" in q
    assert v == {"input": {"scene_id": "12", "file_id": "99"}}

def test_set_primary_mutation():
    q, v = set_primary_mutation("12", "99")
    assert "sceneUpdate" in q
    assert v == {"input": {"id": "12", "primary_file_id": "99"}}

def test_generate_scene_mutation_scopes_to_scene():
    q, v = generate_scene_mutation("12")
    assert "metadataGenerate" in q
    assert v["input"]["sceneIDs"] == ["12"]

def test_find_file_id_query_passes_path():
    q, v = find_file_id_query("/lib/a.mp4")
    assert "findScenes" in q or "findScene" in q
    assert v["path"] == "/lib/a.mp4"

def test_scene_merge_mutation_no_values():
    # No `values`: merge discards a requested primary when dest already has one;
    # primary is set via a separate sceneUpdate afterward.
    q, v = scene_merge_mutation(["18874"], "19000")
    assert "sceneMerge" in q
    assert v == {"input": {"source": ["18874"], "destination": "19000"}}

def test_generate_includes_overwrite():
    q, v = generate_scene_mutation("12")
    assert v["input"]["overwrite"] is True

def test_find_edited_scenes_query():
    q, v = find_edited_scenes_query()
    assert "findScenes" in q
    assert ".edited." in q
    assert v == {}

def test_find_image_query():
    q, v = find_image_query("52636")
    assert "findImage" in q
    assert "visual_files" in q
    assert "VideoFile" in q  # __typename discrimination for the croppable file
    assert v == {"id": "52636"}

def test_generate_image_mutation_scopes_to_image_with_overwrite():
    q, v = generate_image_mutation("52636")
    assert "metadataGenerate" in q
    assert v["input"]["imageIDs"] == ["52636"]
    assert v["input"]["overwrite"] is True

def test_generate_image_mutation_regenerates_clip_preview():
    # The animated clip preview + thumbnail are keyed to the file; after an
    # overwrite-in-place crop they must be regenerated or they show the OLD frame.
    q, v = generate_image_mutation("52636")
    assert v["input"]["clipPreviews"] is True
    assert v["input"]["imageThumbnails"] is True
    assert "sceneIDs" not in v["input"]  # image scope only, no scene bleed

def test_generate_regenerates_marker_previews():
    # Marker previews are keyed to the file; after a primary swap they must be
    # regenerated or they show the OLD file's frames.
    q, v = generate_scene_mutation("12")
    assert v["input"]["markers"] is True
    assert v["input"]["markerImagePreviews"] is True
    assert v["input"]["markerScreenshots"] is True

def test_scene_markers_query():
    q, v = scene_markers_query("12")
    assert "scene_markers" in q
    assert "seconds" in q and "end_seconds" in q
    assert "duration" in q  # need the trimmed file length to cull out-of-range markers
    assert v == {"id": "12"}

def test_marker_update_mutation_shifts_times():
    q, v = marker_update_mutation("55", 18.0, 30.0)
    assert "sceneMarkerUpdate" in q
    assert v == {"input": {"id": "55", "seconds": 18.0, "end_seconds": 30.0}}

def test_marker_update_mutation_omits_null_end():
    q, v = marker_update_mutation("55", 18.0, None)
    assert v == {"input": {"id": "55", "seconds": 18.0}}

def test_marker_destroy_mutation():
    q, v = marker_destroy_mutation("55")
    assert "sceneMarkerDestroy" in q
    assert v == {"id": "55"}
