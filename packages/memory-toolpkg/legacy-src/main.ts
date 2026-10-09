declare function require(name: string): unknown;

import { createLocalMemoryStore } from "./localStore";
import memorySettingsScreen from "./ui/memory_settings/index.ui.js";
import { loadMemorySettings, memorySettingsPath, type MemoryRuntimeSettings } from "./settings";
import {
  applyOmbreStagingImport,
  formatOmbreImportApplyResult,
  formatOmbreImportPreview,
  previewOmbreStagingImport,
} from "./importer";
import {
  approveMemoryCandidate,
  captureSummaryCandidates,
  listMemoryCandidates,
  rejectMemoryCandidate,
} from "./candidateStore";

interface MemoryFileSystem {
  readText(path: string): Promise<string>;
  listFiles(root: string): Promise<string[]>;
}

interface MemoryQuery {
  kind: "explicit" | "entity" | "reference";
  text: string;
}

interface MemoryScope {
  characterId?: string;
  chatId?: string;
  projectId?: string;
}

interface ActivePromptSnapshotLike {
  id?: string;
  name?: string;
  type?: string;
}

interface MemoryPackResult {
  coreText: string;
  retrievalText: string;
  coreItems: Array<{ bucket: unknown }>;
  retrievalItems: Array<{ bucket: unknown }>;
}

const {
  archiveMemory,
  buildMemoryPack,
  buildQueries,
  createManualMemory,
  listPinnedBuckets,
  makeMemoryId,
  pinBucket,
  unpinBucket,
  updateMemory,
} = require("./memory-core/index") as {
  archiveMemory: (bucket: unknown, now?: string) => unknown;
  buildMemoryPack: (
    buckets: unknown[],
    queries: MemoryQuery[],
    scope?: MemoryScope,
    settings?: {
      maxPinnedItems?: number;
      maxPinnedCharsPerItem?: number;
      maxPinnedPackChars?: number;
      maxRetrievalItems?: number;
      maxRetrievalCharsPerItem?: number;
      maxRetrievalPackChars?: number;
    }
  ) => MemoryPackResult;
  buildQueries: (input: string, recentContext?: string) => MemoryQuery[];
  createManualMemory: (input: Record<string, unknown>) => unknown;
  listPinnedBuckets: (buckets: unknown[], scope?: MemoryScope) => unknown[];
  makeMemoryId: (seed: string, now?: string) => string;
  pinBucket: (bucket: unknown, options?: Record<string, unknown>) => unknown;
  unpinBucket: (bucket: unknown) => unknown;
  updateMemory: (bucket: unknown, input: Record<string, unknown>) => unknown;
};

const HOOK_ID = "ccp_memory_finalize";
const SUMMARY_HOOK_ID = "ccp_memory_summary_capture";
const MESSAGE_PROCESSING_ID = "ccp_memory_smart_capture";
const TARGET_STAGE = "before_send_to_model";
const SUMMARY_CAPTURE_STAGE = "after_generate_summary";

function textOf(value: unknown): string {
  return value == null ? "" : String(value);
}

function logInfo(event: string, details = ""): void {
  console.log(`[ccp_memory] ${event}${details ? ` ${details}` : ""}`);
}

function recentContextFromTurns(turns: ToolPkg.PromptTurn[], maxTurns = 6): string {
  return turns
    .slice(Math.max(0, turns.length - maxTurns))
    .map((turn) => `${turn.kind}: ${textOf(turn.content).slice(0, 240)}`)
    .join("\n");
}

function lastUserContentFromTurns(turns: ToolPkg.PromptTurn[]): string {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index].kind === "USER") {
      return textOf(turns[index].content);
    }
  }
  return "";
}

function mergeQueryInputs(primary: string, fallback: string): string {
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

function hasExistingMemoryMarkerNearCurrentUser(turns: ToolPkg.PromptTurn[]): boolean {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index].kind === "USER") {
      const content = textOf(turns[index].content);
      return content.includes("[Core memory]") || content.includes("[Temporary memory context]");
    }
  }
  return false;
}

function buildMemoryContext(pack: MemoryPackResult): string {
  return [pack.coreText, pack.retrievalText].filter(Boolean).join("\n\n").trim();
}

function prependMemoryContext(input: string, memoryContext: string): string {
  const text = input.trim();
  if (!memoryContext) {
    return input;
  }
  return [memoryContext, "[Current user message]", text].join("\n\n");
}

function memoryAppliesToActivePrompt(
  settings: MemoryRuntimeSettings,
  activePrompt?: ActivePromptSnapshotLike
): boolean {
  if (!settings.requireCharacterMatch) {
    return true;
  }
  const activeId = textOf(activePrompt?.id).trim();
  const activeName = textOf(activePrompt?.name).trim();
  return matchesSettingValue(activeId, settings.enabledCharacterIds) || matchesSettingValue(activeName, settings.enabledCharacterNames);
}

