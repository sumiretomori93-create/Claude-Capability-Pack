"use strict";
const { AppFiles } = require("./appFiles");
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureSummaryCandidates = captureSummaryCandidates;
exports.captureStructuredCandidates = captureStructuredCandidates;
exports.organizeMemoryCandidates = organizeMemoryCandidates;
exports.listMemoryCandidates = listMemoryCandidates;
exports.listMemoryCandidatesForOrganization = listMemoryCandidatesForOrganization;
exports.approveMemoryCandidate = approveMemoryCandidate;
exports.rejectMemoryCandidate = rejectMemoryCandidate;
exports.updateMemoryCandidate = updateMemoryCandidate;
const localStore_1 = require("./localStore");
const settings_1 = require("./settings");
const { createManualMemory, extractMemoriesFromSummary, makeMemoryId } = require("./memory-core/index");
const { extractRecap } = require("./recap");
const QUEUE_VERSION = 1;
const REJECTED_VERSION = 1;
const MAX_REJECTED_CANDIDATES = 500;
async function captureSummaryCandidates(params) {
    // Preserve the summary before any semantic selection. One source per model call.
    const original = textOf(params.summary).trim();
    const recap = extractRecap(original);
    const body = recap.found && recap.text ? recap.text : original;
    if (!body) return { candidates: 0, pendingAdded: 0 };
    const id = makeMemoryId([params.characterId || "", params.chatId || "", body].join(":"), "raw-summary-v1");
    const extracted = [{ sourceLine: body, memory: {
        id, type: "dynamic", title: recap.found && recap.text ? "待整理的对话回顾" : "未找到对话回顾，待处理",
        recapStatus: recap.found && recap.text ? "ready" : "missing",
        body, coreSummary: `待整理摘要 ${id}`, domain: ["general"], tags: ["raw-summary"],
        importance: 5, source: "raw-summary", sourceId: params.sourceId,
        now: new Date().toISOString(), pinned: false, pinnedOrder: 1000,
        pinnedScope: params.characterId ? "character" : "global",
        characterId: params.characterId, chatId: params.chatId, projectId: params.projectId,
    }}];
    return appendCandidates(extracted, Boolean(params.pinOnApprove));
}
async function captureStructuredCandidates(params) {
    const built = buildStructuredCandidates(params);
    const result = await appendCandidates(built.extracted, Boolean(params.pinOnApprove));
    return { ...result, qualityRejected: built.qualityRejected };
}
async function organizeMemoryCandidates(params) {
    const queue = await readCandidateQueue();
    const sourceIdSet = new Set(params.sourceIds.map((id) => textOf(id).trim()).filter(Boolean));
    const selected = queue.filter((item) => sourceIdSet.has(item.id));
    if (!selected.length)
        throw new Error("no matching candidates to organize");
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
        organizerValidated: true,
    });
    if (built.qualityRejected || built.extracted.length !== params.items.length)
        throw new Error("整理结果未完整通过保存检查，原候选已保留");
    const remaining = queue.filter((item) => !sourceIdSet.has(item.id));
    const result = await appendCandidates(built.extracted, selected.some((item) => item.pinOnApprove), remaining, true);
    await rememberProcessedCandidateIds(selected);
    return {
        ...result,
        inputCandidates: selected.length,
        outputCandidates: Number(result.pendingAdded || 0),
        discardedCandidates: Math.max(0, selected.length - Number(result.pendingAdded || 0)),
        qualityRejected: built.qualityRejected,
    };
}
function buildStructuredCandidates(params) {
    const now = new Date().toISOString();
    const extracted = [];
    let qualityRejected = 0;
    for (const [index, item] of params.items.slice(0, 6).entries()) {
        const body = textOf(item.body).trim();
        const coreSummary = textOf(item.coreSummary).trim();
        const title = textOf(item.title).trim();
        if (!body || !coreSummary || !title)
            continue;
        const type = normalizeMemoryType(item.type);
        if (!params.organizerValidated && structuredCandidateRejectionReason(params.summary, { title, body, coreSummary, type })) {
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
                whyRemembered: textOf(item.whyRemembered),
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
async function appendCandidates(extracted, pinOnApprove, initialQueue, forceWrite = false) {
    const store = (0, localStore_1.createLocalMemoryStore)();
    const loaded = await store.loadBuckets();
    const queue = initialQueue ? [...initialQueue] : await readCandidateQueue();
    const rejected = await readRejectedCandidates();
    const activeIds = new Set(loaded.buckets.map((bucket) => textOf(bucket.id)));
    const activeSummaries = new Set(loaded.buckets
        .map((bucket) => textOf(bucket.coreSummary).trim())
        .filter(Boolean));
    const pendingIds = new Set(queue.map((item) => item.id));
    const pendingSummaries = new Set(queue.map((item) => textOf(item.memory.coreSummary).trim()).filter(Boolean));
    const rejectedIds = new Set(rejected.map((item) => item.id));
    const rejectedSummaries = new Set(rejected.map((item) => item.normalizedCoreSummary).filter(Boolean));
    const added = [];
    const skipped = [];
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
        const record = {
            id,
            sourceLine: candidate.sourceLine,
            createdAt: new Date().toISOString(),
            pinOnApprove,
            memory: { ...candidate.memory, pinned: false },
        };
        queue.push(record);
        added.push(record);
        pendingIds.add(id);
        if (coreSummary)
            pendingSummaries.add(coreSummary);
    }
    if (added.length || forceWrite)
        await writeCandidateQueue(queue);
    return {
        candidates: extracted.length,
        pendingAdded: added.length,
        skipped: skipped.length,
        pendingTotal: queue.length,
        items: added.map(summarizeCandidate),
        skippedItems: skipped,
    };
}
function normalizeMemoryType(value) {
    const type = textOf(value).trim().toLowerCase();
    return type === "permanent" || type === "feel" || type === "plans" ? type : "dynamic";
}
function defaultDomain(type) {
    if (type === "feel")
        return ["relationship"];
    if (type === "permanent")
        return ["preference"];
    if (type === "plans")
        return ["project"];
    return ["general"];
}
function normalizeStringList(value, fallback) {
    const values = Array.isArray(value) ? value : textOf(value).split(/[,，]/);
    const result = Array.from(new Set(values.map((item) => textOf(item).trim()).filter(Boolean)));
    return result.length ? result.slice(0, 8) : fallback;
}
function boundedImportance(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(1, Math.min(10, Math.round(parsed))) : 6;
}
async function listMemoryCandidates() {
    const items = await readCandidateQueue();
    return { count: items.length, items: items.map(summarizeCandidate) };
}
async function listMemoryCandidatesForOrganization(limit = 12) {
    const items = (await readCandidateQueue()).filter(item => item.memory.source !== "candidate-organizer");
    const selected = items.slice(0, Math.max(1, Math.min(20, Math.floor(limit))));
    return { count: items.length, items: selected.map(summarizeCandidate) };
}
async function approveMemoryCandidate(id, options = {}) {
    const queue = await readCandidateQueue();
    const candidate = queue.find((item) => item.id === id);
    if (!candidate)
        throw new Error(`candidate not found: ${id}`);
    const store = (0, localStore_1.createLocalMemoryStore)();
    const loaded = await store.loadBuckets();
    if (loaded.buckets.some((bucket) => textOf(bucket.id) === id)) {
        await writeCandidateQueue(queue.filter((item) => item.id !== id));
        return { id, approved: false, duplicate: true };
    }
    if (candidate.memory.source === "raw-summary")
        throw new Error("这是一份待整理摘要，请先运行智能整理，再装订生成的记忆");
    const pinned = options.pin ?? candidate.pinOnApprove;
    const bucket = createManualMemory({
        ...candidate.memory,
        pinned,
        pinnedOrder: pinned ? 1000 : candidate.memory.pinnedOrder,
    });
    const path = await store.writeBucket(bucket);
    await writeCandidateQueue(queue.filter((item) => item.id !== id));
    return { id, approved: true, pinned, path };
}
async function rejectMemoryCandidate(id) {
    const queue = await readCandidateQueue();
    const candidate = queue.find((item) => item.id === id);
    if (!candidate)
        throw new Error(`candidate not found: ${id}`);
    const rejected = await readRejectedCandidates();
    const record = {
        id,
        normalizedCoreSummary: normalizeCandidateText(candidate.memory.coreSummary),
        rejectedAt: new Date().toISOString(),
        sourceLine: candidate.sourceLine,
    };
    const nextRejected = rejected.filter((item) => item.id !== id && (!record.normalizedCoreSummary || item.normalizedCoreSummary !== record.normalizedCoreSummary));
    nextRejected.push(record);
    await writeRejectedCandidates(nextRejected.slice(-MAX_REJECTED_CANDIDATES));
    await writeCandidateQueue(queue.filter((item) => item.id !== id));
    return { id, rejected: true };
}
function structuredCandidateRejectionReason(sourceSummary, candidate) {
    const candidateText = `${candidate.title}\n${candidate.coreSummary}\n${candidate.body}`;
    const metaPattern = /测试连接|连接测试|摘要能力|用于验证|当前短对话|本次互动没有|没有虚构世界|没有.{0,8}剧情|助手采用|没有完成用户要求|模型能力|插件测试|调试(?:插件|模型|提示词)|prompt\s*(?:test|format)|connection\s*test|capability\s*test/i;
    if (metaPattern.test(sourceSummary) || metaPattern.test(candidateText))
        return "meta_or_test_content";
    if (candidate.type === "permanent" && /偏好|风格|习惯|preference|style|habit/i.test(candidateText)) {
        const explicitPreference = /偏好|喜欢|希望|要求|习惯|不喜欢|不要|长期|以后|始终|一直|明确(?:表示|提出|要求)|prefer|want|always|never|long[- ]?term/i;
        if (!explicitPreference.test(sourceSummary))
            return "unsupported_permanent_preference";
    }
    return "";
}
async function updateMemoryCandidate(id, input) {
    const queue = await readCandidateQueue();
    const candidate = queue.find((item) => item.id === id);
    if (!candidate)
        throw new Error(`candidate not found: ${id}`);
    const title = textOf(input.title).trim();
    const body = textOf(input.body).trim();
    const coreSummary = textOf(input.coreSummary).trim();
    if (!title)
        throw new Error("candidate title is required");
    if (!body)
        throw new Error("candidate body is required");
    if (!coreSummary)
        throw new Error("candidate core summary is required");
    if (candidate.memory.source === "raw-summary") {
        const recap = extractRecap(body);
        candidate.memory.body = recap.found && recap.text ? recap.text : body;
        candidate.memory.recapStatus = recap.found && recap.text ? "ready" : "missing";
        candidate.memory.title = candidate.memory.recapStatus === "ready" ? "待整理的对话回顾" : "未找到对话回顾，待处理";
        candidate.sourceLine = candidate.memory.body;
        await writeCandidateQueue(queue);
        return { id, updated: true, candidate: summarizeCandidate(candidate) };
    }
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
function summarizeCandidate(candidate) {
    return {
        id: candidate.id,
        sourceLine: candidate.sourceLine,
        source: candidate.memory.source,
        recapStatus: candidate.memory.recapStatus,
        characterId: candidate.memory.characterId,
        chatId: candidate.memory.chatId,
        projectId: candidate.memory.projectId,
        whyRemembered: candidate.memory.whyRemembered,
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
async function readCandidateQueue() {
    try {
        const result = await AppFiles.read(candidateQueuePath());
        const text = readText(result);
        if (!text.trim())
            return [];
        const parsed = JSON.parse(text);
        const items = parsed.version === QUEUE_VERSION && Array.isArray(parsed.items) ? parsed.items : [];
        // Preserve IDs for deduplication; migrate only unorganized summaries.
        for (const item of items) {
            if (item.memory?.source !== "raw-summary" || item.memory.recapStatus) continue;
            const recap = extractRecap(item.memory.body);
            item.memory.recapStatus = recap.found && recap.text ? "ready" : "missing";
            item.memory.title = item.memory.recapStatus === "ready" ? "待整理的对话回顾" : "未找到对话回顾，待处理";
            if (item.memory.recapStatus === "ready") {
                item.memory.body = recap.text;
                item.sourceLine = recap.text;
            }
        }
        return items;
    }
    catch (error) {
        if (error && error.code === "ENOENT") return [];
        throw new Error("候选文件读取失败，保留原文件：" + String(error.message || error));
    }
}
async function writeCandidateQueue(items) {
    const path = candidateQueuePath();
    await AppFiles.mkdir(parentDir(path), true);
    const payload = {
        version: QUEUE_VERSION,
        updatedAt: new Date().toISOString(),
        items,
    };
    await AppFiles.write(path, JSON.stringify(payload, null, 2), false);
}
async function readRejectedCandidates() {
    try {
        const result = await AppFiles.read(rejectedCandidatesPath());
        const text = readText(result);
        if (!text.trim())
            return [];
        const parsed = JSON.parse(text);
        return parsed.version === REJECTED_VERSION && Array.isArray(parsed.items) ? parsed.items : [];
    }
    catch (error) {
        if (error && error.code === "ENOENT") return [];
        throw new Error("候选文件读取失败，保留原文件：" + String(error.message || error));
    }
}
async function writeRejectedCandidates(items) {
    const path = rejectedCandidatesPath();
    await AppFiles.mkdir(parentDir(path), true);
    const payload = {
        version: REJECTED_VERSION,
        updatedAt: new Date().toISOString(),
        items,
    };
    await AppFiles.write(path, JSON.stringify(payload, null, 2), false);
}
async function rememberProcessedCandidateIds(candidates) {
    const rejected = await readRejectedCandidates();
    const ids = new Set(candidates.map((item) => item.id));
    const next = rejected.filter((item) => !ids.has(item.id));
    const rejectedAt = new Date().toISOString();
    for (const candidate of candidates) {
        next.push({ id: candidate.id, normalizedCoreSummary: "", rejectedAt, sourceLine: candidate.sourceLine });
    }
    await writeRejectedCandidates(next.slice(-MAX_REJECTED_CANDIDATES));
}
function candidateQueuePath() {
    return joinPath((0, settings_1.memoryConfigRoot)(), "memory/candidates/pending.json");
}
function rejectedCandidatesPath() {
    return joinPath((0, settings_1.memoryConfigRoot)(), "memory/candidates/rejected.json");
}
function normalizeCandidateText(value) {
    return textOf(value).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}
function readText(value) {
    if (typeof value === "string")
        return value;
    if (!value || typeof value !== "object")
        return "";
    const record = value;
    for (const key of ["data", "content", "text", "result", "value"]) {
        const nested = readText(record[key]);
        if (nested)
            return nested;
    }
    return "";
}
function parentDir(path) {
    const normalized = path.replace(/\\/g, "/");
    return normalized.slice(0, normalized.lastIndexOf("/")) || normalized;
}
function joinPath(base, child) {
    return `${base.replace(/[\\/]+$/, "")}/${child.replace(/^[\\/]+/, "")}`.replace(/\\/g, "/").replace(/\/+/g, "/");
}
function textOf(value) {
    return value == null ? "" : String(value);
}
