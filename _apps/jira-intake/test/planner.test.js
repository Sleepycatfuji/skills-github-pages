import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import {
  notesSource,
  validateSources,
  planDocuments,
  validateTicket,
  ticketText,
  jiraCsv,
} from "../public/planner.js";
import { checkFile } from "../public/documents.js";
import { createServer } from "../server.js";
import { authorize, generateWithAI } from "../ai.js";

const source = notesSource(
  "Meeting notes\nAction: Add a project filter to the dashboard.\nThe filter must show only accessible projects.\nAction: Fix CSV export for names containing commas.\nNames with quotes must remain in a single cell.\nAction: Investigate a new CRM integration.\nDecision: Dashboard redesign is out of scope.",
  "Planning notes",
  "notes",
);
const getDrafts = () => planDocuments([source]).tickets;

test("meeting notes produce several distinct tickets with evidence and point suggestions", () => {
  const result = planDocuments([source]);
  assert.equal(result.tickets.length, 3);
  assert.equal(result.tickets[0].issueType, "Story");
  assert.equal(result.tickets[0].points, 2);
  assert.match(result.tickets[0].criteria[0], /accessible projects/);
  assert.equal(result.tickets[1].issueType, "Bug");
  assert.equal(result.tickets[2].points, null);
  assert.equal(result.tickets[2].issueType, "Task");
  for (const ticket of result.tickets)
    assert.doesNotThrow(() => validateTicket(ticket, [source]));
  assert.ok(!result.tickets.some((t) => /redesign/i.test(t.title)));
});

test("duplicate actions across documents merge and preserve both source references", () => {
  const duplicate = notesSource(
    "Add a project filter to the dashboard.\nThe filter should work with a keyboard.",
    "Summary",
    "summary",
  );
  const result = planDocuments([source, duplicate]);
  assert.equal(result.tickets.length, 3);
  assert.deepEqual(
    [...new Set(result.tickets[0].evidence.map((e) => e.sourceId))],
    ["notes", "summary"],
  );
  assert.ok(result.tickets[0].criteria.some((c) => /keyboard/.test(c)));
});

test("discussion without deliverable actions produces no fabricated tickets", () => {
  const result = planDocuments([
    notesSource(
      "The team discussed last week’s progress.\nCustomer satisfaction is stable.\nThe launch date is unchanged.",
    ),
  ]);
  assert.deepEqual(result.tickets, []);
  assert.match(result.warnings[0], /No explicit deliverable/);
});

test("explicit deferred and excluded requests are not treated as deliverables", () => {
  const result = planDocuments([
    notesSource(
      "Action: Add an analytics module, deferred.\nDo not implement a chatbot.\nDecision: We decided not to add a new landing page.\nAction: Fix the invoice total.",
    ),
  ]);
  assert.equal(result.tickets.length, 1);
  assert.match(result.tickets[0].title, /Fix the invoice/);
});

test("estimates use the team baseline and explicit complexity signals; discovery stays unestimated", () => {
  const basic = notesSource("Action: Add a report download confirmation.");
  assert.equal(planDocuments([basic], { baseline: 1 }).tickets[0].points, 1);
  assert.equal(planDocuments([basic], { baseline: 3 }).tickets[0].points, 3);
  const integration = notesSource(
    "Action: Integrate the CRM webhook with role-based permissions.",
  );
  assert.equal(planDocuments([integration]).tickets[0].points, 8);
  assert.match(
    planDocuments([integration]).tickets[0].rationale,
    /integration/,
  );
  assert.equal(
    planDocuments([
      notesSource(
        "Action: Research a complete redesign of the onboarding flow.",
      ),
    ]).tickets[0].points,
    null,
  );
});

test("source page references are preserved and generated citations cannot fabricate pages", () => {
  const pdf = {
    ...source,
    id: "pdf",
    kind: "PDF",
    blocks: source.blocks.map((b) => ({ ...b, page: 2 })),
  };
  const result = planDocuments([pdf]);
  assert.equal(result.tickets[0].evidence[0].page, 2);
  const ticket = validateTicket(
    {
      ...result.tickets[0],
      evidence: result.tickets[0].evidence.map((e) => ({ ...e, page: 99 })),
    },
    [pdf],
  );
  assert.equal(ticket.evidence[0].page, 2);
  assert.match(ticketText(ticket, [pdf]), /page 2/);
});

test("source validation rejects duplicates, oversized batches, malformed text and references", () => {
  for (const sources of [
    [],
    [source, source],
    [{ ...source, blocks: [] }],
    [{ ...source, blocks: [{ id: "b", page: -1, text: "text" }] }],
  ])
    assert.throws(() => validateSources(sources));
  assert.throws(() => notesSource(""));
  assert.throws(() =>
    validateSources(
      Array.from({ length: 9 }, (_, i) => ({ ...source, id: `s${i}` })),
    ),
  );
  assert.throws(() => notesSource("a".repeat(120001)));
  assert.throws(() => planDocuments([source], { baseline: 8 }));
});

test("unsupported, empty and oversized files are rejected before parsing", () => {
  assert.equal(checkFile({ name: "notes.PDF", size: 123 }), "pdf");
  for (const file of [
    { name: "notes.pdf", size: 0 },
    { name: "notes.png", size: 12 },
    { name: "notes.pdf", size: 11 * 1024 * 1024 },
  ])
    assert.throws(() => checkFile(file));
});

