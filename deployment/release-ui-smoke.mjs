const base = 'https://launchboard-drab.vercel.app';

const root = await fetch(base);
const html = await root.text();
const paths = [...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)].map((match) => match[1]);
const assets = [];
const assetBodies = new Map();
for (const path of paths) {
  const response = await fetch(new URL(path, base));
  const body = await response.text();
  assets.push({ path, status: response.status, bytes: Buffer.byteLength(body) });
  assetBodies.set(path, body);
}

const jsPath = paths.find((path) => path.endsWith('.js'));
const cssPath = paths.find((path) => path.endsWith('.css'));
const js = jsPath ? assetBodies.get(jsPath) ?? '' : '';
const css = cssPath ? assetBodies.get(cssPath) ?? '' : '';
const designMarkers = {
  workspaceHeader: js.includes('YOUR PERSONAL WORKSPACE'),
  globalQuickAdd: js.includes('Add opportunity'),
  authBranding: js.includes('Make every opportunity count.'),
  responsiveSidebarStyles: css.includes('.lb-sidebar'),
  quickAddStyles: css.includes('.lb-topbar-add-button'),
  authPanelStyles: css.includes('.lb-auth-promo'),
};

const health = await fetch(`${base}/api/health`);
const readiness = await fetch(`${base}/api/ready`);
const healthData = await health.json();
const readinessData = await readiness.json();

const result = {
  homepage: root.status,
  assets,
  designMarkers,
  health: { status: health.status, body: healthData },
  readiness: { status: readiness.status, body: readinessData },
};
console.log(JSON.stringify(result, null, 2));

if (
  root.status !== 200 ||
  assets.length < 2 ||
  assets.some((asset) => asset.status !== 200) ||
  Object.values(designMarkers).some((passed) => !passed) ||
  health.status !== 200 ||
  healthData.status !== 'ok' ||
  readiness.status !== 200 ||
  readinessData.status !== 'ok' ||
  readinessData.db !== 'ok'
) {
  process.exitCode = 1;
}
