import { describe, expect, it } from "vitest";
import { renderQrPng, renderQrSvg } from "../../src/worker/qr-renderer";

const url = "https://everqr.example/r/innovation-catalogue";

describe("QR rendering", () => {
  it("renders a high-resolution PNG with a valid signature", async () => {
    const png = await renderQrPng(url, "#102f29");
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.byteLength).toBeGreaterThan(1_000);
  });

  it("renders SVG with the approved color and quiet zone", async () => {
    const svg = await renderQrSvg(url, "#1f8a70");
    expect(svg).toContain("<svg");
    expect(svg).toContain("#1f8a70");
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/);
  });

  it("rejects unapproved colors", async () => {
    await expect(renderQrSvg(url, "#ff0000")).rejects.toThrow("Unsupported QR color");
  });
});
