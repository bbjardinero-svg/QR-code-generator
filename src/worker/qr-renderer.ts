import QRCode from "qrcode";
import { PNG } from "pngjs";
import { QR_COLORS } from "../shared/constants";

function assertColor(color: string): void {
  if (!(QR_COLORS as readonly string[]).includes(color)) {
    throw new Error("Unsupported QR color");
  }
}

const options = (color: string) => ({
  errorCorrectionLevel: "M" as const,
  margin: 4,
  color: { dark: color, light: "#ffffff" },
});

export async function renderQrPng(url: string, color: string): Promise<Uint8Array> {
  assertColor(color);
  const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
  const margin = 4;
  const scale = Math.floor(1024 / (qr.modules.size + margin * 2));
  const dimension = (qr.modules.size + margin * 2) * scale;
  const png = new PNG({ width: dimension, height: dimension });
  const dark = color.slice(1).match(/.{2}/g)?.map((part) => Number.parseInt(part, 16)) ?? [0, 0, 0];

  for (let y = 0; y < dimension; y += 1) {
    for (let x = 0; x < dimension; x += 1) {
      const moduleX = Math.floor(x / scale) - margin;
      const moduleY = Math.floor(y / scale) - margin;
      const filled = moduleX >= 0 && moduleY >= 0 && moduleX < qr.modules.size && moduleY < qr.modules.size
        ? qr.modules.get(moduleX, moduleY)
        : false;
      const offset = (y * dimension + x) * 4;
      png.data[offset] = filled ? dark[0] : 255;
      png.data[offset + 1] = filled ? dark[1] : 255;
      png.data[offset + 2] = filled ? dark[2] : 255;
      png.data[offset + 3] = 255;
    }
  }

  return new Uint8Array(PNG.sync.write(png));
}

export async function renderQrSvg(url: string, color: string): Promise<string> {
  assertColor(color);
  return QRCode.toString(url, { ...options(color), type: "svg" });
}
