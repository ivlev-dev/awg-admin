import type { IconProps } from "./types";

export function SearchIcon(props: IconProps) {
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
      <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}
