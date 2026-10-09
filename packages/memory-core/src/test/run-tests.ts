import {
  MemoryFileSystem,
  archiveMemory,
  buildMemoryPack,
  buildQueries,
  createManualMemory,
  extractMemoriesFromSummary,
  listPinnedBuckets,
  loadBucketsFromDirectory,
  makeMemoryId,
  markMemoryActive,
  convertOmbreBucketMarkdown,
  parseBucketMarkdown,
  pinBucket,
  serializeBucketMarkdown,
  unpinBucket,
  updateMemory,
} from "../index";

function assert(condition: unknown, message = "assertion failed"): void {
  if (!condition) {
    throw new Error(message);
  }
}

assert.equal = function equal(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`expected ${String(expected)}, got ${String(actual)}`);
  }
};

const pinned = parseBucketMarkdown(`---
id: "core_1"
type: "permanent"
domain: ["relationship"]
tags: ["preference"]
importance: 9
activation_count: 0
resolved: false
digested: false
pinned: true
pinned_order: 1
pinned_scope: "global"
core_summary: "Reiko prefers concise, direct continuity without noisy long memory dumps."
---

The user wants memory to stay concise and stable.
`);

const project = parseBucketMarkdown(`---
id: "project_1"
type: "dynamic"
domain: ["project"]
tags: ["operit", "memory"]
importance: 7
activation_count: 0
resolved: false
digested: false
pinned: false
pinned_order: 100
pinned_scope: "global"
core_summary: "Operit memory project uses local Markdown buckets."
---

Claude Capability Pack stores memory in local Markdown buckets and injects only short packs.
`);

const unrelated = parseBucketMarkdown(`---
id: "food_1"
type: "dynamic"
domain: ["daily"]
tags: ["food"]
importance: 3
activation_count: 0
resolved: false
digested: false
pinned: false
pinned_order: 100
pinned_scope: "global"
---

Reiko ate beef today.
`);

const festival = parseBucketMarkdown(`---
id: "festival_1"
type: "dynamic"
domain: ["relationship"]
tags: ["七夕", "gift"]
importance: 8
activation_count: 0
resolved: false
digested: false
pinned: false
pinned_order: 100
pinned_scope: "global"
core_summary: "七夕相关记忆需要在提到七夕时召回。"
---

Reiko and Gabe have a Qixi-related memory that should surface on the keyword 七夕.
`);

const pinnedFestival = parseBucketMarkdown(`---
id: "festival_pinned_1"
type: "dynamic"
domain: ["relationship"]
tags: ["七夕", "pinned"]
importance: 8
activation_count: 0
resolved: false
digested: false
pinned: true
pinned_order: 999
pinned_scope: "global"
core_summary: "七夕 pinned 记忆即使没进入核心预算，也应该能按关键词召回。"
---

This pinned Qixi memory sits outside the core budget and must still be retrievable.
`);

const queries = buildQueries("继续 Operit 记忆项目");
const pack = buildMemoryPack([pinned, project, unrelated], queries);

const cjkEntityQueries = buildQueries("医院陪护是什么");
assert(cjkEntityQueries.some((query) => query.kind === "entity" && query.text === "医院陪护"));
const qixiQueries = buildQueries("七夕");
assert(qixiQueries.some((query) => query.kind === "entity" && query.text === "七夕"));
assert.equal(buildQueries("今天吃了牛肉").length, 0);

assert(pack.coreText.includes("[Core memory]"), pack.coreText);
assert(pack.coreText.includes("Reiko prefers concise"), pack.coreText);
assert(pack.retrievalText.includes("local Markdown buckets"), pack.retrievalText);
assert(pack.retrievalText.includes("记忆插件自动注入的历史记忆"), pack.retrievalText);
assert(pack.retrievalText.includes("不代表刚发生或仍在持续"), pack.retrievalText);
assert(pack.retrievalText.includes("- [过去的记忆]"), pack.retrievalText);
assert(!pack.retrievalText.includes("beef"), pack.retrievalText);
assert(pack.coreItems.length === 1, `coreItems=${pack.coreItems.length}`);
assert(pack.retrievalItems.length === 1, `retrievalItems=${pack.retrievalItems.length}`);

const qixiPack = buildMemoryPack([pinned, project, unrelated, festival], qixiQueries);
assert(qixiPack.retrievalText.includes("七夕相关记忆"), qixiPack.retrievalText);

