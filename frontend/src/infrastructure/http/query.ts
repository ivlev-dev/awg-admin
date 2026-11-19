export type QueryValue = string | number | undefined | null;

export interface SignalOptions {
  signal?: AbortSignal;
}

export function buildQueryString(values: Readonly<Record<string, QueryValue>>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    const text = String(value);
    if (text.length === 0) continue;
    params.set(key, text);
  }
  const query = params.toString();
  return query.length > 0 ? `?${query}` : "";
}

export function signalOptions(signal: AbortSignal | undefined): SignalOptions {
  return signal === undefined ? {} : { signal };
}
