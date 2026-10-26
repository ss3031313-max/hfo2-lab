import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const runtime = fs.readFileSync(new URL('../src/pwa.js', import.meta.url), 'utf8');
const workerTemplate = fs.readFileSync(new URL('../src/service_worker.template.js', import.meta.url), 'utf8');
function logic() {
  const context = vm.createContext({URL,Promise,setTimeout,clearTimeout});
  vm.runInContext(runtime,context);
  return context.Hfo2PwaLogic;
}
const assets = ['./index.html','./manifest.webmanifest','./icons/icon-192.png'];
function workerHarness({scope='https://example.test/hfo2/',build='build-one',failAsset=null} = {}) {
  const handlers = {}, stores = new Map(), deleted = [], network = [], counters = {claimed:0,skipped:0};
  let offline = false;
  const response = url => ({ok:true,type:'basic',url,body:`cached ${build} ${url}`});
  const getCache = name => {
    if (!stores.has(name)) stores.set(name,new Map());
    const store = stores.get(name);
    return {
      async match(url) {return store.get(typeof url === 'string' ? url : url.url);},
      async addAll(requests) {
        const results = requests.map(request => {
          if (failAsset && request.url.endsWith(failAsset)) throw new Error('asset download failed');
          return [request.url,response(request.url)];
        });
        for (const [url,value] of results) store.set(url,value);
      }
    };
  };
  const caches = {open:async name=>getCache(name),keys:async()=>[...stores.keys()],delete:async name=>{deleted.push(name);return stores.delete(name);}};
  const self = {registration:{scope},clients:{claim:async()=>{counters.claimed++;}},skipWaiting:async()=>{counters.skipped++;},addEventListener:(name,handler)=>{handlers[name]=handler;}};
  const source = workerTemplate.replace('__PWA_BUILD_ID__',build).replace('__PWA_ASSETS_JSON__',JSON.stringify(assets));
  vm.runInNewContext(source,{self,caches,URL,Request,Set,Promise,fetch:async request=>{network.push(request.url);if(offline)throw new Error('offline');return {ok:true,type:'basic',body:'new network version'};}});
  async function dispatch(name,extra={}) {let pending=Promise.resolve();handlers[name]({...extra,waitUntil:value=>{pending=value;}});await pending;}
  function request(url,{method='GET',mode='cors'}={}) {let pending=null;handlers.fetch({request:{url,method,mode},respondWith:value=>{pending=value;}});return pending;}
  async function status() {let value;await dispatch('message',{data:{type:'HFO2_CACHE_STATUS'},ports:[{postMessage:v=>{value=v;}}]});return value;}
  const prefix='hfo2-pwa:'+encodeURIComponent(scope)+':', cacheName=prefix+build;
  return {dispatch,request,status,counters,stores,deleted,network,prefix,cacheName,setOffline:value=>{offline=value;}};
}

