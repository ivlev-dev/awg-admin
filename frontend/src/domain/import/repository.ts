import type { ImportResult } from "../types";
import type {
  ClientsApplyResultWire,
  ClientsImportInput,
  ClientsPreviewWire,
  ImportApplyResultWire,
  ImportInput,
  ImportPreviewWire,
  LegacyImportInput,
} from "./types";

export interface ImportRepository {
  preview(input: ImportInput): Promise<ImportPreviewWire>;
  apply(input: ImportInput): Promise<ImportApplyResultWire>;
  previewClients(input: ClientsImportInput): Promise<ClientsPreviewWire>;
  applyClients(input: ClientsImportInput): Promise<ClientsApplyResultWire>;
  importConfig(input: LegacyImportInput): Promise<ImportResult>;
}
