import { For } from "@ivlev-dev/silent-core";

export interface SkeletonProps {
  readonly height?: number | string;
  readonly width?: number | string;
  readonly radius?: number | string;
  readonly className?: string;
}

function size(value: number | string | undefined): string | null {
  if (value === undefined) return null;
  return typeof value === "number" ? `${value}px` : value;
}

function styleOf(props: SkeletonProps): string | undefined {
  const parts: string[] = [];
  const height = size(props.height);
  const width = size(props.width);
  const radius = size(props.radius);
  if (height !== null) parts.push(`height:${height}`);
  if (width !== null) parts.push(`width:${width}`);
  if (radius !== null) parts.push(`border-radius:${radius}`);
  return parts.length > 0 ? parts.join(";") : undefined;
}

function indexes(count: number): number[] {
  return Array.from({ length: Math.max(1, count) }, (_value, index) => index);
}

function cellClass(index: number): string {
  return index === 0
    ? "skeleton skeleton-table__cell skeleton-table__cell--first"
    : "skeleton skeleton-table__cell";
}

export function Skeleton(props: SkeletonProps) {
  const className = props.className ? `skeleton ${props.className}` : "skeleton";
  return <div class={className} style={styleOf(props)} aria-hidden="true"></div>;
}

export interface SkeletonTableProps {
  readonly rows?: number;
  readonly columns?: number;
}

export function SkeletonTable(props: SkeletonTableProps) {
  const rows = indexes(props.rows ?? 5);
  const columns = indexes(props.columns ?? 4);
  return (
    <div class="skeleton-table" aria-hidden="true">
      <div class="skeleton-table__head">
        <For each={columns}>
          {(cell) => <div class={cellClass(cell)}></div>}
        </For>
      </div>
      <div class="skeleton-table__body">
        <For each={rows}>
          {() => (
            <div class="skeleton-table__row">
              <For each={columns}>
                {(cell) => <div class={cellClass(cell)}></div>}
              </For>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

export interface SkeletonCardsProps {
  readonly count?: number;
  readonly className?: string;
}

export function SkeletonCards(props: SkeletonCardsProps) {
  const className = props.className ? `grid grid--4 ${props.className}` : "grid grid--4";
  return (
    <div class={className} aria-hidden="true">
      <For each={indexes(props.count ?? 4)}>
        {() => (
          <div class="skeleton-card">
            <div class="skeleton skeleton-card__line skeleton-card__line--sm"></div>
            <div class="skeleton skeleton-card__line skeleton-card__line--lg"></div>
            <div class="skeleton skeleton-card__line skeleton-card__line--md"></div>
          </div>
        )}
      </For>
    </div>
  );
}
