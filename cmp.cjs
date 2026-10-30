// Temporary diagnostic: compares computed styles between two builds.
const path = require('path');
const fs = require('fs');
const GLOBAL_MODULES = 'C:/Users/Youssef/AppData/Roaming/npm/node_modules';
const PW = path.join(
  GLOBAL_MODULES,
  '@executeautomation/playwright-mcp-server/node_modules/playwright',
);
if (!fs.existsSync(PW)) throw new Error('Playwright not found at ' + PW);
const { chromium } = require(PW);

const A = process.env.URL_A || 'http://127.0.0.1:5188/';
const B = process.env.URL_B || 'http://127.0.0.1:5189/';

const PROPS = [
  'fontSize', 'fontWeight', 'lineHeight', 'fontFamily', 'color', 'backgroundColor',
  'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'paddingTop', 'paddingBottom',
  'paddingLeft', 'paddingRight', 'borderTopWidth', 'borderBottomWidth', 'borderTopColor',
  'borderRadius', 'display', 'textTransform', 'letterSpacing', 'textDecorationLine',
  'whiteSpace', 'listStyleType', 'verticalAlign', 'boxShadow', 'textAlign', 'overflowWrap',
  'width', 'height', 'maxWidth', 'minHeight', 'opacity', 'outlineColor', 'outlineWidth',
];

const SELECTORS = [
  'body', '.app', '.sidebar', '.brand', '.sidebar ul', '.sidebar li', '.nav-btn',
  '.nav-btn.active', '.sidebar-note', '.main', '.page-head', '.page-head h1',
  '.page-head .muted', '.btn', '.btn.primary', '.btn.danger', '.icon-btn',
  '.stat-grid', '.stat', '.stat .muted', '.stat-value', '.two-col', '.panel',
  '.panel h3', '.list', '.list li', '.list-btn', '.list-btn strong', '.badge',
  '.badge-row', '.toolbar', '.toolbar select', '.search', '.search input',
  '.table-wrap', 'table', 'th', 'td', 'td.actions', '.muted', 'dl', 'dt', 'dd',
  'h1', 'h2', 'h3', 'p', 'a', 'strong', 'svg', '.empty', '.panel.empty',
  '.field', '.field label', '.field input', '.field select', '.field textarea',
  '.field-error', '.form-grid', '.full', '.form-actions', '.detail-badges',
  '.sr-only', 'input', 'select', 'textarea', 'button',
];

const collect = async (page) => {
  return page.evaluate(({ SELECTORS, PROPS }) => {
    const out = {};
    for (const sel of SELECTORS) {
      const el = document.querySelector(sel);
      if (!el) { out[sel] = null; continue; }
      const cs = getComputedStyle(el);
      const o = {};
      for (const p of PROPS) o[p] = cs[p];
      out[sel] = o;
    }
    return out;
  }, { SELECTORS, PROPS });
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const results = {};

  for (const [name, url] of [['A', A], ['B', B]]) {
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const dash = await collect(page);
    // opportunities page
    await page.getByRole('button', { name: 'Opportunities', exact: true }).click();
    await page.waitForTimeout(400);
    const opp = await collect(page);
    // open details dialog
    await page.getByRole('button', { name: /^View / }).first().click();
    await page.waitForTimeout(400);
    const dlg = await collect(page);
    results[name] = { dash, opp, dlg };
    await page.close();
  }
  await browser.close();

  let diffs = 0;
  for (const view of ['dash', 'opp', 'dlg']) {
    const a = results.A[view], b = results.B[view];
    for (const sel of Object.keys(a)) {
      if (!a[sel] || !b[sel]) {
        console.log(`[${view}] ${sel}: MISSING (A=${!!a[sel]} B=${!!b[sel]})`);
        diffs++;
        continue;
      }
      const changed = [];
      for (const p of PROPS) {
        if (a[sel][p] !== b[sel][p]) changed.push(`${p}: ${a[sel][p]} -> ${b[sel][p]}`);
      }
      if (changed.length) {
        diffs++;
        console.log(`[${view}] ${sel}`);
        for (const c of changed) console.log('    ' + c);
      }
    }
  }
  console.log('\nTOTAL DIFF GROUPS:', diffs);
})();
