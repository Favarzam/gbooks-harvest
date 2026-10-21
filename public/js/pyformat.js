import { HTML5, INVALID_CHARREFS, INVALID_CODEPOINTS } from "./html-entities.js";

const CHARREF = /&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[^\t\n\f <&#;]{1,32};?)/g;

export function pyStr(value) {
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  return String(value);
}

export function csvValue(value) {
  if (value === null || value === undefined) return "";
  if (value === true) return "True";
  if (value === false) return "False";
  return String(value);
}

function pyIsSpace(ch) {
  const c = ch.codePointAt(0);
  if (c === 0x20 || (c >= 0x09 && c <= 0x0d)) return true;
  if (c >= 0x1c && c <= 0x1f) return true;
  if (c === 0x85 || c === 0xa0 || c === 0x1680) return true;
  if (c >= 0x2000 && c <= 0x200a) return true;
  if (c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000) return true;
  return false;
}

export function pyStrip(s) {
  const chars = Array.from(s);
  let a = 0;
  let b = chars.length;
  while (a < b && pyIsSpace(chars[a])) a += 1;
  while (b > a && pyIsSpace(chars[b - 1])) b -= 1;
  return chars.slice(a, b).join("");
}

export function unescapeHtml(s) {
  if (!s.includes("&")) return s;
  return s.replace(CHARREF, (_, ref) => replaceCharref(ref));
}

function replaceCharref(s) {
  if (s[0] === "#") {
    const num = s[1] === "x" || s[1] === "X"
      ? Number.parseInt(s.slice(2).replace(/;$/u, ""), 16)
      : Number.parseInt(s.slice(1).replace(/;$/u, ""), 10);
    if (INVALID_CHARREFS.has(num)) return INVALID_CHARREFS.get(num);
    if ((num >= 0xd800 && num <= 0xdfff) || num > 0x10ffff) return "\uFFFD";
    if (INVALID_CODEPOINTS.has(num)) return "";
    return String.fromCodePoint(num);
  }
  if (HTML5.has(s)) return HTML5.get(s);
  for (let x = s.length - 1; x > 1; x -= 1) {
    const prefix = s.slice(0, x);
    if (HTML5.has(prefix)) return HTML5.get(prefix) + s.slice(x);
  }
  return `&${s}`;
}

export function cleanSnippet(text) {
  if (!text) return "";
  return pyStrip(unescapeHtml(text.replace(/<[^>]+>/g, "")));
}

export function parseYear(publishedDate) {
  if (!publishedDate) return null;
  const m = String(publishedDate).match(/^(\d{4})/u);
  return m ? Number.parseInt(m[1], 10) : null;
}

export function cmpCodePoints(a, b) {
  const left = Array.from(String(a));
  const right = Array.from(String(b));
  const n = Math.min(left.length, right.length);
  for (let i = 0; i < n; i += 1) {
    const d = left[i].codePointAt(0) - right[i].codePointAt(0);
    if (d) return d;
  }
  return left.length - right.length;
}

function quoteCsvField(field) {
  if (/[",\r\n]/u.test(field)) return `"${field.replaceAll('"', '""')}"`;
  return field;
}

export function writeCsv(rows, fieldnames) {
  const lines = [fieldnames.map(quoteCsvField).join(",")];
  for (const row of rows) {
    lines.push(fieldnames.map((name) => quoteCsvField(csvValue(row[name]))).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

function pyEncodeString(s) {
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (cp < 0x20 || cp >= 0x7f) {
      if (cp > 0xffff) {
        const adjusted = cp - 0x10000;
        const hi = 0xd800 + (adjusted >> 10);
        const lo = 0xdc00 + (adjusted & 0x3ff);
        out += `\\u${hi.toString(16).padStart(4, "0")}\\u${lo.toString(16).padStart(4, "0")}`;
      } else {
        out += `\\u${cp.toString(16).padStart(4, "0")}`;
      }
    } else out += ch;
  }
  return `${out}"`;
}

function pyNumber(n) {
  if (!Number.isFinite(n)) return "null";
  if (Object.is(n, -0)) return "0";
  if (Number.isInteger(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER) return String(n);
  return JSON.stringify(n);
}

function dump(value, indent, level) {
  if (value === null || value === undefined) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "number") return pyNumber(value);
  if (typeof value === "string") return pyEncodeString(value);
  if (Array.isArray(value)) return dumpArray(value, indent, level);
  if (typeof value === "object") return dumpObject(value, indent, level);
  return pyEncodeString(String(value));
}

function dumpArray(arr, indent, level) {
  if (arr.length === 0) return "[]";
  if (indent === null) {
    return `[${arr.map((item) => dump(item, indent, 0)).join(", ")}]`;
  }
  const pad = " ".repeat(indent * (level + 1));
  const closer = " ".repeat(indent * level);
  const inner = arr.map((item) => pad + dump(item, indent, level + 1)).join(",\n");
  return `[\n${inner}\n${closer}]`;
}

function dumpObject(obj, indent, level) {
  const keys = Object.keys(obj);
  if (keys.length === 0) return "{}";
  if (indent === null) {
    return `{${keys.map((k) => `${pyEncodeString(k)}: ${dump(obj[k], indent, 0)}`).join(", ")}}`;
  }
  const pad = " ".repeat(indent * (level + 1));
  const closer = " ".repeat(indent * level);
  const inner = keys
    .map((k) => `${pad}${pyEncodeString(k)}: ${dump(obj[k], indent, level + 1)}`)
    .join(",\n");
  return `{\n${inner}\n${closer}}`;
}

export function pyDumps(value, indent = null) {
  return dump(value, indent, 0);
}

export function isoformat(date) {
  const ms = date.toISOString().replace("Z", "");
  return `${ms}000+00:00`;
}
