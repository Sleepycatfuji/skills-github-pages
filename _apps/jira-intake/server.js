import http from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { authorize, generateWithAI, HttpError } from "./ai.js";

const assets = new Map([
  ["/", ["public/index.html", "text/html; charset=utf-8"]],
  ["/style.css", ["public/style.css", "text/css; charset=utf-8"]],
  ["/app.js", ["public/app.js", "text/javascript; charset=utf-8"]],
  ["/planner.js", ["public/planner.js", "text/javascript; charset=utf-8"]],
  ["/documents.js", ["public/documents.js", "text/javascript; charset=utf-8"]],
  [
    "/vendor/pdf.js",
    [
      "node_modules/pdfjs-dist/build/pdf.min.mjs",
      "text/javascript; charset=utf-8",
    ],
  ],
  [
    "/vendor/pdf.worker.js",
    [
      "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
      "text/javascript; charset=utf-8",
    ],
  ],
  [
    "/vendor/fflate.js",
    ["node_modules/fflate/esm/browser.js", "text/javascript; charset=utf-8"],
  ],
  [
    "/examples/meeting-notes.pdf",
    ["public/examples/meeting-notes.pdf", "application/pdf"],
  ],
  [
    "/examples/product-summary.docx",
    [
      "public/examples/product-summary.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
  ],
]);

function assetFor(path) {
  if (assets.has(path)) return assets.get(path);
  const match = path.match(
    /^\/vendor\/(cmaps|standard_fonts)\/([A-Za-z0-9_-]+\.(?:bcmap|pfb|ttf))$/,
  );
  return match
    ? [
        `node_modules/pdfjs-dist/${match[1]}/${match[2]}`,
        "application/octet-stream",
      ]
    : null;
}

async function jsonBody(req) {
  if (
    !req.headers["content-type"]?.toLowerCase().startsWith("application/json")
  )
    throw new HttpError(415, "Use application/json.");
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1000000)
      throw new HttpError(413, "This source batch is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "The request must contain valid JSON.");
  }
}

export function createServer({
  apiKey = process.env.AI_API_KEY,
  accessKey = process.env.INTAKE_ACCESS_KEY,
  model = process.env.AI_MODEL || "gpt-4.1-mini",
  production = process.env.NODE_ENV === "production",
  fetchImpl = fetch,
} = {}) {
  let active = 0;
  return http.createServer(async (req, res) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self' blob:; style-src 'self'; connect-src 'self'; worker-src 'self' blob:; font-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    const json = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(data));
    };
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      if (req.method === "GET" && path === "/api/status")
        return json(200, {
          aiAvailable: Boolean(apiKey && (!production || accessKey)),
          requiresAccessKey: Boolean(accessKey),
          model: apiKey ? model : null,
        });
      if (req.method === "POST" && path === "/api/generate") {
        const origin = req.headers.origin;
        if (
          origin &&
          ![
            `https://${req.headers.host}`,
            `http://${req.headers.host}`,
          ].includes(origin)
        )
          throw new HttpError(403, "Requests must come from this application.");
        authorize(req.headers["x-intake-key"], {
          apiKey,
          accessKey,
          production,
        });
        const input = await jsonBody(req);
        if (active >= 2)
          throw new HttpError(
            429,
            "Two AI batches are already running. Please try again shortly.",
          );
        active++;
        try {
          return json(
            200,
            await generateWithAI(input, { apiKey, model, fetchImpl }),
          );
        } finally {
          active--;
        }
      }
      const asset = assetFor(path);
      if (!asset || !["GET", "HEAD"].includes(req.method))
        return json(404, { error: "Not found." });
      const data = await readFile(new URL(asset[0], import.meta.url));
      res.writeHead(200, { "Content-Type": asset[1] });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch (error) {
      json(
        error instanceof HttpError
          ? error.status
          : error.code === "ENOENT"
            ? 404
            : 500,
        {
          error:
            error instanceof HttpError
              ? error.message
              : "Could not complete this request.",
        },
      );
    }
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const port = Number(process.env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be between 1 and 65535.");
  const server = createServer();
  server.listen(port, process.env.HOST || "127.0.0.1", () =>
    console.log(
      `Triage document intake is running on port ${port}. Files are read in the browser; AI drafting is optional.`,
    ),
  );
  server.on("error", (error) => {
    console.error(`Could not start: ${error.code || "unknown error"}`);
    process.exitCode = 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => server.close(() => process.exit(0)));
}
