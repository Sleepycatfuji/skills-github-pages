export const POINTS = [1, 2, 3, 5, 8, 13];
export const SOURCE_LIMIT = 8;
export const TEXT_LIMIT = 120000;
export const TICKET_LIMIT = 20;
export const ISSUE_TYPES = ["Story", "Task", "Bug"];
export const PRIORITIES = ["Highest", "High", "Medium", "Low", "Lowest"];

export function validateSources(sources) {
  if (!Array.isArray(sources) || !sources.length)
    throw new Error("Add a document or some notes first.");
  if (sources.length > SOURCE_LIMIT)
    throw new Error(`Use up to ${SOURCE_LIMIT} sources per batch.`);
  const ids = new Set();
  let total = 0;
  return sources.map((source) => {
    if (
      !source ||
      typeof source.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(source.id) ||
      ids.has(source.id)
    )
      throw new Error("Every source needs a unique identifier.");
    ids.add(source.id);
    if (
      typeof source.name !== "string" ||
      !source.name.trim() ||
      source.name.length > 200
    )
      throw new Error("Every source needs a name of 200 characters or fewer.");
    if (
      !Array.isArray(source.blocks) ||
      !source.blocks.length ||
      source.blocks.length > 3000
    )
      throw new Error("A source must contain readable text.");
    const blockIds = new Set();
    const blocks = source.blocks.map((block) => {
      if (
        !block ||
        typeof block.id !== "string" ||
        !/^[A-Za-z0-9_-]{1,80}$/.test(block.id) ||
        blockIds.has(block.id)
      )
        throw new Error("Source text needs unique block references.");
      blockIds.add(block.id);
      if (
        typeof block.text !== "string" ||
        !block.text.trim() ||
        block.text.length > 20000
      )
        throw new Error("A source text block is empty or too large.");
      if (
        block.page !== null &&
        (!Number.isInteger(block.page) || block.page < 1 || block.page > 100)
      )
        throw new Error("Invalid source page reference.");
      total += block.text.length;
      if (total > TEXT_LIMIT)
        throw new Error(
          `This batch exceeds ${TEXT_LIMIT.toLocaleString("en-US")} characters. Use a smaller document or excerpt.`,
        );
      return { id: block.id, page: block.page, text: block.text.trim() };
    });
    return {
      id: source.id,
      name: source.name.trim(),
      kind: source.kind || "Text",
      blocks,
    };
  });
}

export function notesSource(text, name = "Meeting notes", id = "notes") {
  if (typeof text !== "string" || !text.trim())
    throw new Error("Paste some notes first.");
  const blocks = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const chunks = [];
      for (let i = 0; i < line.length; i += 10000)
        chunks.push(line.slice(i, i + 10000));
      return chunks;
    })
    .map((line, index) => ({ id: `b${index + 1}`, page: null, text: line }));
  return validateSources([{ id, name, kind: "Notes", blocks }])[0];
}

function cleanAction(text) {
  return text
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
    .replace(
      /^(?:action(?: item)?|requirement|feature|bug|task|ticket|todo|decision)\s*[:—-]\s*/i,
      "",
    )
    .replace(/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s*:\s*/, "")
    .replace(/^(?:we|the team)\s+(?:need to|should|will|must)\s+/i, "")
    .trim();
}

function canonical(text) {
  return new Set(
    cleanAction(text)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(
        (word) =>
          word.length > 2 &&
          ![
            "the",
            "and",
            "for",
            "with",
            "that",
            "this",
            "from",
            "our",
            "into",
            "should",
            "must",
            "need",
          ].includes(word),
      ),
  );
}

function similar(a, b) {
  const aa = canonical(a),
    bb = canonical(b);
  if (!aa.size || !bb.size) return a.toLowerCase() === b.toLowerCase();
  const overlap = [...aa].filter((word) => bb.has(word)).length;
  return overlap / new Set([...aa, ...bb]).size >= 0.82;
}

