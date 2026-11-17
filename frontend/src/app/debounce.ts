export interface Debounced {
  (): void;
  flush(): void;
  cancel(): void;
}

export function debounce(task: () => void, delayMs: number): Debounced {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let scheduled = false;

  const run = (): void => {
    timer = null;
    if (!scheduled) return;
    scheduled = false;
    task();
  };

  const debounced = (() => {
    scheduled = true;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(run, delayMs);
  }) as Debounced;

  debounced.flush = (): void => {
    if (timer === null) return;
    clearTimeout(timer);
    run();
  };

  debounced.cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    scheduled = false;
  };

  return debounced;
}
