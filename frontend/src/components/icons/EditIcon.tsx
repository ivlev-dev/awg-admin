import type { IconProps } from "./types";

export function EditIcon(props: IconProps) {
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
      <path d="M4 20h4L20 8l-4-4L4 16z" />
      <path d="M13 6l4 4" />
    </svg>
  );
}
