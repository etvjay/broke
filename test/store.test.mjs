import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { castVote, createPoll, listPolls, loadPolls, savePolls } from "../app/store.mjs";

test("createPoll rejects fewer than two options and changes nothing", () => {
  const polls = [];
  assert.throws(() => createPoll(polls, { question: "Lunch?", options: ["Pizza"] }), /options must have 2 to 10 entries/);
  assert.equal(polls.length, 0);
});

test("createPoll trims the question and options and starts every tally at zero", () => {
  const polls = [];
  const poll = createPoll(polls, { question: "  Best tea?  ", options: [" Green ", "Black"] });
  assert.equal(poll.question, "Best tea?");
  assert.deepEqual(poll.options, [{ label: "Green", votes: 0 }, { label: "Black", votes: 0 }]);
  assert.equal(polls.length, 1);
});

test("castVote counts one vote for a voter", () => {
  const polls = [];
  const poll = createPoll(polls, { question: "Best tea?", options: ["Green", "Black"] });
  assert.deepEqual(castVote(polls, poll.id, 1, "voter-a"), { ok: true });
  assert.equal(poll.options[1].votes, 1);
});

test("castVote refuses a second vote from the same voter", () => {
  const polls = [];
  const poll = createPoll(polls, { question: "Best tea?", options: ["Green", "Black"] });
  castVote(polls, poll.id, 1, "voter-a");
  assert.deepEqual(castVote(polls, poll.id, 0, "voter-a"), { ok: false, reason: "already_voted" });
  assert.equal(poll.options[0].votes, 0);
  assert.equal(poll.options[1].votes, 1);
});

test("castVote reports an unknown poll and an out-of-range option", () => {
  const polls = [];
  const poll = createPoll(polls, { question: "Best tea?", options: ["Green", "Black"] });
  assert.deepEqual(castVote(polls, "missing", 0, "voter-a"), { ok: false, reason: "not_found" });
  assert.deepEqual(castVote(polls, poll.id, 5, "voter-a"), { ok: false, reason: "bad_option" });
});

test("listPolls hides voter ids and adds a total", () => {
  const polls = [];
  const poll = createPoll(polls, { question: "Best tea?", options: ["Green", "Black"] });
  castVote(polls, poll.id, 0, "voter-a");
  const [listed] = listPolls(polls);
  assert.equal("voters" in listed, false);
  assert.equal(listed.totalVotes, 1);
});

test("savePolls and loadPolls round-trip, and a missing file loads as empty", async () => {
  const dir = await mkdtemp(join(tmpdir(), "poll-store-"));
  try {
    const file = join(dir, "nested", "polls.json");
    assert.deepEqual(await loadPolls(file), []);
    const polls = [];
    createPoll(polls, { question: "Best tea?", options: ["Green", "Black"] });
    await savePolls(file, polls);
    const loaded = await loadPolls(file);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].question, "Best tea?");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
