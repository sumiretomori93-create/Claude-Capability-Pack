const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert/strict');
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'memory-app-'));
const app = path.join(temp,'app'), old = path.join(temp,'old');
let toolCalls = 0;
global.Tools = { Files: new Proxy({}, {get(){return ()=>{toolCalls++;throw Error('Shizuku unavailable')}}}) };
class File {
 constructor(p){this.p=p instanceof File?p.p:String(p)}
 getPath(){return this.p} getCanonicalPath(){return path.resolve(this.p)} getName(){return path.basename(this.p)}
 getParentFile(){return new File(path.dirname(this.p))} exists(){return fs.existsSync(this.p)}
 isDirectory(){return this.exists()&&fs.statSync(this.p).isDirectory()} isFile(){return this.exists()&&fs.statSync(this.p).isFile()}
 canRead(){return this.exists()} mkdirs(){fs.mkdirSync(this.p,{recursive:true});return true} mkdir(){fs.mkdirSync(this.p);return true}
 listFiles(){return fs.readdirSync(this.p).map(n=>new File(path.join(this.p,n)))}
 renameTo(f){fs.renameSync(this.p,f.p);return true} delete(){fs.unlinkSync(this.p);return true}
}
class Input {constructor(f){this.p=f.p} close(){}}
class Scanner {constructor(input){this.text=fs.readFileSync(input.p,'utf8')} useDelimiter(){} hasNext(){return !!this.text} next(){return this.text} ioException(){return null} close(){}}
class Output {constructor(f){this.p=f.p;this.fd=fs.openSync(f.p,'w')} getFD(){return {sync:()=>fs.fsyncSync(this.fd)}} close(){if(this.fd!=null){fs.closeSync(this.fd);this.fd=null}}}
class Writer {constructor(s){this.stream=s}write(text){fs.writeFileSync(this.stream.fd,text,'utf8')}flush(){}close(){this.stream.close()}}
let counter=0;
const classes={'java.io.File':File,'java.io.FileInputStream':Input,'java.util.Scanner':Scanner,'java.io.FileOutputStream':Output,'java.io.OutputStreamWriter':Writer};
global.Java={type:n=>({newInstance:(...args)=>new classes[n](...args),callStatic:(method,prefix,suffix,dir)=>{assert.equal(n,'java.io.File');assert.equal(method,'createTempFile');const f=new File(path.join(dir.p,prefix+(counter++)+suffix));fs.writeFileSync(f.p,'');return f}}),getApplicationContext:()=>({getFilesDir:()=>new File(app)})};
global.ToolPkg={getConfigDir:()=>old};
(async()=>{
 try {
  const core=require('../dist/memory-core/index');
  fs.mkdirSync(path.join(old,'memory/buckets/permanent'),{recursive:true});
  fs.writeFileSync(path.join(old,'memory/config.json'),JSON.stringify({enabled:true,maxPinnedItems:8,summaryCaptureEnabled:false}));
  const bucket=core.createManualMemory({id:'fixture',body:'中文测试\n原文“标点”与emoji 🦋\n',coreSummary:'测试',pinned:true});
  fs.writeFileSync(path.join(old,'memory/buckets/permanent/fixture.md'),core.serializeBucketMarkdown(bucket));
  fs.mkdirSync(path.join(old,'memory/candidates'),{recursive:true});
  fs.writeFileSync(path.join(old,'memory/candidates/pending.json'),JSON.stringify({version:1,items:[]}));
  const settings=require('../dist/settings'), {AppFiles}=require('../dist/appFiles');
  const loaded=await settings.loadMemorySettings();assert.equal(loaded.maxPinnedItems,8);
  const root=settings.memoryConfigRoot();assert(root.startsWith(app));assert(fs.existsSync(path.join(old,'memory/buckets/permanent/fixture.md')));
  assert(fs.existsSync(path.join(root,'memory/candidates/pending.json')));
  const unicode='中文\r\n🦋\n最后一行\n';AppFiles.write(root+'/unicode.txt',unicode);assert.equal(AppFiles.read(root+'/unicode.txt'),unicode);AppFiles.write(root+'/unicode.txt','追加',true);assert.equal(AppFiles.read(root+'/unicode.txt'),unicode+'追加');
  const store=require('../dist/localStore').createLocalMemoryStore();assert.equal((await store.loadBuckets()).buckets.length,1);
  assert.equal((await settings.saveMemorySettings({...loaded,maxPinnedItems:7})).maxPinnedItems,7);
  await assert.rejects(()=>settings.saveMemorySettings({...loaded,requireCharacterMatch:true,enabledCharacterIds:[],enabledCharacterNames:[]}),/允许名单为空/);assert.equal((await settings.loadMemorySettings()).maxPinnedItems,7);
  const main=require('../dist/main');const mutation=await main.onPromptFinalize({eventPayload:{stage:'before_send_to_model',processedInput:'你好',preparedHistory:[{kind:'USER',content:'你好'}]}});
  assert(mutation&&mutation.processedInput.includes('[Core memory]'));
  const write=AppFiles.write;AppFiles.write=(p,...args)=>{if(p.endsWith('buckets-cache.json'))throw Error('cache denied');return write(p,...args)};
  assert.equal((await store.rebuildBucketCache()).buckets.length,1);AppFiles.write=write;
  const target={...loaded,requireCharacterMatch:true,enabledCharacterNames:[],enabledCharacterIds:[],maxPinnedCharsPerItem:130,maxPinnedPackChars:750,maxRetrievalCharsPerItem:180,maxRetrievalPackChars:500,customField:'preserve-me'};
  const configPath=path.join(root,'memory/config.json');const original=JSON.stringify(target);fs.writeFileSync(configPath,original);
  const recovered=await settings.loadMemorySettings();assert.deepEqual(recovered.enabledCharacterNames,['Claude','Assistant']);assert.equal(recovered.requireCharacterMatch,true);assert.equal(recovered.maxPinnedCharsPerItem,130);assert.equal(recovered.maxPinnedPackChars,750);assert.equal(recovered.maxRetrievalCharsPerItem,180);assert.equal(recovered.maxRetrievalPackChars,500);assert.equal(JSON.parse(fs.readFileSync(configPath)).customField,'preserve-me');assert.equal(fs.readFileSync(configPath+'.before-role-recovery-0157.json','utf8'),original);
  const restoredMutation=await main.onPromptFinalize({eventPayload:{stage:'before_send_to_model',processedInput:'你好',preparedHistory:[{kind:'USER',content:'你好'}],metadata:{activePrompt:{id:'default_character',name:'Claude'}}}});assert(restoredMutation&&restoredMutation.processedInput.includes('[Core memory]'));
  const blockedMutation=await main.onPromptFinalize({eventPayload:{stage:'before_send_to_model',processedInput:'你好',preparedHistory:[{kind:'USER',content:'你好'}],metadata:{activePrompt:{id:'other',name:'Other'}}}});assert.equal(blockedMutation,null);
  fs.writeFileSync(configPath,JSON.stringify({...target,enabledCharacterNames:['Gabe']}));assert.deepEqual((await settings.loadMemorySettings()).enabledCharacterNames,['Gabe']);
  fs.writeFileSync(configPath,original);assert.deepEqual((await settings.loadMemorySettings()).enabledCharacterNames,[]);
  console.log('PASS: empty role list restored once, restrictions and custom budgets preserved, exact backup kept, Claude injects, other role blocked, existing Gabe list unchanged.');
  fs.writeFileSync(path.join(root,'memory/config.json'),'{broken');await assert.rejects(()=>settings.loadMemorySettings(),/配置读取失败/);
  const candidates=require('../dist/candidateStore');fs.writeFileSync(path.join(root,'memory/candidates/pending.json'),'{broken');await assert.rejects(()=>candidates.listMemoryCandidates(),/保留原文件/);
  assert.equal(toolCalls,0);
  console.log('PASS: private storage, old config/buckets/queue copied, Unicode round trip, append, saved config verified, core injection, optional cache failure, invalid config/queue surfaced; zero Tools.Files calls.');
 } finally {fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
