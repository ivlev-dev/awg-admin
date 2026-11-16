import type { ImportRepository } from "../../domain/import/repository";
import type {
  ClientsApplyResult,
  ClientsImportInput,
  ClientsPreview,
  ImportApplyResult,
  ImportInput,
  ImportPreview,
  LegacyImportInput,
} from "@/domain/import/types";
import type { ImportResult } from "@/domain/types";
import type { HttpClient } from "./client";

export class HttpImportRepository implements ImportRepository {
  constructor(private readonly client: HttpClient) {}

  preview(input: ImportInput): Promise<ImportPreview> {
    return this.client.post<ImportPreview>("/import/preview", input);
  }

  apply(input: ImportInput): Promise<ImportApplyResult> {
    return this.client.post<ImportApplyResult>("/import/apply", input);
  }

  previewClients(input: ClientsImportInput): Promise<ClientsPreview> {
    return this.client.post<ClientsPreview>("/import/clients/preview", input);
  }

  applyClients(input: ClientsImportInput): Promise<ClientsApplyResult> {
    return this.client.post<ClientsApplyResult>("/import/clients/apply", input);
  }

  importConfig(input: LegacyImportInput): Promise<ImportResult> {
    return this.client.post<ImportResult>("/import", input);
  }
}
