"""列舉值（存為字串欄位，方便遷移）。與 docs/specs/api-contract.md 一致。"""

from enum import StrEnum


class Role(StrEnum):
    ADMIN = "admin"
    CREATOR = "creator"
    REVIEWER = "reviewer"


class VideoType(StrEnum):
    MARKETING = "marketing"
    QUICK = "quick"
    TRAINING = "training"


class AudioMode(StrEnum):
    TTS = "tts"
    NATIVE = "native"
    NONE = "none"


class JobStatus(StrEnum):
    DRAFT = "draft"
    SCRIPTING = "scripting"
    STORYBOARD_READY = "storyboard_ready"
    GENERATING = "generating"
    COMPOSING = "composing"
    IN_REVIEW = "in_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    FAILED = "failed"
    CANCELLED = "cancelled"
    BUDGET_EXCEEDED = "budget_exceeded"


class JobPhase(StrEnum):
    DRAFT = "draft"  # 樣片階段
    FINAL = "final"  # 正片階段


class SceneStatus(StrEnum):
    PENDING = "pending"
    KEYFRAME = "keyframe"
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class AssetKind(StrEnum):
    LOGO = "logo"
    PRODUCT = "product"
    IMAGE = "image"
    FONT = "font"
    BGM = "bgm"
    KEYFRAME = "keyframe"
    CLIP = "clip"
    LAST_FRAME = "last_frame"
    VOICE = "voice"
    SUBTITLE = "subtitle"
    FINAL = "final"
    COVER = "cover"
    CSV = "csv"


UPLOADABLE_KINDS = frozenset(
    {AssetKind.LOGO, AssetKind.PRODUCT, AssetKind.IMAGE, AssetKind.BGM, AssetKind.FONT}
)


class ErrorKind(StrEnum):
    MODERATION = "moderation"
    RATE_LIMIT = "rate_limit"
    TIMEOUT = "timeout"
    SERVER = "server"
    CLIENT = "client"
    BUDGET = "budget"
    INTERNAL = "internal"


class ProviderName(StrEnum):
    LLM = "llm"
    SEEDREAM = "seedream"
    SEEDANCE = "seedance"
    TTS = "tts"


class ReviewDecision(StrEnum):
    APPROVED = "approved"
    REJECTED = "rejected"


REVIEW_CHECKLIST_KEYS = (
    "ai_label",
    "no_real_person",
    "no_third_party_ip",
    "brand_guideline",
    "subtitle_ok",
)
