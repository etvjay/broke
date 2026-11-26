import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const QUESTION_MAX = 200;
export const OPTION_MAX = 100;
export const OPTIONS_MIN = 2;
export const OPTIONS_MAX = 10;
const SUBMISSION_ID = /^[A-Za-z0-9_-]{8,100}$/;

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
  return polls.map(upgradeBallots);
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
    ballots: {},
    createdAt: new Date().toISOString()
  };
  const submissionId = cleanSubmissionId(input?.submissionId);
  if (submissionId !== null) poll.submissionId = submissionId;
  polls.push(poll);
  return poll;
}

export function findSubmission(polls, submissionId) {
  if (typeof submissionId !== "string") return null;
  for (const poll of polls) {
    if (poll.submissionId === submissionId) return poll;
  }
  return null;
}

export function castVote(polls, pollId, optionIndex, voterId) {
  const poll = findPoll(polls, pollId);
  if (!poll) return { ok: false, reason: "not_found" };
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= poll.options.length) {
    return { ok: false, reason: "bad_option" };
  }
  if (Object.hasOwn(poll.ballots, voterId)) return { ok: false, reason: "already_voted" };
  poll.options[optionIndex].votes += 1;
  poll.ballots[voterId] = optionIndex;
  return { ok: true };
}

export function findPoll(polls, pollId) {
  for (const poll of polls) {
    if (poll.id === pollId) return poll;
  }
  return null;
}

export function listPolls(polls, voterId) {
  return polls.toReversed().map(function viewFor(poll) {
    return publicPoll(poll, voterId);
  });
}

export function publicPoll(poll, voterId) {
  return {
    id: poll.id,
    question: poll.question,
    options: poll.options.map(copyTally),
    totalVotes: poll.options.reduce(addVotes, 0),
    yourVote: ballotOf(poll, voterId),
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

function cleanSubmissionId(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !SUBMISSION_ID.test(value)) {
    throw invalid("submissionId must be 8 to 100 letters, digits, dashes, or underscores");
  }
  return value;
}

function cleanOptions(value) {
  if (!Array.isArray(value)) throw invalid("options must be a list");
  if (value.length < OPTIONS_MIN || value.length > OPTIONS_MAX) {
    throw invalid(`options must have ${OPTIONS_MIN} to ${OPTIONS_MAX} entries`);
  }
  const options = value.map(cleanOption);
  if (new Set(options.map(lowerLabel)).size < options.length) {
    throw invalid("options must be different from each other");
  }
  return options;
}

function cleanOption(value) {
  return cleanText(value, "option", OPTION_MAX);
}

function lowerLabel(label) {
  return label.replace(/\s+/g, " ").toLowerCase();
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

function upgradeBallots(poll) {
  if (poll.ballots) return poll;
  const { voters = [], ...rest } = poll;
  const ballots = {};
  for (const voterId of voters) ballots[voterId] = null;
  return { ...rest, ballots };
}

function ballotOf(poll, voterId) {
  return Object.hasOwn(poll.ballots, voterId) ? poll.ballots[voterId] : null;
}

function invalid(message) {
  return Object.assign(new Error(message), { name: "ValidationError" });
}
