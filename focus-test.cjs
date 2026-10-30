// Playwright is a project-local dev dependency (see package.json). Its browser
// binaries are installed separately with `npx playwright install`.
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { chromium, firefox, webkit } = require('playwright');

const HOST = '127.0.0.1';
const PORT = 5199;
const DEFAULT_URL = 'http://' + HOST + ':' + PORT + '/';
const URL = process.env.APP_URL || DEFAULT_URL;
const SERVER_START_TIMEOUT_MS = 30000;
const results = [];
let devServer = null;

function log(browser, name, pass, detail) {
  results.push({ browser, name, pass, detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' [' + browser + '] ' + name + (detail ? ' :: ' + detail : ''));
}

async function activeInfo(page) {
  return page.evaluate(() => {
    const a = document.activeElement;
    if (!a) return { tag: 'none', label: '', id: '' };
    return {
      tag: a.tagName.toLowerCase(),
      label: (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 40),
      id: a.id || '',
    };
  });
}

async function run(browserType, label) {
  let browser;
  try {
    browser = await browserType.launch();
  } catch (e) {
    log(label, 'launch', false, String(e).split('\n')[0]);
    return;
  }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  try {
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });

    // Navigate via the sidebar
    await page.getByRole('button', { name: 'Opportunities', exact: true }).click();
    await page.waitForTimeout(300);

    // ---- 1: details dialog restores focus to the View button ----
    const viewBtn = page.getByRole('button', { name: /^View / }).first();
    const viewLabel = await viewBtn.getAttribute('aria-label');
    await viewBtn.click();
    await page.waitForTimeout(200);
    const openCount = await page.locator('dialog[open]').count();
    log(label, 'details dialog opens', openCount === 1, 'open dialogs=' + openCount);

    await page.locator('dialog[open]').getByRole('button', { name: 'Close', exact: true }).click();
    await page.waitForTimeout(350);
    let a = await activeInfo(page);
    log(label, 'details: focus restored to View trigger', a.label === viewLabel,
      'active=' + a.tag + '[' + a.label + '] expected=' + viewLabel);

    // ---- 2: form dialog restores focus to the Edit button ----
    const editBtn = page.getByRole('button', { name: /^Edit / }).first();
    const editLabel = await editBtn.getAttribute('aria-label');
    await editBtn.click();
    await page.waitForTimeout(200);
    const titleFocused = await page.evaluate(() => !!(document.activeElement && document.activeElement.id === 'f-title'));
    log(label, 'form: initial focus on #f-title', titleFocused, JSON.stringify(await activeInfo(page)));
    await page.locator('dialog[open]').getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForTimeout(350);
    a = await activeInfo(page);
    log(label, 'form: focus restored to Edit trigger', a.label === editLabel,
      'active=' + a.tag + '[' + a.label + '] expected=' + editLabel);

    // ---- 3: delete confirmation, cancel restores focus ----
    const delBtn = page.getByRole('button', { name: /^Delete / }).first();
    const delLabel = await delBtn.getAttribute('aria-label');
    await delBtn.click();
    await page.waitForTimeout(200);
    await page.locator('dialog[open]').getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForTimeout(350);
    a = await activeInfo(page);
    log(label, 'delete: cancel restores focus to Delete trigger', a.label === delLabel,
      'active=' + a.tag + '[' + a.label + '] expected=' + delLabel);
  } catch (e) {
    log(label, 'execution (part 1)', false, String(e).split('\n').slice(0, 3).join(' '));
  } finally {
    await browser.close();
  }
}

