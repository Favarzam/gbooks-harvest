import {
  cleanSnippet,
  cmpCodePoints,
  isoformat,
  parseYear,
  pyDumps,
  pyStr,
  writeCsv,
} from "./pyformat.js";

export const API_URL = "https://www.googleapis.com/books/v1/volumes";
export const PAGE_SIZE = 40;

export const CSV_FIELDS = [
  "volume_id",
  "title",
  "subtitle",
  "authors",
  "publisher",
  "published_date_raw",
  "year",
  "print_type",
  "language",
  "page_count",
  "categories",
  "identifiers",
  "viewability",
  "public_domain",
  "pdf_available",
  "epub_available",
  "text_snippet",
  "preview_link",
  "info_link",
  "found_by",
];

export class QuotaExceeded extends Error {
  constructor(message) {
    super(message);
    this.name = "QuotaExceeded";
  }
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function queryText(cfg) {
  if (cfg.exact_phrase && !cfg.query.startsWith('"')) return `"${cfg.query}"`;
  return cfg.query;
}

export function variants(cfg) {
  const out = [];
  for (const filter of cfg.filters) {
    for (const printType of cfg.print_types) {
      for (const orderBy of cfg.order_by) {
        out.push({ filter, printType, orderBy });
      }
    }
  }
  return out;
}

export function variantLabel(variant) {
  return Object.entries(variant)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}-${value}`)
    .join("_") || "default";
}

export function inRange(cfg, year) {
  if (year === null || year === undefined) return false;
  if (cfg.start_year != null && year < cfg.start_year) return false;
  if (cfg.end_year != null && year > cfg.end_year) return false;
  return true;
}

export function hasRange(cfg) {
  return cfg.start_year != null || cfg.end_year != null;
}

export function flatten(item) {
  const v = item.volumeInfo || {};
  const a = item.accessInfo || {};
  const ids = new Map();
  for (const ident of v.industryIdentifiers || []) {
    ids.set(ident.type ?? null, ident.identifier ?? null);
  }
  const identifiers = [...ids.entries()]
    .map(([key, val]) => `${pyStr(key)}:${pyStr(val)}`)
    .join("; ");
  return {
    volume_id: item.id ?? "",
    title: v.title ?? "",
    subtitle: v.subtitle ?? "",
    authors: (v.authors || []).join("; "),
    publisher: v.publisher ?? "",
    published_date_raw: v.publishedDate ?? "",
    year: parseYear(v.publishedDate),
    print_type: v.printType ?? "",
    language: v.language ?? "",
    page_count: v.pageCount ?? "",
    categories: (v.categories || []).join("; "),
    identifiers,
    viewability: a.viewability ?? "",
    public_domain: a.publicDomain ?? "",
    pdf_available: a.pdf?.isAvailable ?? "",
    epub_available: a.epub?.isAvailable ?? "",
    text_snippet: cleanSnippet(item.searchInfo?.textSnippet),
    preview_link: v.previewLink ?? "",
    info_link: v.infoLink ?? "",
  };
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const err = new Error("The harvest was stopped.");
    err.name = "AbortError";
    throw err;
  }
}

function sliceText(text, n) {
  return Array.from(text).slice(0, n).join("");
}

export async function getPage(fetchPage, params, { retries = 5, sleep, signal } = {}) {
  let lastStatus = null;
  let lastText = "";
  for (let attempt = 0; attempt < retries; attempt += 1) {
    throwIfAborted(signal);
    let result;
    try {
      result = await fetchPage(params, signal);
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      lastStatus = 0;
      lastText = String(err?.message || err);
      await sleep(2 ** attempt);
      continue;
    }
    const { status, text, source } = result;
    lastStatus = status;
    lastText = text;
    if (status === 200) return { data: JSON.parse(text), raw: text };
    if (source === "proxy" && status !== 502 && status !== 504) {
      let message = text;
      try {
        const parsed = JSON.parse(text);
        if (parsed && parsed.error) message = parsed.error;
      } catch {
        // keep body text
      }
      throw new HttpError(status, message);
    }
    if (status === 403 && /limit|quota/i.test(text)) {
      throw new QuotaExceeded(sliceText(text, 300));
    }
    if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
      await sleep(2 ** attempt);
      continue;
    }
    throw new HttpError(status, sliceText(text, 300));
  }
  if (lastStatus === 429) {
    throw new QuotaExceeded("Rate limit still exceeded after retries.");
  }
  throw new Error(`Request failed after ${retries} retries (last status ${lastStatus}).`);
}

async function runVariant(fetchPage, cfg, variant, files, { sleep, signal, onEvent }) {
  const params = { q: queryText(cfg), maxResults: PAGE_SIZE };
  if (cfg.lang) params.langRestrict = cfg.lang;
  Object.assign(params, Object.fromEntries(Object.entries(variant).filter(([, value]) => value)));

  const label = variantLabel(variant);
  const items = [];
  let reportedTotal = null;
  let requestsMade = 0;

  for (let page = 0; page < cfg.max_pages; page += 1) {
    params.startIndex = page * PAGE_SIZE;
    onEvent?.({ type: "page", label, page, requestsMade });
    const { data } = await getPage(fetchPage, params, { sleep, signal });
    requestsMade += 1;
    if (cfg.save_raw) {
      files.set(`raw_responses/${label}_p${String(page).padStart(3, "0")}.json`, pyDumps(data));
    }
    if (reportedTotal === null && Object.prototype.hasOwnProperty.call(data, "totalItems")) {
      reportedTotal = data.totalItems;
    }
    const batch = data.items || [];
    if (!batch.length) break;
    items.push(...batch);
    onEvent?.({ type: "batch", label, page, retrieved: items.length, reportedTotal, requestsMade });
    await sleep(cfg.sleep);
  }
  return { label, items, reportedTotal, requestsMade };
}

export async function harvest(cfg, { fetchPage, sleep, now, log, signal, onEvent } = {}) {
  const files = new Map();
  const started = isoformat(now());
  const merged = new Map();
  const foundBy = new Map();
  const variantLog = [];
  let totalHits = 0;
  let totalRequests = 0;
  let stoppedEarly = null;

  for (const variant of variants(cfg)) {
    const label = variantLabel(variant);
    onEvent?.({ type: "variant-start", label, variant });
    try {
      const result = await runVariant(fetchPage, cfg, variant, files, { sleep, signal, onEvent });
      totalHits += result.items.length;
      totalRequests += result.requestsMade;
      variantLog.push({
        variant: result.label,
        retrieved: result.items.length,
        api_totalItems: result.reportedTotal,
        requests: result.requestsMade,
      });
      log?.(`${result.label}: ${result.items.length} items (API reported totalItems=${result.reportedTotal})`);
      onEvent?.({ type: "variant-done", ...result });
      for (const item of result.items) {
        const vid = item.id;
        if (!vid) continue;
        if (!merged.has(vid)) merged.set(vid, item);
        if (!foundBy.has(vid)) foundBy.set(vid, []);
        foundBy.get(vid).push(result.label);
      }
    } catch (err) {
      if (err instanceof QuotaExceeded) {
        stoppedEarly = `Quota exceeded during variant ${label}: ${err.message}`;
        log?.(stoppedEarly);
        onEvent?.({ type: "stopped", reason: stoppedEarly });
        break;
      }
      if (err?.name === "AbortError") {
        stoppedEarly = "Stopped by user.";
        log?.(stoppedEarly);
        onEvent?.({ type: "stopped", reason: stoppedEarly });
        break;
      }
      throw err;
    }
  }

  const rows = [];
  for (const [vid, item] of merged) {
    const row = flatten(item);
    row.found_by = foundBy.get(vid).join("; ");
    rows.push(row);
  }

  let noDate;
  let outRange;
  let included;
  if (hasRange(cfg)) {
    noDate = rows.filter((row) => row.year === null);
    outRange = rows.filter((row) => row.year !== null && !inRange(cfg, row.year));
    included = rows.filter((row) => inRange(cfg, row.year));
  } else {
    noDate = [];
    outRange = [];
    included = rows;
  }
  included.sort((a, b) => {
    const yearA = a.year || 0;
    const yearB = b.year || 0;
    if (yearA !== yearB) return yearA - yearB;
    return cmpCodePoints(a.title, b.title);
  });

  files.set("records.csv", writeCsv(included, CSV_FIELDS));
  files.set("all_merged.csv", writeCsv(rows, CSV_FIELDS));
  if (hasRange(cfg)) {
    files.set("excluded_out_of_range.csv", writeCsv(outRange, CSV_FIELDS));
    files.set("excluded_no_date.csv", writeCsv(noDate, CSV_FIELDS));
  }

  const viewCounts = {};
  for (const row of included) {
    const key = row.viewability || "MISSING";
    viewCounts[key] = (viewCounts[key] || 0) + 1;
  }

  const counts = {
    identification: {
      records_retrieved_all_variants: totalHits,
      duplicates_removed: totalHits - rows.length,
      unique_records: rows.length,
    },
    screening_by_year: hasRange(cfg)
      ? {
          excluded_outside_range: outRange.length,
          excluded_no_date: noDate.length,
          retained: included.length,
        }
      : "not applied (no year range given)",
    retained_by_viewability: viewCounts,
  };
  const metadata = {
    tool: "gbooks-harvest",
    run_started_utc: started,
    run_finished_utc: isoformat(now()),
    api_endpoint: API_URL,
    query_sent: queryText(cfg),
    language_restriction: cfg.lang,
    year_range: [cfg.start_year ?? null, cfg.end_year ?? null],
    max_pages_per_variant: cfg.max_pages,
    total_api_requests: totalRequests,
    stopped_early: stoppedEarly,
    variants: variantLog,
  };
  files.set("prisma_counts.json", pyDumps(counts, 2));
  files.set("run_metadata.json", pyDumps(metadata, 2));
  return { files, counts, metadata, included, rows };
}

export function defaultSleep(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}
