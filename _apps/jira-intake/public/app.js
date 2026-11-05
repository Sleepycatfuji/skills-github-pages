import {
  notesSource,
  validateSources,
  planDocuments,
  validateTicket,
  ticketText,
  jiraCsv,
  POINTS,
} from "./planner.js";
import { readDocument } from "./documents.js";

const $ = (id) => document.getElementById(id);
let sources = [],
  tickets = [],
  batchSources = [],
  selected = new Set();
let dirty = false,
  revision = 0,
  batchRevision = -1,
  epoch = 0,
  readingEpoch = 0;
let reading = false,
  generating = false,
  controller = null,
  toastTimer;
let server = { aiAvailable: false, requiresAccessKey: false };
const uid = () => `source-${crypto.randomUUID()}`;
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 4500);
}
function confirmReplace() {
  return (
    !dirty ||
    window.confirm(
      "You’ve edited ticket drafts. Replace this batch and discard those edits?",
    )
  );
}
function setBusy(value) {
  generating = value;
  $("generate-button").disabled = value || reading;
  $("generate-button").textContent = value
    ? "Generating ticket drafts…"
    : "Generate ticket drafts →";
  $("loading-state").hidden = !value;
  if (value) {
    $("empty-state").hidden = true;
    $("no-results").hidden = true;
  }
}
function changed() {
  revision++;
  if (generating) {
    epoch++;
    controller?.abort();
    setBusy(false);
  }
  $("stale-banner").hidden = batchRevision < 0 || revision === batchRevision;
  $("generation-error").hidden = true;
}
function stats() {
  $("batch-stats").textContent =
    batchRevision < 0
      ? "Add some context to get started."
      : `${tickets.length} draft${tickets.length === 1 ? "" : "s"} · ${tickets.filter((t) => t.points === null).length} unestimated · ${tickets.filter((t) => t.reviewed).length} reviewed · ${selected.size} selected`;
  $("export-buttons").hidden = tickets.length === 0;
  $("export-note").hidden = tickets.length === 0;
  $("source-count").textContent = `${sources.length} / 8`;
}

function previewSource(id, blockId = null, originals = sources) {
  const source = originals.find((s) => s.id === id);
  if (!source) return;
  $("source-dialog-title").textContent = source.name;
  $("source-dialog-text").replaceChildren(
    ...source.blocks.map((block) => {
      const item = el(
        "section",
        `source-block${block.id === blockId ? " active" : ""}`,
      );
      item.append(
        el(
          "strong",
          "",
          `${block.page ? `Page ${block.page} · ` : ""}${block.id}`,
        ),
        el("p", "", block.text),
      );
      return item;
    }),
  );
  $("source-dialog").showModal();
  if (blockId)
    requestAnimationFrame(() =>
      $("source-dialog-text")
        .querySelector(".active")
        ?.scrollIntoView({ block: "nearest" }),
    );
}

