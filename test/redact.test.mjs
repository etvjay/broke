import { test } from "node:test";
import assert from "node:assert/strict";
import { redact, scanSecrets } from "../scripts/lib/redact.mjs";

// Assembled at run time, so no token-shaped literal sits in the repo.
const TOKEN = ["ghp", "_", "A".repeat(36)].join("");
const PRIVATE_KEY_HEADER = ["-----BEGIN ", "PRIVATE KEY-----"].join("");

const SENSITIVE = [
  "Contact owner@example.com for access.",
  "Server 203.0.113.42 and host ip-172-31-14-153 answered.",
  "Log at /home/ubuntu/kane/reports/0001.md",
  "Escaped in JSON: \\/home\\/ubuntu\\/kane",
  "Profile jay signed in.",
  "Authorization: Basic dXNlcjpwYXNz",
  "Cookie: sid=s3cr3t; theme=dark",
  '{"authorization": "Basic dXNlcjpwYXNz", "ok": true}',
  "Bearer abc.def-123 was sent",
  '{"name": "Cookie", "value": "sid=s3cr3t"}'
].join("\n");

const RAW_VALUES = ["owner@example.com", "203.0.113.42", "ip-172-31-14-153", "/home/ubuntu", "jay", "dXNlcjpwYXNz", "s3cr3t", "abc.def-123"];

test("redact removes every sensitive value in the fixture", () => {
  const out = redact(SENSITIVE);
  for (const value of RAW_VALUES) assert.equal(out.includes(value), false, `still has ${value}`);
});

test("redact keeps the name of each auth header and replaces only its value", () => {
  const out = redact(SENSITIVE);
  assert.match(out, /Authorization: <redacted>/);
  assert.match(out, /Cookie: <redacted>/);
  assert.match(out, /"authorization": "<redacted>"/);
  assert.match(out, /"name": "Cookie", "value": "<redacted>"/);
});

test("the second scan names each kind still present in the raw text", () => {
  assert.deepEqual(scanSecrets(SENSITIVE).sort(), ["IP address", "auth value", "email", "home path", "profile name"]);
});

test("after redaction the second scan finds nothing", () => {
  assert.deepEqual(scanSecrets(redact(SENSITIVE)), []);
});

test("a token shape survives redaction and blocks the file", () => {
  const text = `build log: ${TOKEN}\n${PRIVATE_KEY_HEADER}\n`;
  assert.equal(redact(text).includes(TOKEN), true);
  assert.deepEqual(scanSecrets(redact(text)), ["token"]);
});

test("ordinary text passes through unchanged", () => {
  const plain = "Vote did not count. The poll had 2 options at 10:41, on version 0.10.4, for 21.35 credits.";
  assert.equal(redact(plain), plain);
  assert.deepEqual(scanSecrets(plain), []);
});

test("the second scan reports kinds, never the matched text", () => {
  const findings = scanSecrets(SENSITIVE).join(" ");
  assert.equal(findings.includes("owner@example.com"), false);
  assert.equal(findings.includes("203.0.113.42"), false);
});

test("a browser version after a slash is not read as an address, but an address in a URL still is", () => {
  const ua = "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/157.0.0.0 Safari/537.36";
  assert.equal(redact(ua), ua);
  assert.deepEqual(scanSecrets(ua), []);
  assert.equal(redact("GET http://203.0.113.42:3100/ HTTP/1.1"), "GET http://<ip>:3100/ HTTP/1.1");
});
