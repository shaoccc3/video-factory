"""測試與 Mock 用的樣例媒體，全部用 ffmpeg 即時生成（不提交二進制文件）。"""

from pathlib import Path

from app.media.ffmpeg import run_ffmpeg


async def make_test_video(
    dest: Path,
    *,
    width: int,
    height: int,
    duration_s: float,
    fps: int = 24,
    with_audio: bool = False,
    pattern: str = "testsrc2",
) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    args = [
        "-f",
        "lavfi",
        "-i",
        f"{pattern}=size={width}x{height}:rate={fps}:duration={duration_s}",
    ]
    if with_audio:
        args += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={duration_s}"]
    args += ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"]
    args += ["-c:a", "aac", "-shortest"] if with_audio else ["-an"]
    args += [str(dest)]
    await run_ffmpeg(args)
    return dest


async def make_test_image(dest: Path, *, width: int, height: int, color: str = "0x3366aa") -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    await run_ffmpeg(
        [
            "-f",
            "lavfi",
            "-i",
            f"color=c={color}:size={width}x{height}",
            "-f",
            "lavfi",
            "-i",
            f"testsrc2=size={width // 2}x{height // 2}",
            "-filter_complex",
            "[0][1]overlay=(W-w)/2:(H-h)/2",
            "-frames:v",
            "1",
            str(dest),
        ]
    )
    return dest


async def make_test_audio(dest: Path, *, duration_s: float, frequency: int = 440) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    codec = ["-c:a", "libmp3lame"] if dest.suffix == ".mp3" else []
    await run_ffmpeg(
        [
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency={frequency}:duration={duration_s}",
            *codec,
            str(dest),
        ]
    )
    return dest


async def extract_last_frame(video: Path, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    await run_ffmpeg(["-sseof", "-0.1", "-i", str(video), "-frames:v", "1", "-update", "1", str(dest)])
    return dest
