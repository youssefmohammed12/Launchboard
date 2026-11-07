import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.LB_BASE_URL ?? 'http://127.0.0.1:5173';
const outputDir = path.resolve('artifacts/responsive-ui');
const viewports = [
  { name: 'phone-360x800', width: 360, height: 800, phone: true },
  { name: 'phone-390x844', width: 390, height: 844, phone: true },
  { name: 'tablet-768x1024', width: 768, height: 1024, phone: false },
  { name: 'desktop-1440x900', width: 1440, height: 900, phone: false },
];
const pages = [
  { label: 'Dashboard', heading: 'Welcome back', file: 'dashboard' },
  { label: 'Opportunities', heading: 'Opportunities', file: 'opportunities' },
  { label: 'Calendar', heading: 'Calendar', file: 'calendar' },
  { label: 'Deadlines', heading: 'Deadlines', file: 'deadlines' },
  { label: 'Reports', heading: 'Reports', file: 'reports' },
];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

async function assertNoHorizontalOverflow(label) {
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(
    widths.document <= widths.viewport && widths.body <= widths.viewport,
    `${label}: horizontal overflow (viewport ${widths.viewport}px, document ${widths.document}px, body ${widths.body}px)`,
  );
}

try {
  await fs.mkdir(outputDir, { recursive: true });
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30000 });

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(120);
    const mainWidth = await page.locator('.lb-main-area').evaluate((element) => Math.round(element.getBoundingClientRect().width));
    if (viewport.width <= 860) assert.ok(mainWidth >= viewport.width - 2, viewport.name + ': main area width ' + mainWidth + 'px does not match viewport ' + viewport.width + 'px');
    const shell = await page.evaluate(() => {
      const nav = document.querySelector('.lb-primary-nav');
      const links = [...document.querySelectorAll('.lb-nav-link')];
      return {
        innerWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        navPosition: nav ? getComputedStyle(nav).position : null,
        labels: links.map((link) => {
          const label = link.querySelector('span');
          const rect = link.getBoundingClientRect();
          return {
            name: link.getAttribute('aria-label'),
            textDisplay: label ? getComputedStyle(label).display : 'missing',
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        }),
      };
    });
    assert.ok(shell.documentWidth <= shell.innerWidth, `${viewport.name}: document horizontal overflow`);
    assert.equal(shell.labels.length, 5, `${viewport.name}: expected five primary destinations`);
    for (const link of shell.labels) {
      assert.notEqual(link.textDisplay, 'none', `${viewport.name}: ${link.name} label is visually hidden`);
      if (viewport.phone) {
        assert.ok(link.width >= 44 && link.height >= 44, `${viewport.name}: ${link.name} target below 44×44px (${link.width}×${link.height})`);
      }
    }
    if (viewport.phone) assert.equal(shell.navPosition, 'fixed', `${viewport.name}: phone navigation must be fixed`);

    const primaryNav = page.getByRole('navigation', { name: 'Primary navigation' });
    for (const item of pages) {
      console.log(`Inspecting ${viewport.name} / ${item.label}`);
      await primaryNav.getByRole('button', { name: item.label, exact: true }).click();
      await page.getByRole('heading', { name: item.heading, exact: true }).waitFor({ timeout: 10000 });
      const activeNavigation = await primaryNav.locator(".lb-nav-link[aria-current=page]").getAttribute("aria-label");
      assert.equal(activeNavigation, item.label, viewport.name + ": wrong active destination after clicking " + item.label);
      if (item.label === 'Opportunities') {
        const rowAlignment = await page.locator('.lb-opportunity-title-cell').first().evaluate((cell) => {
          const checkbox = cell.querySelector('.lb-opportunity-row-checkbox');
          const copy = cell.querySelector('.lb-opportunity-title-copy');
          const selectControl = cell.querySelector('.lb-opportunity-select-control');
          const checkRect = checkbox.getBoundingClientRect();
          const controlRect = selectControl.getBoundingClientRect();
          const copyRect = copy.getBoundingClientRect();
          const cellRect = cell.getBoundingClientRect();
          return {
            checkboxInsideOpportunity: Boolean(checkbox && copy && selectControl && cell.contains(checkbox)),
            checkboxTop: checkRect.top,
            checkboxBottom: checkRect.bottom,
            checkboxCenter: checkRect.top + checkRect.height / 2,
            controlTop: controlRect.top,
            controlBottom: controlRect.bottom,
            controlHeight: controlRect.height,
            controlRight: controlRect.right,
            cellRight: cellRect.right,
            titleTop: copyRect.top,
            titleLeft: copyRect.left,
            titleCenter: copyRect.top + copyRect.height / 2,
            checkboxTitleDifference: Math.abs((checkRect.top + checkRect.height / 2) - (copyRect.top + copyRect.height / 2)),
            hasMobileSelectLabel: getComputedStyle(selectControl.querySelector('span')).display !== 'none',
          };
        });
        assert.equal(rowAlignment.checkboxInsideOpportunity, true, 'row checkbox must remain associated with its opportunity');
        if (viewport.phone) {
          assert.ok(rowAlignment.controlHeight >= 44, 'mobile Select control must provide a 44px touch target');
          assert.ok(rowAlignment.controlRight <= rowAlignment.cellRight + 1, 'mobile Select control must remain within the card');
          assert.ok(rowAlignment.titleTop > rowAlignment.controlBottom, 'mobile title must sit below the dedicated selection header row');
          assert.equal(rowAlignment.hasMobileSelectLabel, true, 'mobile checkbox needs a visible Select label');
        } else {
          assert.ok(rowAlignment.checkboxTitleDifference <= 2, 'desktop/tablet checkbox must remain vertically centered with its opportunity title (' + rowAlignment.checkboxTitleDifference + 'px difference)');
          assert.equal(rowAlignment.hasMobileSelectLabel, false, 'desktop/tablet must not show the mobile Select label');
        }
        const headerHasMaster = await page.locator('th.lb-opportunity-heading-cell input[aria-label="Select all visible opportunities"]').count();
        assert.equal(headerHasMaster, 1, 'select-all checkbox should share the Opportunity heading');
        if (viewport.width > 640 && viewport.width <= 860) {
          const tabletLayout = await page.locator('.lb-opportunity-list-table').evaluate((table) => {
            const row = table.querySelector('tbody > tr');
            const cells = [...row.children].map((cell) => {
              const rect = cell.getBoundingClientRect();
              return { left: rect.left, right: rect.right, width: rect.width };
            });
            return {
              rowDisplay: getComputedStyle(row).display,
              wrapperOverflow: getComputedStyle(table.parentElement).overflowX,
              titleWidth: cells[0].width,
              companyWidth: cells[1].width,
              datesWidth: cells[5].width,
              cellsWithinViewport: cells.every((cell) => cell.left >= -1 && cell.right <= innerWidth + 1),
            };
          });
          assert.equal(tabletLayout.rowDisplay, 'grid', 'tablet opportunity rows must use the dedicated card grid');
          assert.equal(tabletLayout.wrapperOverflow, 'visible', 'tablet cards must not rely on horizontal scrolling');
          assert.ok(tabletLayout.titleWidth >= 320, 'tablet opportunity title area is still too narrow');
          assert.ok(tabletLayout.companyWidth >= 240, 'tablet company area is still too narrow');
          assert.ok(tabletLayout.datesWidth >= 220, 'tablet dates area is still too narrow');
          assert.equal(tabletLayout.cellsWithinViewport, true, 'tablet opportunity card cells must stay inside the viewport');
          const tabletCheckbox = page.locator('.lb-opportunity-row-checkbox').first();
          await tabletCheckbox.check();
          assert.equal(await tabletCheckbox.isChecked(), true, 'tablet opportunity selection must remain interactive');
          await tabletCheckbox.uncheck();
        }
      }
      await assertNoHorizontalOverflow(`${viewport.name} / ${item.label}`);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(50);
      await page.screenshot({
        path: path.join(outputDir, `${viewport.name}-${item.file}.png`),
        fullPage: true,
      });

      if (item.label === 'Opportunities') {
        if (viewport.phone) {
          const actionTargets = await page.locator('.lb-opportunity-icon-action').evaluateAll((elements) =>
            elements.map((element) => {
              const rect = element.getBoundingClientRect();
              return { width: rect.width, height: rect.height };
            }),
          );
          assert.ok(actionTargets.length > 0, 'phone opportunity list has no action buttons to inspect');
          for (const target of actionTargets) {
            assert.ok(target.width >= 44 && target.height >= 44, 'opportunity row action target is smaller than 44×44px');
          }
        }

        await page.getByRole('button', { name: 'Board view' }).click();
        if (viewport.phone) {
          const laneSelector = page.getByRole('group', { name: 'Filter board by status' });
          await laneSelector.waitFor({ state: 'visible' });
          const interviewLane = laneSelector.getByRole('button', { name: /^Interview:/ });
          await interviewLane.click();
          const board = page.getByRole('group', { name: 'Opportunity status columns' });
          assert.equal(await board.getAttribute('data-selected-status'), 'Interview');
          const visibleLanes = await page.locator('.lb-board-columns > section').evaluateAll((sections) =>
            sections.filter((section) => getComputedStyle(section).display !== 'none').length,
          );
          assert.equal(visibleLanes, 1, `${viewport.name}: expected exactly one visible board lane`);
        } else {
          await page.getByRole('group', { name: 'Opportunity status columns' }).waitFor();
          const visibleLanes = await page.locator('.lb-board-columns > section').evaluateAll((sections) =>
            sections.filter((section) => getComputedStyle(section).display !== 'none').length,
          );
          assert.equal(visibleLanes, 5, `${viewport.name}: desktop/tablet board should retain all five lanes`);
        }
      await assertNoHorizontalOverflow(`${viewport.name} / Opportunity board`);
        await page.screenshot({
          path: path.join(outputDir, `${viewport.name}-board.png`),
          fullPage: true,
        });
        await page.getByRole('button', { name: 'List view' }).click();
      }
    }

    if (viewport.width === 1440) {
      await page.evaluate(() => window.scrollTo(0, 0));
      const footerAlignment = await page.locator('.lb-sidebar-footer').evaluate((footer) => {
        const iconBox = footer.querySelector('.lb-sidebar-footer-icon');
        const icon = iconBox.getBoundingClientRect();
        const svg = iconBox.querySelector('svg').getBoundingClientRect();
        const copy = footer.querySelector(':scope > div').getBoundingClientRect();
        const center = (rect) => rect.top + rect.height / 2;
        return {
          svgToContainer: Math.abs(center(svg) - center(icon)),
          svgToText: Math.abs(center(svg) - center(copy)),
          iconDisplay: getComputedStyle(iconBox).display,
        };
      });
      assert.equal(footerAlignment.iconDisplay, 'grid', 'Private workspace icon wrapper must use its centering grid');
      assert.ok(footerAlignment.svgToContainer <= 1, 'shield SVG must be centered inside its icon wrapper (' + footerAlignment.svgToContainer + 'px difference)');
      assert.ok(footerAlignment.svgToText <= 2, 'shield SVG must be vertically centered with its text (' + footerAlignment.svgToText + 'px difference)');
    }
    if (viewport.phone && viewport.width === 360) {
      await primaryNav.getByRole('button', { name: 'Dashboard', exact: true }).click();

      const addButton = page.getByRole('button', { name: 'Add Opportunity', exact: true });
      await addButton.click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor({ state: 'visible' });
      const titleField = page.getByLabel('Title *');
      await titleField.waitFor({ state: 'visible' });
      const titleBounds = await titleField.boundingBox();
      assert.ok(titleBounds && titleBounds.height >= 44, 'opportunity form title field is smaller than 44px');
      const saveButton = dialog.getByRole('button', { name: 'Save', exact: true });
      await saveButton.scrollIntoViewIfNeeded();
      const bounds = await dialog.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, height: rect.height, viewport: innerHeight };
      });
      assert.ok(bounds.top >= 0 && bounds.bottom <= bounds.viewport, 'phone dialog extends outside the viewport');
      const saveBounds = await saveButton.boundingBox();
      assert.ok(saveBounds && saveBounds.y >= 0 && saveBounds.y + saveBounds.height <= viewport.height, 'Save action is not reachable within the phone viewport');
      await page.screenshot({ path: path.join(outputDir, 'phone-360x800-add-opportunity-dialog.png'), fullPage: true });
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await page.locator('dialog[open]').count(), 0, 'Escape should close the opportunity dialog');
      assert.equal(await addButton.evaluate((element) => document.activeElement === element), true, 'dialog should restore focus to its opener');
      const focusStyle = await addButton.evaluate((element) => ({ style: getComputedStyle(element).outlineStyle, width: getComputedStyle(element).outlineWidth }));
      assert.notEqual(focusStyle.style, 'none', 'keyboard-restored action must retain a visible focus ring');
      assert.ok(parseFloat(focusStyle.width) >= 2, 'keyboard focus ring must be at least 2px');

      await page.keyboard.press('Control+k');
      const searchDialog = page.getByRole('dialog');
      await searchDialog.waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      await searchDialog.waitFor({ state: 'hidden' });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const transitionDuration = await primaryNav.locator('.lb-nav-link').first().evaluate((element) =>
        getComputedStyle(element).transitionDuration.split(',')[0].trim(),
      );
      assert.ok(parseFloat(transitionDuration) <= 0.01, `reduced motion transition not disabled (${transitionDuration})`);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
    }
  }

  assert.deepEqual(errors, [], `Browser emitted runtime errors: ${errors.join('; ')}`);
  console.log(`Responsive UI checks passed: ${viewports.length} viewports × ${pages.length} pages.`);
  console.log(`Navigation, board lanes, form dialog, Escape/focus, Ctrl+K, reduced motion checked.`);
  console.log(`Screenshots saved to: ${outputDir}`);
} finally {
  await browser.close();
}
