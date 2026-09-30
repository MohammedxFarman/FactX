import { chromium } from '@playwright/test';
import { mkdtempSync, mkdirSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';

const dir=mkdtempSync(path.join(tmpdir(),'factx-workflow-ui-'));
const {app,db}=createApp({dataDir:dir,setupToken:'workflow-browser-token'});
const server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener))});
const base=`http://127.0.0.1:${server.address().port}`,password='Workflow-browser-password-2026';
const sessionDate=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
const browserRoot=path.join(homedir(),'AppData','Local','ms-playwright');
const candidates=existsSync(browserRoot)?readdirSync(browserRoot).filter(name=>/^chromium-\d+$/.test(name)).flatMap(name=>['chrome-win64/chrome.exe','chrome-win/chrome.exe'].map(exe=>path.join(browserRoot,name,exe))):[];
const executablePath=candidates.find(file=>existsSync(file));
let browser;
const errors=[],contexts=[];
mkdirSync('test-results',{recursive:true});

async function request(route,{body,method='GET',cookie}={}) {
  const response=await fetch(base+'/api'+route,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
  const data=await response.json();assert.ok(response.ok,JSON.stringify({route,data}));
  return {data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function go(page,name,endpoint) {
  if(await page.getByRole('button',{name:'Open navigation'}).isVisible())await page.getByRole('button',{name:'Open navigation'}).click();
  await Promise.all([
    page.waitForResponse(response=>response.url()===base+'/api/'+endpoint&&response.ok()),
    page.locator('aside').getByRole('button',{name,exact:true}).click(),
  ]);
  if(name==='Overview')await page.getByText('Database connected',{exact:false}).waitFor();
  else await page.getByRole('heading',{name,exact:true}).waitFor();
}
async function signIn(key) {
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});contexts.push(context);
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(`${key}: ${error.message}`));
  page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('401 (Unauthorized)'))errors.push(`${key}: ${message.text()}`)});
  await page.goto(base);await page.getByLabel('Institutional email').fill(`${key}@workflow-ui.test`);
  await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Sign in to FactX'}).click();
  await page.getByText('Database connected',{exact:false}).waitFor();return page;
}
async function applyLeave(page,reason,date=sessionDate) {
  await page.getByRole('button',{name:'Apply for leave',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Apply for leave'});
  await dialog.getByLabel('Starts on').fill(date);await dialog.getByLabel('Ends on').fill(date);
  await dialog.getByLabel('Reason',{exact:true}).fill(reason);await dialog.getByRole('button',{name:'Send leave request'}).click();
  await dialog.waitFor({state:'hidden'});await page.getByRole('cell',{name:reason,exact:true}).waitFor();
}
async function decision(page,status,note) {
  await page.getByRole('button',{name:'Review request',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Review leave request'});
  await dialog.getByLabel('Decision',{exact:true}).selectOption(status);await dialog.getByLabel('Review note').fill(note);
  await dialog.getByRole('button',{name:'Save decision'}).click();await dialog.waitFor({state:'hidden'});
}
try {
  const admin=(await request('/auth/setup',{method:'POST',body:{name:'Workflow Administrator',email:'admin@workflow-ui.test',password,token:'workflow-browser-token'}})).cookie;
  const post=async(route,body)=>(await request(route,{method:'POST',body,cookie:admin})).data;
  const department=await post('/departments',{name:'Workflow department',code:'WFUI'});
  const classroom=await post('/classes',{name:'Workflow class',department_id:department.id,semester:1});
  const subject=await post('/subjects',{name:'Workflow subject',code:'WFUI-S',department_id:department.id});
  const users={};
  for(const[key,role,name]of [['hod','HOD','Department Head'],['faculty','FACULTY','Course Faculty'],['cover','FACULTY','Cover Faculty'],['student','STUDENT','Class Student']]) {
    users[key]=await post('/users',{name,email:`${key}@workflow-ui.test`,password,role,department_id:department.id,...(role==='STUDENT'?{class_id:classroom.id,roll_number:'WFUI-001'}:{})});
  }
  const assignment=await post('/teaching-assignments',{faculty_id:users.faculty.id,class_id:classroom.id,subject_id:subject.id});
  await post('/timetable',{faculty_id:users.faculty.id,class_id:classroom.id,subject_id:subject.id,day_of_week:new Date(sessionDate+'T12:00:00Z').getUTCDay(),start_time:'09:00',end_time:'10:00',room:'Workflow room'});
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  const faculty=await signIn('faculty');
  await go(faculty,'Leave & student approvals','leave');await applyLeave(faculty,'Faculty workflow verification');
  const hod=await signIn('hod');await go(hod,'Leave approvals','leave');
  await hod.getByRole('cell',{name:'Faculty workflow verification',exact:true}).waitFor();
  await decision(hod,'approved','Arrange teaching cover');
  const coverage=hod.getByRole('dialog',{name:'Teaching cover'});await coverage.waitFor();
  await coverage.getByRole('combobox').selectOption({label:'Cover Faculty'});
  await coverage.getByRole('button',{name:'Assign substitute',exact:true}).click();
  await coverage.locator('.coverage-session p').filter({hasText:'Cover Faculty'}).waitFor();
  await hod.screenshot({path:'test-results/workflow-hod-substitution.png',fullPage:true});
  await coverage.getByRole('button',{name:'Close dialog'}).click();
  const cover=await signIn('cover');await go(cover,'Substitution duties','substitutions');
  await cover.getByRole('cell',{name:'Workflow subject',exact:true}).waitFor();
  await cover.getByRole('cell',{name:sessionDate,exact:true}).waitFor();
  const student=await signIn('student');await go(student,'Class changes','substitutions');
  await student.getByRole('cell',{name:'Cover Faculty',exact:true}).waitFor();
  await go(student,'Leave requests','leave');await applyLeave(student,'Student workflow verification');
  await go(faculty,'Overview','dashboard');await go(faculty,'Leave & student approvals','leave');
  await faculty.getByRole('button',{name:'Student requests',exact:true}).click();
  await faculty.getByRole('cell',{name:'Student workflow verification',exact:true}).waitFor();
  await decision(faculty,'rejected','Discuss the missed class before resubmitting');
  await faculty.getByRole('cell',{name:'Declined',exact:true}).waitFor();
  await go(student,'Overview','dashboard');await go(student,'Leave requests','leave');
  await student.getByRole('cell',{name:'Declined',exact:true}).waitFor();
  await student.getByRole('cell',{name:'Course Faculty',exact:true}).waitFor();
  await student.getByRole('button',{name:'Details',exact:true}).click();
  await student.getByText('Discuss the missed class before resubmitting',{exact:false}).waitFor();
  await student.getByText('Supporting documents',{exact:true}).waitFor();
  await student.getByRole('button',{name:'Close dialog'}).click();
  await go(faculty,'Syllabus progress','syllabus');
  await faculty.getByRole('button',{name:'Add syllabus topic',exact:true}).click();
  const syllabus=faculty.getByRole('dialog',{name:'Add syllabus topic'});
  await syllabus.getByLabel('Teaching assignment').selectOption(assignment.id);
  await syllabus.getByLabel('Topic',{exact:true}).fill('Completed workflow unit');
  await syllabus.getByLabel('Planned hours').fill('4');await syllabus.getByLabel('Progress',{exact:true}).selectOption('completed');
  await syllabus.getByLabel('Teaching note').fill('Verified completed course topic');
  await syllabus.getByRole('button',{name:'Save syllabus progress'}).click();await syllabus.waitFor({state:'hidden'});
  await faculty.getByText('Completed workflow unit',{exact:true}).waitFor();
  const attendance=await faculty.request.post(base+'/api/attendance',{data:{class_id:classroom.id,subject_id:subject.id,date:new Date().toISOString().slice(0,10),period:1,records:[{student_id:users.student.id,status:'present'}]}});
  assert.ok(attendance.ok(),await attendance.text());
  const mark=await faculty.request.post(base+'/api/marks',{data:{student_id:users.student.id,subject_id:subject.id,title:'Workflow recorded marks',kind:'internal',semester:1,score:80,max_marks:100}});
  assert.ok(mark.ok(),await mark.text());
  await go(hod,'Faculty syllabus progress','syllabus');
  await hod.getByText('Completed workflow unit',{exact:true}).waitFor();
  assert.equal(await hod.getByRole('button',{name:'Add syllabus topic',exact:true}).count(),0);
  assert.equal(await hod.getByRole('button',{name:'Update progress',exact:true}).count(),0);
  await go(hod,'Branch monitoring','academic-monitoring');
  const course=hod.getByRole('row').filter({has:hod.getByRole('cell',{name:'Workflow subject',exact:true})});
  await course.getByRole('cell',{name:'80%',exact:true}).waitFor();
  assert.equal(await course.getByRole('cell',{name:'100%',exact:true}).count(),2);
  assert.equal(await hod.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Desktop monitoring must not overflow');
  await hod.screenshot({path:'test-results/workflow-hod-monitoring.png',fullPage:true});
  await hod.setViewportSize({width:390,height:844});
  await hod.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=1);
  assert.equal(await hod.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Mobile monitoring must not overflow');
  await hod.screenshot({path:'test-results/workflow-hod-monitoring-mobile.png',fullPage:true});
  await go(hod,'Faculty syllabus progress','syllabus');
  assert.equal(await hod.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Mobile syllabus must not overflow');
  await faculty.setViewportSize({width:390,height:844});await go(faculty,'Leave & student approvals','leave');
  assert.equal(await faculty.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Mobile faculty leave must not overflow');
  await faculty.screenshot({path:'test-results/workflow-faculty-leave-mobile.png',fullPage:true});
  const adminPage=await signIn('admin');await go(adminPage,'Academic monitoring','academic-monitoring');
  await adminPage.getByRole('heading',{name:'Faculty teaching overview',exact:true}).waitFor();

  // Exercise the three approved upgrades with this temporary workspace only.
  const today=new Date().toISOString().slice(0,10),yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
  await applyLeave(faculty,'Today cover attendance verification',today);
  await go(hod,'Workflow inbox','inbox');
  const pendingLeave=hod.locator('.inbox-item').filter({has:hod.getByRole('heading',{name:'Review faculty leave',exact:true})});
  await pendingLeave.getByRole('button',{name:'Review request',exact:true}).click();
  let review=hod.getByRole('dialog',{name:'Review leave request'});await review.waitFor();
  await review.getByLabel('Decision',{exact:true}).selectOption('approved');await review.getByRole('button',{name:'Save decision'}).click();
  const todayCover=hod.getByRole('dialog',{name:'Teaching cover'});await todayCover.waitFor();
  await todayCover.getByRole('combobox').selectOption({label:'Cover Faculty'});await todayCover.getByRole('button',{name:'Assign substitute',exact:true}).click();
  await todayCover.locator('.coverage-session p').filter({hasText:'Cover Faculty'}).waitFor();
  await todayCover.getByRole('button',{name:'Close dialog'}).click();
  await go(cover,'Workflow inbox','inbox');
  const attendanceItem=cover.locator('.inbox-item').filter({has:cover.getByRole('heading',{name:'Substitution attendance is due',exact:true})});
  await attendanceItem.getByRole('button',{name:'Open attendance',exact:true}).click();
  const attendanceDialog=cover.getByRole('dialog',{name:'Substitution attendance'});await attendanceDialog.waitFor();
  await attendanceDialog.getByLabel('Class Student attendance').selectOption('absent');
  await attendanceDialog.getByRole('button',{name:'Save session attendance'}).click();await attendanceDialog.waitFor({state:'hidden'});
  const todayRow=cover.getByRole('row').filter({has:cover.getByRole('cell',{name:today,exact:true})});await todayRow.getByText('Recorded',{exact:true}).waitFor();
  await go(student,'Attendance','attendance');await student.getByText('Absent',{exact:true}).waitFor();
  await go(hod,'Branch monitoring','academic-monitoring');
  await hod.getByRole('row').filter({has:hod.getByRole('cell',{name:'Workflow subject',exact:true})}).getByRole('cell',{name:'0%',exact:true}).waitFor();
  await go(faculty,'Support plans','support-plans');await faculty.getByRole('button',{name:'Create support plan',exact:true}).click();
  const planForm=faculty.getByRole('dialog',{name:'Create support plan'});
  await planForm.getByLabel('Student',{exact:true}).selectOption(users.student.id);
  await planForm.getByLabel('Subject',{exact:true}).selectOption(subject.id);
  await planForm.getByLabel('Plan title').fill('Connected practice follow-up');
  await planForm.getByLabel('Focus',{exact:true}).selectOption('subject');
  await planForm.getByLabel('Plan deadline').fill(today);
  await planForm.getByLabel('Goal',{exact:true}).fill('Explain the practice exercise with faculty feedback.');
  await planForm.getByLabel('First task').fill('Explain the practice exercise');
  await planForm.getByLabel('Task deadline').fill(yesterday);
  await planForm.getByRole('button',{name:'Save support plan',exact:true}).click();
  let planDialog=faculty.getByRole('dialog',{name:'Student support plan'});await planDialog.waitFor();
  await planDialog.getByRole('heading',{name:'Connected practice follow-up',exact:true}).waitFor();
  assert.equal(await faculty.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Mobile support plan must not overflow');
  await faculty.screenshot({path:'test-results/workflow-support-plan-mobile.png',fullPage:true});
  await planDialog.getByRole('button',{name:'Close dialog'}).click();
  await go(hod,'Support plans','support-plans');await hod.getByRole('button',{name:'View plan',exact:true}).click();
  const hodPlan=hod.getByRole('dialog',{name:'Student support plan'});await hodPlan.waitFor();
  assert.equal(await hodPlan.getByRole('button',{name:'Review progress',exact:true}).count(),0,'HOD monitors; faculty reviews student progress');
  await hodPlan.getByRole('button',{name:'Close dialog'}).click();
  await go(student,'Workflow inbox','inbox');
  const supportItem=student.locator('.inbox-item').filter({hasText:'Connected practice follow-up'});
  await supportItem.getByRole('button',{name:'Update progress',exact:true}).click();
  let studentPlan=student.getByRole('dialog',{name:'Student support plan'});await studentPlan.waitFor();
  await studentPlan.getByRole('button',{name:'Update progress',exact:true}).click();
  const studentProgress=student.getByRole('dialog',{name:'Update support progress'});
  await studentProgress.getByLabel('Your progress').fill('Completed the practice exercise and explained each step.');
  await studentProgress.getByRole('button',{name:'Send progress update'}).click();
  studentPlan=student.getByRole('dialog',{name:'Student support plan'});await studentPlan.getByText('Awaiting faculty review',{exact:true}).waitFor();
  await studentPlan.getByRole('button',{name:'Close dialog'}).click();
  await go(faculty,'Workflow inbox','inbox');
  const reviewItem=faculty.locator('.inbox-item').filter({has:faculty.getByRole('heading',{name:'Student progress awaits your review',exact:true})});
  await reviewItem.getByRole('button',{name:'Review progress',exact:true}).click();
  planDialog=faculty.getByRole('dialog',{name:'Student support plan'});await planDialog.getByRole('button',{name:'Review progress',exact:true}).click();
  review=faculty.getByRole('dialog',{name:'Review support progress'});
  await review.getByLabel('Faculty feedback').fill('Reviewed the explanation and accepted the completed practice.');
  await review.getByRole('button',{name:'Save progress review'}).click();
  planDialog=faculty.getByRole('dialog',{name:'Student support plan'});await planDialog.getByRole('button',{name:'Complete plan',exact:true}).click();
  const closure=faculty.getByRole('dialog',{name:'Complete support plan'});
  await closure.getByLabel('Closure note').fill('Student practice follow-up completed.');
  await closure.getByRole('button',{name:'Complete support plan',exact:true}).click();
  planDialog=faculty.getByRole('dialog',{name:'Student support plan'});await planDialog.getByText('Student practice follow-up completed.',{exact:true}).waitFor();
  await planDialog.getByRole('button',{name:'Close dialog'}).click();
  for(const [page,label]of [[hod,'Support plans'],[adminPage,'Support plans'],[student,'My support plans']]) {
    await go(page,label,'support-plans');await page.getByRole('button',{name:'Completed',exact:true}).click();
    await page.getByRole('cell',{name:'Connected practice follow-up',exact:true}).waitFor();
    await page.getByRole('button',{name:'View plan',exact:true}).click();
    const detail=page.getByRole('dialog',{name:'Student support plan'});
    await detail.getByText('Reviewed the explanation and accepted the completed practice.',{exact:false}).first().waitFor();
    await detail.getByRole('button',{name:'Close dialog'}).click();
  }
  await go(faculty,'Workflow inbox','inbox');assert.equal(await faculty.locator('.inbox-item').filter({hasText:'Connected practice follow-up'}).count(),0);
  assert.equal(await faculty.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Mobile inbox must not overflow');
  await faculty.screenshot({path:'test-results/workflow-inbox-mobile.png',fullPage:true});
  await cover.setViewportSize({width:390,height:844});await go(cover,'Substitution duties','substitutions');
  assert.equal(await cover.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Mobile substitution duties must not overflow');
  await cover.screenshot({path:'test-results/workflow-substitution-attendance-mobile.png',fullPage:true});
  assert.deepEqual(errors,[],'Workflow pages must not produce browser errors');
  console.log('PASS: leave → HOD → cover → session attendance → student/branch records; student leave decisions; syllabus monitoring; role inbox links/reminders; faculty → student support progress → faculty review → HOD/Admin oversight; desktop/mobile; no browser errors.');
} catch(error) {
  await Promise.allSettled(contexts.flatMap((context,index)=>context.pages().map(page=>page.screenshot({path:`test-results/workflow-failure-${index}.png`,fullPage:true}))));
  throw error;
} finally {
  await Promise.allSettled(contexts.map(context=>context.close()));
  if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));db.close();
  const resolved=path.resolve(dir),temporaryRoot=path.resolve(tmpdir())+path.sep;
  assert.ok(resolved.startsWith(temporaryRoot)&&path.basename(resolved).startsWith('factx-workflow-ui-'));
  rmSync(resolved,{recursive:true,force:true});
}
