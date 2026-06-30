# offload.py — best-effort encode offload to the Mac HW encode service.
# Path-mode: send the scene's /data path + an encode spec; the service reads/writes
# over the shared NFS mount. Falls back to local ffmpeg when the service is
# unconfigured, unreachable, or fails. The decision is DI'd so it's unit-testable.
import json
import os
import urllib.request


def offload_config():
    """(url, token) for the Mac encode service from the container env (set in the
    namaste compose), or (None, None) when offload is off. Stash passes the container
    env through to plugin subprocesses, so env is the config channel."""
    url = os.environ.get("SVE_OFFLOAD_URL")
    token = os.environ.get("SVE_OFFLOAD_TOKEN")
    return (url, token) if url else (None, None)


def build_crop_spec(src, dst, crop, out_w, out_h, encode):
    return {"op": "crop", "src": src, "dst": dst, "crop": crop,
            "out_w": out_w, "out_h": out_h, "encode": encode}


def build_trim_spec(src, dst, start, end, encode):
    return {"op": "trim", "src": src, "dst": dst, "start": start, "end": end, "encode": encode}


def choose_and_encode(spec, *, url, token, health, post, local):
    """Try the Mac service; on any miss run local(). Returns which path executed.
    health(url, token)->bool and post(url, token, spec)->bool are injected so the
    decision can be tested without a network."""
    if url and health(url, token) and post(url, token, spec):
        return "offload"
    local()
    return "local"


def http_health(url, token, timeout=2.0):
    try:
        req = urllib.request.Request(url.rstrip("/") + "/health")
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8")).get("ok") is True
    except Exception:
        return False


def http_post(url, token, spec, timeout=3600):
    try:
        body = json.dumps(spec).encode("utf-8")
        req = urllib.request.Request(
            url.rstrip("/") + "/encode", data=body, method="POST",
            headers={"Content-Type": "application/json",
                     "Authorization": "Bearer " + (token or "")})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8")).get("ok") is True
    except Exception:
        return False
