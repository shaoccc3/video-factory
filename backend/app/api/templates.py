"""模板：所有人可讀，管理員可建立與修改。"""

import uuid

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select

from app.api.deps import AdminUser, CurrentUser, SessionDep
from app.api.schemas import TemplateCreate, TemplateOut, TemplateUpdate
from app.models import Template
from app.services.audit import audit

router = APIRouter(prefix="/templates", tags=["templates"])


def _check_ranges(min_d: int, max_d: int, min_s: int, max_s: int) -> None:
    if min_d > max_d or min_s > max_s:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "最小值不能大於最大值")


@router.get("", response_model=list[TemplateOut])
async def list_templates(
    _: CurrentUser, session: SessionDep, include_inactive: bool = False
) -> list[Template]:
    query = select(Template).order_by(Template.created_at)
    if not include_inactive:
        query = query.where(Template.is_active.is_(True))
    return list((await session.scalars(query)).all())


@router.get("/{template_id}", response_model=TemplateOut)
async def get_template(template_id: uuid.UUID, _: CurrentUser, session: SessionDep) -> Template:
    tpl = await session.get(Template, template_id)
    if tpl is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "模板不存在")
    return tpl


@router.post("", response_model=TemplateOut, status_code=status.HTTP_201_CREATED)
async def create_template(
    body: TemplateCreate, admin: AdminUser, session: SessionDep, request: Request
) -> Template:
    _check_ranges(body.min_duration_s, body.max_duration_s, body.min_shots, body.max_shots)
    if await session.scalar(select(Template.id).where(Template.key == body.key)):
        raise HTTPException(status.HTTP_409_CONFLICT, "模板 key 已存在")
    tpl = Template(**body.model_dump(mode="json"), version=1)
    session.add(tpl)
    await session.flush()
    audit(
        session, request, admin.id, "template_create", target_type="template", target_id=tpl.id, key=tpl.key
    )
    await session.commit()
    return tpl


@router.patch("/{template_id}", response_model=TemplateOut)
async def update_template(
    template_id: uuid.UUID, body: TemplateUpdate, admin: AdminUser, session: SessionDep, request: Request
) -> Template:
    tpl = await session.get(Template, template_id)
    if tpl is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "模板不存在")
    changes = body.model_dump(exclude_unset=True, mode="json")
    for name, value in changes.items():
        if value is not None:
            setattr(tpl, name, value)
    _check_ranges(tpl.min_duration_s, tpl.max_duration_s, tpl.min_shots, tpl.max_shots)
    tpl.version += 1
    audit(
        session,
        request,
        admin.id,
        "template_update",
        target_type="template",
        target_id=tpl.id,
        fields=sorted(changes),
    )
    await session.commit()
    return tpl
