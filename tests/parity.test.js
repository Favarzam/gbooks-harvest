import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { harvest } from "../public/js/harvest.js";
import { pageBody, paramKey, volume, ROOT } from "./helpers.js";

function runPython(payload) {
  const result = spawnSync("python3", ["tests/parity_runner.py"], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    cwd: ROOT,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "parity_runner.py failed");
  }
  return JSON.parse(result.stdout);
}

function scriptedFetch(routes) {
  const queues = Object.fromEntries(
    Object.entries(routes).map(([key, queue]) => [key, queue.map((spec) => ({ ...spec }))]),
  );
  async function fetchPage(params) {
    const key = paramKey(params);
    const queue = queues[key];
    if (!queue) return { status: 200, text: pageBody([]), source: "google" };
    const spec = queue.length > 1 ? queue.shift() : queue[0];
    const text = typeof spec.body === "string" ? spec.body : JSON.stringify(spec.body ?? { items: [] });
    return { status: spec.status ?? 200, text, source: "google" };
  }
  return fetchPage;
}

const timestamps = ["2026-01-01T00:00:00.123Z", "2026-01-01T00:01:00.456Z"];

function pythonRoutes(routes) {
  const out = {};
  for (const [key, queue] of Object.entries(routes)) {
    out[key] = queue.map((spec) => ({
      status: spec.status ?? 200,
      body: spec.body,
    }));
  }
  return out;
}

test("JS harvest files match core.py for a ranged multi-variant run", async () => {
  const keep = volume("keep", {
    publishedDate: "1910-06",
    title: "Alpha method",
    viewability: "PARTIAL",
    textSnippet: "See <b>the scientific method</b> &amp; more.",
  });
  const late = volume("late", { publishedDate: "1955", title: "Too late" });
  const nodate = volume("nodate", { publishedDate: "", title: "Undated" });
  const extra = volume("extra", {
    publishedDate: "1922",
    title: 'Quotes, "commas"',
    authors: ["Rillero, P.", "Avarzamani, F."],
    industryIdentifiers: [
      { type: "ISBN_13", identifier: "9781234567890" },
      { type: "ISBN_10", identifier: "1234567890" },
    ],
  });
  const noid = { ...volume("noid", { publishedDate: "1911" }), id: "" };

  const cfg = {
    query: "the scientific method",
    exact_phrase: true,
    start_year: 1900,
    end_year: 1930,
    lang: "en",
    filters: [null, "full"],
    print_types: ["all"],
    order_by: ["relevance"],
    max_pages: 2,
    sleep: 0.5,
    save_raw: true,
  };

  const base = {
    q: '"the scientific method"',
    maxResults: 40,
    langRestrict: "en",
    orderBy: "relevance",
  };
  const routes = {
    [paramKey({ ...base, printType: "all", startIndex: 0 })]: [
      { body: pageBody([keep, late, nodate, noid], 4) },
    ],
    [paramKey({ ...base, printType: "all", startIndex: 40 })]: [
      { body: pageBody([], 4) },
    ],
    [paramKey({ ...base, filter: "full", printType: "all", startIndex: 0 })]: [
      { body: pageBody([keep, extra], 2) },
    ],
  };

  const py = runPython({ config: cfg, timestamps, routes: pythonRoutes(routes) });
  const js = await harvest(cfg, {
    fetchPage: scriptedFetch(routes),
    sleep: async () => {},
    now: (() => {
      const dates = timestamps.map((s) => new Date(s));
      let i = 0;
      return () => dates[Math.min(i++, dates.length - 1)];
    })(),
    log: () => {},
  });

  const jsFiles = Object.fromEntries(js.files);
  assert.deepEqual(Object.keys(jsFiles).sort(), Object.keys(py.files).sort());
  for (const name of Object.keys(py.files)) {
    assert.equal(jsFiles[name], py.files[name], name);
  }
});

test("JS harvest files match core.py when quota stops a later variant", async () => {
  const first = volume("one", { publishedDate: "1908", title: "Kept" });
  const cfg = {
    query: "nature study",
    exact_phrase: false,
    start_year: null,
    end_year: null,
    lang: null,
    filters: [null],
    print_types: ["all", "books"],
    order_by: ["relevance"],
    max_pages: 1,
    sleep: 0,
    save_raw: true,
  };
  const routes = {
    [paramKey({ q: "nature study", maxResults: 40, printType: "all", orderBy: "relevance", startIndex: 0 })]: [
      { body: pageBody([first], 1) },
    ],
    [paramKey({ q: "nature study", maxResults: 40, printType: "books", orderBy: "relevance", startIndex: 0 })]: [
      { status: 403, body: "User Rate Limit Exceeded for this quota." },
    ],
  };

  const py = runPython({ config: cfg, timestamps, routes: pythonRoutes(routes) });
  const js = await harvest(cfg, {
    fetchPage: scriptedFetch(routes),
    sleep: async () => {},
    now: (() => {
      const dates = timestamps.map((s) => new Date(s));
      let i = 0;
      return () => dates[Math.min(i++, dates.length - 1)];
    })(),
    log: () => {},
  });

  assert.equal(js.files.get("records.csv"), py.files["records.csv"]);
  assert.equal(js.files.get("prisma_counts.json"), py.files["prisma_counts.json"]);
  assert.equal(js.files.get("run_metadata.json"), py.files["run_metadata.json"]);
});
