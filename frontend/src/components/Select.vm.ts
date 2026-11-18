import { t } from "@/i18n";
import { ViewModel, computed, reactive } from "@ivlev-dev/silent-core";

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

export interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
}

export class SelectVM extends ViewModel<SelectProps> {
  @reactive accessor open = false;
  @reactive accessor activeIndex = 0;
  @reactive accessor dropUp = false;

  @computed
  get selectedIndex(): number {
    return this.props.options.findIndex((option) => option.value === this.props.value);
  }

  @computed
  get selected(): SelectOption | undefined {
    return this.props.options.find((option) => option.value === this.props.value);
  }

  @computed
  get label(): string {
    return this.selected?.label ?? this.props.placeholder ?? t("common.selectValue");
  }

  @computed
  get placeholderVisible(): boolean {
    return this.selected === undefined;
  }

  @computed
  get menuId(): string {
    return this.props.id ? `${this.props.id}-menu` : "";
  }

  @computed
  get activeDescendant(): string | undefined {
    if (!this.props.id || !this.open) return undefined;
    const option = this.props.options[this.activeIndex];
    return option ? `${this.props.id}-option-${this.activeIndex}` : undefined;
  }

  override mounted(): void {
    document.addEventListener("pointerdown", this.onDocumentPointerDown, true);
  }

  override unmounted(): void {
    document.removeEventListener("pointerdown", this.onDocumentPointerDown, true);
  }

  toggle(): void {
    if (this.props.disabled) return;
    if (this.open) {
      this.close();
      return;
    }
    this.openMenu();
  }

  openMenu(): void {
    if (this.props.disabled) return;
    const selected = this.selectedIndex;
    this.activeIndex = selected >= 0 ? selected : 0;
    const rect = this.root().getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    this.dropUp = below < 280 && rect.top > below;
    this.open = true;
    requestAnimationFrame(() => this.scrollActiveIntoView());
  }

  close(): void {
    this.open = false;
  }

  choose(option: SelectOption): void {
    if (option.disabled) return;
    this.props.onChange(option.value);
    this.open = false;
    this.focusTrigger();
  }

  onKeydown(event: KeyboardEvent): void {
    if (this.props.disabled) return;
    const key = event.key;
    if (key === "Escape") {
      if (this.open) {
        event.preventDefault();
        this.close();
      }
      return;
    }
    if (key === "Tab") {
      this.close();
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      if (!this.open) {
        this.openMenu();
        return;
      }
      const delta = key === "ArrowDown" ? 1 : -1;
      this.moveActive(delta);
      return;
    }
    if (key === "Home" || key === "End") {
      if (!this.open) return;
      event.preventDefault();
      this.activeIndex = key === "Home" ? 0 : Math.max(0, this.props.options.length - 1);
      this.scrollActiveIntoView();
      return;
    }
    if (key === "Enter" || key === " ") {
      event.preventDefault();
      if (!this.open) {
        this.openMenu();
        return;
      }
      const option = this.props.options[this.activeIndex];
      if (option) this.choose(option);
    }
  }

  setActive(index: number): void {
    this.activeIndex = index;
  }

  private moveActive(delta: number): void {
    const count = this.props.options.length;
    if (count === 0) return;
    let index = this.activeIndex;
    for (let step = 0; step < count; step += 1) {
      index = (index + delta + count) % count;
      if (!this.props.options[index]?.disabled) break;
    }
    this.activeIndex = index;
    this.scrollActiveIntoView();
  }

  private scrollActiveIntoView(): void {
    const option = this.root().querySelector<HTMLElement>(`[data-index="${this.activeIndex}"]`);
    option?.scrollIntoView({ block: "nearest" });
  }

  private focusTrigger(): void {
    this.root().querySelector<HTMLElement>(".select-trigger")?.focus();
  }

  private root(): HTMLElement {
    return this.view as unknown as HTMLElement;
  }

  private readonly onDocumentPointerDown = (event: PointerEvent): void => {
    if (!this.open) return;
    const target = event.target;
    if (target instanceof Node && this.view.contains(target)) return;
    this.close();
  };
}