function matchesSettingValue(value: string, allowedValues: string[]): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.toLocaleLowerCase();
  return allowedValues.some((item) => item.trim().toLocaleLowerCase() === normalized);
}

function success(data: unknown): Record<string, unknown> {
  return { success: true, data };
}

function failure(message: string): Record<string, unknown> {
  return { success: false, error: message };
}

function getBucketId(bucket: unknown): string {
  if (bucket && typeof bucket === "object" && "id" in bucket) {
    return textOf((bucket as { id?: unknown }).id);
  }
  return "";
}

async function findBucketById(id: string): Promise<{ bucket: unknown | null; buckets: unknown[] }> {
  const store = createLocalMemoryStore();
  const loadResult = await store.loadBuckets();
  const bucket = loadResult.buckets.find((item) => getBucketId(item) === id) || null;
  return { bucket, buckets: loadResult.buckets };
}

async function writeManagedBucket(bucket: unknown): Promise<string> {
  const store = createLocalMemoryStore();
  return store.writeBucket(bucket as never);
}

export async function ccp_memory_add(params: {
  body?: string;
  id?: string;
  title?: string;
  type?: string;
  domain?: string[] | string;
  tags?: string[] | string;
  importance?: number;
  pinned?: boolean;
  pinned_scope?: string;
  pinned_order?: number;
  core_summary?: string;
}): Promise<Record<string, unknown>> {
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
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}

export async function ccp_memory_update(params: {
  id?: string;
  body?: string;
  title?: string;
  domain?: string[] | string;
  tags?: string[] | string;
  importance?: number;
  resolved?: boolean;
  digested?: boolean;
  core_summary?: string;
}): Promise<Record<string, unknown>> {
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
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}

export async function ccp_memory_pin(params: {
  id?: string;
  scope?: string;
  order?: number;
  core_summary?: string;
  chat_id?: string;
  character_id?: string;
  project_id?: string;
}): Promise<Record<string, unknown>> {
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
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}

export async function ccp_memory_unpin(params: { id?: string }): Promise<Record<string, unknown>> {
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
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}

export async function ccp_memory_archive(params: { id?: string }): Promise<Record<string, unknown>> {
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
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}

