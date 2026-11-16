import type { IconProps } from "./types";

export function GroupsIcon(props: IconProps) {
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
      <path d="M4 7h6v6H4z" />
      <path d="M14 7h6v6h-6z" />
      <path d="M9 17h6v4H9z" />
      <path d="M7 13v2h10v-2" />
    </svg>
  );
}
