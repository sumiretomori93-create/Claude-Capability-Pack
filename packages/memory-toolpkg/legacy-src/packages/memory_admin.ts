/* METADATA
{
  "name": "ccp_memory_admin",
  "display_name": {
    "zh": "Claude 记忆管理",
    "en": "Claude Memory Admin"
  },
  "description": {
    "zh": "管理 Claude Capability Pack 的本地 Markdown 记忆。",
    "en": "Manage local Markdown memories for Claude Capability Pack."
  },
  "enabled_by_default": true,
  "category": "Memory",
  "tools": [
    {
      "name": "add",
      "description": {
        "zh": "新增一条本地记忆。",
        "en": "Add a local memory."
      },
      "parameters": [
        { "name": "body", "description": { "zh": "记忆正文。", "en": "Memory body." }, "type": "string", "required": true },
        { "name": "title", "description": { "zh": "标题。", "en": "Title." }, "type": "string", "required": false },
        { "name": "type", "description": { "zh": "dynamic/permanent/feel/plans/archive，默认 dynamic。", "en": "dynamic/permanent/feel/plans/archive. Default dynamic." }, "type": "string", "required": false },
        { "name": "domain", "description": { "zh": "领域，逗号分隔。", "en": "Comma-separated domains." }, "type": "string", "required": false },
        { "name": "tags", "description": { "zh": "标签，逗号分隔。", "en": "Comma-separated tags." }, "type": "string", "required": false },
        { "name": "importance", "description": { "zh": "重要度 1-10。", "en": "Importance 1-10." }, "type": "number", "required": false },
        { "name": "pinned", "description": { "zh": "是否钉选。", "en": "Whether to pin it." }, "type": "boolean", "required": false },
        { "name": "core_summary", "description": { "zh": "核心摘要，钉选后每轮注入。", "en": "Core summary injected every turn when pinned." }, "type": "string", "required": false }
      ]
    },
    {
      "name": "update",
      "description": {
        "zh": "按 id 修改一条记忆。",
        "en": "Update a memory by id."
      },
      "parameters": [
        { "name": "id", "description": { "zh": "记忆 id。", "en": "Memory id." }, "type": "string", "required": true },
        { "name": "body", "description": { "zh": "新正文。", "en": "New body." }, "type": "string", "required": false },
        { "name": "title", "description": { "zh": "新标题。", "en": "New title." }, "type": "string", "required": false },
        { "name": "domain", "description": { "zh": "新领域，逗号分隔。", "en": "New comma-separated domains." }, "type": "string", "required": false },
        { "name": "tags", "description": { "zh": "新标签，逗号分隔。", "en": "New comma-separated tags." }, "type": "string", "required": false },
        { "name": "importance", "description": { "zh": "重要度 1-10。", "en": "Importance 1-10." }, "type": "number", "required": false },
        { "name": "core_summary", "description": { "zh": "核心摘要。", "en": "Core summary." }, "type": "string", "required": false }
      ]
    },
    {
      "name": "pin",
      "description": {
        "zh": "按 id 钉选一条记忆。",
        "en": "Pin a memory by id."
      },
      "parameters": [
        { "name": "id", "description": { "zh": "记忆 id。", "en": "Memory id." }, "type": "string", "required": true },
        { "name": "scope", "description": { "zh": "global/character/chat/project，默认 global。", "en": "global/character/chat/project. Default global." }, "type": "string", "required": false },
        { "name": "order", "description": { "zh": "钉选排序，越小越靠前。", "en": "Pin order. Smaller comes first." }, "type": "number", "required": false },
        { "name": "core_summary", "description": { "zh": "核心摘要。", "en": "Core summary." }, "type": "string", "required": false }
      ]
    },
    {
      "name": "unpin",
      "description": {
        "zh": "按 id 取消钉选。",
        "en": "Unpin a memory by id."
      },
      "parameters": [
        { "name": "id", "description": { "zh": "记忆 id。", "en": "Memory id." }, "type": "string", "required": true }
      ]
    },
    {
      "name": "archive",
      "description": {
        "zh": "按 id 归档一条记忆。",
        "en": "Archive a memory by id."
      },
      "parameters": [
        { "name": "id", "description": { "zh": "记忆 id。", "en": "Memory id." }, "type": "string", "required": true }
      ]
    },
    {
      "name": "list_pinned",
      "description": {
        "zh": "列出钉选核心记忆。",
        "en": "List pinned core memories."
      },
      "parameters": []
    },
    {
      "name": "stats",
      "description": {
        "zh": "统计本地记忆库数量、类型、领域和解析错误。",
        "en": "Show local memory library counts by type, domain, and parse errors."
      },
      "parameters": []
    },
    {
      "name": "search",
      "description": {
        "zh": "搜索本地记忆库，返回摘要和 id。",
        "en": "Search local memories and return summaries with ids."
      },
      "parameters": [
        { "name": "query", "description": { "zh": "搜索关键词。留空则列出高优先级记忆。", "en": "Search query. Empty lists high-priority memories." }, "type": "string", "required": false },
        { "name": "limit", "description": { "zh": "返回条数。", "en": "Result limit." }, "type": "number", "required": false },
        { "name": "include_archive", "description": { "zh": "是否包含归档。", "en": "Whether to include archive." }, "type": "boolean", "required": false }
      ]
    },
    {
      "name": "import_ombre_preview",
      "description": {
        "zh": "扫描 Ombre staging 目录，预览可导入记忆数量，不写入。",
        "en": "Preview importable memories from an Ombre staging directory without writing."
      },
      "parameters": [
        { "name": "source_root", "description": { "zh": "staging 目录路径。", "en": "Staging directory path." }, "type": "string", "required": true }
      ]
    },
    {
      "name": "import_ombre_apply",
      "description": {
        "zh": "从 Ombre staging 目录导入新记忆，重复 id 默认跳过。",
        "en": "Import new memories from an Ombre staging directory, skipping duplicate ids."
      },
      "parameters": [
        { "name": "source_root", "description": { "zh": "staging 目录路径。", "en": "Staging directory path." }, "type": "string", "required": true }
      ]
    },
    {
      "name": "ingest_summary",
      "description": {
        "zh": "从对话摘要中提取待审核记忆，不会直接写入正式记忆库。",
        "en": "Extract pending memory candidates without writing active memory."
      },
      "parameters": [
        { "name": "summary", "description": { "zh": "对话摘要文本。", "en": "Conversation summary text." }, "type": "string", "required": true },
        { "name": "source_id", "description": { "zh": "摘要或会话来源 id，用于稳定去重。", "en": "Summary or conversation source id for stable dedupe." }, "type": "string", "required": false },
        { "name": "chat_id", "description": { "zh": "聊天窗口 id。", "en": "Chat id." }, "type": "string", "required": false },
        { "name": "character_id", "description": { "zh": "角色卡 id。", "en": "Character card id." }, "type": "string", "required": false },
        { "name": "project_id", "description": { "zh": "项目 id。", "en": "Project id." }, "type": "string", "required": false },
        { "name": "pin_core", "description": { "zh": "审核通过时是否默认钉选。", "en": "Whether approved candidates should be pinned by default." }, "type": "boolean", "required": false }
      ]
    },
    {
      "name": "list_candidates",
      "description": { "zh": "列出等待审核的记忆候选。", "en": "List pending memory candidates." },
      "parameters": []
    },
    {
      "name": "approve_candidate",
      "description": { "zh": "审核通过候选并写入正式记忆库。", "en": "Approve a candidate and write active memory." },
      "parameters": [
        { "name": "id", "description": { "zh": "候选 id。", "en": "Candidate id." }, "type": "string", "required": true },
        { "name": "pin", "description": { "zh": "是否钉选为核心记忆。", "en": "Whether to pin as core memory." }, "type": "boolean", "required": false }
      ]
    },
    {
      "name": "reject_candidate",
      "description": { "zh": "拒绝并移除一个记忆候选。", "en": "Reject and remove a memory candidate." },
      "parameters": [
        { "name": "id", "description": { "zh": "候选 id。", "en": "Candidate id." }, "type": "string", "required": true }
      ]
    }
  ]
}
*/

