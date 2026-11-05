import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";
import AxeBuilder from "@axe-core/playwright";
import { createServer } from "../server.js";
import { planDocuments } from "../public/planner.js";
import { pdfFixture, docxFixture } from "./fixtures.mjs";

const server = createServer({ apiKey: "", accessKey: "" });
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
let browser, staticServer;
try {
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH === "auto"
        ? chromium.executablePath()
        : process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const privateRequests = [];
  page.on("request", (request) => {
    if (request.method() === "POST") privateRequests.push(request.url());
  });
  await page.goto(base);
  await page.getByRole("button", { name: "Generate ticket drafts" }).click();
  await page.locator("#generation-error").waitFor();
  assert.match(
    await page.locator("#generation-error").innerText(),
    /Add a document/,
  );

  // Read actual binary fixtures through the browser's PDF.js worker and DOCX parser.
  await page
    .locator("#files")
    .setInputFiles([
      new URL("../public/examples/meeting-notes.pdf", import.meta.url).pathname,
      new URL("../public/examples/product-summary.docx", import.meta.url)
        .pathname,
    ]);
  await page.waitForFunction(() =>
    document
      .getElementById("file-status")
      .textContent.startsWith("2 files added"),
  );
  assert.equal(await page.locator(".source-card").count(), 2);
  await page.getByRole("button", { name: "Generate ticket drafts" }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".ticket-card").length === 4,
  );
  assert.equal(await page.locator(".ticket-card").count(), 4);
  assert.ok(
    (await page.locator(".evidence").allTextContents()).some((text) =>
      text.includes("page 2"),
    ),
  );
  assert.equal(
    privateRequests.length,
    0,
    "Reading files and local generation must not upload contents",
  );
  assert.equal(
    await page
      .locator(".ticket-card")
      .nth(2)
      .getByLabel("Suggested points")
      .inputValue(),
    "",
  );

  const first = page.locator(".ticket-card").first();
  await first.locator(".evidence-entry").first().getByRole("button").click();
  await page
    .getByRole("dialog")
    .filter({ hasText: "meeting-notes.pdf" })
    .waitFor();
  assert.match(
    await page.locator(".source-block.active").innerText(),
    /Add a project filter/,
  );
  await page.getByRole("button", { name: "Close source preview" }).click();
  await first
    .getByLabel("Summary", { exact: true })
    .fill("Reviewed dashboard filter");
  await first.getByLabel("Suggested points").selectOption("3");
  await first.getByText("Reviewed with the source", { exact: true }).check();
  assert.ok((await first.getAttribute("class")).includes("reviewed"));
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Jira CSV" }).click();
  const csv = await readFile(await (await downloaded).path(), "utf8");
  assert.match(csv, /Reviewed dashboard filter/);
  assert.match(csv, /Team override: 3/);
  assert.match(csv, /page 2/);
  const jsonEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const json = JSON.parse(
    await readFile(await (await jsonEvent).path(), "utf8"),
  );
  assert.equal(json.tickets.length, 4);
  assert.equal(json.sources.length, 2);
  assert.equal(json.tickets[0].points, 3);
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await page
    .locator("#toast")
    .filter({ hasText: "Selected ticket drafts copied" })
    .waitFor();
  assert.match(
    await page.evaluate(() => navigator.clipboard.readText()),
    /Reviewed dashboard filter/,
  );

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Try a meeting pack" }).click();
  assert.equal(
    await first.getByLabel("Summary", { exact: true }).inputValue(),
    "Reviewed dashboard filter",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Try a meeting pack" }).click();
  assert.equal(await page.locator(".ticket-card").count(), 4);
  await page.locator("#context").fill("Updated project context");
  assert.equal(await page.locator("#stale-banner").isVisible(), true);
  await page.locator("#files").setInputFiles({
    name: "image-only.pdf",
    mimeType: "application/pdf",
    buffer: pdfFixture([[]]),
  });
  await page
    .locator("#source-errors")
    .filter({ hasText: "Scanned or image-only" })
    .waitFor();
  await page.locator("#files").setInputFiles({
    name: "broken.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("not a PDF"),
  });
  await page
    .locator("#source-errors")
    .filter({ hasText: "not a readable PDF" })
    .waitFor();
  await page.locator("#files").setInputFiles({
    name: "fake.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("not a zip"),
  });
  await page
    .locator("#source-errors")
    .filter({ hasText: "Could not read" })
    .waitFor();

  // Paste-and-generate automatically includes notes even if Add these notes was not clicked.
  const notesPage = await context.newPage();
  await notesPage.goto(base);
  await notesPage
    .locator("#note-name")
    .fill('Workshop <img src=x onerror="window.xss=true">');
  await notesPage
    .locator("#notes")
    .fill(
      "Action: Add a receipt download button.\nThe button must support keyboard access.\nAction: Research a billing integration.",
    );
  await notesPage
    .getByRole("button", { name: "Generate ticket drafts" })
    .click();
  assert.equal(await notesPage.locator(".ticket-card").count(), 2);
  assert.equal(await notesPage.evaluate(() => window.xss), undefined);
  assert.equal(await notesPage.locator(".source-card img").count(), 0);
  assert.equal(await notesPage.locator("#notes").inputValue(), "");

  // Optional AI UI: simulated responses only, no real provider request or charge.
  const aiPage = await context.newPage();
  let aiCalls = 0;
  await aiPage.route("**/api/status", (route) =>
    route.fulfill({
      json: { aiAvailable: true, requiresAccessKey: true, model: "test-model" },
    }),
  );
  await aiPage.route("**/api/generate", (route) => {
    aiCalls++;
    const data = route.request().postDataJSON();
    assert.equal(
      route.request().headers()["x-intake-key"],
      "test-workspace-key",
    );
    assert.ok(!JSON.stringify(data).includes("test-workspace-key"));
    const local = planDocuments(data.sources, {
      baseline: data.baseline,
      context: data.context,
    });
    return route.fulfill({
      json: {
        ...local,
        mode: "ai",
        tickets: local.tickets.map((t) => ({
          ...t,
          confidence: "Provisional",
        })),
      },
    });
  });
  await aiPage.goto(base);
  await aiPage.locator("#notes").fill("Action: Add a searchable project list.");
  await aiPage.locator("#mode").selectOption("ai");
  await aiPage.locator("#access-key").fill("test-workspace-key");
  assert.equal(aiCalls, 0);
  await aiPage.getByRole("button", { name: "Generate ticket drafts" }).click();
  await aiPage.locator(".ticket-card").waitFor();
  assert.equal(aiCalls, 1);
  assert.match(
    await aiPage.locator(".confidence-badge").innerText(),
    /PROVISIONAL/,
  );

  // A static deployment under a subdirectory must support the same PDF/Word upload flow.
  staticServer = http.createServer(async (req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    if (!path.startsWith("/jira-intake/") || !/^[A-Za-z0-9_./-]+$/.test(path)) {
      res.writeHead(404);
      return res.end();
    }
    const relative = path.slice("/jira-intake/".length) || "index.html";
    try {
      const data = await readFile(
        new URL(`../dist/jira-intake/${relative}`, import.meta.url),
      );
      res.setHeader(
        "Content-Type",
        /\.m?js$/.test(relative)
          ? "text/javascript"
          : /\.css$/.test(relative)
            ? "text/css"
            : /\.html$/.test(relative)
              ? "text/html"
              : "application/octet-stream",
      );
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  staticServer.listen(0, "127.0.0.1");
  await once(staticServer, "listening");
  const staticPage = await context.newPage();
  staticPage.on("pageerror", (error) => errors.push(error.message));
  const apiCalls = [];
  staticPage.on("request", (request) => {
    if (request.url().includes("/api/")) apiCalls.push(request.url());
  });
  await staticPage.goto(
    `http://127.0.0.1:${staticServer.address().port}/jira-intake/`,
  );
  await staticPage.locator("#files").setInputFiles([
    {
      name: "Planning.pdf",
      mimeType: "application/pdf",
      buffer: pdfFixture([
        [
          "Action: Add a searchable issue list.",
          "The list must support keyboard navigation.",
        ],
      ]),
    },
    {
      name: "Summary.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from(
        docxFixture(["Action: Fix the report download error."]),
      ),
    },
  ]);
  await staticPage.waitForFunction(() =>
    document
      .getElementById("file-status")
      .textContent.startsWith("2 files added"),
  );
  await staticPage
    .getByRole("button", { name: "Generate ticket drafts" })
    .click();
  assert.equal(await staticPage.locator(".ticket-card").count(), 2);
  assert.deepEqual(apiCalls, []);

  await mkdir("test-results", { recursive: true });
  await staticPage.screenshot({
    path: "test-results/desktop.png",
    fullPage: true,
  });
  const accessibility = await new AxeBuilder({ page: staticPage })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    accessibility.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((n) => n.target),
    })),
    [],
  );
  await staticPage.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await staticPage.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await staticPage.screenshot({
    path: "test-results/mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: real PDF and Word uploads, multi-ticket extraction, cross-source deduplication, page citations, edits and point overrides, CSV/JSON/copy exports, dirty-draft protection, scanned/corrupt-file errors, pasted-note intake, simulated AI, static subdirectory deployment, accessibility, and mobile layout.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  if (staticServer) await new Promise((resolve) => staticServer.close(resolve));
}
