import { harvest, defaultSleep, variants } from "./harvest.js";
import { writeCsv } from "./pyformat.js";
import { downloadBlob, zipFiles } from "./zip.js";

const STORAGE = {
  access: "gbooks-harvest.access-code",
  key: "gbooks-harvest.user-key",
};

const form = document.getElementById("harvest-form");
const runBtn = document.getElementById("run");
const stopBtn = document.getElementById("stop");
const loading = document.getElementById("loading");
const runStatus = document.getElementById("run-status");
const results = document.getElementById("results");
const stoppedNote = document.getElementById("stopped-note");
const countsEl = document.getElementById("counts");
const previewGroups = document.getElementById("preview-groups");
const matchStatus = document.getElementById("match-status");
const resultTabs = document.getElementById("result-tabs");
const pager = document.getElementById("pager");
const variantCount = document.getElementById("variant-count");
const accessRow = document.getElementById("access-row");
const keyWarning = document.getElementById("key-warning");
const downloadTable = document.getElementById("download-table");
const downloadZip = document.getElementById("download-zip");
const downloadCsv = document.getElementById("download-csv");

const PAGE_SIZE = 10;

let controller = null;
let lastRun = null;
let browserKey = null;
let displayState = {
  query: "",
  tab: "All",
  page: 1,
  rows: [],
  expanded: new Set(),
};

document.getElementById("access-code").value = localStorage.getItem(STORAGE.access) || "";
document.getElementById("user-key").value = localStorage.getItem(STORAGE.key) || "";

form.addEventListener("input", updateVariantCount);
updateVariantCount();
loadStatus();

form.addEventListener("submit", (event) => {
  event.preventDefault();
  runHarvest();
});
stopBtn.addEventListener("click", () => controller?.abort());
downloadTable.addEventListener("click", saveTable);
downloadZip.addEventListener("click", saveZip);
downloadCsv.addEventListener("click", saveCsv);
window.addEventListener("beforeunload", (event) => {
  if (controller) event.preventDefault();
});

function checked(name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((el) => el.value);
}

function updateVariantCount() {
  const cfg = {
    filters: checked("filters"),
    print_types: checked("print-types"),
    order_by: checked("order-by"),
  };
  const n = variants(cfg).length;
  variantCount.textContent = n
    ? `${n} query variant${n === 1 ? "" : "s"} with the boxes currently checked.`
    : "Check at least one filter, print type, and sort order.";
}

async function loadStatus() {
  try {
    const headers = {};
    const access = document.getElementById("access-code").value.trim();
    if (access) headers["X-Access-Code"] = access;
    const res = await fetch("/api/status", { cache: "no-store", headers });
    const data = await res.json();
    accessRow.hidden = !data.accessCodeRequired;
    browserKey = data.browserKey || null;
    const hasKey = Boolean(data.sharedKeyConfigured || document.getElementById("user-key").value.trim());
    keyWarning.hidden = hasKey;
  } catch {
    keyWarning.hidden = false;
  }
}

function noneOr(value) {
  const trimmed = value.trim();
  if (!trimmed || ["none", "any"].includes(trimmed.toLowerCase())) return null;
  return trimmed;
}

function formConfig() {
  const query = document.getElementById("query").value.trim();
  const startRaw = document.getElementById("start").value.trim();
  const endRaw = document.getElementById("end").value.trim();
  const filters = checked("filters").map((value) => (value === "none" ? null : value));
  const printTypes = checked("print-types");
  const orderBy = checked("order-by");
  if (!query) throw new Error("Enter a query.");
  if (!filters.length || !printTypes.length || !orderBy.length) {
    throw new Error("Choose at least one filter, print type, and sort order.");
  }
  const startYear = startRaw === "" ? null : Number(startRaw);
  const endYear = endRaw === "" ? null : Number(endRaw);
  if (startYear !== null && !Number.isInteger(startYear)) throw new Error("Earliest year must be a whole number.");
  if (endYear !== null && !Number.isInteger(endYear)) throw new Error("Latest year must be a whole number.");
  if (startYear !== null && endYear !== null && startYear > endYear) {
    throw new Error("Earliest year cannot be after latest year.");
  }
  return {
    query,
    exact_phrase: document.getElementById("exact").checked,
    start_year: startYear,
    end_year: endYear,
    lang: noneOr(document.getElementById("lang").value),
    filters,
    print_types: printTypes,
    order_by: orderBy,
    max_pages: 100,
    sleep: 0.5,
    save_raw: true,
  };
}

