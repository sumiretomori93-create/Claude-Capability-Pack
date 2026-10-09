"use strict";
// Uses the existing Operit Java bridge under the app UID; never calls Tools.Files or a shell.
const ID = "com.claude_capability_pack.memory";
function bridge() {
    if (typeof Java === "undefined" || typeof Java.type !== "function" || typeof Java.getApplicationContext !== "function")
        throw new Error("无 Shizuku 存储需要 Operit 的 Java 桥接接口；不会回退到文件工具或 shell");
    return Java;
}
function file(path) { return bridge().type("java.io.File").newInstance(String(path)); }
function privateRoot() {
    const ctx = bridge().getApplicationContext();
    return String(ctx.getFilesDir().getCanonicalPath()) + "/plugins/" + ID;
}
function notFound(path) { const e = new Error("文件不存在：" + path); e.code = "ENOENT"; return e; }
function mkdir(path, parents = true) {
    const f = file(path);
    if (f.isDirectory()) return { success: true };
    if (f.exists()) throw new Error("路径不是目录：" + path);
    if (!(parents ? f.mkdirs() : f.mkdir()) && !f.isDirectory()) throw new Error("应用自身权限无法创建目录：" + path);
    return { success: true };
}
function read(path) {
    const f = file(path);
    if (!f.exists()) throw notFound(path);
    if (!f.isFile() || !f.canRead()) throw new Error("应用自身权限无法读取：" + path);
    const J = bridge();
    const input = J.type("java.io.FileInputStream").newInstance(f);
    let scanner;
    try {
        scanner = J.type("java.util.Scanner").newInstance(input, "UTF-8");
        scanner.useDelimiter("\\A");
        const text = scanner.hasNext() ? String(scanner.next()) : "";
        const error = scanner.ioException();
        if (error) throw new Error("读取失败：" + path);
        return text;
    } finally { if (scanner) scanner.close(); else input.close(); }
}
function write(path, content, append = false) {
    const target = file(path), parent = target.getParentFile();
    if (!parent) throw new Error("保存路径缺少父目录：" + path);
    mkdir(String(parent.getPath()), true);
    let text = String(content);
    if (append && target.exists()) text = read(path) + text;
    const J = bridge();
    // Write and sync a same-directory temporary file, then atomically rename it.
    const temp = J.type("java.io.File").callStatic("createTempFile", ".memory-", ".tmp", parent);
    let stream, writer;
    try {
        stream = J.type("java.io.FileOutputStream").newInstance(temp);
        writer = J.type("java.io.OutputStreamWriter").newInstance(stream, "UTF-8");
        writer.write(text); writer.flush(); stream.getFD().sync(); writer.close(); writer = null; stream = null;
        if (!temp.renameTo(target)) throw new Error("应用自身权限无法替换文件：" + path);
        return { success: true, path: String(path) };
    } finally {
        if (writer) writer.close(); else if (stream) stream.close();
        if (temp.exists()) temp.delete();
    }
}
function list(path) {
    const dir = file(path);
    if (!dir.exists()) return [];
    if (!dir.isDirectory() || !dir.canRead()) throw new Error("应用自身权限无法列出目录：" + path);
    const entries = dir.listFiles();
    if (entries == null) throw new Error("目录读取失败：" + path);
    return entries.map(f => ({ name: String(f.getName()), path: String(f.getPath()), isDirectory: !!f.isDirectory() }));
}
let initialized = false;
async function initializeOnce(legacyRoots) {
    const root = privateRoot();
    if (initialized) return root;
    mkdir(root, true);
    const marker = root + "/storage-migration.json";
    if (file(marker).exists()) { initialized = true; return root; }
    const sources = [], failures = [];
    let copied = 0;
    async function copyTree(source, destination) {
        for (const entry of list(source)) {
            // Caches may be stale and are regenerated rather than migrated.
            if (entry.name === "index" || entry.name === "storage-migration.json") continue;
            const dest = destination + "/" + entry.name;
            if (entry.isDirectory) await copyTree(entry.path, dest);
            else if (!file(dest).exists()) { write(dest, read(entry.path)); copied++; }
            // Yield between entries so a large migration does not monopolize QuickJS.
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
    for (const old of [...new Set(legacyRoots)]) {
        if (!old || old === root) continue;
        try {
            const source = old + "/memory";
            if (file(source).exists()) { await copyTree(source, root + "/memory"); sources.push(source); }
        } catch (e) { failures.push({ path: old, error: String(e.message || e) }); }
    }
    // Block use of a partially migrated store, preserving source files and completed copies.
    if (failures.length) throw new Error("旧记忆未完整迁移，未启用新库；原文件保留。请把旧 memory 目录复制到应用私有目录 " + root + " 后重试。详情：" + JSON.stringify(failures));
    write(marker, JSON.stringify({ backend: "app-java-io", copied, sources, completedAt: new Date().toISOString() }, null, 2));
    initialized = true;
    console.log("[ccp_memory] storage_ready backend=app-java-io root=" + root + " migrated_files=" + copied);
    return root;
}
exports.AppFiles = { read, write, mkdir, list };
exports.privateRoot = privateRoot;
let initialization = null;
function initialize(legacyRoots) {
    if (!initialization) initialization = initializeOnce(legacyRoots).catch(error => { initialization = null; throw error; });
    return initialization;
}
exports.initialize = initialize;
