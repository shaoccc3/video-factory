"""腳本與分鏡階段：大模型寫分鏡（quick 類型直接由輸入生成單鏡頭），校驗、修正、入庫，進入 storyboard_ready。"""

import json
import uuid

import structlog
from sqlalchemy import delete, select

from app.core.models_config import ModelsConfig
from app.models import Job, Scene, User
from app.models.enums import JobStatus, VideoType
from app.pipeline.common import (
    StoryboardRules,
    check_storyboard,
    clip_duration,
    job_options,
    normalize_storyboard,
    video_model_key,
)
from app.pipeline.content_check import check_texts, load_blocklist
from app.pipeline.estimate import estimate_job
from app.pipeline.schemas import SCENE_LIST_JSON_HINT, SceneDraft, SceneList
from app.pipeline.state import transition
from app.pipeline.templates import render_prompt
from app.providers.base import ChatMessage
from app.providers.gateway import CallContext, Gateway
from app.services.runtime import Runtime

log = structlog.get_logger(__name__)
STORYBOARD_FIX_ROUNDS = 2

SYSTEM_PROMPT = f"""你是資深的短影音編劇與分鏡師，為公司內部的 AI 影片平台寫腳本。
只輸出一個 JSON 物件，格式如下（不要輸出其他文字）：
{SCENE_LIST_JSON_HINT}

規則：
- 旁白與畫面標語使用繁體中文；visual_prompt 用中文描述具體畫面：主體、動作、場景、光線、景別與運鏡。
- 不得出現真實人物姓名、明星、政治人物、第三方品牌或商標、電影／動漫／遊戲 IP；人物用「一位年輕女性」這類泛稱。
- 每個鏡頭 duration_s 為整數秒，且必須在約束範圍內；所有鏡頭時長加總接近目標總長。
- 需要以商品圖或特定畫面作為開場時，把該鏡頭的 needs_first_frame 設為 true。
- 用戶訊息末尾 constraints 標籤內的 JSON 是硬性約束。"""


def storyboard_rules(job: Job, config: ModelsConfig) -> StoryboardRules:
    snap = job.template_snapshot
    caps = config.video_caps(video_model_key(job))
    opts = job_options(job)
    min_total, max_total = float(snap["min_duration_s"]), float(snap["max_duration_s"])  # type: ignore[arg-type]
    target = opts.target_duration_s or (min_total + max_total) / 2
    return StoryboardRules(
        min_shots=int(snap["min_shots"]),  # type: ignore[call-overload]
        max_shots=int(snap["max_shots"]),  # type: ignore[call-overload]
        min_total_s=min_total,
        max_total_s=max_total,
        target_total_s=min(max(target, min_total), max_total),
        caps=caps,
        narration_driven=job.video_type == VideoType.TRAINING,
    )


def build_messages(job: Job, rules: StoryboardRules) -> list[ChatMessage]:
    opts = job_options(job)
    variables = {
        "topic": str(job.inputs.get("topic", "")),
        "extra": str(job.inputs.get("extra", "") or ""),
        "video_type": job.video_type,
        "target_duration_s": round(rules.target_total_s),
        "min_shots": rules.min_shots,
        "max_shots": rules.max_shots,
        "product_count": len(opts.product_asset_ids),
        "has_logo": opts.logo_asset_id is not None,
    }
    body = render_prompt(str(job.template_snapshot["prompt_template"]), variables)
    constraints = {
        "topic": variables["topic"],
        "video_type": job.video_type,
        "min_shots": rules.min_shots,
        "max_shots": rules.max_shots,
        "min_duration_s": rules.min_total_s,
        "max_duration_s": rules.max_total_s,
        "target_duration_s": rules.target_total_s,
        "clip_min_duration_s": rules.caps.min_duration_s,
        "clip_max_duration_s": rules.caps.max_duration_s,
    }
    user = f"{body}\n\n<constraints>{json.dumps(constraints, ensure_ascii=False)}</constraints>"
    return [ChatMessage("system", SYSTEM_PROMPT), ChatMessage("user", user)]


