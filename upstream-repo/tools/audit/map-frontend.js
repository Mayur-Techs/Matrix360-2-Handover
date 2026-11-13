'use strict';

const fs = require('node:fs');
const path = require('node:path');

const dir = path.resolve(__dirname, '../../workstreams/avinash/frontend/frontend-source');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));

const pages = {};
const inboundMap = {};

files.forEach(f => {
  inboundMap[f] = new Set();
});

for (const file of files) {
  const content = fs.readFileSync(path.join(dir, file), 'utf8');
  
  // Extract all hrefs
  const hrefs = [];
  const hrefRegex = /href=["']([^"']+)["']/g;
  let match;
  while ((match = hrefRegex.exec(content)) !== null) {
    const target = match[1].split('#')[0].split('?')[0].replace(/^\//, '');
    if (target && target.endsWith('.html') && files.includes(target)) {
      hrefs.push(target);
      inboundMap[target].add(file);
    }
  }

  // Extract primary buttons
  const buttons = [];
  const btnRegex = /<button([^>]*)>([\s\S]*?)<\/button>/gi;
  while ((match = btnRegex.exec(content)) !== null) {
    const attrs = match[1];
    const text = match[2].replace(/<[^>]+>/g, '').trim();
    const idMatch = attrs.match(/id=["']([^"']+)["']/);
    const id = idMatch ? idMatch[1] : '';
    const onclickMatch = attrs.match(/onclick=["']([^"']+)["']/);
    const onclick = onclickMatch ? onclickMatch[1] : '';
    const typeMatch = attrs.match(/type=["']([^"']+)["']/);
    const type = typeMatch ? typeMatch[1] : 'button';

    buttons.push({ id, text, type, onclick });
  }

  pages[file] = {
    outboundHtmlLinks: [...new Set(hrefs)],
    buttons
  };
}

// Convert sets to arrays
const orphans = [];
for (const [file, inbounds] of Object.entries(inboundMap)) {
  const inboundList = [...inbounds];
  pages[file].inboundHtmlLinks = inboundList;
  if (inboundList.length === 0 && file !== 'index.html' && file !== 'login.html') {
    orphans.push(file);
  }
}

console.log('=== FRONT-END REALITY MAP ===');
console.log(`Total HTML Pages: ${files.length}\n`);

for (const [file, data] of Object.entries(pages)) {
  console.log(`PAGE: ${file}`);
  console.log(`  Inbound Links  : ${data.inboundHtmlLinks.length ? data.inboundHtmlLinks.join(', ') : '(NONE)'}`);
  console.log(`  Outbound Links : ${data.outboundHtmlLinks.length ? data.outboundHtmlLinks.join(', ') : '(NONE)'}`);
  console.log(`  Primary Buttons: ${data.buttons.length}`);
  data.buttons.slice(0, 10).forEach(b => {
    console.log(`    - [${b.id || 'no-id'}] "${b.text}" (type=${b.type}, onclick=${b.onclick || 'handler in script'})`);
  });
  console.log('');
}

console.log('=== CONFIRMED ORPHANED PAGES ===');
orphans.forEach(o => console.log(`  ⚠️ ORPHAN: ${o} (no inbound links from dashboard/nav)`));
