import dns from "node:dns";
import { checkAccess, accessCodeRequired, sharedKeyConfigured, pickApiKey, jsonError } from "./access.js";

// Google's Books API often returns 503 from IPv6 cloud addresses.
dns.setDefaultResultOrder("ipv4first");

const GOOGLE_URL = "https://www.googleapis.com/books/v1/volumes";
const ALLOWED_PARAMS = new Set([
  "q",
  "maxResults",
  "startIndex",
  "langRestrict",
  "filter",
  "printType",
  "orderBy",
]);

export function statusResponse(request) {
  const required = accessCodeRequired();
  const allowed = !required || checkAccess(request) === null;
  return Response.json(
    {
      accessCodeRequired: required,
      sharedKeyConfigured: sharedKeyConfigured(),
      browserKey: allowed ? process.env.GOOGLE_BOOKS_API_KEY || null : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function volumesResponse(request) {
  const url = new URL(request.url);
  const denied = checkAccess(request);
  if (denied) return denied;

  const forwarded = new URLSearchParams();
  for (const [key, value] of url.searchParams.entries()) {
    if (!ALLOWED_PARAMS.has(key)) {
      return jsonError(400, `Unknown query parameter: ${key}`);
    }
    forwarded.append(key, value);
  }

  const q = forwarded.get("q");
  if (!q || !q.trim()) {
    return jsonError(400, "Missing query.");
  }
  if (q.length > 500) {
    return jsonError(400, "Query is too long.");
  }

  const maxResults = Number(forwarded.get("maxResults") ?? "40");
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 40) {
    return jsonError(400, "maxResults must be an integer from 1 to 40.");
  }
  forwarded.set("maxResults", String(maxResults));

  const startIndex = Number(forwarded.get("startIndex") ?? "0");
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex > 4000) {
    return jsonError(400, "startIndex is out of range.");
  }
  forwarded.set("startIndex", String(startIndex));

  // Helps Google resolve viewability when the request comes from a cloud IP.
  forwarded.set("country", "US");

  const apiKey = pickApiKey(request);
  // Query-param `key` is the documented Books API auth. The CLI uses a
  // header so the key never appears in a URL; both are sent here because
  // some cloud IPs get 503 from Google when only the header is present.
  if (apiKey) forwarded.set("key", apiKey);

  let upstream;
  try {
    upstream = await fetch(`${GOOGLE_URL}?${forwarded.toString()}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "gbooks-harvest/0.1 (research; +https://github.com/Favarzam/gbooks-harvest)",
        ...(apiKey ? { "X-goog-api-key": apiKey } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    const name = err && typeof err === "object" ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return jsonError(504, "The Google Books API did not respond in time.");
    }
    return jsonError(502, "Could not reach the Google Books API.");
  }

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "x-harvest-source": "google",
      "cache-control": "no-store",
    },
  });
}

export async function routeApi(request) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  }
  if (request.method !== "GET") return jsonError(405, "Method not allowed.");
  if (path.endsWith("/status")) return statusResponse(request);
  if (path.endsWith("/volumes") || path.endsWith("/api")) return volumesResponse(request);
  return jsonError(404, "Not found.");
}