async function run2(browserType, label) {
  let browser;
  try {
    browser = await browserType.launch();
  } catch (e) {
    log(label, 'launch (part 2)', false, String(e).split('\n')[0]);
    return;
  }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  try {
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Opportunities', exact: true }).click();
    await page.waitForTimeout(300);

    // ---- 4: Escape closes the details dialog and restores focus ----
    const viewBtn2 = page.getByRole('button', { name: /^View / }).first();
    const viewLabel2 = await viewBtn2.getAttribute('aria-label');
    await viewBtn2.click();
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    let a = await activeInfo(page);
    log(label, 'details: Escape restores focus to View trigger', a.label === viewLabel2,
      'active=' + a.tag + '[' + a.label + '] expected=' + viewLabel2);

    // ---- 5: details -> edit keeps the original opener ----
    const viewBtn3 = page.getByRole('button', { name: /^View / }).first();
    const viewLabel3 = await viewBtn3.getAttribute('aria-label');
    await viewBtn3.click();
    await page.waitForTimeout(200);
    await page.locator('dialog[open]').getByRole('button', { name: 'Edit', exact: true }).click();
    await page.waitForTimeout(350);
    const stillOpen = await page.locator('dialog[open]').count();
    log(label, 'details -> edit: exactly one dialog open', stillOpen === 1, 'open dialogs=' + stillOpen);
    const titleFocused = await page.evaluate(() => !!(document.activeElement && document.activeElement.id === 'f-title'));
    log(label, 'details -> edit: form focused on #f-title', titleFocused, JSON.stringify(await activeInfo(page)));
    await page.locator('dialog[open]').getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForTimeout(500);
    a = await activeInfo(page);
    log(label, 'details -> edit: focus returns to original View trigger', a.label === viewLabel3,
      'active=' + a.tag + '[' + a.label + '] expected=' + viewLabel3);

    // ---- 6: real delete -> focus falls back to #main-content ----
    const delBtn2 = page.getByRole('button', { name: /^Delete / }).first();
    await delBtn2.click();
    await page.waitForTimeout(200);
    await page.locator('dialog[open]').getByRole('button', { name: 'Delete', exact: true }).click();
    await page.waitForTimeout(500);
    a = await activeInfo(page);
    log(label, 'delete: focus falls back to #main-content', a.id === 'main-content',
      'active=' + a.tag + '[id=' + a.id + ' label=' + a.label + ']');

    // ---- 7: backdrop click closes and restores focus ----
    const addBtn = page.getByRole('button', { name: /Add Opportunity/i }).first();
    await addBtn.click();
    await page.waitForTimeout(200);
    await page.mouse.click(4, 4);
    await page.waitForTimeout(500);
    const closed = (await page.locator('dialog[open]').count()) === 0;
    a = await activeInfo(page);
    log(label, 'backdrop click closes and restores focus to Add button',
      closed && /Add Opportunity/i.test(a.label),
      'closed=' + closed + ' active=' + a.tag + '[' + a.label + ']');

    log(label, 'no page errors', errors.length === 0, errors.join(' | '));
  } catch (e) {
    log(label, 'execution (part 2)', false, String(e).split('\n').slice(0, 3).join(' '));
  } finally {
    await browser.close();
  }
}

function isPortInUse(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (inUse) => {
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function waitForServer(url, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error('the dev server exited with code ' + child.exitCode + ' before becoming ready');
    }
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.ok || response.status === 304) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('timed out after ' + timeoutMs + 'ms waiting for ' + url);
}

function startDevServer() {
  const viteBin = path.join(
    path.dirname(require.resolve('vite/package.json')),
    'bin',
    'vite.js',
  );
  const child = spawn(
    process.execPath,
    [viteBin, '--host', HOST, '--port', String(PORT), '--strictPort'],
    { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
  );
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
    process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
    process.stderr.write(chunk);
  });
  return { child, getOutput: () => output };
}

function stopDevServer() {
  if (!devServer) return;
  const { child } = devServer;
  devServer = null;
  if (child.exitCode === null && child.signalCode === null) {
    child.kill();
  }
}

