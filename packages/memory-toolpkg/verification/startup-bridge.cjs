const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const defaults=require('../dist/settings').DEFAULT_MEMORY_SETTINGS;
let interfaceMethods, settingsReads=0, resolveSettings, rejectSettings;
const callbacks=[], emitted=[], logs=[];
let gate=new Promise((resolve,reject)=>{resolveSettings=resolve;rejectSettings=reject});
const dependencies={
 '../../settings':{DEFAULT_MEMORY_SETTINGS:defaults,loadMemorySettings:()=>{settingsReads++;return gate},memorySettingsPath:()=>'/private/memory/config.json'},
 '../../localStore':{createLocalMemoryStore:()=>({bucketRoots:['/private/memory/buckets']})},
 '../../browser':{getMemoryLibraryStats:async()=>({total:270,pinned:4,active:270,errors:[]}),formatMemoryLibraryStats:()=> '270'},
 '../../candidateStore':{listMemoryCandidates:async()=>({count:0,items:[]})},
 '../../smartCapture':{getSmartCaptureStatus:()=>{throw Error('startup must not request model settings')}}, '../../importer':{}
};
const exp={};vm.runInNewContext(fs.readFileSync(require.resolve('../dist/ui/memory_settings/index.ui.js'),'utf8'),{exports:exp,require:n=>dependencies[n],console:{log:s=>logs.push(s)},setTimeout:fn=>callbacks.push(fn)});
const controller={addJavascriptInterface:(n,methods)=>interfaceMethods=methods,loadHtml:()=>{},evaluateJavascript:async s=>emitted.push(s)};
const ctx={useMemo:(k,fn)=>fn(),createWebViewController:()=>controller,useRef:()=>({current:false}),showToast:async()=>{},UI:{WebView:props=>props}};
const flush=()=>new Promise(r=>setImmediate(r));
(async()=>{
 const screen=exp.default(ctx);await screen.onLoad();
 const ack=JSON.parse(interfaceMethods.ready());assert.equal(ack.accepted,true);assert.equal(settingsReads,0);assert.equal(callbacks.length,1);
 callbacks.shift()();await flush();assert.equal(settingsReads,1);
 assert.equal(JSON.parse(interfaceMethods.refreshStats()).busy,true);
 resolveSettings(defaults);await flush();await flush();
 assert(emitted.some(s=>s.includes('270')));assert(logs.includes('[ccp_memory_ui] startup stage=complete'));
 gate=new Promise((resolve,reject)=>{rejectSettings=reject});
 assert.equal(JSON.parse(interfaceMethods.ready()).accepted,true);callbacks.shift()();await flush();rejectSettings(Error('Java bridge storage failure'));await flush();await flush();
 assert(emitted.some(s=>s.includes('Java bridge storage failure')));
 assert.equal(JSON.parse(interfaceMethods.refreshStats()).accepted,true);
 console.log('PASS: ready returns before any disk read; delayed startup succeeds; concurrent operations get busy acknowledgement; errors display and unlock bridge; startup never queries model config.');
})().catch(e=>{console.error(e);process.exitCode=1});
