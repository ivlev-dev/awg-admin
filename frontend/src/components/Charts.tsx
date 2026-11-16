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

function svgBackground(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><path d="${line}" fill="none" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>${area ? `<path d="${area}" fill="${stroke}" opacity="0.14"/>` : ""}</svg>`;
  return (
    <span
      style={`display:block;width:${width}px;height:${height}px;background:${svgBackground(svg)} center / 100% 100% no-repeat`}
      aria-hidden="true"
    ></span>
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
  const grid = [0.25, 0.5, 0.75]
    .map((ratio) => {
      const y = pad + (height - pad * 2) * ratio;
      return `<line x1="${pad}" x2="${width - pad}" y1="${y}" y2="${y}" stroke="var(--border)" stroke-width="1" stroke-dasharray="4 6"/>`;
    })
    .join("");
  const area =
    props.data.length > 1 && rxPath
      ? `<path d="${rxPath} L${width - pad},${height - pad} L${pad},${height - pad} Z" fill="var(--accent)" opacity="0.16"/>`
      : "";
  const lines =
    props.data.length > 1
      ? `<path d="${rxPath}" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>${props.showTx === false ? "" : `<path d="${txPath}" fill="none" stroke="var(--brand-3)" stroke-width="1.8" stroke-dasharray="5 5" stroke-linecap="round"/>`}`
      : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${grid}${area}${lines}</svg>`;

  return (
    <div
      role="img"
      aria-label="График трафика"
      style={`width:100%;height:${height}px;background:${svgBackground(svg)} center / 100% 100% no-repeat`}
    ></div>
  );
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
