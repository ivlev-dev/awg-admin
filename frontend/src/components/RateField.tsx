import { Show, createEffect, createSignal, untrack } from "@ivlev-dev/silent-core";

import { t } from "@/i18n";

export type RateUnit = "mbps" | "kbps";

export interface RateFieldProps {
  id: string;
  label: string;
  value: number;
  onChange: (kbps: number) => void;
  hint?: string;
  min?: number;
  max?: number;
  disabled?: boolean;
}

const MBPS_FACTOR = 1000;
const MBPS_DECIMALS = 3;
const DEFAULT_MIN = 0;

function parseNumber(text: string): number {
  const normalized = text.trim().replace(",", ".");
  if (normalized.length === 0) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toKbps(text: string, unit: RateUnit): number {
  const parsed = Math.max(0, parseNumber(text));
  return unit === "mbps" ? Math.round(parsed * MBPS_FACTOR) : Math.round(parsed);
}

function formatKbps(kbps: number, unit: RateUnit): string {
  const safe = Number.isFinite(kbps) && kbps > 0 ? kbps : 0;
  if (unit === "kbps") return String(Math.round(safe));
  const mbps = safe / MBPS_FACTOR;
  if (Number.isInteger(mbps)) return String(mbps);
  return mbps.toFixed(MBPS_DECIMALS).replace(/0+$/, "").replace(/\.$/, "");
}

export function RateField(props: RateFieldProps) {
  let focused = false;
  const [unit, setUnit] = createSignal<RateUnit>("mbps");
  const [text, setText] = createSignal(formatKbps(props.value, "mbps"));

  const min = props.min ?? DEFAULT_MIN;

  const clampValue = (kbps: number): number => {
    const lower = Math.max(kbps, min);
    return props.max === undefined ? lower : Math.min(lower, props.max);
  };

  const resolve = (raw: string, next: RateUnit): number => clampValue(toKbps(raw, next));

  const commit = (kbps: number): void => {
    props.onChange(kbps);
  };

  createEffect(() => {
    const next = props.value;
    if (focused) return;
    setText(formatKbps(next, untrack(unit)));
  });

  const handleInput = (event: InputEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    setText(target.value);
    commit(resolve(target.value, unit()));
  };

  const handleFocus = (): void => {
    focused = true;
  };

  const handleBlur = (): void => {
    focused = false;
    const kbps = resolve(text(), unit());
    setText(formatKbps(kbps, unit()));
    commit(kbps);
  };

  const handleUnitChange = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    const next: RateUnit = target.value === "kbps" ? "kbps" : "mbps";
    if (next === unit()) return;
    const kbps = resolve(text(), untrack(unit));
    setUnit(next);
    setText(formatKbps(kbps, next));
    commit(kbps);
  };

  return (
    <div class="field">
      <label for={props.id}>{props.label}</label>
      <div class="rate-field">
        <input
          id={props.id}
          class="input"
          type="text"
          inputmode="decimal"
          value={text()}
          disabled={props.disabled}
          onInput={handleInput}
          onFocus={handleFocus}
          onBlur={handleBlur}
        />
        <select
          class="input rate-field__unit"
          aria-label={`${props.label}: ${t("units.mbps")}/${t("units.kbps")}`}
          value={unit()}
          disabled={props.disabled}
          onChange={handleUnitChange}
        >
          <option value="mbps">{t("units.mbps")}</option>
          <option value="kbps">{t("units.kbps")}</option>
        </select>
      </div>
      <Show when={props.hint}>
        <div class="hint">{props.hint}</div>
      </Show>
    </div>
  );
}
