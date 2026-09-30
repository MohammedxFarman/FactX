import { chromium } from '@playwright/test';
import { existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const accounts = JSON.parse(readFileSync('data/portal-preview/logins.json', 'utf8'));
const root = path.join(homedir(), 'AppData', 'Local', 'ms-playwright');
const candidates = existsSync(root) ? readdirSync(root).filter(name => /^chromium-\d+$/.test(name)).flatMap(name => ['chrome-win64/chrome.exe','chrome-win/chrome.exe'].map(exe => path.join(root,name,exe))) : [];
const executablePath = candidates.find(file => existsSync(file));
const browser = await chromium.launch({ headless:true, ...(executablePath ? {executablePath} : {}) });
mkdirSync('test-results', {recursive:true});
try {
  for (const account of accounts) {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto('http://localhost:3002/');
      await page.getByLabel('Institutional email').fill(account.email);
      await page.getByLabel('Password', {exact:true}).fill(account.password);
      const [response] = await Promise.all([
        page.waitForResponse(response => response.url().endsWith('/api/auth/login')),
        page.getByRole('button', {name:'Sign in to FactX'}).click(),
      ]);
      if (!response.ok()) throw new Error(`${account.role}: login HTTP ${response.status()}: ${await response.text()}`);
      await page.getByRole('heading', {name:/Good .*Preview/}).waitFor();
      await page.getByText('Database connected', {exact:false}).waitFor();
      await page.screenshot({path:`test-results/preview-${account.role.toLowerCase()}-login.png`});
      console.log(`${account.role}: browser login and dashboard PASS on ${page.url()}`);
      await page.request.post('http://localhost:3002/api/auth/logout');
    } finally {await context.close();}
  }
} finally {await browser.close();}
