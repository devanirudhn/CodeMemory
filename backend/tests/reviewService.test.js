import test from "node:test";
import assert from "node:assert/strict";
import { createReviewService, parseModelReview } from "../src/services/reviewService.js";

const validMemory = {
  id: "memory-async-pref",
  text: "The team prefers async/await over Promise chains.",
  context: "CodeMemory team preference",
  metadata: { category: "team_preference" },
};

test("recalls and reflects before review, and exposes only cited retrieved memories", async () => {
  const events = [];
  const history = { async save(review) { events.push("history"); return { id: "review-1", ...review }; } };
  const memory = {
    async recallMemories(query) {
      events.push("recall");
      assert.match(query, /Promise chains/);
      return [validMemory];
    },
    async reflectOnMemories() { events.push("reflect"); return "Prefer async/await."; },
    async retainMemory(content, options) {
      events.push("retain");
      assert.equal(options.category, "review_outcome");
      assert.doesNotMatch(content, /function fetchOrders/);
    },
  };
  const llm = {
    async review(input) {
      events.push("groq");
      assert.equal(input.memorySources[0].id, validMemory.id);
      assert.equal(input.reflection, "Prefer async/await.");
      return JSON.stringify({
        summary: "Promise chain is hard to follow.",
        overallRisk: "low",
        issues: [],
        teamSpecificRecommendations: [
          {
            recommendation: "Use async/await.",
            reason: "This matches the team preference.",
            memoryBased: true,
            memoryIds: [validMemory.id],
          },
          {
            recommendation: "Invented evidence.",
            reason: "This ID was not recalled.",
            memoryBased: true,
            memoryIds: ["not-recalled"],
          },
        ],
      });
    },
  };

  const reviewCode = createReviewService({ memoryService: memory, llmService: llm, historyService: history });
  const review = await reviewCode({
    language: "javascript",
    code: "function fetchOrders() { return getUser().then(user => user); }",
  });

  assert.deepEqual(events, ["recall", "reflect", "groq", "retain", "history"]);
  assert.equal(review.teamSpecificRecommendations.length, 1);
  assert.equal(review.teamSpecificRecommendations[0].memoryIds[0], validMemory.id);
  assert.equal(review.memorySources[0].text, validMemory.text);
});

test("does not report memory-based advice when Hindsight recalled nothing", async () => {
  const memory = {
    async recallMemories() { return []; },
    async reflectOnMemories() { assert.fail("reflect should be skipped without recalled memories"); },
    async retainMemory() {},
  };
  const llm = {
    async review() {
      return JSON.stringify({
        summary: "Generic review.",
        overallRisk: "low",
        issues: [],
        teamSpecificRecommendations: [
          { recommendation: "Claimed team rule", reason: "Not grounded", memoryBased: true, memoryIds: ["fake"] },
        ],
      });
    },
  };
  const history = { async save(review) { return review; } };
  const reviewCode = createReviewService({ memoryService: memory, llmService: llm, historyService: history });
  const review = await reviewCode({ language: "javascript", code: "const ready = true;" });
  assert.deepEqual(review.teamSpecificRecommendations, []);
  assert.deepEqual(review.memorySources, []);
});

test("rejects empty and oversized submissions before contacting integrations", async () => {
  const reviewCode = createReviewService({
    memoryService: { async recallMemories() { assert.fail("memory must not be called"); } },
    llmService: { async review() { assert.fail("Groq must not be called"); } },
    historyService: {},
  });
  await assert.rejects(reviewCode({ language: "javascript", code: " " }), { status: 400 });
  await assert.rejects(reviewCode({ language: "javascript", code: "x".repeat(24001) }), { status: 413 });
});

test("falls back safely for malformed and wrong-shaped model output", () => {
  const malformed = parseModelReview("not JSON", []);
  assert.equal(malformed.issues.length, 0);
  assert.ok(malformed.parseWarning);

  const wrongShape = parseModelReview('{"issues":[null],"teamSpecificRecommendations":[null]}', []);
  assert.equal(wrongShape.issues[0].title, "Code quality observation");
  assert.deepEqual(wrongShape.teamSpecificRecommendations, []);

  const nonObject = parseModelReview("null", []);
  assert.equal(nonObject.issues.length, 0);
  assert.ok(nonObject.parseWarning);
});
