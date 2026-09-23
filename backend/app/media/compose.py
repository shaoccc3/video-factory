"""FFmpeg 合成（P9）：統一規格、淡入淡出轉場、字幕、Logo、AI 生成標識、混音與響度標準化。

命令全部由構建器生成（純函數，可單元測試），再由 run_compose 依次執行：
1. 每個片段統一解析度、幀率、像素格式，並對齊到目標時長（短了延長最後一幀，長了裁剪）
2. 生成 2 秒片頭：「本影片由 AI 生成」
3. 最終合成：xfade 轉場 → Logo → 字幕 → 角落 AI 標識；旁白按時間軸放置、背景音樂在旁白出現時壓低、響度標準化
4. 截取封面
"""

from dataclasses import dataclass, field
from pathlib import Path

from app.media.ffmpeg import run_ffmpeg

FPS = 30
INTRO_S = 2.0
TRANSITION_S = 0.5
LOUDNESS_I = -14.0
AI_NOTICE = "本影片由 AI 生成"
AI_CORNER = "AI 生成"


@dataclass(frozen=True)
class ClipInput:
    video: Path
    duration_s: float  # 在成片中顯示的時長（含轉場重疊）
    voice: Path | None = None  # 旁白音頻（TTS）
    voice_duration_s: float | None = None
    native_audio: bool = False  # 使用片段自帶的音頻


@dataclass(frozen=True)
class ComposeSpec:
    width: int
    height: int
    clips: list[ClipInput]
    title: str
    font_file: Path
    fonts_dir: Path
    font_family: str
    metadata: dict[str, str]
    subtitles: Path | None = None
    logo: Path | None = None
    bgm: Path | None = None
    intro_s: float = INTRO_S
    transition_s: float = TRANSITION_S
    fps: int = FPS


@dataclass(frozen=True)
class Timeline:
    starts: list[float]  # 每段（含片頭，索引 0）在成片中的開始時間
    total_s: float
    clip_starts: list[float] = field(default_factory=list)  # 只含分鏡


def target_duration(
    video_s: float, voice_s: float | None, *, transition_s: float = TRANSITION_S, min_s: float = 2.0
) -> float:
    """片段在成片中的時長：有旁白時對齊旁白（延長或裁剪），沒有旁白時保持原長。"""
    if voice_s is None:
        return round(max(video_s, min_s), 3)
    return round(max(voice_s + transition_s + 0.2, min_s), 3)


def timeline(durations: list[float], transition_s: float) -> Timeline:
    """durations 含片頭。xfade 讓相鄰兩段重疊 transition_s 秒。"""
    starts, t = [], 0.0
    for i, d in enumerate(durations):
        starts.append(round(t, 3))
        t += d - (transition_s if i < len(durations) - 1 else 0)
    return Timeline(starts=starts, total_s=round(t, 3), clip_starts=starts[1:])


def _esc(value: str) -> str:
    """濾鏡參數值轉義（路徑等）。"""
    return value.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'").replace(",", "\\,")


def normalize_args(
    src: Path, dest: Path, *, width: int, height: int, duration_s: float, fps: int = FPS
) -> list[str]:
    vf = (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps={fps},format=yuv420p,"
        f"tpad=stop_mode=clone:stop_duration={duration_s:.3f}"
    )
    return [
        "-i", str(src), "-vf", vf, "-t", f"{duration_s:.3f}", "-an",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", str(dest),
    ]  # fmt: skip


def native_audio_args(src: Path, dest: Path, *, duration_s: float) -> list[str]:
    return [
        "-i",
        str(src),
        "-vn",
        "-af",
        f"apad,atrim=0:{duration_s:.3f}",
        "-ar",
        "48000",
        "-ac",
        "2",
        str(dest),
    ]


