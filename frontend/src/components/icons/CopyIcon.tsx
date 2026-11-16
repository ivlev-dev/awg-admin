import type { IconProps } from "./types";

export function CopyIcon(props: IconProps) {
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
      <path d="M9 9h11v11H9z" />
      <path d="M4 15V4h11" />
    </svg>
  );
}
