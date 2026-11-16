import type { IconProps } from "./types";

export function TariffsIcon(props: IconProps) {
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
      <path d="M4 6h16v12H4z" />
      <path d="M4 10h16" />
      <path d="M8 14h3" />
    </svg>
  );
}
