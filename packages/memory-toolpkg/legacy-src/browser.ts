declare function require(name: string): unknown;

import { createLocalMemoryStore } from "./localStore";

interface MemoryBucketLike {
  id: string;
  type: string;
  domain?: string[];
  tags?: string[];
  title?: string;
  body?: string;
  coreSummary?: string;
  importance?: number;
  pinned?: boolean;
  pinnedScope?: string;
  createdAt?: string;
  updatedAt?: string;
  lastActiveAt?: string | null;
  filePath?: string;
}

export interface MemoryLibraryStats {
  total: number;
  active: number;
  archive: number;
  pinned: number;
  byType: Record<string, number>;
  byDomain: Record<string, number>;
  errors: Array<{ path: string; message: string }>;
}

export interface MemorySearchItem {
  id: string;
  type: string;
  title?: string;
  domain: string[];
  tags: string[];
  importance?: number;
  pinned?: boolean;
  score: number;
  summary: string;
  coreSummary?: string;
  body: string;
  createdAt?: string;
  updatedAt?: string;
  filePath?: string;
}

export interface MemorySearchResult {
  query: string;
  totalCandidates: number;
  returned: number;
  includeArchive: boolean;
  items: MemorySearchItem[];
  errors: Array<{ path: string; message: string }>;
}

const { clampText, countTokenOverlap, firstUsefulLine, scoreBm25, tokenize } = require("./memory-core/index") as {
  clampText: (input: string, maxChars: number) => string;
  countTokenOverlap: (queryTokens: string[], target: string) => number;
  firstUsefulLine: (input: string) => string;
  scoreBm25: (documents: Array<{ id: string; text: string }>, query: string) => Map<string, number>;
  tokenize: (input: string) => string[];
};

const { archiveMemory, pinBucket, unpinBucket, updateMemory } = require("./memory-core/index") as {
  archiveMemory: (bucket: MemoryBucketLike, now?: string) => MemoryBucketLike;
  pinBucket: (bucket: MemoryBucketLike, options?: Record<string, unknown>) => MemoryBucketLike;
  unpinBucket: (bucket: MemoryBucketLike) => MemoryBucketLike;
  updateMemory: (bucket: MemoryBucketLike, input: Record<string, unknown>) => MemoryBucketLike;
};

export async function getMemoryLibraryStats(): Promise<MemoryLibraryStats> {
  const store = createLocalMemoryStore();
  const loaded = await store.loadBuckets();
  return buildMemoryLibraryStats(loaded.buckets as MemoryBucketLike[], loaded.errors);
}

export async function rebuildMemoryLibraryStats(): Promise<MemoryLibraryStats> {
  const store = createLocalMemoryStore();
  const loaded = await store.rebuildBucketCache();
  return buildMemoryLibraryStats(loaded.buckets as MemoryBucketLike[], loaded.errors);
}

function buildMemoryLibraryStats(
  buckets: MemoryBucketLike[],
  errors: Array<{ path: string; message: string }>
): MemoryLibraryStats {
  const byType: Record<string, number> = {};
  const byDomain: Record<string, number> = {};
  let pinned = 0;
  let archive = 0;

  for (const bucket of buckets) {
    const type = bucket.type || "dynamic";
    byType[type] = (byType[type] || 0) + 1;
    if (type === "archive") {
      archive += 1;
    }
    if (bucket.pinned) {
      pinned += 1;
    }
    const domains = bucket.domain?.length ? bucket.domain : ["general"];
    for (const domain of domains) {
      byDomain[domain] = (byDomain[domain] || 0) + 1;
    }
  }

  return {
    total: buckets.length,
    active: buckets.length - archive,
    archive,
    pinned,
    byType,
    byDomain,
    errors,
  };
}

export async function searchMemoryLibrary(params: {
  query?: string;
  limit?: number;
  includeArchive?: boolean;
} = {}): Promise<MemorySearchResult> {
  const query = textOf(params.query).trim();
  const limit = boundedInteger(params.limit, 1, 30, 8);
  const includeArchive = Boolean(params.includeArchive);
  const store = createLocalMemoryStore();
  const loaded = await store.loadBuckets();
  const queryTokens = tokenize(query);
  const visibleBuckets = (loaded.buckets as MemoryBucketLike[])
    .filter((bucket) => includeArchive || bucket.type !== "archive");
  const bm25Scores = query
    ? scoreBm25(visibleBuckets.map((bucket) => ({ id: bucket.id, text: weightedSearchText(bucket) })), query)
    : new Map<string, number>();

  const scored = visibleBuckets
    .map((bucket) => scoreBucket(bucket, query, queryTokens, bm25Scores.get(bucket.id) || 0))
    .filter((item) => !query || item.score > 0)
    .sort(compareSearchItems);

  const items = scored.slice(0, limit);
  return {
    query,
    totalCandidates: scored.length,
    returned: items.length,
    includeArchive,
    items,
    errors: loaded.errors,
  };
}

export async function updateMemoryLibraryItem(params: {
  id: string;
  title?: string;
  body?: string;
  coreSummary?: string;
  domain?: string[];
  tags?: string[];
  importance?: number;
}): Promise<void> {
  const id = textOf(params.id).trim();
  if (!id) throw new Error("memory id is required");
  const store = createLocalMemoryStore();
  const loaded = await store.loadBuckets();
  const bucket = (loaded.buckets as MemoryBucketLike[]).find((item) => item.id === id);
  if (!bucket) throw new Error(`memory not found: ${id}`);
  const updated = updateMemory(bucket, {
    title: params.title == null ? undefined : textOf(params.title).trim(),
    body: params.body == null ? undefined : textOf(params.body),
    coreSummary: params.coreSummary == null ? undefined : textOf(params.coreSummary),
    domain: params.domain,
    tags: params.tags,
    importance: params.importance,
    now: new Date().toISOString(),
  });
  await store.writeBucket(updated);
}

