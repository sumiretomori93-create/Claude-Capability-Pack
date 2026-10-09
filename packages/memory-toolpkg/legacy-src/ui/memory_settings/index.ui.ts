import type { ComposeDslContext, ComposeNode } from "../../operitComposeTypes";
import {
  DEFAULT_MEMORY_SETTINGS,
  loadMemorySettings,
  memorySettingsPath,
  normalizeMemorySettings,
  saveMemorySettings,
  type MemoryRuntimeSettings,
} from "../../settings";
import {
  archiveMemoryLibraryItem,
  formatMemoryLibraryStats,
  getMemoryLibraryStats,
  rebuildMemoryLibraryStats,
  searchMemoryLibrary,
  setMemoryLibraryItemPinned,
  updateMemoryLibraryItem,
  type MemoryLibraryStats,
  type MemorySearchResult,
} from "../../browser";
import {
  applyOmbreStagingImport,
  formatOmbreImportApplyResult,
  formatOmbreImportPreview,
  previewOmbreStagingImport,
} from "../../importer";
import { createLocalMemoryStore } from "../../localStore";
import {
  approveMemoryCandidate,
  listMemoryCandidates,
  rejectMemoryCandidate,
  updateMemoryCandidate,
} from "../../candidateStore";
import {
  getSmartCaptureStatus,
  processPendingSmartCaptureJobs,
} from "../../smartCapture";

type UiState = {
  settings: MemoryRuntimeSettings;
  stats: MemoryLibraryStats | null;
  statsText: string;
  searchResult: MemorySearchResult | null;
  importPath: string;
  importResult: string;
  canImport: boolean;
  activeBucketsPath: string;
  activeSettingsPath: string;
  settingsStatus: string;
  candidates: { count: number; items: Array<Record<string, unknown>> };
  smartCapture: Record<string, unknown>;
};

const DEFAULT_IMPORT_PATH = "";

function integerInput(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function listInput(value: unknown): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of String(value ?? "").split(/[,，\n]/)) {
    const text = item.trim();
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    result.push(text);
  }
  return result;
}

function listText(values: string[]): string {
  return values.join(", ");
}

function textOf(value: unknown): string {
  return value == null ? "" : String(value);
}

