import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {createApp} from '../server/app.js';
import {chromiumPath} from './ui-fixture.mjs';
const dir=path.resolve('data/anits-test'),{app,db}=createApp({dataDir:dir}),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true,executablePath:chromiumPath()}),errors=[];
const admin=JSON.parse(readFileSync(path.join(dir,'administrator-login.json'),'utf8'));
assert.ok(process.env.ANITS_TEST_PASSWORD);
mkdirSync('test-results',{recursive:true});
try{
 for(const [index,account]of [admin,...['csm.hod','csm.faculty01','A261CSM001','bba.hod','bba.faculty01','test-bba-2026-001'].map(id=>({email:id+'@anits.edu.in',password:process.env.ANITS_TEST_PASSWORD}))].entries()){
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.getByLabel('Institutional email').fill(account.email);await page.getByLabel('Password',{exact:true}).fill(account.password);await page.getByRole('button',{name:'Sign in to FactX'}).click();await page.locator('aside.sidebar').waitFor();await page.getByText('Database connected',{exact:false}).first().waitFor();
  await page.goto(base+'/#programs');await page.getByRole('heading',{name:'Sections and class teachers',exact:true}).waitFor();
  if(index===0){
   await page.getByRole('heading',{name:'M.Tech',exact:true}).waitFor();await page.screenshot({path:'test-results/anits-programs.png',fullPage:true});
   await page.getByRole('button',{name:'Configure M.Tech',exact:true}).click();await page.getByLabel('Academic duration',{exact:true}).fill('2');await page.getByRole('button',{name:'Cancel',exact:true}).click();
   await page.getByRole('button',{name:'Assign class teacher',exact:true}).first().click();await page.getByRole('button',{name:'Save academic changes',exact:true}).click();await page.getByRole('heading',{name:'Edit section',exact:true}).waitFor({state:'hidden'});
   await page.goto(base+'/#students');await page.getByRole('heading',{name:'Student directory',exact:true}).waitFor();await page.getByText('10320 matching students',{exact:false}).waitFor();
   await page.getByLabel('Filter program',{exact:true}).selectOption('BBA');await page.getByText('720 matching students',{exact:false}).waitFor();await page.getByRole('button',{name:'Next page',exact:true}).click();await page.getByText('Page 2 of 15',{exact:false}).waitFor();
   await page.getByLabel('Search academic people').fill('TEST-BBA-2026-001');await page.getByText('1 matching students',{exact:false}).waitFor();await page.getByRole('button',{name:'View student profile',exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByText('Admission 2026',{exact:false}).waitFor();await page.getByRole('button',{name:'Close dialog',exact:true}).click();
   await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/anits-students-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  assert.equal(await page.getByText(/Unexpected token|Unexpected end of JSON|invalid JSON response/).count(),0);
  await context.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS: seven browser logins, role dashboards, program configuration, teacher assignment, student filtering/pagination/profile, mobile layout; no page errors.');
}finally{await browser.close();await new Promise(r=>server.close(r));db.close();}
