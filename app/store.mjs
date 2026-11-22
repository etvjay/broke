import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const QUESTION_MAX = 200;
export const OPTION_MAX = 100;
export const OPTIONS_MIN = 2;
export const OPTIONS_MAX = 10;

export async function loadPolls(file) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const polls = JSON.parse(text);
  if (!Array.isArray(polls)) throw new Error(`${file} does not hold a list of polls`);
  return polls;
}

export async function savePolls(file, polls) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(polls, null, 2)}\n`);
  await rename(temp, file);
}

export function createPoll(polls, input) {
  const poll = {
    id: randomUUID(),
    question: cleanText(input?.question, "question", QUESTION_MAX),
    options: cleanOptions(input?.options).map(startTally),
    voters: [],
    createdAt: new Date().toISOString()
  };
  polls.push(poll);
  return poll;
}

export function castVote(polls, pollId, optionIndex, voterId) {
  const poll = findPoll(polls, pollId);
  if (!poll) return { ok: false, reason: "not_found" };
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= poll.options.length) {
    return { ok: false, reason: "bad_option" };
  }
  if (poll.voters.includes(voterId)) return { ok: false, reason: "already_voted" };
  poll.options[optionIndex].votes += 1;
  poll.voters.push(voterId);
  return { ok: true };
}

export function findPoll(polls, pollId) {
  for (const poll of polls) {
    if (poll.id === pollId) return poll;
  }
  return null;
}

export function listPolls(polls) {
  return polls.map(publicPoll);
}

export function publicPoll(poll) {
  return {
    id: poll.id,
    question: poll.question,
    options: poll.options.map(copyTally),
    totalVotes: poll.options.reduce(addVotes, 0),
    createdAt: poll.createdAt
  };
}

function cleanText(value, label, max) {
  if (typeof value !== "string") throw invalid(`${label} must be text`);
  const text = value.trim();
  if (text.length === 0) throw invalid(`${label} is required`);
  if (text.length > max) throw invalid(`${label} must be ${max} characters or fewer`);
  return text;
}

function cleanOptions(value) {
  if (!Array.isArray(value)) throw invalid("options must be a list");
  if (value.length < OPTIONS_MIN || value.length > OPTIONS_MAX) {
    throw invalid(`options must have ${OPTIONS_MIN} to ${OPTIONS_MAX} entries`);
  }
  return value.map(cleanOption);
}

function cleanOption(value) {
  return cleanText(value, "option", OPTION_MAX);
}

function startTally(label) {
  return { label, votes: 0 };
}

function copyTally(tally) {
  return { label: tally.label, votes: tally.votes };
}

function addVotes(total, tally) {
  return total + tally.votes;
}

function invalid(message) {
  return Object.assign(new Error(message), { name: "ValidationError" });
}
