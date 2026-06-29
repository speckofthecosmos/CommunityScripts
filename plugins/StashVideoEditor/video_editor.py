# video_editor.py
import json
import os
import subprocess
import sys
import urllib.request

from ffmpeg_args import (mirror_encode_args, build_vf, build_command,
                         build_trim_command)
from stash_ops import (find_scene_query, get_configuration_query,
                       metadata_scan_mutation, find_file_id_query,
                       scene_merge_mutation, set_primary_mutation,
                       generate_scene_mutation, find_edited_scenes_query)

EDITED_SUFFIX = ".edited"


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
    return root + EDITED_SUFFIX + (ext if ext else ".mp4")


def derive_source_path(edited):
    """Inverse of derive_output_path: strip the .edited marker. Returns None if
    the path is not one of ours (so the hook ignores unrelated scenes)."""
    root, ext = os.path.splitext(edited)
    if not root.endswith(EDITED_SUFFIX):
        return None
    return root[:-len(EDITED_SUFFIX)] + ext


# ── Phase 1: task (UI-triggered) — encode, queue a scan, EXIT ────────────────
# We cannot wait for the scan: Stash's job queue is serial, so the scan cannot
# run until this task exits. The Scene.Create.Post hook finishes the merge once
# the scan creates the new scene.
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
    _log("i", "[SVE] encoded -> %s" % dst)

    scan_data = gql.call(*metadata_scan_mutation(dst))
    _log("i", "[SVE] queued scan job=%s; merge runs via Scene.Create.Post hook"
         % scan_data.get("metadataScan"))


# ── Phase 1b: task (UI-triggered) — lossless/precision TRIM, same swap flow ───
# A trim is a distinct, crop-mutually-exclusive operation. Lossless = stream-copy
# (-c copy, instant, the cut snaps to the nearest keyframe so the output always
# CONTAINS the chosen range). Precision = re-encode for a frame-accurate cut.
# Either way we emit the SAME .edited file and queue the SAME scan, so the
# Scene.Create.Post merge hook below finishes the swap unchanged.
def trim(gql, args):
    scene_id = str(args["scene_id"])
    start, end = float(args["start"]), float(args["end"])
    mode = args.get("mode")
    if mode == "lossless_trim":
        lossless = True
    elif mode == "precision_trim":
        lossless = False
    else:
        lossless = bool(args.get("lossless", True))

    scene = gql.call(*find_scene_query(scene_id))["findScene"]
    if not scene or not scene.get("files"):
        _log("e", "[SVE] scene %s has no files" % scene_id)
        return
    src = scene["files"][0]["path"]
    dst = derive_output_path(src)
    tmp = dst + ".sve-partial" + os.path.splitext(dst)[1]

    # ffmpeg path comes from Stash config either way; precision also mirrors the
    # configured transcode args, lossless ignores them (-c copy needs no encoder).
    cfg = gql.call(*get_configuration_query())["configuration"]["general"]
    enc = mirror_encode_args(cfg)
    if lossless:
        cmd = build_trim_command(enc["ffmpeg"], src, tmp, start, end, lossless=True)
    else:
        cmd = build_trim_command(enc["ffmpeg"], src, tmp, start, end, lossless=False,
                                 input_args=enc["input_args"], output_args=enc["output_args"])

    _log("i", "[SVE] trimming (%s) %.3f-%.3f: %s"
         % ("lossless" if lossless else "precision", start, end, " ".join(cmd)))
    result = subprocess.run(cmd, stderr=subprocess.PIPE)
    if result.returncode != 0:
        if os.path.exists(tmp):
            os.remove(tmp)
        _log("e", "[SVE] ffmpeg failed (%s): %s"
             % (result.returncode, result.stderr.decode(errors="replace")))
        return
    os.replace(tmp, dst)  # finalize new file; source is never touched
    _log("i", "[SVE] trimmed -> %s" % dst)

    scan_data = gql.call(*metadata_scan_mutation(dst))
    _log("i", "[SVE] queued scan job=%s; merge runs via Scene.Create.Post hook"
         % scan_data.get("metadataScan"))


