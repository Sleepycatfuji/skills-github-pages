# Triage — documents to Jira tickets

A document-first web app: upload PDFs, Word documents, text or Markdown, and/or paste meeting notes and summaries. The app extracts text, identifies multiple work items, combines close duplicates across sources, and creates an editable backlog with acceptance criteria, provisional story points, refinement questions, and source evidence.

This replaces the earlier single-request form. The workflow is **add source material → generate a batch → review each ticket and its evidence → export selected tickets**.

## Try it

Use the deployed static web app, or run it locally with Node.js 24 or newer:

```sh
cd jira-intake
npm ci --ignore-scripts
npm run build
npm start
```

The default local port is 3001. In this cloud workspace the source is `/workspace/hellokim-site/_apps/jira-intake`, also reachable through the compatibility shortcut `/workspace/jira-intake`. The onboarding screen has no interactive browser preview; test through a proper web host, your local browser, or the automated Chromium suite.

Click **Try a meeting pack** for a four-ticket example. You can also download the built-in **Meeting PDF** and **Word summary** examples, then upload them to exercise real document parsing. Their duplicated project-filter action should merge into one ticket. PDF evidence includes the actual page number. The CRM investigation remains unestimated.

## Inputs and limits

- **PDF:** selectable text, up to 100 pages. Reading uses the pinned PDF.js library in a browser worker. Password-protected and scanned/image-only PDFs are not supported; unlock the document or run OCR first, then upload or paste the extracted text.
- **DOCX:** main-document paragraphs and tables. Images, comments, footnotes, headers, footers, and tracked-change history are not imported. Old `.doc` files are not supported; save as `.docx` first.
- **TXT/MD:** UTF-8 text files.
- **Pasted material:** meeting notes, transcripts, summaries, requirements, and action lists. Click Add these notes, or click Generate to include pending pasted notes automatically.

Limits are 10 MB per file, 8 sources, and 120,000 extracted characters per batch. DOCX main XML is capped at 2 MB before decompression. Oversized files and unreadable text show an error instead of silently producing an empty backlog. The source Preview shows what was actually extracted. Check it when formatting, reading order, or tables matter.

## Drafting modes

**Local rules — free** is the default. It recognizes explicit action lines and common deliverable verbs, associates nearby requirement sentences, combines close duplicates, and skips explicit deferred/out-of-scope work. It is a heuristic, not semantic AI: it can miss implicit tasks, split related work incorrectly, or misinterpret meeting discussion. A batch with no supported actions stays empty with a useful warning. Up to 20 tickets are generated; additional candidate work is disclosed in the warnings.

**Optional AI drafting** uses the server and OpenAI to interpret less structured source material. It is disabled on the static build. To enable it on your own Node server:

1. Copy `.env.example` to `.env` without overwriting existing settings, or use secure hosting environment settings.
2. Set `AI_API_KEY` to your OpenAI key. Optionally set `AI_MODEL` to a model supporting Chat Completions and strict JSON Schema output; the default is `gpt-4.1-mini`.
3. Set `INTAKE_ACCESS_KEY` to a long random workspace key. This is required for hosted AI (`NODE_ENV=production`). The app asks for this key before AI generation. It stays in browser memory; it is not placed in URLs, exports, or browser storage.
4. Restart the Node service. Choose AI mode, enter the workspace key if requested, and click Generate. This sends extracted source text and project context through your server to `api.openai.com`; raw PDF/Word files are not sent. Each generation can incur API charges.

The server verifies every returned quote against the identified source block and replaces page numbers with the real block’s page. Invalid quotes, fields, point values, or provider errors fail visibly. Quote validation establishes that the quoted text exists; it does not prove every ticket interpretation is correct. Human review remains necessary. Real AI credentials were not used in automated validation.

## Review and estimates

Each ticket has an editable title, issue type, priority, description, acceptance criteria, points, rationale, and questions. Open a source citation to inspect the original text. Select the tickets to export; mark them reviewed to track progress. Editing a reviewed ticket removes its review mark. Regeneration asks before discarding ticket edits. Changes to sources or settings leave a visible stale-batch warning; the current batch retains its original source evidence until regenerated or cleared.

