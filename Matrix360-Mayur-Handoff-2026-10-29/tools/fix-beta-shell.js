const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function replaceOnce(relativePath, before, after) {
  const target = path.join(root, relativePath);
  const source = fs.readFileSync(target, 'utf8');
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`Expected source not found in ${relativePath}`);
  fs.writeFileSync(target, source.replace(before, after));
}

for (const relativePath of [
  'workstreams/avinash/frontend-source/login.html',
  'workstreams/avinash/frontend/frontend-source/login.html',
]) {
  replaceOnce(relativePath, '<form id="signin" autocomplete="on">', '<form id="signin" method="post" autocomplete="on">');
  replaceOnce(relativePath, '<button id="tab-login" role="tab"', '<button id="tab-login" type="button" role="tab"');
  replaceOnce(relativePath, '<button id="tab-signup" role="tab"', '<button id="tab-signup" type="button" role="tab"');
}

replaceOnce(
  'workstreams/avinash/frontend/lib/m360-product-client.js',
  'if(!home&&!page)return;',
  'if(home||page)return;',
);

console.log('Applied beta-shell hardening fixes.');
