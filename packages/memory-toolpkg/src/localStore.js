"use strict";
const { AppFiles } = require("./appFiles");
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLocalMemoryStore = createLocalMemoryStore;
const settings_1 = require("./settings");
const { loadBucketsFromDirectory, serializeBucketMarkdown, } = require("./memory-core/index");
const BUCKET_TYPES = ["dynamic", "permanent", "feel", "plans", "archive"];
const BUCKET_CACHE_VERSION = 2;
function createLocalMemoryStore() {
    const root = (0, settings_1.memoryConfigRoot)();
    const bucketsRoot = joinPath(root, "memory/buckets");
    const bucketRoots = uniquePaths((0, settings_1.memoryConfigRootCandidates)().map((candidate) => joinPath(candidate, "memory/buckets")));
    const fs = createToolFileSystem();
    return {
        root,
        bucketsRoot,
        bucketRoots,
        async ensureLayout() {
            await (0, settings_1.ensureMemoryStorage)();
            await mkdir(joinPath(root, "memory"), true);
            await mkdir(bucketsRoot, true);
            for (const type of BUCKET_TYPES) {
                await mkdir(joinPath(bucketsRoot, type), true);
            }
            await mkdir(joinPath(root, "memory/index"), true);
            await mkdir(joinPath(root, "memory/imports/ob"), true);
        },
        async loadBuckets() {
            await (0, settings_1.ensureMemoryStorage)();
            const cached = await readBucketCache(root);
            if (cached) {
                return cached;
            }
            return this.rebuildBucketCache();
        },
        async rebuildBucketCache() {
            await (0, settings_1.ensureMemoryStorage)();
            const merged = new Map();
            const errors = [];
            for (const candidateRoot of bucketRoots) {
                const loaded = await loadBucketsFromDirectory(fs, candidateRoot);
                for (const bucket of loaded.buckets) {
                    if (!merged.has(bucket.id))
                        merged.set(bucket.id, bucket);
                }
                errors.push(...loaded.errors);
            }
            const loaded = { buckets: Array.from(merged.values()), errors };
            try { await writeBucketCache(root, loaded); }
            catch (error) { console.log("[ccp_memory] cache_write_failed " + String(error.message || error)); }
            return loaded;
        },
        async invalidateBucketCache() {
            await deleteBucketCache(root);
        },
        async writeBucket(bucket) {
            await this.ensureLayout();
            const filePath = bucket.filePath && bucket.filePath.startsWith(bucketsRoot + "/") ? bucket.filePath : bucketPathFor(bucketsRoot, bucket);
            await mkdir(parentDir(filePath), true);
            await AppFiles.write(filePath, serializeBucketMarkdown(bucket), false);
            await this.invalidateBucketCache();
            return filePath;
        },
    };
}
async function readBucketCache(root) {
    try {
        const result = await AppFiles.read(bucketCachePath(root));
        const text = extractReadText(result);
        if (!text.trim()) {
            return null;
        }
        const parsed = JSON.parse(text);
        if (parsed.version !== BUCKET_CACHE_VERSION || !Array.isArray(parsed.buckets) || !Array.isArray(parsed.errors)) {
            return null;
        }
        if (parsed.buckets.length === 0) {
            return null;
        }
        return { buckets: parsed.buckets, errors: parsed.errors };
    }
    catch (_error) {
        return null;
    }
}
async function writeBucketCache(root, loaded) {
    const path = bucketCachePath(root);
    await mkdir(parentDir(path), true);
    await AppFiles.write(path, JSON.stringify({ version: BUCKET_CACHE_VERSION, createdAt: new Date().toISOString(), ...loaded }, null, 2), false);
}
async function deleteBucketCache(root) {
    try {
        const path = bucketCachePath(root);
        await mkdir(parentDir(path), true);
        await AppFiles.write(path, JSON.stringify({ version: 0, invalidatedAt: new Date().toISOString() }, null, 2), false);
    }
    catch (_error) {
    }
}
function bucketCachePath(root) {
    return joinPath(root, "memory/index/buckets-cache.json");
}
function bucketPathFor(root, bucket) {
    const type = BUCKET_TYPES.includes(bucket.type) ? bucket.type : "dynamic";
    const domain = sanitizeSegment(bucket.domain?.[0] || "general");
    const title = sanitizeSegment(bucket.title || bucket.id);
    return joinPath(root, `${type}/${domain}/${title}_${sanitizeSegment(bucket.id)}.md`);
}
function sanitizeSegment(input) {
    return input
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\u3400-\u9fff_-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 80) || "memory";
}
function normalizePath(path) {
    return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}
function joinPath(base, child) {
    return normalizePath(`${base.replace(/[\\/]+$/, "")}/${child.replace(/^[\\/]+/, "")}`);
}
function parentDir(path) {
    const normalized = normalizePath(path);
    return normalized.slice(0, normalized.lastIndexOf("/")) || normalized;
}
async function mkdir(path, parents) {
    try {
        await AppFiles.mkdir(path, parents);
    }
    catch (_error) {
    }
}
function extractReadText(result) {
    if (typeof result === "string")
        return result;
    if (!result || typeof result !== "object")
        return "";
    const value = result;
    for (const key of ["content", "data", "text", "result", "value"]) {
        const nested = extractReadText(value[key]);
        if (nested)
            return nested;
    }
    return "";
}
function extractEntries(result) {
    if (Array.isArray(result)) {
        return result.map((entry) => typeof entry === "string" ? { name: entry } : entry);
    }
    if (!result || typeof result !== "object")
        return [];
    const value = result;
    for (const key of ["entries", "files", "children", "items", "data", "result", "value"]) {
        const entries = extractEntries(value[key]);
        if (entries.length)
            return entries;
    }
    return [];
}
function textOf(value) {
    return value == null ? "" : String(value);
}
function createToolFileSystem() {
    async function listFiles(root) {
        const seen = new Set();
        const result = [];
        async function walk(dir) {
            if (seen.has(dir)) {
                return;
            }
            seen.add(dir);
            let entries = [];
            try {
                const listing = await AppFiles.list(dir);
                entries = extractEntries(listing);
            }
            catch (error) {
                throw new Error("记忆目录读取失败：" + dir + "；" + String(error.message || error));
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
                }
                else {
                    result.push(path);
                }
            }
        }
        await walk(root);
        return result;
    }
    async function readText(path) {
        const result = await AppFiles.read(path);
        return extractReadText(result);
    }
    return { listFiles, readText };
}
function uniquePaths(paths) {
    const seen = new Set();
    return paths.filter((path) => {
        const normalized = normalizePath(path).toLowerCase();
        if (!normalized || seen.has(normalized))
            return false;
        seen.add(normalized);
        return true;
    });
}
