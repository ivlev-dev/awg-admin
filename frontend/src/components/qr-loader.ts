export const QR_MAX_BYTES = 1900;
export const QR_MARGIN_MODULES = 2;
export const QR_MIN_SIZE = 96;
export const QR_MAX_SIZE = 512;

export type QrMatrix = readonly (readonly boolean[])[];

interface QrCodeInstance {
  addData(data: string, mode?: "Numeric" | "Alphanumeric" | "Byte" | "Kanji"): void;
  make(): void;
  getModuleCount(): number;
  isDark(row: number, col: number): boolean;
}

type QrFactory = (
  typeNumber: 0,
  errorCorrectionLevel: "L" | "M" | "Q" | "H",
) => QrCodeInstance;

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function clampQrSize(size: number | undefined): number {
  if (size === undefined || !Number.isFinite(size)) return 192;
  return Math.min(QR_MAX_SIZE, Math.max(QR_MIN_SIZE, Math.round(size)));
}

export async function loadQrMatrix(value: string): Promise<QrMatrix> {
  const module = await import("qrcode-generator");
  const factory = module.default as QrFactory;
  const code = factory(0, "M");
  code.addData(value, "Byte");
  code.make();
  const count = code.getModuleCount();
  const matrix: boolean[][] = [];
  for (let row = 0; row < count; row += 1) {
    const cells: boolean[] = [];
    for (let col = 0; col < count; col += 1) {
      cells.push(code.isDark(row, col));
    }
    matrix.push(cells);
  }
  return matrix;
}
