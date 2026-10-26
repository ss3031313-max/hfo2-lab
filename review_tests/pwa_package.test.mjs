import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root,name),'utf8');
const manifest = JSON.parse(read('manifest.webmanifest'));

test('manifest remains installable under a GitHub project subpath',()=>{
  const base = new URL('https://example.test/hfo2-lab/');
  assert.equal(manifest.display,'standalone');
  for(const k of ['id','scope','start_url']) assert.equal(new URL(manifest[k],base).pathname, '/hfo2-lab/');
  const variants = manifest.icons.map(icon=>[icon.sizes,icon.purpose].join(':'));
  for(const needed of ['192x192:any','512x512:any','512x512:maskable']) assert.ok(variants.includes(needed));
  for(const icon of manifest.icons){
    const url=new URL(icon.src,base); assert.equal(url.origin,base.origin); assert.ok(url.pathname.startsWith(base.pathname));
    const bytes=fs.readFileSync(path.join(root,icon.src));
    assert.equal(bytes.subarray(1,4).toString(),'PNG');
    assert.equal(bytes.readUInt32BE(16),Number(icon.sizes.split('x')[0]));
    assert.equal(bytes.readUInt32BE(20),Number(icon.sizes.split('x')[1]));
  }
});

test('both delivery entries build reproducibly without bundled OM material',()=>{
  execFileSync(process.execPath,['build_demo.mjs'],{cwd:root});
  assert.deepEqual(JSON.parse(read('data/catalog.json')),[]);
  const offline=read('om_demo.html'),web=read('index.html'),worker=read('sw.js');
  assert.ok(!offline.includes('id="pwa-module"'));
  assert.ok(!offline.includes('rel="manifest"'));
  assert.ok(web.includes('id="pwa-module"'));
  assert.ok(web.includes('href="./manifest.webmanifest"'));
  assert.ok(web.includes(read('src/pwa.js')));
  for(const s of [offline,web,worker]) assert.doesNotMatch(s,/__(?:PWA|CATALOG|INTAKE|SURFACE|AUTOSAVE|XLSX)[A-Z_]*__/);
  const digest=()=>createHash('sha256').update(read('om_demo.html')).update(read('index.html')).update(read('sw.js')).digest('hex');
  const before=digest();execFileSync(process.execPath,['build_demo.mjs'],{cwd:root});assert.equal(digest(),before);
  assert.equal(read('.nojekyll'),'');
});
