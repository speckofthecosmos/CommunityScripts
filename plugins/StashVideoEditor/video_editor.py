# video_editor.py
import json
import os
import re
import subprocess
import sys
import urllib.request

import offload
from ffmpeg_args import (mirror_encode_args, build_vf, build_command,
                         build_trim_command)
from stash_ops import (find_scene_query, get_configuration_query,
                       metadata_scan_mutation, find_file_id_query,
                       scene_merge_mutation, set_primary_mutation,
                       generate_scene_mutation, find_edited_scenes_query,
                       scene_markers_query, marker_update_mutation,
                       marker_destroy_mutation)

EDITED_SUFFIX = ".edited"
TRIM_RE = re.compile(r"\.trim_(\d+)$")  # in-point (ms) encoded for the merge hook


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


def derive_output_path(src, start=None):
    """Edited-file path. Crop: `<root>.edited<ext>`. Trim: `<root>.trim_<ms>.edited
    <ext>` — the in-point (ms, dot-free so splitext is unaffected) so the merge hook
    can remap marker times. Both keep the literal ".edited." the orphan search needs."""
    root, ext = os.path.splitext(src)
    ext = ext if ext else ".mp4"
    marker = EDITED_SUFFIX
    if start is not None:
        marker = ".trim_%d" % int(round(float(start) * 1000)) + EDITED_SUFFIX
    return root + marker + ext


def derive_source_path(edited):
    """Inverse of derive_output_path: strip the .edited (and optional .trim_<ms>)
    marker back to the real source file. Returns None if the path is not one of ours
    (so the hook ignores unrelated scenes)."""
    root, ext = os.path.splitext(edited)
    if not root.endswith(EDITED_SUFFIX):
        return None
    base = TRIM_RE.sub("", root[:-len(EDITED_SUFFIX)])
    return base + ext


def derive_trim_offset(edited):
    """Trim in-point (seconds) encoded in an edited path, or 0.0 for crop/non-ours."""
    root, ext = os.path.splitext(edited)
    if not root.endswith(EDITED_SUFFIX):
        return 0.0
    m = TRIM_RE.search(root[:-len(EDITED_SUFFIX)])
    return (int(m.group(1)) / 1000.0) if m else 0.0


def remap_markers(markers, start, new_duration, eps=0.05):
    """Shift scene markers onto a trimmed timeline. Each marker moves earlier by
    `start`; markers whose moment falls outside the kept [0, new_duration] range are
    dropped (their footage is gone). Returns a list of {action: update|delete, ...}.
    new_duration None ⇒ no upper bound (cull only the front)."""
    upper = float("inf") if new_duration is None else new_duration
    actions = []
    for m in markers:
        sec = m.get("seconds")
        if sec is None:
            continue
        ns = sec - start
        if ns < -eps or ns > upper + eps:
            actions.append({"action": "delete", "id": m["id"]})
            continue
        ns = max(0.0, ns)
        es = m.get("end_seconds")
        nes = None
        if es is not None:
            nes = min(max(es - start, ns), upper) if upper != float("inf") else max(es - start, ns)
        actions.append({"action": "update", "id": m["id"], "seconds": ns, "end_seconds": nes})
    return actions


def _run_local_encode(cmd, tmp, dst):
    """Run ffmpeg locally (in the Stash container) → atomic replace. Raises on failure.
    Logs are content-free (no command/paths) — the library is privacy-partitioned."""
    _log("i", "[SVE] encoding locally")
    result = subprocess.run(cmd, stderr=subprocess.PIPE)
    if result.returncode != 0:
        if os.path.exists(tmp):
            os.remove(tmp)
        # ffmpeg stderr can embed the source path — report only the code.
        raise RuntimeError("ffmpeg failed (returncode %s)" % result.returncode)
    os.replace(tmp, dst)  # finalize new file; source is never touched


