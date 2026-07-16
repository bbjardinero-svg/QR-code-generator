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

test("uploads a private file, delivers it through the stable route, and records a scan", async ({ page }) => {
  const slug = `r2-delivery-${Date.now()}`;
  const contents = "EverQR local R2 delivery check";

  await page.goto("/");
  await page.getByLabel("Admin passphrase").fill("local-test-passphrase");
  await page.getByRole("button", { name: "Open dashboard" }).click();
  await page.getByRole("button", { name: "Create QR code" }).click();
  await page.getByRole("radio", { name: /stored file/i }).check();
  await page.getByLabel("Name", { exact: true }).fill("R2 delivery check");
  await page.getByLabel("Short link").fill(slug);
  await page.getByLabel("Choose file").setInputFiles({
    name: "delivery.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(contents),
  });
  await page.getByRole("button", { name: "Continue to design" }).click();
  await page.getByRole("button", { name: "Continue to review" }).click();
  await page.getByRole("button", { name: "Create QR code", exact: true }).click();

  await expect(page).toHaveURL(/\/qr\/[0-9a-f-]+$/);
  const delivery = await page.request.get(`/r/${slug}`);
  expect(delivery.status()).toBe(200);
  expect(delivery.headers()["content-type"]).toContain("text/plain");
  expect(await delivery.text()).toBe(contents);
  await page.reload();
  await expect(page.getByText("1 all-time scans")).toBeVisible();
});
