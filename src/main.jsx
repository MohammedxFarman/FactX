import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowRight,Building2,GraduationCap,ShieldCheck,Mail,LockKeyhole,Eye,EyeOff,LoaderCircle} from 'lucide-react';
import './register-app';
import {api} from './lib/api';
import {installErrorTracking} from './lib/telemetry';
import {ErrorBoundary} from './ui/Primitives';
import {PublicPage} from './Readiness.jsx';
import Landing from './pages/Landing';
import './styles.css';
import './department-setup.css';
import './redesign.css';
import './academic-pages.css';
import './lab.css';
import './landing.css';
import './compat.css';
import './shell.css';
import './dark-theme.css';

const Workspace=React.lazy(()=>import('./Workspace.jsx'));
const workspacePages=['overview', 'inbox', 'students', 'academics', 'attendance', 'timetable', 'assessments', 'labs', 'analytics', 'support', 'learning', 'reports', 'grades', 'documents', 'feedback', 'leave', 'substitutions', 'syllabus', 'monitoring', 'users', 'announcements', 'knowledge', 'workload', 'programs', 'configuration', 'audit', 'settings'];
function IconBox({icon:Icon,color='green',children}){return <span className={'icon-box '+color}>{Icon?<Icon size={20}/>:children}</span>}
function Button({children,variant='',icon:Icon,...props}){return <button className={'button '+variant} {...props}>{Icon&&<Icon size={16}/>} {children}</button>}
function Field({label:caption,children,hint}){const fieldId=React.useId();const bind=node=>{if(!React.isValidElement(node))return node;if(['input','textarea','select'].includes(node.type)||node.type===Select)return React.cloneElement(node,{'aria-labelledby':fieldId});if(node.props.children)return React.cloneElement(node,{},React.Children.map(node.props.children,bind));return node;};return <div className="field"><span id={fieldId}>{caption}</span>{React.Children.map(children,bind)}{hint&&<small>{hint}</small>}</div>}
function Select({options=[],placeholder='Select an option',...props}){return <select {...props}><option value="">{placeholder}</option>{options.map(o=><option key={o.id??o.value} value={o.id??o.value}>{o.name??o.label}</option>)}</select>}
function Auth({onLogin}){const [setup,setSetup]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[show,setShow]=useState(false);useEffect(()=>{api('/auth/status').then(d=>setSetup(d.needsSetup)).catch(e=>setError(e.message))},[]);return <div className="auth-shell"><div className="auth-story"><a className="brand" href="/">FactX<span className="brand-dot">.</span></a><div className="auth-copy"><div className="eyebrow light"><span/> THE CONNECTED ACADEMIC WORKSPACE</div><h1>Every student.<br/>A clearer<br/><em>way forward.</em></h1><p>Bring your institution’s people, progress, and possibilities into one thoughtful workspace.</p><div className="auth-pill"><ShieldCheck size={17}/> Purpose-built for academic communities</div></div><div className="orb orb-one"/><div className="orb orb-two"/><div className="auth-footer"><span>ACADEMIC MANAGEMENT. HUMAN POTENTIAL.</span><span>FactX © {new Date().getFullYear()}</span></div></div><div className="auth-panel"><div className="auth-top"><ShieldCheck size={16}/> Secure institutional access</div><div className="auth-form"><IconBox icon={setup?Building2:GraduationCap}/><div className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</div><h2>{setup?'Make it your workspace.':'Welcome back.'}</h2><p>{setup?'Set up your institution’s first administrator account. Your workspace starts fresh, with only the data you add.':'Sign in to your academic workspace. Everything you need, all in one place.'}</p>{setup===null?<div className="loading"><LoaderCircle/>Connecting to FactX…</div>:<form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{onLogin(await api('/auth/'+(setup?'setup':'login'),{method:'POST',body:Object.fromEntries(new FormData(e.currentTarget))}));}catch(e){setError(e.message)}finally{setBusy(false)}}}>{setup&&<Field label="Full name"><input name="name" autoComplete="name" placeholder="Your full name" required/></Field>}<Field label="Institutional email"><div className="input-icon"><Mail size={17}/><input name="email" type="email" autoComplete="username" placeholder="you@institution.edu" required/></div></Field><Field label="Password" hint={setup?'Use at least 12 characters.':null}><div className="input-icon"><LockKeyhole size={17}/><input name="password" type={show?'text':'password'} autoComplete={setup?'new-password':'current-password'} placeholder="Enter your password" minLength={setup?12:undefined} required/><button type="button" className="icon-button" aria-label={show?'Hide password':'Show password'} onClick={()=>setShow(!show)}>{show?<EyeOff size={16}/>:<Eye size={16}/>}</button></div></Field>{setup&&<Field label="Setup token" hint="Copy the private first-run token from your server terminal."><input name="token" type="password" placeholder="Paste your setup token" required/></Field>}{error&&<div className="error" role="alert">{error}</div>}<Button disabled={busy} variant="wide" icon={busy?LoaderCircle:ArrowRight}>{busy?'Please wait…':setup?'Create your workspace':'Sign in to FactX'}</Button></form>}<nav className="readiness-links" aria-label="Account help"><a href="/#forgot-password">Forgot password?</a><a href="/#privacy">Privacy</a><a href="/#terms">Terms</a></nav><div className="auth-note"><ShieldCheck size={16}/><span>Your access is tailored to your role.<br/>Contact your administrator for account assistance.</span></div></div><div className="auth-bottom">A little more clarity. A lot more possibility. </div></div></div>}


function Opening(){return <div className="boot" role="status"><strong>FactX.</strong><div className="fx-skeleton" style={{width:180,height:12}}/><p>Opening your workspace</p></div>;}
function App(){
 const [user,setUser]=useState(undefined);
 useEffect(()=>{let active=true;api('/auth/status').then(status=>status.authenticated?api('/auth/me'):null).then(value=>{if(active)setUser(value)}).catch(()=>{if(active)setUser(null)});return()=>{active=false};},[]);
 if(user===undefined)return <Opening/>;
 if(!user)return <Landing><Auth onLogin={setUser}/></Landing>;
 return <React.Suspense fallback={<Opening/>}><Workspace user={user} setUser={setUser}/></React.Suspense>;
}
function RoutedApp(){
 const [hash,setHash]=useState(location.hash.slice(1).split('?')[0]);
 useEffect(()=>{const changed=()=>setHash(location.hash.slice(1).split('?')[0]);window.addEventListener('hashchange',changed);return()=>window.removeEventListener('hashchange',changed);},[]);
 const publicPages=['privacy','terms','forgot-password','reset-password','verify-email'];
 if(location.pathname!=='/'||hash&&!workspacePages.includes(hash)&&!publicPages.includes(hash)&&!['access','features','roles','faq'].includes(hash))return <PublicPage kind="404"/>;
 if(publicPages.includes(hash))return <PublicPage key={hash} kind={hash}/>;
 return <App/>;
}
installErrorTracking();
createRoot(document.getElementById('root')).render(<ErrorBoundary name="your workspace"><RoutedApp/></ErrorBoundary>);
