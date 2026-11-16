import type { IconProps } from "./types";

export function ImportIcon(props: IconProps) {
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
      <path d="M12 3v10" />
      <path d="M8 9l4 4 4-4" />
      <path d="M4 17v3h16v-3" />
    </svg>
  );
}
