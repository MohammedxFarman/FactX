import {mkdtempSync,mkdirSync,copyFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('../',import.meta.url));
const desktop=path.join(root,'desktop');
// Stage outside OneDrive: synced directories can lock Electron's unpack/rename.
const staging=mkdtempSync(path.join(tmpdir(),'factx-package-'));
const result=spawnSync(process.execPath,[path.join(desktop,'node_modules/electron-builder/cli.js'),'--win','zip','--x64',`--config.directories.output=${staging}`],{cwd:desktop,stdio:'inherit',windowsHide:true});
if(result.error)throw result.error;
if(result.status!==0)process.exit(result.status||1);
const require=createRequire(path.join(desktop,'package.json'));
const allowed=new Set(['main.cjs','package.json','policy.cjs','preload.cjs','setup.css','setup.html','setup.js']);
for(const entry of require('@electron/asar').listPackage(path.join(staging,'win-unpacked/resources/app.asar'))){
 if(!allowed.has(entry.replace(/^[\\/]/,'')))throw new Error(`Unexpected packaged content: ${entry}`);
}
const {version}=JSON.parse(readFileSync(path.join(desktop,'package.json'),'utf8'));
const filename=`FactX-${version}-Windows-x64.zip`;
mkdirSync(path.join(root,'release'),{recursive:true});
copyFileSync(path.join(staging,filename),path.join(root,'release',filename));
console.log(`Portable app: ${path.join(root,'release',filename)}`);
console.log(`Retained build staging for packaged smoke tests: ${staging}`);
