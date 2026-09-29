import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export function createHistoryService(filePath) {
  let queue = Promise.resolve();

  async function readStore() {
    try {
      return JSON.parse(await readFile(filePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return { reviews: [] };
      throw new Error("Review history could not be read.");
    }
  }

  async function writeStore(store) {
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(store, null, 2), "utf8");
    await rename(temporaryPath, filePath);
  }

  function serialize(action) {
    const operation = queue.then(action, action);
    queue = operation.catch(() => undefined);
    return operation;
  }

  return {
    save(review) {
      return serialize(async () => {
        const store = await readStore();
        const saved = { id: randomUUID(), feedback: [], ...review };
        store.reviews.unshift(saved);
        store.reviews = store.reviews.slice(0, 200);
        await writeStore(store);
        return saved;
      });
    },
    get(id) {
      return serialize(async () => (await readStore()).reviews.find((review) => review.id === id) ?? null);
    },
    list() {
      return serialize(async () => (await readStore()).reviews);
    },
    updateFeedback(id, feedback) {
      return serialize(async () => {
        const store = await readStore();
        const review = store.reviews.find((item) => item.id === id);
        if (!review) return null;
        review.feedback ??= [];
        const existing = review.feedback.findIndex(
          (item) => item.targetType === feedback.targetType && item.index === feedback.index,
        );
        if (existing >= 0) review.feedback.splice(existing, 1);
        review.feedback.push({ ...feedback, createdAt: new Date().toISOString() });
        await writeStore(store);
        return review;
      });
    },
  };
}