export async function ccp_memory_list_pinned(params: {
  chat_id?: string;
  character_id?: string;
  project_id?: string;
} = {}): Promise<Record<string, unknown>> {
  try {
    const store = createLocalMemoryStore();
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
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}

export async function ccp_memory_import_ombre_preview(params: {
  source_root?: string;
}): Promise<Record<string, unknown>> {
  try {
    const sourceRoot = textOf(params.source_root).trim();
    const preview = await previewOmbreStagingImport(sourceRoot);
    return success({ ...preview, summary: formatOmbreImportPreview(preview) });
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}

export async function ccp_memory_import_ombre_apply(params: {
  source_root?: string;
}): Promise<Record<string, unknown>> {
  try {
    const sourceRoot = textOf(params.source_root).trim();
    const result = await applyOmbreStagingImport(sourceRoot);
    return success({ ...result, summary: formatOmbreImportApplyResult(result) });
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}

export async function ccp_memory_ingest_summary(params: {
  summary?: string;
  source_id?: string;
  chat_id?: string;
  character_id?: string;
  project_id?: string;
  pin_core?: boolean;
}): Promise<Record<string, unknown>> {
  try {
    const summary = textOf(params.summary).trim();
    if (!summary) {
      return failure("summary is required");
    }
    const settings = await loadMemorySettings();
    if (!settings.summaryCaptureEnabled) {
      return success({ candidates: 0, pendingAdded: 0, skipped: 0, disabled: true });
    }
    return success(await captureSummaryCandidates({
      summary,
      sourceId: textOf(params.source_id).trim() || undefined,
      chatId: textOf(params.chat_id).trim() || undefined,
      characterId: textOf(params.character_id).trim() || undefined,
      projectId: textOf(params.project_id).trim() || undefined,
      pinOnApprove: typeof params.pin_core === "boolean" ? params.pin_core : settings.pinCapturedCore,
    }));
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}

export async function ccp_memory_list_candidates(): Promise<Record<string, unknown>> {
  try {
    return success(await listMemoryCandidates());
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}

export async function ccp_memory_approve_candidate(params: { id?: string; pin?: boolean }): Promise<Record<string, unknown>> {
  try {
    const id = textOf(params.id).trim();
    if (!id) return failure("id is required");
    return success(await approveMemoryCandidate(id, {
      pin: typeof params.pin === "boolean" ? params.pin : undefined,
    }));
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}

export async function ccp_memory_reject_candidate(params: { id?: string }): Promise<Record<string, unknown>> {
  try {
    const id = textOf(params.id).trim();
    if (!id) return failure("id is required");
    return success(await rejectMemoryCandidate(id));
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}

function summarizeBucket(bucket: unknown): Record<string, unknown> {
  if (!bucket || typeof bucket !== "object") {
    return {};
  }
  const value = bucket as Record<string, unknown>;
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

function normalizeListParam(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => textOf(item).trim()).filter(Boolean);
  }
  return textOf(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function registerToolPkg(): boolean {
  const settingsRoute = "toolpkg:com.claude_capability_pack.memory:ui:memory_settings";

  ToolPkg.registerToolboxUiModule({
    id: "memory_settings",
    runtime: "compose_dsl",
    screen: memorySettingsScreen,
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

  logInfo(
    "registered",
    `hook_id=${HOOK_ID} summary_hook_id=${SUMMARY_HOOK_ID} message_processing_id=${MESSAGE_PROCESSING_ID}`
  );
  return true;
}

export async function onMessageProcessing(
  event: ToolPkg.MessageProcessingHookEvent
): Promise<{ matched: false }> {
  void event;
  return { matched: false };
}

export async function onSummaryGenerate(
  event: ToolPkg.SummaryGenerateHookEvent
): Promise<ToolPkg.SummaryHookObjectResult | null | void> {
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
  const settings = await loadMemorySettings();
  if (!settings.summaryCaptureEnabled) {
    logInfo("summary_capture_skipped", `reason=disabled stage=${stage}`);
    return null;
  }
  const sourceId = makeMemoryId(summary, textOf(payload.stage || "summary"));
  const result = await ccp_memory_ingest_summary({
    summary,
    source_id: sourceId,
    character_id: activePrompt?.id,
    chat_id: textOf((payload as unknown as { chatId?: unknown }).chatId || ""),
  });
  const data = ((result as { data?: unknown }).data || result || {}) as Record<string, unknown>;
  logInfo(
    "summary_capture_completed",
    [
      `stage=${stage}`,
      "mode=rules_to_candidates",
      `success=${"success" in result ? Boolean(result.success) : true}`,
      `candidates=${textOf(data.candidates || 0)}`,
      `pending_added=${textOf(data.pendingAdded || 0)}`,
      `skipped=${textOf(data.skipped || 0)}`,
      `elapsed_ms=${Date.now() - startedAt}`,
      "success" in result && !result.success ? `error=${formatLogText(textOf(result.error))}` : "",
    ].filter(Boolean).join(" ")
  );
  return null;
}

export async function onPromptFinalize(
  event: ToolPkg.PromptFinalizeHookEvent
): Promise<string | void | ToolPkg.PromptTurn[] | ToolPkg.PromptHookObjectResult | null> {
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
  const scope: MemoryScope = {
    characterId: activePrompt?.id,
    chatId: textOf(payload.chatId || ""),
  };

  try {
    const settings = await loadMemorySettings();
    if (!settings.enabled) {
      logInfo("skipped", `reason=disabled settings_path=${memorySettingsPath()}`);
      return null;
    }
      if (!memoryAppliesToActivePrompt(settings, activePrompt)) {
        logInfo(
          "skipped_scope",
          [`character_id=${textOf(activePrompt?.id) || "none"}`, `character_name=${textOf(activePrompt?.name) || "none"}`].join(" ")
        );
        return null;
      }
      await captureSummaryTurns(sourceHistory, activePrompt, scope.chatId);
      const store = createLocalMemoryStore();
    const loadResult = await store.loadBuckets();
    const recentContext = recentContextFromTurns(sourceHistory, settings.recentContextTurns);
    const queries = buildQueries(queryInput, recentContext);
    const pack = buildMemoryPack(loadResult.buckets, queries, scope, settings);
    const memoryContext = buildMemoryContext(pack);

    if (!memoryContext) {
      logInfo(
        "completed",
        [
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
        ].join(" ")
      );
      return null;
    }

    const processedInput = prependMemoryContext(input, memoryContext);
    logInfo(
      "completed",
      [
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
      ].join(" ")
    );

    return { processedInput };
  } catch (error) {
    logInfo("failed", error instanceof Error ? error.message : String(error));
    return null;
  }
}

function formatLogList(values: string[]): string {
  const cleaned = values.map((value) => textOf(value).replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 4);
  return cleaned.length ? JSON.stringify(cleaned).slice(0, 240) : "[]";
}

function formatLogText(value: string): string {
  const cleaned = textOf(value).replace(/\s+/g, " ").trim();
  return JSON.stringify(cleaned.slice(0, 120));
}

async function captureSummaryTurns(
  turns: ToolPkg.PromptTurn[],
  activePrompt?: ActivePromptSnapshotLike,
  chatId?: string
): Promise<void> {
  const settings = await loadMemorySettings();
  if (!settings.summaryCaptureEnabled) return;
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
    const data = (result.data || {}) as Record<string, unknown>;
    logInfo(
      "summary_history_capture",
      [
        `success=${Boolean(result.success)}`,
        `candidates=${textOf(data.candidates || 0)}`,
        `pending_added=${textOf(data.pendingAdded || 0)}`,
        `skipped=${textOf(data.skipped || 0)}`,
        result.success ? "" : `error=${formatLogText(textOf(result.error))}`,
      ].filter(Boolean).join(" ")
    );
  }
}
