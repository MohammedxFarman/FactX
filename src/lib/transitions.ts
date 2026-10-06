import {flushSync} from 'react-dom';
export function transition(update:()=>void){
 if(document.startViewTransition&&!matchMedia('(prefers-reduced-motion: reduce)').matches)document.startViewTransition(()=>flushSync(update));
 else update();
}