function sizing(text, baseline) {
  if (
    /\b(research|investigate|discover|spike|explore|redesign|rebuild|entire platform|all systems|make .+ smarter|improve (?:the )?(?:experience|ux))\b/i.test(
      text,
    )
  ) {
    return {
      points: null,
      split: /redesign|rebuild|entire|all systems/i.test(text),
      rationale:
        "The source describes discovery, broad scope, or an unclear outcome. Refine or split it before assigning points.",
      questions: [
        "What is the smallest testable outcome, and which unknowns need investigation first?",
      ],
    };
  }
  let score = baseline;
  const reasons = [
    `Starting from your ${baseline}-point reference for a small, familiar change.`,
  ];
  if (
    /\b(integrat\w*|connect .+ (?:to|with)|sync\w*|third.party|webhook|external api)\b/i.test(
      text,
    )
  ) {
    score += 3;
    reasons.push("+3 sizing weight for integration or cross-system work.");
  }
  if (/\b(migrat\w*|schema|database|historical data)\b/i.test(text)) {
    score += 3;
    reasons.push("+3 sizing weight for data changes or migration.");
  }
  if (
    /\b(oauth|authentication|encrypt\w*|role.based|permission\w*|security)\b/i.test(
      text,
    )
  ) {
    score += 2;
    reasons.push("+2 sizing weight for access or security concerns.");
  }
  if (/\b(multiple|across all|end.to.end|regression)\b/i.test(text)) {
    score += 2;
    reasons.push("+2 sizing weight for wider implementation or test coverage.");
  }
  const points = POINTS.find((value) => value >= score) ?? null;
  reasons.push(
    points === null
      ? "This exceeds the supported scale; split it before sizing."
      : `Rounded up to ${points} on the Fibonacci scale.`,
  );
  reasons.push(
    "This is a low-confidence rule-based suggestion, not measured effort or an hours conversion. Confirm against your team’s completed stories.",
  );
  return {
    points,
    split: score > 8,
    rationale: reasons.join("\n"),
    questions: [
      "Confirm implementation scope, dependencies, and regression checks with the team.",
    ],
  };
}

export function planDocuments(rawSources, { baseline = 2, context = "" } = {}) {
  const sources = validateSources(rawSources);
  if (![1, 2, 3].includes(baseline))
    throw new Error("Choose a 1, 2, or 3 point reference.");
  if (typeof context !== "string" || context.length > 2000)
    throw new Error("Project context must be 2,000 characters or fewer.");
  const candidates = [];
  const warnings = [];
  for (const source of sources) {
    let current = null;
    for (const block of source.blocks) {
      for (const statement of block.text
        .split(/(?<=[.!?])\s+/)
        .map((x) => x.trim())
        .filter(Boolean)) {
        if (
          /\b(?:out of scope|not in scope|deferred|parking lot|do not implement|don’t implement|don't implement|decided not to|not going to|will not build|won't build)\b/i.test(
            statement,
          )
        ) {
          current = null;
          continue;
        }
        const cleaned = cleanAction(statement);
        const explicit =
          /^(?:[-*•]\s*)?(?:action(?: item)?|requirement|feature|bug|task|ticket|todo)\s*[:—-]/i.test(
            statement,
          );
        const action =
          /^(?:add|build|create|implement|enable|allow|support|fix|resolve|improve|remove|replace|automate|integrate|connect|migrate|investigate|research|update|export|validate|send|display|show|prevent)\b/i.test(
            cleaned,
          );
        const reference = {
          sourceId: source.id,
          blockId: block.id,
          page: block.page,
          quote: statement.slice(0, 4000),
        };
        if ((explicit && cleaned.length > 8) || action) {
          const existing = candidates.find((candidate) =>
            similar(candidate.action, cleaned),
          );
          if (existing) {
            if (
              !existing.evidence.some(
                (e) =>
                  e.sourceId === reference.sourceId &&
                  e.blockId === reference.blockId &&
                  e.quote === reference.quote,
              )
            )
              existing.evidence.push(reference);
            current = existing;
          } else {
            current = { action: cleaned, criteria: [], evidence: [reference] };
            candidates.push(current);
          }
        } else if (
          current &&
          /\b(must|should|expected|acceptance|only|when|ensure)\b/i.test(
            statement,
          )
        ) {
          current.criteria.push(statement.replace(/^[-*•]\s*/, ""));
          current.evidence.push(reference);
        }
      }
    }
  }
  if (candidates.length > TICKET_LIMIT)
    warnings.push(
      `Found ${candidates.length} possible actions. Showing the first ${TICKET_LIMIT}; split the source batch to review the rest.`,
    );
  if (!candidates.length)
    warnings.push(
      "No explicit deliverable actions were found. Add clearer action items, or use AI drafting for unstructured material.",
    );
  warnings.push(
    "Local drafting recognizes explicit actions and common complexity signals. Review the original material for missed work or related actions that should be combined.",
  );
  const tickets = candidates.slice(0, TICKET_LIMIT).map((candidate, index) => {
    const estimate = sizing(
      [candidate.action, ...candidate.criteria].join(" "),
      baseline,
    );
    const type = /\b(fix|bug|broken|error|incorrect|regression)\b/i.test(
      candidate.action,
    )
      ? "Bug"
      : /\b(research|investigate|migrate|update documentation)\b/i.test(
            candidate.action,
          )
        ? "Task"
        : "Story";
    const criteria = candidate.criteria.length
      ? [...new Set(candidate.criteria)]
          .slice(0, 12)
          .map((c) => c.slice(0, 1500))
      : [
          `[Confirm a testable acceptance criterion for: ${candidate.action.slice(0, 1200)}]`,
        ];
    const questions = [...estimate.questions];
    if (!candidate.criteria.length)
      questions.push(
        "What observable result and edge cases define acceptance?",
      );
    if (
      candidate.criteria.length > 12 ||
      candidate.criteria.some((c) => c.length > 1500) ||
      candidate.action.length > 3500
    )
      warnings.push(
        `Draft ${index + 1} summarizes a long source passage. Review its full source for omitted detail.`,
      );
    return {
      id: `ticket-${index + 1}`,
      title:
        candidate.action[0].toUpperCase() +
        candidate.action
          .slice(1)
          .replace(/[.!?]$/, "")
          .slice(0, 179),
      issueType: type,
      priority: "Medium",
      points: estimate.points,
      confidence: "Low",
      split: estimate.split,
      description: `${candidate.action.slice(0, 3500)}${context.trim() ? `\n\nProject context supplied by you:\n${context.trim()}` : ""}`,
      criteria,
      questions,
      rationale: estimate.rationale,
      evidence: candidate.evidence.slice(0, 30),
      reviewed: false,
    };
  });
  return { mode: "local", tickets, warnings };
}

