import type { IconProps } from "./types";

export function TrafficIcon(props: IconProps) {
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
      <path d="M4 18l4-6 4 3 4-7 4 4" />
      <path d="M4 21h16" />
    </svg>
  );
}