async def write_storyboard(gateway: Gateway, ctx: CallContext, job: Job, rules: StoryboardRules) -> SceneList:
    messages = build_messages(job, rules)
    result = await gateway.chat_json(ctx, messages, SceneList)
    for _ in range(STORYBOARD_FIX_ROUNDS):
        problems = check_storyboard(result.scenes, rules)
        if not problems:
            break
        log.info("storyboard_fix", job_id=str(job.id), problems=problems)
        messages = [
            *messages,
            ChatMessage("assistant", result.model_dump_json()),
            ChatMessage("user", "請修正以下問題後輸出完整 JSON：\n- " + "\n- ".join(problems)),
        ]
        result = await gateway.chat_json(ctx, messages, SceneList)
    return result.model_copy(update={"scenes": normalize_storyboard(result.scenes, rules)})


def quick_storyboard(job: Job, rules: StoryboardRules) -> SceneList:
    style = str(job.template_snapshot.get("style_prefix", ""))
    prompt = render_prompt(
        str(job.template_snapshot["prompt_template"]),
        {"topic": job.inputs.get("topic", ""), "extra": job.inputs.get("extra", "") or ""},
    )
    duration = clip_duration(rules.target_total_s, rules.caps)
    return SceneList(
        title=job.title,
        scenes=[SceneDraft(narration="", visual_prompt=f"{style}{prompt}", duration_s=duration)],
    )


async def run_scripting(runtime: Runtime, gateway: Gateway, job_id: uuid.UUID) -> None:
    """scripting → storyboard_ready。錯誤由呼叫方（編排器）統一處理。"""
    async with runtime.sessionmaker() as session:
        job = await session.get(Job, job_id)
        if job is None or job.status != JobStatus.SCRIPTING:
            return
        rules = storyboard_rules(job, runtime.config)
        opts = job_options(job)

    ctx = CallContext(job_id=job.id, user_id=job.owner_id)
    if job.video_type == VideoType.QUICK:
        board = quick_storyboard(job, rules)
    else:
        board = await write_storyboard(gateway, ctx, job, rules)

    async with runtime.sessionmaker() as session:
        job = await session.get(Job, job_id)
        if job is None or job.status != JobStatus.SCRIPTING:
            return  # 期間被取消
        await session.execute(delete(Scene).where(Scene.job_id == job.id))
        scenes = []
        product_ids = [str(x) for x in opts.product_asset_ids]
        for index, draft in enumerate(board.scenes):
            first_frame = None
            if index == 0 and job.video_type == VideoType.QUICK:
                first_frame = opts.image_asset_id
            scene = Scene(
                job_id=job.id,
                index=index,
                narration=draft.narration,
                visual_prompt=draft.visual_prompt,
                shot_type=draft.shot_type,
                camera_move=draft.camera_move,
                duration_s=draft.duration_s,
                needs_first_frame=draft.needs_first_frame and first_frame is None,
                screen_text=draft.screen_text,
                first_frame_asset_id=first_frame,
                ref_asset_ids=product_ids if draft.needs_first_frame else [],
                status="pending",
            )
            session.add(scene)
            scenes.append(scene)
        texts = [
            ("主題", str(job.inputs.get("topic", ""))),
            ("補充說明", str(job.inputs.get("extra", "") or "")),
        ]
        for s in scenes:
            texts += [
                (f"第 {s.index + 1} 鏡旁白", s.narration),
                (f"第 {s.index + 1} 鏡畫面", s.visual_prompt),
            ]
        warnings = check_texts(texts, load_blocklist(runtime.settings.content_blocklist_path))
        await session.flush()
        owner = await session.get(User, job.owner_id)
        if owner is None:
            raise LookupError("任務擁有者不存在")
        estimate = await estimate_job(session, runtime.config, job, scenes, owner)
        await transition(
            session,
            job.id,
            JobStatus.STORYBOARD_READY,
            from_statuses=[JobStatus.SCRIPTING],
            warnings=warnings,
            estimated_cost_cny=estimate.total_cny,
            error_kind=None,
            error_code=None,
            error_message=None,
        )
        await session.commit()


async def load_scenes(runtime: Runtime, job_id: uuid.UUID) -> list[Scene]:
    async with runtime.sessionmaker() as session:
        return list(
            (await session.scalars(select(Scene).where(Scene.job_id == job_id).order_by(Scene.index))).all()
        )