def _encode(spec, cmd, tmp, dst):
    """Best-effort: encode on the Mac HW service (path-mode) when configured/reachable,
    else local ffmpeg. On offload success the Mac wrote `dst` over the shared NFS mount.
    Logs the exact reason for a local fallback (content-free). Returns 'offload'/'local'."""
    url, token = offload.offload_config()
    if not url:
        _log("i", "[SVE] offload disabled (SVE_OFFLOAD_URL not seen by plugin) — local")
    elif not offload.http_health(url, token):
        _log("i", "[SVE] offload service not healthy/reachable — local")
    elif offload.http_post(url, token, spec):
        return "offload"
    else:
        _log("i", "[SVE] offload POST failed (service returned not-ok) — local")
    _run_local_encode(cmd, tmp, dst)
    return "local"


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

    spec = offload.build_crop_spec(src, dst, crop, out_w, out_h,
                                   {"output_args": enc["output_args"]})
    try:
        where = _encode(spec, cmd, tmp, dst)
    except Exception as e:
        _log("e", "[SVE] crop failed scene %s: %s" % (scene_id, e))
        return
    _log("i", "[SVE] cropped scene %s via %s" % (scene_id, where))

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
    dst = derive_output_path(src, start=start)  # encode in-point for marker remap
    tmp = dst + ".sve-partial" + os.path.splitext(dst)[1]

    # ffmpeg path comes from Stash config either way; precision also mirrors the
    # configured transcode args, lossless ignores them (-c copy needs no encoder).
    cfg = gql.call(*get_configuration_query())["configuration"]["general"]
    enc = mirror_encode_args(cfg)
    try:
        if lossless:
            # Lossless (-c copy) is instant and never offloaded — run it locally.
            cmd = build_trim_command(enc["ffmpeg"], src, tmp, start, end, lossless=True)
            _run_local_encode(cmd, tmp, dst)
            where = "local"
        else:
            cmd = build_trim_command(enc["ffmpeg"], src, tmp, start, end, lossless=False,
                                     input_args=enc["input_args"], output_args=enc["output_args"])
            spec = offload.build_trim_spec(src, dst, start, end,
                                           {"output_args": enc["output_args"]})
            where = _encode(spec, cmd, tmp, dst)
    except Exception as e:
        _log("e", "[SVE] trim failed scene %s: %s" % (scene_id, e))
        return
    _log("i", "[SVE] trimmed scene %s (%s) via %s"
         % (scene_id, "lossless" if lossless else "precision", where))

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
            _log("e", "[SVE] no source scene for edited scene %s — leaving as-is" % sid)
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

    # Trim only: the timeline moved, so shift the scene's markers onto it (and drop
    # markers whose moment was cut away). Crop/stretch keep the timeline → offset 0,
    # no remap. Runs after the swap so we measure against the trimmed file.
    offset = derive_trim_offset(edited["path"])
    if offset > 0:
        _remap_scene_markers(gql, target, offset)
    return True


def _remap_scene_markers(gql, scene_id, offset):
    try:
        data = gql.call(*scene_markers_query(scene_id))["findScene"]
    except Exception as e:
        _log("e", "[SVE] marker query FAILED (scene=%s): %s" % (scene_id, e))
        return
    markers = data.get("scene_markers") or []
    if not markers:
        return
    files = data.get("files") or []
    new_dur = files[0].get("duration") if files else None  # files[0] = primary (trimmed)
    shifted = removed = 0
    for a in remap_markers(markers, offset, new_dur):
        try:
            if a["action"] == "delete":
                gql.call(*marker_destroy_mutation(a["id"])); removed += 1
            else:
                gql.call(*marker_update_mutation(a["id"], a["seconds"], a["end_seconds"])); shifted += 1
        except Exception as e:
            _log("e", "[SVE] marker %s %s FAILED: %s" % (a["id"], a["action"], e))
    _log("i", "[SVE] trim marker remap (shift %.3fs): %d shifted, %d removed"
         % (offset, shifted, removed))


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
