import {useEffect,useRef} from 'react';
import {Chart,LineController,LineElement,PointElement,CategoryScale,LinearScale,BarController,BarElement,DoughnutController,ArcElement,Tooltip,Filler} from 'chart.js';
import {EmptyState} from './Primitives';
Chart.register(LineController,LineElement,PointElement,CategoryScale,LinearScale,BarController,BarElement,DoughnutController,ArcElement,Tooltip,Filler);
export default function ChartView({labels,values,type='line',label='Recorded percentage',colors}:{labels:string[];values:number[];type?:'line'|'bar'|'doughnut';label?:string;colors?:string[]}){
 const ref=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{if(!ref.current||!values.length)return;const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;const chart=new Chart(ref.current,{type,data:{labels,datasets:[{label,data:values,borderColor:colors||'#437d65',backgroundColor:colors||(type==='doughnut'?['#437d65','#e5ece7']:'#437d6530'),borderWidth:type==='doughnut'?0:2,tension:.35,fill:type==='line',pointRadius:3}]},options:{responsive:true,maintainAspectRatio:false,animation:reduced?false:{duration:200},plugins:{legend:{display:false}},...(type!=='doughnut'?{scales:{y:{beginAtZero:true,max:100,grid:{color:'#85958b22'},ticks:{color:'#778b80'}},x:{grid:{display:false},ticks:{color:'#778b80',maxRotation:0,maxTicksLimit:6}}}}:{cutout:'78%'})}});return()=>chart.destroy();},[labels,values,type,label,colors]);
 return values.length?<div className="fx-chart" role="img" aria-label={`${label}: ${labels.map((l,i)=>`${l} ${values[i]}%`).join(', ')}`}><canvas ref={ref}/></div>:<EmptyState title="Your progress starts here" detail="Charts appear when there are recorded results."/>;
}
