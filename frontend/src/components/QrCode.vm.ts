import { ViewModel, computed, createEffect, reactive } from "@ivlev-dev/silent-core";

import {
  QR_MARGIN_MODULES,
  QR_MAX_BYTES,
  byteLength,
  clampQrSize,
  loadQrMatrix,
  type QrMatrix,
} from "./qr-loader";

export type QrCodeStatus = "idle" | "loading" | "ready" | "error" | "limit";

export interface QrCodeProps {
  readonly value: string;
  readonly size?: number;
  readonly label?: string;
  readonly loadingLabel?: string;
  readonly errorLabel?: string;
  readonly limitLabel?: string;
}

export class QrCodeVm extends ViewModel<QrCodeProps> {
  @reactive accessor status: QrCodeStatus = "idle";
  @reactive accessor matrix: QrMatrix = [];

  private requestId = 0;
  private lastValue: string | null = null;

  override mounted(): void {
    this.lastValue = this.props.value;
    createEffect(() => {
      this.onValueChange(this.props.value);
    });
    void this.generate(this.props.value);
  }

  @computed
  get sizePx(): number {
    return clampQrSize(this.props.size);
  }

  @computed
  get ariaLabel(): string {
    return this.props.label ?? "QR-код";
  }

  @computed
  get loadingLabel(): string {
    return this.props.loadingLabel ?? "Готовим QR-код…";
  }

  @computed
  get errorText(): string {
    return this.props.errorLabel ?? "Не удалось создать QR-код";
  }

  @computed
  get limitText(): string {
    return this.props.limitLabel ?? "Слишком длинное значение для QR-кода";
  }

  @computed
  get moduleCount(): number {
    return this.matrix.length;
  }

  @computed
  get dimension(): number {
    return this.moduleCount + QR_MARGIN_MODULES * 2;
  }

  @computed
  get path(): string {
    const matrix = this.matrix;
    if (matrix.length === 0) return "";
    const offset = QR_MARGIN_MODULES;
    const parts: string[] = [];
    for (let row = 0; row < matrix.length; row += 1) {
      const cells = matrix[row] ?? [];
      let start = -1;
      for (let col = 0; col <= cells.length; col += 1) {
        const dark = col < cells.length && cells[col] === true;
        if (dark && start < 0) {
          start = col;
        } else if (!dark && start >= 0) {
          const run = col - start;
          parts.push(`M${start + offset} ${row + offset}h${run}v1h-${run}z`);
          start = -1;
        }
      }
    }
    return parts.join("");
  }

  async regenerate(): Promise<void> {
    await this.generate(this.props.value);
  }

  private onValueChange(value: string): void {
    if (value === this.lastValue) return;
    this.lastValue = value;
    void this.generate(value);
  }

  private async generate(value: string): Promise<void> {
    const id = ++this.requestId;
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      this.matrix = [];
      this.status = "error";
      return;
    }
    if (byteLength(trimmed) > QR_MAX_BYTES) {
      this.matrix = [];
      this.status = "limit";
      return;
    }
    this.status = "loading";
    try {
      const matrix = await loadQrMatrix(trimmed);
      if (id !== this.requestId) return;
      this.matrix = matrix;
      this.status = "ready";
    } catch {
      if (id !== this.requestId) return;
      this.matrix = [];
      this.status = "error";
    }
  }
}