function slug(cfg) {
  const q = cfg.query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "query";
  const range = [cfg.start_year, cfg.end_year].filter((n) => n != null).join("-");
  return range ? `${q}-${range}` : q;
}

async function fetchPage(params, signal) {
  const userKey = document.getElementById("user-key").value.trim();
  const key = userKey || browserKey;
  if (key) {
    const url = new URL("https://www.googleapis.com/books/v1/volumes");
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(name, String(value));
    }
    url.searchParams.set("key", key);
    url.searchParams.set("country", "US");
    const res = await fetch(url, { signal });
    return { status: res.status, text: await res.text(), source: "google" };
  }
  const url = new URL("/api/volumes", location.origin);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(name, String(value));
  }
  const headers = {};
  const access = document.getElementById("access-code").value.trim();
  if (access) headers["X-Access-Code"] = access;
  const res = await fetch(url, { headers, signal });
  return { status: res.status, text: await res.text(), source: res.headers.get("x-harvest-source") };
}

function setRunStatus(message) {
  runStatus.hidden = !message;
  runStatus.textContent = message || "";
}

function setBusy(busy) {
  loading.hidden = !busy;
  form.hidden = busy;
  runBtn.disabled = busy;
  form.setAttribute("aria-busy", busy ? "true" : "false");
  if (busy) loading.scrollIntoView({ block: "center" });
}

async function runHarvest() {
  let cfg;
  try {
    cfg = formConfig();
  } catch (err) {
    setRunStatus(err.message);
    return;
  }

  localStorage.setItem(STORAGE.access, document.getElementById("access-code").value);
  localStorage.setItem(STORAGE.key, document.getElementById("user-key").value);
  await loadStatus();

  controller = new AbortController();
  results.hidden = true;
  setRunStatus("");
  setBusy(true);

  try {
    const result = await harvest(cfg, {
      fetchPage,
      sleep: defaultSleep,
      now: () => new Date(),
      signal: controller.signal,
    });
    lastRun = { cfg, result };
    showResults(result, cfg);
  } catch (err) {
    if (err?.name !== "AbortError") {
      setRunStatus(err.message || String(err));
    }
  } finally {
    controller = null;
    setBusy(false);
  }
}

const VIEW_GROUPS = [
  { label: "Full view", keys: ["ALL_PAGES", "FULL_PUBLIC_DOMAIN"] },
  { label: "Snippet", keys: ["PARTIAL"] },
  { label: "No preview", keys: ["NO_PAGES"] },
];

function queryTextFromCfg(cfg) {
  if (cfg.exact_phrase && !cfg.query.startsWith('"')) return `"${cfg.query}"`;
  return cfg.query;
}

function viewGroup(viewability) {
  const key = String(viewability || "").toUpperCase();
  return VIEW_GROUPS.find((group) => group.keys.includes(key))?.label || "Other";
}

function sourceUrl(row, query) {
  let href = "";
  if (row.preview_link) href = row.preview_link;
  else if (row.info_link) href = row.info_link;
  else if (row.volume_id) href = `https://books.google.com/books?id=${encodeURIComponent(row.volume_id)}`;
  if (!href) return "";
  try {
    const url = new URL(href);
    if (query) {
      url.searchParams.set("q", query);
      url.searchParams.set("dq", query);
      url.searchParams.set("vq", query);
    }
    return url.toString();
  } catch {
    return href;
  }
}

function phraseNeedle(query) {
  return String(query || "").replace(/^"|"$/g, "").trim();
}

function quotedPhrase(query) {
  const needle = phraseNeedle(query);
  return needle ? `"${needle}"` : "";
}

function phraseRegex(query) {
  const needle = phraseNeedle(query);
  if (!needle) return null;
  return new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
}

function highlightPassage(text, query) {
  const escaped = escapeHtml(text || "");
  const re = phraseRegex(query);
  if (!re) return escaped;
  return escaped.replace(re, "<mark>$&</mark>");
}

