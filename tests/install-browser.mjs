import {chromium,_electron} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fixture,chromiumPath} from './ui-fixture.mjs';
const f=await fixture(),browser=await chromium.launch({headless:true,executablePath:chromiumPath()});
let desktop;
const directory=mkdtempSync(path.join(tmpdir(),'factx-desktop-test-'));
try{
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
 await page.goto(f.base);
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
 await page.reload();
 assert.ok(await page.evaluate(()=>!!navigator.serviceWorker.controller));
 const manifest=await (await context.request.get(f.base+'/manifest.webmanifest')).json();
 assert.equal(manifest.display,'standalone');
 for(const icon of manifest.icons){const response=await context.request.get(f.base+icon.src);assert.equal(response.status(),200);assert.match(response.headers()['content-type'],/image\/png/);}
 await page.getByLabel('Institutional email').fill('student@redesign.invalid');
 await page.getByLabel('Password',{exact:true}).fill(f.password);
 await page.getByRole('button',{name:'Sign in to FactX'}).click();
 await page.getByRole('button',{name:'Install FactX',exact:true}).click();
 await page.getByRole('dialog',{name:'Install FactX'}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 const cached=await page.evaluate(async()=>{const keys=await caches.keys();return (await Promise.all(keys.map(async key=>(await (await caches.open(key)).keys()).map(r=>new URL(r.url).pathname)))).flat();});
 assert.deepEqual(cached,['/offline.html']);
 await context.setOffline(true);await page.reload();await page.getByRole('heading',{name:'You’re offline'}).waitFor();
 assert.equal(await page.evaluate(async()=>{try{await fetch('/api/auth/me');return true;}catch{return false;}}),false,'API must not be served offline');
 await context.setOffline(false);await page.getByRole('link',{name:'Try again'}).click();await page.getByRole('button',{name:'Install FactX',exact:true}).waitFor();
 desktop=await _electron.launch({executablePath:path.resolve(process.env.FACTX_DESKTOP_EXECUTABLE||'desktop/node_modules/electron/dist/electron.exe'),args:process.env.FACTX_DESKTOP_EXECUTABLE?[]:[path.resolve('desktop')],env:{...process.env,FACTX_DESKTOP_TEST_DATA:directory,FACTX_DESKTOP_TEST_HIDDEN:'1'}});
 const setup=await desktop.firstWindow();await setup.getByLabel('Institution server address').fill('http://example.com');await setup.getByRole('button',{name:'Connect to FactX'}).click();await setup.getByRole('status').filter({hasText:'Use HTTPS'}).waitFor();
 const loaded=desktop.waitForEvent('window');await setup.getByLabel('Institution server address').fill(f.base);await setup.getByRole('button',{name:'Connect to FactX'}).click();const workspace=await loaded;await workspace.getByLabel('Institutional email').waitFor();
 assert.deepEqual(await workspace.evaluate(()=>({node:typeof window.require,bridge:typeof window.factxSetup})),{node:'undefined',bridge:'undefined'});
 const preferences=await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().startsWith('file:')).webContents.getLastWebPreferences());
 assert.equal(preferences.sandbox,true);assert.equal(preferences.contextIsolation,true);assert.equal(preferences.nodeIntegration,false);
 await workspace.getByLabel('Institutional email').fill('student@redesign.invalid');await workspace.getByLabel('Password',{exact:true}).fill(f.password);await workspace.getByRole('button',{name:'Sign in to FactX'}).click();await workspace.getByText('Database connected',{exact:false}).waitFor();
 await workspace.evaluate(()=>{location.href='https://example.com';});assert.ok(workspace.url().startsWith(f.base));
 console.log('Phone installation, private-cache policy, offline recovery and isolated Windows client passed.');
}finally{
 if(desktop)await desktop.close();await browser.close();await f.close();
 const target=path.resolve(directory);assert.ok(target.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(target).startsWith('factx-desktop-test-'),'Unexpected test directory');
 rmSync(target,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
