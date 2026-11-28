import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {fixture,chromiumPath} from './ui-fixture.mjs';
const test=await fixture();
const browser=await chromium.launch({headless:true,executablePath:chromiumPath()});
const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
mkdirSync('test-results',{recursive:true});
try {
 await page.goto(test.base);
 await page.getByLabel('Institutional email').fill('admin@redesign.invalid');
 await page.getByLabel('Password',{exact:true}).fill(test.password);
 await page.getByRole('button',{name:'Sign in to FactX',exact:true}).click();
 const home=async()=>{await page.evaluate(()=>{location.hash='overview';});await page.getByRole('heading',{name:'Quick Access',exact:true}).waitFor();};
 await home();
 const destinations=['inbox','timetable','academics','learning','assessments','reports'];
 assert.deepEqual(await page.locator('.overview-tile').evaluateAll(links=>links.map(link=>link.getAttribute('href'))),destinations.map(id=>'#'+id));
 const inbox=await (await page.request.get(test.base+'/api/inbox')).json();
 if(inbox.summary.total) await expect(page.locator('.overview-count')).toHaveText(`${inbox.summary.total} open`);
 else await expect(page.locator('.overview-count')).toHaveCount(0);
 await expect(page.locator('.overview-priorities')).toContainText('09:00');
 for(const width of [1440,768,390,320]) {
  await page.setViewportSize({width,height:1000});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Overflow at ${width}`);
  assert.equal(await page.locator('.overview-tiles').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),width>900?3:width>360?2:1);
  for(const id of destinations) {
   const tile=page.locator(`.overview-tile[href="#${id}"]`);await tile.focus();await page.keyboard.press('Enter');
   await expect(page).toHaveURL(new RegExp(`#${id}$`));await page.locator('.fx-skeleton-page').waitFor({state:'hidden'});
   await expect(page.locator('.breadcrumb-current')).not.toHaveText('Workspace');await home();
  }
  await page.screenshot({path:`test-results/overview-${width}.png`,fullPage:true});
 }
 await page.evaluate(()=>document.documentElement.dataset.theme='dark');
 await page.screenshot({path:'test-results/overview-dark-mobile.png',fullPage:true});
 assert.equal(await page.locator('.overview-tile').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(73, 49, 38)');
 await page.route('**/api/timetable',route=>route.fulfill({json:[]}));
 await page.route('**/api/inbox',route=>route.fulfill({json:{items:[],summary:{total:0,actionable:0,overdue:0}}}));
 await page.reload();await home();
 await expect(page.locator('.overview-priorities')).toContainText('No classes scheduled for today.');
 await expect(page.locator('.overview-priorities')).toContainText('No open inbox items.');
 await page.route('**/api/inbox',route=>route.fulfill({json:{items:[{key:'test-review',title:'Review a request',detail:'Browser fixture',page:'reports'}],summary:{total:1,actionable:1,overdue:0}}}));
 await page.reload();await home();
 await expect(page.locator('.overview-count')).toHaveText('1 open');
 await page.getByRole('button',{name:'Review a request Browser fixture'}).click();
 await expect(page).toHaveURL(/#reports$/);
 const {department_id}=test.db.prepare('SELECT department_id FROM classes WHERE id=?').get(test.classroom.id);
 for(let i=1;i<=5;i++){
   const {data:student}=await test.request('/users',{name:`Support fixture ${i}`,email:`support-${i}@redesign.invalid`,password:test.password,role:'STUDENT',department_id,class_id:test.classroom.id,roll_number:`SUPPORT-${i}`},test.admin);
   test.db.prepare("INSERT INTO submissions(id,activity_id,student_id,status,score,attempt,created_at) VALUES(?,?,?,'evaluated',0,1,?)").run('support-score-'+i,test.lab.id,student.id,new Date().toISOString());
 }
 const faculty=await browser.newPage();
 await faculty.goto(test.base);
 await faculty.getByLabel('Institutional email').fill('faculty@redesign.invalid');
 await faculty.getByLabel('Password',{exact:true}).fill(test.password);
 await faculty.getByRole('button',{name:'Sign in to FactX',exact:true}).click();
 await faculty.getByRole('heading',{name:'Students needing support'}).waitFor();
 await faculty.getByRole('button',{name:'Show all 6 students'}).click();
 await expect(faculty.getByRole('button',{name:/Support fixture 5.*Review assessment performance/})).toBeVisible();
 await faculty.getByRole('button',{name:/Alex Student.*attendance routine/}).click();
 await faculty.getByRole('dialog',{name:'The complete student story'}).waitFor();
 assert.deepEqual(errors,[]);
 console.log('PASS: six keyboard links at four viewport sizes, live inbox count and schedule, empty states, dark palette, no overflow or browser errors.');
} finally {await browser.close();await test.close();}
