import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {fixture,chromiumPath} from './ui-fixture.mjs';
const f=await fixture(),browser=await chromium.launch({headless:true,executablePath:chromiumPath()});
const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);
try{
 for(const [route,heading] of [['privacy','Privacy notice'],['terms','Terms of use'],['forgot-password','Reset your password'],['missing-page','This page isn’t here.']]){
  await page.goto(f.base+'/#'+route);await page.getByRole('heading',{name:heading,exact:true}).waitFor();
 }
 await page.goto(f.base+'/#access');await page.getByLabel('Institutional email').fill('admin@redesign.invalid');await page.getByLabel('Password',{exact:true}).fill(f.password);await page.getByRole('button',{name:'Sign in to FactX',exact:true}).click();
 await page.getByRole('region',{name:'Getting started'}).waitFor();await page.getByRole('button',{name:'Finish getting started'}).click();
 await page.getByRole('button',{name:'My profile',exact:true}).click();await page.getByRole('heading',{name:'Account security'}).waitFor();await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 await page.evaluate(()=>{location.hash='settings';});await page.getByRole('heading',{name:'Operations and privacy'}).waitFor();
 await page.evaluate(()=>{location.hash='grades';});await page.getByRole('button',{name:'Bulk marks entry',exact:true}).click();
 let dialog=page.getByRole('dialog');await dialog.getByLabel('Subject',{exact:true}).selectOption(f.subject.id);await dialog.getByLabel('Evaluation title').fill('Bulk browser marks');await dialog.getByLabel('Evaluation type').selectOption('mid_term');await dialog.getByLabel('Semester',{exact:true}).fill('3');await dialog.getByLabel('Maximum marks').fill('20');await dialog.getByLabel('Roll number, score (one student per line)').fill('SYNTHETIC-001, 17');await dialog.getByRole('button',{name:'Publish all marks'}).click();
 await page.getByRole('cell',{name:'Bulk browser marks',exact:true}).waitFor();await page.getByRole('button',{name:'Edit marks',exact:true}).click();
 dialog=page.getByRole('dialog');await dialog.getByLabel('Score',{exact:true}).fill('19');await dialog.getByRole('button',{name:'Save correction'}).click();await page.getByRole('cell',{name:'19 / 20',exact:true}).waitFor();
 await page.setViewportSize({width:360,height:800});mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/completion-marks-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.goto(f.base+'/#privacy');await page.getByRole('heading',{name:'Privacy notice',exact:true}).waitFor();await page.screenshot({path:'test-results/completion-privacy-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
 console.log('PASS: public pages, landing anchors, onboarding, account controls, operations, bulk marks, corrections and mobile layout.');
}finally{await browser.close();await f.close();}
