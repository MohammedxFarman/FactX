import { chromium } from '@playwright/test';
import { mkdtempSync, mkdirSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';

const dir = mkdtempSync(path.join(tmpdir(), 'factx-ui-test-'));
const { app, db } = createApp({ dataDir: dir, setupToken: 'ui-test-setup-token' });
const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
const browserRoot = path.join(homedir(), 'AppData', 'Local', 'ms-playwright');
const candidates = existsSync(browserRoot) ? readdirSync(browserRoot).filter(n => /^chromium-\d+$/.test(n)).flatMap(n => ['chrome-win64/chrome.exe','chrome-win/chrome.exe'].map(exe => path.join(browserRoot,n,exe))) : [];
const executablePath = candidates.find(p => existsSync(p));
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', msg => { if (msg.type() === 'error' && !msg.text().includes('401 (Unauthorized)')) errors.push(msg.text()); });
mkdirSync('test-results', { recursive: true });
try {
  await page.goto(base);
  await page.getByRole('heading', { name: 'Make it your workspace.' }).waitFor();
  await page.screenshot({ path: 'test-results/setup-desktop.png', fullPage: true });
  await page.getByLabel('Full name').fill('Workspace Reviewer');
  await page.getByLabel('Institutional email').fill('ui-admin@test.invalid');
  await page.getByLabel('Password', { exact: true }).fill('Browser-test-password-382');
  await page.getByLabel('Setup token').fill('ui-test-setup-token');
  await page.getByRole('button', { name: 'Create your workspace' }).click();
  await page.getByRole('heading', { name: /Good .*Workspace/ }).waitFor();
  await page.getByText('Database connected', { exact: false }).waitFor();
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Desktop must not overflow');
  const workspaceTrigger = page.locator('.workspace-chip');
  const workspaceMenu = page.getByRole('menu', { name: 'Available workspaces' });
  await workspaceTrigger.click();
  await workspaceMenu.waitFor();
  assert.equal(await workspaceTrigger.getAttribute('aria-expanded'), 'true');
  assert.equal(await workspaceMenu.getByRole('menuitem').count(), 1, 'Only the signed-in portal is available');
  await page.screenshot({ path: 'test-results/workspace-menu-desktop.png', fullPage: true });
  await page.keyboard.press('Escape');
  await workspaceMenu.waitFor({ state:'hidden' });
  assert.equal(await workspaceTrigger.evaluate(element => element === document.activeElement), true);
  await workspaceTrigger.locator('.workspace-chevron').click();
  await workspaceMenu.waitFor();
  await page.getByRole('heading', { name: /Good .*Workspace/ }).click();
  await workspaceMenu.waitFor({ state:'hidden' });
  await workspaceTrigger.focus();
  await page.keyboard.press('ArrowDown');
  await workspaceMenu.getByRole('menuitem').waitFor();
  await page.keyboard.press('Enter');
  await workspaceMenu.waitFor({ state:'hidden' });
  await page.getByText('Database connected', { exact:false }).waitFor();
  await page.getByRole('button', { name:'Academics', exact:true }).click();
  await page.getByRole('heading', { name:'Academics', exact:true }).waitFor();
  await workspaceTrigger.click();
  await workspaceMenu.getByRole('menuitem', { name:/Administrator portal/ }).click();
  await page.getByRole('heading', { name:/Good .*Workspace/ }).waitFor();
  await page.getByRole('button', { name: 'Academics', exact: true }).click();
  await page.getByRole('button', { name: 'Department', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('UI Test Department');
  await page.getByLabel('Code', { exact: true }).fill('UITEST');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('button', { name: 'Departments', exact: true }).click();
  await page.getByRole('cell', { name: 'UI Test Department', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Create class', exact: true }).click();
  await page.getByLabel('Class name').fill('UI Test Class');
  await page.getByLabel('Department', { exact: true }).selectOption({ label: 'UI Test Department' });
  await page.getByLabel('Program', { exact: true }).fill('Test Program');
  await page.getByLabel('Batch', { exact: true }).fill('Test Batch');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('button', { name: 'Classes', exact: false }).first().click();
  await page.getByText('UI Test Class', { exact: true }).waitFor();
  const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
  await page.getByRole('button', { name: 'Departments', exact: true }).click();
  await breadcrumb.getByText('Academics', { exact: true }).click();
  await page.getByRole('cell', { name: 'UI Test Department', exact: true }).waitFor();
  assert.equal(await breadcrumb.getByRole('button', { name: 'Academics', exact: true }).count(), 0, 'Current breadcrumb must not be a navigation control');
  let documentRequests = 0;
  page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentRequests++; });
  const breadcrumbPages = [
    ['Students','students'], ['Academics','catalog'], ['Attendance','attendance'], ['Timetable','timetable'],
    ['Assessments','activities'], ['Programming lab','activities'], ['Analytics & support','dashboard'],
    ['Learning resources','activities'], ['Reports','students'], ['Grades & semesters','grades'],
    ['Documents','documents'], ['Feedback','feedback'], ['Leave requests','leave'], ['People & access','users'],
    ['Announcements','announcements'], ['Knowledge library','knowledge'], ['Faculty workload','faculty-workload'],
    ['Academic setup','academic-reference'], ['Audit trail','audit'], ['Settings','system'],
  ];
  for (const [name, endpoint] of breadcrumbPages) {
    await Promise.all([
      page.waitForResponse(response => response.url() === `${base}/api/${endpoint}` && response.ok()),
      page.getByRole('button', { name: name === 'Programming lab' ? /^Programming lab/ : name, exact: true }).click(),
    ]);
    assert.equal(await breadcrumb.locator('[aria-current="page"]').textContent(), name);
    await breadcrumb.getByRole('button', { name: 'Workspace', exact: true }).click();
    await page.getByText('Database connected', { exact: false }).waitFor();
    assert.equal(await breadcrumb.locator('[aria-current="page"]').textContent(), 'Workspace');
    assert.equal(await breadcrumb.getByRole('button').count(), 0, 'Dashboard breadcrumb must be inactive');
  }
  assert.equal(documentRequests, 0, 'Breadcrumbs and sidebar must navigate without document reloads');
  for (const name of ['Timetable', 'Grades & semesters', 'Knowledge library', 'Faculty workload', 'Academic setup', 'Settings']) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.getByRole('heading', { name, exact: true }).waitFor();
    await page.locator('.panel, .timetable-grid').first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} must not overflow on desktop`);
  }
  await page.getByRole('button', { name: 'Announcements', exact: true }).click();
  await page.getByRole('button', { name: 'Publish announcement', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Browser verification notice');
  await page.getByLabel('Message', { exact: true }).fill('This notice belongs only to the temporary browser test workspace.');
  await page.getByRole('button', { name: 'Publish announcement', exact: true }).last().click();
  await page.getByRole('heading', { name: 'Browser verification notice', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/announcements-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByText('Database connected', { exact: false }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name:'Open navigation' }).click();
  await workspaceTrigger.click();
  await workspaceMenu.waitFor();
  await page.screenshot({ path:'test-results/workspace-menu-mobile.png', fullPage:true });
  await page.locator('.sidebar-shade').click({position:{x:350,y:400}});
  await workspaceMenu.waitFor({state:'hidden'});
  await page.getByRole('button', { name:'Open navigation' }).click();
  await workspaceTrigger.click();
  await workspaceMenu.getByRole('menuitem').click();
  await page.locator('.sidebar.open').waitFor({state:'hidden'});
  await page.screenshot({ path: 'test-results/dashboard-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Mobile must not overflow');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Students', exact: true }).click();
  await page.getByRole('heading', { name: 'Every student has a story' }).waitFor();
  await page.screenshot({ path: 'test-results/students-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await breadcrumb.getByRole('button', { name: 'Workspace', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: /Good .*Workspace/ }).waitFor();
  for (const name of ['Timetable', 'Announcements', 'Knowledge library', 'Settings']) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('button', { name, exact: true }).click();
    await page.getByRole('heading', { name, exact: true }).waitFor();
    await page.locator('.panel, .timetable-grid').first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} must not overflow on mobile`);
  }
  await page.screenshot({ path: 'test-results/settings-mobile.png', fullPage: true });
  const catalogResponse=await page.request.get(base+'/api/catalog');
  const testCatalog=await catalogResponse.json();
  for(const [role,portal] of [['HOD','Head of department'],['FACULTY','Faculty'],['STUDENT','Student']]) {
    const email=`browser-${role.toLowerCase()}@test.invalid`;
    const created=await page.request.post(base+'/api/users',{data:{name:`Portal ${role}`,email,password:'Browser-test-password-382',role,department_id:testCatalog.departments[0].id,...(role==='STUDENT'?{class_id:testCatalog.classes[0].id,roll_number:'BROWSER-001'}:{})}});
    assert.equal(created.status(),201,await created.text());
    const context=await browser.newContext({viewport:{width:1280,height:900}});
    try {
      const portalPage=await context.newPage();
      portalPage.on('pageerror',error=>errors.push(error.message));
      await portalPage.goto(base);
      await portalPage.getByLabel('Institutional email').fill(email);
      await portalPage.getByLabel('Password',{exact:true}).fill('Browser-test-password-382');
      await portalPage.getByRole('button',{name:'Sign in to FactX'}).click();
      await portalPage.getByRole('heading',{name:/Good .*Portal/}).waitFor();
      await portalPage.locator('.workspace-chip').click();
      const menu=portalPage.getByRole('menu',{name:'Available workspaces'});
      assert.equal(await menu.getByRole('menuitem').count(),1);
      await menu.getByRole('menuitem',{name:new RegExp(`${portal} portal`)}).click();
      await menu.waitFor({state:'hidden'});
      await portalPage.getByText('Database connected',{exact:false}).waitFor();
      assert.equal(await portalPage.getByRole('button',{name:'Settings',exact:true}).count(),0);
      if(role==='HOD') {
        await portalPage.getByRole('heading',{name:'Department priorities'}).waitFor();
        for(const label of ['Programming lab','Learning resources','People & access','Academic setup','Create assessment','Record attendance','Record marks']) {
          assert.equal(await portalPage.getByRole('button',{name:label,exact:true}).count(),0,`HOD should not expose ${label}`);
        }
        await portalPage.screenshot({path:'test-results/hod-overview-desktop.png',fullPage:true});
        for(const [label,forbidden] of [['Attendance review','Take attendance'],['Assessment overview','Create assessment'],['Results & SGPA','Record grade'],['Department reports','Record marks']]) {
          await portalPage.getByRole('button',{name:label,exact:true}).click();
          await portalPage.getByRole('heading',{name:label,exact:true}).waitFor();
          await portalPage.locator('.panel').first().waitFor();
          assert.equal(await portalPage.getByRole('button',{name:forbidden,exact:true}).count(),0);
        }
        await portalPage.getByRole('button',{name:'Classes & faculty assignments',exact:true}).click();
        await portalPage.getByRole('button',{name:'Assign faculty',exact:true}).click();
        await portalPage.getByRole('dialog',{name:'Assign faculty to a class'}).waitFor();
        await portalPage.getByRole('button',{name:'Close dialog'}).click();
        await portalPage.getByRole('navigation',{name:'Breadcrumb'}).getByRole('button',{name:'Workspace',exact:true}).click();
        await portalPage.getByRole('heading',{name:'Department priorities'}).waitFor();
        await portalPage.setViewportSize({width:390,height:844});
        await portalPage.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=1);
        assert.equal(await portalPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'HOD dashboard must not overflow on mobile');
        await portalPage.screenshot({path:'test-results/hod-overview-mobile.png',fullPage:true});
        await portalPage.getByRole('button',{name:'Open navigation'}).click();
        await portalPage.getByRole('button',{name:'Leave approvals',exact:true}).click();
        await portalPage.getByRole('heading',{name:'Leave approvals',exact:true}).waitFor();
      }
    } finally {await context.close();}
  }
  assert.deepEqual(errors, [], 'Browser should have no console errors');
  console.log('PASS: setup, dashboard, department/class creation, extension navigation, announcement publication, desktop/mobile layouts; no browser errors. Screenshots saved in test-results/.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
