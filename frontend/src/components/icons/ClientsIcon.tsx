import type { IconProps } from "./types";

export function ClientsIcon(props: IconProps) {
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
      <path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M17 7h4" />
      <path d="M19 5v4" />
    </svg>
  );
}