function portConflictMessage() {
  return (
    'Port ' + PORT + ' on ' + HOST + ' is already in use, so the test server was not started.\n' +
    'Stop the process using that port, or test against an existing server by setting APP_URL:\n' +
    "  PowerShell:  $env:APP_URL='http://127.0.0.1:<port>/'; npm run test:focus\n" +
    '  bash/zsh:    APP_URL=http://127.0.0.1:<port>/ npm run test:focus\n' +
    'No existing process was stopped.'
  );
}

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  stopDevServer();
  if (signal) process.exit(signal === 'SIGINT' ? 130 : 143);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('exit', stopDevServer);

(async () => {
  const external = Boolean(process.env.APP_URL);
  try {
    if (external) {
      console.log('Using external server: ' + URL);
      await waitForServer(URL, null, 10000).catch((error) => {
        throw new Error(
          'APP_URL is not reachable: ' + URL + ' (' + error.message + ')\n' +
          'Start that server yourself, or unset APP_URL to let the script start one.',
        );
      });
    } else {
      if (await isPortInUse(HOST, PORT)) {
        throw new Error(portConflictMessage());
      }
      console.log('Starting dev server at ' + URL + ' ...');
      devServer = startDevServer();
      try {
        await waitForServer(URL, devServer.child, SERVER_START_TIMEOUT_MS);
      } catch (error) {
        const output = devServer.getOutput().trim();
        throw new Error(
          'Could not start the dev server at ' + URL + ' (' + error.message + ').\n' +
          (output ? 'Server output:\n' + output + '\n' : '') +
          'If port ' + PORT + ' is already in use, stop that process or set APP_URL as described in the README.',
        );
      }
    }

    const only = process.argv[2];
    const targets = [
      ['chromium', chromium],
      ['firefox', firefox],
      ['webkit', webkit],
    ];
    for (const [name, type] of targets) {
      if (only && only !== name) continue;
      await run(type, name);
      await run2(type, name);
      await run3(type, name);
      await run4(type, name);
    }
    const failed = results.filter((r) => !r.pass);
    console.log('\n=== ' + (results.length - failed.length) + '/' + results.length + ' passed ===');
    if (failed.length) {
      console.log('FAILURES:');
      failed.forEach((f) => console.log(' - [' + f.browser + '] ' + f.name + ' :: ' + f.detail));
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('\n' + String(error && error.message ? error.message : error));
    process.exitCode = 1;
  } finally {
    if (!external) stopDevServer();
  }
})();

async function run3(browserType, label) {
  let browser;
  try {
    browser = await browserType.launch();
  } catch (e) {
    log(label, 'launch (part 3)', false, String(e).split('\n')[0]);
    return;
  }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  try {
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });

    // ---- Dashboard: list item opens details, focus returns to the item ----
    const itemBtn = page.locator('.list-btn').first();
    const itemTitle = (await itemBtn.locator('strong').first().textContent() || '').trim();
    await itemBtn.click();
    await page.waitForTimeout(200);
    await page.locator('dialog[open]').getByRole('button', { name: 'Close', exact: true }).click();
    await page.waitForTimeout(400);
    let a = await activeInfo(page);
    const restored = await page.evaluate((t) => {
      const el = document.activeElement;
      return !!el && !!el.querySelector('strong') && el.querySelector('strong').textContent.trim() === t;
    }, itemTitle);
    log(label, 'dashboard list: focus returns to the clicked item', restored,
      'item=' + itemTitle + ' active=' + a.tag + '[' + a.label + ']');

    // ---- Deadlines page ----
    await page.getByRole('button', { name: 'Deadlines', exact: true }).click();
    await page.waitForTimeout(300);
    const dlBtn = page.locator('.list-btn').first();
    const dlTitle = (await dlBtn.locator('strong').first().textContent() || '').trim();
    await dlBtn.click();
    await page.waitForTimeout(200);
    await page.locator('dialog[open]').getByRole('button', { name: 'Close', exact: true }).click();
    await page.waitForTimeout(400);
    const dlRestored = await page.evaluate((t) => {
      const el = document.activeElement;
      return !!el && !!el.querySelector('strong') && el.querySelector('strong').textContent.trim() === t;
    }, dlTitle);
    log(label, 'deadlines list: focus returns to the clicked item', dlRestored, 'item=' + dlTitle);
  } catch (e) {
    log(label, 'execution (part 3)', false, String(e).split('\n').slice(0, 3).join(' '));
  } finally {
    await browser.close();
  }
}