test('PWA registration permits HTTPS and explicit loopback only',()=>{
  const {secureLocation}=logic();
  assert.equal(secureLocation(new URL('https://example.test/hfo2/')),true);
  for (const address of ['http://localhost:4173/','http://127.0.0.1:4173/','http://[::1]:4173/']) assert.equal(secureLocation(new URL(address)),true);
  for (const address of ['file:///demo/index.html','http://example.test/','http://localhost.example.test/']) assert.equal(secureLocation(new URL(address)),false);
});
test('version update waits for startup and flush before approving reload',async()=>{
  const {prepareUpdate}=logic(),calls=[];
  let release;const ready=new Promise(resolve=>{release=resolve;});
  const result=prepareUpdate({ready,flush:async()=>{calls.push('flush');return true;},getStatus:()=>{calls.push('status');return {initialized:true,state:'saved',dirty:false,blocked:false};}});
  await Promise.resolve();assert.deepEqual(calls,[]);release();
  assert.equal(await result,true);assert.deepEqual(calls,['flush','status']);
});
test('unsafe storage state prevents update even if flush resolves true',async()=>{
  const {prepareUpdate}=logic();
  for (const state of [
    {initialized:false,state:'saved'}, {initialized:true,state:'error'},
    {initialized:true,state:'pending'}, {initialized:true,state:'saving'},
    {initialized:true,state:'restoring'}, {initialized:true,state:'saved',dirty:true},
    {initialized:true,state:'saved',blocked:true}
  ]) assert.equal(await prepareUpdate({flush:async()=>true,getStatus:()=>state}),false,JSON.stringify(state));
});
test('storage exceptions, failed writes and unavailable autosave prevent update',async()=>{
  const {prepareUpdate}=logic();
  assert.equal(await prepareUpdate(null),false);
  assert.equal(await prepareUpdate({flush:async()=>false,getStatus:()=>({initialized:true,state:'saved'})}),false);
  assert.equal(await prepareUpdate({flush:async()=>{throw new Error('quota');},getStatus:()=>({initialized:true,state:'saved'})}),false);
  assert.equal(await prepareUpdate({ready:Promise.reject(new Error('startup')),flush:async()=>true,getStatus:()=>({initialized:true,state:'saved'})}),false);
});
test('clean initial state and saved restore warnings may safely update',async()=>{
  const {prepareUpdate}=logic();
  for(const state of ['ready','saved','warning'])assert.equal(await prepareUpdate({flush:async()=>true,getStatus:()=>({initialized:true,state,dirty:false,blocked:false})}),true);
});
test('update lock starts only after startup has finished restoring its own lock',async()=>{
  const {beginUpdate}=logic(),calls=[];
  let release,initialized=false;const ready=new Promise(resolve=>{release=()=>{calls.push('startup unlock');initialized=true;resolve();};});
  const result=beginUpdate({ready,flush:async()=>{calls.push('flush');return true;},getStatus:()=>({initialized,state:initialized?'saved':'restoring'})},()=>{calls.push('PWA lock');});
  await Promise.resolve();assert.deepEqual(calls,[]);release();
  assert.equal(await result,true);assert.deepEqual(calls,['startup unlock','PWA lock','flush']);
});
test('failed startup or ongoing restore cannot leave a PWA-owned lock behind',async()=>{
  const {beginUpdate}=logic();let locks=0;
  const lock=()=>{locks++;};
  assert.equal(await beginUpdate({ready:Promise.reject(new Error('failed')),getStatus:()=>({initialized:false,state:'error'})},lock),false);
  assert.equal(await beginUpdate({getStatus:()=>({initialized:true,state:'restoring'})},lock),false);
  assert.equal(await beginUpdate({getStatus:()=>({initialized:true,state:'saved',blocked:true})},lock),false);
  assert.equal(locks,0);
});
test('cancelled update cannot reload after a slow second save finishes',async()=>{
  const {finishUpdate}=logic();let current=true,reloads=0,release;
  const flush=new Promise(resolve=>{release=resolve;});
  const result=finishUpdate({flush:()=>flush,getStatus:()=>({initialized:true,state:'saved'})},()=>current,()=>{reloads++;});
  await Promise.resolve();current=false;release(true);
  assert.equal(await result,'cancelled');assert.equal(reloads,0);
});
test('active update reloads once only when final storage check succeeds',async()=>{
  const {finishUpdate}=logic();let reloads=0;
  const auto={flush:async()=>true,getStatus:()=>({initialized:true,state:'saved'})};
  assert.equal(await finishUpdate(auto,()=>true,()=>{reloads++;}),'reloaded');assert.equal(reloads,1);
  auto.getStatus=()=>({initialized:true,state:'error'});
  assert.equal(await finishUpdate(auto,()=>true,()=>{reloads++;}),'unsaved');assert.equal(reloads,1);
});

function channelEnv() {
  const channels=[];let timerCallback;let cleared=false;
  class MessageChannel {
    constructor(){
      this.port1={closed:false,onmessage:null,close(){this.closed=true;}};
      this.port2={closed:false,close(){this.closed=true;},postMessage:value=>{this.port1.onmessage?.({data:value});}};
      channels.push(this);
    }
  }
  return {env:{MessageChannel,setTimeout:cb=>{timerCallback=cb;return 1;},clearTimeout:()=>{cleared=true;}},channels,timeout:()=>timerCallback(),wasCleared:()=>cleared};
}
test('offline readiness requires validated worker reply and closes message ports',async()=>{
  const {cacheStatus}=logic(),h=channelEnv();let sent;
  const result=await cacheStatus({postMessage:(data,ports)=>{sent=data.type;ports[0].postMessage({type:'HFO2_CACHE_STATUS',ready:true,buildId:'one'});}},h.env);
  assert.equal(sent,'HFO2_CACHE_STATUS');assert.equal(result.ready,true);assert.equal(result.buildId,'one');
  assert.equal(h.wasCleared(),true);assert.equal(h.channels[0].port1.closed,true);assert.equal(h.channels[0].port2.closed,true);
});
test('no answer or malformed status never claims offline readiness',async()=>{
  const {cacheStatus}=logic(),h=channelEnv();
  const result=cacheStatus({postMessage:(_,ports)=>{ports[0].postMessage({type:'other',ready:true,buildId:'one'});}},h.env);
  h.timeout();assert.equal((await result).ready,false);
  assert.equal((await cacheStatus(null,h.env)).ready,false);
  assert.equal((await cacheStatus({postMessage(){throw new Error('worker gone');}},h.env)).ready,false);
});

