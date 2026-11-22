const pollList = document.getElementById("polls");
const createForm = document.getElementById("create-form");
const createStatus = document.getElementById("create-status");
const voteMessages = new Map();

async function loadPolls() {
  const response = await fetch("/api/polls");
  const body = await response.json();
  pollList.replaceChildren(...body.polls.map(renderPoll));
}

function renderPoll(poll) {
  const card = document.createElement("article");
  card.className = "poll";
  const title = document.createElement("h2");
  title.textContent = poll.question;
  card.append(title);
  poll.options.forEach((option, index) => {
    const row = document.createElement("div");
    row.className = "option";
    const label = document.createElement("span");
    label.textContent = `${option.label} (${option.votes})`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Vote";
    button.addEventListener("click", () => castVote(poll.id, index));
    row.append(label);
    if (index === poll.yourVote) {
      const mark = document.createElement("span");
      mark.className = "your-vote";
      mark.textContent = "Your vote";
      row.append(mark);
    }
    row.append(button);
    card.append(row);
  });
  const message = document.createElement("p");
  message.className = "status";
  message.textContent = voteMessages.get(poll.id) ?? "";
  card.append(message);
  return card;
}

async function castVote(pollId, option) {
  try {
    const response = await fetch(`/api/polls/${pollId}/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ option })
    });
    if (response.status === 409) {
      voteMessages.set(pollId, "You already voted on this poll.");
    } else if (response.ok) {
      voteMessages.set(pollId, "Vote counted.");
    } else {
      const body = await response.json();
      voteMessages.set(pollId, `Vote failed: ${body.error}`);
    }
    await loadPolls();
  } catch {
    voteMessages.set(pollId, "Could not reach the server.");
  }
}

async function createPoll() {
  const question = document.getElementById("question").value;
  const options = document.getElementById("options").value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  try {
    const response = await fetch("/api/polls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, options })
    });
    const body = await response.json();
    if (response.ok) {
      createForm.reset();
      createStatus.className = "status";
      createStatus.textContent = "Poll created.";
    } else {
      createStatus.className = "status error";
      createStatus.textContent = body.error;
    }
    await loadPolls();
  } catch {
    createStatus.className = "status error";
    createStatus.textContent = "Could not reach the server.";
  }
}

createForm.addEventListener("submit", (event) => {
  event.preventDefault();
  createPoll();
});

loadPolls();
