import type { ImportRepository } from "../../domain/import/repository";
import type {
  ClientsApplyResultWire,
  ClientsImportInput,
  ClientsPreviewWire,
  ImportApplyResultWire,
  ImportInput,
  ImportPreviewWire,
  LegacyImportInput,
} from "@/domain/import/types";
import type { ImportResult } from "@/domain/types";
import type { HttpClient } from "./client";

export class HttpImportRepository implements ImportRepository {
  constructor(private readonly client: HttpClient) {}

  preview(input: ImportInput): Promise<ImportPreviewWire> {
    return this.client.post<ImportPreviewWire>("/import/preview", input);
  }

  apply(input: ImportInput): Promise<ImportApplyResultWire> {
    return this.client.post<ImportApplyResultWire>("/import/apply", input);
  }

  previewClients(input: ClientsImportInput): Promise<ClientsPreviewWire> {
    return this.client.post<ClientsPreviewWire>("/import/clients/preview", input);
  }

  applyClients(input: ClientsImportInput): Promise<ClientsApplyResultWire> {
    return this.client.post<ClientsApplyResultWire>("/import/clients/apply", input);
  }

  importConfig(input: LegacyImportInput): Promise<ImportResult> {
    return this.client.post<ImportResult>("/import", input);
  }
}
