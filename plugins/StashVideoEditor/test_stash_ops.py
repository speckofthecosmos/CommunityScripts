from stash_ops import (find_file_id_query, assign_file_mutation,
                       set_primary_mutation, generate_scene_mutation,
                       find_scene_query, get_configuration_query,
                       metadata_scan_mutation, scene_merge_mutation)

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

def test_scene_merge_mutation():
    q, v = scene_merge_mutation(["18874"], "19000", "85256")
    assert "sceneMerge" in q
    assert v == {"input": {"source": ["18874"], "destination": "19000",
                           "values": {"primary_file_id": "85256"}}}
