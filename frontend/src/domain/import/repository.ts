import type { ImportResult } from "../types";
import type { ImportInput } from "./types";

export interface ImportRepository {
  importConfig(input: ImportInput): Promise<ImportResult>;
}
