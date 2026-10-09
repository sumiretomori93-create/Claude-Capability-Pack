declare function require(name: string): unknown;

import { createLocalMemoryStore } from "./localStore";

interface MemoryFileSystem {
  readText(path: string): Promise<string>;
  listFiles(root: string): Promise<string[]>;
}

interface MemoryBucketLike {
  id: string;
  type: string;
  domain?: string[];
  tags?: string[];
  title?: string;
  pinned?: boolean;
  filePath?: string;
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

export interface OmbreStagingImportPreview {
  sourceRoot: string;
  targetRoot: string;
  scanned: number;
  valid: number;
  newCount: number;
  duplicateCount: number;
  pinnedCount: number;
  byType: Record<string, number>;
  errors: Array<{ path: string; message: string }>;
  duplicates: Array<{ id: string; title?: string; sourcePath?: string }>;
}

export interface OmbreStagingImportApplyResult extends OmbreStagingImportPreview {
  importedCount: number;
  skippedDuplicateCount: number;
  writtenPaths: string[];
}

const REPORT_PATH = "memory/imports/ob/latest-staging-import.json";

const { loadBucketsFromDirectory } = require("./memory-core/index") as {
  loadBucketsFromDirectory: (
    fs: MemoryFileSystem,
    root: string
  ) => Promise<{ buckets: MemoryBucketLike[]; errors: Array<{ path: string; message: string }> }>;
};

export async function previewOmbreStagingImport(sourceRoot: string): Promise<OmbreStagingImportPreview> {
  const normalizedSource = normalizePath(sourceRoot.trim());
  if (!normalizedSource) {
    throw new Error("sourceRoot is required");
  }

  const store = createLocalMemoryStore();
  await store.ensureLayout();

  if (pathsOverlap(normalizedSource, store.bucketsRoot)) {
    throw new Error("sourceRoot must not overlap the active memory bucket directory");
  }

  const source = await loadBucketsFromDirectory(createToolFileSystem(), normalizedSource);
  const existing = await store.loadBuckets();
  const existingIds = new Set(existing.buckets.map((bucket) => bucket.id));

  return summarizePreview(normalizedSource, store.bucketsRoot, source.buckets, source.errors, existingIds);
}

export async function applyOmbreStagingImport(sourceRoot: string): Promise<OmbreStagingImportApplyResult> {
  const normalizedSource = normalizePath(sourceRoot.trim());
  if (!normalizedSource) {
    throw new Error("sourceRoot is required");
  }

  const store = createLocalMemoryStore();
  await store.ensureLayout();

  if (pathsOverlap(normalizedSource, store.bucketsRoot)) {
    throw new Error("sourceRoot must not overlap the active memory bucket directory");
  }

  const source = await loadBucketsFromDirectory(createToolFileSystem(), normalizedSource);
  const existing = await store.loadBuckets();
  const existingIds = new Set(existing.buckets.map((bucket) => bucket.id));
  const preview = summarizePreview(normalizedSource, store.bucketsRoot, source.buckets, source.errors, existingIds);
  const writtenPaths: string[] = [];

  for (const bucket of source.buckets) {
    if (existingIds.has(bucket.id)) {
      continue;
    }
    const bucketForWrite = { ...bucket, filePath: undefined };
    writtenPaths.push(await store.writeBucket(bucketForWrite));
    existingIds.add(bucket.id);
  }

  if (writtenPaths.length > 0) {
    await store.rebuildBucketCache();
  }

  const result: OmbreStagingImportApplyResult = {
    ...preview,
    importedCount: writtenPaths.length,
    skippedDuplicateCount: preview.duplicateCount,
    writtenPaths,
  };
  await writeImportReport(store.root, result);
  return result;
}

export function formatOmbreImportPreview(preview: OmbreStagingImportPreview): string {
  const typeSummary = Object.keys(preview.byType)
    .sort()
    .map((type) => `${type}: ${preview.byType[type]}`)
    .join(", ") || "none";
  return [
    `扫描文件: ${preview.scanned}`,
    `可读取记忆: ${preview.valid}`,
    `可导入新记忆: ${preview.newCount}`,
    `重复 ID: ${preview.duplicateCount}`,
    `pinned: ${preview.pinnedCount}`,
    `类型: ${typeSummary}`,
    `解析错误: ${preview.errors.length}`,
  ].join("\n");
}

export function formatOmbreImportApplyResult(result: OmbreStagingImportApplyResult): string {
  return [
    formatOmbreImportPreview(result),
    `本次写入: ${result.importedCount}`,
    `跳过重复: ${result.skippedDuplicateCount}`,
  ].join("\n");
}

function summarizePreview(
  sourceRoot: string,
  targetRoot: string,
  buckets: MemoryBucketLike[],
  errors: Array<{ path: string; message: string }>,
  existingIds: Set<string>
): OmbreStagingImportPreview {
  const byType: Record<string, number> = {};
  const duplicates: Array<{ id: string; title?: string; sourcePath?: string }> = [];
  const seenIds = new Set(existingIds);
  let newCount = 0;
  let pinnedCount = 0;

  for (const bucket of buckets) {
    const type = bucket.type || "dynamic";
    byType[type] = (byType[type] || 0) + 1;
    if (bucket.pinned) {
      pinnedCount += 1;
    }
    if (seenIds.has(bucket.id)) {
      duplicates.push({ id: bucket.id, title: bucket.title, sourcePath: bucket.filePath });
    } else {
      newCount += 1;
      seenIds.add(bucket.id);
    }
  }

  return {
    sourceRoot,
    targetRoot,
    scanned: buckets.length + errors.length,
    valid: buckets.length,
    newCount,
    duplicateCount: duplicates.length,
    pinnedCount,
    byType,
    errors,
    duplicates: duplicates.slice(0, 30),
  };
}

async function writeImportReport(root: string, result: OmbreStagingImportApplyResult): Promise<void> {
  const path = joinPath(root, REPORT_PATH);
  await mkdir(parentDir(path), true);
  await Tools.Files.write(path, JSON.stringify({ ...result, writtenPaths: result.writtenPaths.slice(0, 100) }, null, 2), false);
}

function createToolFileSystem(): MemoryFileSystem {
  async function listFiles(root: string): Promise<string[]> {
    const result: string[] = [];
    await walk(root, result, new Set<string>());
    return result;
  }

  async function readText(path: string): Promise<string> {
    const result = await Tools.Files.read(path);
    return extractReadText(result);
  }

  return { listFiles, readText };
}

async function walk(dir: string, output: string[], seen: Set<string>): Promise<void> {
  const normalizedDir = normalizePath(dir);
  if (seen.has(normalizedDir)) {
    return;
  }
  seen.add(normalizedDir);

  let entries: ToolDirectoryEntry[] = [];
  try {
    const listing = await Tools.Files.list(normalizedDir);
    entries = extractEntries(listing);
  } catch (_error) {
    return;
  }

  for (const entry of entries) {
    const name = textOf(entry.name);
    const path = normalizePath(textOf(entry.path || (name ? joinPath(normalizedDir, name) : "")));
    if (!path) {
      continue;
    }
    const type = textOf(entry.type).toLowerCase();
    const isDirectory = entry.isDirectory === true || type === "directory" || type === "dir";
    if (isDirectory) {
      await walk(path, output, seen);
    } else if (path.toLowerCase().endsWith(".md")) {
      output.push(path);
    }
  }
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

function extractEntries(result: unknown): ToolDirectoryEntry[] {
  if (Array.isArray(result)) {
    return result.map((entry) => typeof entry === "string" ? { name: entry } : entry as ToolDirectoryEntry);
  }
  if (!result || typeof result !== "object") return [];
  const value = result as ToolDirectoryListingData & Record<string, unknown>;
  for (const key of ["entries", "files", "children", "items", "data", "result", "value"]) {
    const entries = extractEntries(value[key]);
    if (entries.length) return entries;
  }
  return [];
}

async function mkdir(path: string, parents: boolean): Promise<void> {
  try {
    await Tools.Files.mkdir(path, parents);
  } catch (_error) {
  }
}

function isSameOrChildPath(candidate: string, parent: string): boolean {
  const normalizedCandidate = normalizePath(candidate).replace(/\/$/, "").toLowerCase();
  const normalizedParent = normalizePath(parent).replace(/\/$/, "").toLowerCase();
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}/`);
}

function pathsOverlap(left: string, right: string): boolean {
  return isSameOrChildPath(left, right) || isSameOrChildPath(right, left);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function joinPath(base: string, child: string): string {
  return normalizePath(`${base.replace(/[\/]+$/, "")}/${child.replace(/^[\/]+/, "")}`);
}

function parentDir(path: string): string {
  const normalized = normalizePath(path);
  return normalized.slice(0, normalized.lastIndexOf("/")) || normalized;
}

function textOf(value: unknown): string {
  return value == null ? "" : String(value);
}
