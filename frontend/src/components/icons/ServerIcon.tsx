import type { IconProps } from "./types";

export function ServerIcon(props: IconProps) {
  const size = props.size ?? 20;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      width={size}
      height={size}
      class={props.class ?? "nav-item__icon"}
      aria-hidden="true"
    >
      <path d="M4 4h16v6H4z" />
      <path d="M4 14h16v6H4z" />
      <path d="M8 7h.01" />
      <path d="M8 17h.01" />
    </svg>
  );
}
