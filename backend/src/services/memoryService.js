const MEMORY_TAG = "codememory";

export function createMemoryService({ client, bankId }) {
  async function ensureBank() {
    await client.createBank(bankId, {
      name: "CodeMemory Engineering Team",
      reflectMission:
        "Help the engineering team apply its established coding standards and review history. Distinguish explicit team preferences from general engineering advice.",
      retainMission:
        "Retain explicit team coding standards, review decisions, and recurring engineering conventions. Do not retain source code or secrets.",
    });
  }

  async function retainMemory(content, { category, source = "team" }) {
    const normalized = content.trim();
    if (!normalized) {
      throw new Error("Memory content cannot be empty.");
    }

    await client.retain(bankId, normalized, {
      context: `CodeMemory ${category.replaceAll("_", " ")}`,
      tags: [MEMORY_TAG, category],
      metadata: { category, source },
    });

    return { content: normalized, category, source };
  }

  async function recallMemories(query) {
    const response = await client.recall(bankId, query, {
      budget: "mid",
      maxTokens: 1800,
      includeEntities: false,
    });
    return (response.results ?? []).filter((item) => item.text?.trim());
  }

  async function reflectOnMemories(query) {
    const response = await client.reflect(bankId, query, {
      budget: "low",
      includeFacts: true,
    });
    return response.text?.trim() ?? "";
  }

  async function listMemories() {
    const response = await client.listMemories(bankId, { limit: 50, offset: 0 });
    return {
      total: response.total ?? response.items?.length ?? 0,
      items: (response.items ?? []).map((item) => ({
        id: item.id,
        text: item.text ?? item.content ?? "",
        context: item.context ?? "Team memory",
        metadata: item.metadata ?? {},
        tags: item.tags ?? [],
        createdAt: item.createdAt ?? item.mentionedAt ?? null,
      })),
    };
  }

  return { bankId, ensureBank, retainMemory, recallMemories, reflectOnMemories, listMemories };
}

export { MEMORY_TAG };
