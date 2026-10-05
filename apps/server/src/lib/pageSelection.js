// Parses and validates a customer's page selection for one file.
//
// The customer types a compact spec like "2-4, 7" or "1,3,5" — 1-based
// page numbers exactly as shown in any PDF viewer. An empty/missing spec
// means "all pages" (the previous default behaviour).
//
// Returns { pages: [...] } (1-based, de-duplicated, in first-occurrence
// order) on success, or { error: "human-readable reason" } on failure.

const MAX_PAGES_PER_FILE = 2000; // sanity guard before multiplying by copies

function range(from, to) {
  const out = [];
  for (let i = from; i <= to; i += 1) out.push(i);
  return out;
}

export function parsePageSpec(spec, totalPages) {
  if (!Number.isInteger(totalPages) || totalPages < 1) {
    return { error: "could not read this PDF" };
  }

  const text = spec === undefined || spec === null ? "" : String(spec).trim();
  if (text === "") {
    return { pages: range(1, totalPages) };
  }

  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { pages: range(1, totalPages) };
  }

  const pages = [];
  const seen = new Set();
  for (const part of parts) {
    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    let lo;
    let hi;
    if (rangeMatch) {
      lo = Number(rangeMatch[1]);
      hi = Number(rangeMatch[2]);
    } else if (/^\d+$/.test(part)) {
      lo = hi = Number(part);
    } else {
      return { error: `invalid page selection "${part}" — use numbers like 2-4, 7` };
    }

    if (lo > hi) {
      return { error: `invalid page range "${part}" (start is after end)` };
    }
    if (lo < 1) {
      return { error: "page numbers start at 1" };
    }
    if (hi > totalPages) {
      return {
        error: `page ${hi} doesn't exist — this file has ${totalPages} page${totalPages === 1 ? "" : "s"}`,
      };
    }

    for (let p = lo; p <= hi; p += 1) {
      if (!seen.has(p)) {
        seen.add(p);
        pages.push(p);
      }
    }
  }

  if (pages.length === 0) {
    return { error: "no pages selected" };
  }
  if (pages.length > MAX_PAGES_PER_FILE) {
    return { error: "too many pages selected for one file" };
  }
  return { pages };
}
