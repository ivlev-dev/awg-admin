import type { ImportStep, ImportVM } from "../ImportPage.vm";
import { Icon } from "@/components/Icon";
import { t, type TranslationKey } from "@/i18n";

export const STEPS: ReadonlyArray<{ step: ImportStep; labelKey: TranslationKey }> = [
  { step: 1, labelKey: "import.steps.group" },
  { step: 2, labelKey: "import.steps.interfaces" },
  { step: 3, labelKey: "import.steps.preview" },
  { step: 4, labelKey: "import.steps.result" },
];

export function StepChip(props: { vm: ImportVM; step: ImportStep; labelKey: TranslationKey }) {
  const vm = props.vm;
  const step = props.step;
  return (
    <button
      class={`chip ${vm.step === step ? "is-selected" : ""}`}
      type="button"
      aria-current={vm.step === step ? "step" : undefined}
      onClick={() => vm.goToStep(step)}
    >
      <span class="strong">
        {vm.isStepDone(step) ? <Icon name="check" size={14} class="" /> : step}
      </span>
      <span>{t(props.labelKey)}</span>
    </button>
  );
}
