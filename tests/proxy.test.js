import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { statusResponse, volumesResponse } from "../lib/handlers.js";

const originalFetch = globalThis.fetch;
const env = process.env;

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of ["ACCESS_CODE", "GOOGLE_BOOKS_API_KEY"]) {
    if (env[`_prev_${key}`] === undefined) delete process.env[key];
    else process.env[key] = env[`_prev_${key}`];
  }
});

function remember(key) {
  env[`_prev_${key}`] = process.env[key];
}

test("status reports whether an access code and shared key are set", () => {
  remember("ACCESS_CODE");
  remember("GOOGLE_BOOKS_API_KEY");
  process.env.ACCESS_CODE = "sesame";
  process.env.GOOGLE_BOOKS_API_KEY = "abc";
  return statusResponse(new Request("http://local/api/status")).json().then((data) => {
    assert.equal(data.accessCodeRequired, true);
    assert.equal(data.sharedKeyConfigured, true);
    assert.equal(data.browserKey, null);
  });
});

test("volumes rejects a bad access code", async () => {
  remember("ACCESS_CODE");
  process.env.ACCESS_CODE = "sesame";
  const res = await volumesResponse(new Request("http://local/api/volumes?q=test"));
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("x-harvest-source"), "proxy");
});

test("volumes rejects unknown query params", async () => {
  remember("ACCESS_CODE");
  delete process.env.ACCESS_CODE;
  const res = await volumesResponse(new Request("http://local/api/volumes?q=test&callback=x"));
  assert.equal(res.status, 400);
});

test("volumes forwards the shared key and country to Google", async () => {
  remember("ACCESS_CODE");
  remember("GOOGLE_BOOKS_API_KEY");
  delete process.env.ACCESS_CODE;
  process.env.GOOGLE_BOOKS_API_KEY = "shared-key";
  let seen;
  globalThis.fetch = async (url, opts) => {
    seen = { url: String(url), headers: opts.headers };
    return new Response('{"items":[]}', { status: 200, headers: { "content-type": "application/json" } });
  };
  const res = await volumesResponse(new Request("http://local/api/volumes?q=hello&maxResults=40&startIndex=0"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-harvest-source"), "google");
  const forwarded = new URL(seen.url);
  assert.equal(forwarded.searchParams.get("q"), "hello");
  assert.equal(forwarded.searchParams.get("country"), "US");
  assert.equal(forwarded.searchParams.get("key"), "shared-key");
  assert.equal(seen.headers["X-goog-api-key"], "shared-key");
});

test("volumes prefers a user-supplied API key", async () => {
  remember("ACCESS_CODE");
  remember("GOOGLE_BOOKS_API_KEY");
  delete process.env.ACCESS_CODE;
  process.env.GOOGLE_BOOKS_API_KEY = "shared-key";
  let seen;
  globalThis.fetch = async (url, opts) => {
    seen = opts.headers;
    return new Response("{}", { status: 200 });
  };
  await volumesResponse(new Request("http://local/api/volumes?q=hello", {
    headers: { "X-User-Api-Key": "mine" },
  }));
  assert.equal(seen["X-goog-api-key"], "mine");
});
