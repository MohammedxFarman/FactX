import lighthouse from 'lighthouse';
import {launch} from 'chrome-launcher';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fixture,chromiumPath} from './ui-fixture.mjs';
const f=await fixture();const chrome=await launch({chromePath:chromiumPath(),chromeFlags:['--headless','--no-sandbox','--disable-dev-shm-usage']});mkdirSync('test-results',{recursive:true});
try{
 const summary={};
 for(const mode of ['desktop','mobile']){
  const result=await lighthouse(f.base,{port:chrome.port,output:'json',logLevel:'error',onlyCategories:['performance','accessibility','best-practices','seo'],...(mode==='desktop'?{formFactor:'desktop',screenEmulation:{mobile:false,width:1440,height:1000,deviceScaleFactor:1,disabled:false},throttling:{rttMs:40,throughputKbps:10240,cpuSlowdownMultiplier:1}}:{})});
  writeFileSync(`test-results/lighthouse-${mode}.json`,result.report);
  summary[mode]={scores:Object.fromEntries(Object.entries(result.lhr.categories).map(([k,v])=>[k,Math.round(v.score*100)])),LCP_ms:result.lhr.audits['largest-contentful-paint'].numericValue,CLS:result.lhr.audits['cumulative-layout-shift'].numericValue,TBT_ms:result.lhr.audits['total-blocking-time'].numericValue,INP:'Requires field or interaction measurement; navigation Lighthouse does not measure INP.'};
 }
 writeFileSync('test-results/performance-summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
}finally{await chrome.kill();await f.close();}
