import {Play,Trash2,LoaderCircle} from 'lucide-react';
import {useEffect,useRef,useState} from 'react';
import type {Activity} from '../lib/types';
import {isNotebook,notebookByteLimit} from '../../server/lab-environment.js';

type Text=string|string[];
type Output={output_type:string;name?:string;text?:Text;traceback?:string[];data?:Record<string,Text>};
type Cell={cell_type:string;metadata:object;source:Text;execution_count?:number|null;outputs?:Output[]};
type Notebook={nbformat:number;nbformat_minor:number;metadata:object;cells:Cell[]};
const join=(text?:Text)=>Array.isArray(text)?text.filter(line=>typeof line==='string').join(''):typeof text==='string'?text:'';
const codeCell=(source=''):Cell=>({cell_type:'code',metadata:{},source,outputs:[],execution_count:null});
function starter():Notebook{
  return {nbformat:4,nbformat_minor:4,metadata:{kernelspec:{display_name:'Python 3',language:'python',name:'python3'}},
    cells:[codeCell()]};
}
function restoreDraft(book:Notebook,a:Activity):Notebook{
  const first=book.cells[0];
  const previousInstructions=[a.title,a.description,...(a.config.tasks||[]).map(t=>[t.title,t.instructions,t.criteria].join('\n'))].filter(Boolean).join('\n\n');
  if(first?.cell_type==='markdown'&&join(first.source)===previousInstructions){
    return {...book,cells:book.cells.slice(1)};
  }
  return book;
}
export function downloadNotebook(content:string){
  const href=URL.createObjectURL(new Blob([content],{type:'application/x-ipynb+json'}));
  const link=document.createElement('a');link.href=href;link.download='lab.ipynb';link.click();
  setTimeout(()=>URL.revokeObjectURL(href),1000);
}
function Outputs({outputs=[]}:{outputs?:Output[]}) {
  return <>{(Array.isArray(outputs)?outputs:[]).filter(o=>o&&typeof o==='object').map((o,i)=>o.data?.['image/png']?<img key={i} alt="Notebook plot" src={'data:image/png;base64,'+join(o.data['image/png'])}/>:<pre key={i}>{join(o.text)||join(o.data?.['text/plain'])||(Array.isArray(o.traceback)?o.traceback.join('\n'):'')}</pre>)}</>;
}
export function NotebookPreview({content}:{content:string}){
  const notebook:Notebook=JSON.parse(content);
  return <div className="fx-notebook">{notebook.cells.map((cell,i)=><section key={i}><pre>{join(cell.source)}</pre><Outputs outputs={cell.outputs}/></section>)}</div>;
}

function openDrafts():Promise<IDBDatabase>{
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open('factx-notebooks',1);
    req.onupgradeneeded=()=>req.result.createObjectStore('drafts');
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
}