export async function archiveMemoryLibraryItem(idValue: string): Promise<void> {
  const id = textOf(idValue).trim();
  if (!id) throw new Error("memory id is required");
  const store = createLocalMemoryStore();
  const loaded = await store.loadBuckets();
  const bucket = (loaded.buckets as MemoryBucketLike[]).find((item) => item.id === id);
  if (!bucket) throw new Error(`memory not found: ${id}`);
  await store.writeBucket(archiveMemory(bucket, new Date().toISOString()));
}

export async function setMemoryLibraryItemPinned(idValue: string, pinned: boolean): Promise<void> {
  const id = textOf(idValue).trim();
  if (!id) throw new Error("memory id is required");
  const store = createLocalMemoryStore();
  const loaded = await store.loadBuckets();
  const bucket = (loaded.buckets as MemoryBucketLike[]).find((item) => item.id === id);
  if (!bucket) throw new Error(`memory not found: ${id}`);
  if (bucket.type === "archive") throw new Error("archived memory cannot be pinned");
  const updated = pinned
    ? pinBucket(bucket, {
        scope: "global",
        order: 1000,
        coreSummary: bucket.coreSummary || firstUsefulLine(bucket.body || ""),
      })
    : unpinBucket(bucket);
  await store.writeBucket(updated);
}

export function formatMemoryLibraryStats(stats: MemoryLibraryStats): string {
  return [
    `总数: ${stats.total}`,
    `活动: ${stats.active}`,
    `归档: ${stats.archive}`,
    `pinned: ${stats.pinned}`,
    `类型: ${formatCounts(stats.byType)}`,
    `领域: ${formatCounts(stats.byDomain, 8)}`,
    `解析错误: ${stats.errors.length}`,
  ].join("\n");
}

export function formatMemorySearchResult(result: MemorySearchResult): string {
  if (!result.items.length) {
    return [`匹配: 0`, `解析错误: ${result.errors.length}`].join("\n");
  }
  const lines = [
    `匹配: ${result.totalCandidates}`,
    `返回: ${result.returned}`,
    `解析错误: ${result.errors.length}`,
  ];
  for (const item of result.items) {
    const title = item.title || item.id;
    const flags = [item.type, item.pinned ? "pinned" : "", `score ${Math.round(item.score)}`].filter(Boolean).join(" / ");
    lines.push(`\n${title}`);
    lines.push(`id: ${item.id}`);
    lines.push(flags);
    lines.push(item.summary);
  }
  return lines.join("\n");
}

function scoreBucket(bucket: MemoryBucketLike, query: string, queryTokens: string[], bm25Score: number): MemorySearchItem {
  const searchable = [
    bucket.id,
    bucket.title,
    bucket.coreSummary,
    bucket.domain?.join(" "),
    bucket.tags?.join(" "),
    bucket.body,
  ].filter(Boolean).join("\n");
  let score = 0;

  if (!query) {
    score = baseScore(bucket);
  } else {
    score += countTokenOverlap(queryTokens, searchable) * 3;
    if (bucket.title && bucket.title.includes(query)) {
      score += 20;
    }
    if (searchable.includes(query)) {
      score += 10;
    }
    score += bm25Score * 4;
    score += baseScore(bucket) * 0.05;
  }

  return {
    id: bucket.id,
    type: bucket.type || "dynamic",
    title: bucket.title,
    domain: bucket.domain || [],
    tags: bucket.tags || [],
    importance: bucket.importance,
    pinned: bucket.pinned,
    score,
    summary: clampText(bucket.coreSummary || firstUsefulLine(bucket.body || ""), 160),
    coreSummary: bucket.coreSummary,
    body: bucket.body || "",
    createdAt: bucket.createdAt,
    updatedAt: bucket.updatedAt,
    filePath: bucket.filePath,
  };
}

function weightedSearchText(bucket: MemoryBucketLike): string {
  const highWeight = [bucket.title, bucket.coreSummary, bucket.domain?.join(" "), bucket.tags?.join(" ")]
    .filter(Boolean)
    .join("\n");
  return [highWeight, highWeight, bucket.body].filter(Boolean).join("\n");
}

function baseScore(bucket: MemoryBucketLike): number {
  let score = Number(bucket.importance || 0);
  if (bucket.pinned) {
    score += 50;
  }
  const timestamp = bucket.lastActiveAt || bucket.updatedAt || bucket.createdAt || "";
  if (timestamp) {
    const parsed = Date.parse(timestamp);
    if (Number.isFinite(parsed)) {
      score += Math.max(0, 10 - (Date.now() - parsed) / 86400000);
    }
  }
  return score;
}

function compareSearchItems(left: MemorySearchItem, right: MemorySearchItem): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }
  return left.id.localeCompare(right.id);
}

function formatCounts(counts: Record<string, number>, limit = 12): string {
  const entries = Object.entries(counts).sort((left, right) => right[1] - left[1]).slice(0, limit);
  return entries.map(([key, value]) => `${key}: ${value}`).join(", ") || "none";
}

function boundedInteger(value: number | undefined, minimum: number, maximum: number, fallback: number): number {
  if (value == null || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function textOf(value: unknown): string {
  return value == null ? "" : String(value);
}
