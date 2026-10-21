import { test } from "node:test";
import assert from "node:assert/strict";
import { harvest, queryText, variantLabel, variants } from "../public/js/harvest.js";
import { pageBody, paramKey, volume } from "./helpers.js";

function fakeNowFactory(stamps) {
  const dates = stamps.map((s) => new Date(s));
  let i = 0;
  return () => dates[Math.min(i++, dates.length - 1)];
}

function scriptedFetch(routes) {
  const queues = Object.fromEntries(Object.entries(routes).map(([key, queue]) => [key, queue.slice()]));
  const calls = [];
  async function fetchPage(params) {
    calls.push({ ...params });
    const key = paramKey(params);
    const queue = queues[key];
    if (!queue) return { status: 200, text: pageBody([]), source: "google" };
    const spec = queue.length > 1 ? queue.shift() : queue[0];
    return { status: spec.status ?? 200, text: spec.text, source: spec.source ?? "google" };
  }
  return { fetchPage, calls };
}

const stamps = ["2026-01-01T00:00:00.123Z", "2026-01-01T00:01:00.456Z"];

test("queryText quotes exact phrases once", () => {
  assert.equal(queryText({ query: "the scientific method", exact_phrase: true }), '"the scientific method"');
  assert.equal(queryText({ query: '"already"', exact_phrase: true }), '"already"');
  assert.equal(queryText({ query: "nature study", exact_phrase: false }), "nature study");
});

test("variants are the cartesian product in CLI order", () => {
  const cfg = { filters: [null, "full"], print_types: ["all", "books"], order_by: ["relevance"] };
  assert.deepEqual(variants(cfg).map(variantLabel), [
    "printType-all_orderBy-relevance",
    "printType-books_orderBy-relevance",
    "filter-full_printType-all_orderBy-relevance",
    "filter-full_printType-books_orderBy-relevance",
  ]);
});

test("harvest merges, screens by year, and writes CLI-shaped files", async () => {
  const keep = volume("a", { publishedDate: "1910", title: "Alpha", viewability: "FULL_PUBLIC_DOMAIN", publicDomain: true });
  const late = volume("b", { publishedDate: "1950", title: "Late" });
  const undated = volume("c", { publishedDate: "", title: "No Date" });
  const dup = volume("a", { publishedDate: "1911", title: "Should keep first" });
  const messy = volume("d", {
    publishedDate: "1920",
    title: 'Comma, "quote"',
    textSnippet: "  <b>method</b> &amp; more  ",
    industryIdentifiers: [{ type: "ISBN_13", identifier: "978111" }, { type: "ISBN_10", identifier: "111" }],
  });

  const cfg = {
    query: "the scientific method",
    exact_phrase: true,
    start_year: 1900,
    end_year: 1930,
    lang: "en",
    filters: [null],
    print_types: ["all", "books"],
    order_by: ["relevance"],
    max_pages: 2,
    sleep: 0,
    save_raw: true,
  };

  const common = {
    q: '"the scientific method"',
    maxResults: 40,
    langRestrict: "en",
    orderBy: "relevance",
  };
  const { fetchPage } = scriptedFetch({
    [paramKey({ ...common, printType: "all", startIndex: 0 })]: [
      { text: pageBody([keep, late, undated], 3) },
    ],
    [paramKey({ ...common, printType: "all", startIndex: 40 })]: [{ text: pageBody([], 3) }],
    [paramKey({ ...common, printType: "books", startIndex: 0 })]: [
      { text: pageBody([dup, messy], 2) },
    ],
  });

  const sleeps = [];
  const result = await harvest(cfg, {
    fetchPage,
    sleep: async (s) => { sleeps.push(s); },
    now: fakeNowFactory(stamps),
    log: () => {},
  });

  assert.equal(result.included.length, 2);
  assert.equal(result.included[0].volume_id, "a");
  assert.equal(result.included[0].title, "Alpha");
  assert.equal(result.included[1].volume_id, "d");
  assert.equal(result.included[1].text_snippet, "method & more");
  assert.match(result.included[0].found_by, /printType-all/);
  assert.match(result.included[0].found_by, /printType-books/);
  assert.equal(result.counts.identification.unique_records, 4);
  assert.equal(result.counts.identification.duplicates_removed, 1);
  assert.equal(result.counts.screening_by_year.retained, 2);
  assert.equal(result.counts.screening_by_year.excluded_outside_range, 1);
  assert.equal(result.counts.screening_by_year.excluded_no_date, 1);
  assert.ok(result.files.get("records.csv").includes('Comma, ""quote""'));
  assert.ok(result.files.has("raw_responses/printType-all_orderBy-relevance_p000.json"));
  assert.equal(result.metadata.query_sent, '"the scientific method"');
});

test("quota during a variant stops the run and discards that variant's items", async () => {
  const cfg = {
    query: "x",
    exact_phrase: true,
    start_year: null,
    end_year: null,
    lang: null,
    filters: [null],
    print_types: ["all", "books"],
    order_by: ["relevance"],
    max_pages: 2,
    sleep: 0,
    save_raw: false,
  };
  const first = volume("ok", { publishedDate: "1910" });
  const { fetchPage } = scriptedFetch({
    [paramKey({ q: '"x"', maxResults: 40, printType: "all", orderBy: "relevance", startIndex: 0 })]: [
      { text: pageBody([first], 1) },
    ],
    [paramKey({ q: '"x"', maxResults: 40, printType: "books", orderBy: "relevance", startIndex: 0 })]: [
      { status: 403, text: "Quota limit exceeded for this project." },
    ],
  });
  const result = await harvest(cfg, {
    fetchPage,
    sleep: async () => {},
    now: fakeNowFactory(stamps),
    log: () => {},
  });
  assert.equal(result.included.length, 1);
  assert.match(result.metadata.stopped_early, /Quota exceeded during variant printType-books/);
  assert.ok(result.metadata.stopped_early.includes("Quota limit exceeded"));
});

test("429 retries then stops the harvest as quota exceeded", async () => {
  const cfg = {
    query: "x",
    exact_phrase: false,
    start_year: null,
    end_year: null,
    lang: null,
    filters: [null],
    print_types: ["all"],
    order_by: ["relevance"],
    max_pages: 1,
    sleep: 0,
    save_raw: false,
  };
  const { fetchPage } = scriptedFetch({
    [paramKey({ q: "x", maxResults: 40, printType: "all", orderBy: "relevance", startIndex: 0 })]: [
      { status: 429, text: "slow down" },
      { status: 429, text: "slow down" },
      { status: 429, text: "slow down" },
      { status: 429, text: "slow down" },
      { status: 429, text: "slow down" },
    ],
  });
  const sleeps = [];
  const result = await harvest(cfg, {
    fetchPage,
    sleep: async (s) => { sleeps.push(s); },
    now: fakeNowFactory(stamps),
    log: () => {},
  });
  assert.match(result.metadata.stopped_early, /Rate limit still exceeded after retries/);
  assert.deepEqual(sleeps, [1, 2, 4, 8, 16]);
});
