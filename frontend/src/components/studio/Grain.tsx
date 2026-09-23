import "./studio.css";

/** 全頁膠片顆粒層（不接收滑鼠事件；減少動態效果時靜止） */
export function Grain() {
  return <div className="vf-grain" aria-hidden="true" />;
}
