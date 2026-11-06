"use client";

import React, { useMemo, useRef, useState } from "react";
import { cx } from "@/lib/format";

export interface Series {
  key: string;
  label: string;
  color: string;
  data: number[];
  dash?: string;
  width?: number;
  area?: boolean;
  fillOpacity?: number;
}

interface Props {
  series: Series[];
  height?: number;
  yFormat?: (n: number) => string;
  xLabels?: string[];
  baseline?: number;
  className?: string;
  showLegend?: boolean;
  grid?: boolean;
}

export function LineChart({
  series,
  height = 260,
  yFormat = (n) => n.toFixed(1),
  xLabels,
  baseline,
  className,
  showLegend = true,
  grid = true,
}: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const W = 1000;
  const H = height;
  const padL = 46;
  const padR = 12;
  const padT = 12;
  const padB = 24;

  const { min, max, n } = useMemo(() => {
    const all = series.flatMap((s) => s.data).filter((v) => isFinite(v));
    let mn = Math.min(...all);
    let mx = Math.max(...all);
    if (baseline !== undefined) {
      mn = Math.min(mn, baseline);
      mx = Math.max(mx, baseline);
    }
    if (mn === mx) {
      mn -= 1;
      mx += 1;
    }
    const pad = (mx - mn) * 0.12;
    return { min: mn - pad, max: mx + pad, n: Math.max(...series.map((s) => s.data.length)) };
  }, [series, baseline]);

  const x = (i: number) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);

  const path = (data: number[]) => data.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const areaPath = (data: number[], base: number) =>
    `${path(data)} L${x(data.length - 1).toFixed(2)},${y(base).toFixed(2)} L${x(0).toFixed(2)},${y(base).toFixed(2)} Z`;

  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => min + ((max - min) * i) / ticks);

  const onMove = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width;
    const px = rel * W;
    const idx = Math.round(((px - padL) / (W - padL - padR)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, idx)));
  };

  const hoverX = hover !== null ? x(hover) : 0;

  return (
    <div className={cx("chart-wrap", className)} ref={wrapRef}>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Performance chart: ${series.map((s) => s.label).join(", ")}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        style={{ cursor: hover !== null ? "crosshair" : "default" }}
      >
        {grid &&
          yTicks.map((t, i) => (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#EDF0F6" strokeWidth={1} />
              <text x={padL - 8} y={y(t) + 3.5} textAnchor="end" fontSize={10.5} fill="#8B93A6">
                {yFormat(t)}
              </text>
            </g>
          ))}

        {baseline !== undefined && (
          <line
            x1={padL}
            x2={W - padR}
            y1={y(baseline)}
            y2={y(baseline)}
            stroke="#C8D0DE"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {series.map((s) =>
          s.area ? (
            <path
              key={`a-${s.key}`}
              d={areaPath(s.data, baseline ?? min)}
              fill={s.color}
              opacity={s.fillOpacity ?? 0.1}
            />
          ) : null
        )}

        {series.map((s) => (
          <path
            key={s.key}
            d={path(s.data)}
            fill="none"
            stroke={s.color}
            strokeWidth={s.width ?? 2}
            strokeDasharray={s.dash}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {xLabels &&
          xLabels.map((label, i) => {
            const step = Math.max(1, Math.floor(n / 5));
            if (i % step !== 0 && i !== n - 1) return null;
            return (
              <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize={10.5} fill="#8B93A6">
                {label}
              </text>
            );
          })}

        {hover !== null && (
          <g>
            <line x1={hoverX} x2={hoverX} y1={padT} y2={H - padB} stroke="#B9C2D4" strokeWidth={1} strokeDasharray="3 2" />
            {series.map((s) => {
              const v = s.data[hover];
              if (v === undefined) return null;
              return <circle key={`p-${s.key}`} cx={x(hover)} cy={y(v)} r={3.4} fill="#fff" stroke={s.color} strokeWidth={2} />;
            })}
          </g>
        )}
      </svg>

      {hover !== null && (
        <div className="chart-tip" style={{ left: `${(hoverX / W) * 100}%`, top: 8 }}>
          <div className="tiny" style={{ marginBottom: 4 }}>
            {xLabels?.[hover] ?? `point ${hover + 1}`}
          </div>
          {series.map((s) => (
            <div key={s.key} className="row between gap-12" style={{ fontSize: 11.5 }}>
              <span className="row gap-6 muted">
                <span className="legend-swatch" style={{ background: s.color, width: 9 }} />
                {s.label}
              </span>
              <span className="num strong">{s.data[hover] !== undefined ? yFormat(s.data[hover]) : "—"}</span>
            </div>
          ))}
        </div>
      )}

      {showLegend && (
        <div className="legend" style={{ marginTop: 10 }}>
          {series.map((s) => (
            <span key={s.key} className="legend-item">
              <span
                className="legend-swatch"
                style={{
                  background: s.dash ? "transparent" : s.color,
                  borderTop: s.dash ? `2px ${s.dash.includes("2") ? "dotted" : "dashed"} ${s.color}` : undefined,
                  height: s.dash ? 0 : 3,
                }}
              />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function Sparkline({
  data,
  width = 96,
  height = 28,
  color: colorProp,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  // Defensive: records from older sessions or partial DB snapshots may carry no
  // spark series at all. A chart that cannot draw must degrade to empty space,
  // never take the whole page down.
  const points = Array.isArray(data) ? data.filter((v) => Number.isFinite(v)) : [];
  if (points.length < 2) {
    return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ overflow: "visible" }} />;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const pts = points.map((v, i) => `${(i / Math.max(1, points.length - 1)) * width},${height - ((v - min) / span) * height}`);
  const color = colorProp ?? (points[points.length - 1] >= points[0] ? "#137A4B" : "#B42318");
  const d = `M${pts.join(" L")}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ overflow: "visible" }}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function BarRow({ value, max, color = "var(--primary)" }: { value: number; max: number; color?: string }) {
  const pct = Math.max(2, Math.min(100, (Math.abs(value) / (max || 1)) * 100));
  return (
    <div style={{ height: 6, background: "#EEF1F6", borderRadius: 999, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 999 }} />
    </div>
  );
}
