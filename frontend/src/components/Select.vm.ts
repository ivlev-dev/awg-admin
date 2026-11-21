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
  searchable?: boolean;
}

export const SELECT_SEARCH_THRESHOLD = 30;
export const SELECT_VISIBLE_LIMIT = 100;

export function normalizeOptionText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export function filterOptions(options: readonly SelectOption[], query: string): SelectOption[] {
  const normalized = normalizeOptionText(query);
  if (normalized.length === 0) return [...options];
  return options.filter((option) => normalizeOptionText(option.label).includes(normalized));
}

export function isSearchable(props: SelectProps): boolean {
  return props.searchable === true || props.options.length > SELECT_SEARCH_THRESHOLD;
}
