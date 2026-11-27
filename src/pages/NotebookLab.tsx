import {useState} from 'react';
import type {Activity} from '../lib/types';
import {isNotebook,isMlSubject,notebookByteLimit} from '../../server/lab-environment.js';

export function downloadNotebook(content:string) {
  const href=URL.createObjectURL(new Blob([content],{type:'application/x-ipynb+json'}));
  const link=document.createElement('a');
  link.href=href;
  link.download='lab.ipynb';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(href),1000);
}

export function NotebookLab({activity,student,started,disabled,onStart,onSubmit}:{
  activity:Activity;student:boolean;started:boolean;disabled:boolean;onStart:()=>void;onSubmit:(file:File)=>Promise<void>
}) {
  const [file,setFile]=useState<File|null>(null),[error,setError]=useState('');
  const custom=activity.config.resourceUrl;
  const fallback=isMlSubject(activity)?'https://colab.research.google.com/':'https://jupyter.org/try-jupyter/lab/index.html';
  const url=custom && /^https?:\/\//i.test(custom)?custom:fallback;
  const colab=new URL(url).hostname==='colab.research.google.com';
  const starter=()=>downloadNotebook(JSON.stringify({nbformat:4,nbformat_minor:4,
    metadata:{kernelspec:{display_name:'Python 3',language:'python',name:'python3'}},
    cells:[{cell_type:'markdown',metadata:{},source:activity.title+'\n\n'+activity.description},
      {cell_type:'code',metadata:{},source:'',outputs:[],execution_count:null}]},null,2));
  async function submit(){
    setError('');
    if(!file)return;
    try{
      if(file.size>notebookByteLimit)throw new Error('The notebook exceeds the 10 MiB upload limit.');
      const content=await file.text();
      if(!isNotebook(content))throw new Error('Choose a Jupyter notebook (.ipynb) with at least one cell.');
      await onSubmit(file);
    }catch(e){setError(e instanceof Error?e.message:'Could not read notebook.');}
  }
  return <section className="fx-card"><h2>Jupyter notebook</h2>
    <p>{custom?'Open the linked workspace and save a copy of your work.':'Download the starter notebook and upload it in the workspace.'} Submit your completed .ipynb file with its outputs (up to 10 MiB).</p>
    <div className="inline-actions"><button className="button outline" onClick={starter}>Download starter notebook</button>
    <a href={url} className="button" target="_blank" rel="noreferrer">{colab?'Open in Colab':'Open Jupyter'}</a></div>
    {student && (started?<div className="inline-actions"><label>Completed notebook<input type="file" accept=".ipynb" disabled={disabled} onChange={e=>{setFile(e.target.files?.[0]||null);setError('');}}/></label>
    <button className="button" disabled={disabled||!file} onClick={submit}>Submit notebook</button></div>:<button className="button outline" disabled={disabled} onClick={onStart}>Begin notebook assessment</button>)}
    {error&&<p role="alert">{error}</p>}</section>;
}
