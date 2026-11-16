import type { ImportRepository } from "../../domain/import/repository";
import type { ImportInput } from "@/domain/import/types";
import type { ImportResult } from "@/domain/types";
import type { HttpClient } from "./client";

export class HttpImportRepository implements ImportRepository {
  constructor(private readonly client: HttpClient) {}

  importConfig(input: ImportInput): Promise<ImportResult> {
    return this.client.post<ImportResult>("/import", input);
  }
}
