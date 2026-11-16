import type { IconProps } from "./types";

export function WarningIcon(props: IconProps) {
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
      <path d="M12 3l9 17H3z" />
      <path d="M12 9v5" />
      <path d="M12 17h.01" />
    </svg>
  );
}
