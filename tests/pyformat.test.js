import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanSnippet, parseYear, pyDumps, unescapeHtml, writeCsv } from "../public/js/pyformat.js";
import { pythonJson } from "./helpers.js";

test("parseYear reads a leading four-digit year", () => {
  assert.equal(parseYear("1905"), 1905);
  assert.equal(parseYear("1905-03-01"), 1905);
  assert.equal(parseYear(""), null);
  assert.equal(parseYear(null), null);
  assert.equal(parseYear("circa 1905"), null);
});

test("unescapeHtml matches Python html.unescape", () => {
  const samples = [
    "plain",
    "A <b>bold</b> &amp; quoted &quot;bit&quot;",
    "nbsp&nbsp;here",
    "&#39;apostrophe&#x27;",
    "&notin; named",
    "trailing &amp",
  ];
  const expected = JSON.parse(pythonJson(
    "import html, json, sys; print(json.dumps([html.unescape(s) for s in json.load(sys.stdin)]))",
    JSON.stringify(samples),
  ));
  assert.deepEqual(samples.map(unescapeHtml), expected);
});

test("cleanSnippet strips tags, unescapes, and trims like core.py", () => {
  const samples = [
    "  <b>the scientific method</b> &amp; more  ",
    "<br>line",
    "",
  ];
  const expected = JSON.parse(pythonJson(
    "import html, json, re, sys\n"
    + "def clean(text):\n"
    + "    if not text: return ''\n"
    + "    return html.unescape(re.sub(r'<[^>]+>', '', text)).strip()\n"
    + "print(json.dumps([clean(s) for s in json.load(sys.stdin)]))",
    JSON.stringify(samples),
  ));
  assert.deepEqual(samples.map(cleanSnippet), expected);
});

test("pyDumps matches json.dumps compact and indented", () => {
  const value = {
    tool: "gbooks-harvest",
    year_range: [1900, 1930],
    language_restriction: null,
    stopped_early: null,
    ok: true,
    counts: { unique_records: 2 },
    title: "Méthode & more",
    emoji: "😀",
    empty: {},
    list: [1, 2, 3],
  };
  const compact = pythonJson("import json, sys; print(json.dumps(json.load(sys.stdin)), end='')", JSON.stringify(value));
  const indented = pythonJson("import json, sys; print(json.dumps(json.load(sys.stdin), indent=2), end='')", JSON.stringify(value));
  assert.equal(pyDumps(value), compact);
  assert.equal(pyDumps(value, 2), indented);
});

test("writeCsv quotes commas and doubled quotes like Python", () => {
  const rows = [
    { title: 'The "Method", revisited', year: 1910, flag: true, missing: null },
  ];
  const fields = ["title", "year", "flag", "missing"];
  const expected = pythonJson(
    "import csv, io, json, sys\n"
    + "payload = json.load(sys.stdin)\n"
    + "buf = io.StringIO()\n"
    + "w = csv.DictWriter(buf, fieldnames=payload['fields'])\n"
    + "w.writeheader()\n"
    + "w.writerows(payload['rows'])\n"
    + "sys.stdout.write(buf.getvalue())",
    JSON.stringify({ fields, rows }),
  );
  assert.equal(writeCsv(rows, fields), expected);
});