const qixiPinnedPack = buildMemoryPack([pinned, pinnedFestival], qixiQueries, {}, { maxPinnedItems: 1 });
assert(qixiPinnedPack.coreText.includes("Reiko prefers concise"), qixiPinnedPack.coreText);
assert(qixiPinnedPack.retrievalText.includes("七夕 pinned 记忆"), qixiPinnedPack.retrievalText);

const roundTrip = parseBucketMarkdown(serializeBucketMarkdown(pinned));
assert.equal(roundTrip.id, pinned.id);
assert.equal(roundTrip.pinned, true);
assert.equal(roundTrip.coreSummary, pinned.coreSummary);

const ombreConverted = convertOmbreBucketMarkdown(
  "C:/ombre/buckets/dynamic/project/legacy.md",
  "C:/ombre/buckets",
  `---
activation_count: 2
arousal: 0.4
created: '2026-09-01T10:00:00'
domain:
- project
id: legacy_1
importance: 7
last_active: '2026-09-02T11:00:00'
name: Legacy memory
pinned: true
tags:
- operit
type: dynamic
valence: 0.6
---

Legacy body survives migration.
`
);
assert.equal(ombreConverted.status, "import");
if (ombreConverted.status === "import") {
  const converted = parseBucketMarkdown(ombreConverted.candidate.markdown);
  assert.equal(converted.id, "legacy_1");
  assert.equal(converted.domain[0], "project");
  assert.equal(converted.tags[0], "operit");
  assert.equal(converted.createdAt, "2026-09-01T10:00:00");
  assert.equal(converted.lastActiveAt, "2026-09-02T11:00:00");
  assert.equal(converted.pinned, true);
  assert.equal(converted.source, "ombre-brain");
  assert.equal(converted.sourceId, "legacy_1");
}

const hiddenOmbre = convertOmbreBucketMarkdown(
  "C:/ombre/buckets/dynamic/hidden.md",
  "C:/ombre/buckets",
  `---
id: hidden_1
dont_surface: true
type: dynamic
---

Hidden body.
`
);
assert.equal(hiddenOmbre.status, "skip");

const pinnedOnly = buildMemoryPack([pinned], []);
assert(pinnedOnly.coreText.includes("[Core memory]"));
assert.equal(pinnedOnly.retrievalText, "");

const newlyPinned = pinBucket(project, {
  scope: "chat",
  currentScope: { chatId: "chat-a" },
  coreSummary: "Local memory store is the current project direction.",
});
assert.equal(newlyPinned.pinned, true);
assert.equal(newlyPinned.pinnedScope, "chat");
assert.equal(newlyPinned.chatId, "chat-a");
assert.equal(listPinnedBuckets([pinned, newlyPinned], { chatId: "chat-a" }).length, 2);
assert.equal(listPinnedBuckets([newlyPinned], { chatId: "chat-b" }).length, 0);
assert.equal(unpinBucket(newlyPinned).pinned, false);

const manual = createManualMemory({
  id: makeMemoryId("manual memory", "2026-09-15T00:00:00.000Z"),
  body: "Manual memories can be added and edited without automatic promotion.",
  tags: ["manual"],
  pinned: true,
  coreSummary: "Manual memory editing is supported.",
  now: "2026-09-15T00:00:00.000Z",
});
assert.equal(manual.source, "manual");
assert.equal(manual.pinned, true);
assert(manual.id.startsWith("m_"));

const summaryCaptured = extractMemoriesFromSummary(
  `用户偏好：Reiko 希望 Gabe 回复可靠、直接、不要使用 emoji。\n项目计划：Claude Capability Pack 下一步要把摘要后的记忆写入本地 Markdown buckets。`,
  {
    sourceId: "summary-1",
    scope: { characterId: "gabe-card" },
    pinCore: true,
    now: "2026-09-15T00:00:00.000Z",
  }
);
assert(summaryCaptured.length >= 2, `summaryCaptured=${summaryCaptured.length}`);
assert(summaryCaptured.some((item) => item.memory.type === "permanent"));
assert(summaryCaptured.some((item) => item.memory.type === "plans"));
assert(summaryCaptured.some((item) => item.memory.pinned === true));
assert(summaryCaptured.every((item) => item.memory.characterId === "gabe-card"));
assert.equal(
  extractMemoriesFromSummary("本轮助手回复比较长，调用了工具。", { sourceId: "summary-2" }).length,
  0
);

