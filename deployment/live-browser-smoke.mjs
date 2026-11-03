import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const pageErrors = [];
  const unexpectedConsoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('401')) {
      unexpectedConsoleErrors.push(message.text());
    }
  });
  const response = await page.goto('https://launchboard-drab.vercel.app/', {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
  if (response?.status() !== 200) throw new Error('Homepage did not return HTTP 200.');
  await page.getByRole('button', { name: 'Sign in' }).first().waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Create one' }).click();
  await page.getByRole('button', { name: 'Create account' }).waitFor({ timeout: 5000 });
  if (pageErrors.length || unexpectedConsoleErrors.length) {
    throw new Error('Unexpected frontend browser errors were detected.');
  }
  console.log(JSON.stringify({
    httpStatus: response.status(),
    title: await page.title(),
    signInUiLoaded: true,
    registrationUiLoaded: true,
    javascriptErrors: pageErrors.length,
    unexpectedConsoleErrors: unexpectedConsoleErrors.length,
    unauthenticatedSessionProbe: 'expected 401 before sign-in',
  }, null, 2));
} finally {
  await browser.close();
}
