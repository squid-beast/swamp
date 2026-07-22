import { NextRequest } from "next/server";

// GET /api/v1/docs
//
// Human-readable API reference. Renders the OpenAPI spec with Scalar, loaded from
// a CDN so there is no build dependency. The spec itself is served from
// /api/v1/openapi.json, so this page is a thin viewer over the single source of
// truth.

export const dynamic = "force-dynamic";

export function GET(_req: NextRequest) {
  const html = `<!doctype html>
<html>
  <head>
    <title>SWAMP API reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
  </head>
  <body>
    <script id="api-reference" data-url="/api/v1/openapi.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
