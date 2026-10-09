"use strict";
const { AppFiles } = require("./appFiles");
Object.defineProperty(exports, "__esModule", { value: true });
exports.previewOmbreStagingImport = previewOmbreStagingImport;
exports.applyOmbreStagingImport = applyOmbreStagingImport;
exports.formatOmbreImportPreview = formatOmbreImportPreview;
exports.formatOmbreImportApplyResult = formatOmbreImportApplyResult;
const localStore_1 = require("./localStore");
const REPORT_PATH = "memory/imports/ob/latest-staging-import.json";
const { loadBucketsFromDirectory } = require("./memory-core/index");
async function previewOmbreStagingImport(sourceRoot) {
    const normalizedSource = normalizePath(sourceRoot.trim());
    if (!normalizedSource) {
        throw new Error("sourceRoot is required");
    }
    const store = (0, localStore_1.createLocalMemoryStore)();
    await store.ensureLayout();
    if (pathsOverlap(normalizedSource, store.bucketsRoot)) {
        throw new Error("sourceRoot must not overlap the active memory bucket directory");
    }
    const source = await loadBucketsFromDirectory(createToolFileSystem(), normalizedSource);
    const existing = await store.loadBuckets();
    const existingIds = new Set(existing.buckets.map((bucket) => bucket.id));
    return summarizePreview(normalizedSource, store.bucketsRoot, source.buckets, source.errors, existingIds);
}
async function applyOmbreStagingImport(sourceRoot) {
    const normalizedSource = normalizePath(sourceRoot.trim());
    if (!normalizedSource) {
        throw new Error("sourceRoot is required");
    }
    const store = (0, localStore_1.createLocalMemoryStore)();
    await store.ensureLayout();
    if (pathsOverlap(normalizedSource, store.bucketsRoot)) {
        throw new Error("sourceRoot must not overlap the active memory bucket directory");
    }
    const source = await loadBucketsFromDirectory(createToolFileSystem(), normalizedSource);
    const existing = await store.loadBuckets();
    const existingIds = new Set(existing.buckets.map((bucket) => bucket.id));
    const preview = summarizePreview(normalizedSource, store.bucketsRoot, source.buckets, source.errors, existingIds);
    const writtenPaths = [];
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
    const result = {
        ...preview,
        importedCount: writtenPaths.length,
        skippedDuplicateCount: preview.duplicateCount,
        writtenPaths,
    };
    await writeImportReport(store.root, result);
    return result;
}
function formatOmbreImportPreview(preview) {
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
function formatOmbreImportApplyResult(result) {
    return [
        formatOmbreImportPreview(result),
        `本次写入: ${result.importedCount}`,
        `跳过重复: ${result.skippedDuplicateCount}`,
    ].join("\n");
}
function summarizePreview(sourceRoot, targetRoot, buckets, errors, existingIds) {
    const byType = {};
    const duplicates = [];
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
        }
        else {
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
async function writeImportReport(root, result) {
    const path = joinPath(root, REPORT_PATH);
    await mkdir(parentDir(path), true);
    await AppFiles.write(path, JSON.stringify({ ...result, writtenPaths: result.writtenPaths.slice(0, 100) }, null, 2), false);
}
function createToolFileSystem() {
    async function listFiles(root) {
        const result = [];
        await walk(root, result, new Set());
        return result;
    }
    async function readText(path) {
        const result = await AppFiles.read(path);
        return extractReadText(result);
    }
    return { listFiles, readText };
}
async function walk(dir, output, seen) {
    const normalizedDir = normalizePath(dir);
    if (seen.has(normalizedDir)) {
        return;
    }
    seen.add(normalizedDir);
    let entries = [];
    try {
        const listing = await AppFiles.list(normalizedDir);
        entries = extractEntries(listing);
    }
    catch (_error) {
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
        }
        else if (path.toLowerCase().endsWith(".md")) {
            output.push(path);
        }
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
async function mkdir(path, parents) {
    try {
        await AppFiles.mkdir(path, parents);
    }
    catch (_error) {
    }
}
function isSameOrChildPath(candidate, parent) {
    const normalizedCandidate = normalizePath(candidate).replace(/\/$/, "").toLowerCase();
    const normalizedParent = normalizePath(parent).replace(/\/$/, "").toLowerCase();
    return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}/`);
}
function pathsOverlap(left, right) {
    return isSameOrChildPath(left, right) || isSameOrChildPath(right, left);
}
function normalizePath(path) {
    return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}
function joinPath(base, child) {
    return normalizePath(`${base.replace(/[\/]+$/, "")}/${child.replace(/^[\/]+/, "")}`);
}
function parentDir(path) {
    const normalized = normalizePath(path);
    return normalized.slice(0, normalized.lastIndexOf("/")) || normalized;
}
function textOf(value) {
    return value == null ? "" : String(value);
}
