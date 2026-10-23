import {useEffect,useState} from 'react';
import {Download} from 'lucide-react';
import {Sheet} from './Primitives';
type InstallEvent=Event & {prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>};
export function InstallApp(){
 const [prompt,setPrompt]=useState<InstallEvent|null>(null),[open,setOpen]=useState(false),[installed,setInstalled]=useState(matchMedia('(display-mode: standalone)').matches);
 useEffect(()=>{const ready=(event:Event)=>{event.preventDefault();setPrompt(event as InstallEvent);};const done=()=>{setInstalled(true);setPrompt(null);setOpen(false);};window.addEventListener('beforeinstallprompt',ready);window.addEventListener('appinstalled',done);return()=>{window.removeEventListener('beforeinstallprompt',ready);window.removeEventListener('appinstalled',done);};},[]);
 if(installed)return null;
 return <><button className="icon-button" aria-label="Install FactX" onClick={()=>setOpen(true)}><Download size={19}/></button>{open&&<Sheet title="Install FactX" onClose={()=>setOpen(false)}><p>Keep FactX on your phone or computer’s home screen. Sign in to the same institution server on every device.</p>{prompt?<button className="primary" onClick={async()=>{await prompt.prompt();await prompt.userChoice;setPrompt(null);}}>Install app</button>:<><p><strong>Android / Chrome / Edge:</strong> Open the browser menu and choose Install app or Add to Home screen when available.</p><p><strong>iPhone / iPad:</strong> Open this site in Safari, tap Share, then Add to Home Screen.</p></>}<p>Installation requires a secure HTTPS site (or localhost for development). An internet connection is required to load records, save work and submit assessments. This is a web app, not an app-store download.</p></Sheet>}</>;
}
