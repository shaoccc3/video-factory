"""大模型輸出的分鏡結構（SceneList）。"""

from pydantic import BaseModel, ConfigDict, Field


class SceneDraft(BaseModel):
    model_config = ConfigDict(extra="ignore")

    narration: str = Field(default="", max_length=400)
    visual_prompt: str = Field(min_length=1, max_length=800)
    shot_type: str = Field(default="", max_length=50)
    camera_move: str = Field(default="", max_length=50)
    duration_s: float = Field(gt=0, le=60)
    needs_first_frame: bool = False
    screen_text: str = Field(default="", max_length=60)


class SceneList(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str = Field(default="", max_length=100)
    scenes: list[SceneDraft] = Field(min_length=1, max_length=40)


SCENE_LIST_JSON_HINT = """{
  "title": "影片標題",
  "scenes": [
    {
      "narration": "這個鏡頭的旁白（繁體中文口語）",
      "visual_prompt": "給影片模型的畫面描述：主體、場景、光線、鏡頭語言",
      "shot_type": "遠景／中景／近景／特寫",
      "camera_move": "推進／拉遠／橫移／環繞／固定機位",
      "duration_s": 5,
      "needs_first_frame": false,
      "screen_text": "畫面標語，可留空"
    }
  ]
}"""
