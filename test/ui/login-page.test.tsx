// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LoginPage } from "../../src/ui/login-page";

describe("LoginPage", () => {
  it("provides a labeled passphrase form that works from the keyboard", async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn().mockResolvedValue(undefined);
    render(<LoginPage onLogin={onLogin} />);

    expect(screen.getByRole("heading", { name: /open your qr registry/i })).toBeInTheDocument();
    const passphrase = screen.getByLabelText(/admin passphrase/i);
    await user.tab();
    expect(passphrase).toHaveFocus();
    await user.type(passphrase, "correct horse");
    await user.tab();
    expect(screen.getByRole("button", { name: /open dashboard/i })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(onLogin).toHaveBeenCalledWith("correct horse");
  });

  it("shows a visible, useful invalid-login error and keeps the field available", async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn().mockRejectedValue(new Error("Invalid credentials"));
    render(<LoginPage onLogin={onLogin} />);

    const passphrase = screen.getByLabelText(/admin passphrase/i);
    await user.type(passphrase, "wrong");
    await user.click(screen.getByRole("button", { name: /open dashboard/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/passphrase was not accepted/i);
    expect(passphrase).toBeEnabled();
  });
});