def intro_args(
    dest: Path, *, width: int, height: int, title_file: Path, notice_file: Path, font_file: Path,
    duration_s: float = INTRO_S, fps: int = FPS,
) -> list[str]:  # fmt: skip
    font = _esc(str(font_file))
    big, small = max(28, height // 18), max(20, height // 32)
    vf = (
        f"drawtext=fontfile='{font}':textfile='{_esc(str(title_file))}':fontsize={big}:fontcolor=white:"
        f"x=(w-text_w)/2:y=(h/2)-{big},"
        f"drawtext=fontfile='{font}':textfile='{_esc(str(notice_file))}':fontsize={small}:fontcolor=white@0.9:"
        f"x=(w-text_w)/2:y=(h/2)+{small},"
        f"fade=t=in:st=0:d=0.3,format=yuv420p"
    )
    return [
        "-f", "lavfi", "-i", f"color=c=0x101418:s={width}x{height}:r={fps}:d={duration_s:.3f}",
        "-vf", vf, "-t", f"{duration_s:.3f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", str(dest),
    ]  # fmt: skip


def final_args(
    spec: ComposeSpec,
    *,
    intro: Path,
    segments: list[Path],
    native_audio: dict[int, Path],
    corner_file: Path,
    dest: Path,
) -> list[str]:
    """最終合成命令。segments 與 spec.clips 一一對應，已是統一規格且對齊時長。"""
    durations = [spec.intro_s] + [c.duration_s for c in spec.clips]
    tl = timeline(durations, spec.transition_s)
    args: list[str] = ["-i", str(intro)]
    for seg in segments:
        args += ["-i", str(seg)]
    n_video = 1 + len(segments)
    idx = n_video

    filters: list[str] = []
    # 視頻：xfade 轉場鏈
    prev = "[0:v]"
    for i in range(1, n_video):
        out = f"[x{i}]"
        filters.append(
            f"{prev}[{i}:v]xfade=transition=fade:duration={spec.transition_s:.3f}:offset={tl.starts[i]:.3f}{out}"
        )
        prev = out
    video = prev
    if spec.logo is not None:
        args += ["-i", str(spec.logo)]
        logo_w = max(64, spec.width // 7)
        margin = max(16, spec.width // 40)
        filters.append(f"[{idx}:v]scale={logo_w}:-1,format=rgba,colorchannelmixer=aa=0.9[logo]")
        filters.append(
            f"{video}[logo]overlay=W-w-{margin}:{margin}:enable='gte(t,{spec.intro_s:.3f})'[vlogo]"
        )
        video = "[vlogo]"
        idx += 1
    if spec.subtitles is not None:
        size = 12 if spec.height > spec.width else 16  # libass 以 PlayResY=288 為基準縮放
        style = f"FontName={spec.font_family},FontSize={size},Outline=1.2,Shadow=0,MarginV=24,BorderStyle=1"
        filters.append(
            f"{video}subtitles=filename='{_esc(str(spec.subtitles))}':fontsdir='{_esc(str(spec.fonts_dir))}':"
            f"force_style='{style}'[vsub]"
        )
        video = "[vsub]"
    corner = max(14, spec.height // 48)
    filters.append(
        f"{video}drawtext=fontfile='{_esc(str(spec.font_file))}':textfile='{_esc(str(corner_file))}':"
        f"fontsize={corner}:fontcolor=white@0.85:box=1:boxcolor=black@0.35:boxborderw=6:"
        f"x={corner}:y=h-th-{corner}[vout]"
    )

    # 音頻：旁白與原生音頻按時間軸放置
    voices: list[str] = []
    for k, clip in enumerate(spec.clips):
        start_ms = round((tl.clip_starts[k] + spec.transition_s / 2) * 1000)
        if clip.voice is not None:
            args += ["-i", str(clip.voice)]
            filters.append(
                f"[{idx}:a]aresample=48000,aformat=channel_layouts=stereo,adelay={start_ms}:all=1[va{k}]"
            )
            voices.append(f"[va{k}]")
            idx += 1
        if k in native_audio:
            args += ["-i", str(native_audio[k])]
            native_ms = round(tl.clip_starts[k] * 1000)
            # 模型原生聲音：保留原音量，頭尾各淡入淡出半個轉場，和畫面的交叉淡化同步
            half = spec.transition_s / 2
            fade_out = max(0.0, clip.duration_s - half)
            filters.append(
                f"[{idx}:a]aresample=48000,aformat=channel_layouts=stereo,"
                f"afade=t=in:st=0:d={half:.3f},afade=t=out:st={fade_out:.3f}:d={half:.3f},"
                f"adelay={native_ms}:all=1[na{k}]"
            )
            voices.append(f"[na{k}]")
            idx += 1
    total = tl.total_s
    if voices:
        filters.append(
            f"{''.join(voices)}amix=inputs={len(voices)}:normalize=0:dropout_transition=0,"
            f"apad,atrim=0:{total:.3f}[voice]"
        )
    else:
        filters.append(f"anullsrc=r=48000:cl=stereo,atrim=0:{total:.3f}[voice]")
    if spec.bgm is not None:
        args += ["-stream_loop", "-1", "-i", str(spec.bgm)]
        filters.append(
            f"[{idx}:a]aresample=48000,aformat=channel_layouts=stereo,volume=0.35,atrim=0:{total:.3f},"
            f"afade=t=out:st={max(0.0, total - 1.5):.3f}:d=1.5[bgm]"
        )
        filters.append("[voice]asplit=2[voice_mix][voice_sc]")
        filters.append(
            "[bgm][voice_sc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[bgm_duck]"
        )
        filters.append("[voice_mix][bgm_duck]amix=inputs=2:normalize=0:dropout_transition=0[mix]")
        mixed = "[mix]"
        idx += 1
    else:
        mixed = "[voice]"
    filters.append(f"{mixed}loudnorm=I={LOUDNESS_I}:TP=-1.5:LRA=11,aresample=48000[aout]")

    args += ["-filter_complex", ";".join(filters), "-map", "[vout]", "-map", "[aout]", "-t", f"{total:.3f}"]
    args += ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", str(spec.fps)]
    args += ["-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"]
    args += ["-movflags", "+faststart+use_metadata_tags"]
    for key, value in spec.metadata.items():
        args += ["-metadata", f"{key}={value}"]
    args += [str(dest)]
    return args


def cover_args(src: Path, dest: Path, *, at_s: float) -> list[str]:
    return ["-ss", f"{at_s:.3f}", "-i", str(src), "-frames:v", "1", "-q:v", "3", str(dest)]


async def run_compose(spec: ComposeSpec, work: Path, dest: Path, cover: Path) -> Timeline:
    work.mkdir(parents=True, exist_ok=True)
    title_file = work / "title.txt"
    title_file.write_text(spec.title[:40] or " ", encoding="utf-8")
    notice_file = work / "notice.txt"
    notice_file.write_text(AI_NOTICE, encoding="utf-8")
    corner_file = work / "corner.txt"
    corner_file.write_text(AI_CORNER, encoding="utf-8")

    intro = work / "intro.mp4"
    await run_ffmpeg(
        intro_args(
            intro, width=spec.width, height=spec.height, title_file=title_file, notice_file=notice_file,
            font_file=spec.font_file, duration_s=spec.intro_s, fps=spec.fps,
        )
    )  # fmt: skip
    segments: list[Path] = []
    native: dict[int, Path] = {}
    for k, clip in enumerate(spec.clips):
        seg = work / f"seg-{k:02d}.mp4"
        await run_ffmpeg(
            normalize_args(
                clip.video,
                seg,
                width=spec.width,
                height=spec.height,
                duration_s=clip.duration_s,
                fps=spec.fps,
            )
        )
        segments.append(seg)
        if clip.native_audio:
            audio = work / f"native-{k:02d}.wav"
            try:
                await run_ffmpeg(native_audio_args(clip.video, audio, duration_s=clip.duration_s))
                native[k] = audio
            except Exception:  # noqa: S110 - 片段沒有音軌時跳過
                pass
    await run_ffmpeg(
        final_args(
            spec, intro=intro, segments=segments, native_audio=native, corner_file=corner_file, dest=dest
        )
    )
    await run_ffmpeg(cover_args(dest, cover, at_s=spec.intro_s + 0.5))
    durations = [spec.intro_s] + [c.duration_s for c in spec.clips]
    return timeline(durations, spec.transition_s)
