// Redaction for Kane evidence and reports. redact() replaces the values the
// design names. scanSecrets() lists the kinds still present after that, so a
// file with leftovers is blocked. Token shapes are scan-only: redact() leaves
// them, and a file that holds one stays out of the repo.

const REDACTED = "<redacted>";

// Header-style and JSON-style auth values: the name stays, the value goes.
const AUTH_HEADER = /(\b(?:proxy-authorization|authorization|set-cookie|cookie|x-api-key)\b["']?[ \t]*[:=][ \t]*)(?![ \t]*["']?<redacted>)("[^"\r\n]*"|[^\r\n]+)/gi;
const BEARER = /(\bBearer[ \t]+)(?!<redacted>)([A-Za-z0-9._~+\/=-]+)/gi;
// HAR header pairs, such as {"name": "Cookie", "value": "..."}.
const HAR_HEADER = /("name"\s*:\s*"(?:proxy-authorization|authorization|set-cookie|cookie|x-api-key)"\s*,\s*"value"\s*:\s*)(?!"<redacted>")("[^"\r\n]*")/gi;

// LambdaTest share links and the account behind them. A share token opens a
// test summary, so it goes. Project and test-case IDs stay.
const SHARE_PATH = /(\/share\/)[A-Za-z0-9_-]{8,}/g;
const SHARE_ID = /\bUS_[A-Za-z0-9]{16,}\b/g;
const ACCOUNT_NAME = /("(?:tms_user|username)"\s*:\s*")(?!<account>")[^"\r\n]*"/g;
const ACCOUNT_ID = /("(?:org_id|user_id)"\s*:\s*)"?\d+"?/g;

// A dotted number right after one slash is a version (HeadlessChrome/157.0.0.0),
// so it stays. An address after "//" in a URL still counts.
const REDACTIONS = [
  { kind: "email", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replace: "<email>" },
  { kind: "IP address", pattern: /(?<!(?<!\/)\/)\b(?:\d{1,3}\.){3}\d{1,3}\b|\b(?:ip|ec2)-\d{1,3}(?:-\d{1,3}){3}\b/g, replace: "<ip>" },
  { kind: "home path", pattern: /\\?\/home\\?\/ubuntu\b/g, replace: "~" },
  { kind: "profile name", pattern: /\bjay\b/gi, replace: "<profile>" },
  { kind: "auth value", pattern: AUTH_HEADER, replace: (match, head, value) => `${head}${value.startsWith('"') ? `"${REDACTED}"` : REDACTED}` },
  { kind: "auth value", pattern: BEARER, replace: `$1${REDACTED}` },
  { kind: "auth value", pattern: HAR_HEADER, replace: `$1"${REDACTED}"` },
  { kind: "share token", pattern: SHARE_PATH, replace: "$1<share-token>" },
  { kind: "share token", pattern: SHARE_ID, replace: "<share-token>" },
  { kind: "account name", pattern: ACCOUNT_NAME, replace: "$1<account>\"" },
  { kind: "account id", pattern: ACCOUNT_ID, replace: "$1\"<account-id>\"" }
];

// Shapes that must never be copied. redact() leaves them, so a match blocks the file.
const TOKEN_SHAPES = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g
];

export function redact(text) {
  return REDACTIONS.reduce((out, rule) => out.replace(rule.pattern, rule.replace), text);
}

// Returns the kinds still present, never the matched text, so a failure
// message cannot repeat a secret.
export function scanSecrets(text) {
  const kinds = new Set();
  for (const rule of REDACTIONS) {
    if (text.search(rule.pattern) !== -1) kinds.add(rule.kind);
  }
  if (TOKEN_SHAPES.some((pattern) => text.search(pattern) !== -1)) kinds.add("token");
  return [...kinds];
}

// Redacts every string inside a parsed value, such as a Kane verdict.
export function redactFields(value) {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(redactFields);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactFields(item)]));
  }
  return value;
}
