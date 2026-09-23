"""P8／P9：字幕斷行與時間軸、FFmpeg 命令構建、合成集成測試（樣例影片用 ffmpeg testsrc 即時生成）。"""

import itertools
from pathlib import Path

import pytest

from app.core.settings import REPO_ROOT
from app.media.compose import ClipInput, ComposeSpec, final_args, run_compose, target_duration, timeline
from app.media.ffmpeg import probe
from app.media.samples import make_test_audio, make_test_image, make_test_video
from app.media.subtitles import cues_for_text, split_lines, to_srt

FONTS = REPO_ROOT / "assets" / "fonts"
FONT = FONTS / "NotoSansCJKtc-Regular.otf"


# ---- 字幕 ---------------------------------------------------------------------


def test_split_lines_by_punctuation_and_length() -> None:
    text = "清晨的茶園，陽光灑在嫩綠的茶葉上。一杯好茶，讓忙碌的日子慢下來！現在就來試試看吧"
    lines = split_lines(text)
    assert all(len(line) <= 16 for line in lines)
    assert lines[0] == "清晨的茶園，陽光灑在嫩綠的茶葉上"
    assert "一杯好茶，讓忙碌的日子慢下來！" in lines
    assert lines[-1] == "現在就來試試看吧"


def test_split_lines_hard_wraps_long_phrase() -> None:
    lines = split_lines("這是一段完全沒有標點符號而且非常非常長的旁白內容需要被切開")
    assert len(lines) == 2 and all(len(line) <= 16 for line in lines)


def test_split_lines_empty() -> None:
    assert split_lines("  ") == []


def test_cues_cover_duration_proportionally() -> None:
    cues = cues_for_text("第一句話，第二句比較長一點的話。", 2.0, 4.0, max_chars=6)
    assert cues[0].start_s == 2.0
    assert cues[-1].end_s == pytest.approx(6.0, abs=0.01)
    for a, b in itertools.pairwise(cues):
        assert a.end_s == pytest.approx(b.start_s, abs=0.01)


def test_srt_format() -> None:
    srt = to_srt(cues_for_text("你好，世界", 61.5, 2.0))
    assert srt.startswith("1\n00:01:01,500 --> ")
    assert "你好，世界" in srt


# ---- 時間軸與命令構建 ---------------------------------------------------------


def test_target_duration_aligns_to_voice() -> None:
    assert target_duration(5.0, None) == 5.0  # 沒旁白保持原長
    assert target_duration(5.0, 2.0) == pytest.approx(2.7)  # 旁白短：裁剪
    assert target_duration(3.0, 6.0) == pytest.approx(6.7)  # 旁白長：延長最後一幀
    assert target_duration(1.0, None) == 2.0  # 最短 2 秒


def test_timeline_with_transitions() -> None:
    tl = timeline([2.0, 5.0, 4.0], 0.5)
    assert tl.starts == [0.0, 1.5, 6.0]
    assert tl.total_s == pytest.approx(10.0)
    assert tl.clip_starts == [1.5, 6.0]


def _spec(tmp: Path, **kw: object) -> ComposeSpec:
    base: dict[str, object] = {
        "width": 720,
        "height": 1280,
        "clips": [ClipInput(tmp / "a.mp4", 3.0, tmp / "v.mp3", 2.0), ClipInput(tmp / "b.mp4", 4.0)],
        "title": "標題",
        "font_file": FONT,
        "fonts_dir": FONTS,
        "font_family": "Noto Sans CJK TC",
        "metadata": {"aigc_label": "AI生成", "title": "標題"},
    }
    base.update(kw)
    return ComposeSpec(**base)  # type: ignore[arg-type]


def test_final_args_contains_required_filters(tmp_path: Path) -> None:
    spec = _spec(tmp_path, subtitles=tmp_path / "s.srt", logo=tmp_path / "logo.png", bgm=tmp_path / "bgm.mp3")
    args = final_args(
        spec,
        intro=tmp_path / "intro.mp4",
        segments=[tmp_path / "s0.mp4", tmp_path / "s1.mp4"],
        native_audio={},
        corner_file=tmp_path / "c.txt",
        dest=tmp_path / "out.mp4",
    )
    graph = args[args.index("-filter_complex") + 1]
    assert "xfade=transition=fade:duration=0.500:offset=1.500" in graph
    assert "xfade=transition=fade:duration=0.500:offset=4.000" in graph
    assert "subtitles=filename=" in graph and "FontName=Noto Sans CJK TC" in graph
    assert "overlay=" in graph and "drawtext=" in graph
    assert "sidechaincompress" in graph and "loudnorm=I=-14.0" in graph
    assert "adelay=1750:all=1" in graph  # 旁白從第一段開始後 transition/2 放入
    assert args[args.index("-c:v") + 1] == "libx264" and args[args.index("-c:a") + 1] == "aac"
    assert "aigc_label=AI生成" in args
    assert "+faststart+use_metadata_tags" in args


def test_final_args_without_audio_uses_silence(tmp_path: Path) -> None:
    spec = _spec(tmp_path, clips=[ClipInput(tmp_path / "a.mp4", 3.0)])
    args = final_args(
        spec, intro=tmp_path / "i.mp4", segments=[tmp_path / "s.mp4"], native_audio={},
        corner_file=tmp_path / "c.txt", dest=tmp_path / "o.mp4",
    )  # fmt: skip
    assert "anullsrc" in args[args.index("-filter_complex") + 1]


# ---- 集成：真的跑 ffmpeg -------------------------------------------------------


@pytest.mark.anyio
@pytest.mark.skipif(not FONT.exists(), reason="缺少字體，請執行 scripts/fetch_fonts.py")
async def test_compose_integration(tmp_path: Path) -> None:
    from app.media.subtitles import cues_for_text as cues

    clips = []
    for i in range(3):
        video = await make_test_video(
            tmp_path / f"c{i}.mp4", width=240, height=426, duration_s=3, with_audio=i == 1
        )
        voice = await make_test_audio(tmp_path / f"v{i}.mp3", duration_s=2.0)
        clips.append(ClipInput(video, target_duration(3, 2.0), voice, 2.0, native_audio=i == 1))
    tl = timeline([2.0] + [c.duration_s for c in clips], 0.5)
    srt = tmp_path / "s.srt"
    srt.write_text(to_srt(cues("測試字幕，第一句。", tl.clip_starts[0] + 0.25, 2.0)), encoding="utf-8")
    logo = await make_test_image(tmp_path / "logo.png", width=100, height=50)
    bgm = await make_test_audio(tmp_path / "bgm.mp3", duration_s=3)
    spec = _spec(tmp_path, width=360, height=640, clips=clips, subtitles=srt, logo=logo, bgm=bgm,
                 metadata={"aigc_label": "AI生成", "aigc_content_id": "job-x", "title": "標題"})  # fmt: skip
    out, cover = tmp_path / "final.mp4", tmp_path / "cover.jpg"
    tl2 = await run_compose(spec, tmp_path / "work", out, cover)
    info = await probe(out)
    assert (info.width, info.height) == (360, 640)
    assert info.duration_s == pytest.approx(tl2.total_s, abs=0.15)
    assert info.video_codec == "h264" and info.audio_codec == "aac"
    assert info.fps == pytest.approx(30, abs=0.1)
    assert info.tags["aigc_label"] == "AI生成" and info.tags["aigc_content_id"] == "job-x"
    assert cover.exists() and cover.stat().st_size > 0
