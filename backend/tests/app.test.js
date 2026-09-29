import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app.js";

async function withServer(app, callback) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function fakeHindsight(events) {
  const stored = [];
  return {
    stored,
    async createBank(bankId) { events.push(["createBank", bankId]); },
    async getVersion() { return { api_version: "test", features: {} }; },
    async retain(bankId, content, options) {
      events.push(["retain", options.metadata.category]);
      stored.push({ id: `memory-${stored.length + 1}`, text: content, context: options.context, metadata: options.metadata, tags: options.tags });
      return { success: true };
    },
    async recall(_bankId, query) {
      events.push(["recall", query]);
      return { results: stored.map((item) => ({ ...item, type: "world" })) };
    },
    async reflect() { events.push(["reflect"]); return { text: "The team prefers async/await." }; },
    async listMemories() { return { total: stored.length, items: stored }; },
  };
}

function fakeGroq(events) {
  return async (_url, options) => {
    events.push(["groq"]);
    const request = JSON.parse(options.body);
    const supplied = JSON.parse(request.messages[1].content);
    const citedId = supplied.relevantHindsightMemories[0]?.id;
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        summary: citedId ? "Matches a learned team standard." : "Generic review, no matching team memory.",
        overallRisk: "low",
        issues: [],
        teamSpecificRecommendations: citedId ? [{
          recommendation: "Use async/await instead of the Promise chain.",
          reason: "This follows the team's learned preference.",
          memoryBased: true,
          memoryIds: [citedId],
        }] : [],
      }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

test("health, review, learning, recall, feedback, and history use the configured services", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codememory-test-"));
  const events = [];
  const hindsight = fakeHindsight(events);
  const app = createApp({
    env: { HINDSIGHT_API_URL: "http://hindsight.test", GROQ_API_KEY: "test-key", CODEMEMORY_TEAM_ID: "demo-team" },
    hindsightClient: hindsight,
    fetchImpl: fakeGroq(events),
    historyFile: path.join(directory, "reviews.json"),
  });
  try {
    await withServer(app, async (baseUrl) => {
      let response = await fetch(`${baseUrl}/api/health`);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).integrations.hindsight, "connected");

      const code = "function getUser(id) { return db.findUser(id).then(user => user); }";
      response = await fetch(`${baseUrl}/api/review`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, language: "JavaScript" }),
      });
      assert.equal(response.status, 201);
      const before = await response.json();
      assert.match(before.summary, /Generic review/);
      assert.deepEqual(before.memorySources, []);

      response = await fetch(`${baseUrl}/api/memory`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Our team prefers async/await instead of Promise chains." }),
      });
      assert.equal(response.status, 201);

      response = await fetch(`${baseUrl}/api/review`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "function fetchOrders(id) { return getUser(id).then(user => getOrders(user.id)); }", language: "JavaScript" }),
      });
      assert.equal(response.status, 201);
      const after = await response.json();
      assert.equal(after.memorySources.length, 2);
      assert.match(after.teamSpecificRecommendations[0].recommendation, /async\/await/);
      assert.ok(after.teamSpecificRecommendations[0].memoryIds.includes(after.memorySources[0].id));

      response = await fetch(`${baseUrl}/api/memory/feedback`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId: after.id, targetType: "team_recommendation", index: 0, decision: "accepted" }),
      });
      assert.equal(response.status, 201);
      assert.equal((await response.json()).review.feedback[0].decision, "accepted");

      response = await fetch(`${baseUrl}/api/reviews`);
      assert.equal((await response.json()).reviews.length, 2);
      response = await fetch(`${baseUrl}/api/reviews/${after.id}`);
      assert.equal((await response.json()).id, after.id);
      response = await fetch(`${baseUrl}/api/memory`);
      const memories = await response.json();
      assert.equal(memories.total, 4);
      assert.equal(memories.items[1].metadata.category, "team_preference");

      const secondRecall = events.map((event) => event[0]).lastIndexOf("recall");
      const secondReviewOperations = events.slice(secondRecall + 1);
      assert.deepEqual(secondReviewOperations.slice(0, 2).map((event) => event[0]), ["reflect", "groq"]);
      assert.equal(events.filter((event) => event[0] === "createBank").length, 1);
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reports missing Hindsight configuration without claiming a connection", async () => {
  const app = createApp({ env: {}, historyFile: path.join(os.tmpdir(), `codememory-empty-${Date.now()}.json`) });
  await withServer(app, async (baseUrl) => {
    let response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 503);
    const health = await response.json();
    assert.equal(health.integrations.hindsight, "not configured");
    assert.equal(health.integrations.groq, "not configured");

    response = await fetch(`${baseUrl}/api/review`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "  ", language: "JavaScript" }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Paste code/);
  });
});
