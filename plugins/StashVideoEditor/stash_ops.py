# Pure GraphQL (query, variables) builders for the non-destructive primary-swap.

def find_scene_query(scene_id):
    q = """query FindScene($id: ID!) {
      findScene(id: $id) { id files { id path width height video_codec } }
    }"""
    return q, {"id": scene_id}

def get_configuration_query():
    q = """query Configuration {
      configuration { general {
        ffmpegPath transcodeHardwareAcceleration
        transcodeInputArgs transcodeOutputArgs generatedPath
      } }
    }"""
    return q, {}

def metadata_scan_mutation(path):
    q = """mutation MetadataScan($input: ScanMetadataInput!) {
      metadataScan(input: $input)
    }"""
    return q, {"input": {"paths": [path]}}

def find_file_id_query(path):
    q = """query FindFileByPath($path: String!) {
      findScenes(scene_filter: {path: {value: $path, modifier: EQUALS}}) {
        scenes { id files { id path } }
      }
    }"""
    return q, {"path": path}

def assign_file_mutation(scene_id, file_id):
    q = """mutation AssignFile($input: AssignSceneFileInput!) {
      sceneAssignFile(input: $input)
    }"""
    return q, {"input": {"scene_id": scene_id, "file_id": file_id}}

def set_primary_mutation(scene_id, file_id):
    q = """mutation SetPrimary($input: SceneUpdateInput!) {
      sceneUpdate(input: $input) { id }
    }"""
    return q, {"input": {"id": scene_id, "primary_file_id": file_id}}

def find_edited_scenes_query():
    # All scenes whose file path contains ".edited." — the orphan scenes a scan
    # created for our edited files (used by the manual `merge` fallback task).
    q = """query FindEdited {
      findScenes(scene_filter: {path: {value: ".edited.", modifier: INCLUDES}},
                 filter: {per_page: -1}) {
        scenes { id files { id path } }
      }
    }"""
    return q, {}

def scene_merge_mutation(source_ids, destination_id):
    # Move source scenes' files into destination and delete the (now-empty) source
    # scenes. Reassigns files; does NOT delete from disk. We intentionally pass NO
    # `values`: scene.Merge discards a requested primary when the destination already
    # has one (merge.go) — so primary is set separately via sceneUpdate afterward.
    q = """mutation SceneMerge($input: SceneMergeInput!) {
      sceneMerge(input: $input) { id }
    }"""
    return q, {"input": {"source": source_ids, "destination": destination_id}}

def generate_scene_mutation(scene_id):
    # overwrite=True so the new primary file's sprites/previews/phash replace the
    # original's (otherwise generate skips — assets already exist for the scene).
    q = """mutation Generate($input: GenerateMetadataInput!) {
      metadataGenerate(input: $input)
    }"""
    return q, {"input": {"sceneIDs": [scene_id], "sprites": True, "previews": True,
                         "covers": True, "phashes": True, "overwrite": True}}
