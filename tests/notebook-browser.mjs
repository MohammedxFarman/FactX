import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {fixture,chromiumPath} from './ui-fixture.mjs';

const f=await fixture();
delete process.env.JUDGE_URL;
const browser=await chromium.launch({headless:true,executablePath:chromiumPath()});
try {
  const activity=(await f.request('/activities',{title:'ML Lab',kind:'lab',class_id:f.classroom.id,subject_id:f.subject.id,
    max_marks:10,config:{language:'python',testCases:[{input:'',output:'1'}]}},f.admin)).data;
  const assignment=(await f.request('/activities',{title:'ML task 1',kind:'assignment',class_id:f.classroom.id,subject_id:f.subject.id,config:{}},f.admin)).data;
  const page=await browser.newPage();
  await page.goto(f.base+'/#access');
  await page.getByLabel('Institutional email').fill('student@redesign.invalid');
  await page.getByLabel('Password',{exact:true}).fill(f.password);
  await page.getByRole('button',{name:'Sign in to FactX'}).click();
  await page.getByRole('heading',{name:'Quick Access'}).waitFor();
  await page.evaluate(()=>{location.hash='labs';});
  await page.getByRole('button',{name:'Open ML Lab',exact:true}).click();
  await page.getByRole('button',{name:'Begin notebook assessment'}).click();
  if(process.env.TEST_NOTEBOOK_PACKAGES){
    await page.getByLabel('Python cell 2').fill('%pip install numpy\nimport numpy as np\nprint(np.arange(3).sum())');
    await page.getByRole('button',{name:'Run cell',exact:true}).click();
    await page.locator('.fx-notebook .fx-sample pre').first().waitFor({timeout:90000});
    assert.equal((await page.locator('.fx-notebook .fx-sample pre').last().innerText()).trim().split('\n').at(-1),'3');
  }
  await page.getByLabel('Python cell 2').fill('x = 41');
  await page.getByRole('button',{name:'Run cell',exact:true}).click();
  await page.getByRole('button',{name:'Add code cell'}).click();
  await page.getByLabel('Python cell 3').fill('print(x + 1)');
  await page.getByRole('button',{name:'Run cell',exact:true}).last().click();
  await page.getByText('42',{exact:true}).waitFor();
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Close lab workspace'}).click();
  await page.getByRole('button',{name:'Open ML Lab',exact:true}).click();
  await page.getByText('42',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Submit notebook'}).click();
  await page.getByText('View submitted notebook').click();
  const row=f.db.prepare('SELECT content,status FROM submissions WHERE activity_id=?').get(activity.id);
  assert.equal(JSON.parse(row.content).cells[2].outputs[0].text,'42\n');
  assert.equal(row.status,'submitted');
  await page.getByRole('button',{name:'Close lab workspace'}).click();
  await page.evaluate(()=>{location.hash='assessments';});
  await page.getByRole('button',{name:'Open ML task 1'}).click();
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Begin notebook assessment'}).click();
  await page.getByLabel('Import .ipynb or .py').setInputFiles({name:'solution.py',mimeType:'text/plain',buffer:Buffer.from('print(7)')});
  await page.getByRole('button',{name:'Run cell',exact:true}).click();
  await page.getByText('7',{exact:true}).waitFor();
  page.once('dialog',dialog=>dialog.dismiss());
  await page.evaluate(()=>history.back());
  await page.getByRole('button',{name:'Submit notebook'}).click();
  await page.getByText('View submitted notebook').waitFor();
  assert.equal(page.context().pages().length,1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.equal(f.db.prepare('SELECT status FROM submissions WHERE activity_id=?').get(assignment.id).status,'submitted');
  console.log('PASS: in-app Python, shared cell state, notebook and script submission, mobile ML assignment and back protection.');
} finally {await browser.close();await f.close();}
