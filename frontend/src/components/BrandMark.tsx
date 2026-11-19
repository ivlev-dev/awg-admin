import type { JSX } from "@ivlev-dev/silent-core";

interface BrandMarkProps {
  size?: number;
  class?: string;
}

export function BrandMark({ size = 40, class: className }: BrandMarkProps): JSX.Element {
  return (
    <svg
      class={className}
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role="img"
      aria-label="Umbra VPN"
    >
      <rect width="512" height="512" rx="116" fill="#f2f5f9" />
      <path
        d="M262 126 392 175v116c0 75-57 131-130 154-73-23-130-79-130-154V175z"
        fill="#dce7f8"
      />
      <path
        d="M250 108 382 157v120c0 76-58 132-132 156-74-24-132-80-132-156V157z"
        fill="#0e4688"
      />
      <path
        d="M318 150a112 112 0 1 1-136 0"
        fill="none"
        stroke="#cdddff"
        stroke-opacity=".3"
        stroke-width="4"
        stroke-linecap="round"
      />
      <path
        d="M300 172a78 78 0 1 1-100 0"
        fill="none"
        stroke="#cdddff"
        stroke-opacity=".2"
        stroke-width="3"
        stroke-linecap="round"
      />
      <path
        d="M205 218v54a45 45 0 0 0 90 0v-54"
        fill="none"
        stroke="#001738"
        stroke-opacity=".22"
        stroke-width="28"
        stroke-linecap="round"
        transform="translate(6 6)"
      />
      <path
        d="M205 218v54a45 45 0 0 0 90 0v-54"
        fill="none"
        stroke="#fff"
        stroke-width="28"
        stroke-linecap="round"
      />
    </svg>
  );
}
