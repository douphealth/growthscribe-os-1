export function renderErrorPage(): string {
  const refId = `SSR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Something went wrong</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font: 15px/1.5 system-ui, -apple-system, sans-serif; background: #fafafa; color: #111; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #4b5563; margin: 0 0 1.5rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button { padding: 0.5rem 1rem; border-radius: 0.375rem; font: inherit; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      .primary { background: #111; color: #fff; }
      .secondary { background: #fff; color: #111; border-color: #d1d5db; }
      .ref { margin-top: 1.25rem; font-size: 12px; color: #6b7280; }
      code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 11px; color: #111; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Something went wrong</h1>
      <p>An unexpected error occurred. You can try again, refresh the page, or head back home.</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">Refresh</button>
        <a class="secondary" href="/">Go home</a>
      </div>
      <p class="ref">Reference ID: <code>${refId}</code></p>
    </div>
  </body>
</html>`;
}
