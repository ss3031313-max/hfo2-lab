// Rebuild the offline demo from readable source and the original images.
// Usage: node build_demo.mjs  (Node.js, no additional packages)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.dirname(fileURLToPath(import.meta.url));
const template = fs.readFileSync(path.join(root, 'src/om_app.template.html'), 'utf8');
const placeholder = '__CATALOG_JSON__';
if (template.split(placeholder).length !== 2) throw new Error('Expected one catalog placeholder.');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data/catalog.json'), 'utf8'));
const imageRoot = path.resolve(root, 'original_images') + path.sep;
const embedded = catalog.map(record => {
  const imagePath = path.resolve(root, record.local_image_path);
  if (!imagePath.startsWith(imageRoot)) throw new Error('Image must be inside original_images.');
  return { ...record, image_data_url: 'data:image/jpeg;base64,' + fs.readFileSync(imagePath).toString('base64') };
});
const serialized = JSON.stringify(embedded).replace(/</g, '\\u003c');
let output = template.replace(placeholder, () => serialized);
for (const [token, filename] of [['__INTAKE_JS__','intake.js'],['__SURFACE_JS__','surface_review.js'],['__PAKO_JS__','vendor/pako_inflate.min.js'],['__SAX_JS__','vendor/sax.js'],['__XLSX_IMPORT_JS__','xlsx_import.js'],['__QUICK_IMPORT_JS__','quick_import.js'],['__AUTOSAVE_JS__','autosave.js'],['__IMAGE_MANAGEMENT_JS__','image_management.js'],['__CONDITION_TRENDS_JS__','condition_trends.js']]) {
  if (output.split(token).length !== 2) throw new Error(`Expected one ${token} placeholder.`);
  const moduleSource = fs.readFileSync(path.join(root, 'src', filename), 'utf8');
  if (/<\/script/i.test(moduleSource)) throw new Error(`${filename} contains an unsafe script-closing sequence.`);
  output = output.replace(token, () => moduleSource);
}
const workbookToken = '__SAMPLE_XLSX_BASE64__';
if (output.split(workbookToken).length !== 2) throw new Error('Expected one workbook placeholder.');
output = output.replace(workbookToken, () => fs.readFileSync(path.join(root,'sample_data/HfO2_sample_inputs.xlsx')).toString('base64'));
fs.writeFileSync(path.join(root, 'om_demo.html'), output, 'utf8');
// Keep the double-click offline file independent of the PWA installation files.
const pwaSource = fs.readFileSync(path.join(root, 'src/pwa.js'), 'utf8');
if (/<\/script/i.test(pwaSource)) throw new Error('pwa.js contains an unsafe script-closing sequence.');
const pwaHead = '<link rel="manifest" href="./manifest.webmanifest">\n<link rel="icon" href="./icons/icon.svg" type="image/svg+xml">\n<link rel="apple-touch-icon" href="./icons/icon-192.png">\n<meta name="theme-color" content="#142737">\n';
const webOutput = output.replace('</head>', () => pwaHead + '</head>').replace('</body>', () => '<script id="pwa-module">' + pwaSource + '</script>\n</body>');
fs.writeFileSync(path.join(root, 'index.html'), webOutput, 'utf8');
const assets = ['./index.html','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./icons/maskable-512.png','./icons/icon.svg'];
const workerTemplate = fs.readFileSync(path.join(root, 'src/service_worker.template.js'), 'utf8');
const hash = createHash('sha256').update(workerTemplate);
for (const asset of assets) hash.update(asset).update(fs.readFileSync(path.join(root, asset)));
const buildId = '0.5.1-' + hash.digest('hex').slice(0, 16);
for (const token of ['__PWA_BUILD_ID__','__PWA_ASSETS_JSON__']) {
  if (workerTemplate.split(token).length !== 2) throw new Error(`Expected one ${token} placeholder.`);
}
const worker = workerTemplate.replace('__PWA_BUILD_ID__', buildId).replace('__PWA_ASSETS_JSON__', JSON.stringify(assets));
fs.writeFileSync(path.join(root, 'sw.js'), worker, 'utf8');
fs.writeFileSync(path.join(root, '.nojekyll'), '');
console.log(`Built om_demo.html and index.html (${buildId}) with ${embedded.length} original images.`);
