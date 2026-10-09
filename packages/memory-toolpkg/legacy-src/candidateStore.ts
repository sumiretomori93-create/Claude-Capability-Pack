declare function require(name: string): unknown;

import { createLocalMemoryStore } from "./localStore";
import { memoryConfigRoot } from "./settings";

export interface MemoryCandidateRecord {
  id: string;
  sourceLine: string;
  createdAt: string;
  pinOnApprove: boolean;
  memory: Record<string, unknown>;
}

interface CandidateQueueFile {
  version: number;
  updatedAt: string;
  items: MemoryCandidateRecord[];
}

interface RejectedCandidateRecord {
  id: string;
  normalizedCoreSummary: string;
  rejectedAt: string;
  sourceLine?: string;
}

interface RejectedCandidateFile {
  version: number;
  updatedAt: string;
  items: RejectedCandidateRecord[];
}

const { createManualMemory, extractMemoriesFromSummary, makeMemoryId } = require("./memory-core/index") as {
  createManualMemory: (input: Record<string, unknown>) => Record<string, unknown>;
  makeMemoryId: (seed: string, now?: string) => string;
  extractMemoriesFromSummary: (
    summary: string,
    options?: Record<string, unknown>
  ) => Array<{ sourceLine: string; memory: Record<string, unknown> }>;
};

const QUEUE_VERSION = 1;
const REJECTED_VERSION = 1;
const MAX_REJECTED_CANDIDATES = 500;

export async function captureSummaryCandidates(params: {
  summary: string;
  sourceId?: string;
  chatId?: string;
  characterId?: string;
  projectId?: string;
  pinOnApprove?: boolean;
}): Promise<Record<string, unknown>> {
  const extracted = extractMemoriesFromSummary(params.summary, {
    sourceId: params.sourceId,
    pinCore: false,
    scope: {
      chatId: params.chatId,
      characterId: params.characterId,
      projectId: params.projectId,
    },
  });

  return appendCandidates(extracted, Boolean(params.pinOnApprove));
}

export async function captureStructuredCandidates(params: {
  summary: string;
  sourceId?: string;
  chatId?: string;
  characterId?: string;
  projectId?: string;
  pinOnApprove?: boolean;
  items: Array<Record<string, unknown>>;
}): Promise<Record<string, unknown>> {
  const built = buildStructuredCandidates(params);

  const result = await appendCandidates(built.extracted, Boolean(params.pinOnApprove));
  return { ...result, qualityRejected: built.qualityRejected };
}

export async function organizeMemoryCandidates(params: {
  sourceIds: string[];
  items: Array<Record<string, unknown>>;
}): Promise<Record<string, unknown>> {
  const queue = await readCandidateQueue();
  const sourceIdSet = new Set(params.sourceIds.map((id) => textOf(id).trim()).filter(Boolean));
  const selected = queue.filter((item) => sourceIdSet.has(item.id));
  if (!selected.length) throw new Error("no matching candidates to organize");

  const sourceSummary = selected
    .map((item) => [textOf(item.memory.title), textOf(item.memory.coreSummary), textOf(item.memory.body)].filter(Boolean).join("\n"))
    .join("\n\n")
    .slice(0, 12000);
  const firstMemory = selected[0].memory;
  const built = buildStructuredCandidates({
    summary: sourceSummary,
    sourceId: `organized:${selected.map((item) => item.id).join(",")}`,
    chatId: textOf(firstMemory.chatId).trim() || undefined,
    characterId: textOf(firstMemory.characterId).trim() || undefined,
    projectId: textOf(firstMemory.projectId).trim() || undefined,
    items: params.items,
  });
  const remaining = queue.filter((item) => !sourceIdSet.has(item.id));
  const result = await appendCandidates(
    built.extracted,
    selected.some((item) => item.pinOnApprove),
    remaining,
    true
  );
  await rememberProcessedCandidateIds(selected);
  return {
    ...result,
    inputCandidates: selected.length,
    outputCandidates: Number(result.pendingAdded || 0),
    discardedCandidates: Math.max(0, selected.length - Number(result.pendingAdded || 0)),
    qualityRejected: built.qualityRejected,
  };
}

