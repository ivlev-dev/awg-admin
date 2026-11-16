const ICONS: Record<string, string[]> = {
  overview: ["M4 4h7v7H4z", "M13 4h7v4h-7z", "M13 10h7v10h-7z", "M4 13h7v7H4z"],
  nodes: ["M4 7h16v10H4z", "M8 12h.01", "M12 12h.01", "M16 12h.01"],
  interfaces: ["M4 12h16", "M7 8v8", "M17 8v8", "M12 8v8"],
  groups: ["M4 7h6v6H4z", "M14 7h6v6h-6z", "M9 17h6v4H9z", "M7 13v2h10v-2"],
  clients: ["M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M3 20a6 6 0 0 1 12 0", "M17 7h4", "M19 5v4"],
  import: ["M12 3v10", "M8 9l4 4 4-4", "M4 17v3h16v-3"],
  tariffs: ["M4 6h16v12H4z", "M4 10h16", "M8 14h3"],
  users: [
    "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    "M3 20a6 6 0 0 1 12 0",
    "M17 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
    "M15 20a5 5 0 0 1 7 0",
  ],
  stats: ["M4 20V10", "M10 20V4", "M16 20v-7", "M22 20H2"],
  settings: [
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    "M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.7 2.7-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.3 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.3 7 7 4.3l.1.1A1.7 1.7 0 0 0 9 4.7a1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.7 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4h-.1a1.7 1.7 0 0 0-1.5 1z",
  ],
  profile: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M4 21a8 8 0 0 1 16 0"],
  logout: ["M15 4h4v16h-4", "M11 8l-4 4 4 4", "M7 12h9"],
  menu: ["M4 7h16", "M4 12h16", "M4 17h16"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  plus: ["M12 5v14", "M5 12h14"],
  search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M20 20l-3.5-3.5"],
  refresh: ["M20 11a8 8 0 1 0-2.3 5.7", "M20 4v7h-7"],
  trash: ["M4 7h16", "M9 7V4h6v3", "M6 7l1 13h10l1-13"],
  edit: ["M4 20h4L20 8l-4-4L4 16z", "M13 6l4 4"],
  copy: ["M9 9h11v11H9z", "M4 15V4h11"],
  download: ["M12 4v11", "M7 10l5 5 5-5", "M4 20h16"],
  link: ["M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1", "M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7v5l3 2"],
  sun: [
    "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z",
    "M12 1v2",
    "M12 21v2",
    "M4.2 4.2l1.4 1.4",
    "M18.4 18.4l1.4 1.4",
    "M1 12h2",
    "M21 12h2",
    "M4.2 19.8l1.4-1.4",
    "M18.4 5.6l1.4-1.4",
  ],
  moon: ["M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"],
  arrowUp: ["M12 19V5", "M5 12l7-7 7 7"],
  arrowDown: ["M12 5v14", "M19 12l-7 7-7-7"],
  shield: ["M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z", "M9 12l2 2 4-4"],
  globe: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M3 12h18", "M12 3c3 3 3 15 0 18", "M12 3c-3 3-3 15 0 18"],
  chevron: ["M9 6l6 6-6 6"],
  check: ["M5 12l5 5L20 7"],
  warning: ["M12 3l9 17H3z", "M12 9v5", "M12 17h.01"],
  server: ["M4 4h16v6H4z", "M4 14h16v6H4z", "M8 7h.01", "M8 17h.01"],
  traffic: ["M4 18l4-6 4 3 4-7 4 4", "M4 21h16"],
};

export type IconName = keyof typeof ICONS;

function maskUrl(paths: string[]): string {
  const inner = paths
    .map((d) => `<path d="${d}"/>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function Icon(props: { name: IconName; size?: number; class?: string }) {
  const size = props.size ?? 20;
  const paths = ICONS[props.name] ?? ICONS.overview!;
  const url = maskUrl(paths);
  const style = [
    "display:inline-block",
    "flex:none",
    "vertical-align:middle",
    `width:${size}px`,
    `height:${size}px`,
    "background-color:currentColor",
    `-webkit-mask:${url} center / contain no-repeat`,
    `mask:${url} center / contain no-repeat`,
  ].join(";");
  return <span class={props.class ?? "nav-item__icon"} style={style} aria-hidden="true"></span>;
}