declare function require(name: string): unknown;

const {
  archiveMemory,
  createManualMemory,
  listPinnedBuckets,
  makeMemoryId,
  pinBucket,
  unpinBucket,
  updateMemory,
  loadBucketsFromDirectory,
  serializeBucketMarkdown,
} = require("../memory-core/index") as {
  archiveMemory: (bucket: unknown, now?: string) => unknown;
  createManualMemory: (input: Record<string, unknown>) => unknown;
  listPinnedBuckets: (buckets: unknown[]) => unknown[];
  makeMemoryId: (seed: string, now?: string) => string;
  pinBucket: (bucket: unknown, options?: Record<string, unknown>) => unknown;
  unpinBucket: (bucket: unknown) => unknown;
  updateMemory: (bucket: unknown, input: Record<string, unknown>) => unknown;
  loadBucketsFromDirectory: (
    fs: MemoryFileSystem,
    root: string
  ) => Promise<{ buckets: unknown[]; errors: Array<{ path: string; message: string }> }>;
  serializeBucketMarkdown: (bucket: unknown) => string;
};

const {
  applyOmbreStagingImport,
  formatOmbreImportApplyResult,
  formatOmbreImportPreview,
  previewOmbreStagingImport,
} = require("../importer") as {
  applyOmbreStagingImport: (sourceRoot: string) => Promise<Record<string, unknown>>;
  formatOmbreImportApplyResult: (result: Record<string, unknown>) => string;
  formatOmbreImportPreview: (preview: Record<string, unknown>) => string;
  previewOmbreStagingImport: (sourceRoot: string) => Promise<Record<string, unknown>>;
};

