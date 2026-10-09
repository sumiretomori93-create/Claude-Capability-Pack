"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMemoryLibraryStats = getMemoryLibraryStats;
exports.rebuildMemoryLibraryStats = rebuildMemoryLibraryStats;
exports.searchMemoryLibrary = searchMemoryLibrary;
exports.updateMemoryLibraryItem = updateMemoryLibraryItem;
exports.archiveMemoryLibraryItem = archiveMemoryLibraryItem;
exports.setMemoryLibraryItemPinned = setMemoryLibraryItemPinned;
exports.formatMemoryLibraryStats = formatMemoryLibraryStats;
exports.formatMemorySearchResult = formatMemorySearchResult;
const localStore_1 = require("./localStore");
const { clampText, countTokenOverlap, firstUsefulLine, scoreBm25, tokenize } = require("./memory-core/index");
const { archiveMemory, pinBucket, unpinBucket, updateMemory } = require("./memory-core/index");
async function getMemoryLibraryStats() {
    const store = (0, localStore_1.createLocalMemoryStore)();
    const loaded = await store.loadBuckets();
    return buildMemoryLibraryStats(loaded.buckets, loaded.errors);
}
async function rebuildMemoryLibraryStats() {
    const store = (0, localStore_1.createLocalMemoryStore)();
    const loaded = await store.rebuildBucketCache();
    return buildMemoryLibraryStats(loaded.buckets, loaded.errors);
}
function buildMemoryLibraryStats(buckets, errors) {
    const byType = {};
    const byDomain = {};
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
async function searchMemoryLibrary(params = {}) {
    const query = textOf(params.query).trim();
    const limit = boundedInteger(params.limit, 1, 30, 8);
    const includeArchive = Boolean(params.includeArchive);
    const store = (0, localStore_1.createLocalMemoryStore)();
    const loaded = await store.loadBuckets();
    const queryTokens = tokenize(query);
    const visibleBuckets = loaded.buckets
        .filter((bucket) => includeArchive || bucket.type !== "archive");
    const bm25Scores = query
        ? scoreBm25(visibleBuckets.map((bucket) => ({ id: bucket.id, text: weightedSearchText(bucket) })), query)
        : new Map();
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
async function updateMemoryLibraryItem(params) {
    const id = textOf(params.id).trim();
    if (!id)
        throw new Error("memory id is required");
    const store = (0, localStore_1.createLocalMemoryStore)();
    const loaded = await store.loadBuckets();
    const bucket = loaded.buckets.find((item) => item.id === id);
    if (!bucket)
        throw new Error(`memory not found: ${id}`);
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
async function archiveMemoryLibraryItem(idValue) {
    const id = textOf(idValue).trim();
    if (!id)
        throw new Error("memory id is required");
    const store = (0, localStore_1.createLocalMemoryStore)();
    const loaded = await store.loadBuckets();
    const bucket = loaded.buckets.find((item) => item.id === id);
    if (!bucket)
        throw new Error(`memory not found: ${id}`);
    await store.writeBucket(archiveMemory(bucket, new Date().toISOString()));
}
async function setMemoryLibraryItemPinned(idValue, pinned) {
    const id = textOf(idValue).trim();
    if (!id)
        throw new Error("memory id is required");
    const store = (0, localStore_1.createLocalMemoryStore)();
    const loaded = await store.loadBuckets();
    const bucket = loaded.buckets.find((item) => item.id === id);
    if (!bucket)
        throw new Error(`memory not found: ${id}`);
    if (bucket.type === "archive")
        throw new Error("archived memory cannot be pinned");
    const updated = pinned
        ? pinBucket(bucket, {
            scope: "global",
            order: 1000,
            coreSummary: bucket.coreSummary || firstUsefulLine(bucket.body || ""),
        })
        : unpinBucket(bucket);
    await store.writeBucket(updated);
}
function formatMemoryLibraryStats(stats) {
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
function formatMemorySearchResult(result) {
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
function scoreBucket(bucket, query, queryTokens, bm25Score) {
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
    }
    else {
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
function weightedSearchText(bucket) {
    const highWeight = [bucket.title, bucket.coreSummary, bucket.domain?.join(" "), bucket.tags?.join(" ")]
        .filter(Boolean)
        .join("\n");
    return [highWeight, highWeight, bucket.body].filter(Boolean).join("\n");
}
function baseScore(bucket) {
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
function compareSearchItems(left, right) {
    if (right.score !== left.score) {
        return right.score - left.score;
    }
    return left.id.localeCompare(right.id);
}
function formatCounts(counts, limit = 12) {
    const entries = Object.entries(counts).sort((left, right) => right[1] - left[1]).slice(0, limit);
    return entries.map(([key, value]) => `${key}: ${value}`).join(", ") || "none";
}
function boundedInteger(value, minimum, maximum, fallback) {
    if (value == null || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(minimum, Math.min(maximum, Math.round(value)));
}
function textOf(value) {
    return value == null ? "" : String(value);
}
