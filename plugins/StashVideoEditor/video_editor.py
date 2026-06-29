# video_editor.py
import json
import os
import subprocess
import sys
import time
import urllib.request

from ffmpeg_args import mirror_encode_args, build_vf, build_command
from stash_ops import (find_scene_query, get_configuration_query,
                       metadata_scan_mutation, find_file_id_query,
                       assign_file_mutation, set_primary_mutation,
                       generate_scene_mutation)


def _log(level, msg):
    sys.stderr.write("\x01%s\x02%s\n" % (level, msg))
    sys.stderr.flush()


class StashGQL:
    def __init__(self, conn):
        scheme = conn.get("Scheme", "http")
        host = conn.get("Host", "localhost")
        if host in ("", "0.0.0.0"):
            host = "localhost"
        port = conn.get("Port", 9999)
        self.url = "%s://%s:%s/graphql" % (scheme, host, port)
        self.headers = {"Content-Type": "application/json"}
        cookie = conn.get("SessionCookie") or {}
        if cookie.get("Name"):
            self.headers["Cookie"] = "%s=%s" % (cookie["Name"], cookie.get("Value", ""))
        if conn.get("ApiKey"):
            self.headers["ApiKey"] = conn["ApiKey"]

    def call(self, query, variables=None):
        body = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
        req = urllib.request.Request(self.url, data=body, headers=self.headers, method="POST")
        with urllib.request.urlopen(req) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        if payload.get("errors"):
            raise RuntimeError("GraphQL error: %s" % payload["errors"])
        return payload["data"]


def derive_output_path(src):
    root, ext = os.path.splitext(src)
    return root + ".edited" + (ext if ext else ".mp4")


def crop_reencode(gql, args):
    scene_id = str(args["scene_id"])
    crop = args["crop"]
    out_w, out_h = int(args["out_w"]), int(args["out_h"])

    scene = gql.call(*find_scene_query(scene_id))["findScene"]
    if not scene or not scene.get("files"):
        _log("e", "[SVE] scene %s has no files" % scene_id)
        return
    src = scene["files"][0]["path"]
    dst = derive_output_path(src)
    tmp = dst + ".sve-partial" + os.path.splitext(dst)[1]

    cfg = gql.call(*get_configuration_query())["configuration"]["general"]
    enc = mirror_encode_args(cfg)
    vf = build_vf(crop, out_w, out_h)
    cmd = build_command(enc["ffmpeg"], src, tmp, vf, enc["input_args"], enc["output_args"])

    _log("i", "[SVE] encoding: %s" % " ".join(cmd))
    result = subprocess.run(cmd, stderr=subprocess.PIPE)
    if result.returncode != 0:
        if os.path.exists(tmp):
            os.remove(tmp)
        _log("e", "[SVE] ffmpeg failed (%s): %s" % (result.returncode, result.stderr.decode(errors="replace")))
        return
    os.replace(tmp, dst)  # finalize new file; source is never touched

    _log("i", "[SVE] scanning new file")
    gql.call(*metadata_scan_mutation(dst))

    new_file_id = None
    for _ in range(30):
        scenes = gql.call(*find_file_id_query(dst))["findScenes"]["scenes"]
        for s in scenes:
            for f in s["files"]:
                if os.path.normpath(f["path"]) == os.path.normpath(dst):
                    new_file_id = f["id"]
                    break
            if new_file_id:
                break
        if new_file_id:
            break
        time.sleep(1)
    if not new_file_id:
        _log("e", "[SVE] new file not indexed after scan: %s" % dst)
        return

    _log("i", "[SVE] merging new file id=%s into scene %s as primary" % (new_file_id, scene_id))

    try:
        r = gql.call(*assign_file_mutation(scene_id, new_file_id))
        _log("i", "[SVE] sceneAssignFile -> %s" % r)
    except Exception as e:
        _log("e", "[SVE] sceneAssignFile FAILED (scene=%s file=%s): %s" % (scene_id, new_file_id, e))
        return

    try:
        r = gql.call(*set_primary_mutation(scene_id, new_file_id))
        _log("i", "[SVE] sceneUpdate(primary_file_id) -> %s" % r)
    except Exception as e:
        _log("e", "[SVE] sceneUpdate(primary_file_id) FAILED (scene=%s file=%s): %s" % (scene_id, new_file_id, e))
        return

    try:
        gql.call(*generate_scene_mutation(scene_id))
        _log("i", "[SVE] metadataGenerate triggered for scene %s" % scene_id)
    except Exception as e:
        _log("e", "[SVE] metadataGenerate FAILED (scene=%s): %s" % (scene_id, e))

    _log("i", "[SVE] done: scene %s primary=%s" % (scene_id, new_file_id))


def main():
    data = json.loads(sys.stdin.read())
    gql = StashGQL(data["server_connection"])
    args = data.get("args", {})
    if args.get("mode") == "crop_reencode":
        crop_reencode(gql, args)


if __name__ == "__main__":
    main()
