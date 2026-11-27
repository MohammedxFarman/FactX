import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {fixture,chromiumPath} from './ui-fixture.mjs';

const f=await fixture();
delete process.env.JUDGE_URL;
const browser=await chromium.launch({headless:true,executablePath:chromiumPath()});
try {
  const activity=(await f.request('/activities',{title:'ML Lab',kind:'lab',class_id:f.classroom.id,subject_id:f.subject.id,
    max_marks:10,config:{language:'python',testCases:[{input:'',output:'1'}]}},f.admin)).data;
  const page=await browser.newPage();
  await page.goto(f.base+'/#access');
  await page.getByLabel('Institutional email').fill('student@redesign.invalid');
  await page.getByLabel('Password',{exact:true}).fill(f.password);
  await page.getByRole('button',{name:'Sign in to FactX'}).click();
  await page.getByRole('heading',{name:'Quick Access'}).waitFor();
  await page.evaluate(()=>{location.hash='labs';});
  await page.getByRole('button',{name:'Open ML Lab',exact:true}).click();
  assert.equal(await page.getByRole('link',{name:'Open Jupyter'}).getAttribute('href'),'https://jupyter.org/try-jupyter/lab/index.html');
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download starter notebook'}).click();
  const reader=await (await download).createReadStream();
  const chunks=[];for await(const chunk of reader)chunks.push(chunk);
  const notebook=JSON.parse(Buffer.concat(chunks));
  notebook.cells[1].source='print(1)';
  await page.getByRole('button',{name:'Begin notebook assessment'}).click();
  await page.getByLabel('Completed notebook').setInputFiles({name:'solution.ipynb',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(notebook))});
  await page.getByRole('button',{name:'Submit notebook'}).click();
  await page.getByRole('button',{name:'Download submitted notebook'}).waitFor();
  const row=f.db.prepare('SELECT content,status,score FROM submissions WHERE activity_id=?').get(activity.id);
  assert.deepEqual(JSON.parse(row.content),notebook);
  assert.equal(row.status,'submitted');
  assert.equal(row.score,null);
  console.log('PASS: ML notebook launch, starter download and submission for faculty review.');
} finally {await browser.close();await f.close();}