Story points use Fibonacci values 1, 2, 3, 5, 8, or 13, relative to your chosen 1/2/3-point familiar change. Local estimates start at that reference and add explicit heuristic weights for integration, migration, access/security, and wider test coverage. Broad work or discovery remains unestimated. Local estimates are labelled low confidence; AI estimates are provisional. These are not hours, measured effort, or calibrated team commitments. Confirm the estimate against completed team reference stories. Overrides are recorded in the export rationale.

## Exports and Jira

Export selected tickets as **Jira CSV**, **JSON**, or copied Markdown. CSVs have one row per ticket with multiline descriptions and source evidence. Map `Summary`, `Issue Type`, `Description`, `Priority`, and `Labels` in your Jira project’s CSV importer. Map `Story Points` to the actual custom estimation field or `Story point estimate` used by that project. Supported issue types and priorities vary by project, and import may require administrator permissions. Blank points stay unestimated. Reimporting a CSV can create duplicate issues.

CSV fields are quoted and formula-like spreadsheet values are prefixed with an apostrophe. Review that prefix if your title intentionally starts with a formula character. JSON contains selected tickets and their referenced source blocks, so it can contain sensitive source excerpts. The JSON is portable review data, not a Jira REST create-issue payload.

No Jira project or Gmail account is connected. The app does not automatically create issues, assign users, send email, or upload raw files. A direct Jira integration is a separate step requiring the target project, issue types, required fields, estimation field, and credentials on an authenticated server. No real Jira import was validated.

## Hosting

`npm run build` writes a complete static website to **`dist/jira-intake/`**. Serve the entire folder over HTTP/HTTPS; opening `index.html` directly from disk will not load its modules correctly. Keep `vendor/`, its PDF worker/fonts/CMaps, examples, and library licenses alongside the app. All URLs are relative so it works at a subdirectory such as `/jira-intake/`. The static build disables AI and performs no backend calls. It can be copied into the existing GitHub Pages site without moving the portfolio or changing its domain.

The full source lives under **`_apps/jira-intake`** in `Sleepycatfuji/skills-github-pages`. That directory is excluded from the Pages site by Jekyll's underscore-directory convention; the public build is the separate `jira-intake/` directory at the repository root. Rebuild and copy the static directory when updating the public demo. The portfolio and email-assistant demo are separate.

The optional server can run on Render or another Node.js host. Use the included `render.yaml` as a Blueprint (its service root is `_apps/jira-intake`), or create a web service from the website repository with **Root Directory `_apps/jira-intake`**, Node 24, `HOST=0.0.0.0`, `NODE_ENV=production`, build command `npm ci --omit=dev --ignore-scripts && npm run build`, and start command `npm start`. If deploying the standalone source ZIP as a new repository, set the root directory to that repository's actual project root and adjust the Blueprint's `rootDir` accordingly. The health check is `/api/status`. Add AI settings securely after choosing a hosting plan. No hosting account, paid service, or live provider key is created by the code. Keep a personal workspace key private; this prototype is not a full multi-user login system.

## Privacy

File reading and local drafting happen in the browser. Source text and drafts are held in memory, with no application database or browser storage. Reloading or Clear workspace clears this state. The hosting provider receives ordinary requests for the app’s static assets, not uploaded file contents. AI mode sends extracted text to your server and OpenAI only when explicitly requested; provider and infrastructure data policies apply. The server does not log source text or write it to disk. Copying/downloading deliberately moves ticket text and cited source material outside the tab.

## Validation

```sh
npm test
npm run check
npm run test:browser
```

Browser checks need the pinned development dependencies and Chromium (`/usr/bin/chromium` by default, or set `CHROMIUM_PATH`). They read actual PDF and DOCX fixtures in the browser, generate multiple tickets, verify deduplication and page citations, exercise edits/downloads/copy, and check source previews, invalid/scanned files, mobile layout, accessibility, and the static build under a subdirectory. AI calls are simulated; no mailbox, live provider key, or Jira project is used. Screenshots are saved in ignored `test-results/`.
