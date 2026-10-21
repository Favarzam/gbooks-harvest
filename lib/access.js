import { createHash, timingSafeEqual } from "node:crypto";

function sha256(value) {
  return createHash("sha256").update(value ?? "", "utf8").digest();
}

export function accessCodeRequired() {
  return Boolean(process.env.ACCESS_CODE);
}

export function sharedKeyConfigured() {
  return Boolean(process.env.GOOGLE_BOOKS_API_KEY);
}

export function checkAccess(request) {
  const expected = process.env.ACCESS_CODE;
  if (!expected) return null;
  const got = request.headers.get("x-access-code") ?? "";
  if (!timingSafeEqual(sha256(got), sha256(expected))) {
    return jsonError(401, "Access code is incorrect.");
  }
  return null;
}

export function pickApiKey(request) {
  const userKey = (request.headers.get("x-user-api-key") ?? "").trim();
  if (userKey) return userKey;
  return (process.env.GOOGLE_BOOKS_API_KEY ?? "").trim() || null;
}

export function jsonError(status, error) {
  return new Response(JSON.stringify({ error, source: "proxy" }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-harvest-source": "proxy",
      "cache-control": "no-store",
    },
  });
}
