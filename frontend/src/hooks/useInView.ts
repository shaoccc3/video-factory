import { type RefObject, useEffect, useState } from "react";

/** 元素是否在視窗內；沒有 IntersectionObserver（測試環境）時視為可見 */
export function useInView(ref: RefObject<Element | null>, threshold = 0.25): boolean {
  const [inView, setInView] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => setInView(entries.some((entry) => entry.isIntersecting)),
      { threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, threshold]);
  return inView;
}
