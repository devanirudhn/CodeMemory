const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

export function createLlmService({ apiKey, model, fetchImpl = fetch }) {
  return {
    async review({ code, language, memorySources, reflection }) {
      if (!apiKey) {
        const error = new Error("Groq is not configured. Set GROQ_API_KEY on the backend.");
        error.status = 503;
        throw error;
      }

      const system = [
        "You are CodeMemory, a precise code review agent. Review correctness, security, reliability, and maintainability. Be specific and avoid nitpicks.",
        "Separate general engineering findings from team-specific recommendations. Only make a team-specific recommendation when it is grounded in the supplied Hindsight memory evidence. Cite its exact memory ID in memoryIds. Never invent prior reviews, feedback, conventions, or memory IDs.",
        "Return only a JSON object with summary, overallRisk (low|medium|high), issues (severity, title, description, line, recommendation), and teamSpecificRecommendations (recommendation, reason, memoryBased, memoryIds). Use null when the line is unknown.",
      ].join(" ");
      const user = JSON.stringify({
        language,
        code,
        relevantHindsightMemories: memorySources.map(({ id, text, context }) => ({ id, text, context })),
        hindsightReflection: reflection || null,
        instruction:
          "Use the retrieved team context when relevant. Without relevant memory, give only a generic review and return an empty teamSpecificRecommendations array.",
      });

      let response;
      try {
        response = await fetchImpl(GROQ_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            max_tokens: 1800,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
        });
      } catch {
        const error = new Error("Could not reach Groq. Check the backend network connection and try again.");
        error.status = 502;
        throw error;
      }

      if (!response.ok) {
        const message = response.status === 401
          ? "Groq rejected the API key. Check GROQ_API_KEY."
          : response.status === 429
            ? "Groq is rate limiting requests. Try again shortly."
            : `Groq could not complete the review (HTTP ${response.status}).`;
        const error = new Error(message);
        error.status = response.status === 401 ? 503 : 502;
        throw error;
      }

      const payload = await response.json();
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        return "";
      }
      return content;
    },
  };
}
