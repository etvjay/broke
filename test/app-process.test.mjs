import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../app/server.mjs";
import { waitForApp } from "../scripts/lib/app-process.mjs";

const servers = [];
const dirs = [];

after(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

function listen(server) {
  servers.push(server);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function appOnPort(port) {
  return { port, exited: false, exit: null, stderr: "" };
}

test("waitForApp accepts the poll app's list on /api/polls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "app-process-"));
  dirs.push(dir);
  const port = await listen(createServer({ dataFile: join(dir, "polls.json") }));
  assert.deepEqual(await waitForApp(appOnPort(port), 3000), { ok: true, detail: "" });
});

test("waitForApp refuses another server that answers 200 on the port", async () => {
  const port = await listen(
    createHttpServer((req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("hello");
    })
  );
  const result = await waitForApp(appOnPort(port), 1000);
  assert.equal(result.ok, false);
  assert.match(result.detail, /poll list/);
});
