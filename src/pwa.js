/* Installation and offline app files. This module does not send or store experimental data. */
(function(root){
'use strict';

function secureLocation(location) {
  if (!location) return false;
  return location.protocol === 'https:' || (location.protocol === 'http:' && ['localhost','127.0.0.1','[::1]','::1'].includes(location.hostname));
}
function savedState(status) {
  return !!status && status.initialized === true && !status.dirty && !status.blocked && ['ready','saved','warning'].includes(status.state);
}
async function prepareUpdate(autosave) {
  try {
    if (!autosave || typeof autosave.flush !== 'function' || typeof autosave.getStatus !== 'function') return false;
    await autosave.ready;
    return await autosave.flush() === true && savedState(autosave.getStatus());
  } catch (_) { return false; }
}
function cacheStatus(worker, env = root) {
  return new Promise(resolve => {
    if (!worker || !env.MessageChannel) { resolve({ready:false}); return; }
    const channel = new env.MessageChannel();
    let finished = false;
    const done = result => {
      if (finished) return;
      finished = true; env.clearTimeout(timer);
      channel.port1.close(); channel.port2.close(); resolve(result);
    };
    const timer = env.setTimeout(() => done({ready:false}), 5000);
    channel.port1.onmessage = event => {
      const value = event.data;
      if (value?.type !== 'HFO2_CACHE_STATUS' || typeof value.ready !== 'boolean' || typeof value.buildId !== 'string' || !value.buildId) return;
      done({ready:value.ready,buildId:value.buildId});
    };
    try { worker.postMessage({type:'HFO2_CACHE_STATUS'}, [channel.port2]); }
    catch (_) { done({ready:false}); }
  });
}
async function beginUpdate(autosave, lock) {
  try {
    if (!autosave || typeof autosave.getStatus !== 'function') return false;
    await autosave.ready;
    const status = autosave.getStatus();
    if (!status?.initialized || status.blocked || ['loading','restoring'].includes(status.state)) return false;
    // Startup restores its own inert state. Only take ownership after it has finished.
    lock();
    return await prepareUpdate(autosave);
  } catch (_) { return false; }
}
async function finishUpdate(autosave, isCurrent, reload) {
  const saved = await prepareUpdate(autosave);
  if (!isCurrent()) return 'cancelled';
  if (!saved) return 'unsaved';
  reload();
  return 'reloaded';
}
root.Hfo2PwaLogic = {secureLocation,savedState,prepareUpdate,beginUpdate,finishUpdate,cacheStatus};
if (typeof document === 'undefined') return;

const style = document.createElement('style');
style.textContent = '.hfo-pwa-tools{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap}.hfo-pwa-status{font-size:10px;color:#60768a;white-space:nowrap}.hfo-pwa-status[data-ready=true]{color:#087f82}.hfo-pwa-tools button{font-size:11px;white-space:nowrap}.hfo-pwa-help{border:1px solid #e0e7ee;background:#f8fafc;border-radius:8px;padding:10px 13px;font-size:11px;color:#62758a;margin:0 0 14px}.hfo-pwa-help summary{font-size:11px;font-weight:600}.hfo-pwa-help p{margin:6px 0 0}.hfo-pwa-help [role=status]{color:#875e20}.hfo-pwa-tools [hidden]{display:none!important}@media print{.hfo-pwa-tools,.hfo-pwa-help{display:none!important}}';
document.head.append(style);
const box = document.createElement('div'); box.className = 'hfo-pwa-tools';
box.innerHTML = '<span id="hfoPwaStatus" class="hfo-pwa-status" role="status" aria-live="polite">오프라인 준비 중</span><button id="hfoPwaInstall" type="button">앱 설치</button><button id="hfoPwaUpdate" type="button" hidden>새 버전 적용</button>';
document.querySelector('.app-header-right')?.append(box);
const help = document.createElement('details'); help.className = 'hfo-pwa-help'; help.id = 'hfoPwaHelp';
help.innerHTML = '<summary>앱 설치 · 오프라인 실행</summary><p>설치용 웹 주소를 Chrome 또는 Edge에서 열고 ‘앱 설치’를 누르세요. 버튼에서 설치 창이 열리지 않으면 주소창의 설치 아이콘 또는 브라우저 메뉴의 앱 설치 항목을 확인하세요.</p><p>‘오프라인 실행 준비됨’은 프로그램 파일이 이 기기에 저장됐다는 뜻입니다. 처음 준비할 때는 인터넷이 필요하며, 준비 후 앱을 다시 열어 오프라인 동작을 확인하세요.</p><p>입력 자료는 별도의 자동저장 상태를 확인하세요. 다른 PC·브라우저·오프라인 파일로 이동할 때는 ‘전체 백업’과 ‘백업 불러오기’를 사용하세요.</p><p>새 버전은 ‘새 버전 적용’을 눌렀을 때 저장 상태를 확인한 뒤 열립니다. 다른 HfO₂ 창은 먼저 닫아 주세요.</p><p id="hfoPwaMessage" role="status" aria-live="polite"></p>';
const intake = document.getElementById('page-intake');
const saveHelp = intake?.querySelector('.hfo-save-help');
if (saveHelp) saveHelp.insertAdjacentElement('afterend', help); else intake?.append(help);
const $ = id => document.getElementById(id);
let installEvent = null, registration = null, cached = false, updating = false, reloadRequested = false, updateTimer = null, restoringLock = null, updateAttempt = 0;
const displayMode = root.matchMedia?.('(display-mode: standalone)');
function installed() { return !!displayMode?.matches || root.navigator?.standalone === true; }
function installState() { $('hfoPwaInstall').hidden = installed(); }
function notify(message, open = false) {
  $('hfoPwaMessage').textContent = message;
  if (open) {
    help.open = true;
    root.Hfo2Bridge?.navigate?.('intake');
    help.scrollIntoView?.({behavior:'smooth',block:'center'});
  }
}
function showCache() {
  const status = $('hfoPwaStatus'); status.dataset.ready = String(cached);
  status.textContent = cached ? (root.navigator.onLine === false ? '오프라인 실행' : '오프라인 실행 준비됨') : (root.navigator.onLine === false ? '오프라인 준비 확인 필요' : '오프라인 준비 중');
  status.title = '프로그램 파일 준비 상태 · 입력 자료는 자동저장 상태에서 확인';
}
async function checkCache() {
  if (!registration?.active) return;
  const active = registration.active;
  const result = await cacheStatus(active);
  if (registration.active !== active) return;
  cached = result.ready; showCache();
  if (!cached) {
    $('hfoPwaStatus').textContent = '오프라인 준비 확인 필요';
    notify('필수 프로그램 파일의 저장을 확인하지 못했습니다. 인터넷이 연결된 상태에서 앱을 다시 열고 준비 상태를 확인하세요.');
  }
}
function showUpdate() { $('hfoPwaUpdate').hidden = !registration?.waiting; }
function lockForUpdate() {
  const targets = [...document.querySelectorAll('.app-workspace,.app-nav')];
  const prior = targets.map(element => element.inert);
  const controls = ['hfoBackup','hfoRestore'].map($).filter(Boolean), disabled = controls.map(element => element.disabled);
  targets.forEach(element => { element.inert = true; }); controls.forEach(element => { element.disabled = true; });
  restoringLock = () => {targets.forEach((element,i) => {element.inert = prior[i];}); controls.forEach((element,i) => {element.disabled = disabled[i];}); restoringLock = null;};
}
function stopUpdate(message) {
  if (updateTimer !== null) root.clearTimeout(updateTimer);
  updateTimer = null; reloadRequested = false; updating = false; updateAttempt++;
  restoringLock?.(); $('hfoPwaUpdate').disabled = false; showUpdate(); notify(message,true);
}
async function reloadAfterSave() {
  if (!reloadRequested) return;
  reloadRequested = false;
  const attempt = updateAttempt;
  const outcome = await finishUpdate(root.Hfo2Autosave, () => updating && updateAttempt === attempt, () => {
    if (updateTimer !== null) root.clearTimeout(updateTimer);
    root.location.reload();
  });
  if (outcome === 'unsaved') {
    stopUpdate('현재 자료의 저장을 확인하지 못해 새로 열지 않았습니다. 전체 백업 후 저장 상태를 확인하세요.'); return;
  }
}
$('hfoPwaInstall').addEventListener('click', async () => {
  if (!installEvent) { notify(secureLocation(root.location) ? '설치 항목이 보이지 않으면 Chrome 또는 Edge의 일반 창에서 설치용 웹 주소를 열어 주세요.' : '압축 파일 안의 HTML은 바로 분석할 수 있습니다. 앱 설치는 게시된 HTTPS 웹 주소에서 진행하세요.',true); return; }
  const event = installEvent; installEvent = null; $('hfoPwaInstall').disabled = true;
  try {
    await event.prompt(); const choice = await event.userChoice;
    if (choice?.outcome === 'accepted') notify('설치 요청을 전달했습니다. 설치가 끝나면 바탕화면 또는 앱 목록에서 박막 분석을 여세요.');
  } catch (_) { notify('설치 창을 열지 못했습니다. 브라우저 메뉴의 앱 설치 항목을 확인하세요.',true); }
  finally { $('hfoPwaInstall').disabled = false; installState(); }
});
$('hfoPwaUpdate').addEventListener('click', async () => {
  if (updating || !registration?.waiting) return;
  updating = true; updateAttempt++; $('hfoPwaUpdate').disabled = true;
  if (!await beginUpdate(root.Hfo2Autosave, lockForUpdate)) { stopUpdate('현재 자료가 아직 저장되지 않아 업데이트를 보류했습니다. 자동저장 상태를 확인하고 전체 백업을 보관하세요.'); return; }
  const waiting = registration.waiting;
  if (!waiting) { stopUpdate('새 버전 상태가 변경됐습니다. 현재 창을 백업한 뒤 다시 열어 주세요.'); return; }
  reloadRequested = true;
  updateTimer = root.setTimeout(() => stopUpdate('업데이트 응답이 지연됩니다. 현재 화면을 유지했습니다. 전체 백업 후 앱을 닫았다가 다시 열어 주세요.'), 12000);
  try { waiting.postMessage({type:'HFO2_SKIP_WAITING'}); }
  catch (_) { stopUpdate('업데이트 요청을 전달하지 못했습니다. 현재 화면을 유지했습니다.'); }
});
root.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installEvent = event; installState(); });
root.addEventListener('appinstalled', () => { installEvent = null; $('hfoPwaInstall').hidden = true; notify('앱 설치 완료 · 앱 목록에서 박막 분석을 실행할 수 있습니다.'); });
displayMode?.addEventListener?.('change', installState);
installState();

