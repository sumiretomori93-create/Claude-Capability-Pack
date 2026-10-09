"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ccp_memory_add = ccp_memory_add;
exports.ccp_memory_update = ccp_memory_update;
exports.ccp_memory_pin = ccp_memory_pin;
exports.ccp_memory_unpin = ccp_memory_unpin;
exports.ccp_memory_archive = ccp_memory_archive;
exports.ccp_memory_list_pinned = ccp_memory_list_pinned;
exports.ccp_memory_import_ombre_preview = ccp_memory_import_ombre_preview;
exports.ccp_memory_import_ombre_apply = ccp_memory_import_ombre_apply;
exports.ccp_memory_ingest_summary = ccp_memory_ingest_summary;
exports.ccp_memory_list_candidates = ccp_memory_list_candidates;
exports.ccp_memory_approve_candidate = ccp_memory_approve_candidate;
exports.ccp_memory_reject_candidate = ccp_memory_reject_candidate;
exports.registerToolPkg = registerToolPkg;
exports.onMessageProcessing = onMessageProcessing;
exports.onSummaryGenerate = onSummaryGenerate;
exports.onPromptFinalize = onPromptFinalize;
const localStore_1 = require("./localStore");
const index_ui_js_1 = __importDefault(require("./ui/memory_settings/index.ui.js"));
const settings_1 = require("./settings");
const importer_1 = require("./importer");
const candidateStore_1 = require("./candidateStore");
const { archiveMemory, buildMemoryPack, buildQueries, createManualMemory, listPinnedBuckets, makeMemoryId, pinBucket, unpinBucket, updateMemory, } = require("./memory-core/index");
const HOOK_ID = "ccp_memory_finalize";
const SUMMARY_HOOK_ID = "ccp_memory_summary_capture";
const MESSAGE_PROCESSING_ID = "ccp_memory_smart_capture";
const TARGET_STAGE = "before_send_to_model";
const SUMMARY_CAPTURE_STAGE = "after_generate_summary";
function textOf(value) {
    return value == null ? "" : String(value);
}
function logInfo(event, details = "") {
    console.log(`[ccp_memory] ${event}${details ? ` ${details}` : ""}`);
}
function recentContextFromTurns(turns, maxTurns = 6) {
    return turns
        .slice(Math.max(0, turns.length - maxTurns))
        .map((turn) => `${turn.kind}: ${textOf(turn.content).slice(0, 240)}`)
        .join("\n");
}
function lastUserContentFromTurns(turns) {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
        if (turns[index].kind === "USER") {
            return textOf(turns[index].content);
        }
    }
    return "";
}
function mergeQueryInputs(primary, fallback) {
    const left = primary.trim();
    const right = fallback.trim();
    if (!left) {
        return right;
    }
    if (!right || left.includes(right)) {
        return left;
    }
    if (right.includes(left)) {
        return right;
    }
    return `${left}\n${right}`;
}
function hasExistingMemoryMarkerNearCurrentUser(turns) {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
        if (turns[index].kind === "USER") {
            const content = textOf(turns[index].content);
            return content.includes("[Core memory]") || content.includes("[Temporary memory context]");
        }
    }
    return false;
}
function buildMemoryContext(pack) {
    return [pack.coreText, pack.retrievalText].filter(Boolean).join("\n\n").trim();
}
function prependMemoryContext(input, memoryContext) {
    const text = input.trim();
    if (!memoryContext) {
        return input;
    }
    return [memoryContext, "[Current user message]", text].join("\n\n");
}
function memoryAppliesToActivePrompt(settings, activePrompt) {
    if (!settings.requireCharacterMatch) {
        return true;
    }
    const activeId = textOf(activePrompt?.id).trim();
    const activeName = textOf(activePrompt?.name).trim();
    return matchesSettingValue(activeId, settings.enabledCharacterIds) || matchesSettingValue(activeName, settings.enabledCharacterNames);
}
function matchesSettingValue(value, allowedValues) {
    if (!value) {
        return false;
    }
    const normalized = value.toLocaleLowerCase();
    return allowedValues.some((item) => item.trim().toLocaleLowerCase() === normalized);
}
function success(data) {
    return { success: true, data };
}
function failure(message) {
    return { success: false, error: message };
}
function getBucketId(bucket) {
    if (bucket && typeof bucket === "object" && "id" in bucket) {
        return textOf(bucket.id);
    }
    return "";
}
async function findBucketById(id) {
    const store = (0, localStore_1.createLocalMemoryStore)();
    const loadResult = await store.loadBuckets();
    const bucket = loadResult.buckets.find((item) => getBucketId(item) === id) || null;
    return { bucket, buckets: loadResult.buckets };
}
async function writeManagedBucket(bucket) {
    const store = (0, localStore_1.createLocalMemoryStore)();
    return store.writeBucket(bucket);
}
async function ccp_memory_add(params) {
    try {
        const body = textOf(params.body).trim();
        if (!body) {
            return failure("body is required");
        }
        const now = new Date().toISOString();
        const requestedId = textOf(params.id).trim();
        const id = requestedId || makeMemoryId(body, now);
        if (requestedId) {
            const { bucket } = await findBucketById(id);
            if (bucket) {
                return failure(`memory already exists: ${id}`);
            }
        }
        const bucket = createManualMemory({
            id,
            body,
            title: textOf(params.title).trim() || undefined,
            type: textOf(params.type).trim() || "dynamic",
            domain: normalizeListParam(params.domain),
            tags: normalizeListParam(params.tags),
            importance: Number(params.importance ?? 5),
            pinned: Boolean(params.pinned),
            pinnedScope: textOf(params.pinned_scope).trim() || "global",
            pinnedOrder: Number(params.pinned_order ?? 1000),
            coreSummary: textOf(params.core_summary).trim() || undefined,
            now,
        });
        const path = await writeManagedBucket(bucket);
        return success({ id: getBucketId(bucket), path });
    }
    catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
    }
}
async function ccp_memory_update(params) {
    try {
        const id = textOf(params.id).trim();
        if (!id) {
            return failure("id is required");
        }
        const { bucket } = await findBucketById(id);
        if (!bucket) {
            return failure(`memory not found: ${id}`);
        }
        const updated = updateMemory(bucket, {
            body: params.body == null ? undefined : textOf(params.body),
            title: params.title == null ? undefined : textOf(params.title),
            domain: params.domain == null ? undefined : normalizeListParam(params.domain),
            tags: params.tags == null ? undefined : normalizeListParam(params.tags),
            importance: params.importance,
            resolved: params.resolved,
            digested: params.digested,
            coreSummary: params.core_summary == null ? undefined : textOf(params.core_summary),
            now: new Date().toISOString(),
        });
        const path = await writeManagedBucket(updated);
        return success({ id, path });
    }
    catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
    }
}
async function ccp_memory_pin(params) {
    try {
        const id = textOf(params.id).trim();
        if (!id) {
            return failure("id is required");
        }
        const { bucket } = await findBucketById(id);
        if (!bucket) {
            return failure(`memory not found: ${id}`);
        }
        const pinned = pinBucket(bucket, {
            scope: textOf(params.scope).trim() || "global",
            order: params.order,
            coreSummary: textOf(params.core_summary).trim() || undefined,
            currentScope: {
                chatId: textOf(params.chat_id).trim() || undefined,
                characterId: textOf(params.character_id).trim() || undefined,
                projectId: textOf(params.project_id).trim() || undefined,
            },
        });
        const path = await writeManagedBucket(pinned);
        return success({ id, path });
    }
    catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
    }
}
async function ccp_memory_unpin(params) {
    try {
        const id = textOf(params.id).trim();
        if (!id) {
            return failure("id is required");
        }
        const { bucket } = await findBucketById(id);
        if (!bucket) {
            return failure(`memory not found: ${id}`);
        }
        const unpinned = unpinBucket(bucket);
        const path = await writeManagedBucket(unpinned);
        return success({ id, path });
    }
    catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
    }
}
async function ccp_memory_archive(params) {
    try {
        const id = textOf(params.id).trim();
        if (!id) {
            return failure("id is required");
        }
        const { bucket } = await findBucketById(id);
        if (!bucket) {
            return failure(`memory not found: ${id}`);
        }
        const archived = archiveMemory(bucket, new Date().toISOString());
        const path = await writeManagedBucket(archived);
        return success({ id, path });
    }
    catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
    }
}
async function ccp_memory_list_pinned(params = {}) {
    try {
        const store = (0, localStore_1.createLocalMemoryStore)();
        const loadResult = await store.loadBuckets();
        const items = listPinnedBuckets(loadResult.buckets, {
            chatId: textOf(params.chat_id).trim() || undefined,
            characterId: textOf(params.character_id).trim() || undefined,
            projectId: textOf(params.project_id).trim() || undefined,
        });
        return success({
            count: items.length,
            items: items.map((item) => summarizeBucket(item)),
            errors: loadResult.errors,
        });
    }
    catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
    }
}
async function ccp_memory_import_ombre_preview(params) {
    try {
        const sourceRoot = textOf(params.source_root).trim();
        const preview = await (0, importer_1.previewOmbreStagingImport)(sourceRoot);
        return success({ ...preview, summary: (0, importer_1.formatOmbreImportPreview)(preview) });
    }
    catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
    }
}
async function ccp_memory_import_ombre_apply(params) {
    try {
        const sourceRoot = textOf(params.source_root).trim();
        const result = await (0, importer_1.applyOmbreStagingImport)(sourceRoot);
        return success({ ...result, summary: (0, importer_1.formatOmbreImportApplyResult)(result) });
    }
    catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
    }
}
async function ccp_memory_ingest_summary(params) {
    try {
        const summary = textOf(params.summary).trim();
        if (!summary) {
            return failure("summary is required");
        }
        const settings = await (0, settings_1.loadMemorySettings)();
        if (!settings.summaryCaptureEnabled) {
            return success({ candidates: 0, pendingAdded: 0, skipped: 0, disabled: true });
        }
        return success(await (0, candidateStore_1.captureSummaryCandidates)({
            summary,
            sourceId: textOf(params.source_id).trim() || undefined,
            chatId: textOf(params.chat_id).trim() || undefined,
            characterId: textOf(params.character_id).trim() || undefined,
            projectId: textOf(params.project_id).trim() || undefined,
            pinOnApprove: typeof params.pin_core === "boolean" ? params.pin_core : settings.pinCapturedCore,
        }));
    }
    catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
    }
}
async function ccp_memory_list_candidates() {
    try {
        return success(await (0, candidateStore_1.listMemoryCandidates)());
    }
    catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
    }
}
async function ccp_memory_approve_candidate(params) {
    try {
        const id = textOf(params.id).trim();
        if (!id)
            return failure("id is required");
        return success(await (0, candidateStore_1.approveMemoryCandidate)(id, {
            pin: typeof params.pin === "boolean" ? params.pin : undefined,
        }));
    }
    catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
    }
}
async function ccp_memory_reject_candidate(params) {
    try {
        const id = textOf(params.id).trim();
        if (!id)
            return failure("id is required");
        return success(await (0, candidateStore_1.rejectMemoryCandidate)(id));
    }
    catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
    }
}
function summarizeBucket(bucket) {
    if (!bucket || typeof bucket !== "object") {
        return {};
    }
    const value = bucket;
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
function normalizeListParam(value) {
    if (Array.isArray(value)) {
        return value.map((item) => textOf(item).trim()).filter(Boolean);
    }
    return textOf(value)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}
function registerToolPkg() {
    const settingsRoute = "toolpkg:com.claude_capability_pack.memory:ui:memory_settings";
    ToolPkg.registerToolboxUiModule({
        id: "memory_settings",
        runtime: "compose_dsl",
        screen: index_ui_js_1.default,
        params: {},
        title: {
            zh: "本地记忆设置",
            en: "Local Memory Settings",
        },
        keepAlive: true,
    });
    ToolPkg.registerNavigationEntry({
        id: "memory_settings_sidebar",
        route: settingsRoute,
        surface: "main_sidebar_plugins",
        title: {
            zh: "本地记忆",
            en: "Local Memory",
        },
        icon: "settings",
        order: 230,
    });
    ToolPkg.registerPromptFinalizeHook({
        id: HOOK_ID,
        function: onPromptFinalize,
    });
    ToolPkg.registerSummaryGenerateHook({
        id: SUMMARY_HOOK_ID,
        function: onSummaryGenerate,
    });
    ToolPkg.registerMessageProcessingPlugin({
        id: MESSAGE_PROCESSING_ID,
        function: onMessageProcessing,
    });
    logInfo("registered", `hook_id=${HOOK_ID} summary_hook_id=${SUMMARY_HOOK_ID} message_processing_id=${MESSAGE_PROCESSING_ID}`);
    return true;
}
async function onMessageProcessing(event) {
    void event;
    return { matched: false };
}
async function onSummaryGenerate(event) {
    const startedAt = Date.now();
    const payload = event.eventPayload || {};
    const stage = textOf(payload.stage || event.eventName);
    if (stage !== SUMMARY_CAPTURE_STAGE) {
        return null;
    }
    const summary = textOf(payload.summaryResult).trim();
    if (!summary) {
        logInfo("summary_capture_skipped", `reason=empty stage=${stage}`);
        return null;
    }
    const activePrompt = payload.metadata?.activePrompt;
    const settings = await (0, settings_1.loadMemorySettings)();
    if (!settings.summaryCaptureEnabled) {
        logInfo("summary_capture_skipped", `reason=disabled stage=${stage}`);
        return null;
    }
    const sourceId = makeMemoryId(summary, textOf(payload.stage || "summary"));
    const result = await ccp_memory_ingest_summary({
        summary,
        source_id: sourceId,
        character_id: activePrompt?.id,
        chat_id: textOf(payload.chatId || ""),
    });
    const data = (result.data || result || {});
    logInfo("summary_capture_completed", [
        `stage=${stage}`,
        "mode=rules_to_candidates",
        `success=${"success" in result ? Boolean(result.success) : true}`,
        `candidates=${textOf(data.candidates || 0)}`,
        `pending_added=${textOf(data.pendingAdded || 0)}`,
        `skipped=${textOf(data.skipped || 0)}`,
        `elapsed_ms=${Date.now() - startedAt}`,
        "success" in result && !result.success ? `error=${formatLogText(textOf(result.error))}` : "",
    ].filter(Boolean).join(" "));
    return null;
}
async function onPromptFinalize(event) {
    const startedAt = Date.now();
    const payload = event.eventPayload || {};
    const stage = textOf(payload.stage || event.eventName);
    if (stage !== TARGET_STAGE) {
        return null;
    }
    const sourceHistory = payload.preparedHistory || payload.chatHistory || [];
    if (!sourceHistory.length) {
        logInfo("skipped", `reason=empty_history stage=${stage}`);
        return null;
    }
    if (hasExistingMemoryMarkerNearCurrentUser(sourceHistory)) {
        logInfo("skipped", `reason=current_user_already_has_memory stage=${stage}`);
        return null;
    }
    const input = textOf(payload.processedInput || payload.rawInput);
    const historyInput = lastUserContentFromTurns(sourceHistory);
    const queryInput = mergeQueryInputs(input, historyInput);
    const activePrompt = payload.metadata?.activePrompt;
    const scope = {
        characterId: activePrompt?.id,
        chatId: textOf(payload.chatId || ""),
    };
    try {
        const settings = await (0, settings_1.loadMemorySettings)();
        if (!settings.enabled) {
            logInfo("skipped", `reason=disabled settings_path=${(0, settings_1.memorySettingsPath)()}`);
            return null;
        }
        if (settings.requireCharacterMatch && !settings.enabledCharacterIds.length && !settings.enabledCharacterNames.length) {
            logInfo("skipped_scope", "reason=empty_allowlist settings_path=" + (0, settings_1.memorySettingsPath)());
            return null;
        }
        if (!memoryAppliesToActivePrompt(settings, activePrompt)) {
            logInfo("skipped_scope", [`character_id=${textOf(activePrompt?.id) || "none"}`, `character_name=${textOf(activePrompt?.name) || "none"}`].join(" "));
            return null;
        }
        await captureSummaryTurns(sourceHistory, activePrompt, scope.chatId);
        const store = (0, localStore_1.createLocalMemoryStore)();
        const loadResult = await store.loadBuckets();
        const recentContext = recentContextFromTurns(sourceHistory, settings.recentContextTurns);
        const queries = buildQueries(queryInput, recentContext);
        const pack = buildMemoryPack(loadResult.buckets, queries, scope, settings);
        const memoryContext = buildMemoryContext(pack);
        if (!memoryContext) {
            logInfo("completed", [
                `stage=${stage}`,
                `buckets=${loadResult.buckets.length}`,
                `errors=${loadResult.errors.length}`,
                `queries=${queries.length}`,
                `input_preview=${formatLogText(queryInput)}`,
                `query_texts=${formatLogList(queries.map((query) => query.text))}`,
                `core=${pack.coreItems.length}`,
                `retrieval=${pack.retrievalItems.length}`,
                `memory_chars=0`,
                `returned=none`,
                `elapsed_ms=${Date.now() - startedAt}`,
            ].join(" "));
            return null;
        }
        const processedInput = prependMemoryContext(input, memoryContext);
        logInfo("completed", [
            `stage=${stage}`,
            `buckets=${loadResult.buckets.length}`,
            `errors=${loadResult.errors.length}`,
            `queries=${queries.length}`,
            `input_preview=${formatLogText(queryInput)}`,
            `query_texts=${formatLogList(queries.map((query) => query.text))}`,
            `core=${pack.coreItems.length}`,
            `retrieval=${pack.retrievalItems.length}`,
            `retrieval_ids=${formatLogList(pack.retrievalItems.map((item) => getBucketId(item.bucket)))}`,
            `memory_chars=${memoryContext.length}`,
            `processed_chars=${processedInput.length}`,
            `history_turns=${sourceHistory.length}`,
            `returned=processedInput`,
            `elapsed_ms=${Date.now() - startedAt}`,
        ].join(" "));
        return { processedInput };
    }
    catch (error) {
        logInfo("failed", error instanceof Error ? error.message : String(error));
        return null;
    }
}
function formatLogList(values) {
    const cleaned = values.map((value) => textOf(value).replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 4);
    return cleaned.length ? JSON.stringify(cleaned).slice(0, 240) : "[]";
}
function formatLogText(value) {
    const cleaned = textOf(value).replace(/\s+/g, " ").trim();
    return JSON.stringify(cleaned.slice(0, 120));
}
async function captureSummaryTurns(turns, activePrompt, chatId) {
    const settings = await (0, settings_1.loadMemorySettings)();
    if (!settings.summaryCaptureEnabled)
        return;
    const summaryTurns = turns
        .filter((turn) => textOf(turn.kind).toUpperCase() === "SUMMARY")
        .map((turn) => textOf(turn.content).trim())
        .filter(Boolean)
        .slice(-3);
    for (const summary of summaryTurns) {
        const result = await ccp_memory_ingest_summary({
            summary,
            source_id: makeMemoryId(summary, "history-summary"),
            character_id: activePrompt?.id,
            chat_id: chatId,
        });
        const data = (result.data || {});
        logInfo("summary_history_capture", [
            `success=${Boolean(result.success)}`,
            `candidates=${textOf(data.candidates || 0)}`,
            `pending_added=${textOf(data.pendingAdded || 0)}`,
            `skipped=${textOf(data.skipped || 0)}`,
            result.success ? "" : `error=${formatLogText(textOf(result.error))}`,
        ].filter(Boolean).join(" "));
    }
}
