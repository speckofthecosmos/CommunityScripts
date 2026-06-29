# Pure GraphQL (query, variables) builders for the non-destructive primary-swap.

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

def generate_scene_mutation(scene_id):
    q = """mutation Generate($input: GenerateMetadataInput!) {
      metadataGenerate(input: $input)
    }"""
    return q, {"input": {"sceneIDs": [scene_id], "sprites": True,
                         "previews": True, "phashes": True}}