function buildStructuredCandidates(params: {
  summary: string;
  sourceId?: string;
  chatId?: string;
  characterId?: string;
  projectId?: string;
  items: Array<Record<string, unknown>>;
}): { extracted: Array<{ sourceLine: string; memory: Record<string, unknown> }>; qualityRejected: number } {
  const now = new Date().toISOString();
  const extracted: Array<{ sourceLine: string; memory: Record<string, unknown> }> = [];
  let qualityRejected = 0;
  for (const [index, item] of params.items.slice(0, 6).entries()) {
    const body = textOf(item.body).trim().slice(0, 1200);
    const coreSummary = textOf(item.coreSummary).trim().slice(0, 160);
    const title = textOf(item.title).trim().slice(0, 80);
    if (!body || !coreSummary || !title) continue;
    const type = normalizeMemoryType(item.type);
    if (structuredCandidateRejectionReason(params.summary, { title, body, coreSummary, type })) {
      qualityRejected += 1;
      continue;
    }
    const seed = [params.sourceId || "model-candidates", params.characterId || "", body, index].join(":");
    extracted.push({
      sourceLine: textOf(item.sourceLine).trim() || params.summary.slice(0, 500),
      memory: {
        id: makeMemoryId(seed, "smart-candidate-organize"),
        type,
        title,
        body,
        coreSummary,
        domain: normalizeStringList(item.domain, defaultDomain(type)),
        tags: normalizeStringList(item.tags, ["candidate-organized", type]),
        importance: boundedImportance(item.importance),
        source: "candidate-organizer",
        sourceId: params.sourceId,
        now,
        pinned: false,
        pinnedOrder: 1000,
        pinnedScope: params.characterId ? "character" : "global",
        characterId: params.characterId,
        chatId: params.chatId,
        projectId: params.projectId,
      },
    });
  }
  return { extracted, qualityRejected };
}

async function appendCandidates(
  extracted: Array<{ sourceLine: string; memory: Record<string, unknown> }>,
  pinOnApprove: boolean,
  initialQueue?: MemoryCandidateRecord[],
  forceWrite = false
): Promise<Record<string, unknown>> {
  const store = createLocalMemoryStore();
  const loaded = await store.loadBuckets();
  const queue = initialQueue ? [...initialQueue] : await readCandidateQueue();
  const rejected = await readRejectedCandidates();
  const activeIds = new Set(loaded.buckets.map((bucket) => textOf(bucket.id)));
  const activeSummaries = new Set(
    loaded.buckets
      .map((bucket) => textOf((bucket as unknown as Record<string, unknown>).coreSummary).trim())
      .filter(Boolean)
  );
  const pendingIds = new Set(queue.map((item) => item.id));
  const pendingSummaries = new Set(queue.map((item) => textOf(item.memory.coreSummary).trim()).filter(Boolean));
  const rejectedIds = new Set(rejected.map((item) => item.id));
  const rejectedSummaries = new Set(rejected.map((item) => item.normalizedCoreSummary).filter(Boolean));

  const added: MemoryCandidateRecord[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  for (const candidate of extracted) {
    const id = textOf(candidate.memory.id);
    const coreSummary = textOf(candidate.memory.coreSummary).trim();
    const normalizedCoreSummary = normalizeCandidateText(coreSummary);
    if (rejectedIds.has(id) || (normalizedCoreSummary && rejectedSummaries.has(normalizedCoreSummary))) {
      skipped.push({ id, reason: "previously_rejected" });
      continue;
    }
    if (activeIds.has(id) || (coreSummary && activeSummaries.has(coreSummary))) {
      skipped.push({ id, reason: "already_active" });
      continue;
    }
    if (pendingIds.has(id) || (coreSummary && pendingSummaries.has(coreSummary))) {
      skipped.push({ id, reason: "already_pending" });
      continue;
    }
    const record: MemoryCandidateRecord = {
      id,
      sourceLine: candidate.sourceLine,
      createdAt: new Date().toISOString(),
      pinOnApprove,
      memory: { ...candidate.memory, pinned: false },
    };
    queue.push(record);
    added.push(record);
    pendingIds.add(id);
    if (coreSummary) pendingSummaries.add(coreSummary);
  }

  if (added.length || forceWrite) await writeCandidateQueue(queue);
  return {
    candidates: extracted.length,
    pendingAdded: added.length,
    skipped: skipped.length,
    pendingTotal: queue.length,
    items: added.map(summarizeCandidate),
    skippedItems: skipped,
  };
}

function normalizeMemoryType(value: unknown): "dynamic" | "permanent" | "feel" | "plans" {
  const type = textOf(value).trim().toLowerCase();
  return type === "permanent" || type === "feel" || type === "plans" ? type : "dynamic";
}

function defaultDomain(type: string): string[] {
  if (type === "feel") return ["relationship"];
  if (type === "permanent") return ["preference"];
  if (type === "plans") return ["project"];
  return ["general"];
}

function normalizeStringList(value: unknown, fallback: string[]): string[] {
  const values = Array.isArray(value) ? value : textOf(value).split(/[,，]/);
  const result = Array.from(new Set(values.map((item) => textOf(item).trim()).filter(Boolean)));
  return result.length ? result.slice(0, 8) : fallback;
}

function boundedImportance(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(10, Math.round(parsed))) : 6;
}

