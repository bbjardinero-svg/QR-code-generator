// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DashboardPage } from "../../src/ui/dashboard-page";
import type { DashboardApi, QrDto, SummaryDto } from "../../src/ui/api";

const summary: SummaryDto = {
  totalQrCodes: 2,
  activeQrCodes: 1,
  archivedQrCodes: 1,
  totalScans: 42,
  storageBytes: 1_500_000_000,
};

const qr: QrDto = {
  id: "qr-1",
  slug: "innovation-catalogue",
  name: "Innovation catalogue",
  description: "Latest edition",
  contentType: "url",
  destinationUrl: "https://example.org/catalogue",
  storedFileId: null,
  foregroundColor: "#102f29",
  status: "active",
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
  publicUrl: "https://example.test/r/innovation-catalogue",
  scans: 42,
};

function makeApi(items: QrDto[] = [qr]): DashboardApi {
  return {
    getSummary: vi.fn().mockResolvedValue(summary),
    listQr: vi.fn().mockResolvedValue(items),
  };
}

describe("DashboardPage", () => {
  it("shows a loading skeleton, summary ledger, storage meter, and responsive navigation", async () => {
    let resolveSummary!: (value: SummaryDto) => void;
    const api: DashboardApi = {
      getSummary: vi.fn(() => new Promise<SummaryDto>((resolve) => (resolveSummary = resolve))),
      listQr: vi.fn().mockResolvedValue([qr]),
    };
    render(<DashboardPage api={api} onCreate={vi.fn()} onOpenQr={vi.fn()} />);

    expect(screen.getByLabelText(/loading dashboard/i)).toBeInTheDocument();
    resolveSummary(summary);

    expect(await screen.findByRole("heading", { name: /your qr registry/i })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: /primary/i })).toBeInTheDocument();
    expect(within(screen.getByLabelText(/qr summary/i)).getByText("42")).toBeInTheDocument();
    const storage = screen.getByRole("progressbar", { name: /r2 storage/i });
    expect(storage).toHaveAttribute("aria-valuemax", "10000000000");
    expect(storage).toHaveAttribute("aria-valuenow", "1500000000");
    expect(screen.getByText(/1.5 gb of 10 gb/i)).toBeInTheDocument();
  });

  it("turns an empty registry into a clear create action", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<DashboardPage api={makeApi([])} onCreate={onCreate} onOpenQr={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: /no qr codes yet/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /create your first qr/i }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("offers a retry when dashboard data cannot load", async () => {
    const user = userEvent.setup();
    const api: DashboardApi = {
      getSummary: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(summary),
      listQr: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue([qr]),
    };
    render(<DashboardPage api={api} onCreate={vi.fn()} onOpenQr={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load your qr registry/i);
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByText("Innovation catalogue")).toBeInTheDocument();
    expect(api.getSummary).toHaveBeenCalledTimes(2);
  });

  it("searches and filters the management list", async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<DashboardPage api={api} onCreate={vi.fn()} onOpenQr={vi.fn()} />);
    await screen.findByText("Innovation catalogue");

    await user.type(screen.getByRole("searchbox", { name: /search qr codes/i }), "field");
    await waitFor(() => expect(api.listQr).toHaveBeenLastCalledWith({ search: "field", status: undefined }));

    await user.selectOptions(screen.getByLabelText(/status/i), "archived");
    await waitFor(() => expect(api.listQr).toHaveBeenLastCalledWith({ search: "field", status: "archived" }));
  });
});
