from stash_ops import (find_file_id_query, assign_file_mutation,
                       set_primary_mutation, generate_scene_mutation)

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
