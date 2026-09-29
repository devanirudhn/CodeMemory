import cors from "cors";
import express from "express";
import { HindsightClient } from "@vectorize-io/hindsight-client";
import { createHistoryService } from "./services/historyService.js";
import { createLlmService } from "./services/llmService.js";
import { createMemoryService } from "./services/memoryService.js";
import { createReviewService, MAX_CODE_LENGTH } from "./services/reviewService.js";
import path from "node:path";

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function createApp({ env = process.env, fetchImpl = fetch, hindsightClient, historyFile } = {}) {
  const bankId = (env.CODEMEMORY_TEAM_ID || "demo-team").toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 64);
  const client = hindsightClient ?? new HindsightClient({
    baseUrl: env.HINDSIGHT_API_URL || "",
    apiKey: env.HINDSIGHT_API_KEY || undefined,
  });
  const memoryService = createMemoryService({ client, bankId });
  const historyService = createHistoryService(
    historyFile || path.resolve(env.CODEMEMORY_DATA_DIR || ".data", "reviews.json"),
  );
  const llmService = createLlmService({
    apiKey: env.GROQ_API_KEY,
    model: env.GROQ_MODEL || "openai/gpt-oss-120b",
    fetchImpl,
  });
  const reviewCode = createReviewService({ memoryService, llmService, historyService });
  const app = express();
  let bankReady;

  app.disable("x-powered-by");
  app.use(express.json({ limit: "128kb" }));
  const allowedOrigin = env.FRONTEND_URL;
  if (allowedOrigin) app.use(cors({ origin: allowedOrigin, methods: ["GET", "POST"] }));

  async function ensureMemoryReady() {
    if (!env.HINDSIGHT_API_URL) {
      throw httpError("Hindsight is not configured. Set HINDSIGHT_API_URL and start a Hindsight API.", 503);
    }
    bankReady ??= memoryService.ensureBank();
    try {
      await bankReady;
    } catch {
      bankReady = undefined;
      throw httpError("Hindsight is unavailable. Check HINDSIGHT_API_URL and HINDSIGHT_API_KEY.", 503);
    }
  }

  app.get("/api/health", async (_request, response) => {
    let hindsight = "not configured";
    if (env.HINDSIGHT_API_URL) {
      try {
        await ensureMemoryReady();
        await client.getVersion();
        hindsight = "connected";
      } catch {
        hindsight = "unavailable";
      }
    }
    const groq = env.GROQ_API_KEY ? "configured" : "not configured";
    response.status(hindsight === "connected" && groq === "configured" ? 200 : 503).json({
      status: hindsight === "connected" && groq === "configured" ? "ready" : "degraded",
      teamId: bankId,
      integrations: { hindsight, groq },
    });
  });

  app.post("/api/review", async (request, response, next) => {
    try {
      const { code, language } = request.body ?? {};
      if (typeof code !== "string" || !code.trim()) {
        throw httpError("Paste code or a diff before starting the review.");
      }
      if (code.length > MAX_CODE_LENGTH) {
        throw httpError(`Code is too large. Keep submissions under ${MAX_CODE_LENGTH.toLocaleString()} characters.`, 413);
      }
      if (typeof language !== "string" || !language.trim() || language.length > 40) {
        throw httpError("Choose a programming language for this review.");
      }
      await ensureMemoryReady();
      response.status(201).json(await reviewCode({ code, language: language.trim() }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/memory", async (_request, response, next) => {
    try {
      await ensureMemoryReady();
      response.json(await memoryService.listMemories());
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/memory", async (request, response, next) => {
    try {
      await ensureMemoryReady();
      const { content } = request.body ?? {};
      if (typeof content !== "string" || !content.trim()) throw httpError("Enter a team standard to remember.");
      if (content.length > 1600) throw httpError("Team memory must be 1,600 characters or fewer.", 413);
      const memory = await memoryService.retainMemory(content, { category: "team_preference" });
      response.status(201).json({ memory });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/memory/feedback", async (request, response, next) => {
    try {
      await ensureMemoryReady();
      const { reviewId, targetType, index, decision } = request.body ?? {};
      if (!reviewId || !["issue", "team_recommendation"].includes(targetType) || !Number.isInteger(index)
        || !["accepted", "rejected"].includes(decision)) {
        throw httpError("Choose a review recommendation and accept or reject it.");
      }
      const review = await historyService.get(reviewId);
      if (!review) throw httpError("That review could not be found.", 404);
      const collection = targetType === "issue" ? review.issues : review.teamSpecificRecommendations;
      const item = collection?.[index];
      if (!item) throw httpError("That recommendation could not be found.", 404);
      const verb = decision === "accepted" ? "accepted" : "rejected";
      await memoryService.retainMemory(
        `The team ${verb} this ${targetType === "issue" ? "general review finding" : "team-specific recommendation"}: ${item.recommendation || item.title}. Review context: ${review.language}, ${review.summary}`,
        { category: `feedback_${decision}`, source: "feedback" },
      );
      const updated = await historyService.updateFeedback(reviewId, { targetType, index, decision });
      response.status(201).json({ review: updated });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/reviews", async (_request, response, next) => {
    try {
      response.json({ reviews: await historyService.list() });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/reviews/:id", async (request, response, next) => {
    try {
      const review = await historyService.get(request.params.id);
      if (!review) throw httpError("Review not found.", 404);
      response.json(review);
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _request, response, _next) => {
    const status = Number.isInteger(error.status) ? error.status : 502;
    const isCreditError = typeof error.message === "string" && /insufficient credits/i.test(error.message);
    const message = error.type === "entity.too.large"
      ? "Request body is too large. Keep code submissions under 24,000 characters."
      : isCreditError
        ? "Hindsight has insufficient credits for this operation. Add credits or configure a funded/local Hindsight API."
      : status >= 500 && !error.status
        ? "The request could not be completed. Check service configuration and try again."
        : error.message;
    response.status(status).json({ error: message });
  });

  return app;
}