# ── Phase 2: hook (Scene.Create.Post) — merge the new edited scene into source ─
# Runs inside the scan job, so it never waits on a queued job. sceneMerge is a
# synchronous mutation (not a job), so there is no deadlock.
def _merge_one(gql, scene):
    """scene: {id, files:[{id,path}]}. Ensure the edited file ends up as PRIMARY
    of the source scene, then regenerate. Idempotent/self-healing — handles both
    a fresh orphan (edited file is alone in a new scene → merge into source) and an
    already-merged scene (edited file is a secondary → just promote to primary).
    Returns True on success."""
    sid = str(scene["id"])
    files = scene.get("files") or []
    edited = next((f for f in files if derive_source_path(f["path"])), None)
    if not edited:
        return False  # no *.edited.* file in this scene — ignore
    edited_file_id = edited["id"]
    source_path = derive_source_path(edited["path"])

    # Is the source (un-edited) file already in THIS scene? Then it's already merged.
    already_merged = any(
        os.path.normpath(f["path"]) == os.path.normpath(source_path) for f in files
    )

    if already_merged:
        target = sid
        _log("i", "[SVE] scene %s already has edited+source; promoting file=%s to primary"
             % (sid, edited_file_id))
    else:
        # Orphan: find the separate source scene and merge this one into it.
        matches = gql.call(*find_file_id_query(source_path))["findScenes"]["scenes"]
        target = None
        for s in matches:
            for sf in s["files"]:
                if os.path.normpath(sf["path"]) == os.path.normpath(source_path):
                    target = str(s["id"])
                    break
            if target:
                break
        if not target or target == sid:
            _log("e", "[SVE] no source scene for %s — leaving new scene as-is" % source_path)
            return False
        try:
            r = gql.call(*scene_merge_mutation([sid], target))
            _log("i", "[SVE] sceneMerge new=%s -> source=%s -> %s" % (sid, target, r))
        except Exception as e:
            _log("e", "[SVE] sceneMerge FAILED (new=%s source=%s): %s" % (sid, target, e))
            return False

    # Promote to primary separately — merge discards a requested primary when the
    # destination already has one (merge.go); the edited file is now associated.
    try:
        r = gql.call(*set_primary_mutation(target, edited_file_id))
        _log("i", "[SVE] set primary file=%s on scene %s -> %s" % (edited_file_id, target, r))
    except Exception as e:
        _log("e", "[SVE] set primary FAILED (scene=%s file=%s): %s" % (target, edited_file_id, e))
        return False

    try:
        gql.call(*generate_scene_mutation(target))
        _log("i", "[SVE] queued generate (overwrite) for scene %s" % target)
    except Exception as e:
        _log("e", "[SVE] generate FAILED (scene=%s): %s" % (target, e))
    return True


def merge_hook(gql, new_scene_id):
    if not new_scene_id:
        return
    scene = gql.call(*find_scene_query(str(new_scene_id)))["findScene"]
    if scene:
        _merge_one(gql, scene)


def merge_all(gql):
    """Manual fallback task: merge every orphan *.edited scene into its source."""
    scenes = gql.call(*find_edited_scenes_query())["findScenes"]["scenes"]
    _log("i", "[SVE] merge_all: %d candidate .edited scene(s)" % len(scenes))
    merged = sum(1 for s in scenes if _merge_one(gql, s))
    _log("i", "[SVE] merge_all done: merged %d/%d" % (merged, len(scenes)))


def main():
    data = json.loads(sys.stdin.read())
    gql = StashGQL(data["server_connection"])
    args = data.get("args", {})
    if args.get("mode") == "crop_reencode":
        crop_reencode(gql, args)
    elif args.get("mode") in ("trim", "lossless_trim", "precision_trim"):
        trim(gql, args)
    elif args.get("mode") == "merge":
        merge_all(gql)
    elif "hookContext" in args:
        ctx = args["hookContext"] or {}
        if str(ctx.get("type", "")).startswith("Scene.Create"):
            merge_hook(gql, ctx.get("id"))


if __name__ == "__main__":
    main()
