function page(title: string, message: string, status: number): Response {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title} · EverQR</title>
  </head>
  <body>
    <main>
      <p aria-label="EverQR">EverQR</p>
      <h1>${title}</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function missingQrPage(): Response {
  return page("QR code not available", "This QR code does not exist or its address is incomplete.", 404);
}

export function archivedQrPage(): Response {
  return page("QR code archived", "The owner has archived this QR code. Please contact them for an updated resource.", 410);
}

export function unavailableFilePage(): Response {
  return page("File temporarily unavailable", "The file could not be opened right now. Please try again later.", 503);
}
