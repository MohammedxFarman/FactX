import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {fixture,chromiumPath} from './ui-fixture.mjs';

const test=await fixture();
const browser=await chromium.launch({headless:true,executablePath:chromiumPath()});
const page=await browser.newPage({reducedMotion:'reduce'});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
mkdirSync('test-results',{recursive:true});
const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
try{
  for(const setup of [false,true]){
    if(setup)await page.route('**/api/auth/status',route=>route.fulfill({json:{authenticated:false,needsSetup:true}}));
    for(const [width,height] of [[1440,900],[1024,768],[768,900],[390,844],[320,568],[1280,600]]){
      await page.setViewportSize({width,height});
      await page.goto(test.base);
      await page.getByRole('heading',{name:setup?'Make it your workspace.':'Welcome back.'}).waitFor();
      await page.locator('.fx-landing-nav').getByRole('link',{name:'Sign in'}).click();
      await page.waitForFunction(()=>Math.abs(document.querySelector('#access').getBoundingClientRect().top-100)<2);
      await noOverflow();
      const geometry=await page.evaluate(()=>{
        const box=selector=>document.querySelector(selector).getBoundingClientRect().toJSON();
        return {header:box('.fx-landing-nav'),shell:box('.auth-shell'),panel:box('.auth-panel'),form:box('.auth-form'),top:box('.auth-top'),bottom:box('.auth-bottom')};
      });
      const {header,shell,panel,form,top,bottom}=geometry;
      assert.ok(shell.top>=header.bottom,'Header must not overlap authentication');
      assert.ok(Math.abs(form.x+form.width/2-(panel.x+panel.width/2))<2,'Form centered in its panel');
      assert.ok(form.top>=top.bottom&&form.bottom<=bottom.top,'Form stays between panel header and footer');
      assert.ok(Math.abs((form.top-top.bottom)-(bottom.top-form.bottom))<2,'Form vertically centered in available panel space');
      if(width<=800)assert.ok(Math.abs(panel.width-shell.width)<2,'Mobile/tablet form uses the full column');
      else assert.ok(Math.abs(panel.width-shell.width/2)<2,'Desktop preserves two columns');
      if([1440,768,390].includes(width))await page.screenshot({path:`test-results/auth-${setup?'setup':'login'}-${width}.png`,fullPage:false});
      for(const input of await page.locator('.auth-form input').all()){
        await input.scrollIntoViewIfNeeded();
        assert.ok(await input.isVisible());
      }
      const submit=page.getByRole('button',{name:setup?'Create your workspace':'Sign in to FactX',exact:true});
      await submit.evaluate(element=>element.scrollIntoView({block:'center',behavior:'instant'}));
      const button=await submit.boundingBox();
      assert.ok(button.y>=0&&button.y+button.height<=height,'Submit is reachable by scrolling');
    }
    if(setup)await page.unroute('**/api/auth/status');
  }
  await page.setViewportSize({width:1440,height:900});
  await page.goto(test.base+'/#access');
  await page.reload();
  await page.getByLabel('Institutional email').fill('admin@redesign.invalid');
  await page.getByLabel('Password',{exact:true}).fill(test.password);
  await page.getByRole('button',{name:'Show password'}).click();
  assert.equal(await page.getByLabel('Password',{exact:true}).getAttribute('type'),'text');
  await page.getByRole('button',{name:'Hide password'}).click();
  await page.getByRole('button',{name:'Sign in to FactX',exact:true}).click();
  await page.locator('.sidebar').waitFor();
  await page.getByRole('heading',{name:/Good (morning|afternoon|evening), Design/}).waitFor();
  const groups=page.locator('.sidebar .nav-group');
  assert.ok(await groups.count()>1);
  assert.equal(await page.locator('.nav-item .nav-chevron').count(),0,'Leaf routes have no chevrons');
  const checkGroups=async()=>{
    for(const group of await groups.all()){
      const summary=group.locator('summary');
      assert.equal(await summary.locator('.nav-chevron').count(),1);
      const wasOpen=await group.evaluate(element=>element.open);
      await summary.click();
      assert.equal(await group.evaluate(element=>element.open),!wasOpen);
      await summary.focus();
      await page.keyboard.press('Enter');
      assert.equal(await group.evaluate(element=>element.open),wasOpen);
      const arrow=await summary.locator('svg').evaluate(element=>getComputedStyle(element).transform);
      assert.equal(arrow,wasOpen?'matrix(0, 1, -1, 0, 0, 0)':'none');
    }
  };
  await checkGroups();
  await page.getByRole('button',{name:'Switch to dark mode'}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  await checkGroups();
  await page.locator('.sidebar nav').evaluate(element=>{element.scrollTop=0;});
  await page.screenshot({path:'test-results/sidebar-dark.png'});
  await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();
  await checkGroups();
  for(const width of [768,390]){
    await page.setViewportSize({width,height:900});
    await page.getByRole('button',{name:'Open navigation',exact:true}).click();
    await checkGroups();
    const learning=groups.filter({has:page.getByRole('button',{name:'Academics',exact:true,includeHidden:true})});
    if(!await learning.evaluate(element=>element.open))await learning.locator('summary').click();
    await learning.getByRole('button',{name:'Academics',exact:true}).click();
    await page.waitForFunction(()=>location.hash==='#academics');
    assert.ok(await page.locator('.nav-item.active').getAttribute('aria-label')==='Academics');
    assert.equal(await page.locator('.sidebar').evaluate(element=>element.classList.contains('open')),false);
    await noOverflow();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: login/setup geometry at six viewport sizes, scrolling, real login, submenu mouse/keyboard toggles, themes, collapsed sidebar and mobile navigation.');
}finally{
  await browser.close();
  await test.close();
}
