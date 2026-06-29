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

def scene_merge_mutation(source_ids, destination_id, primary_file_id):
    # Move source scenes' files into destination, set the edited file primary,
    # delete the (now-empty) source scenes. Reassigns files; does NOT delete from disk.
    q = """mutation SceneMerge($input: SceneMergeInput!) {
      sceneMerge(input: $input) { id }
    }"""
    return q, {"input": {"source": source_ids, "destination": destination_id,
                         "values": {"primary_file_id": primary_file_id}}}

def generate_scene_mutation(scene_id):
    q = """mutation Generate($input: GenerateMetadataInput!) {
      metadataGenerate(input: $input)
    }"""
    return q, {"input": {"sceneIDs": [scene_id], "sprites": True,
                         "previews": True, "phashes": True}}
