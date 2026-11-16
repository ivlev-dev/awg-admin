import type { ImportResult } from "../types";
import type {
  ClientsApplyResult,
  ClientsImportInput,
  ClientsPreview,
  ImportApplyResult,
  ImportInput,
  ImportPreview,
  LegacyImportInput,
} from "./types";

export interface ImportRepository {
  preview(input: ImportInput): Promise<ImportPreview>;
  apply(input: ImportInput): Promise<ImportApplyResult>;
  previewClients(input: ClientsImportInput): Promise<ClientsPreview>;
  applyClients(input: ClientsImportInput): Promise<ClientsApplyResult>;
  importConfig(input: LegacyImportInput): Promise<ImportResult>;
}