export function unwrapBridgeArgument(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  try {
    const parsed = JSON.parse(textOf(value));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch (_error) {
    return {};
  }
}

function defaultUiState(): UiState {
  return {
    settings: { ...DEFAULT_MEMORY_SETTINGS },
    stats: null,
    statsText: "正在显影记忆册状态...",
    searchResult: null,
    importPath: DEFAULT_IMPORT_PATH,
    importResult: "尚未扫描",
    canImport: false,
    activeBucketsPath: "",
    activeSettingsPath: "",
    settingsStatus: "设置尚未读取",
    candidates: { count: 0, items: [] },
    smartCapture: { pending: 0, processing: false },
  };
}

async function readUiState(): Promise<UiState> {
  const settings = await loadMemorySettings();
  const store = createLocalMemoryStore();
  let stats = await getMemoryLibraryStats();
  if (stats.total === 0) {
    stats = await rebuildMemoryLibraryStats();
  }
  const candidates = await listMemoryCandidates();
  const smartCapture = await getSmartCaptureStatus();
  return {
    ...defaultUiState(),
    settings,
    stats,
    statsText: formatMemoryLibraryStats(stats),
    activeBucketsPath: store.bucketRoots.join("\n"),
    activeSettingsPath: memorySettingsPath(),
    settingsStatus: "设置读取完成",
    candidates,
    smartCapture,
  };
}

export function settingsFromPayload(payload: Record<string, unknown>): MemoryRuntimeSettings {
  return normalizeMemorySettings({
    enabled: Boolean(payload.enabled),
    summaryCaptureEnabled: Boolean(payload.summaryCaptureEnabled),
    smartSummaryCaptureEnabled: Boolean(payload.smartSummaryCaptureEnabled),
    pinCapturedCore: Boolean(payload.pinCapturedCore),
    requireCharacterMatch: Boolean(payload.requireCharacterMatch),
    enabledCharacterIds: listInput(payload.enabledCharacterIds),
    enabledCharacterNames: listInput(payload.enabledCharacterNames),
    maxPinnedItems: integerInput(payload.maxPinnedItems, DEFAULT_MEMORY_SETTINGS.maxPinnedItems),
    maxPinnedCharsPerItem: integerInput(payload.maxPinnedCharsPerItem, DEFAULT_MEMORY_SETTINGS.maxPinnedCharsPerItem),
    maxPinnedPackChars: integerInput(payload.maxPinnedPackChars, DEFAULT_MEMORY_SETTINGS.maxPinnedPackChars),
    maxRetrievalItems: integerInput(payload.maxRetrievalItems, DEFAULT_MEMORY_SETTINGS.maxRetrievalItems),
    maxRetrievalCharsPerItem: integerInput(
      payload.maxRetrievalCharsPerItem,
      DEFAULT_MEMORY_SETTINGS.maxRetrievalCharsPerItem
    ),
    maxRetrievalPackChars: integerInput(payload.maxRetrievalPackChars, DEFAULT_MEMORY_SETTINGS.maxRetrievalPackChars),
    recentContextTurns: integerInput(payload.recentContextTurns, DEFAULT_MEMORY_SETTINGS.recentContextTurns),
  });
}

function toClientState(state: UiState): Record<string, unknown> {
  return {
    settings: {
      ...state.settings,
      enabledCharacterIdsText: listText(state.settings.enabledCharacterIds),
      enabledCharacterNamesText: listText(state.settings.enabledCharacterNames),
    },
    stats: state.stats,
    statsText: state.statsText,
    searchResult: state.searchResult,
    importPath: state.importPath,
    importResult: state.importResult,
    canImport: state.canImport,
    activeBucketsPath: state.activeBucketsPath,
    activeSettingsPath: state.activeSettingsPath,
    settingsStatus: state.settingsStatus,
    candidates: state.candidates,
    smartCapture: state.smartCapture,
  };
}

function escapeScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

export default function Screen(ctx: ComposeDslContext): ComposeNode {
  const controller = ctx.useMemo("butterfly-webview-controller", () => ctx.createWebViewController("butterfly-memory-ui"), []);
  const loadedRef = ctx.useRef("butterfly-loaded", false);

  async function emitState(nextState: UiState): Promise<void> {
    await controller.evaluateJavascript(`window.MemoryArchive && window.MemoryArchive.setState(${escapeScriptJson(toClientState(nextState))});`);
  }

  function pushState(nextState: UiState): void {
    void Promise.resolve()
      .then(() => emitState(nextState))
      .catch((error) => console.log(`[ccp_memory_ui] emit failed ${String(error)}`));
  }

  function notify(message: string): void {
    void Promise.resolve()
      .then(() => ctx.showToast(message))
      .catch((error) => console.log(`[ccp_memory_ui] toast failed ${String(error)}`));
  }

  function runBackground(task: () => Promise<void>): void {
    void Promise.resolve()
      .then(task)
      .catch((error) => console.log(`[ccp_memory_ui] background failed ${String(error)}`));
  }

  function stateJson(state: UiState): string {
    return JSON.stringify(toClientState(state));
  }

  async function load(): Promise<void> {
    if (loadedRef.current) {
      return;
    }
    loadedRef.current = true;
    const state = defaultUiState();
    const approvingCandidateIds = new Set<string>();
    const mutatingMemoryIds = new Set<string>();
    function mergeState(next: Partial<UiState>): void {
      Object.assign(state, next || {});
    }
    async function applySmartResult(result: Record<string, unknown>): Promise<void> {
      state.candidates = await listMemoryCandidates();
      state.smartCapture = await getSmartCaptureStatus();
      const processed = Number(result.processed || 0);
      const inputCandidates = Number(result.inputCandidates || 0);
      const outputCandidates = Number(result.outputCandidates || 0);
      const qualityRejected = Number(result.qualityRejected || 0);
      const modelRejected = Number(result.modelRejected || 0);
      const pending = Number(result.pending || 0);
      if (result.disabled) {
        state.settingsStatus = "智能整理未开启";
        notify("请先开启候选智能整理");
      } else if (result.busy) {
        state.settingsStatus = "候选正在整理";
        notify("记忆模型正在整理候选，请稍后刷新");
      } else if (!processed && !pending && !inputCandidates) {
        state.settingsStatus = "没有待整理候选";
        notify("当前候选区为空");
      } else if (processed > 0) {
        const rejected = qualityRejected + modelRejected;
        state.settingsStatus = `模型智能整理完成：${inputCandidates} 条原候选整理为 ${outputCandidates} 条独立记忆${rejected ? `，另过滤 ${rejected} 条不合格结果` : ""}`;
        notify(outputCandidates > 0 ? `模型已将候选整理为 ${outputCandidates} 条独立记忆` : "整理完成，这批内容没有值得长期保存的记忆");
      } else {
        const lastError = textOf(state.smartCapture.lastError).trim();
        state.settingsStatus = lastError ? `本次整理失败：${lastError}` : "本次整理未完成";
        notify("本次整理未完成，原候选保持不变");
      }
    }
    async function refreshSearchResult(): Promise<void> {
      if (!state.searchResult) return;
      state.searchResult = await searchMemoryLibrary({ query: state.searchResult.query, limit: 8 });
    }
    controller.addJavascriptInterface("MemoryBridge", {
      async ready() {
        mergeState(await readUiState());
        return stateJson(state);
      },
      async refreshStats() {
        state.statsText = "正在读取缓存...";
        const stats = await getMemoryLibraryStats();
        state.stats = stats;
        state.statsText = formatMemoryLibraryStats(stats);
        return stateJson(state);
      },
      async rebuildStats() {
        state.statsText = "正在重扫本地记忆库...";
        const stats = await rebuildMemoryLibraryStats();
        state.stats = stats;
        state.statsText = formatMemoryLibraryStats(stats);
        return stateJson(state);
      },
      async search(query: string) {
        const text = textOf(unwrapBridgeArgument(query));
        state.searchResult = await searchMemoryLibrary({ query: text, limit: 8 });
        return stateJson(state);
      },
      async refreshCandidates() {
        state.candidates = await listMemoryCandidates();
        state.smartCapture = await getSmartCaptureStatus();
        return stateJson(state);
      },
      async processSmartQueue(payload: unknown) {
        const input = parseJsonObject(unwrapBridgeArgument(payload));
        state.settings = await saveMemorySettings(settingsFromPayload(input));
        state.activeSettingsPath = memorySettingsPath();
        state.candidates = await listMemoryCandidates();
        state.smartCapture = await getSmartCaptureStatus();
        if (!state.settings.smartSummaryCaptureEnabled) {
          state.settingsStatus = "智能整理未开启";
          notify("请先开启候选智能整理");
          return stateJson(state);
        }
        if (state.smartCapture.processing) {
          state.settingsStatus = "候选正在整理";
          notify("记忆模型正在整理候选，请稍后刷新");
          return stateJson(state);
        }
        if (state.candidates.count <= 0 && Number(state.smartCapture.legacyPending || 0) <= 0) {
          state.settingsStatus = "没有待整理候选";
          notify("当前候选区为空");
          return stateJson(state);
        }
        state.settingsStatus = "已提交后台整理，原候选会保留到整理成功";
        runBackground(async () => {
          try {
            const result = await processPendingSmartCaptureJobs({ maxCandidates: 2 });
            await applySmartResult(result);
          } catch (error) {
            state.smartCapture = await getSmartCaptureStatus();
            state.settingsStatus = `智能整理失败：${error instanceof Error ? error.message : String(error)}`;
            notify("智能整理失败，原候选没有改动");
          }
          pushState(state);
        });
        return stateJson(state);
      },
      async approveCandidate(id: string) {
        const candidateId = textOf(unwrapBridgeArgument(id));
        if (!candidateId || approvingCandidateIds.has(candidateId)) {
          notify("这条候选正在装订");
          return stateJson(state);
        }
        approvingCandidateIds.add(candidateId);
        state.settingsStatus = "已提交后台装订，请稍候";
        runBackground(async () => {
          try {
            await approveMemoryCandidate(candidateId);
            state.candidates = await listMemoryCandidates();
            state.stats = await rebuildMemoryLibraryStats();
            state.statsText = formatMemoryLibraryStats(state.stats);
            state.settingsStatus = "记忆装订成功";
            notify("候选已装订进记忆册");
          } catch (error) {
            state.settingsStatus = `装订失败：${error instanceof Error ? error.message : String(error)}`;
            notify("记忆装订失败，候选仍然保留");
          } finally {
            approvingCandidateIds.delete(candidateId);
          }
          pushState(state);
        });
        return stateJson(state);
      },
      async rejectCandidate(id: string) {
        await rejectMemoryCandidate(textOf(unwrapBridgeArgument(id)));
        state.candidates = await listMemoryCandidates();
        notify("候选已移除");
        return stateJson(state);
      },
      async updateCandidate(payload: unknown) {
        const input = parseJsonObject(unwrapBridgeArgument(payload));
        await updateMemoryCandidate(textOf(input.id), input);
        state.candidates = await listMemoryCandidates();
        notify("候选修改已保存");
        return stateJson(state);
      },
      async updateMemory(payload: unknown) {
        const input = parseJsonObject(unwrapBridgeArgument(payload));
        await updateMemoryLibraryItem({
          id: textOf(input.id),
          title: textOf(input.title),
          coreSummary: textOf(input.coreSummary),
          body: textOf(input.body),
          domain: listInput(input.domain),
          tags: listInput(input.tags),
          importance: integerInput(input.importance, 5),
        });
        await refreshSearchResult();
        state.stats = await getMemoryLibraryStats();
        state.statsText = formatMemoryLibraryStats(state.stats);
        notify("记忆修改已保存");
        return stateJson(state);
      },
      async deleteMemory(id: string) {
        const memoryId = textOf(unwrapBridgeArgument(id));
        if (!memoryId || mutatingMemoryIds.has(memoryId)) return JSON.stringify({ accepted: false, id: memoryId });
        mutatingMemoryIds.add(memoryId);
        runBackground(async () => {
          try {
            await archiveMemoryLibraryItem(memoryId);
            await refreshSearchResult();
            state.stats = await getMemoryLibraryStats();
            state.statsText = formatMemoryLibraryStats(state.stats);
            notify("记忆已移入归档，不再参与搜索和召回");
          } catch (error) {
            await refreshSearchResult();
            notify(`归档失败：${error instanceof Error ? error.message : String(error)}`);
          } finally {
            mutatingMemoryIds.delete(memoryId);
          }
          pushState(state);
        });
        return JSON.stringify({ accepted: true, id: memoryId });
      },
      async setMemoryPinned(payload: unknown) {
        const input = parseJsonObject(unwrapBridgeArgument(payload));
        const memoryId = textOf(input.id);
        const pinned = Boolean(input.pinned);
        if (!memoryId || mutatingMemoryIds.has(memoryId)) return JSON.stringify({ accepted: false, id: memoryId });
        mutatingMemoryIds.add(memoryId);
        runBackground(async () => {
          try {
            await setMemoryLibraryItemPinned(memoryId, pinned);
            await refreshSearchResult();
            state.stats = await getMemoryLibraryStats();
            state.statsText = formatMemoryLibraryStats(state.stats);
            notify(pinned ? "已钉选为核心记忆" : "已取消核心记忆");
          } catch (error) {
            await refreshSearchResult();
            notify(`核心记忆操作失败：${error instanceof Error ? error.message : String(error)}`);
          } finally {
            mutatingMemoryIds.delete(memoryId);
          }
          pushState(state);
        });
        return JSON.stringify({ accepted: true, id: memoryId, pinned });
      },
      async saveSettings(payload: unknown) {
        const nextSettings = settingsFromPayload(parseJsonObject(unwrapBridgeArgument(payload)));
        state.settings = nextSettings;
        state.settingsStatus = "正在保存设置...";
        state.settings = await saveMemorySettings(nextSettings);
        state.activeSettingsPath = memorySettingsPath();
        state.settingsStatus = `已写入并读回验证：${memorySettingsPath()}`;
        notify("设置已保存");
        return stateJson(state);
      },
      resetSettings() {
        state.settings = { ...DEFAULT_MEMORY_SETTINGS };
        notify("已恢复默认值，点击保存后生效");
        return stateJson(state);
      },
      async previewImport(path: string) {
        state.importPath = textOf(unwrapBridgeArgument(path)).trim() || DEFAULT_IMPORT_PATH;
        state.importResult = "正在扫描待导入目录...";
        state.canImport = false;
        const preview = await previewOmbreStagingImport(state.importPath);
        state.importResult = formatOmbreImportPreview(preview);
        state.canImport = preview.newCount > 0 && preview.errors.length === 0;
        return stateJson(state);
      },
      async applyImport(path: string) {
        state.importPath = textOf(unwrapBridgeArgument(path)).trim() || DEFAULT_IMPORT_PATH;
        state.importResult = "正在收入记忆册...";
        state.canImport = false;
        const result = await applyOmbreStagingImport(state.importPath);
        state.importResult = formatOmbreImportApplyResult(result);
        state.canImport = false;
        return stateJson(state);
      },
    });
    controller.loadHtml(buildHtml(toClientState(state)), { baseUrl: "https://local.memory.archive/" });
  }

  return ctx.UI.WebView({
    fillMaxSize: true,
    controller,
    javaScriptEnabled: true,
    domStorageEnabled: false,
    allowFileAccess: false,
    allowContentAccess: false,
    mixedContentMode: "neverAllow",
    onLoad: load,
  });
}

function buildHtml(initialState: Record<string, unknown>): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<style>
:root{
  --paper:#f9f7fb;--paper2:#fffdf8;--ink:#34273f;--muted:#7f7690;--lav:#beb5d2;--lav2:#ddd8e8;
  --violet:#6d5a86;--deep:#4a405e;--rose:#a9879d;--line:rgba(74,64,94,.22);--glass:rgba(255,255,255,.58);
  --shadow:0 24px 60px rgba(51,42,66,.18);--soft:0 10px 26px rgba(74,64,94,.12);
}
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#d9d5e2;color:var(--ink);font-family:"Noto Serif SC","Songti SC","SimSun",serif;}
body{overflow-x:hidden;background:
  radial-gradient(circle at 82% 9%,rgba(190,181,210,.65),transparent 23rem),
  radial-gradient(circle at 4% 65%,rgba(145,134,167,.34),transparent 18rem),
  linear-gradient(145deg,#eeedf4 0%,#f8f6fa 46%,#d6d0df 100%);}
button,input{font:inherit}button{border:0;cursor:pointer;color:inherit}.app{position:relative;max-width:980px;margin:0 auto;padding:14px 10px 86px;min-height:100vh;}
.grain,.wash{position:fixed;inset:0;pointer-events:none}.grain{opacity:.22;background-image:radial-gradient(rgba(74,64,94,.16) .7px,transparent .8px);background-size:9px 9px;mix-blend-mode:multiply}.wash{background:radial-gradient(circle at 74% 26%,rgba(126,104,155,.22),transparent 16rem),radial-gradient(circle at 34% 10%,rgba(255,255,255,.72),transparent 14rem)}
.stack{position:relative;padding:14px 8px 12px}.stack:before,.stack:after{content:"";position:absolute;left:25px;right:15px;top:6px;bottom:0;border:1px solid rgba(255,255,255,.72);border-radius:18px;background:rgba(255,255,255,.18);transform:rotate(-2.8deg);box-shadow:var(--soft)}.stack:after{left:14px;right:25px;top:13px;transform:rotate(2.1deg);background:rgba(255,255,255,.23)}
.sheet{position:relative;z-index:1;height:calc(100vh - 112px);min-height:560px;padding:18px 16px 18px;border-radius:16px;background:linear-gradient(160deg,rgba(255,255,255,.96),rgba(248,246,252,.92));box-shadow:var(--shadow);border:1px solid rgba(255,255,255,.9);overflow:hidden;display:flex;flex-direction:column}.sheet:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 72% 22%,rgba(190,181,210,.46),transparent 13rem),radial-gradient(circle at 86% 36%,rgba(145,134,167,.24),transparent 8rem),linear-gradient(90deg,rgba(255,255,255,.82),transparent 34%,rgba(255,255,255,.45));pointer-events:none}.sheet:after{content:"";position:absolute;left:-2px;top:0;bottom:0;width:30px;background:linear-gradient(90deg,rgba(222,216,232,.72),rgba(255,255,255,.04));border-right:1px dashed rgba(74,64,94,.22)}
.hole{position:absolute;left:8px;width:13px;height:13px;border-radius:50%;background:#d6d0df;box-shadow:inset 2px 2px 5px rgba(74,64,94,.2),0 0 0 4px rgba(255,255,255,.48);z-index:2}.h1{top:74px}.h2{top:125px}.h3{top:176px}.h4{top:227px}.clip{position:absolute;right:15px;top:82px;width:34px;height:54px;border:4px solid rgba(45,38,56,.68);border-left-color:transparent;border-radius:22px;transform:rotate(7deg);filter:drop-shadow(0 4px 7px rgba(35,30,42,.2));z-index:3}.clip:after{content:"";position:absolute;left:7px;top:7px;width:20px;height:32px;border:2px solid rgba(255,255,255,.7);border-left-color:transparent;border-radius:16px}
.cover{position:relative;z-index:2;text-align:center;padding:16px 0 10px}.folio{position:absolute;left:28px;top:2px;width:42px;height:54px;background:rgba(255,255,255,.62);border:1px solid rgba(74,64,94,.2);box-shadow:var(--soft);display:grid;place-items:center;color:var(--deep);font-size:19px}.band{margin:40px -8px 16px;padding:12px 8px;border-top:1px solid rgba(255,255,255,.8);border-bottom:1px solid rgba(74,64,94,.16);background:rgba(255,255,255,.46);backdrop-filter:blur(10px);box-shadow:0 8px 22px rgba(74,64,94,.08)}h1{margin:0;font-size:26px;letter-spacing:.03em;font-weight:600}.sub{margin-top:3px;font:600 11px Georgia,serif;letter-spacing:.08em;color:var(--deep)}.quote{margin:10px 18px 4px;color:var(--deep);font-size:14px;line-height:1.55}.butterfly{position:absolute;right:18%;top:84px;color:rgba(109,90,134,.38);font-size:32px;transform:rotate(-18deg)}
.board-head{position:relative;z-index:2;padding:20px 8px 12px;border-bottom:1px solid rgba(74,64,94,.16)}.board-head .eyebrow{display:block;margin-bottom:7px;color:var(--rose);font:600 11px Georgia,serif;letter-spacing:.14em}.board-head h2{margin:0;color:var(--deep);font-size:28px;font-weight:500}.board-head p{margin:7px 0 0;color:var(--muted);font-size:13px;line-height:1.6}.board-head .board-mark{position:absolute;right:18px;top:17px;width:46px;height:46px;border:1px solid rgba(74,64,94,.24);border-radius:50%;display:grid;place-items:center;color:var(--deep);font:500 18px Georgia,serif;background:rgba(255,255,255,.38)}
.status{display:inline-grid;grid-template-columns:12px auto;gap:7px;align-items:center;margin-top:8px;padding:8px 13px;border-radius:12px;background:rgba(255,255,255,.58);border:1px solid rgba(74,64,94,.2);box-shadow:var(--soft);font:700 11px Georgia,serif;letter-spacing:.05em}.dot{width:8px;height:8px;border-radius:50%;background:var(--lav);box-shadow:0 0 12px var(--lav)}.dot.on{background:#8f79b0}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px}.metric{position:relative;min-height:76px;padding:12px 9px;background:rgba(255,255,255,.72);box-shadow:var(--soft);border:1px solid rgba(255,255,255,.75);transform:rotate(var(--r,0deg))}.metric:nth-child(2){--r:.8deg}.metric:nth-child(3){--r:-.7deg}.metric:nth-child(4){--r:.5deg}.metric b{display:block;font-size:26px;font-weight:500;color:var(--deep);line-height:1}.metric span{display:block;margin-top:5px;color:var(--muted);font-size:12px}.metric:after{content:"";position:absolute;right:8px;bottom:8px;width:25px;height:1px;background:var(--line)}
.tabs{position:fixed;left:12px;right:12px;bottom:12px;z-index:18;display:grid;grid-template-columns:repeat(5,1fr);gap:5px;padding:7px;border-radius:20px;background:rgba(248,246,252,.8);border:1px solid rgba(255,255,255,.8);box-shadow:0 16px 42px rgba(51,42,66,.22);backdrop-filter:blur(14px)}.tab{min-width:0;padding:9px 4px;border-radius:14px;background:transparent;color:var(--deep);font-size:12px;line-height:1}.tab.active{background:var(--deep);color:#fff;box-shadow:var(--soft)}
.pages{position:relative;z-index:2;min-height:0;flex:1 1 auto;overflow:hidden}.page{display:none;height:100%;overflow:auto;padding:0 2px 12px 0;position:relative;z-index:2}.page.active{display:block;animation:develop .26s ease both}@keyframes develop{from{opacity:0;filter:blur(5px);transform:translateY(6px)}to{opacity:1;filter:blur(0);transform:none}}.paper{position:relative;margin:10px 0;padding:14px 13px;background:rgba(255,255,255,.78);border:1px solid rgba(255,255,255,.78);box-shadow:var(--soft);border-radius:10px}.paper h2{margin:0 0 5px;font-size:19px;font-weight:500}.paper p{margin:0;color:var(--muted);line-height:1.55;font-size:13px}.row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px}.row b{font-size:14px}.switch{width:48px;height:27px;border-radius:999px;background:#cbc8d3;padding:3px;transition:.2s;flex:0 0 auto}.switch i{display:block;width:21px;height:21px;border-radius:50%;background:white;box-shadow:0 2px 8px rgba(0,0,0,.18);transition:.2s}.switch.on{background:#7e6c9e}.switch.on i{transform:translateX(21px)}
.field{display:grid;gap:6px;margin-top:11px}.field label{font-size:11px;color:var(--muted);letter-spacing:.04em}.field input{width:100%;border:1px solid rgba(74,64,94,.2);border-radius:11px;padding:10px 11px;background:rgba(255,255,255,.68);color:var(--ink);outline:none;box-shadow:inset 0 1px 0 rgba(255,255,255,.8);font-size:13px}.field input:focus{border-color:rgba(109,90,134,.54);box-shadow:0 0 0 4px rgba(190,181,210,.26)}.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:38px;padding:9px 14px;border-radius:13px;background:linear-gradient(180deg,rgba(255,255,255,.78),rgba(221,216,232,.72));border:1px solid rgba(74,64,94,.18);box-shadow:var(--soft);font-weight:600;color:var(--deep);font-size:13px}.btn.primary{background:linear-gradient(180deg,#776493,#4a405e);color:#fff}.btn:disabled{opacity:.46}.actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:12px}.empty{min-height:150px;display:grid;place-items:center;text-align:center;color:var(--deep);background:radial-gradient(circle at center,rgba(255,255,255,.86),rgba(255,255,255,.35));border:1px solid rgba(255,255,255,.7);border-radius:13px}.empty b{font-size:20px;font-weight:500}.empty span{display:block;color:var(--muted);margin-top:7px;font-size:13px}.result-list{display:grid;gap:10px;margin-top:12px}.memory-card{position:relative;padding:13px 12px 12px 15px;background:rgba(255,255,255,.76);border:1px solid rgba(74,64,94,.14);box-shadow:var(--soft);border-radius:12px;overflow:hidden}.memory-card:before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(var(--lav),var(--rose))}.memory-card h3{margin:0 34px 6px 0;font-size:16px;font-weight:500}.memory-card p{margin:0;color:var(--muted);line-height:1.55;font-size:13px}.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.tag{padding:4px 8px;border-radius:999px;background:rgba(190,181,210,.26);color:var(--deep);font-size:11px}.tag.core{background:rgba(109,90,134,.16);border:1px solid rgba(109,90,134,.24)}.score{position:absolute;right:10px;top:10px;color:var(--rose);font:700 11px Georgia,serif}.spec{display:grid;grid-template-columns:1fr 1fr;gap:9px}.raw{white-space:pre-wrap;font-family:"Consolas","Menlo",monospace;font-size:11px;line-height:1.5;color:var(--muted)}
.candidate-actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}.candidate-actions .btn{min-height:32px;padding:6px 10px}.btn.danger{color:#8a4051;border-color:rgba(138,64,81,.24);background:rgba(255,247,249,.82)}.candidate-edit{display:grid;gap:9px;margin-top:9px}.candidate-edit label{display:grid;gap:5px;color:var(--muted);font-size:11px}.candidate-edit input,.candidate-edit textarea{width:100%;border:1px solid rgba(74,64,94,.2);border-radius:9px;padding:9px 10px;background:rgba(255,255,255,.72);color:var(--ink);outline:none;font:13px/1.55 "Noto Serif SC","Songti SC","SimSun",serif}.candidate-edit textarea{min-height:116px;resize:vertical}.candidate-edit input:focus,.candidate-edit textarea:focus{border-color:rgba(109,90,134,.54);box-shadow:0 0 0 3px rgba(190,181,210,.22)}.candidate-summary{padding:8px 9px;margin-top:9px;border-left:2px solid var(--lav);background:rgba(190,181,210,.12);color:var(--deep);font-size:12px;line-height:1.5;white-space:pre-wrap}.memory-detail{margin-top:10px;padding-top:10px;border-top:1px solid var(--line)}.memory-detail b{display:block;margin-bottom:5px;font-size:12px;color:var(--deep)}.memory-meta{margin-top:9px;color:var(--muted);font-size:11px;line-height:1.55}.memory-card p{white-space:pre-wrap}.lace{height:1px;background:linear-gradient(90deg,transparent,var(--line),transparent);margin:16px 0}.toast{position:fixed;left:50%;bottom:84px;transform:translateX(-50%) translateY(18px);opacity:0;z-index:20;max-width:86%;padding:9px 13px;border-radius:999px;background:rgba(74,64,94,.92);color:white;box-shadow:var(--shadow);transition:.22s;font-size:13px}.toast.show{opacity:1;transform:translateX(-50%)}
@media (max-width:560px){.app{padding:8px 4px 76px}.stack{padding:8px 4px 8px}.sheet{height:calc(100vh - 90px);min-height:520px;padding:14px 11px 14px}.sheet:after{width:24px}.hole{left:5px}.cover{padding-left:14px}.folio{left:22px;width:36px;height:48px;font-size:17px}.clip{display:none}h1{font-size:21px}.sub{font-size:10px}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.spec{grid-template-columns:1fr}.band{margin:34px 0 12px;padding:10px 8px}.quote{font-size:13px}.board-head{padding:16px 5px 10px}.board-head h2{font-size:23px}.paper{padding:13px 11px}.row{align-items:flex-start}.tabs{left:8px;right:8px;bottom:8px}.tab{font-size:11px}.butterfly{display:none}}
</style>
</head>
<body>
<div class="wash"></div><div class="grain"></div><main class="app"><section class="stack"><article class="sheet">
<span class="hole h1"></span><span class="hole h2"></span><span class="hole h3"></span><span class="hole h4"></span><span class="clip"></span>
<div class="pages">
<section class="page active" id="page-develop"><div class="cover"><div class="folio" id="folioTotal">--</div><div class="butterfly">&#10022;</div><div class="band"><h1>BUTTERFLY EFFECT</h1><div class="sub">LOCAL MEMORY ARCHIVE</div></div><div class="quote">一些很小的事，后来成为了现在的我们。</div><button class="status" id="enabledStatus" data-toggle="enabled"><span class="dot"></span><span>记忆册加载：读取中</span></button><div class="metrics"><div class="metric"><b id="mTotal">--</b><span>全部碎片</span></div><div class="metric"><b id="mCore">--</b><span>核心蝶迹</span></div><div class="metric"><b id="mActive">--</b><span>本轮可见</span></div><div class="metric"><b id="mErrors">--</b><span>待修复页</span></div></div><div class="actions"><button class="btn" data-action="refresh">刷新卷宗</button><button class="btn primary" data-action="save">保存设置</button></div></div>
<div class="paper"><h2>召回检索</h2><p>输入一个名字、地点、约定或片段，让相关记忆从纸面显影。</p><div class="field"><label>DEVELOP KEYWORD</label><input id="searchQuery" placeholder="例如：七夕" /></div><div class="actions"><button class="btn primary" data-action="search">开始显影</button></div><div id="searchArea" class="empty"><div><b>尚未显影</b><span>输入关键词后，记忆碎片会在这里逐渐清晰。</span></div></div></div><div class="paper"><h2>记忆册状态</h2><p>如果你手动把 .md 文件放进本地库，点“重扫本地库”重建索引。</p><div class="actions"><button class="btn" data-action="refresh">读取缓存</button><button class="btn primary" data-action="rebuild">重扫本地库</button></div><div class="field"><label>当前本地库路径</label><input id="activeBucketsPath" readonly /></div><div class="field"><label>当前设置文件路径</label><input id="activeSettingsPath" readonly /></div><pre class="raw" id="statsText">尚未刷新</pre></div></section>
<section class="page" id="page-privacy"><div class="board-head"><span class="eyebrow">PRIVATE ACCESS</span><h2>心扣权限</h2><p>谁可以翻开这本记忆册。</p><span class="board-mark">♡</span></div><div class="paper"><h2>谁可以翻开这本册子</h2><p>心扣闭合时，只有指定角色卡能访问这套记忆。</p><div class="row"><div><b>角色心扣</b><p id="privacyHint">当前状态读取中。</p></div><button class="switch" data-toggle="requireCharacterMatch"><i></i></button></div><div class="field"><label>允许的角色卡名称</label><input id="enabledCharacterNames" placeholder="Claude, Gabe" /></div><div class="field"><label>允许的角色卡 ID</label><input id="enabledCharacterIds" /></div><div class="actions"><button class="btn primary" data-action="save">保存角色限制</button></div></div></section>
<section class="page" id="page-summary"><div class="board-head"><span class="eyebrow">MEMORY BINDING</span><h2>候选装订</h2><p>先收集，再判断什么值得留下。</p><span class="board-mark">Ⅱ</span></div><div class="paper"><h2>候选收集</h2><p>摘要只负责产生原始候选，不调用模型，也不会直接进入正式记忆库。</p><div class="lace"></div><div class="row"><div><b>收集对话碎片</b><p>关闭时不会产生新的候选。</p></div><button class="switch" data-toggle="summaryCaptureEnabled"><i></i></button></div><div class="row"><div><b>候选智能整理</b><p>使用当前聊天模型评估候选价值，去重并合并同一事件；请求和回复不会写入聊天记录。</p></div><button class="switch" data-toggle="smartSummaryCaptureEnabled"><i></i></button></div><div class="row"><div><b>通过后默认钉选</b><p>只有点击“装订”确认后才会生效。</p></div><button class="switch" data-toggle="pinCapturedCore"><i></i></button></div><div class="actions"><button class="btn primary" data-action="save">保存候选设置</button></div></div><div class="paper"><h2>待审核碎片</h2><p>智能整理每次读取最多 2 条候选，降低模型输出被截断或格式损坏的概率。</p><div class="actions"><button class="btn" data-action="refreshCandidates">刷新候选</button><button class="btn primary" data-action="processSmartQueue">智能整理候选</button></div><pre class="raw" id="smartCaptureStatus">待整理候选：0</pre><div id="candidateArea" class="empty"><div><b>没有待审核碎片</b><span>新的候选会显示在这里。</span></div></div></div></section>
<section class="page" id="page-import"><div class="board-head"><span class="eyebrow">LOOSE PAGES</span><h2>散页移栽</h2><p>把 Ombre 的旧记忆收入本地记忆册。</p><span class="board-mark">04</span></div><div class="paper"><h2>将散落的页带回来</h2><p>这里填 Ombre staging/待导入目录，不要填当前 memory/buckets。本地库重扫请去“显影”页。</p><div class="field"><label>OMBRE STAGING DIRECTORY</label><input id="importPath" placeholder="待导入目录，不是 memory/buckets" /></div><div class="actions"><button class="btn" data-action="previewImport">扫描待导入目录</button><button class="btn primary" data-action="applyImport">收入记忆册</button></div><pre class="raw" id="importResult">尚未扫描</pre></div></section>
<section class="page" id="page-spec"><div class="board-head"><span class="eyebrow">ARCHIVE SPECIFICATION</span><h2>装订规格</h2><p>调整记忆注入开关与召回容量。</p><span class="board-mark">05</span></div><div class="paper"><h2>记忆注入</h2><p>关闭后，Hook 仍会注册，但不会把任何本地记忆附加到消息。</p><div class="row"><div><b>记忆册加载</b><p id="enabledHint">当前状态读取中。</p></div><button class="switch" data-toggle="enabled" aria-label="记忆册加载"><i></i></button></div><div class="actions"><button class="btn primary" data-action="save">保存记忆开关</button></div></div><div class="paper"><h2>册后规格</h2><p>这些参数控制核心页和临时显影的容量。</p><div class="spec"><div class="field"><label>核心条数</label><input id="maxPinnedItems" inputmode="numeric" /></div><div class="field"><label>核心单条字符</label><input id="maxPinnedCharsPerItem" inputmode="numeric" /></div><div class="field"><label>核心总字符</label><input id="maxPinnedPackChars" inputmode="numeric" /></div><div class="field"><label>召回条数</label><input id="maxRetrievalItems" inputmode="numeric" /></div><div class="field"><label>召回单条字符</label><input id="maxRetrievalCharsPerItem" inputmode="numeric" /></div><div class="field"><label>召回总字符</label><input id="maxRetrievalPackChars" inputmode="numeric" /></div><div class="field"><label>回看轮数</label><input id="recentContextTurns" inputmode="numeric" /></div></div><div class="actions"><button class="btn" data-action="reset">恢复默认</button><button class="btn primary" data-action="save">保存规格</button></div><pre class="raw" id="settingsStatus">设置尚未读取</pre></div></section>
</div></article></section></main><nav class="tabs"><button class="tab active" data-page="develop">显影</button><button class="tab" data-page="privacy">心扣</button><button class="tab" data-page="summary">装订</button><button class="tab" data-page="import">散页</button><button class="tab" data-page="spec">规格</button></nav><div class="toast" id="toast"></div>
<script>window.__INITIAL_STATE__=${escapeScriptJson(initialState)};</script>
<script>
(function(){
var state=window.__INITIAL_STATE__||{};var busy=false;var readyAttempts=0;var editingCandidateId='';var expandedSearchId='';var editingSearchId='';
function $(s,r){return (r||document).querySelector(s)}
function $$(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))}
function val(v,f){return v===undefined||v===null?f:v}
function hasClass(el,name){return el&&(' '+el.className+' ').indexOf(' '+name+' ')>-1}
function addClass(el,name){if(el&&!hasClass(el,name)){el.className=(el.className?el.className+' ':'')+name}}
function removeClass(el,name){if(el){el.className=(' '+el.className+' ').replace(' '+name+' ',' ').replace(/^\s+|\s+$/g,'')}}
function toggleClass(el,name,on){if(on){addClass(el,name)}else{removeClass(el,name)}}
function data(el,name){return el?el.getAttribute('data-'+name):''}
function closest(el,selector){while(el&&el!==document){if(selector==='[data-action]'&&el.getAttribute&&el.getAttribute('data-action'))return el;if(selector==='[data-toggle]'&&el.getAttribute&&el.getAttribute('data-toggle'))return el;if(selector==='.tab'&&hasClass(el,'tab'))return el;el=el.parentNode}return null}
function text(el,value){if(el)el.textContent=value}
function inputValue(id,value){var el=$('#'+id);if(el)el.value=value}
function toast(t){var el=$('#toast');if(!el)return;el.textContent=String(t||'');addClass(el,'show');setTimeout(function(){removeClass(el,'show')},1800)}
function setBusy(on){busy=on;toggleClass(document.body,'busy',on)}
function bridgeReady(){return !!(window.MemoryBridge&&typeof window.MemoryBridge.ready==='function')}
function parseResult(raw){if(typeof raw==='string'){try{return JSON.parse(raw)}catch(_e){return raw}}return raw}
function acceptState(x){if(x&&x.settings){state=x;render()}}
function call(name){
  var args=Array.prototype.slice.call(arguments,1);
  if(!window.MemoryBridge||typeof window.MemoryBridge[name]!=='function'){
    toast('桥接尚未就绪，稍后再点一次');
    return Promise.reject(new Error('bridge not ready'));
  }
  setBusy(true);
  var result;
  try{result=window.MemoryBridge[name].apply(window.MemoryBridge,args)}catch(e){setBusy(false);toast(e&&e.message?e.message:String(e));return Promise.reject(e)}
  return Promise.resolve(result).then(function(raw){setBusy(false);return parseResult(raw)},function(e){setBusy(false);toast(e&&e.message?e.message:String(e));throw e});
}
function bool(k){return !!(state.settings&&state.settings[k])}
function setBool(k,v){state.settings=state.settings||{};state.settings[k]=v;render()}
function form(){var s=state.settings||{};return{enabled:!!s.enabled,summaryCaptureEnabled:!!s.summaryCaptureEnabled,smartSummaryCaptureEnabled:!!s.smartSummaryCaptureEnabled,pinCapturedCore:!!s.pinCapturedCore,requireCharacterMatch:!!s.requireCharacterMatch,enabledCharacterNames:val($('#enabledCharacterNames')&&$('#enabledCharacterNames').value,''),enabledCharacterIds:val($('#enabledCharacterIds')&&$('#enabledCharacterIds').value,''),maxPinnedItems:val($('#maxPinnedItems')&&$('#maxPinnedItems').value,''),maxPinnedCharsPerItem:val($('#maxPinnedCharsPerItem')&&$('#maxPinnedCharsPerItem').value,''),maxPinnedPackChars:val($('#maxPinnedPackChars')&&$('#maxPinnedPackChars').value,''),maxRetrievalItems:val($('#maxRetrievalItems')&&$('#maxRetrievalItems').value,''),maxRetrievalCharsPerItem:val($('#maxRetrievalCharsPerItem')&&$('#maxRetrievalCharsPerItem').value,''),maxRetrievalPackChars:val($('#maxRetrievalPackChars')&&$('#maxRetrievalPackChars').value,''),recentContextTurns:val($('#recentContextTurns')&&$('#recentContextTurns').value,'')}}
function render(){var s=state.settings||{};var st=state.stats||{};var smart=state.smartCapture||{};text($('#folioTotal'),val(st.total,'--'));text($('#mTotal'),val(st.total,'--'));text($('#mCore'),val(st.pinned,'--'));text($('#mActive'),val(st.active,'--'));text($('#mErrors'),st.errors?st.errors.length:'--');text($('#statsText'),state.statsText||'尚未刷新');text($('#settingsStatus'),state.settingsStatus||'设置尚未读取');text($('#smartCaptureStatus'),'待整理候选：'+val(smart.candidateCount,val(smart.pending,0))+(smart.processing?'（正在整理）':'')+'\\n整理模型：'+val(smart.modelLabel,'当前对话使用的聊天模型')+(smart.modelNote?'\\n'+smart.modelNote:'')+(smart.legacyPending?'\\n旧版待迁移摘要：'+smart.legacyPending:'')+(smart.lastError?'\\n最近错误：'+smart.lastError:''));inputValue('activeBucketsPath',state.activeBucketsPath||'');inputValue('activeSettingsPath',state.activeSettingsPath||'');inputValue('importPath',state.importPath||'');text($('#importResult'),state.importResult||'尚未扫描');inputValue('enabledCharacterNames',s.enabledCharacterNamesText||'');inputValue('enabledCharacterIds',s.enabledCharacterIdsText||'');var ids=['maxPinnedItems','maxPinnedCharsPerItem','maxPinnedPackChars','maxRetrievalItems','maxRetrievalCharsPerItem','maxRetrievalPackChars','recentContextTurns'];for(var i=0;i<ids.length;i++){inputValue(ids[i],val(s[ids[i]],''))}var status=$('#enabledStatus');if(status){var last=status.querySelector('span:last-child');text(last,s.enabled?'记忆册加载：已开启':'记忆册加载：已关闭');toggleClass(status.querySelector('.dot'),'on',!!s.enabled)}var toggles=$$('[data-toggle]');for(var j=0;j<toggles.length;j++){var el=toggles[j];var k=data(el,'toggle');var on=!!s[k];toggleClass(el,'on',on);if(hasClass(el,'switch')&&el.querySelector('i'))el.querySelector('i').style.transform=on?'translateX(24px)':''}text($('#enabledHint'),s.enabled?'已开启：每轮发送前会注入核心记忆和相关召回。':'已关闭：当前不会向模型注入任何本地记忆。');text($('#privacyHint'),s.requireCharacterMatch?'只有系在册中的名字，可以翻开这些记忆。':'这本记忆册会在所有角色对话中参与召回。');renderSearch();renderCandidates()}
function renderCandidates(){var area=$('#candidateArea');var items=state.candidates&&state.candidates.items||[];if(!area)return;if(!items.length){editingCandidateId='';area.className='empty';area.innerHTML='<div><b>没有待审核碎片</b><span>新的候选会显示在这里。</span></div>';return}area.className='result-list';var html=[];for(var i=0;i<items.length;i++){var item=items[i];var editing=editingCandidateId===String(item.id);var content=editing?'<div class="candidate-edit"><label>标题<input data-field="title" maxlength="80" value="'+esc(item.title||'')+'" /></label><label>核心摘要<input data-field="coreSummary" maxlength="160" value="'+esc(item.coreSummary||'')+'" /></label><label>详细记忆<textarea data-field="body" maxlength="2000">'+esc(item.body||'')+'</textarea></label><label>重要度 1-10<input data-field="importance" inputmode="numeric" value="'+esc(item.importance||6)+'" /></label></div>':'<h3>'+esc(item.title||item.id)+'</h3><p>'+esc(item.body||item.coreSummary||'')+'</p><div class="candidate-summary"><b>核心摘要</b> '+esc(item.coreSummary||'')+'</div>';var actions=editing?'<button class="btn primary" data-action="saveCandidate" data-id="'+esc(item.id)+'">保存修改</button><button class="btn" data-action="cancelCandidateEdit">取消</button>':'<button class="btn primary" data-action="approveCandidate" data-id="'+esc(item.id)+'">装订</button><button class="btn" data-action="editCandidate" data-id="'+esc(item.id)+'">编辑</button><button class="btn" data-action="rejectCandidate" data-id="'+esc(item.id)+'">舍弃</button>';html.push('<article class="memory-card" data-candidate-id="'+esc(item.id)+'">'+content+'<div class="tags"><span class="tag">'+esc(item.type||'dynamic')+'</span><span class="tag">重要度 '+esc(item.importance||'')+'</span></div><div class="candidate-actions">'+actions+'</div></article>')}area.innerHTML=html.join('')}
function renderSearch(){var area=$('#searchArea');var res=state.searchResult;if(!area)return;if(!res||!res.items||!res.items.length){expandedSearchId='';editingSearchId='';area.className='empty';area.innerHTML='<div><b>尚未显影</b><span>输入关键词后，记忆碎片会在这里逐渐清晰。</span></div>';return}area.className='result-list';var html=[];for(var i=0;i<res.items.length;i++){var item=res.items[i];var id=String(item.id||'');var domains=item.domain||[];var itemTags=item.tags||[];var tags='';for(var d=0;d<domains.slice(0,3).length;d++){tags+='<span class="tag">'+esc(domains[d])+'</span>'}var editing=editingSearchId===id;var expanded=expandedSearchId===id;var content;if(editing){content='<div class="candidate-edit"><label>标题<input data-field="title" maxlength="80" value="'+esc(item.title||'')+'" /></label><label>核心摘要<input data-field="coreSummary" maxlength="160" value="'+esc(item.coreSummary||item.summary||'')+'" /></label><label>详细记忆<textarea data-field="body" maxlength="2400">'+esc(item.body||'')+'</textarea></label><label>领域<input data-field="domain" value="'+esc(domains.join(', '))+'" /></label><label>标签<input data-field="tags" value="'+esc(itemTags.join(', '))+'" /></label><label>重要度 1-10<input data-field="importance" inputmode="numeric" value="'+esc(item.importance||5)+'" /></label></div>'}else{content='<h3>'+esc(item.title||item.id)+'</h3><p>'+esc(item.summary||'')+'</p>';if(expanded){content+='<div class="memory-detail"><b>完整记忆</b><p>'+esc(item.body||'无详细正文')+'</p></div><div class="candidate-summary"><b>核心摘要</b> '+esc(item.coreSummary||item.summary||'')+'</div><div class="memory-meta">ID：'+esc(id)+(item.updatedAt?' · 更新：'+esc(item.updatedAt):item.createdAt?' · 创建：'+esc(item.createdAt):'')+'</div>'}}var actions=editing?'<button class="btn primary" data-action="saveMemory" data-id="'+esc(id)+'">保存修改</button><button class="btn" data-action="cancelMemoryEdit">取消</button>':'<button class="btn" data-action="toggleMemoryDetail" data-id="'+esc(id)+'">'+(expanded?'收起':'查看详细')+'</button><button class="btn" data-action="editMemory" data-id="'+esc(id)+'">修改</button><button class="btn" data-action="setMemoryPinned" data-id="'+esc(id)+'" data-pinned="'+(item.pinned?'false':'true')+'">'+(item.pinned?'取消核心':'钉为核心')+'</button><button class="btn danger" data-action="deleteMemory" data-id="'+esc(id)+'">删除</button>';html.push('<article class="memory-card" data-memory-id="'+esc(id)+'"><span class="score">'+Math.round(item.score||0)+'</span>'+content+'<div class="tags"><span class="tag core">'+esc(item.pinned?'CORE':'MEMORY')+'</span><span class="tag">'+esc(item.type||'dynamic')+'</span>'+tags+'</div><div class="candidate-actions">'+actions+'</div></article>')}area.innerHTML=html.join('')}
function esc(x){return String(val(x,'')).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function activatePage(name){var tabs=$$('.tab');for(var i=0;i<tabs.length;i++){toggleClass(tabs[i],'active',data(tabs[i],'page')===name)}var pages=$$('.page');for(var j=0;j<pages.length;j++){toggleClass(pages[j],'active',pages[j].id==='page-'+name)}}
function candidateCard(el){while(el&&el!==document){if(hasClass(el,'memory-card'))return el;el=el.parentNode}return null}
function candidateEditPayload(el){var card=candidateCard(el);if(!card)return null;function field(name){var node=card.querySelector('[data-field="'+name+'"]');return node?node.value:''}return{id:data(el,'id'),title:field('title'),coreSummary:field('coreSummary'),body:field('body'),importance:field('importance')}}
function memoryEditPayload(el){var card=candidateCard(el);if(!card)return null;function field(name){var node=card.querySelector('[data-field="'+name+'"]');return node?node.value:''}return{id:data(el,'id'),title:field('title'),coreSummary:field('coreSummary'),body:field('body'),domain:field('domain'),tags:field('tags'),importance:field('importance')}}
function removeSearchItem(id){var res=state.searchResult;if(!res||!res.items)return;res.items=res.items.filter(function(item){return String(item.id)!==String(id)});res.returned=res.items.length;res.totalCandidates=Math.max(0,Number(res.totalCandidates||0)-1);if(expandedSearchId===id)expandedSearchId='';if(editingSearchId===id)editingSearchId='';renderSearch()}
function setSearchPinned(id,pinned){var items=state.searchResult&&state.searchResult.items||[];for(var i=0;i<items.length;i++){if(String(items[i].id)===String(id)){items[i].pinned=!!pinned;break}}renderSearch()}
function handleAction(act,el){if(act==='refresh')call('refreshStats').then(acceptState);else if(act==='rebuild')call('rebuildStats').then(acceptState);else if(act==='search')call('search',val($('#searchQuery')&&$('#searchQuery').value,'')).then(acceptState);else if(act==='save')call('saveSettings',JSON.stringify(form())).then(acceptState);else if(act==='reset')call('resetSettings').then(acceptState);else if(act==='previewImport')call('previewImport',val($('#importPath')&&$('#importPath').value,'')).then(acceptState);else if(act==='applyImport')call('applyImport',val($('#importPath')&&$('#importPath').value,'')).then(acceptState);else if(act==='refreshCandidates')call('refreshCandidates').then(acceptState);else if(act==='processSmartQueue')call('processSmartQueue',JSON.stringify(form())).then(acceptState);else if(act==='approveCandidate')call('approveCandidate',data(el,'id')).then(acceptState);else if(act==='rejectCandidate')call('rejectCandidate',data(el,'id')).then(acceptState);else if(act==='editCandidate'){editingCandidateId=data(el,'id');renderCandidates()}else if(act==='cancelCandidateEdit'){editingCandidateId='';renderCandidates()}else if(act==='saveCandidate'){var payload=candidateEditPayload(el);if(payload)call('updateCandidate',JSON.stringify(payload)).then(function(next){editingCandidateId='';acceptState(next)})}else if(act==='toggleMemoryDetail'){var detailId=data(el,'id');expandedSearchId=expandedSearchId===detailId?'':detailId;editingSearchId='';renderSearch()}else if(act==='editMemory'){editingSearchId=data(el,'id');expandedSearchId=editingSearchId;renderSearch()}else if(act==='cancelMemoryEdit'){editingSearchId='';renderSearch()}else if(act==='saveMemory'){var memoryPayload=memoryEditPayload(el);if(memoryPayload)call('updateMemory',JSON.stringify(memoryPayload)).then(function(next){editingSearchId='';acceptState(next)})}else if(act==='setMemoryPinned'){var pinId=data(el,'id');var pinned=data(el,'pinned')==='true';setSearchPinned(pinId,pinned);call('setMemoryPinned',JSON.stringify({id:pinId,pinned:pinned}))}else if(act==='deleteMemory'){var deleteId=data(el,'id');if(window.confirm&&!window.confirm('删除后会移入归档，不再参与搜索和记忆召回。继续吗？'))return;removeSearchItem(deleteId);call('deleteMemory',deleteId)}}
document.addEventListener('click',function(e){var target=e.target||e.srcElement;var tab=closest(target,'.tab');if(tab&&data(tab,'page')){activatePage(data(tab,'page'));return}var a=closest(target,'[data-action]');var tog=closest(target,'[data-toggle]');if(tog&&!a){var k=data(tog,'toggle');setBool(k,!bool(k));return}if(!a||busy)return;handleAction(data(a,'action'),a)},false);
window.MemoryArchive={setState:function(next){state=next||state;render()}};
function requestReady(){if(bridgeReady()){Promise.resolve(window.MemoryBridge.ready()).then(function(raw){acceptState(parseResult(raw))},function(e){toast(e&&e.message?e.message:String(e))});return}readyAttempts+=1;if(readyAttempts<40){setTimeout(requestReady,150)}else{toast('设置桥接未连接，请重新打开页面')}}
render();requestReady();
})();
</script>
</body></html>`;
}
