// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DetailPage } from "../../src/ui/detail-page";
import type { DetailApi, QrDto, StoredFileDto } from "../../src/ui/api";

const qr: QrDto = {
  id: "qr-1",
  slug: "innovation-catalogue",
  name: "Innovation catalogue",
  description: "Latest edition",
  contentType: "url",
  destinationUrl: "https://example.org/old",
  storedFileId: null,
  foregroundColor: "#102f29",
  status: "active",
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
  publicUrl: "https://example.test/r/innovation-catalogue",
  scans: 3,
};

const file: StoredFileDto = {
  id: "1ab59e9f-a6d8-4098-b66f-763fbd1b1411",
  originalName: "booklet.pdf",
  mediaType: "application/pdf",
  sizeBytes: 4,
  etag: "etag",
  createdAt: "2026-07-15T00:00:00.000Z",
};

function makeApi(overrides: Partial<DetailApi> = {}): DetailApi {
  return {
    getQr: vi.fn().mockResolvedValue(qr),
    getFile: vi.fn().mockResolvedValue(file),
    getScans: vi.fn().mockResolvedValue({
      total: 3,
      series: [
        { date: "2026-07-14", scans: 1 },
        { date: "2026-07-15", scans: 2 },
      ],
    }),
    updateQr: vi.fn().mockImplementation(async (_id, input) => ({ ...qr, ...input })),
    uploadFile: vi.fn().mockResolvedValue(file),
    replaceFile: vi.fn().mockResolvedValue(undefined),
    archiveQr: vi.fn().mockResolvedValue({ ...qr, status: "archived" }),
    restoreQr: vi.fn().mockResolvedValue(qr),
    deleteQr: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("DetailPage", () => {
  it("shows an accessible scan chart, copy feedback, and PNG/SVG actions", async () => {
    const user = userEvent.setup();
    render(<DetailPage qrId="qr-1" api={makeApi()} onBack={vi.fn()} onDeleted={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "Innovation catalogue" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /daily scans for the last 30 days/i })).toBeInTheDocument();
    expect(screen.getByText(/3 scans across 2 active days/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /download png/i })).toHaveAttribute("href", "/api/qr/qr-1/png");
    expect(screen.getByRole("link", { name: /download svg/i })).toHaveAttribute("href", "/api/qr/qr-1/svg");

    await user.click(screen.getByRole("button", { name: /copy stable address/i }));
    expect(await screen.findByText(/address copied/i)).toBeInTheDocument();
  });

  it("edits the destination while preserving the public route, then archives and restores", async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<DetailPage qrId="qr-1" api={api} onBack={vi.fn()} onDeleted={vi.fn()} />);
    await screen.findByRole("heading", { name: "Innovation catalogue" });

    const destination = screen.getByLabelText(/destination web address/i);
    await user.clear(destination);
    await user.type(destination, "https://example.org/new");
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    expect(api.updateQr).toHaveBeenCalledWith("qr-1", expect.objectContaining({ destinationUrl: "https://example.org/new" }));
    expect(screen.getByText("/r/innovation-catalogue")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^archive qr$/i }));
    expect(api.archiveQr).toHaveBeenCalledWith("qr-1");
    await user.click(await screen.findByRole("button", { name: /restore qr/i }));
    expect(api.restoreQr).toHaveBeenCalledWith("qr-1");
  });

  it("replaces a finalized file and requires the exact QR name for permanent deletion", async () => {
    const user = userEvent.setup();
    const fileQr = { ...qr, contentType: "file" as const, destinationUrl: null, storedFileId: file.id };
    const api = makeApi({ getQr: vi.fn().mockResolvedValue(fileQr) });
    const onDeleted = vi.fn();
    render(<DetailPage qrId="qr-1" api={api} onBack={vi.fn()} onDeleted={onDeleted} />);

    expect(await screen.findByText("booklet.pdf")).toBeInTheDocument();
    const replacement = new File([new Uint8Array([5, 6, 7, 8])], "replacement.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText(/choose replacement file/i), replacement);
    await user.click(screen.getByRole("button", { name: /replace stored file/i }));
    await waitFor(() => expect(api.uploadFile).toHaveBeenCalled());
    expect(api.replaceFile).toHaveBeenCalledWith("qr-1", file.id);

    await user.click(screen.getByRole("button", { name: /delete permanently/i }));
    const dialog = screen.getByRole("dialog", { name: /delete innovation catalogue/i });
    const confirmation = screen.getByLabelText(/type innovation catalogue to confirm/i);
    expect(screen.getByRole("button", { name: /confirm permanent deletion/i })).toBeDisabled();
    await user.type(confirmation, "Innovation catalogue");
    await user.click(screen.getByRole("button", { name: /confirm permanent deletion/i }));

    expect(api.deleteQr).toHaveBeenCalledWith("qr-1");
    expect(onDeleted).toHaveBeenCalled();
    expect(dialog).toBeInTheDocument();
  });
});
