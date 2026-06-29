from ffmpeg_args import (even, build_vf, mirror_encode_args, build_command,
                         format_timestamp, build_trim_command)

def test_even():
    assert even(101) == 100
    assert even(103) == 102  # round DOWN to even — bounds-safe, matches cropMath.evenRound
    assert even(-3) == 0

def test_build_vf_crop_and_stretch():
    crop = {"x": 480, "y": 270, "width": 960, "height": 540}
    assert build_vf(crop, 1920, 1080) == "crop=960:540:480:270,scale=1920:1080,setsar=1,format=yuv420p"

def test_build_vf_forces_even_output():
    crop = {"x": 0, "y": 0, "width": 1280, "height": 720}
    assert build_vf(crop, 641, 361) == "crop=1280:720:0:0,scale=640:360,setsar=1,format=yuv420p"

def test_mirror_uses_stash_args_when_present():
    cfg = {
        "ffmpegPath": "/usr/bin/ffmpeg",
        "transcodeHardwareAcceleration": False,
        "transcodeInputArgs": ["-hwaccel", "none"],
        "transcodeOutputArgs": ["-c:v", "libx264", "-crf", "20"],
    }
    out = mirror_encode_args(cfg)
    assert out == {"ffmpeg": "/usr/bin/ffmpeg",
                   "input_args": ["-hwaccel", "none"],
                   "output_args": ["-c:v", "libx264", "-crf", "20"]}

def test_mirror_falls_back_when_output_args_empty():
    cfg = {"ffmpegPath": "", "transcodeInputArgs": [], "transcodeOutputArgs": []}
    out = mirror_encode_args(cfg)
    assert out["ffmpeg"] == "ffmpeg"
    assert out["output_args"] == ["-c:v", "libx264", "-crf", "18", "-preset", "slow"]

def test_build_command_order():
    cmd = build_command("ffmpeg", "in.mp4", "out.mp4",
                        "crop=10:10:0:0,scale=10:10,setsar=1,format=yuv420p",
                        ["-hwaccel", "none"], ["-c:v", "libx264"])
    assert cmd == ["ffmpeg", "-loglevel", "error", "-y",
                   "-hwaccel", "none", "-i", "in.mp4",
                   "-vf", "crop=10:10:0:0,scale=10:10,setsar=1,format=yuv420p",
                   "-c:v", "libx264", "-c:a", "copy", "-map", "0", "out.mp4"]


# ── Lossless trim (v1.2) ─────────────────────────────────────────────────────

def test_format_timestamp_strips_trailing_zeros():
    # ffmpeg accepts decimal seconds; format compactly without losing precision.
    assert format_timestamp(0) == "0"
    assert format_timestamp(90.0) == "90"
    assert format_timestamp(12.5) == "12.5"
    assert format_timestamp(105.25) == "105.25"

def test_build_trim_command_lossless_is_stream_copy():
    cmd = build_trim_command("ffmpeg", "in.mp4", "in.edited.mp4", 12.5, 105.25,
                             lossless=True)
    assert cmd == ["ffmpeg", "-loglevel", "error", "-y",
                   "-ss", "12.5", "-to", "105.25", "-i", "in.mp4",
                   "-c", "copy", "-map", "0", "-avoid_negative_ts", "make_zero",
                   "in.edited.mp4"]

def test_build_trim_command_lossless_no_reencode_and_seek_before_input():
    # -c copy means no -vf and no encoder args; seek BEFORE -i fast-seeks to the
    # nearest preceding keyframe, so the output always CONTAINS the chosen range.
    cmd = build_trim_command("ffmpeg", "in.mp4", "out.mp4", 0, 10, lossless=True)
    assert "-vf" not in cmd
    assert cmd[cmd.index("-c") + 1] == "copy"
    assert cmd.index("-ss") < cmd.index("-i")
    assert cmd.index("-to") < cmd.index("-i")

def test_build_trim_command_precision_reencodes_with_mirrored_args():
    cmd = build_trim_command("ffmpeg", "in.mp4", "out.mp4", 12.5, 105.25,
                             lossless=False,
                             input_args=["-hwaccel", "none"],
                             output_args=["-c:v", "libx264", "-crf", "18"])
    assert cmd == ["ffmpeg", "-loglevel", "error", "-y",
                   "-hwaccel", "none",
                   "-ss", "12.5", "-to", "105.25", "-i", "in.mp4",
                   "-c:v", "libx264", "-crf", "18", "-c:a", "copy", "-map", "0",
                   "out.mp4"]

def test_build_trim_command_precision_is_not_a_stream_copy():
    cmd = build_trim_command("ffmpeg", "in.mp4", "out.mp4", 1, 2, lossless=False,
                             input_args=[], output_args=["-c:v", "libx264"])
    # frame-accurate path must actually encode video, never "-c copy"
    assert "-c" not in cmd
    assert "copy" not in cmd[:cmd.index("-c:a")]
