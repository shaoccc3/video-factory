import { useEffect, useState } from "react";

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

/** 系統「減少動態效果」設定；開啟時不渲染推移、播放頭等裝飾動畫 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia(REDUCED_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(REDUCED_QUERY);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** 分頁是否在前景 */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState !== "hidden");
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}

/** 分頁在背景時給 <html> 加 vf-hidden，motion.css 會暫停所有 CSS 動畫 */
export function usePauseAnimationsWhenHidden(): void {
  const visible = useDocumentVisible();
  useEffect(() => {
    document.documentElement.classList.toggle("vf-hidden", !visible);
  }, [visible]);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** 時間碼 HH:MM:SS:FF（24 幀） */
export function formatTimecode(date: Date): string {
  const frames = Math.floor((date.getMilliseconds() / 1000) * 24);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}:${pad(frames)}`;
}

/** 秒數轉 MM:SS:FF，給播放頭與時長用 */
export function formatSeconds(seconds: number): string {
  const s = Math.max(0, seconds);
  const whole = Math.floor(s);
  const frames = Math.floor((s - whole) * 24);
  return `${pad(Math.floor(whole / 60))}:${pad(whole % 60)}:${pad(frames)}`;
}

/** 每 interval 毫秒回傳一次現在時間；分頁在背景或減少動態效果時停止更新 */
export function useNow(intervalMs = 125): Date {
  const [now, setNow] = useState(() => new Date());
  const visible = useDocumentVisible();
  const reduced = usePrefersReducedMotion();
  const tick = reduced ? 1000 : intervalMs;
  useEffect(() => {
    if (!visible) return;
    const id = window.setInterval(() => setNow(new Date()), tick);
    return () => window.clearInterval(id);
  }, [visible, tick]);
  return now;
}
