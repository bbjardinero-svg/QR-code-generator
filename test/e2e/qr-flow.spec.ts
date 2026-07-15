import { expect, test } from "playwright/test";

test("creates a web QR and preserves its public route after editing", async ({ page }) => {
  const slug = `innovation-catalogue-${Date.now()}`;

  await page.goto("/");
  await page.getByLabel("Admin passphrase").fill("local-test-passphrase");
  await page.getByRole("button", { name: "Open dashboard" }).click();

  await expect(page.getByRole("heading", { name: "Your QR registry" })).toBeVisible();
  await page.getByRole("button", { name: "Create QR code" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Innovation catalogue");
  await page.getByLabel("Short link").fill(slug);
  await page.getByLabel("HTTPS web address").fill("https://example.org/catalogue");
  await page.getByRole("button", { name: "Continue to design" }).click();
  await page.getByRole("radio", { name: "Evergreen QR color" }).check();
  await page.getByRole("button", { name: "Continue to review" }).click();
  await page.getByRole("button", { name: "Create QR code", exact: true }).click();

  await expect(page).toHaveURL(/\/qr\/[0-9a-f-]+$/);
  await expect(page.getByText(`/r/${slug}`, { exact: true })).toBeVisible();

  await page.getByLabel("Destination web address").fill("https://example.org/updated-catalogue");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/stable public address did not change/i)).toBeVisible();
  await expect(page.getByText(`/r/${slug}`, { exact: true })).toBeVisible();

  const scan = await page.request.get(`/r/${slug}`, { maxRedirects: 0 });
  expect(scan.status()).toBe(302);
  expect(scan.headers().location).toBe("https://example.org/updated-catalogue");
});
