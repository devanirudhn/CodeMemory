const MAX_CODE_LENGTH = 24000;

function safeString(value, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, 1600) : fallback;
}

function parseModelReview(raw, memorySources) {
  let parsed;
  try {
    const content = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try {
      parsed = JSON.parse(content);
    } catch {
      const start = content.indexOf("{");
      const end = content.lastIndexOf("}");
      if (start >= 0 && end > start) parsed = JSON.parse(content.slice(start, end + 1));
      else throw new Error("No JSON object in model response");
    }
  } catch {
    return {
      summary: safeString(raw, "The review model returned an empty response."),
      overallRisk: "low",
      issues: [],
      teamSpecificRecommendations: [],
      parseWarning: "The response was not valid structured JSON; showing its text safely.",
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      summary: safeString(raw, "The review model returned an invalid structured response."),
      overallRisk: "low",
      issues: [],
      teamSpecificRecommendations: [],
      parseWarning: "The response did not match the expected review object; showing its text safely.",
    };
  }

  const allowedSeverities = new Set(["critical", "warning", "suggestion"]);
  const issues = Array.isArray(parsed.issues)
    ? parsed.issues.slice(0, 20).map((value) => {
        const issue = value && typeof value === "object" ? value : {};
        return {
        severity: allowedSeverities.has(issue.severity) ? issue.severity : "suggestion",
        title: safeString(issue.title, "Code quality observation"),
        description: safeString(issue.description),
        line: Number.isInteger(issue.line) && issue.line > 0 ? issue.line : null,
        recommendation: safeString(issue.recommendation),
        };
      })
    : [];
  const evidenceIds = new Set(memorySources.map((item) => item.id).filter(Boolean));
  const teamSpecificRecommendations = Array.isArray(parsed.teamSpecificRecommendations)
    ? parsed.teamSpecificRecommendations.slice(0, 10).flatMap((value) => {
        const item = value && typeof value === "object" ? value : {};
        const memoryIds = Array.isArray(item.memoryIds)
          ? item.memoryIds.filter((id) => evidenceIds.has(id))
          : [];
        if (!item.memoryBased || memoryIds.length === 0) return [];
        return [{
          recommendation: safeString(item.recommendation),
          reason: safeString(item.reason),
          memoryBased: true,
          memoryIds,
        }];
      })
    : [];

  return {
    summary: safeString(parsed.summary, "Review completed."),
    overallRisk: ["low", "medium", "high"].includes(parsed.overallRisk)
      ? parsed.overallRisk
      : "low",
    issues,
    teamSpecificRecommendations,
  };
}

function recallQuery(code, language) {
  const patterns = [];
  if (/\.then\s*\(/.test(code)) patterns.push("Promise chains");
  if (/\basync\b|\bawait\b/.test(code)) patterns.push("async/await patterns");
  if (/\bif\s*\([^)]*\)\s*\{\s*if\b/s.test(code)) patterns.push("nested conditionals and early returns");
  if (/\b(controller|route|handler)\b/i.test(code)) patterns.push("controller and service boundaries");
  return `Team coding standards and previous code review feedback for ${language}; relevant patterns: ${patterns.join(", ") || "general maintainability, validation, and error handling"}.`;
}

export function createReviewService({ memoryService, llmService, historyService }) {
  return async function reviewCode({ code, language }) {
    if (typeof code !== "string" || !code.trim()) {
      const error = new Error("Paste code or a diff before starting the review.");
      error.status = 400;
      throw error;
    }
    if (code.length > MAX_CODE_LENGTH) {
      const error = new Error(`Code is too large. Keep submissions under ${MAX_CODE_LENGTH.toLocaleString()} characters.`);
      error.status = 413;
      throw error;
    }

    const memories = await memoryService.recallMemories(recallQuery(code, language));
    const memorySources = memories.map((item) => ({
      id: item.id ?? null,
      text: item.text,
      context: item.context ?? null,
      metadata: item.metadata ?? {},
      tags: item.tags ?? [],
    }));
    const reflection = memorySources.length
      ? await memoryService.reflectOnMemories(
          `Given the retrieved engineering memories, what established team conventions apply when reviewing ${language} code? Cite only conventions grounded in memories.`,
        )
      : "";

    const result = await llmService.review({ code, language, memorySources, reflection });
    const review = {
      ...parseModelReview(result, memorySources),
      language,
      memorySources,
      memoryReflection: reflection,
      createdAt: new Date().toISOString(),
    };

    await memoryService.retainMemory(
      `A ${language} code review was completed with ${review.overallRisk} overall risk. Summary: ${review.summary}. Findings: ${review.issues.map((issue) => issue.title).filter(Boolean).join("; ") || "No actionable findings"}.`,
      { category: "review_outcome", source: "review" },
    );

    return historyService.save(review);
  };
}

export { MAX_CODE_LENGTH, parseModelReview, recallQuery };
