import { For } from "@ivlev-dev/silent-core";

import { t } from "@/i18n";
import { formatDateTimeI18n } from "@/i18n/format";

function buildPath(values: number[], width: number, height: number, padding = 2): string {
  if (values.length === 0) return "";
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? (width - padding * 2) / (values.length - 1) : 0;
  return values
    .map((value, index) => {
      const x = padding + index * step;
      const y = height - padding - (value / max) * (height - padding * 2);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function Sparkline(props: {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: boolean;
}) {
  const width = props.width ?? 120;
  const height = props.height ?? 36;
  const stroke = props.stroke ?? "var(--accent)";
  const line = buildPath(props.values, width, height);
  const area = props.fill && line ? `${line} L${width - 2},${height - 2} L2,${height - 2} Z` : "";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      fill="none"
      aria-hidden="true"
      style="display:block"
    >
      <path
        d={line}
        fill="none"
        stroke={stroke}
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path d={area} fill={stroke} opacity="0.14" />
    </svg>
  );
}

export interface ChartDatum {
  at: string | number;
  rx: number;
  tx: number;
}

export function AreaChart(props: { data: ChartDatum[]; height?: number; showTx?: boolean }) {
  const width = 720;
  const height = props.height ?? 220;
  const pad = 10;
  const rx = props.data.map((point) => point.rx);
  const tx = props.data.map((point) => point.tx);
  const all = props.showTx === false ? rx : [...rx, ...tx];
  const max = Math.max(...all, 1);
  const step = props.data.length > 1 ? (width - pad * 2) / (props.data.length - 1) : 0;
  const toPath = (values: number[]) =>
    values
      .map((value, index) => {
        const x = pad + index * step;
        const y = height - pad - (value / max) * (height - pad * 2);
        return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  const rxPath = toPath(rx);
  const txPath = toPath(tx);
  const gridY = (ratio: number) => pad + (height - pad * 2) * ratio;
  const hasSeries = props.data.length > 1;
  const rxLine = hasSeries ? rxPath : "";
  const txLine = hasSeries && props.showTx !== false ? txPath : "";
  const area = hasSeries && rxPath ? `${rxPath} L${width - pad},${height - pad} L${pad},${height - pad} Z` : "";

  return (
    <div class="chart" role="group" aria-label={t("charts.traffic")} style={`width:100%;height:${height}px`}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        fill="none"
        aria-hidden="true"
        style="display:block"
      >
        <line
          x1={pad}
          x2={width - pad}
          y1={gridY(0.25)}
          y2={gridY(0.25)}
          stroke="var(--border)"
          stroke-width="1"
          stroke-dasharray="4 6"
        />
        <line
          x1={pad}
          x2={width - pad}
          y1={gridY(0.5)}
          y2={gridY(0.5)}
          stroke="var(--border)"
          stroke-width="1"
          stroke-dasharray="4 6"
        />
        <line
          x1={pad}
          x2={width - pad}
          y1={gridY(0.75)}
          y2={gridY(0.75)}
          stroke="var(--border)"
          stroke-width="1"
          stroke-dasharray="4 6"
        />
        <path d={area} fill="var(--accent)" opacity="0.16" />
        <path
          d={rxLine}
          fill="none"
          stroke="var(--accent)"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d={txLine}
          fill="none"
          stroke="var(--brand-3)"
          stroke-width="1.8"
          stroke-dasharray="5 5"
          stroke-linecap="round"
        />
      </svg>
      <table class="sr-only">
        <caption>{t("charts.traffic.caption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("charts.traffic.at")}</th>
            <th scope="col">{t("charts.traffic.rx")}</th>
            <th scope="col">{t("charts.traffic.tx")}</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.data}>
            {(point) => (
              <tr>
                <th scope="row">{formatDateTimeI18n(toIso(point.at))}</th>
                <td>{point.rx}</td>
                <td>{point.tx}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

function toIso(value: string | number): string {
  return typeof value === "number" ? new Date(value).toISOString() : value;
}

export function Bars(props: { data: Array<{ label: string; value: number }> }) {
  const max = Math.max(...props.data.map((item) => item.value), 1);
  return (
    <div class="stack-sm">
      {props.data.map((item) => (
        <div class="row" style="gap:10px">
          <div class="xs muted truncate" style="width:90px;flex:none">{item.label}</div>
          <div class="progress grow">
            <div class="progress__bar" style={`width:${Math.max(2, (item.value / max) * 100)}%`}></div>
          </div>
          <div class="xs mono" style="width:70px;text-align:right">{item.value}</div>
        </div>
      ))}
    </div>
  );
}
