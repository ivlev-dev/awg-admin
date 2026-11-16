import type { IconProps } from "./types";

export function InterfacesIcon(props: IconProps) {
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
      <path d="M4 12h16" />
      <path d="M7 8v8" />
      <path d="M17 8v8" />
      <path d="M12 8v8" />
    </svg>
  );
}