test("ticket validation rejects unsupported point values and ungrounded evidence", () => {
  const ticket = getDrafts()[0];
  assert.throws(() => validateTicket({ ...ticket, points: 4 }, [source]));
  assert.throws(() => validateTicket({ ...ticket, evidence: [] }, [source]));
  assert.throws(() =>
    validateTicket(
      {
        ...ticket,
        evidence: [
          {
            sourceId: "notes",
            blockId: "b2",
            quote: "An invented requirement",
          },
        ],
      },
      [source],
    ),
  );
  assert.throws(() => validateTicket({ ...ticket, title: "" }, [source]));
});

test("batch CSV preserves edited tickets, citations, blank estimates and spreadsheet escaping", () => {
  const drafts = getDrafts();
  drafts[0].title = "=1+1";
  drafts[1].title = 'Fix "A, B" CSV export';
  const csv = jiraCsv(drafts, [source]);
  assert.match(csv, /"'=1\+1"/);
  assert.ok(csv.includes('"Fix ""A, B"" CSV export"'));
  assert.ok(csv.includes("## Source evidence"));
  assert.ok(csv.endsWith('""\r\n'));
  assert.throws(() => jiraCsv([], [source]));
});

test("large action batches disclose ticket limits instead of implying complete coverage", () => {
  const text = Array.from(
    { length: 25 },
    (_, i) => `Action: Add item${i} with unique${i} functionality${i}.`,
  ).join("\n");
  const result = planDocuments([notesSource(text)]);
  assert.equal(result.tickets.length, 20);
  assert.match(result.warnings[0], /25 possible actions/);
});

test("AI authorization fails closed for hosted unprotected or incorrect keys", () => {
  assert.throws(
    () => authorize("", {}),
    (e) => e.status === 503,
  );
  assert.throws(
    () => authorize("", { apiKey: "test", production: true }),
    (e) => e.status === 503,
  );
  assert.throws(
    () => authorize("wrong", { apiKey: "test", accessKey: "correct" }),
    (e) => e.status === 401,
  );
  assert.doesNotThrow(() =>
    authorize("correct", {
      apiKey: "test",
      accessKey: "correct",
      production: true,
    }),
  );
});

test("AI request includes source blocks and validates genuine citations with mocked provider output", async () => {
  let calls = 0;
  const result = await generateWithAI(
    { sources: [source], baseline: 2, context: "A reporting dashboard" },
    {
      apiKey: "server-key-only",
      model: "test-model",
      fetchImpl: async (url, init) => {
        calls++;
        assert.equal(url, "https://api.openai.com/v1/chat/completions");
        assert.equal(init.headers.Authorization, "Bearer server-key-only");
        const body = JSON.parse(init.body);
        assert.equal(body.response_format.json_schema.strict, true);
        assert.equal(
          JSON.parse(body.messages[1].content).sources[0].id,
          "notes",
        );
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({ tickets: getDrafts(), warnings: [] }),
              },
            },
          ],
        });
      },
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.mode, "ai");
  assert.equal(result.tickets[0].confidence, "Provisional");
});

test("AI output with fabricated quotes or malformed fields is rejected", async () => {
  const invalid = {
    ...getDrafts()[0],
    evidence: [{ sourceId: "notes", blockId: "b2", quote: "Fabricated quote" }],
  };
  await assert.rejects(
    generateWithAI(
      { sources: [source] },
      {
        apiKey: "test",
        fetchImpl: async () =>
          Response.json({
            choices: [
              {
                message: {
                  content: JSON.stringify({ tickets: [invalid], warnings: [] }),
                },
              },
            ],
          }),
      },
    ),
    (e) => e.status === 502,
  );
});

test("AI provider errors are actionable and never expose upstream content", async () => {
  for (const status of [401, 429, 500])
    await assert.rejects(
      generateWithAI(
        { sources: [source] },
        {
          apiKey: "test",
          fetchImpl: async () =>
            new Response("private upstream detail", { status }),
        },
      ),
      (e) => e.status === 502 && !e.message.includes("private upstream"),
    );
});

test("HTTP app serves its readers, protects server files, and blocks unauthenticated paid requests", async () => {
  const server = createServer({
    apiKey: "test",
    accessKey: "private-test",
    production: true,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const status = await (await fetch(base + "/api/status")).json();
    assert.equal(status.aiAvailable, true);
    assert.equal(status.requiresAccessKey, true);
    assert.ok(!JSON.stringify(status).includes("private-test"));
    for (const path of [
      "/",
      "/documents.js",
      "/vendor/pdf.mjs",
      "/vendor/pdf.worker.mjs",
      "/vendor/fflate.mjs",
      "/examples/meeting-notes.pdf",
    ])
      assert.equal((await fetch(base + path)).status, 200, path);
    for (const path of [
      "/.env",
      "/ai.js",
      "/server.js",
      "/node_modules/pdfjs-dist/package.json",
    ])
      assert.equal((await fetch(base + path)).status, 404);
    const response = await fetch(base + "/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 401);
    const crossSite = await fetch(base + "/api/generate", {
      method: "POST",
      headers: {
        Origin: "https://foreign.example",
        "X-Intake-Key": "private-test",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(crossSite.status, 403);
    const malformed = await fetch(base + "/api/generate", {
      method: "POST",
      headers: {
        "X-Intake-Key": "private-test",
        "Content-Type": "application/json",
      },
      body: "{broken",
    });
    assert.equal(malformed.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
