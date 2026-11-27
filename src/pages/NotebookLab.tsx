import {useState} from 'react';
import type {Activity} from '../lib/types';
import {isNotebook} from '../../server/lab-environment.js';

export function downloadNotebook(content:string) {
  const href=URL.createObjectURL(new Blob([content],{type:'application/x-ipynb+json'}));
  const link=document.createElement('a');
  link.href=href;
  link.download='lab.ipynb';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(href),1000);
}

export function NotebookLab({activity,student,started,disabled,onStart,onSubmit}:{
  activity:Activity;student:boolean;started:boolean;disabled:boolean;onStart:()=>void;onSubmit:(content:string)=>Promise<void>
}) {
  const [file,setFile]=useState<File|null>(null),[error,setError]=useState('');
  const custom=activity.config.resourceUrl;
  const url=custom && /^https?:\/\//i.test(custom)?custom:'https://jupyter.org/try-jupyter/lab/index.html';
  const starter=()=>downloadNotebook(JSON.stringify({nbformat:4,nbformat_minor:4,
    metadata:{kernelspec:{display_name:'Python 3',language:'python',name:'python3'}},
    cells:[{cell_type:'markdown',metadata:{},source:activity.title+'\n\n'+activity.description},
      {cell_type:'code',metadata:{},source:'',outputs:[],execution_count:null}]},null,2));
  async function submit(){
    setError('');
    if(!file)return;
    try{
      if(file.size>100000)throw new Error('Clear large cell outputs and save a notebook under 100 KB.');
      const content=await file.text();
      if(!isNotebook(content))throw new Error('Choose a Jupyter notebook (.ipynb) with at least one cell.');
      await onSubmit(content);
    }catch(e){setError(e instanceof Error?e.message:'Could not read notebook.');}
  }
  return <section className="fx-card"><h2>Jupyter notebook</h2>
    <p>Download the starter and open it in Jupyter. Save your completed .ipynb file for faculty review.</p>
    <div className="inline-actions"><button className="button outline" onClick={starter}>Download starter notebook</button>
    <a href={url} className="button" target="_blank" rel="noreferrer">Open Jupyter</a></div>
    {student && (started?<div className="inline-actions"><label>Completed notebook<input type="file" accept=".ipynb" disabled={disabled} onChange={e=>{setFile(e.target.files?.[0]||null);setError('');}}/></label>
    <button className="button" disabled={disabled||!file} onClick={submit}>Submit notebook</button></div>:<button className="button outline" disabled={disabled} onClick={onStart}>Begin notebook assessment</button>)}
    {error&&<p role="alert">{error}</p>}</section>;
}
