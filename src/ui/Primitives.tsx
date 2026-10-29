import React,{Component,useEffect,useRef,useState,type ReactNode,type CSSProperties} from 'react';
import {X,ArrowUpRight,RefreshCw} from 'lucide-react';
import {subjectColor} from '../lib/subjects';
import {track} from '../lib/telemetry';
export class ErrorBoundary extends Component<{children:ReactNode;name?:string},{error:boolean}>{
  state={error:false};static getDerivedStateFromError(){return {error:true};}
  componentDidCatch(){track({type:'error',kind:'render'});}
  render(){return this.state.error?<div className="fx-empty" role="alert"><h3>Something interrupted {this.props.name||'this view'}.</h3><p>Your saved work is still available.</p><button className="button outline" onClick={()=>this.setState({error:false})}><RefreshCw size={16}/> Try again</button></div>:this.props.children;}
}
export function Skeleton(){return <div className="fx-skeleton-page" aria-busy="true" aria-label="Loading section"><div className="fx-summary">{[0,1,2].map(n=><div className="fx-skeleton" key={n}/>)}</div><div className="fx-skeleton fx-skeleton-large"/></div>;}
export function PageMotion({children}:{children:ReactNode}){return <div className="fx-page-motion">{children}</div>;}
export function SubjectChip({id,name}:{id:string;name:string}){return <span className="fx-subject" style={{'--subject':subjectColor(id)} as CSSProperties}><i/>{name}</span>;}
export function Metric({label,value,detail,tone=''}:{label:string;value:ReactNode;detail?:string;tone?:string}){return <article className={'fx-metric '+tone}><span>{label}</span><strong>{value??'â€”'}</strong>{detail&&<small>{detail}</small>}</article>;}
export function EmptyState({title='Nothing here yet',detail='Your institutionâ€™s records will appear here.',action}:{title?:string;detail?:string;action?:ReactNode}){return <div className="fx-empty"><span className="fx-empty-mark">âœ³</span><h3>{title}</h3><p>{detail}</p>{action}</div>;}
export function Section({title,subtitle,action,children,className=''}:{title:string;subtitle?:string;action?:ReactNode;children:ReactNode;className?:string}){return <section className={'fx-card panel '+className}><header className="fx-section-heading"><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div>{action}</header>{children}</section>;}
export function Jump({children,onClick}:{children:ReactNode;onClick:()=>void}){return <button className="fx-link" onClick={onClick}>{children}<ArrowUpRight size={16}/></button>;}
export function Sheet({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
  const ref=useRef<HTMLElement>(null);const [expanded,setExpanded]=useState(false);
  useEffect(()=>{const previous=document.activeElement as HTMLElement;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';ref.current?.focus();return()=>{document.body.style.overflow=overflow;previous?.focus();};},[]);
  return <div className="fx-sheet-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={'fx-sheet '+(expanded?'expanded':'')} onKeyDown={e=>{if(e.key==='Escape')onClose();if(e.key==='Tab'){const nodes=[...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,a[href]')];const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&(document.activeElement===first||document.activeElement===ref.current)){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}}}>
    <div className="fx-sheet-handle"><button aria-label={expanded?'Collapse sheet':'Expand sheet'} onClick={()=>setExpanded(!expanded)}><span/></button></div>
    <header><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></header><div className="fx-sheet-content">{children}</div>
  </section></div>;
}
function normalizeStatus(node:ReactNode):ReactNode{
  return React.Children.map(node,child=>{
    if(!React.isValidElement(child))return child;
    const props=child.props as {className?:string;children?:ReactNode};
    if(props.className?.includes('fx-status')&&typeof props.children==='string')return React.cloneElement(child,{},props.children.charAt(0).toUpperCase()+props.children.slice(1));
    return React.cloneElement(child,{},normalizeStatus(props.children));
  });
}
export function VirtualList<T>({items,render,rowHeight=88}:{items:T[];render:(item:T,index:number)=>ReactNode;rowHeight?:number}){
  const [scroll,setScroll]=useState(0);const start=Math.max(0,Math.floor(scroll/rowHeight)-3);const virtual=items.length>100;const visible=virtual?items.slice(start,start+15):items;
  return <div className={virtual?'fx-virtual':'fx-stagger'} onScroll={e=>setScroll(e.currentTarget.scrollTop)} style={virtual?{height:560,overflow:'auto'}:undefined}><div style={virtual?{height:items.length*rowHeight,position:'relative'}:undefined}><div style={virtual?{position:'absolute',inset:'0 0 auto',transform:`translateY(${start*rowHeight}px)`}:undefined}>{visible.map((item,i)=><div key={i+(virtual?start:0)} style={virtual?{height:rowHeight}:{'--i':Math.min(i,7)} as CSSProperties}>{normalizeStatus(render(item,i+(virtual?start:0)))}</div>)}</div></div></div>;
}
