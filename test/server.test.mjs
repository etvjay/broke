import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../app/server.mjs";

const SERVER_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "app", "server.mjs");
const JSON_HEADERS = { "content-type": "application/json" };
let dir;
let server;
let base;
let pollId;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "poll-server-"));
  server = createServer({ dataFile: join(dir, "polls.json") });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

async function newVoterCookie() {
  const res = await fetch(`${base}/`);
  await res.arrayBuffer();
  return res.headers.get("set-cookie").split(";")[0];
}

function vote(cookie, option) {
  return fetch(`${base}/api/polls/${pollId}/vote`, {
    method: "POST",
    headers: { ...JSON_HEADERS, cookie },
    body: JSON.stringify({ option })
  });
}

test("GET / serves the page and sets a voter cookie", async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Poll app/);
  assert.match(res.headers.get("set-cookie"), /^voter=[0-9a-f-]{36};/);
});

test("POST /api/polls creates a poll, and GET lists it without voter ids", async () => {
  const created = await fetch(`${base}/api/polls`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ question: "Best tea?", options: ["Green", "Black"] })
  });
  assert.equal(created.status, 201);
  const { poll } = await created.json();
  pollId = poll.id;
  assert.deepEqual(poll.options, [{ label: "Green", votes: 0 }, { label: "Black", votes: 0 }]);
  const listed = await (await fetch(`${base}/api/polls`)).json();
  assert.equal(listed.polls.length, 1);
  assert.equal("voters" in listed.polls[0], false);
});

test("one vote per browser: a repeat vote from the same cookie gets 409, another browser can vote", async () => {
  const cookieA = await newVoterCookie();
  const first = await vote(cookieA, 1);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).poll.totalVotes, 1);
  const repeat = await vote(cookieA, 0);
  assert.equal(repeat.status, 409);
  assert.equal((await repeat.json()).error, "already_voted");
  const other = await vote(await newVoterCookie(), 0);
  assert.equal(other.status, 200);
});

test("GET /api/polls tells each browser which option it chose, and others nothing", async () => {
  const created = await fetch(`${base}/api/polls`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ question: "Favourite colour?", options: ["Red", "Blue"] })
  });
  const { poll } = await created.json();
  const cookieA = await newVoterCookie();
  const cookieB = await newVoterCookie();
  const cast = await fetch(`${base}/api/polls/${poll.id}/vote`, {
    method: "POST",
    headers: { ...JSON_HEADERS, cookie: cookieA },
    body: JSON.stringify({ option: 1 })
  });
  assert.equal(cast.status, 200);
  assert.equal((await cast.json()).poll.yourVote, 1);
  const listedA = await (await fetch(`${base}/api/polls`, { headers: { cookie: cookieA } })).json();
  assert.equal(listedA.polls.find((listed) => listed.id === poll.id).yourVote, 1);
  const listedB = await (await fetch(`${base}/api/polls`, { headers: { cookie: cookieB } })).json();
  assert.equal(listedB.polls.find((listed) => listed.id === poll.id).yourVote, null);
});

test("bad input gets clear errors", async () => {
  const solo = await fetch(`${base}/api/polls`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ question: "Solo?", options: ["Only"] }) });
  assert.equal(solo.status, 400);
  assert.match((await solo.json()).error, /options must have 2 to 10 entries/);
  const broken = await fetch(`${base}/api/polls`, { method: "POST", headers: JSON_HEADERS, body: "{not json" });
  assert.equal(broken.status, 400);
  assert.equal((await broken.json()).error, "bad_json");
  const badOption = await vote(await newVoterCookie(), 9);
  assert.equal(badOption.status, 400);
  assert.equal((await badOption.json()).error, "bad_option");
  const missing = await fetch(`${base}/api/polls/does-not-exist/vote`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ option: 0 }) });
  assert.equal(missing.status, 404);
  const unknown = await fetch(`${base}/nope`);
  assert.equal(unknown.status, 404);
});

test("SIGTERM closes the server and exits 0", { timeout: 10000 }, async () => {
  const child = spawn(process.execPath, [SERVER_FILE], {
    env: { ...process.env, PORT: "0", DATA_FILE: join(dir, "signal.json") },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await once(child.stdout, "data");
  child.kill("SIGTERM");
  const [code] = await once(child, "exit");
  assert.equal(code, 0);
});
