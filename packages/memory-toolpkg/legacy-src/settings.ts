export interface MemoryRuntimeSettings {
  enabled: boolean;
  summaryCaptureEnabled: boolean;
  smartSummaryCaptureEnabled: boolean;
  pinCapturedCore: boolean;
  requireCharacterMatch: boolean;
  enabledCharacterIds: string[];
  enabledCharacterNames: string[];
  maxPinnedItems: number;
  maxPinnedCharsPerItem: number;
  maxPinnedPackChars: number;
  maxRetrievalItems: number;
  maxRetrievalCharsPerItem: number;
  maxRetrievalPackChars: number;
  recentContextTurns: number;
}

export const DEFAULT_MEMORY_SETTINGS: MemoryRuntimeSettings = {
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

export function normalizeMemorySettings(input: Partial<MemoryRuntimeSettings> = {}): MemoryRuntimeSettings {
  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : DEFAULT_MEMORY_SETTINGS.enabled,
    summaryCaptureEnabled:
      typeof input.summaryCaptureEnabled === "boolean"
        ? input.summaryCaptureEnabled
        : DEFAULT_MEMORY_SETTINGS.summaryCaptureEnabled,
    smartSummaryCaptureEnabled:
      typeof input.smartSummaryCaptureEnabled === "boolean"
        ? input.smartSummaryCaptureEnabled
        : DEFAULT_MEMORY_SETTINGS.smartSummaryCaptureEnabled,
    pinCapturedCore:
      typeof input.pinCapturedCore === "boolean" ? input.pinCapturedCore : DEFAULT_MEMORY_SETTINGS.pinCapturedCore,
    requireCharacterMatch:
      typeof input.requireCharacterMatch === "boolean"
        ? input.requireCharacterMatch
        : DEFAULT_MEMORY_SETTINGS.requireCharacterMatch,
    enabledCharacterIds: normalizeStringList(input.enabledCharacterIds),
    enabledCharacterNames: normalizeStringList(input.enabledCharacterNames),
    maxPinnedItems: boundedInteger(input.maxPinnedItems, 0, 10, DEFAULT_MEMORY_SETTINGS.maxPinnedItems),
    maxPinnedCharsPerItem: boundedInteger(
      input.maxPinnedCharsPerItem,
      20,
      300,
      DEFAULT_MEMORY_SETTINGS.maxPinnedCharsPerItem
    ),
    maxPinnedPackChars: boundedInteger(input.maxPinnedPackChars, 0, 2000, DEFAULT_MEMORY_SETTINGS.maxPinnedPackChars),
    maxRetrievalItems: boundedInteger(input.maxRetrievalItems, 0, 10, DEFAULT_MEMORY_SETTINGS.maxRetrievalItems),
    maxRetrievalCharsPerItem: boundedInteger(
      input.maxRetrievalCharsPerItem,
      20,
      500,
      DEFAULT_MEMORY_SETTINGS.maxRetrievalCharsPerItem
    ),
    maxRetrievalPackChars: boundedInteger(
      input.maxRetrievalPackChars,
      0,
      4000,
      DEFAULT_MEMORY_SETTINGS.maxRetrievalPackChars
    ),
    recentContextTurns: boundedInteger(input.recentContextTurns, 0, 20, DEFAULT_MEMORY_SETTINGS.recentContextTurns),
  };
}

function normalizeStringList(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
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

export function memorySettingsPath(): string {
  return joinPath(memoryConfigRoot(), SETTINGS_PATH);
}

export function memoryConfigRoot(): string {
  const candidates = memoryConfigRootCandidates();
  if (!candidates.length) {
    throw new Error(`No config directory API is available for ${PACKAGE_CONFIG_ID}`);
  }
  return candidates[0];
}

export function memorySettingsPathCandidates(): string[] {
  return memoryConfigRootCandidates().map((root) => joinPath(root, SETTINGS_PATH));
}

export function memoryConfigRootCandidates(): string[] {
  const primary: string[] = [];
  const legacy: string[] = [];

  try {
    if (typeof ToolPkg !== "undefined" && typeof ToolPkg.getConfigDir === "function") {
      const currentRoot = normalizePath(ToolPkg.getConfigDir());
      primary.push(normalizePath(ToolPkg.getConfigDir(TOOLPKG_ID)));
      legacy.push(joinPath(currentRoot, PACKAGE_CONFIG_ID));
      legacy.push(currentRoot);
      legacy.push(normalizePath(ToolPkg.getConfigDir(PACKAGE_CONFIG_ID)));
    }
  } catch (_error) {
  }

  try {
    if (typeof NativeInterface !== "undefined" && typeof NativeInterface.getPluginConfigDir === "function") {
      const currentRoot = normalizePath(NativeInterface.getPluginConfigDir(TOOLPKG_ID));
      primary.push(currentRoot);
      legacy.push(joinPath(currentRoot, PACKAGE_CONFIG_ID));
      legacy.push(normalizePath(NativeInterface.getPluginConfigDir(PACKAGE_CONFIG_ID)));
    }
  } catch (_error) {
  }

  return uniquePaths([...primary, ...legacy].filter(Boolean));
}

export async function loadMemorySettings(): Promise<MemoryRuntimeSettings> {
  const paths = memorySettingsPathCandidates();
  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index];
    try {
      const result = await Tools.Files.read(path);
      const text = readText(result);
      if (!text.trim()) {
        continue;
      }
      const settings = normalizeMemorySettings(JSON.parse(text) as Partial<MemoryRuntimeSettings>);
      if (index > 0 && paths[0]) {
        try {
          await writeSettingsFile(paths[0], settings);
        } catch (_error) {
        }
      }
      return settings;
    } catch (_error) {
    }
  }
  return { ...DEFAULT_MEMORY_SETTINGS };
}

export async function saveMemorySettings(input: Partial<MemoryRuntimeSettings>): Promise<MemoryRuntimeSettings> {
  const settings = normalizeMemorySettings(input);
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

async function writeSettingsFile(path: string, settings: MemoryRuntimeSettings): Promise<void> {
  await Tools.Files.mkdir(parentDir(path), true);
  await Tools.Files.write(path, JSON.stringify(settings, null, 2), false);
}

async function readSavedMemorySettings(path: string): Promise<MemoryRuntimeSettings> {
  const result = await Tools.Files.read(path);
  const text = readText(result);
  if (!text.trim()) {
    throw new Error(`settings file is empty: ${path}`);
  }
  return normalizeMemorySettings(JSON.parse(text) as Partial<MemoryRuntimeSettings>);
}

function boundedInteger(value: number | undefined, minimum: number, maximum: number, fallback: number): number {
  if (value == null || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function readText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  const result = value as Record<string, unknown>;
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

function parentDir(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.slice(0, normalized.lastIndexOf("/")) || normalized;
}

function joinPath(base: string, child: string): string {
  return normalizePath(`${base.replace(/[\\/]+$/, "")}/${child.replace(/^[\\/]+/, "")}`);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
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
