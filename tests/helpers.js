import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function paramKey(params) {
  return Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key] ?? ""}`)
    .join("&");
}

export function pythonJson(code, input) {
  const result = spawnSync("python3", ["-c", code], {
    input,
    encoding: "utf8",
    cwd: ROOT,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "python3 failed");
  }
  return result.stdout;
}

export function volume(id, extras = {}) {
  const info = extras.volumeInfo || {};
  return {
    id,
    volumeInfo: {
      title: extras.title ?? `Title ${id}`,
      subtitle: extras.subtitle ?? "",
      authors: extras.authors ?? ["Doe, Jane"],
      publisher: extras.publisher ?? "Test Press",
      publishedDate: extras.publishedDate ?? "1910",
      printType: extras.printType ?? "BOOK",
      language: extras.language ?? "en",
      pageCount: extras.pageCount ?? 120,
      categories: extras.categories ?? ["Science"],
      industryIdentifiers: extras.industryIdentifiers ?? [{ type: "ISBN_13", identifier: "9780000000000" }],
      previewLink: extras.previewLink ?? `https://books.google.com/?id=${id}`,
      infoLink: extras.infoLink ?? `https://books.google.com/?id=${id}&info`,
      ...info,
    },
    accessInfo: {
      viewability: extras.viewability ?? "PARTIAL",
      publicDomain: extras.publicDomain ?? false,
      pdf: { isAvailable: extras.pdf ?? true },
      epub: { isAvailable: extras.epub ?? false },
      ...(extras.accessInfo || {}),
    },
    searchInfo: {
      textSnippet: extras.textSnippet ?? "A <b>snippet</b> with &amp; ampersand.",
    },
  };
}

export function pageBody(items, totalItems = items.length) {
  return JSON.stringify({ kind: "books#volumes", totalItems, items });
}
