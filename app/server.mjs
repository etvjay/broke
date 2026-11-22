import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { castVote, createPoll, findPoll, listPolls, loadPolls, publicPoll, savePolls } from "./store.mjs";

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "public");
const BODY_LIMIT = 10 * 1024;
const VOTER_COOKIE = "voter";
const VOTER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VOTE_ROUTE = /^\/api\/polls\/([^/]+)\/vote$/;
const VOTE_STATUS = { not_found: 404, bad_option: 400, already_voted: 409 };
const STATIC_FILES = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/app.js", { file: "app.js", type: "text/javascript; charset=utf-8" }]
]);

export function createServer({ dataFile }) {
  const context = { dataFile, queue: Promise.resolve() };
  return createHttpServer(function handleRequest(req, res) {
    serveRequest(context, req, res);
  });
}

export function closeServer(server) {
  server.closeAllConnections();
  server.close(function exitAfterClose() {
    process.exit(0);
  });
}

async function serveRequest(context, req, res) {
  try {
    await routeRequest(context, req, res);
  } catch (error) {
    if (error.status) {
      sendJson(res, error.status, { error: error.code });
      return;
    }
    console.error(error);
    if (res.headersSent) {
      res.end();
    } else {
      sendJson(res, 500, { error: "server_error" });
    }
  }
}

async function routeRequest(context, req, res) {
  const url = new URL(req.url, "http://localhost");
  const voterId = ensureVoter(req, res);
  if (req.method === "GET" && STATIC_FILES.has(url.pathname)) {
    return sendStatic(res, STATIC_FILES.get(url.pathname));
  }
  if (url.pathname === "/api/polls" && req.method === "GET") {
    return sendPolls(context, res, voterId);
  }
  if (url.pathname === "/api/polls" && req.method === "POST") {
    return addPollRoute(context, req, res);
  }
  const vote = VOTE_ROUTE.exec(url.pathname);
  if (vote && req.method === "POST") {
    return votePollRoute(context, req, res, vote[1], voterId);
  }
  return sendJson(res, 404, { error: "not_found" });
}

function ensureVoter(req, res) {
  const existing = readCookie(req.headers.cookie, VOTER_COOKIE);
  if (existing && VOTER_ID.test(existing)) return existing;
  const voterId = randomUUID();
  res.setHeader("Set-Cookie", `${VOTER_COOKIE}=${voterId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
  return voterId;
}

function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

async function sendStatic(res, entry) {
  const body = await readFile(join(PUBLIC_DIR, entry.file));
  res.writeHead(200, { "content-type": entry.type, "cache-control": "no-store" });
  res.end(body);
}

async function sendPolls(context, res, voterId) {
  const polls = await loadPolls(context.dataFile);
  sendJson(res, 200, { polls: listPolls(polls, voterId) });
}

async function addPollRoute(context, req, res) {
  const body = await readJsonBody(req);
  try {
    const poll = await runExclusive(context, addPollTask, body);
    sendJson(res, 201, { poll: publicPoll(poll) });
  } catch (error) {
    if (error.name !== "ValidationError") throw error;
    sendJson(res, 400, { error: error.message });
  }
}

async function votePollRoute(context, req, res, pollId, voterId) {
  const body = await readJsonBody(req);
  const outcome = await runExclusive(context, castVoteTask, { pollId, option: body?.option, voterId });
  if (outcome.result.ok) {
    sendJson(res, 200, { poll: outcome.poll });
  } else {
    sendJson(res, VOTE_STATUS[outcome.result.reason], { error: outcome.result.reason });
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw Object.assign(new Error("body_too_large"), { status: 413, code: "body_too_large" });
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("bad_json"), { status: 400, code: "bad_json" });
  }
}

function runExclusive(context, task, input) {
  const previous = context.queue;
  let release;
  context.queue = new Promise(function holdQueue(resolve) {
    release = resolve;
  });
  return previous.then(function runTask() {
    return task(context.dataFile, input);
  }).finally(function releaseQueue() {
    release();
  });
}

async function addPollTask(dataFile, input) {
  const polls = await loadPolls(dataFile);
  const poll = createPoll(polls, input);
  await savePolls(dataFile, polls);
  return poll;
}

async function castVoteTask(dataFile, input) {
  const polls = await loadPolls(dataFile);
  const result = castVote(polls, input.pollId, input.option, input.voterId);
  if (result.ok) await savePolls(dataFile, polls);
  return { result, poll: result.ok ? publicPoll(findPoll(polls, input.pollId), input.voterId) : null };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  startFromEnvironment();
}

function startFromEnvironment() {
  const port = Number(process.env.PORT || 3000);
  const dataFile = process.env.DATA_FILE || "data/polls.json";
  const server = createServer({ dataFile });
  function stopOnSignal() {
    closeServer(server);
  }
  process.on("SIGTERM", stopOnSignal);
  process.on("SIGINT", stopOnSignal);
  server.listen(port, function announceListening() {
    console.log(`listening on http://localhost:${server.address().port}`);
  });
}
