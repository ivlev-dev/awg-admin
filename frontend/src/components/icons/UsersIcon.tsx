import type { IconProps } from "./types";

export function UsersIcon(props: IconProps) {
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
      <path d="M17 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
      <path d="M15 20a5 5 0 0 1 7 0" />
    </svg>
  );
}