if (!secureLocation(root.location) || root.isSecureContext === false || !root.navigator?.serviceWorker) {
  $('hfoPwaStatus').textContent = root.location?.protocol === 'file:' ? '파일 실행' : '웹 실행';
  $('hfoPwaInstall').textContent = '설치 안내';
  return;
}
root.addEventListener('online', () => { showCache(); void checkCache(); });
root.addEventListener('offline', showCache);
root.navigator.serviceWorker.addEventListener('controllerchange', () => {
  if (reloadRequested) void reloadAfterSave();
  else void checkCache();
});
root.navigator.serviceWorker.register('./sw.js', {scope:'./',updateViaCache:'none'}).then(async value => {
  registration = value; showUpdate();
  function observe(worker) {
    if (!worker) return;
    worker.addEventListener('statechange', () => {showUpdate(); if (worker.state === 'activated') void checkCache();});
  }
  observe(registration.installing);
  registration.addEventListener('updatefound', () => observe(registration.installing));
  await root.navigator.serviceWorker.ready;
  showUpdate(); await checkCache();
}).catch(() => {
  $('hfoPwaStatus').textContent = '온라인 실행';
  notify('오프라인 실행 준비에 실패했습니다. 분석은 계속 사용할 수 있습니다. 인터넷 연결과 브라우저 설정을 확인하세요.');
});
})(typeof window === 'undefined' ? globalThis : window);
