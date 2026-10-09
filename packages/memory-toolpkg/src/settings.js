"use strict";
const { AppFiles } = require("./appFiles");
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MEMORY_SETTINGS = void 0;
exports.normalizeMemorySettings = normalizeMemorySettings;
exports.memorySettingsPath = memorySettingsPath;
exports.memoryConfigRoot = memoryConfigRoot;
exports.memorySettingsPathCandidates = memorySettingsPathCandidates;
exports.memoryConfigRootCandidates = memoryConfigRootCandidates;
exports.loadMemorySettings = loadMemorySettings;
exports.saveMemorySettings = saveMemorySettings;
exports.DEFAULT_MEMORY_SETTINGS = {
    enabled: true,
    summaryCaptureEnabled: false,
    smartSummaryCaptureEnabled: false,
    pinCapturedCore: false,
    requireCharacterMatch: false,
    enabledCharacterIds: [],
    enabledCharacterNames: [],
    maxPinnedItems: 3,
    maxPinnedCharsPerItem: 80,
    maxPinnedPackChars: 300,
    maxRetrievalItems: 3,
    maxRetrievalCharsPerItem: 120,
    maxRetrievalPackChars: 600,
    recentContextTurns: 6,
};
const TOOLPKG_ID = "com.claude_capability_pack.memory";
const PACKAGE_CONFIG_ID = "claude-capability-pack";
const SETTINGS_PATH = "memory/config.json";
function normalizeMemorySettings(input = {}) {
    return {
        enabled: typeof input.enabled === "boolean" ? input.enabled : exports.DEFAULT_MEMORY_SETTINGS.enabled,
        summaryCaptureEnabled: typeof input.summaryCaptureEnabled === "boolean"
            ? input.summaryCaptureEnabled
            : exports.DEFAULT_MEMORY_SETTINGS.summaryCaptureEnabled,
        smartSummaryCaptureEnabled: typeof input.smartSummaryCaptureEnabled === "boolean"
            ? input.smartSummaryCaptureEnabled
            : exports.DEFAULT_MEMORY_SETTINGS.smartSummaryCaptureEnabled,
        pinCapturedCore: typeof input.pinCapturedCore === "boolean" ? input.pinCapturedCore : exports.DEFAULT_MEMORY_SETTINGS.pinCapturedCore,
        requireCharacterMatch: typeof input.requireCharacterMatch === "boolean"
            ? input.requireCharacterMatch
            : exports.DEFAULT_MEMORY_SETTINGS.requireCharacterMatch,
        enabledCharacterIds: normalizeStringList(input.enabledCharacterIds),
        enabledCharacterNames: normalizeStringList(input.enabledCharacterNames),
        maxPinnedItems: boundedInteger(input.maxPinnedItems, 0, 10, exports.DEFAULT_MEMORY_SETTINGS.maxPinnedItems),
        maxPinnedCharsPerItem: boundedInteger(input.maxPinnedCharsPerItem, 20, 300, exports.DEFAULT_MEMORY_SETTINGS.maxPinnedCharsPerItem),
        maxPinnedPackChars: boundedInteger(input.maxPinnedPackChars, 0, 2000, exports.DEFAULT_MEMORY_SETTINGS.maxPinnedPackChars),
        maxRetrievalItems: boundedInteger(input.maxRetrievalItems, 0, 10, exports.DEFAULT_MEMORY_SETTINGS.maxRetrievalItems),
        maxRetrievalCharsPerItem: boundedInteger(input.maxRetrievalCharsPerItem, 20, 500, exports.DEFAULT_MEMORY_SETTINGS.maxRetrievalCharsPerItem),
        maxRetrievalPackChars: boundedInteger(input.maxRetrievalPackChars, 0, 4000, exports.DEFAULT_MEMORY_SETTINGS.maxRetrievalPackChars),
        recentContextTurns: boundedInteger(input.recentContextTurns, 0, 20, exports.DEFAULT_MEMORY_SETTINGS.recentContextTurns),
    };
}
function normalizeStringList(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const seen = new Set();
    const result = [];
    for (const item of value) {
        const text = String(item || "").trim();
        if (!text || seen.has(text)) {
            continue;
        }
        seen.add(text);
        result.push(text);
    }
    return result;
}
function memorySettingsPath() {
    return joinPath(memoryConfigRoot(), SETTINGS_PATH);
}
function memoryConfigRoot() {
    const candidates = memoryConfigRootCandidates();
    if (!candidates.length) {
        throw new Error(`No config directory API is available for ${PACKAGE_CONFIG_ID}`);
    }
    return candidates[0];
}
function memoryConfigRootCandidates() {
    return [require("./appFiles").privateRoot()];
}
function memorySettingsPathCandidates() {
    return memoryConfigRootCandidates().map((root) => joinPath(root, SETTINGS_PATH));
}
function legacyMemoryConfigRootCandidates() {
    const primary = [];
    const legacy = [];
    try {
        if (typeof ToolPkg !== "undefined" && typeof ToolPkg.getConfigDir === "function") {
            const currentRoot = normalizePath(ToolPkg.getConfigDir());
            primary.push(normalizePath(ToolPkg.getConfigDir(TOOLPKG_ID)));
            legacy.push(joinPath(currentRoot, PACKAGE_CONFIG_ID));
            legacy.push(currentRoot);
            legacy.push(normalizePath(ToolPkg.getConfigDir(PACKAGE_CONFIG_ID)));
        }
    }
    catch (_error) {
    }
    try {
        if (typeof NativeInterface !== "undefined" && typeof NativeInterface.getPluginConfigDir === "function") {
            const currentRoot = normalizePath(NativeInterface.getPluginConfigDir(TOOLPKG_ID));
            primary.push(currentRoot);
            legacy.push(joinPath(currentRoot, PACKAGE_CONFIG_ID));
            legacy.push(normalizePath(NativeInterface.getPluginConfigDir(PACKAGE_CONFIG_ID)));
        }
    }
    catch (_error) {
    }
    return uniquePaths([...primary, ...legacy].filter(Boolean));
}
async function ensureMemoryStorage() {
    return require("./appFiles").initialize(legacyMemoryConfigRootCandidates());
}
exports.ensureMemoryStorage = ensureMemoryStorage;
async function loadMemorySettings() {
    await ensureMemoryStorage();
    const paths = memorySettingsPathCandidates();
    for (let index = 0; index < paths.length; index += 1) {
        const path = paths[index];
        try {
            const result = await AppFiles.read(path);
            const text = readText(result);
            if (!text.trim()) {
                continue;
            }
            const settings = normalizeMemorySettings(JSON.parse(text));
            if (index > 0 && paths[0]) {
                try {
                    await writeSettingsFile(paths[0], settings);
                }
                catch (_error) {
                }
            }
            return await recoverEmptyRoleAllowlist(path, settings);
        }
        catch (error) {
            if (error && error.code === "ENOENT") continue;
            throw new Error("配置读取失败，不使用默认值覆盖：" + path + "；" + String(error.message || error));
        }
    }
    return { ...exports.DEFAULT_MEMORY_SETTINGS };
}
// Personal recovery for this user's confirmed empty-allowlist configuration.
// Does not broaden access to all characters or replace nonempty restrictions/budgets.
async function recoverEmptyRoleAllowlist(path, settings) {
    if (!settings.requireCharacterMatch || settings.enabledCharacterNames.length || settings.enabledCharacterIds.length)
        return settings;
    const marker = joinPath(memoryConfigRoot(), "memory/config-role-recovery-0157.json");
    try {
        const prior = JSON.parse(readText(await AppFiles.read(marker)));
        if (prior.completed === true) return settings;
        throw new Error("角色修复记录无效，未修改配置");
    } catch (error) {
        if (!error || error.code !== "ENOENT") throw error;
    }
    const recovered = { ...settings, enabledCharacterNames: ["Claude", "Assistant"] };
    // Preserve the exact original file for review, including unknown properties.
    const backup = path + ".before-role-recovery-0157.json";
    try { await AppFiles.read(backup); }
    catch (error) {
        if (!error || error.code !== "ENOENT") throw error;
        await AppFiles.write(backup, readText(await AppFiles.read(path)), false);
    }
    const originalObject = JSON.parse(readText(await AppFiles.read(path)));
    await AppFiles.write(path, JSON.stringify({ ...originalObject, enabledCharacterNames: recovered.enabledCharacterNames }, null, 2), false);
    const verified = await readSavedMemorySettings(path);
    if (JSON.stringify(verified) !== JSON.stringify(recovered)) throw new Error("角色名单恢复后读回不一致，停止注入");
    await AppFiles.write(marker, JSON.stringify({ completed: true, version: "0.1.57", names: recovered.enabledCharacterNames, restoredAt: new Date().toISOString() }, null, 2), false);
    console.log("[ccp_memory] config_recovered reason=empty_allowlist names=Claude,Assistant require_character_match=true settings_path=" + path);
    return verified;
}
async function saveMemorySettings(input) {
    await ensureMemoryStorage();
    const settings = normalizeMemorySettings(input);
    if (settings.requireCharacterMatch && !settings.enabledCharacterIds.length && !settings.enabledCharacterNames.length)
        throw new Error("角色限制已开启，但允许名单为空；请填写角色名称或 ID，或主动关闭角色限制。未保存。");
    const paths = memorySettingsPathCandidates();
    if (!paths.length) {
        throw new Error(`No settings path is available for ${PACKAGE_CONFIG_ID}`);
    }
    await writeSettingsFile(paths[0], settings);
    const verified = await readSavedMemorySettings(paths[0]);
    if (JSON.stringify(verified) !== JSON.stringify(settings)) {
        throw new Error(`settings write verification failed: ${paths[0]}`);
    }
    return verified;
}
async function writeSettingsFile(path, settings) {
    await AppFiles.mkdir(parentDir(path), true);
    await AppFiles.write(path, JSON.stringify(settings, null, 2), false);
}
async function readSavedMemorySettings(path) {
    const result = await AppFiles.read(path);
    const text = readText(result);
    if (!text.trim()) {
        throw new Error(`settings file is empty: ${path}`);
    }
    return normalizeMemorySettings(JSON.parse(text));
}
function boundedInteger(value, minimum, maximum, fallback) {
    if (value == null || value === "" || !Number.isFinite(Number(value))) {
        return fallback;
    }
    return Math.max(minimum, Math.min(maximum, Math.round(Number(value))));
}
function readText(value) {
    if (typeof value === "string") {
        return value;
    }
    if (!value || typeof value !== "object") {
        return "";
    }
    const result = value;
    for (const key of ["data", "content", "text", "result", "value"]) {
        const direct = result[key];
        if (typeof direct === "string") {
            return direct;
        }
        if (direct && typeof direct === "object") {
            const nested = readText(direct);
            if (nested) {
                return nested;
            }
        }
    }
    return "";
}
function parentDir(path) {
    const normalized = path.replace(/\\/g, "/");
    return normalized.slice(0, normalized.lastIndexOf("/")) || normalized;
}
function joinPath(base, child) {
    return normalizePath(`${base.replace(/[\\/]+$/, "")}/${child.replace(/^[\\/]+/, "")}`);
}
function normalizePath(path) {
    return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}
function uniquePaths(paths) {
    const seen = new Set();
    const result = [];
    for (const path of paths) {
        const normalized = normalizePath(path);
        if (!normalized || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        result.push(normalized);
    }
    return result;
}
