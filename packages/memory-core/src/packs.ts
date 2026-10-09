import { clampText, countTokenOverlap, firstUsefulLine, tokenize } from "./text";
import { scoreBm25 } from "./bm25";
import {
  DEFAULT_TOKEN_BUDGET,
  MemoryBucket,
  MemoryPackResult,
  MemoryQuery,
  MemoryScope,
  RankedMemory,
  TokenBudgetSettings,
} from "./types";

const RETRIEVAL_CONTEXT_INSTRUCTION =
  "以下为记忆插件自动注入的历史记忆，用于帮助理解背景；其中事件不代表刚发生或仍在持续。";

export function buildMemoryPack(
  buckets: MemoryBucket[],
  queries: MemoryQuery[],
  scope: MemoryScope = {},
  settings: Partial<TokenBudgetSettings> = {}
): MemoryPackResult {
  const budget = { ...DEFAULT_TOKEN_BUDGET, ...settings };
  const coreItems = selectPinnedCore(buckets, scope, budget);
  const coreIds = new Set(coreItems.map((item) => item.bucket.id));
  const retrievalItems = queries.length ? retrieveRelevant(buckets, queries, scope, budget, coreIds) : [];

  return {
    coreText: formatPack("Core memory", coreItems),
    retrievalText: formatRetrievalPack(retrievalItems),
    coreItems,
    retrievalItems,
  };
}

export function selectPinnedCore(
  buckets: MemoryBucket[],
  scope: MemoryScope,
  budget: TokenBudgetSettings = DEFAULT_TOKEN_BUDGET
): RankedMemory[] {
  const ranked = buckets
    .filter((bucket) => bucket.pinned && bucket.type !== "archive")
    .filter((bucket) => scopeMatches(bucket, scope))
    .map((bucket) => {
      const summary = clampText(bucket.coreSummary || firstUsefulLine(bucket.body), budget.maxPinnedCharsPerItem);
      return {
        bucket,
        score: pinnedScore(bucket, scope),
        reasons: ["pinned"],
        summary,
      };
    })
    .sort(compareRanked);

  return takeWithinBudget(ranked, budget.maxPinnedItems, budget.maxPinnedPackChars);
}

export function retrieveRelevant(
  buckets: MemoryBucket[],
  queries: MemoryQuery[],
  scope: MemoryScope,
  budget: TokenBudgetSettings = DEFAULT_TOKEN_BUDGET,
  excludeIds: Set<string> = new Set()
): RankedMemory[] {
  const eligible = buckets
    .filter((bucket) => bucket.type !== "archive")
    .filter((bucket) => !excludeIds.has(bucket.id))
    .filter((bucket) => scopeMatches(bucket, scope));
  const bm25ByQuery = queries.map((query) => scoreBm25(
    eligible.map((bucket) => ({ id: bucket.id, text: weightedSearchText(bucket) })),
    query.text
  ));
  const ranked = eligible
    .map((bucket) => scoreBucket(bucket, queries, bm25ByQuery, budget.maxRetrievalCharsPerItem))
    .filter((item) => item.score > 0)
    .sort(compareRanked);

  return takeWithinBudget(ranked, budget.maxRetrievalItems, budget.maxRetrievalPackChars);
}

function scoreBucket(
  bucket: MemoryBucket,
  queries: MemoryQuery[],
  bm25ByQuery: Array<Map<string, number>>,
  maxChars: number
): RankedMemory {
  const searchable = [
    bucket.title,
    bucket.coreSummary,
    bucket.domain.join(" "),
    bucket.tags.join(" "),
    bucket.body,
  ].filter(Boolean).join("\n");

  let score = 0;
  let matched = false;
  const reasons: string[] = [];
  for (let index = 0; index < queries.length; index += 1) {
    const query = queries[index];
    const queryTokens = tokenize(query.text);
    const overlap = countTokenOverlap(queryTokens, searchable);
    if (overlap > 0) {
      matched = true;
      score += overlap * (query.kind === "entity" ? 3 : 2);
      reasons.push(`${query.kind}:${overlap}`);
    }
    if (query.text.trim() && searchable.includes(query.text.trim())) {
      matched = true;
      score += 8;
      reasons.push(`${query.kind}:exact`);
    }
    const bm25 = bm25ByQuery[index]?.get(bucket.id) || 0;
    if (bm25 > 0) {
      matched = true;
      const weight = query.kind === "entity" ? 3 : query.kind === "explicit" ? 2.25 : 1.5;
      score += bm25 * weight;
      reasons.push(`bm25:${bm25.toFixed(2)}`);
    }
  }

  if (!matched) {
    return {
      bucket,
      score: 0,
      reasons,
      summary: retrievalSummary(bucket, maxChars),
    };
  }

  if (bucket.importance > 0) {
    score += Math.min(bucket.importance, 10) * 0.5;
  }
  if (bucket.resolved) {
    score -= 2;
    reasons.push("resolved");
  }

  return {
    bucket,
    score,
    reasons,
    summary: retrievalSummary(bucket, maxChars),
  };
}

