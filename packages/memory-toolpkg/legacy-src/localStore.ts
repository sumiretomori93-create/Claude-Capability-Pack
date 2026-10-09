declare function require(name: string): unknown;

import { memoryConfigRoot, memoryConfigRootCandidates } from "./settings";

interface MemoryFileSystem {
  readText(path: string): Promise<string>;
  listFiles(root: string): Promise<string[]>;
}

interface MemoryBucketLike {
  id: string;
  type: string;
  domain?: string[];
  title?: string;
  filePath?: string;
}

interface BucketCacheFile {
  version?: number;
  buckets?: MemoryBucketLike[];
  errors?: Array<{ path: string; message: string }>;
  createdAt?: string;
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

const {
  loadBucketsFromDirectory,
  serializeBucketMarkdown,
} = require("./memory-core/index") as {
  loadBucketsFromDirectory: (
    fs: MemoryFileSystem,
    root: string
  ) => Promise<{ buckets: MemoryBucketLike[]; errors: Array<{ path: string; message: string }> }>;
  serializeBucketMarkdown: (bucket: MemoryBucketLike) => string;
};

const BUCKET_TYPES = ["dynamic", "permanent", "feel", "plans", "archive"];
const BUCKET_CACHE_VERSION = 2;

export interface LocalMemoryStore {
  root: string;
  bucketsRoot: string;
  bucketRoots: string[];
  ensureLayout(): Promise<void>;
  loadBuckets(): Promise<{ buckets: MemoryBucketLike[]; errors: Array<{ path: string; message: string }> }>;
  rebuildBucketCache(): Promise<{ buckets: MemoryBucketLike[]; errors: Array<{ path: string; message: string }> }>;
  invalidateBucketCache(): Promise<void>;
  writeBucket(bucket: MemoryBucketLike): Promise<string>;
}

export function createLocalMemoryStore(): LocalMemoryStore {
  const root = memoryConfigRoot();
  const bucketsRoot = joinPath(root, "memory/buckets");
  const bucketRoots = uniquePaths(memoryConfigRootCandidates().map((candidate) => joinPath(candidate, "memory/buckets")));
  const fs = createToolFileSystem();

  return {
    root,
    bucketsRoot,
    bucketRoots,
    async ensureLayout() {
      await mkdir(joinPath(root, "memory"), true);
      await mkdir(bucketsRoot, true);
      for (const type of BUCKET_TYPES) {
        await mkdir(joinPath(bucketsRoot, type), true);
      }
      await mkdir(joinPath(root, "memory/index"), true);
      await mkdir(joinPath(root, "memory/imports/ob"), true);
    },
    async loadBuckets() {
      await this.ensureLayout();
      const cached = await readBucketCache(root);
      if (cached) {
        return cached;
      }
      return this.rebuildBucketCache();
    },
    async rebuildBucketCache() {
      await this.ensureLayout();
      const merged = new Map<string, MemoryBucketLike>();
      const errors: Array<{ path: string; message: string }> = [];
      for (const candidateRoot of bucketRoots) {
        const loaded = await loadBucketsFromDirectory(fs, candidateRoot);
        for (const bucket of loaded.buckets) {
          if (!merged.has(bucket.id)) merged.set(bucket.id, bucket);
        }
        errors.push(...loaded.errors);
      }
      const loaded = { buckets: Array.from(merged.values()), errors };
      await writeBucketCache(root, loaded);
      return loaded;
    },
    async invalidateBucketCache() {
      await deleteBucketCache(root);
    },
    async writeBucket(bucket: MemoryBucketLike) {
      await this.ensureLayout();
      const filePath = bucket.filePath || bucketPathFor(bucketsRoot, bucket);
      await mkdir(parentDir(filePath), true);
      await Tools.Files.write(filePath, serializeBucketMarkdown(bucket), false);
      await this.invalidateBucketCache();
      return filePath;
    },
  };
}

async function readBucketCache(root: string): Promise<{ buckets: MemoryBucketLike[]; errors: Array<{ path: string; message: string }> } | null> {
  try {
    const result = await Tools.Files.read(bucketCachePath(root));
    const text = extractReadText(result);
    if (!text.trim()) {
      return null;
    }
    const parsed = JSON.parse(text) as BucketCacheFile;
    if (parsed.version !== BUCKET_CACHE_VERSION || !Array.isArray(parsed.buckets) || !Array.isArray(parsed.errors)) {
      return null;
    }
    if (parsed.buckets.length === 0) {
      return null;
    }
    return { buckets: parsed.buckets, errors: parsed.errors };
  } catch (_error) {
    return null;
  }
}

async function writeBucketCache(
  root: string,
  loaded: { buckets: MemoryBucketLike[]; errors: Array<{ path: string; message: string }> }
): Promise<void> {
  const path = bucketCachePath(root);
  await mkdir(parentDir(path), true);
  await Tools.Files.write(
    path,
    JSON.stringify({ version: BUCKET_CACHE_VERSION, createdAt: new Date().toISOString(), ...loaded }, null, 2),
    false
  );
}

async function deleteBucketCache(root: string): Promise<void> {
  try {
    const path = bucketCachePath(root);
    await mkdir(parentDir(path), true);
    await Tools.Files.write(path, JSON.stringify({ version: 0, invalidatedAt: new Date().toISOString() }, null, 2), false);
  } catch (_error) {
  }
}

function bucketCachePath(root: string): string {
  return joinPath(root, "memory/index/buckets-cache.json");
}

function bucketPathFor(root: string, bucket: MemoryBucketLike): string {
  const type = BUCKET_TYPES.includes(bucket.type) ? bucket.type : "dynamic";
  const domain = sanitizeSegment(bucket.domain?.[0] || "general");
  const title = sanitizeSegment(bucket.title || bucket.id);
  return joinPath(root, `${type}/${domain}/${title}_${sanitizeSegment(bucket.id)}.md`);
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

function parentDir(path: string): string {
  const normalized = normalizePath(path);
  return normalized.slice(0, normalized.lastIndexOf("/")) || normalized;
}

async function mkdir(path: string, parents: boolean): Promise<void> {
  try {
    await Tools.Files.mkdir(path, parents);
  } catch (_error) {
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

function textOf(value: unknown): string {
  return value == null ? "" : String(value);
}

function createToolFileSystem(): MemoryFileSystem {
  async function listFiles(root: string): Promise<string[]> {
    const seen = new Set<string>();
    const result: string[] = [];

    async function walk(dir: string): Promise<void> {
      if (seen.has(dir)) {
        return;
      }
      seen.add(dir);

      let entries: ToolDirectoryEntry[] = [];
      try {
        const listing = await Tools.Files.list(dir);
        entries = extractEntries(listing);
      } catch (_error) {
        return;
      }

      for (const entry of entries) {
        const name = textOf(entry.name || "");
        const path = normalizePath(textOf(entry.path || (name ? joinPath(dir, name) : "")));
        if (!path) {
          continue;
        }
        const type = textOf(entry.type).toLowerCase();
        const isDirectory = entry.isDirectory === true || type === "directory" || type === "dir";
        if (isDirectory) {
          await walk(path);
        } else {
          result.push(path);
        }
      }
    }

    await walk(root);
    return result;
  }

  async function readText(path: string): Promise<string> {
    const result = await Tools.Files.read(path);
    return extractReadText(result);
  }

  return { listFiles, readText };
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((path) => {
    const normalized = normalizePath(path).toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}