export async function listMemoryCandidates(): Promise<{ count: number; items: Array<Record<string, unknown>> }> {
  const items = await readCandidateQueue();
  return { count: items.length, items: items.map(summarizeCandidate) };
}

export async function listMemoryCandidatesForOrganization(
  limit = 12
): Promise<{ count: number; items: Array<Record<string, unknown>> }> {
  const items = await readCandidateQueue();
  const selected = items.slice(0, Math.max(1, Math.min(20, Math.floor(limit))));
  return { count: items.length, items: selected.map(summarizeCandidate) };
}

export async function approveMemoryCandidate(
  id: string,
  options: { pin?: boolean } = {}
): Promise<Record<string, unknown>> {
  const queue = await readCandidateQueue();
  const candidate = queue.find((item) => item.id === id);
  if (!candidate) throw new Error(`candidate not found: ${id}`);

  const store = createLocalMemoryStore();
  const loaded = await store.loadBuckets();
  if (loaded.buckets.some((bucket) => textOf(bucket.id) === id)) {
    await writeCandidateQueue(queue.filter((item) => item.id !== id));
    return { id, approved: false, duplicate: true };
  }

  const pinned = options.pin ?? candidate.pinOnApprove;
  const bucket = createManualMemory({
    ...candidate.memory,
    pinned,
    pinnedOrder: pinned ? 1000 : candidate.memory.pinnedOrder,
  });
  const path = await store.writeBucket(bucket as never);
  await writeCandidateQueue(queue.filter((item) => item.id !== id));
  return { id, approved: true, pinned, path };
}

export async function rejectMemoryCandidate(id: string): Promise<Record<string, unknown>> {
  const queue = await readCandidateQueue();
  const candidate = queue.find((item) => item.id === id);
  if (!candidate) throw new Error(`candidate not found: ${id}`);
  const rejected = await readRejectedCandidates();
  const record: RejectedCandidateRecord = {
    id,
    normalizedCoreSummary: normalizeCandidateText(candidate.memory.coreSummary),
    rejectedAt: new Date().toISOString(),
    sourceLine: candidate.sourceLine,
  };
  const nextRejected = rejected.filter(
    (item) => item.id !== id && (!record.normalizedCoreSummary || item.normalizedCoreSummary !== record.normalizedCoreSummary)
  );
  nextRejected.push(record);
  await writeRejectedCandidates(nextRejected.slice(-MAX_REJECTED_CANDIDATES));
  await writeCandidateQueue(queue.filter((item) => item.id !== id));
  return { id, rejected: true };
}

function structuredCandidateRejectionReason(
  sourceSummary: string,
  candidate: { title: string; body: string; coreSummary: string; type: string }
): string {
  const candidateText = `${candidate.title}\n${candidate.coreSummary}\n${candidate.body}`;
  const metaPattern =
    /测试连接|连接测试|摘要能力|用于验证|当前短对话|本次互动没有|没有虚构世界|没有.{0,8}剧情|助手采用|没有完成用户要求|模型能力|插件测试|调试(?:插件|模型|提示词)|prompt\s*(?:test|format)|connection\s*test|capability\s*test/i;
  if (metaPattern.test(sourceSummary) || metaPattern.test(candidateText)) return "meta_or_test_content";

  if (candidate.type === "permanent" && /偏好|风格|习惯|preference|style|habit/i.test(candidateText)) {
    const explicitPreference =
      /偏好|喜欢|希望|要求|习惯|不喜欢|不要|长期|以后|始终|一直|明确(?:表示|提出|要求)|prefer|want|always|never|long[- ]?term/i;
    if (!explicitPreference.test(sourceSummary)) return "unsupported_permanent_preference";
  }
  return "";
}

