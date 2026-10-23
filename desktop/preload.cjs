const {contextBridge,ipcRenderer}=require('electron');
// This bridge is installed only in the bundled setup window, never on remote pages.
contextBridge.exposeInMainWorld('factxSetup',{
 server:()=>ipcRenderer.invoke('factx:server'),
 connect:value=>ipcRenderer.invoke('factx:connect',value)
});