export function validateTicket(ticket, rawSources) {
  const sources = validateSources(rawSources);
  if (!ticket || typeof ticket !== "object")
    throw new Error("Invalid ticket draft.");
  const str = (value, label, max) => {
    if (typeof value !== "string" || !value.trim() || value.length > max)
      throw new Error(`${label} is missing or too long.`);
    return value.trim();
  };
  const title = str(ticket.title, "Ticket title", 255);
  const description = str(ticket.description, "Ticket description", 6000);
  const rationale = str(ticket.rationale, "Estimate rationale", 3000);
  if (
    !ISSUE_TYPES.includes(ticket.issueType) ||
    !PRIORITIES.includes(ticket.priority)
  )
    throw new Error("Unsupported issue type or priority.");
  if (ticket.points !== null && !POINTS.includes(ticket.points))
    throw new Error("Points must be Fibonacci values or unestimated.");
  if (
    !Array.isArray(ticket.criteria) ||
    !ticket.criteria.length ||
    ticket.criteria.length > 12
  )
    throw new Error("Keep at least one acceptance criterion per ticket.");
  const criteria = ticket.criteria.map((value) =>
    str(value, "Acceptance criterion", 1500),
  );
  if (!Array.isArray(ticket.questions) || ticket.questions.length > 10)
    throw new Error("Invalid refinement questions.");
  const questions = ticket.questions.map((value) =>
    str(value, "Refinement question", 1000),
  );
  if (
    !Array.isArray(ticket.evidence) ||
    !ticket.evidence.length ||
    ticket.evidence.length > 30
  )
    throw new Error("Every ticket needs source evidence.");
  const evidence = ticket.evidence.map((ref) => {
    const source = sources.find((s) => s.id === ref.sourceId);
    const block = source?.blocks.find((b) => b.id === ref.blockId);
    if (
      !block ||
      typeof ref.quote !== "string" ||
      !ref.quote.trim() ||
      ref.quote.length > 4000 ||
      !block.text.includes(ref.quote)
    )
      throw new Error(
        "A ticket cites text that is not in the supplied source.",
      );
    return {
      sourceId: source.id,
      blockId: block.id,
      page: block.page,
      quote: ref.quote,
    };
  });
  return {
    ...ticket,
    title,
    description,
    rationale,
    criteria,
    questions,
    evidence,
  };
}

export function ticketText(ticket, sources) {
  const t = validateTicket(ticket, sources);
  const refs = t.evidence
    .map((ref) => {
      const source = sources.find((s) => s.id === ref.sourceId);
      return `- ${source.name}${ref.page ? `, page ${ref.page}` : ""} (${ref.blockId}): “${ref.quote}”`;
    })
    .join("\n");
  return `# ${t.title}\n\nType: ${t.issueType}\nPriority: ${t.priority}\n\n## Description\n${t.description}\n\n## Acceptance criteria\n${t.criteria.map((c) => `- ${c}`).join("\n")}\n\n## Provisional estimate\n${t.points === null ? "Unestimated — refine first." : `${t.points} story points — confirm with the team.`}\n${t.rationale}\n\n## Refinement questions\n${t.questions.length ? t.questions.map((q) => `- ${q}`).join("\n") : "None recorded; confirm with the team."}\n\n## Source evidence\n${refs}`;
}

export function jiraCsv(tickets, sources) {
  if (!Array.isArray(tickets) || !tickets.length)
    throw new Error("Select at least one ticket to export.");
  const cell = (value) => {
    let content = String(value ?? "");
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(content)) content = `'${content}`;
    return `"${content.replaceAll('"', '""')}"`;
  };
  const rows = [
    [
      "Summary",
      "Issue Type",
      "Description",
      "Priority",
      "Labels",
      "Story Points",
    ],
  ];
  for (const ticket of tickets) {
    const t = validateTicket(ticket, sources);
    rows.push([
      t.title,
      t.issueType,
      ticketText(t, sources),
      t.priority,
      "document-intake-review",
      t.points ?? "",
    ]);
  }
  return rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