export function NotebookLab({activity,studentId,started,disabled,onStart,onSubmit}:{
  activity:Activity;studentId:string;started:boolean;disabled:boolean;onStart:()=>void;onSubmit:(file:File)=>Promise<void>
}){
  const [book,setBook]=useState(starter),[ready,setReady]=useState(false),[error,setError]=useState('');
  const [running,setRunning]=useState<number|null>(null),[kernel,setKernel]=useState(false),[status,setStatus]=useState('');
  const db=useRef<IDBDatabase|null>(null),port=useRef<MessagePort|null>(null),frame=useRef<HTMLIFrameElement>(null);
  const pending=useRef<{index:number;source:string}|null>(null),count=useRef(0);
  const draftKey=JSON.stringify([studentId,activity.id]);
  useEffect(()=>{
    let live=true;
    openDrafts().then(database=>{
      if(!live){database.close();return;}
      db.current=database;
      const req=database.transaction('drafts').objectStore('drafts').get(draftKey);
      req.onsuccess=()=>{if(live){if(req.result)setBook(restoreDraft(req.result,activity));setReady(true);}};
      req.onerror=()=>{if(live){setError('Could not restore this device’s notebook draft.');setReady(true);}};
    }).catch(()=>{if(live){setError('Device storage is unavailable. Export your work before leaving.');setReady(true);}});
    return ()=>{live=false;db.current?.close();db.current=null;port.current?.close();};
  },[draftKey]);
  function update(next:Notebook){
    setBook(next);
    if(!db.current)return;
    try{
      const tx=db.current.transaction('drafts','readwrite');
      tx.objectStore('drafts').put(next,draftKey);
      tx.oncomplete=()=>setStatus('Saved on this device');
      tx.onabort=()=>setError('Could not save this draft. Export your notebook before leaving.');
    }catch{setError('Could not save this draft. Export your notebook before leaving.');}
  }
  function change(index:number,patch:Partial<Cell>){update({...book,cells:book.cells.map((c,i)=>i===index?{...c,...patch}:c)});}
  const applyOutput=useRef(change);applyOutput.current=change;
  function stop(){
    port.current?.close();port.current=null;pending.current=null;setRunning(null);setKernel(false);count.current=0;
  }
  function connect(){
    const channel=new MessageChannel();port.current=channel.port1;
    channel.port1.onmessage=({data})=>{
      if(data.error){setError(String(data.error));stop();return;}
      const cell=pending.current;if(!cell)return;
      if(data.ready){channel.port1.postMessage({source:cell.source});return;}
      if(Array.isArray(data.outputs)){
        applyOutput.current(cell.index,{outputs:data.outputs,execution_count:++count.current});
        pending.current=null;setRunning(null);
      }
    };
    frame.current?.contentWindow?.postMessage('connect','*',[channel.port2]);
  }
  function run(index:number){
    if(pending.current)return;
    setError('');setRunning(index);
    pending.current={index,source:join(book.cells[index].source)};
    if(port.current)port.current.postMessage({source:pending.current.source});else setKernel(true);
  }
  async function importFile(file:File){
    try{
      if(file.size>notebookByteLimit)throw new Error('Choose a file of 10 MiB or less.');
      const content=await file.text();
      let next:Notebook;
      if(/\.py$/i.test(file.name))next={...starter(),cells:[codeCell(content)]};
      else if(isNotebook(content))next=JSON.parse(content);
      else throw new Error('Choose a Python script (.py) or Jupyter notebook (.ipynb).');
      if(book.cells.some(c=>c.cell_type==='code'&&join(c.source).trim())&&!confirm('Replace the current notebook with this file?'))return;
      stop();update(next);setError('');
    }catch(e){setError(e instanceof Error?e.message:'Could not import file.');}
  }
  const locked=!ready||!started||disabled||running!==null;
  return <section className="fx-card fx-notebook"><section className="fx-notebook-task" aria-label="Task instructions"><h2>Task instructions</h2>
    {activity.description&&<p className="preserve-lines">{activity.description}</p>}
    {activity.config.tasks?.map((task,i)=><section key={i}><h3>{i+1}. {task.title} ? {task.marks} marks</h3>
      <p className="preserve-lines">{task.instructions}</p>{task.criteria&&<p className="preserve-lines"><strong>Success criteria:</strong> {task.criteria}</p>}</section>)}
    {!activity.description&&!activity.config.tasks?.length&&<p>{activity.title}</p>}
    </section><h2>Python notebook</h2>
    {kernel&&<iframe hidden title="Isolated Python kernel" sandbox="allow-scripts" src="/notebook-runtime/frame" ref={frame} onLoad={connect}/>}
    {error&&<p className="error" role="alert">{error}</p>}
    {!started&&<button className="button" disabled={disabled||!ready} onClick={onStart}>Begin notebook assessment</button>}
    {book.cells.map((cell,i)=>{
      const isCode=cell.cell_type==='code';
      const name=(isCode?'Python':'Text')+' cell '+(i+1);
      const hasError=cell.outputs?.some(o=>o?.output_type==='error');
      const runState=running===i?'Running?':cell.execution_count==null?'Not run':hasError?'Failed':'Completed';
      return <section className="fx-sample fx-notebook-cell" aria-label={name+' editor'} key={i}>
        <header className="fx-cell-tools">
          {isCode&&<button className="button fx-cell-run" title="Run cell (Ctrl+Enter or ?+Enter)" disabled={locked||!join(cell.source).trim()} onClick={()=>run(i)}>
            {running===i?<LoaderCircle size={16} className="spin"/>:<Play size={16}/>} Run cell</button>}
          <label htmlFor={'notebook-cell-'+i}>{name}</label>
          {isCode&&<small role="status" className={hasError?'fx-danger':''}>{runState}</small>}
          <button className="icon-button fx-cell-delete" aria-label={'Delete cell '+(i+1)} title="Delete cell" disabled={locked} onClick={()=>{
            if((join(cell.source).trim()||cell.outputs?.length)&&!confirm('Delete this cell and its output?'))return;
            update({...book,cells:book.cells.filter((_,index)=>index!==i)});
          }}><Trash2 size={17}/></button>
        </header>
        <textarea id={'notebook-cell-'+i} rows={isCode?4:3} spellCheck={false} placeholder={isCode?'Enter Python code here':''}
          value={join(cell.source)} disabled={locked} onChange={e=>change(i,isCode?{source:e.target.value,outputs:[],execution_count:null}:{source:e.target.value})}
          onKeyDown={e=>{if(isCode&&e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!locked&&join(cell.source).trim()){e.preventDefault();run(i);}}}/>
        {isCode&&!!cell.outputs?.length&&<div className="fx-cell-output" aria-label={'Output for cell '+(i+1)}><Outputs outputs={cell.outputs}/></div>}
      </section>;
    })}
    <div className="inline-actions"><button className="button outline" disabled={locked} onClick={()=>update({...book,cells:[...book.cells,codeCell()]})}>Add code cell</button>
    {kernel&&<button className="button outline" onClick={stop}>Restart kernel</button>}
    <label>Import .ipynb or .py<input type="file" accept=".ipynb,.py" disabled={locked} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void importFile(file);}}/></label>
    <button className="button outline" disabled={!ready||!book.cells.length} onClick={()=>downloadNotebook(JSON.stringify(book))}>Export notebook</button>
    {started&&<button className="button" disabled={locked||!book.cells.some(c=>c.cell_type==='code'&&join(c.source).trim())} onClick={()=>{
      const file=new File([JSON.stringify(book)],'assessment.ipynb',{type:'application/json'});
      if(file.size>notebookByteLimit){setError('The notebook exceeds the 10 MiB submission limit.');return;}
      void onSubmit(file);
    }}>Submit notebook</button>}</div>
    <small role="status">{running!==null?'Running Python…':status}</small></section>;
}