const {
  formatMemoryLibraryStats,
  formatMemorySearchResult,
  getMemoryLibraryStats,
  searchMemoryLibrary,
} = require("../browser") as {
  formatMemoryLibraryStats: (stats: Record<string, unknown>) => string;
  formatMemorySearchResult: (result: Record<string, unknown>) => string;
  getMemoryLibraryStats: () => Promise<Record<string, unknown>>;
  searchMemoryLibrary: (params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

const { loadMemorySettings, memoryConfigRoot, memoryConfigRootCandidates } = require("../settings") as {
  loadMemorySettings: () => Promise<{ summaryCaptureEnabled: boolean; pinCapturedCore: boolean }>;
  memoryConfigRoot: () => string;
  memoryConfigRootCandidates: () => string[];
};

const {
  approveMemoryCandidate,
  captureSummaryCandidates,
  listMemoryCandidates,
  rejectMemoryCandidate,
} = require("../candidateStore") as {
  approveMemoryCandidate: (id: string, options?: { pin?: boolean }) => Promise<Record<string, unknown>>;
  captureSummaryCandidates: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
  listMemoryCandidates: () => Promise<Record<string, unknown>>;
  rejectMemoryCandidate: (id: string) => Promise<Record<string, unknown>>;
};

interface MemoryFileSystem {
  readText(path: string): Promise<string>;
  listFiles(root: string): Promise<string[]>;
}

interface ToolDirectoryEntry {
  name?: string;
  path?: string;
  isDirectory?: boolean;
  type?: string;
}

interface ToolDirectoryListingData {
  data?: unknown;
  files?: unknown;
  entries?: unknown;
  children?: unknown;
  items?: unknown;
}

const BUCKET_TYPES = ["dynamic", "permanent", "feel", "plans", "archive"];

async function add(params: Record<string, unknown>) {
  try {
    const body = textOf(params.body).trim();
    if (!body) {
      return fail("body is required");
    }
    const now = new Date().toISOString();
    const requestedId = textOf(params.id).trim();
    const id = requestedId || makeMemoryId(body, now);
    if (requestedId && (await findBucket(id))) {
      return fail(`memory already exists: ${id}`);
    }
    const bucket = createManualMemory({
      id,
      body,
      title: textOf(params.title).trim() || undefined,
      type: textOf(params.type).trim() || "dynamic",
      domain: listParam(params.domain),
      tags: listParam(params.tags),
      importance: Number(params.importance ?? 5),
      pinned: Boolean(params.pinned),
      coreSummary: textOf(params.core_summary).trim() || undefined,
      now,
    });
    const path = await writeBucket(bucket);
    return ok({ id: bucketId(bucket), path });
  } catch (error) {
    return fail(errorMessage(error));
  }
}

async function update(params: Record<string, unknown>) {
  try {
    const id = textOf(params.id).trim();
    const bucket = await requireBucket(id);
    const updated = updateMemory(bucket, {
      body: params.body == null ? undefined : textOf(params.body),
      title: params.title == null ? undefined : textOf(params.title),
      domain: params.domain == null ? undefined : listParam(params.domain),
      tags: params.tags == null ? undefined : listParam(params.tags),
      importance: params.importance == null ? undefined : Number(params.importance),
      coreSummary: params.core_summary == null ? undefined : textOf(params.core_summary),
      now: new Date().toISOString(),
    });
    const path = await writeBucket(updated);
    return ok({ id, path });
  } catch (error) {
    return fail(errorMessage(error));
  }
}

async function pin(params: Record<string, unknown>) {
  try {
    const id = textOf(params.id).trim();
    const bucket = await requireBucket(id);
    const pinned = pinBucket(bucket, {
      scope: textOf(params.scope).trim() || "global",
      order: params.order == null ? undefined : Number(params.order),
      coreSummary: textOf(params.core_summary).trim() || undefined,
    });
    const path = await writeBucket(pinned);
    return ok({ id, path });
  } catch (error) {
    return fail(errorMessage(error));
  }
}

async function unpin(params: Record<string, unknown>) {
  try {
    const id = textOf(params.id).trim();
    const bucket = await requireBucket(id);
    const path = await writeBucket(unpinBucket(bucket));
    return ok({ id, path });
  } catch (error) {
    return fail(errorMessage(error));
  }
}

async function archive(params: Record<string, unknown>) {
  try {
    const id = textOf(params.id).trim();
    const bucket = await requireBucket(id);
    const path = await writeBucket(archiveMemory(bucket, new Date().toISOString()));
    return ok({ id, path });
  } catch (error) {
    return fail(errorMessage(error));
  }
}

async function list_pinned() {
  try {
    const loaded = await loadBuckets();
    return ok({
      count: listPinnedBuckets(loaded.buckets).length,
      items: listPinnedBuckets(loaded.buckets).map(summarizeBucket),
      errors: loaded.errors,
    });
  } catch (error) {
    return fail(errorMessage(error));
  }
}

async function stats() {
  try {
    const result = await getMemoryLibraryStats();
    return ok({ ...result, summary: formatMemoryLibraryStats(result) });
  } catch (error) {
    return fail(errorMessage(error));
  }
}

async function search(params: Record<string, unknown>) {
  try {
    const result = await searchMemoryLibrary({
      query: textOf(params.query),
      limit: params.limit == null ? undefined : Number(params.limit),
      includeArchive: Boolean(params.include_archive),
    });
    return ok({ ...result, summary: formatMemorySearchResult(result) });
  } catch (error) {
    return fail(errorMessage(error));
  }
}

async function import_ombre_preview(params: Record<string, unknown>) {
  try {
    const sourceRoot = textOf(params.source_root).trim();
    const preview = await previewOmbreStagingImport(sourceRoot);
    return ok({ ...preview, summary: formatOmbreImportPreview(preview) });
  } catch (error) {
    return fail(errorMessage(error));
  }
}

async function import_ombre_apply(params: Record<string, unknown>) {
  try {
    const sourceRoot = textOf(params.source_root).trim();
    const result = await applyOmbreStagingImport(sourceRoot);
    return ok({ ...result, summary: formatOmbreImportApplyResult(result) });
  } catch (error) {
    return fail(errorMessage(error));
  }
}

async function ingest_summary(params: Record<string, unknown>) {
  try {
    const summary = textOf(params.summary).trim();
    if (!summary) {
      return fail("summary is required");
    }
    const settings = await loadMemorySettings();
    if (!settings.summaryCaptureEnabled) {
      return ok({ candidates: 0, pendingAdded: 0, skipped: 0, disabled: true });
    }
    return ok(await captureSummaryCandidates({
      summary,
      sourceId: textOf(params.source_id).trim() || undefined,
      chatId: textOf(params.chat_id).trim() || undefined,
      characterId: textOf(params.character_id).trim() || undefined,
      projectId: textOf(params.project_id).trim() || undefined,
      pinOnApprove: typeof params.pin_core === "boolean" ? params.pin_core : settings.pinCapturedCore,
    }));
  } catch (error) {
    return fail(errorMessage(error));
  }
}

async function list_candidates() {
  try {
    return ok(await listMemoryCandidates());
  } catch (error) {
    return fail(errorMessage(error));
  }
}

async function approve_candidate(params: Record<string, unknown>) {
  try {
    const id = textOf(params.id).trim();
    if (!id) return fail("id is required");
    return ok(await approveMemoryCandidate(id, {
      pin: typeof params.pin === "boolean" ? params.pin : undefined,
    }));
  } catch (error) {
    return fail(errorMessage(error));
  }
}

async function reject_candidate(params: Record<string, unknown>) {
  try {
    const id = textOf(params.id).trim();
    if (!id) return fail("id is required");
    return ok(await rejectMemoryCandidate(id));
  } catch (error) {
    return fail(errorMessage(error));
  }
}

async function requireBucket(id: string): Promise<unknown> {
  if (!id) {
    throw new Error("id is required");
  }
  const bucket = await findBucket(id);
  if (!bucket) {
    throw new Error(`memory not found: ${id}`);
  }
  return bucket;
}

async function findBucket(id: string): Promise<unknown | undefined> {
  if (!id) {
    return undefined;
  }
  const loaded = await loadBuckets();
  return loaded.buckets.find((item) => bucketId(item) === id);
}

async function loadBuckets() {
  await ensureLayout();
  const fs = createFs();
  const merged = new Map<string, unknown>();
  const errors: Array<{ path: string; message: string }> = [];
  for (const root of bucketRoots()) {
    const loaded = await loadBucketsFromDirectory(fs, root);
    for (const bucket of loaded.buckets) {
      const id = bucketId(bucket);
      if (id && !merged.has(id)) merged.set(id, bucket);
    }
    errors.push(...loaded.errors);
  }
  return { buckets: Array.from(merged.values()), errors };
}

async function writeBucket(bucket: unknown): Promise<string> {
  await ensureLayout();
  const existingPath = bucket && typeof bucket === "object" ? textOf((bucket as Record<string, unknown>).filePath) : "";
  const path = existingPath || bucketPath(bucket);
  await mkdir(parentDir(path), true);
  await Tools.Files.write(path, serializeBucketMarkdown(bucket), false);
  await invalidateBucketCache();
  return path;
}

async function invalidateBucketCache(): Promise<void> {
  try {
    const path = joinPath(rootDir(), "memory/index/buckets-cache.json");
    await mkdir(parentDir(path), true);
    await Tools.Files.write(path, JSON.stringify({ version: 0, invalidatedAt: new Date().toISOString() }, null, 2), false);
  } catch (_error) {
  }
}

async function ensureLayout(): Promise<void> {
  await mkdir(joinPath(rootDir(), "memory"), true);
  await mkdir(bucketsRoot(), true);
  for (const type of BUCKET_TYPES) {
    await mkdir(joinPath(bucketsRoot(), type), true);
  }
  await mkdir(joinPath(rootDir(), "memory/index"), true);
  await mkdir(joinPath(rootDir(), "memory/imports/ob"), true);
}

function createFs(): MemoryFileSystem {
  return {
    async readText(path: string) {
      const result = await Tools.Files.read(path);
      return extractReadText(result);
    },
    async listFiles(root: string) {
      const output: string[] = [];
      await walk(root, output, new Set<string>());
      return output;
    },
  };
}

async function walk(dir: string, output: string[], seen: Set<string>): Promise<void> {
  if (seen.has(dir)) {
    return;
  }
  seen.add(dir);
  let entries: ToolDirectoryEntry[] = [];
  try {
    const listing = await Tools.Files.list(dir);
    entries = entriesFromListing(listing);
  } catch (_error) {
    return;
  }
  for (const entry of entries) {
    const name = textOf(entry.name);
    const path = normalizePath(textOf(entry.path || (name ? joinPath(dir, name) : "")));
    if (!path) {
      continue;
    }
    const type = textOf(entry.type).toLowerCase();
    const isDirectory = entry.isDirectory === true || type === "directory" || type === "dir";
    if (isDirectory) {
      await walk(path, output, seen);
    } else {
      output.push(path);
    }
  }
}

function entriesFromListing(result: unknown): ToolDirectoryEntry[] {
  if (Array.isArray(result)) {
    return result.map((entry) => typeof entry === "string" ? { name: entry } : entry as ToolDirectoryEntry);
  }
  if (!result || typeof result !== "object") return [];
  const value = result as ToolDirectoryListingData & Record<string, unknown>;
  for (const key of ["entries", "files", "children", "items", "data", "result", "value"]) {
    const entries = entriesFromListing(value[key]);
    if (entries.length) return entries;
  }
  return [];
}

function extractReadText(result: unknown): string {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return "";
  const value = result as Record<string, unknown>;
  for (const key of ["content", "data", "text", "result", "value"]) {
    const nested = extractReadText(value[key]);
    if (nested) return nested;
  }
  return "";
}

function rootDir(): string {
  return memoryConfigRoot();
}

function bucketsRoot(): string {
  return joinPath(rootDir(), "memory/buckets");
}

function bucketRoots(): string[] {
  const seen = new Set<string>();
  return memoryConfigRootCandidates()
    .map((root) => joinPath(root, "memory/buckets"))
    .filter((root) => {
      const key = root.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function bucketPath(bucket: unknown): string {
  const value = (bucket || {}) as Record<string, unknown>;
  const type = BUCKET_TYPES.includes(textOf(value.type)) ? textOf(value.type) : "dynamic";
  const domain = sanitizeSegment(Array.isArray(value.domain) ? textOf(value.domain[0]) : "general");
  const title = sanitizeSegment(textOf(value.title || value.id || "memory"));
  return joinPath(bucketsRoot(), `${type}/${domain}/${title}_${sanitizeSegment(bucketId(bucket))}.md`);
}

function summarizeBucket(bucket: unknown): Record<string, unknown> {
  const value = (bucket || {}) as Record<string, unknown>;
  return {
    id: value.id,
    type: value.type,
    title: value.title,
    domain: value.domain,
    tags: value.tags,
    importance: value.importance,
    pinned: value.pinned,
    pinnedScope: value.pinnedScope,
    pinnedOrder: value.pinnedOrder,
    coreSummary: value.coreSummary,
  };
}

function bucketId(bucket: unknown): string {
  return bucket && typeof bucket === "object" ? textOf((bucket as Record<string, unknown>).id) : "";
}

function listParam(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(textOf).map((item) => item.trim()).filter(Boolean);
  }
  return textOf(value).split(",").map((item) => item.trim()).filter(Boolean);
}

async function mkdir(path: string, parents: boolean): Promise<void> {
  try {
    await Tools.Files.mkdir(path, parents);
  } catch (_error) {
  }
}

function parentDir(path: string): string {
  const normalized = normalizePath(path);
  return normalized.slice(0, normalized.lastIndexOf("/")) || normalized;
}

function sanitizeSegment(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "memory";
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function joinPath(base: string, child: string): string {
  return normalizePath(`${base.replace(/[\\/]+$/, "")}/${child.replace(/^[\\/]+/, "")}`);
}

function textOf(value: unknown): string {
  return value == null ? "" : String(value);
}

function ok(data: unknown): Record<string, unknown> {
  return { success: true, data };
}

function fail(error: string): Record<string, unknown> {
  return { success: false, error };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export {
  add,
  approve_candidate,
  archive,
  import_ombre_apply,
  import_ombre_preview,
  ingest_summary,
  list_candidates,
  list_pinned,
  pin,
  reject_candidate,
  search,
  stats,
  unpin,
  update,
};
