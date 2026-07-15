// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CreatePage } from "../../src/ui/create-page";
import type { CreateApi, QrDto, StoredFileDto } from "../../src/ui/api";

const createdQr: QrDto = {
  id: "created-qr",
  slug: "innovation-catalogue",
  name: "Innovation catalogue",
  description: null,
  contentType: "url",
  destinationUrl: "https://example.org/catalogue",
  storedFileId: null,
  foregroundColor: "#102f29",
  status: "active",
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
  publicUrl: "https://temporary.workers.dev/r/innovation-catalogue",
  scans: 0,
};

const storedFile: StoredFileDto = {
  id: "1ab59e9f-a6d8-4098-b66f-763fbd1b1411",
  originalName: "booklet.pdf",
  mediaType: "application/pdf",
  sizeBytes: 4,
  etag: "etag",
  createdAt: "2026-07-15T00:00:00.000Z",
};

function makeApi(): CreateApi {
  return {
    createQr: vi.fn().mockResolvedValue(createdQr),
    uploadFile: vi.fn().mockImplementation(async (_file, onProgress) => {
      onProgress(35);
      onProgress(100);
      return storedFile;
    }),
  };
}

async function fillIdentity(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^name$/i), "Innovation catalogue");
  await user.type(screen.getByLabelText(/short link/i), "innovation-catalogue");
}

describe("CreatePage", () => {
  it("creates a web-link QR through Content, Design, and Review with the approved high-contrast palette", async () => {
    const user = userEvent.setup();
    const api = makeApi();
    const onCreated = vi.fn();
    render(<CreatePage api={api} onCancel={vi.fn()} onCreated={onCreated} temporaryAddress />);

    expect(screen.getByRole("heading", { name: /what should this qr open/i })).toBeInTheDocument();
    await fillIdentity(user);
    await user.type(screen.getByLabelText(/https web address/i), "https://example.org/catalogue");
    await user.click(screen.getByRole("button", { name: /continue to design/i }));

    expect(screen.getByRole("heading", { name: /choose a print-safe color/i })).toBeInTheDocument();
    expect(screen.getAllByRole("radio", { name: /qr color/i })).toHaveLength(3);
    await user.click(screen.getByRole("radio", { name: /evergreen qr color/i }));
    await user.click(screen.getByRole("button", { name: /continue to review/i }));

    expect(screen.getByRole("heading", { name: /review the durable route/i })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/temporary workers.dev address/i);
    await user.click(screen.getByRole("button", { name: /copy stable address/i }));
    expect(await screen.findByText(/address copied/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^create qr code$/i }));

    await waitFor(() => expect(api.createQr).toHaveBeenCalledWith(expect.objectContaining({
      contentType: "url",
      slug: "innovation-catalogue",
      foregroundColor: "#1f8a70",
    })));
    expect(onCreated).toHaveBeenCalledWith("created-qr");
  });

  it("treats file picking and drag-and-drop equally and rejects oversized or disallowed files", async () => {
    const user = userEvent.setup();
    render(<CreatePage api={makeApi()} onCancel={vi.fn()} onCreated={vi.fn()} />);
    await user.click(screen.getByRole("radio", { name: /stored file/i }));
    await fillIdentity(user);

    const dropZone = screen.getByLabelText(/drop file here/i);
    const dropped = new File([new Uint8Array([1, 2, 3, 4])], "booklet.pdf", { type: "application/pdf" });
    fireEvent.drop(dropZone, { dataTransfer: { files: [dropped] } });
    expect(screen.getByText("booklet.pdf")).toBeInTheDocument();

    const picker = screen.getByLabelText(/choose file/i);
    const picked = new File(["notes"], "notes.txt", { type: "text/plain" });
    await user.upload(picker, picked);
    expect(screen.getByText("notes.txt")).toBeInTheDocument();

    const oversized = new File(["x"], "too-large.pdf", { type: "application/pdf" });
    Object.defineProperty(oversized, "size", { value: 100_000_001 });
    await user.upload(picker, oversized);
    expect(screen.getByRole("alert")).toHaveTextContent(/100 mb or smaller/i);

    const executable = new File(["x"], "malware.exe", { type: "application/octet-stream" });
    fireEvent.drop(dropZone, { dataTransfer: { files: [executable] } });
    expect(screen.getByRole("alert")).toHaveTextContent(/file type is not allowed/i);
  });

  it("shows upload progress and retries a failed file creation without losing metadata", async () => {
    const user = userEvent.setup();
    const api = makeApi();
    vi.mocked(api.uploadFile)
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockImplementationOnce(async (_file, onProgress) => {
        onProgress(70);
        onProgress(100);
        return storedFile;
      });
    vi.mocked(api.createQr).mockResolvedValue({ ...createdQr, contentType: "file", destinationUrl: null, storedFileId: storedFile.id });
    render(<CreatePage api={api} onCancel={vi.fn()} onCreated={vi.fn()} />);

    await user.click(screen.getByRole("radio", { name: /stored file/i }));
    await fillIdentity(user);
    await user.upload(
      screen.getByLabelText(/choose file/i),
      new File([new Uint8Array([1, 2, 3, 4])], "booklet.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByRole("button", { name: /continue to design/i }));
    await user.click(screen.getByRole("button", { name: /continue to review/i }));
    await user.click(screen.getByRole("button", { name: /^create qr code$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/upload did not finish/i);
    expect(screen.getByText("Innovation catalogue")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /retry creation/i }));

    expect(await screen.findByRole("progressbar", { name: /file upload/i })).toHaveAttribute("aria-valuenow", "100");
    await waitFor(() => expect(api.createQr).toHaveBeenCalledWith(expect.objectContaining({
      contentType: "file",
      storedFileId: storedFile.id,
    })));
  });
});