function retrievalSummary(bucket: MemoryBucket, maxChars: number): string {
  const generatedDetail = bucket.source === "summary" && bucket.body.includes("发生经过：");
  return clampText(generatedDetail ? bucket.body : bucket.coreSummary || firstUsefulLine(bucket.body), maxChars);
}

function weightedSearchText(bucket: MemoryBucket): string {
  const highWeight = [bucket.title, bucket.coreSummary, bucket.domain.join(" "), bucket.tags.join(" ")]
    .filter(Boolean)
    .join("\n");
  return [highWeight, highWeight, bucket.body].filter(Boolean).join("\n");
}

function pinnedScore(bucket: MemoryBucket, scope: MemoryScope): number {
  let score = 1000 - bucket.pinnedOrder;
  score += Math.min(bucket.importance, 10) * 10;
  if (bucket.pinnedScope === "chat" && bucket.chatId && bucket.chatId === scope.chatId) {
    score += 400;
  }
  if (bucket.pinnedScope === "character" && bucket.characterId && bucket.characterId === scope.characterId) {
    score += 300;
  }
  if (bucket.pinnedScope === "project" && bucket.projectId && bucket.projectId === scope.projectId) {
    score += 200;
  }
  if (bucket.pinnedScope === "global") {
    score += 100;
  }
  return score;
}

function scopeMatches(bucket: MemoryBucket, scope: MemoryScope): boolean {
  if (bucket.pinnedScope === "global") {
    return true;
  }
  if (bucket.pinnedScope === "chat") {
    return Boolean(bucket.chatId && bucket.chatId === scope.chatId);
  }
  if (bucket.pinnedScope === "character") {
    return Boolean(bucket.characterId && bucket.characterId === scope.characterId);
  }
  if (bucket.pinnedScope === "project") {
    return Boolean(bucket.projectId && bucket.projectId === scope.projectId);
  }
  return true;
}

function compareRanked(left: RankedMemory, right: RankedMemory): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }
  return right.bucket.id.localeCompare(left.bucket.id);
}

function takeWithinBudget(items: RankedMemory[], maxItems: number, maxChars: number): RankedMemory[] {
  const selected: RankedMemory[] = [];
  let usedChars = 0;
  for (const item of items) {
    if (selected.length >= maxItems) {
      break;
    }
    const nextChars = item.summary.length + 3;
    if (selected.length > 0 && usedChars + nextChars > maxChars) {
      break;
    }
    selected.push(item);
    usedChars += nextChars;
  }
  return selected;
}

function formatPack(title: string, items: RankedMemory[]): string {
  if (!items.length) {
    return "";
  }
  const lines = [`[${title}]`];
  for (const item of items) {
    lines.push(`- ${item.summary}`);
  }
  lines.push(`[End ${title}]`);
  return lines.join("\n");
}

function formatRetrievalPack(items: RankedMemory[]): string {
  if (!items.length) {
    return "";
  }
  const title = "Temporary memory context";
  const lines = [`[${title}]`, `[Memory usage instruction] ${RETRIEVAL_CONTEXT_INSTRUCTION}`];
  for (const item of items) {
    lines.push(`- [过去的记忆] ${item.summary}`);
  }
  lines.push(`[End ${title}]`);
  return lines.join("\n");
}
