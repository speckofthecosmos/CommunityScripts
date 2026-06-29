# video_editor.py
import json
import os
import subprocess
import sys

import stashapi.log as log
from stashapi.stashapp import StashInterface

from ffmpeg_args import mirror_encode_args, build_vf, build_command
from stash_ops import (find_file_id_query, assign_file_mutation,
                       set_primary_mutation, generate_scene_mutation)


def derive_output_path(src):
    root, ext = os.path.splitext(src)
    return root + ".edited" + (ext if ext else ".mp4")


def crop_reencode(stash, args):
    scene_id = str(args["scene_id"])
    crop = args["crop"]
    out_w, out_h = int(args["out_w"]), int(args["out_h"])

    scene = stash.find_scene(scene_id, "id files {id path width height video_codec}")
    src = scene["files"][0]["path"]
    dst = derive_output_path(src)
    tmp = dst + ".sve-partial" + os.path.splitext(dst)[1]

    cfg = stash.get_configuration()["general"]
    enc = mirror_encode_args(cfg)
    vf = build_vf(crop, out_w, out_h)
    cmd = build_command(enc["ffmpeg"], src, tmp, vf, enc["input_args"], enc["output_args"])

    log.info("[SVE] encoding: %s" % " ".join(cmd))
    result = subprocess.run(cmd)
    if result.returncode != 0:
        if os.path.exists(tmp):
            os.remove(tmp)
        log.error("[SVE] ffmpeg failed (%s) — original untouched" % result.returncode)
        return
    os.replace(tmp, dst)  # finalize new file; source is never touched

    log.info("[SVE] scanning new file")
    stash.metadata_scan([dst])

    q, v = find_file_id_query(dst)
    found = stash.call_GQL(q, v)["findScenes"]["scenes"]
    new_file_id = None
    for s in found:
        for f in s["files"]:
            if os.path.normpath(f["path"]) == os.path.normpath(dst):
                new_file_id = f["id"]
    if not new_file_id:
        log.error("[SVE] new file not indexed yet: %s" % dst)
        return

    for builder in (assign_file_mutation, set_primary_mutation):
        q, v = builder(scene_id, new_file_id)
        stash.call_GQL(q, v)
    q, v = generate_scene_mutation(scene_id)
    stash.call_GQL(q, v)
    log.info("[SVE] done: scene %s primary swapped to file %s" % (scene_id, new_file_id))


def main():
    data = json.loads(sys.stdin.read())
    stash = StashInterface(data["server_connection"])
    args = data.get("args", {})
    if args.get("mode") == "crop_reencode":
        crop_reencode(stash, args)


if __name__ == "__main__":
    main()
