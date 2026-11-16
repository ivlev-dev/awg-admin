import type { IconProps } from "./types";

export function LogoutIcon(props: IconProps) {
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
      <path d="M15 4h4v16h-4" />
      <path d="M11 8l-4 4 4 4" />
      <path d="M7 12h9" />
    </svg>
  );
}
