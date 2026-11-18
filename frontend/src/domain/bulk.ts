export interface BulkFailure {
  readonly id: string;
  readonly error: string;
}

export interface BulkResult {
  readonly done: number;
  readonly failed: readonly BulkFailure[];
}

export interface BulkRequest<Action extends string> {
  readonly action: Action;
  readonly ids: readonly string[];
}