function tidyPassage(text) {
  return String(text || "")
    .replace(/^\s*(?:\.{3}|…|\u2026)+/u, "")
    .replace(/(?:\.{3}|…|\u2026)+\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function countInstances(text, query) {
  const re = phraseRegex(query);
  if (!re || !text) return 0;
  return (String(text).match(re) || []).length;
}

function previewPage(book) {
  for (const href of [book.preview_link, book.info_link]) {
    if (!href) continue;
    try {
      const pg = new URL(href).searchParams.get("pg");
      if (pg) return pg;
    } catch {
      /* ignore malformed links */
    }
  }
  return "";
}

function formatPage(pg) {
  if (!pg) return "";
  const match = String(pg).match(/^(PA|PP|PR|PT)(.+)$/i);
  return match ? `p. ${match[2]}` : `p. ${pg}`;
}

function embedUrl(row, query) {
  if (!row.volumeId) return "";
  const url = new URL("https://books.google.com/books");
  url.searchParams.set("id", row.volumeId);
  url.searchParams.set("output", "embed");
  if (row.page) url.searchParams.set("pg", row.page);
  const quoted = quotedPhrase(query);
  if (quoted) {
    url.searchParams.set("q", quoted);
    url.searchParams.set("dq", quoted);
  }
  return url.toString();
}

function rowKey(row) {
  return `${row.volumeId || ""}::${row.page || ""}::${row.title}`;
}

function displayRow(book, passage, query, extras = {}) {
  const text = tidyPassage(passage);
  const page = extras.page || previewPage(book);
  const instances = extras.matchCount || countInstances(text, query) || (text ? 1 : 0);
  return {
    year: book.year,
    title: book.title,
    authors: book.authors,
    volumeId: book.volume_id || "",
    group: viewGroup(book.viewability),
    passage: text,
    page,
    instances,
    url: extras.url || sourceUrl(book, query),
  };
}

function rowsFromBooks(books, query) {
  return books.map((book) => displayRow(book, book.text_snippet || "", query));
}

function showResults(result, cfg) {
  results.hidden = false;
  const stopped = result.metadata.stopped_early;
  stoppedNote.hidden = !stopped;
  stoppedNote.textContent = stopped || "";
  const id = result.counts.identification;
  const screening = result.counts.screening_by_year;
  const stats = [
    ["Retrieved", id.records_retrieved_all_variants],
    ["Unique", id.unique_records],
    ["Retained", typeof screening === "object" ? screening.retained : id.unique_records],
    ["API requests", result.metadata.total_api_requests],
  ];
  countsEl.innerHTML = `<div class="counts">${stats.map(([label, value]) =>
    `<div class="stat"><b>${value}</b><span>${label}</span></div>`).join("")}</div>`;

  const query = queryTextFromCfg(cfg);
  displayState = {
    query,
    tab: "All",
    page: 1,
    rows: rowsFromBooks(result.included, query),
    expanded: new Set(),
  };
  matchStatus.hidden = false;
  matchStatus.textContent = "Expand a row to read the full page. In the preview Search box, use quotation marks around the phrase.";
  renderTable();
  results.scrollIntoView({ block: "start" });
}

function filteredRows() {
  if (displayState.tab === "All") return displayState.rows;
  return displayState.rows.filter((row) => row.group === displayState.tab);
}

function renderTable() {
  const query = displayState.query;
  const rows = filteredRows();
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  if (displayState.page > pages) displayState.page = pages;
  const start = (displayState.page - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  const labels = ["All", ...VIEW_GROUPS.map((group) => group.label), "Other"];
  const counts = Object.fromEntries(labels.map((label) => [label, 0]));
  counts.All = displayState.rows.length;
  for (const row of displayState.rows) counts[row.group] = (counts[row.group] || 0) + 1;
  resultTabs.replaceChildren();
  for (const label of labels) {
    if (label !== "All" && !counts[label]) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = `${label} (${counts[label]})`;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", label === displayState.tab ? "true" : "false");
    btn.addEventListener("click", () => {
      displayState.tab = label;
      displayState.page = 1;
      renderTable();
    });
    resultTabs.append(btn);
  }

  previewGroups.replaceChildren();
  const section = document.createElement("section");
  section.className = "result-group";
  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table");
  table.innerHTML = `<thead><tr><th>Year</th><th>Work</th><th>Text</th><th>Source</th></tr></thead>`;
  const tbody = document.createElement("tbody");
  if (!pageRows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="4">No matches in this category.</td>`;
    tbody.append(tr);
  }
  for (const row of pageRows) {
    const tr = document.createElement("tr");
    const key = rowKey(row);
    const expanded = displayState.expanded.has(key);
    const preview = embedUrl(row, query);
    const canExpand = Boolean(preview || (row.passage || "").length > 180);
    const source = row.url
      ? `<a href="${escapeHtml(row.url)}" target="_blank" rel="noopener noreferrer">Open</a>`
      : "";
    const meta = [
      row.authors,
      formatPage(row.page),
      row.instances > 1 ? `${row.instances} instances` : "",
    ].filter(Boolean).join(" · ");
    const cell = document.createElement("td");
    cell.className = "passage-cell";
    const passage = document.createElement("div");
    passage.className = expanded && preview ? "passage is-collapsed" : expanded ? "passage" : "passage is-collapsed";
    passage.innerHTML = highlightPassage(row.passage, query);
    cell.append(passage);
    if (canExpand) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "text-toggle";
      toggle.textContent = expanded ? "Hide" : "Show full paragraph";
      toggle.addEventListener("click", () => {
        if (displayState.expanded.has(key)) displayState.expanded.delete(key);
        else displayState.expanded.add(key);
        renderTable();
      });
      cell.append(toggle);
    }
    tr.innerHTML = `<td>${row.year ?? ""}</td>
      <td class="work"><div class="work-title">${escapeHtml(row.title)}</div><div class="work-meta">${escapeHtml(meta)}</div></td>
      <td></td>
      <td>${source}</td>`;
    tr.children[2].replaceWith(cell);
    tbody.append(tr);
    if (expanded && preview) {
      const previewRow = document.createElement("tr");
      previewRow.className = "book-preview-row";
      const previewCell = document.createElement("td");
      previewCell.colSpan = 4;
      const note = document.createElement("p");
      note.className = "hint";
      const quoted = quotedPhrase(query);
      note.textContent = quoted
        ? `In Search, type ${quoted} — including the quotation marks — to find every exact hit in this book.`
        : "In Search, type the phrase in quotation marks to find every exact hit in this book.";
      const frame = document.createElement("iframe");
      frame.className = "book-preview";
      frame.title = `Full page from ${row.title}`;
      frame.src = preview;
      frame.loading = "lazy";
      frame.setAttribute("allowfullscreen", "true");
      previewCell.append(note, frame);
      previewRow.append(previewCell);
      tbody.append(previewRow);
    }
  }
  table.append(tbody);
  wrap.append(table);
  section.append(wrap);
  previewGroups.append(section);

  pager.hidden = rows.length <= PAGE_SIZE;
  pager.replaceChildren();
  if (!pager.hidden) {
    const prev = document.createElement("button");
    prev.type = "button";
    prev.textContent = "Previous";
    prev.disabled = displayState.page <= 1;
    prev.addEventListener("click", () => {
      displayState.page -= 1;
      renderTable();
    });
    const info = document.createElement("span");
    info.textContent = `Page ${displayState.page} of ${pages} · ${rows.length} matches`;
    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "Next";
    next.disabled = displayState.page >= pages;
    next.addEventListener("click", () => {
      displayState.page += 1;
      renderTable();
    });
    pager.append(prev, info, next);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function saveZip() {
  if (!lastRun) return;
  const folder = `gbooks-harvest_${slug(lastRun.cfg)}`;
  const bytes = await zipFiles(lastRun.result.files, folder);
  downloadBlob(bytes, `${folder}.zip`);
}

function saveCsv() {
  if (!lastRun) return;
  const csv = lastRun.result.files.get("records.csv") || "";
  downloadBlob(new TextEncoder().encode(csv), `${slug(lastRun.cfg)}_records.csv`, "text/csv");
}

function saveTable() {
  const rows = filteredRows().map((row) => ({
    Year: row.year ?? "",
    Title: row.title || "",
    Authors: row.authors || "",
    Page: formatPage(row.page),
    Text: row.passage || "",
    Source: row.url || "",
    Category: row.group || "",
  }));
  if (!rows.length) return;
  const csv = `\uFEFF${writeCsv(rows, ["Year", "Title", "Authors", "Page", "Text", "Source", "Category"])}`;
  const base = lastRun ? slug(lastRun.cfg) : "results";
  const tab = displayState.tab === "All" ? "table" : displayState.tab.toLowerCase().replace(/\s+/g, "-");
  downloadBlob(new TextEncoder().encode(csv), `${base}_${tab}.csv`, "text/csv");
}