async function run4(browserType, label) {
  let browser;
  try {
    browser = await browserType.launch();
  } catch (e) {
    log(label, 'launch (part 4)', false, String(e).split('\n')[0]);
    return;
  }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  try {
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Opportunities', exact: true }).click();
    await page.waitForTimeout(300);

    // ---- Save from the edit form restores focus to the Edit trigger ----
    const editBtn = page.getByRole('button', { name: /^Edit / }).first();
    const editLabel = await editBtn.getAttribute('aria-label');
    await editBtn.click();
    await page.waitForTimeout(200);
    await page.locator('#f-title').fill('Renamed Opportunity');
    await page.locator('dialog[open]').getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(500);
    const a = await activeInfo(page);
    // The record was renamed, so the button's aria-label changed as well;
    // focus must still land on that same Edit button.
    log(label, 'form: save restores focus to Edit trigger', a.label === 'Edit Renamed Opportunity',
      'active=' + a.tag + '[' + a.label + '] expected=Edit Renamed Opportunity');
    const saved = await page.getByText('Renamed Opportunity').first().isVisible();
    log(label, 'form: save persisted the record', saved, '');

    // ---- Add form: cancel restores focus to the Add button ----
    const addBtn = page.getByRole('button', { name: /Add Opportunity/i }).first();
    await addBtn.click();
    await page.waitForTimeout(200);
    await page.locator('dialog[open]').getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForTimeout(400);
    const a2 = await activeInfo(page);
    log(label, 'add: cancel restores focus to Add button', /Add Opportunity/i.test(a2.label),
      'active=' + a2.tag + '[' + a2.label + ']');

    // ---- Delete via keyboard focus + Enter, then confirm ----
    const delBtn = page.getByRole('button', { name: /^Delete / }).first();
    await delBtn.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const opened = (await page.locator('dialog[open]').count()) === 1;
    log(label, 'delete: keyboard Enter opens the confirm dialog', opened, '');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const a3 = await activeInfo(page);
    log(label, 'delete: Escape restores focus to Delete trigger', /Delete /.test(a3.label),
      'active=' + a3.tag + '[' + a3.label + ']');

    // ---- Restore dialog: initial file focus and Escape restoration ----
    await page.getByRole('button', { name: 'Reports', exact: true }).click();
    await page.waitForTimeout(300);
    const restoreBtn = page.getByRole('button', { name: 'Restore JSON Backup', exact: true });
    await restoreBtn.click();
    await page.waitForTimeout(250);
    const restoreOpen = (await page.locator('dialog[open]').count()) === 1;
    const restoreFocus = await page.evaluate(
      () => !!(document.activeElement && document.activeElement.id === 'restore-file'),
    );
    log(label, 'restore: dialog opens with file input focused', restoreOpen && restoreFocus,
      'open dialogs=' + (await page.locator('dialog[open]').count()) + ' active=' + JSON.stringify(await activeInfo(page)));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const a4 = await activeInfo(page);
    log(label, 'restore: Escape restores focus to Restore trigger',
      /Restore JSON Backup/.test(a4.label), 'active=' + a4.tag + '[' + a4.label + ']');

    log(label, 'no page errors (part 4)', errors.length === 0, errors.join(' | '));
  } catch (e) {
    log(label, 'execution (part 4)', false, String(e).split('\n').slice(0, 3).join(' '));
  } finally {
    await browser.close();
  }
}