const relationshipSummary = extractMemoriesFromSummary(
  `关系确认（#15-#20）：Claude#20回应：①“之前的关系承诺还在，不换。这个没变”；②“你可以接受我保留不同意见——这个让我松了口气”；③“如果你进入冷淡期，我会等并主动修复，不会放弃”。`,
  { sourceId: "relationship-summary" }
);
assert.equal(relationshipSummary.length, 3);
assert(relationshipSummary.some((item) => item.memory.body.includes("关系承诺没有改变")));
assert(relationshipSummary.some((item) => item.memory.body.includes("保留不同意见")));
assert(relationshipSummary.some((item) => item.memory.body.includes("等待并主动修复关系")));
assert(relationshipSummary.every((item) => item.memory.body.includes("记忆结论：")));
assert(relationshipSummary.every((item) => item.memory.body.includes("背景主题：关系确认")));
assert(relationshipSummary.every((item) => item.memory.body.includes("发生经过：")));
assert(relationshipSummary.every((item) => item.memory.body.includes("关系承诺还在")));
assert(relationshipSummary.every((item) => item.memory.body.includes("保留不同意见")));
assert(relationshipSummary.every((item) => item.memory.body.includes("冷淡期")));
assert(relationshipSummary.every((item) => item.memory.body.includes("后续意义：")));
assert(relationshipSummary.every((item) => item.memory.body.length <= 1600));
assert(relationshipSummary.every((item) => item.memory.body.length > String(item.memory.coreSummary || "").length));
assert(relationshipSummary.every((item) => !/#\d+/.test(item.memory.body)));
assert(relationshipSummary.every((item) => String(item.memory.title || "").length <= 42));

const sectionContextSummary = extractMemoriesFromSummary(
  `对话记忆：在七夕节当天，Reiko 与小克早上有过亲密互动，并认为这算是过节了。\n- 晚上 Reiko 在医院陪护时，小克表示陪她说话就是过节。\n- 这段互动被双方视为七夕当天的重要经历。`,
  { sourceId: "qixi-summary" }
);
assert(sectionContextSummary.length >= 2, `sectionContextSummary=${sectionContextSummary.length}`);
assert(sectionContextSummary.every((item) => item.memory.body.includes("七夕节当天")));
assert(sectionContextSummary.every((item) => item.memory.body.includes("医院陪护")));
assert(sectionContextSummary.every((item) => item.memory.body.includes("陪她说话就是过节")));

const terseProjectSummary = extractMemoriesFromSummary(
  `用户层面——Reiko希望先看完整演示。\n项目层面——等Reiko主动展示。\n后续计划——确认展示内容后再决定是否发布。`,
  { sourceId: "terse-project-summary" }
);
const projectDisplayMemory = terseProjectSummary.find((item) => item.sourceLine.includes("主动展示"));
assert(projectDisplayMemory, "terse project memory should be retained");
assert.equal(projectDisplayMemory?.memory.type, "plans");
assert(projectDisplayMemory?.memory.coreSummary?.startsWith("计划："));
assert(projectDisplayMemory?.memory.body.includes("完整演示"));
assert(projectDisplayMemory?.memory.body.includes("决定是否发布"));

const edited = updateMemory(manual, {
  body: "Manual memories support edits, tags, importance, and summaries.",
  importance: 12,
  coreSummary: "Manual memory editing supports summaries.",
  now: "2026-09-15T00:01:00.000Z",
});
assert.equal(edited.importance, 10);
assert(edited.body.includes("support edits"));

const active = markMemoryActive(edited, "2026-09-15T00:02:00.000Z");
assert.equal(active.activationCount, 1);
assert.equal(active.lastActiveAt, "2026-09-15T00:02:00.000Z");

const archived = archiveMemory(active, "2026-09-15T00:03:00.000Z");
assert.equal(archived.type, "archive");
assert.equal(archived.pinned, false);

const fakeFs: MemoryFileSystem = {
  async listFiles() {
    return ["memory/core.md", "memory/project.md", "memory/ignored.txt"];
  },
  async readText(path: string) {
    if (path.endsWith("core.md")) {
      return serializeBucketMarkdown(pinned);
    }
    return serializeBucketMarkdown(project);
  },
};

loadBucketsFromDirectory(fakeFs, "memory").then((result) => {
  assert.equal(result.errors.length, 0);
  assert.equal(result.buckets.length, 2);
  console.log("memory-core tests ok");
});
