# Pure helpers for building the re-encode ffmpeg command. No Stash imports.

def even(n):
    n = int(round(n))
    if n < 0:
        return 0
    return n - (n % 2)

def build_vf(crop, out_w, out_h):
    cw, ch = even(crop["width"]), even(crop["height"])
    cx, cy = even(crop["x"]), even(crop["y"])
    ow, oh = even(out_w), even(out_h)
    return "crop=%d:%d:%d:%d,scale=%d:%d,setsar=1,format=yuv420p" % (cw, ch, cx, cy, ow, oh)

def mirror_encode_args(config_general):
    ffmpeg = config_general.get("ffmpegPath") or "ffmpeg"
    input_args = list(config_general.get("transcodeInputArgs") or [])
    output_args = list(config_general.get("transcodeOutputArgs") or [])
    if not output_args:
        output_args = ["-c:v", "libx264", "-crf", "18", "-preset", "slow"]
    return {"ffmpeg": ffmpeg, "input_args": input_args, "output_args": output_args}

def build_command(ffmpeg, src, dst, vf, input_args, output_args):
    return ([ffmpeg, "-loglevel", "error", "-y", *input_args, "-i", src,
             "-vf", vf, *output_args, "-c:a", "copy", "-map", "0", dst])

def format_timestamp(seconds):
    """Compact decimal-seconds string for ffmpeg -ss/-to (no trailing zeros)."""
    return ("%.3f" % float(seconds)).rstrip("0").rstrip(".")

def build_trim_command(ffmpeg, src, dst, start, end, lossless,
                       input_args=None, output_args=None):
    """Build a trim ffmpeg command for one in/out range.

    Seek (-ss/-to) is placed BEFORE -i in both modes:
      * lossless (-c copy): input-side seek snaps the in-point to the nearest
        preceding keyframe, so the output always CONTAINS the chosen range.
      * precision (re-encode): input-side seek is still fast, and ffmpeg decodes
        forward to the exact requested frame before encoding — frame-accurate.
    """
    ss, to = format_timestamp(start), format_timestamp(end)
    if lossless:
        return [ffmpeg, "-loglevel", "error", "-y",
                "-ss", ss, "-to", to, "-i", src,
                "-c", "copy", "-map", "0", "-avoid_negative_ts", "make_zero", dst]
    return [ffmpeg, "-loglevel", "error", "-y",
            *list(input_args or []), "-ss", ss, "-to", to, "-i", src,
            *list(output_args or []), "-c:a", "copy", "-map", "0", dst]