test('worker preloads all required assets without skipping a waiting version',async()=>{
  const h=workerHarness();await h.dispatch('install');
  const result=await h.status();assert.equal(result.ready,true);assert.equal(result.buildId,'build-one');
  assert.equal(h.stores.get(h.cacheName).size,assets.length);assert.equal(h.counters.skipped,0);
});
test('failed installation removes only incomplete new cache',async()=>{
  const h=workerHarness({failAsset:'icon-192.png'}),old=h.prefix+'older';h.stores.set(old,new Map([['preserve','old app']]));
  await assert.rejects(h.dispatch('install'),/asset download failed/);
  assert.equal(h.stores.has(h.cacheName),false);assert.equal(h.stores.has(old),true);
  assert.deepEqual(h.deleted,[h.cacheName]);
});
test('cache status detects a missing mandatory asset',async()=>{
  const h=workerHarness();await h.dispatch('install');
  h.stores.get(h.cacheName).delete('https://example.test/hfo2/icons/icon-192.png');
  assert.equal((await h.status()).ready,false);
});
test('offline navigation works for application root and index including query',async()=>{
  const h=workerHarness();await h.dispatch('install');h.setOffline(true);
  for(const address of ['https://example.test/hfo2/','https://example.test/hfo2/index.html','https://example.test/hfo2/?from=installed']){
    const result=await h.request(address,{mode:'navigate'});assert.match(result.body,/cached build-one/);
  }
  assert.deepEqual(h.network,[]);
});
test('cache-first assets preserve current build while network has a new version',async()=>{
  const h=workerHarness();await h.dispatch('install');
  const result=await h.request('https://example.test/hfo2/manifest.webmanifest');
  assert.match(result.body,/cached build-one/);assert.equal(h.network.length,0);
});
test('unrelated pages, data, uploads and cross-origin requests are not intercepted',async()=>{
  const h=workerHarness();await h.dispatch('install');
  const cases=[
    ['https://example.test/other/index.html',{mode:'navigate'}],
    ['https://example.test/hfo2/private.json',{}],
    ['https://example.test/hfo2/extra-page',{mode:'navigate'}],
    ['https://example.test/hfo2/index.html',{method:'POST'}],
    ['https://other.test/hfo2/index.html',{mode:'navigate'}],
    ['https://example.test/hfo2/icons/icon-192.png?private=1',{}]
  ];
  for(const [url,options] of cases)assert.equal(h.request(url,options),null,url);
});
test('cache miss can use network but never fills current build with arbitrary newer bytes',async()=>{
  const h=workerHarness();await h.dispatch('install');const address='https://example.test/hfo2/manifest.webmanifest';
  h.stores.get(h.cacheName).delete(address);
  assert.equal((await h.request(address)).body,'new network version');
  assert.equal(h.stores.get(h.cacheName).has(address),false);assert.equal((await h.status()).ready,false);
});
test('activation removes old versions only within the same application scope',async()=>{
  const h=workerHarness();await h.dispatch('install');
  const old=h.prefix+'old',other='hfo2-pwa:'+encodeURIComponent('https://example.test/another/')+':old';
  h.stores.set(old,new Map());h.stores.set(other,new Map());h.stores.set('unrelated-cache',new Map());
  await h.dispatch('activate');
  assert.equal(h.stores.has(old),false);assert.equal(h.stores.has(other),true);assert.equal(h.stores.has('unrelated-cache'),true);assert.equal(h.stores.has(h.cacheName),true);assert.equal(h.counters.claimed,1);
});
test('skip waiting occurs only in response to explicit update message',async()=>{
  const h=workerHarness();await h.dispatch('install');await h.dispatch('activate');
  await h.dispatch('message',{data:{type:'UNKNOWN'},ports:[]});assert.equal(h.counters.skipped,0);
  await h.dispatch('message',{data:{type:'HFO2_SKIP_WAITING'},ports:[]});assert.equal(h.counters.skipped,1);
});
