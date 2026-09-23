"""/api/v1 路由匯總。"""

from fastapi import APIRouter

from app.api import admin, assets, auth, batches, jobs, templates, users

api_router = APIRouter(prefix="/api/v1")
for module in (auth, users, templates, jobs, assets, batches, admin):
    api_router.include_router(module.router)