export async function updateMemoryCandidate(
  id: string,
  input: { title?: unknown; body?: unknown; coreSummary?: unknown; importance?: unknown }
): Promise<Record<string, unknown>> {
  const queue = await readCandidateQueue();
  const candidate = queue.find((item) => item.id === id);
  if (!candidate) throw new Error(`candidate not found: ${id}`);

  const title = textOf(input.title).trim();
  const body = textOf(input.body).trim();
  const coreSummary = textOf(input.coreSummary).trim();
  if (!title) throw new Error("candidate title is required");
  if (!body) throw new Error("candidate body is required");
  if (!coreSummary) throw new Error("candidate core summary is required");

  const parsedImportance = Number.parseInt(textOf(input.importance), 10);
  candidate.memory = {
    ...candidate.memory,
    title: title.slice(0, 80),
    body: body.slice(0, 2000),
    coreSummary: coreSummary.slice(0, 160),
    importance: Number.isFinite(parsedImportance)
      ? Math.max(1, Math.min(10, parsedImportance))
      : candidate.memory.importance,
  };
  await writeCandidateQueue(queue);
  return { id, updated: true, candidate: summarizeCandidate(candidate) };
}

function summarizeCandidate(candidate: MemoryCandidateRecord): Record<string, unknown> {
  return {
    id: candidate.id,
    sourceLine: candidate.sourceLine,
    createdAt: candidate.createdAt,
    pinOnApprove: candidate.pinOnApprove,
    type: candidate.memory.type,
    title: candidate.memory.title,
    body: candidate.memory.body,
    coreSummary: candidate.memory.coreSummary,
    domain: candidate.memory.domain,
    tags: candidate.memory.tags,
    importance: candidate.memory.importance,
  };
}

async function readCandidateQueue(): Promise<MemoryCandidateRecord[]> {
  try {
    const result = await Tools.Files.read(candidateQueuePath());
    const text = readText(result);
    if (!text.trim()) return [];
    const parsed = JSON.parse(text) as CandidateQueueFile;
    return parsed.version === QUEUE_VERSION && Array.isArray(parsed.items) ? parsed.items : [];
  } catch (_error) {
    return [];
  }
}

async function writeCandidateQueue(items: MemoryCandidateRecord[]): Promise<void> {
  const path = candidateQueuePath();
  await Tools.Files.mkdir(parentDir(path), true);
  const payload: CandidateQueueFile = {
    version: QUEUE_VERSION,
    updatedAt: new Date().toISOString(),
    items,
  };
  await Tools.Files.write(path, JSON.stringify(payload, null, 2), false);
}

async function readRejectedCandidates(): Promise<RejectedCandidateRecord[]> {
  try {
    const result = await Tools.Files.read(rejectedCandidatesPath());
    const text = readText(result);
    if (!text.trim()) return [];
    const parsed = JSON.parse(text) as RejectedCandidateFile;
    return parsed.version === REJECTED_VERSION && Array.isArray(parsed.items) ? parsed.items : [];
  } catch (_error) {
    return [];
  }
}

async function writeRejectedCandidates(items: RejectedCandidateRecord[]): Promise<void> {
  const path = rejectedCandidatesPath();
  await Tools.Files.mkdir(parentDir(path), true);
  const payload: RejectedCandidateFile = {
    version: REJECTED_VERSION,
    updatedAt: new Date().toISOString(),
    items,
  };
  await Tools.Files.write(path, JSON.stringify(payload, null, 2), false);
}

async function rememberProcessedCandidateIds(candidates: MemoryCandidateRecord[]): Promise<void> {
  const rejected = await readRejectedCandidates();
  const ids = new Set(candidates.map((item) => item.id));
  const next = rejected.filter((item) => !ids.has(item.id));
  const rejectedAt = new Date().toISOString();
  for (const candidate of candidates) {
    next.push({ id: candidate.id, normalizedCoreSummary: "", rejectedAt, sourceLine: candidate.sourceLine });
  }
  await writeRejectedCandidates(next.slice(-MAX_REJECTED_CANDIDATES));
}

function candidateQueuePath(): string {
  return joinPath(memoryConfigRoot(), "memory/candidates/pending.json");
}

function rejectedCandidatesPath(): string {
  return joinPath(memoryConfigRoot(), "memory/candidates/rejected.json");
}

function normalizeCandidateText(value: unknown): string {
  return textOf(value).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function readText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of ["data", "content", "text", "result", "value"]) {
    const nested = readText(record[key]);
    if (nested) return nested;
  }
  return "";
}

function parentDir(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.slice(0, normalized.lastIndexOf("/")) || normalized;
}

function joinPath(base: string, child: string): string {
  return `${base.replace(/[\\/]+$/, "")}/${child.replace(/^[\\/]+/, "")}`.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function textOf(value: unknown): string {
  return value == null ? "" : String(value);
}
