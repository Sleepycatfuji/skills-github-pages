import { readFile, mkdir, writeFile, cp, rm } from "node:fs/promises";
import { pdfFixture, docxFixture } from "./fixtures.mjs";

const root = new URL("../", import.meta.url);
const examples = new URL("public/examples/", root);
await mkdir(examples, { recursive: true });
await writeFile(
  new URL("meeting-notes.pdf", examples),
  pdfFixture([
    [
      "Sprint planning notes",
      "Action: Add a project filter to the work dashboard.",
      "The filter must list only projects the user can access.",
      "Selecting a project should show only that project's tasks.",
    ],
    [
      "Action: Fix CSV export when customer names contain commas.",
      "Names with quotes or line breaks must remain in a single field.",
      "Action: Investigate connecting the support inbox to the CRM.",
      "Decision: The full dashboard redesign is out of scope.",
    ],
  ]),
);
await writeFile(
  new URL("product-summary.docx", examples),
  docxFixture([
    "Product follow-up summary",
    "Add a project filter to the work dashboard.",
    "The filter should be usable with a keyboard.",
    "Action: Add a confirmation message after a report is downloaded.",
    "The message should confirm the filename and report date.",
  ]),
);

const destination = new URL("dist/jira-intake/", root);
await rm(destination, { recursive: true, force: true });
await mkdir(new URL("vendor/", destination), { recursive: true });
for (const file of ["style.css", "app.js", "planner.js", "documents.js"])
  await cp(new URL(`public/${file}`, root), new URL(file, destination));
let html = await readFile(new URL("public/index.html", root), "utf8");
html = html.replace(
  /<meta\s+name="triage-backend"\s+content="auto"\s*\/?>/,
  '<meta name="triage-backend" content="none">',
);
html = html.replace(
  "<head>",
  "<head>\n<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'self' blob:; style-src 'self'; connect-src 'self'; worker-src 'self' blob:; font-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'\">",
);
await writeFile(new URL("index.html", destination), html);
await cp(examples, new URL("examples/", destination), { recursive: true });
for (const [from, to] of [
  ["pdfjs-dist/build/pdf.min.mjs", "pdf.mjs"],
  ["pdfjs-dist/build/pdf.worker.min.mjs", "pdf.worker.mjs"],
  ["fflate/esm/browser.js", "fflate.mjs"],
  ["pdfjs-dist/LICENSE", "PDFJS_LICENSE"],
  ["fflate/LICENSE", "FFLATE_LICENSE"],
])
  await cp(
    new URL(`node_modules/${from}`, root),
    new URL(`vendor/${to}`, destination),
  );
for (const directory of ["cmaps", "standard_fonts"])
  await cp(
    new URL(`node_modules/pdfjs-dist/${directory}/`, root),
    new URL(`vendor/${directory}/`, destination),
    { recursive: true },
  );
console.log(
  "Built dist/jira-intake/: a static document-intake web app with PDF/Word readers, samples, source citations, batch drafts, and exports. Static mode makes no AI requests.",
);
