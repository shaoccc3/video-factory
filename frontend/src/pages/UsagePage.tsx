import { type PointerEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { useUsage } from "../api/hooks";
import type { UsageSummary } from "../api/types";
import { ErrorResult } from "../components/ErrorResult";
import { formatCny, percent } from "../utils/format";
import "./usage.css";

type Day = UsageSummary["by_day"][number];

const RANGES = [7, 30, 90] as const;
const W = 960;
const H = 260;
const PAD = { top: 22, right: 12, bottom: 30, left: 64 };
/** 柱寬上限（dataviz：不填滿欄位，留空氣） */
const MAX_BAR = 24;
/** 相鄰柱之間的表面間隙 */
const GAP = 2;
const RADIUS = 4;

/** 刻度取整：1、2、2.5、5 × 10^n */
export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(max));
  const f = max / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 後端只回有花費的日子；補上沒有花費的日子（金額 0），時間軸才連續 */
export function fillDays(data: Day[], days: number, today = new Date()): Day[] {
  const amounts = new Map(data.map((d) => [d.date, d.amount_cny]));
  const last = [isoDate(today), ...data.map((d) => d.date)].sort().at(-1) ?? isoDate(today);
  const [y, m, d] = last.split("-").map(Number);
  const end = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  const out: Day[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = isoDate(new Date(end.getFullYear(), end.getMonth(), end.getDate() - i));
    out.push({ date, amount_cny: amounts.get(date) ?? 0 });
  }
  return out;
}

function shortDate(date: string): string {
  return date.slice(5).replace("-", ".");
}

/** 頂端 4px 圓角、底端方角的柱 */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(RADIUS, w / 2, h);
  const b = y + h;
  return `M${x},${b}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${b}Z`;
}

/**
 * 每日花費長條圖：單一系列（不需圖例，標題即說明），琥珀色柱、等寬座標、細線格線；
 * 每根柱的整條欄位都是懸停／聚焦目標，提示框顯示金額與日期；最高那天直接標值。
 */