function renderSources() {
  $("source-list").replaceChildren(
    ...sources.map((source) => {
      const card = el("div", "source-card");
      const top = el("div", "source-top");
      const details = el("div", "source-details");
      const length = source.blocks.reduce(
        (sum, block) => sum + block.text.length,
        0,
      );
      details.append(
        el("strong", "", source.name),
        el(
          "small",
          "",
          `${source.blocks.length} text blocks · ${length.toLocaleString("en-US")} characters`,
        ),
      );
      const remove = el("button", "icon-button", "×");
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove ${source.name} from sources`);
      remove.addEventListener("click", () => {
        sources = sources.filter((s) => s.id !== source.id);
        changed();
        renderSources();
      });
      top.append(
        el(
          "span",
          "source-icon",
          source.kind === "Word"
            ? "DOCX"
            : source.kind.toUpperCase().slice(0, 4),
        ),
        details,
        remove,
      );
      const preview = el("button", "text-button", "Preview extracted text →");
      preview.type = "button";
      preview.addEventListener("click", () => previewSource(source.id));
      card.append(top, preview);
      return card;
    }),
  );
  stats();
}

function attachSource(source) {
  if (
    sources.some(
      (s) =>
        s.blocks.map((b) => b.text).join("\n") ===
        source.blocks.map((b) => b.text).join("\n"),
    )
  )
    throw new Error("This text is already in the source collection.");
  sources = validateSources([...sources, source]);
  changed();
  renderSources();
}

async function addFiles(files) {
  if (reading)
    return toast("Please wait for the current files to finish reading.");
  const fileList = [...files];
  if (!fileList.length) return;
  reading = true;
  const current = ++readingEpoch;
  $("files").disabled = true;
  $("generate-button").disabled = true;
  $("source-errors").replaceChildren();
  $("source-errors").hidden = true;
  let count = 0;
  try {
    for (const file of fileList) {
      if (current !== readingEpoch) break;
      $("file-status").textContent = `Reading ${file.name}…`;
      try {
        if (sources.length >= 8)
          throw new Error("Use up to 8 sources per batch.");
        const source = await readDocument(file, uid());
        if (current !== readingEpoch) break;
        attachSource(source);
        count++;
      } catch (error) {
        if (current !== readingEpoch) break;
        $("source-errors").append(
          el("p", "", `${file.name}: ${error.message}`),
        );
        $("source-errors").hidden = false;
      }
    }
    if (current === readingEpoch)
      $("file-status").textContent =
        `${count} file${count === 1 ? "" : "s"} added. Preview the extracted text before generating.`;
  } finally {
    if (current === readingEpoch) {
      reading = false;
      $("files").disabled = false;
      $("files").value = "";
      $("generate-button").disabled = generating;
    }
  }
}

function field(card, label, tag, value, onChange, options = {}) {
  const id = `field-${crypto.randomUUID()}`;
  const text = el("label", "", label);
  text.htmlFor = id;
  const input = el(tag, options.className || "");
  input.id = id;
  if (tag === "select")
    for (const item of options.choices) {
      const option = el("option", "", item.label ?? item);
      option.value = item.value ?? item;
      input.append(option);
    }
  if (options.rows) input.rows = options.rows;
  if (options.maxLength) input.maxLength = options.maxLength;
  input.value = value;
  input.addEventListener(tag === "select" ? "change" : "input", () =>
    onChange(input.value),
  );
  card.append(text, input);
  return input;
}

function renderTickets() {
  $("ticket-list").replaceChildren(
    ...tickets.map((ticket, index) => {
      const card = el(
        "article",
        `ticket-card panel${ticket.reviewed ? " reviewed" : ""}`,
      );
      card.dataset.id = ticket.id;
      const top = el("div", "ticket-top"),
        badges = el("div", "ticket-badges");
      const confidence = el(
        "span",
        "confidence-badge",
        ticket.reviewed
          ? "REVIEWED"
          : `${ticket.confidence.toUpperCase()} CONFIDENCE`,
      );
      const type = el("span", "type-badge", ticket.issueType.toUpperCase());
      badges.append(
        el(
          "span",
          "ticket-number",
          `DRAFT ${String(index + 1).padStart(2, "0")}`,
        ),
        type,
        confidence,
      );
      const selection = el("label", "selection-label", "Export");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selected.has(ticket.id);
      checkbox.setAttribute(
        "aria-label",
        `Select ticket ${index + 1} for export`,
      );
      checkbox.addEventListener("change", () => {
        checkbox.checked ? selected.add(ticket.id) : selected.delete(ticket.id);
        stats();
      });
      selection.prepend(checkbox);
      top.append(badges, selection);
      card.append(top);
      let reviewBox;
      const update = (key, value) => {
        ticket[key] = value;
        ticket.reviewed = false;
        dirty = true;
        confidence.textContent = `${ticket.confidence.toUpperCase()} CONFIDENCE`;
        card.classList.remove("reviewed");
        if (reviewBox) reviewBox.checked = false;
        $("export-error").hidden = true;
        stats();
      };
      field(
        card,
        "Summary",
        "input",
        ticket.title,
        (value) => update("title", value),
        { className: "ticket-title", maxLength: 255 },
      );
      const settings = el("div", "ticket-settings");
      const typeGroup = el("div"),
        priorityGroup = el("div"),
        pointGroup = el("div");
      field(
        typeGroup,
        "Issue type",
        "select",
        ticket.issueType,
        (value) => {
          update("issueType", value);
          type.textContent = value.toUpperCase();
        },
        { choices: ["Story", "Task", "Bug"] },
      );
      field(
        priorityGroup,
        "Priority",
        "select",
        ticket.priority,
        (value) => update("priority", value),
        { choices: ["Highest", "High", "Medium", "Low", "Lowest"] },
      );
      field(
        pointGroup,
        "Suggested points",
        "select",
        ticket.points ?? "",
        (value) => {
          const points = value === "" ? null : Number(value);
          const original = ticket.originalPoints;
          update("points", points);
          ticket.pointOverride =
            points !== original
              ? `Team override: ${points ?? "unestimated"} (original suggestion: ${original ?? "unestimated"}).`
              : "";
        },
        {
          choices: [
            { value: "", label: "Unestimated" },
            ...POINTS.map((value) => ({
              value: String(value),
              label: `${value} points`,
            })),
          ],
        },
      );
      settings.append(typeGroup, priorityGroup, pointGroup);
      card.append(settings);
      field(
        card,
        "Description / requested outcome",
        "textarea",
        ticket.description,
        (value) => update("description", value),
        { rows: 3, maxLength: 6000 },
      );
      field(
        card,
        "Acceptance criteria — one per line",
        "textarea",
        ticket.criteria.join("\n"),
        (value) =>
          update(
            "criteria",
            value
              .split("\n")
              .map((x) => x.trim())
              .filter(Boolean),
          ),
        { className: "criteria-input", rows: 3, maxLength: 12000 },
      );
      const evidence = el("section", "evidence");
      evidence.append(el("h3", "", "Grounded in your sources"));
      for (const ref of ticket.evidence) {
        const source = batchSources.find((s) => s.id === ref.sourceId);
        const item = el("div", "evidence-entry");
        const link = el(
          "button",
          "text-button",
          `${source?.name || "Source"}${ref.page ? ` · page ${ref.page}` : ""} · ${ref.blockId} →`,
        );
        link.type = "button";
        link.addEventListener("click", () =>
          previewSource(ref.sourceId, ref.blockId, batchSources),
        );
        item.append(link, el("blockquote", "", ref.quote));
        evidence.append(item);
      }
      card.append(evidence);
      const details = el("details", "refinement");
      details.append(
        el("summary", "", "Estimate rationale & refinement questions"),
      );
      field(
        details,
        "Why this estimate?",
        "textarea",
        ticket.rationale,
        (value) => update("rationale", value),
        { rows: 4, maxLength: 3000 },
      );
      field(
        details,
        "Questions for your team — one per line",
        "textarea",
        ticket.questions.join("\n"),
        (value) =>
          update(
            "questions",
            value
              .split("\n")
              .map((x) => x.trim())
              .filter(Boolean),
          ),
        { rows: 3, maxLength: 10000 },
      );
      if (ticket.split)
        details.append(
          el(
            "p",
            "split-note",
            "Consider splitting this work into smaller, independently testable tickets before committing to an estimate.",
          ),
        );
      card.append(details);
      const bottom = el("div", "ticket-bottom"),
        reviewLabel = el("label", "review-label", "Reviewed with the source");
      reviewBox = document.createElement("input");
      reviewBox.type = "checkbox";
      reviewBox.checked = ticket.reviewed;
      reviewBox.addEventListener("change", () => {
        ticket.reviewed = reviewBox.checked;
        dirty = true;
        card.classList.toggle("reviewed", ticket.reviewed);
        confidence.textContent = ticket.reviewed
          ? "REVIEWED"
          : `${ticket.confidence.toUpperCase()} CONFIDENCE`;
        stats();
      });
      reviewLabel.prepend(reviewBox);
      const remove = el("button", "text-button remove-ticket", "Remove draft");
      remove.type = "button";
      remove.addEventListener("click", () => {
        tickets = tickets.filter((t) => t.id !== ticket.id);
        selected.delete(ticket.id);
        dirty = true;
        renderTickets();
        stats();
        $("no-results").hidden = tickets.length > 0;
      });
      bottom.append(reviewLabel, remove);
      card.append(bottom);
      return card;
    }),
  );
  stats();
}

function selectedTickets() {
  const result = tickets
    .filter((ticket) => selected.has(ticket.id))
    .map((ticket) =>
      validateTicket(
        {
          ...ticket,
          rationale:
            ticket.rationale +
            (ticket.pointOverride ? `\n${ticket.pointOverride}` : ""),
        },
        batchSources,
      ),
    );
  if (!result.length) throw new Error("Select at least one ticket to export.");
  return result;
}
function download(contents, filename, mime) {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function exportBatch(action) {
  try {
    const selected = selectedTickets();
    $("export-error").hidden = true;
    await action(selected);
  } catch (error) {
    $("export-error").textContent = error.message;
    $("export-error").hidden = false;
  }
}

async function generate() {
  if (reading || generating || !confirmReplace()) return;
  let validated;
  try {
    if ($("notes").value.trim()) {
      attachSource(
        notesSource(
          $("notes").value,
          $("note-name").value.trim() || `Pasted notes ${sources.length + 1}`,
          uid(),
        ),
      );
      $("notes").value = "";
      $("note-name").value = "";
    }
    validated = validateSources(sources);
  } catch (error) {
    $("generation-error").textContent = error.message;
    $("generation-error").hidden = false;
    return;
  }
  const current = ++epoch,
    startRevision = revision;
  const baseline = Number($("baseline").value),
    context = $("context").value;
  $("generation-error").hidden = true;
  $("export-error").hidden = true;
  setBusy(true);
  controller = new AbortController();
  try {
    let result;
    if ($("mode").value === "ai") {
      const response = await fetch(new URL("./api/generate", import.meta.url), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Intake-Key": $("access-key").value,
        },
        body: JSON.stringify({ sources: validated, baseline, context }),
        signal: controller.signal,
      });
      result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not generate this batch.");
    } else {
      result = planDocuments(validated, { baseline, context });
    }
    if (current !== epoch || revision !== startRevision) return;
    batchSources = structuredClone(validated);
    tickets = result.tickets.map((ticket) => ({
      ...validateTicket(ticket, batchSources),
      originalPoints: ticket.points,
      pointOverride: "",
    }));
    selected = new Set(tickets.map((t) => t.id));
    dirty = false;
    batchRevision = startRevision;
    $("empty-state").hidden = true;
    $("no-results").hidden = tickets.length > 0;
    $("warnings").replaceChildren(
      ...result.warnings.map((message) => el("p", "", message)),
    );
    $("warnings").hidden = !result.warnings.length;
    $("stale-banner").hidden = true;
    renderTickets();
    if (matchMedia("(max-width: 680px)").matches)
      $("results-heading").scrollIntoView({
        block: "start",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
  } catch (error) {
    if (error.name === "AbortError" || current !== epoch) return;
    $("generation-error").textContent =
      error instanceof TypeError
        ? "Could not reach the server. Check the service and try again, or choose local drafting."
        : error.message;
    $("generation-error").hidden = false;
    if (batchRevision < 0) $("empty-state").hidden = false;
  } finally {
    if (current === epoch) {
      controller = null;
      setBusy(false);
    }
  }
}

$("files").addEventListener("change", () => addFiles($("files").files));
for (const name of ["dragenter", "dragover"])
  $("drop-zone").addEventListener(name, (event) => {
    event.preventDefault();
    $("drop-zone").classList.add("dragover");
  });
for (const name of ["dragleave", "drop"])
  $("drop-zone").addEventListener(name, (event) => {
    event.preventDefault();
    $("drop-zone").classList.remove("dragover");
  });
$("drop-zone").addEventListener("drop", (event) =>
  addFiles(event.dataTransfer.files),
);
$("add-notes").addEventListener("click", () => {
  try {
    attachSource(
      notesSource(
        $("notes").value,
        $("note-name").value.trim() || `Pasted notes ${sources.length + 1}`,
        uid(),
      ),
    );
    $("notes").value = "";
    $("note-name").value = "";
    $("source-errors").hidden = true;
    toast("Notes added. You can add more sources before generating.");
  } catch (error) {
    $("source-errors").textContent = error.message;
    $("source-errors").hidden = false;
  }
});
for (const id of ["context", "baseline", "notes"])
  $(id).addEventListener("input", changed);
$("mode").addEventListener("change", () => {
  changed();
  const ai = $("mode").value === "ai";
  $("access-key-wrap").hidden = !ai || !server.requiresAccessKey;
  $("mode-help").textContent = ai
    ? "Generating sends all extracted source text and project context to your server and OpenAI. API usage is billed to the server’s key. Review sensitive content first."
    : "Local mode looks for explicit action items. Use the original sources to check for missed or related work.";
});
$("generate-button").addEventListener("click", generate);

function samplePack() {
  if (!confirmReplace()) return;
  sources = [
    notesSource(
      "Sprint planning notes\nAction: Add a project filter to the work dashboard.\nThe filter must list only projects the signed-in user can access.\nSelecting a project should show only that project’s tasks.\nAction: Fix CSV export when customer names contain commas.\nNames containing quotes or line breaks must remain in a single field.\nAction: Investigate connecting the support inbox to the CRM.\nDecision: The full dashboard redesign is out of scope.",
      "Sprint planning notes",
      "sample-meeting",
    ),
    notesSource(
      "Product follow-up summary\nAdd a project filter to the work dashboard.\nThe filter should be usable with a keyboard.\nAction: Add a confirmation message after a report is downloaded.\nThe message should confirm the filename and report date.",
      "Product follow-up summary",
      "sample-summary",
    ),
  ];
  $("context").value =
    "A project-management dashboard for team leads and reporting analysts.";
  changed();
  renderSources();
  dirty = false;
  generate();
}
$("sample-button").addEventListener("click", samplePack);
$("empty-sample").addEventListener("click", samplePack);
$("reset-button").addEventListener("click", () => {
  if (
    (sources.length || tickets.length || $("notes").value) &&
    !window.confirm(
      "Clear all sources, extracted text, and ticket drafts from this workspace?",
    )
  )
    return;
  epoch++;
  readingEpoch++;
  controller?.abort();
  reading = false;
  setBusy(false);
  sources = [];
  tickets = [];
  batchSources = [];
  selected = new Set();
  dirty = false;
  revision = 0;
  batchRevision = -1;
  for (const id of ["notes", "note-name", "context", "access-key", "files"])
    $(id).value = "";
  $("files").disabled = false;
  $("file-status").textContent =
    "Up to 8 sources and 100 pages per PDF. Scanned PDFs need OCR.";
  for (const id of [
    "source-errors",
    "generation-error",
    "warnings",
    "export-error",
    "stale-banner",
    "no-results",
  ])
    $(id).hidden = true;
  $("empty-state").hidden = false;
  renderSources();
  renderTickets();
  toast("Workspace cleared.");
});
$("csv-button").addEventListener("click", () =>
  exportBatch((tickets) => {
    download(
      jiraCsv(tickets, batchSources),
      "jira-ticket-drafts.csv",
      "text/csv;charset=utf-8",
    );
    toast("CSV downloaded. Review the Jira field mapping before importing.");
  }),
);
$("json-button").addEventListener("click", () =>
  exportBatch((tickets) => {
    const referenced = batchSources
      .map((source) => ({
        ...source,
        blocks: source.blocks.filter((block) =>
          tickets.some((ticket) =>
            ticket.evidence.some(
              (ref) => ref.sourceId === source.id && ref.blockId === block.id,
            ),
          ),
        ),
      }))
      .filter((source) => source.blocks.length);
    download(
      JSON.stringify({ version: 2, tickets, sources: referenced }, null, 2),
      "jira-ticket-drafts.json",
      "application/json",
    );
    toast("JSON downloaded, including selected tickets’ source excerpts.");
  }),
);
$("copy-button").addEventListener("click", () =>
  exportBatch(async (tickets) => {
    const text = tickets
      .map((t) => ticketText(t, batchSources))
      .join("\n\n---\n\n");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Unavailable");
      await navigator.clipboard.writeText(text);
      toast("Selected ticket drafts copied.");
    } catch {
      download(text, "jira-ticket-drafts.md", "text/markdown;charset=utf-8");
      toast("Clipboard unavailable. Downloaded the ticket text instead.");
    }
  }),
);
$("help-button").addEventListener("click", () => $("help-dialog").showModal());
$("close-help").addEventListener("click", () => $("help-dialog").close());
$("close-source").addEventListener("click", () => $("source-dialog").close());
window.addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});

if (document.querySelector('meta[name="triage-backend"]')?.content !== "none") {
  try {
    const response = await fetch(new URL("./api/status", import.meta.url));
    if (response.ok) server = await response.json();
  } catch {
    /* File reading and local drafting remain available without a server. */
  }
}
if (server.aiAvailable) {
  const option = $("mode").querySelector('[value="ai"]');
  option.disabled = false;
  option.textContent = `AI drafting — ${server.model}`;
} else {
  $("mode-help").textContent +=
    " Optional AI mode needs a server configured with AI_API_KEY and a workspace access key.";
}
stats();
