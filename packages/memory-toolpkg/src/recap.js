"use strict";
// Only standalone section headings are recognized; quoted mentions are data.
function heading(line) {
    return line.trim().replace(/^#{1,6}\s*/, "").replace(/\*\*/g, "")
        .replace(/[：:]\s*$/, "").replace(/^【(.*)】$/, "$1").trim();
}
function extractRecap(value) {
    const lines = String(value || "").split(/\r?\n/);
    const chunks = []; let current = null; let found = false;
    for (const line of lines) {
        const h = heading(line);
        if (h === "对话回顾") {
            found = true;
            if (current) chunks.push(current.join("\n"));
            current = []; continue;
        }
        const boundary = /^(核心任务状态|信息搜集方面|最近一次任务的进度拆解|互动情节与设定|对话历程与概要|关键信息与上下文|当前状态|工具包预热)$/.test(h)
            || /^\s*【[^】]+】\s*[：:]?\s*$/.test(line);
        if (current && boundary) { chunks.push(current.join("\n")); current = null; }
        if (current) current.push(line);
    }
    if (current) chunks.push(current.join("\n"));
    const clean = chunks.map(x => x.replace(/(?:^|\n)\s*={5,}\s*(?=\n|$)/g, "\n").trim()).filter(Boolean);
    return { found, text: [...new Set(clean)].join("\n\n") };
}
function identities(body) {
    const speakers = new Set();
    for (const line of body.split(/\r?\n/)) {
        const m = line.match(/^\s*(?:[-*]\s*)?([^：:\n]{1,40})[：:]/);
        if (m && !/^(user|用户|Reiko)$/i.test(m[1].trim())) speakers.add(m[1].trim());
    }
    // Only a single explicit dialogue speaker establishes the memory narrator.
    return { humanName: "Reiko", humanLabels: ["user", "用户"],
        narrator: speakers.size === 1 ? [...speakers][0] : null };
}
exports.extractRecap = extractRecap;
exports.identities = identities;