export function DailyBarChart({ data }: { data: Day[] }) {
  const { t } = useTranslation();
  const [active, setActive] = useState<number | null>(null);
  if (data.length === 0) return <p className="vf-note">{t("usage.noData")}</p>;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const top = niceMax(Math.max(...data.map((d) => d.amount_cny)));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
  const slot = plotW / data.length;
  const barW = Math.max(2, Math.min(MAX_BAR, slot - GAP));
  const labelEvery = Math.ceil(data.length / 10);
  const peak = data.reduce(
    (best, d, i) => (d.amount_cny > (data[best]?.amount_cny ?? 0) ? i : best),
    0,
  );
  const y = (v: number) => PAD.top + plotH - (plotH * v) / top;
  const hovered = active === null ? undefined : data[active];

  return (
    <div className="vf-chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={t("usage.byDay")}>
        {ticks.map((v) => (
          <g key={v}>
            <line className="vf-chart-grid" x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
            <text className="vf-chart-tick" x={PAD.left - 10} y={y(v) + 4} textAnchor="end">
              {formatCny(v)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const h = Math.max(0, y(0) - y(d.amount_cny));
          return (
            <g key={d.date}>
              {h > 0 && (
                <path
                  data-bar={d.date}
                  className="vf-chart-bar"
                  data-active={active === i}
                  d={barPath(x, y(d.amount_cny), barW, h)}
                />
              )}
              {i % labelEvery === 0 && (
                <text
                  className="vf-chart-tick"
                  x={PAD.left + i * slot + slot / 2}
                  y={H - 8}
                  textAnchor="middle"
                >
                  {shortDate(d.date)}
                </text>
              )}
              {i === peak && d.amount_cny > 0 && (
                <text
                  className="vf-chart-label"
                  x={x + barW / 2}
                  y={y(d.amount_cny) - 8}
                  textAnchor="middle"
                >
                  {formatCny(d.amount_cny)}
                </text>
              )}
            </g>
          );
        })}
        <line className="vf-chart-axis" x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} />
      </svg>
      {/* 命中區比柱大：整條欄位；用真正的按鈕，滑鼠與鍵盤都能看到提示 */}
      <div className="vf-chart-hits">
        {data.map((d, i) => (
          <button
            key={d.date}
            type="button"
            className="vf-chart-hit"
            style={{
              left: `${((PAD.left + i * slot) / W) * 100}%`,
              width: `${(slot / W) * 100}%`,
              top: `${(PAD.top / H) * 100}%`,
              height: `${(plotH / H) * 100}%`,
            }}
            aria-label={`${d.date} ${formatCny(d.amount_cny)}`}
            onPointerEnter={() => setActive(i)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
          />
        ))}
      </div>
      {hovered && active !== null && (
        <div
          className="vf-chart-tip"
          role="status"
          data-testid="chart-tip"
          style={{
            left: `${((PAD.left + (active + 0.5) * slot) / W) * 100}%`,
            top: `${(y(hovered.amount_cny) / H) * 100}%`,
          }}
        >
          <strong className="vf-mono">{formatCny(hovered.amount_cny)}</strong>
          <span className="vf-mono vf-chart-tip-date">{hovered.date}</span>
        </div>
      )}
    </div>
  );
}

/** 表格檢視：圖表的每個值都能不靠懸停讀到 */
function DailyTable({ data }: { data: Day[] }) {
  const { t } = useTranslation();
  return (
    <table className="vf-usage-table">
      <caption className="vf-sr-only">{t("usage.byDay")}</caption>
      <thead>
        <tr>
          <th scope="col">{t("usage.date")}</th>
          <th scope="col" className="vf-num">
            {t("usage.amount")}
          </th>
        </tr>
      </thead>
      <tbody>
        {data.map((d) => (
          <tr key={d.date}>
            <td className="vf-mono">{d.date}</td>
            <td className="vf-mono vf-num">{formatCny(d.amount_cny)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 行內比例條：佔這段期間總花費的比例 */
function Share({ amount, total }: { amount: number; total: number }) {
  const pct = percent(amount, total);
  return (
    <span className="vf-share">
      <span className="vf-share-track" aria-hidden="true">
        <span className="vf-share-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="vf-mono">{pct}%</span>
    </span>
  );
}

function onTileMove(event: PointerEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty("--mx", `${event.clientX - rect.left}px`);
}

export function UsagePage() {
  const { t } = useTranslation();
  const [days, setDays] = useState<number>(30);
  const [asTable, setAsTable] = useState(false);
  const usage = useUsage(days);

  if (usage.isError)
    return <ErrorResult error={usage.error} onRetry={() => void usage.refetch()} />;
  const data = usage.data;
  const budget = data?.daily_budget_cny ?? 0;
  const today = data?.today_user_cny ?? 0;
  const todayPct = budget > 0 ? percent(today, budget) : 0;
  const level = todayPct >= 100 ? "over" : todayPct >= 80 ? "near" : "ok";
  const total = data?.total_cny ?? 0;
  const byDay = fillDays(data?.by_day ?? [], days);
  const byModel = [...(data?.by_model ?? [])].sort((a, b) => b.amount_cny - a.amount_cny);
  const byUser = [...(data?.by_user ?? [])].sort((a, b) => b.amount_cny - a.amount_cny);

  return (
    <div className="vf-usage" data-refetching={usage.isFetching && !usage.isPending}>
      <header className="vf-usage-head vf-rise">
        <span className="vf-label">
          {t("mono.usage")} · {t("usage.days", { count: days })}
        </span>
        <h1 className="vf-serif">{t("usage.title")}</h1>
      </header>

      <fieldset className="vf-tabs vf-underline-tabs" aria-label={t("usage.range")}>
        {RANGES.map((d) => (
          <button
            key={d}
            type="button"
            className="vf-tab"
            aria-pressed={days === d}
            onClick={() => setDays(d)}
          >
            {t("usage.days", { count: d })}
          </button>
        ))}
      </fieldset>

      <section className="vf-tiles vf-rise-2" aria-label={t("usage.summary")}>
        <article className="vf-tile" onPointerMove={onTileMove}>
          <span className="vf-label">{t("usage.todayLabel")}</span>
          <span className="vf-tile-value vf-mono">{formatCny(today)}</span>
          <span className="vf-muted">{t("usage.todayHint")}</span>
        </article>
        <article className="vf-tile" onPointerMove={onTileMove}>
          <span className="vf-label">{t("usage.total", { count: days })}</span>
          <span className="vf-tile-value vf-mono">{formatCny(total)}</span>
          <span className="vf-muted">
            {t("usage.perDay", { amount: formatCny(total / Math.max(days, 1)) })}
          </span>
        </article>
        <article className="vf-tile" onPointerMove={onTileMove}>
          <span className="vf-label">{t("usage.remaining")}</span>
          <span className="vf-tile-value vf-mono">{formatCny(Math.max(0, budget - today))}</span>
          <div className="vf-meter" data-level={level}>
            <span className="vf-meter-track" aria-hidden="true">
              <span
                className="vf-meter-fill"
                style={{ transform: `scaleX(${Math.min(todayPct, 100) / 100})` }}
              />
            </span>
            <span className="vf-mono vf-muted">
              {formatCny(today)} / {formatCny(budget)} · {todayPct}%
            </span>
          </div>
          {level !== "ok" && (
            <span className="vf-usage-warn" role="status">
              <span className="vf-usage-warn-icon" aria-hidden="true">
                {level === "over" ? "✕" : "!"}
              </span>
              {level === "over" ? t("usage.overLimit") : t("usage.nearLimit")}
            </span>
          )}
        </article>
      </section>

      <section className="vf-usage-card vf-rise-3" aria-labelledby="vf-usage-day">
        <div className="vf-usage-card-head">
          <h2 id="vf-usage-day" className="vf-label">
            {t("usage.byDay")}
          </h2>
          <button
            type="button"
            className="vf-slate-reset"
            aria-pressed={asTable}
            onClick={() => setAsTable((v) => !v)}
          >
            {asTable ? t("usage.showChart") : t("usage.showTable")}
          </button>
        </div>
        {asTable ? (
          <DailyTable data={byDay.filter((d) => d.amount_cny > 0)} />
        ) : (
          <DailyBarChart data={data?.by_day.length ? byDay : []} />
        )}
      </section>

      <div className="vf-usage-grid">
        <section className="vf-usage-card" aria-labelledby="vf-usage-model">
          <h2 id="vf-usage-model" className="vf-label">
            {t("usage.byModel")}
          </h2>
          <table className="vf-usage-table">
            <thead>
              <tr>
                <th scope="col">{t("usage.model")}</th>
                <th scope="col" className="vf-num">
                  {t("usage.calls")}
                </th>
                <th scope="col" className="vf-num">
                  {t("usage.amount")}
                </th>
                <th scope="col">{t("usage.share")}</th>
              </tr>
            </thead>
            <tbody>
              {byModel.map((m) => (
                <tr key={m.model_id}>
                  <td className="vf-mono">{m.model_id}</td>
                  <td className="vf-mono vf-num">{m.calls}</td>
                  <td className="vf-mono vf-num">{formatCny(m.amount_cny)}</td>
                  <td>
                    <Share amount={m.amount_cny} total={total} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {byModel.length === 0 && <p className="vf-note">{t("usage.noData")}</p>}
        </section>
        {byUser.length > 0 && (
          <section className="vf-usage-card" aria-labelledby="vf-usage-user">
            <h2 id="vf-usage-user" className="vf-label">
              {t("usage.byUser")}
            </h2>
            <table className="vf-usage-table">
              <thead>
                <tr>
                  <th scope="col">{t("usage.user")}</th>
                  <th scope="col" className="vf-num">
                    {t("usage.amount")}
                  </th>
                  <th scope="col">{t("usage.share")}</th>
                </tr>
              </thead>
              <tbody>
                {byUser.map((u) => (
                  <tr key={u.user_id}>
                    <td>{u.display_name}</td>
                    <td className="vf-mono vf-num">{formatCny(u.amount_cny)}</td>
                    <td>
                      <Share amount={u.amount_cny} total={total} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </div>
  );
}
