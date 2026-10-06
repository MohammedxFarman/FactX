import {useEffect,useRef} from 'react';
import * as monaco from 'monaco-editor/editor/editor.api';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import 'monaco-editor/languages/definitions/python/register';
import 'monaco-editor/languages/definitions/javascript/register';
import 'monaco-editor/languages/definitions/cpp/register';
import 'monaco-editor/languages/definitions/java/register';
self.MonacoEnvironment={getWorker:()=>new EditorWorker()};
export default function CodeEditor({value,language,onChange,readOnly=false}:{value:string;language:string;onChange:(value:string)=>void;readOnly?:boolean}){
 const container=useRef<HTMLDivElement>(null),editor=useRef<monaco.editor.IStandaloneCodeEditor|null>(null),callback=useRef(onChange);callback.current=onChange;
 useEffect(()=>{if(!container.current)return;const instance=monaco.editor.create(container.current,{value,language:language==='c'?'cpp':language,theme:document.documentElement.dataset.theme==='dark'?'vs-dark':'vs',automaticLayout:true,editContext:false,minimap:{enabled:false},fontSize:14,lineHeight:23,scrollBeyondLastLine:false,wordWrap:'on',padding:{top:18,bottom:18},readOnly,ariaLabel:'Code editor',accessibilitySupport:'on',tabSize:4});editor.current=instance;const change=instance.onDidChangeModelContent(()=>callback.current(instance.getValue()));const observer=new MutationObserver(()=>monaco.editor.setTheme(document.documentElement.dataset.theme==='dark'?'vs-dark':'vs'));observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});return()=>{change.dispose();observer.disconnect();instance.getModel()?.dispose();instance.dispose();editor.current=null;};},[]);
 useEffect(()=>{editor.current?.updateOptions({readOnly});},[readOnly]);
 useEffect(()=>{if(editor.current&&value!==editor.current.getValue())editor.current.setValue(value);},[value]);
 return <div ref={container} className="fx-monaco"/>;
}
