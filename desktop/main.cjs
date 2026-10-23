const {app,BrowserWindow,ipcMain,Menu,dialog,session}=require('electron');
const {readFileSync,writeFileSync}=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {serverOrigin,sameOrigin}=require('./policy.cjs');
if(process.env.FACTX_DESKTOP_TEST_DATA)app.setPath('userData',process.env.FACTX_DESKTOP_TEST_DATA);
app.enableSandbox();
let setupWindow,workspace;
const setupUrl=pathToFileURL(path.join(__dirname,'setup.html')).href;
const visible=process.env.FACTX_DESKTOP_TEST_HIDDEN!=='1';
const configFile=()=>path.join(app.getPath('userData'),'server.json');
function savedOrigin(){try{return serverOrigin(JSON.parse(readFileSync(configFile(),'utf8')).origin);}catch{return '';}}
function secureWindow(options={}){return new BrowserWindow({width:1280,height:850,minWidth:360,minHeight:500,show:visible,...options,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,...options.webPreferences}});}
function setup(){
 if(setupWindow&&!setupWindow.isDestroyed()){setupWindow.show();return;}
 setupWindow=secureWindow({width:650,height:620,webPreferences:{preload:path.join(__dirname,'preload.cjs')}});
 setupWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 setupWindow.webContents.on('will-navigate',event=>event.preventDefault());
 setupWindow.on('closed',()=>{setupWindow=null;});
 setupWindow.loadFile(path.join(__dirname,'setup.html'));
}
function connect(origin){
 const previous=workspace;
 workspace=secureWindow();
 const window=workspace;
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 window.webContents.on('will-navigate',(event,url)=>{if(!sameOrigin(url,origin))event.preventDefault();});
 window.webContents.on('will-redirect',(event,url)=>{if(!sameOrigin(url,origin))event.preventDefault();});
 window.webContents.on('will-attach-webview',event=>event.preventDefault());
 window.webContents.on('did-fail-load',(_event,code,_description,_url,main)=>{
  if(main&&code!==-3){setup();if(!window.isDestroyed())window.close();}
 });
 window.on('closed',()=>{if(workspace===window)workspace=null;});
 window.loadURL(origin).catch(()=>{/* did-fail-load returns to setup. */});
 if(previous&&!previous.isDestroyed())previous.close();
 if(setupWindow&&!setupWindow.isDestroyed())setupWindow.close();
}
function localSender(event){return setupWindow&&!setupWindow.isDestroyed()&&event.sender===setupWindow.webContents&&event.senderFrame===setupWindow.webContents.mainFrame&&event.senderFrame.url===setupUrl;}
ipcMain.handle('factx:server',event=>{if(!localSender(event))throw new Error('Not allowed');return savedOrigin();});
ipcMain.handle('factx:connect',async(event,value)=>{
 if(!localSender(event))throw new Error('Not allowed');
 try{
  const origin=serverOrigin(value);
  if(savedOrigin()&&savedOrigin()!==origin){await session.defaultSession.clearStorageData();await session.defaultSession.clearCache();}
  writeFileSync(configFile(),JSON.stringify({origin}));
  setImmediate(()=>connect(origin));return {ok:true};
 }catch(error){return {ok:false,error:error.message};}
});
app.whenReady().then(()=>{
 session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 session.defaultSession.setPermissionCheckHandler(()=>false);
 session.defaultSession.on('will-download',(_event,item)=>{
  // Electron's normal save dialog requires an explicit location, never silently saves.
  item.setSaveDialogOptions({title:'Save FactX download'});
 });
 Menu.setApplicationMenu(Menu.buildFromTemplate([
  {label:'FactX',submenu:[{label:'Server settings',click:setup},{type:'separator'},{role:'quit'}]},
  {label:'View',submenu:[{role:'reload'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]},
  {label:'Edit',submenu:[{role:'undo'},{role:'redo'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
  {label:'Help',submenu:[{label:'About FactX',click:()=>dialog.showMessageBox({message:'FactX',detail:'Connect only to a trusted institution server. Online access is required. External windows are blocked; open external learning links in your browser.'})}]}
 ]));
 const origin=savedOrigin();if(origin)connect(origin);else setup();
});
app.on('window-all-closed',()=>app.quit());
