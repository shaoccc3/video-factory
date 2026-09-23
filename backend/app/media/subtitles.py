"""字幕：按標點斷句、每行不超過 16 字，時間軸按字數比例分配到旁白時長內，輸出 SRT。"""

from dataclasses import dataclass

MAX_CHARS = 16
BREAK_AFTER = set("。！？；，、：,.!?;:")
STRIP_TAIL = "，。、；：,.;:"


@dataclass(frozen=True)
class Cue:
    start_s: float
    end_s: float
    text: str


def _visible_len(text: str) -> int:
    return sum(1 for ch in text if not ch.isspace())


def _phrases(text: str) -> list[str]:
    """按標點切成短句（標點留在句尾）。"""
    phrases, buf = [], ""
    for ch in text.strip():
        if ch == "\n":
            ch = "，"
        buf += ch
        if ch in BREAK_AFTER:
            phrases.append(buf.strip())
            buf = ""
    if buf.strip():
        phrases.append(buf.strip())
    return [p for p in phrases if p]


def _hard_wrap(phrase: str, max_chars: int) -> list[str]:
    out, buf = [], ""
    for ch in phrase:
        if _visible_len(buf + ch) > max_chars:
            out.append(buf)
            buf = ""
        buf += ch
    if buf:
        out.append(buf)
    return out


def split_lines(text: str, max_chars: int = MAX_CHARS) -> list[str]:
    """把旁白切成字幕行：盡量在標點處斷開，短句合併，超長句硬切；去掉行尾的逗號句號。"""
    lines: list[str] = []
    buf = ""
    for phrase in _phrases(text):
        if _visible_len(phrase.rstrip(STRIP_TAIL)) > max_chars:
            if buf:
                lines.append(buf)
                buf = ""
            lines.extend(_hard_wrap(phrase, max_chars))
            continue
        candidate = buf + phrase
        if _visible_len(candidate.rstrip(STRIP_TAIL)) <= max_chars:
            buf = candidate
        else:
            lines.append(buf)
            buf = phrase
    if buf:
        lines.append(buf)
    cleaned = [line.strip().rstrip(STRIP_TAIL).strip() for line in lines]
    return [line for line in cleaned if line]


def cues_for_text(text: str, start_s: float, duration_s: float, max_chars: int = MAX_CHARS) -> list[Cue]:
    lines = split_lines(text, max_chars)
    if not lines or duration_s <= 0:
        return []
    total = sum(max(1, _visible_len(line)) for line in lines)
    cues, t = [], start_s
    for line in lines:
        span = duration_s * max(1, _visible_len(line)) / total
        cues.append(Cue(round(t, 3), round(t + span, 3), line))
        t += span
    return cues


def _ts(seconds: float) -> str:
    ms = max(0, round(seconds * 1000))
    h, rem = divmod(ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def to_srt(cues: list[Cue]) -> str:
    blocks = [f"{i}\n{_ts(c.start_s)} --> {_ts(c.end_s)}\n{c.text}\n" for i, c in enumerate(cues, 1)]
    return "\n".join(blocks)
