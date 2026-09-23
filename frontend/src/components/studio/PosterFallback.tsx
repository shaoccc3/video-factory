/** 沒有畫面時的文字海報：片名、類型、顆粒（規格 14 第 4 節） */
export function PosterFallback({
  title,
  kicker,
  size = "md",
}: {
  title: string;
  kicker?: string | undefined;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <div className={`vf-poster vf-poster-${size}`} role="img" aria-label={title}>
      <span className="vf-poster-rule" aria-hidden="true" />
      {kicker && <span className="vf-label">{kicker}</span>}
      <span className="vf-serif vf-poster-title">{title}</span>
    </div>
  );
}
