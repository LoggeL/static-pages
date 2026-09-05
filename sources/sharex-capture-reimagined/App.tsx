'use client';

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ArrowRight, Download, Code2, Scan, MousePointer2, Square, Type, Check, Layers, Zap, Lock, Video, Upload, ChevronDown, MoveUpRight, RotateCcw, Crosshair, Pause, Play } from 'lucide-react';
const Scene = lazy(() => import('./Scene'));
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const release = 'https://github.com/ShareX/ShareX/releases/latest';
const features = [
  { icon: Scan, title: 'Every pixel. Your call.', text: 'Full screen, a single window, or exactly the region you need. Get the right shot, first time.', label: 'PRECISION CAPTURE', className: 'capture', detail: ['Region & freehand capture', 'Scrolling screenshots', 'Multi-monitor support'] },
  { icon: Video, title: 'Make your point move.', text: 'Turn a moment into a recording or a looping GIF. Show the steps, skip the explanation.', label: 'SCREEN RECORDING', className: 'record', detail: ['Screen & audio recording', 'Animated GIF export', 'Custom recording regions'] },
  { icon: Zap, title: 'One shortcut. All done.', text: 'Capture, edit, upload, copy the link. Build a workflow that does the repetitive work for you.', label: 'YOUR WORKFLOW', className: 'workflow', detail: ['Automated after-capture tasks', 'Custom upload destinations', 'Configurable keyboard shortcuts'] },
];

export default function Home() {
  const [paused, setPaused] = useState(false);
  const [burst, setBurst] = useState(0);
  const pageRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nodes=document.querySelectorAll('.feature-card, .section-heading, .open-source, .bottom-cta');
    const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('revealed');observer.unobserve(e.target);}}),{threshold:.12});
    nodes.forEach(n=>{n.classList.add('reveal-ready');observer.observe(n);});
    return()=>observer.disconnect();
  },[]);
  const [mode, setMode] = useState('capture');
  const [tool, setTool] = useState('region');
  const [annotated, setAnnotated] = useState(false);
  const [captured, setCaptured] = useState(false);
  const [message, setMessage] = useState('Drag across the artwork to choose a region');
  const [selection, setSelection] = useState({ x: 15, y: 14, w: 70, h: 70 });
  const [expanded, setExpanded] = useState<number | null>(null);
  const [flat, setFlat] = useState(false);
  const [tilt, setTilt] = useState({ x: 7, y: -13 });
  const origin = useRef<{x:number,y:number}|null>(null);
  const stage = useRef<HTMLDivElement>(null);
  function point(e: React.PointerEvent<HTMLDivElement>) { const b=e.currentTarget.getBoundingClientRect(); return { x:Math.max(0,Math.min(100,(e.clientX-b.left)/b.width*100)),y:Math.max(0,Math.min(100,(e.clientY-b.top)/b.height*100)) }; }
  function start(e: React.PointerEvent<HTMLDivElement>) { if(mode!=='capture') { if(mode==='annotate'){setAnnotated(true);setMessage('Callout added. Switch to Share to save your image.');} return; } e.currentTarget.setPointerCapture(e.pointerId); origin.current=point(e);setCaptured(false); }
  function drag(e: React.PointerEvent<HTMLDivElement>) { if(!origin.current)return; const p=point(e),o=origin.current;setSelection({x:Math.min(p.x,o.x),y:Math.min(p.y,o.y),w:Math.max(4,Math.abs(p.x-o.x)),h:Math.max(4,Math.abs(p.y-o.y))}); }
  function changeMode(value:unknown) { const v=String(value);setMode(v);setMessage(v==='capture'?'Drag across the artwork to choose a region':v==='annotate'?'Click the artwork to add a callout':'Save your demo capture as a PNG'); }
  async function save() {
    try {
      const webgl=stage.current?.querySelector('canvas');
      const scene=document.createElement('canvas');scene.width=1200;scene.height=760;
      const sc=scene.getContext('2d');if(!sc)throw Error();
      sc.fillStyle='#080c17';sc.fillRect(0,0,1200,760);
      if(webgl){sc.drawImage(webgl,0,0,1200,760);}else{const img=new Image();img.src='./sharex-logo.svg';await img.decode();sc.drawImage(img,380,150,440,440);}
      sc.fillStyle='#d6e7ff';sc.font='14px sans-serif';sc.fillText('LESS FRICTION.',64,74);sc.font='52px sans-serif';sc.fillText('More flow.',64,135);
      const c=document.createElement('canvas');c.width=Math.round(1200*selection.w/100);c.height=Math.round(760*selection.h/100);
      const ctx=c.getContext('2d');if(!ctx)throw Error();ctx.drawImage(scene,1200*selection.x/100,760*selection.y/100,c.width,c.height,0,0,c.width,c.height);
      if(annotated){ctx.fillStyle='#3675ff';ctx.fillRect(c.width*.1,c.height*.65,c.width*.8,Math.max(40,c.height*.13));ctx.fillStyle='#ffffff';ctx.font=`bold ${Math.max(16,c.width*.035)}px sans-serif`;ctx.fillText('A little more clarity.',c.width*.14,c.height*.73);}
      const a=document.createElement('a');a.download='sharex-demo.png';a.href=c.toDataURL();a.click();setMessage('Your capture is saved. Make something worth sharing.');
    }catch{setMessage('The artwork is still loading. Please try again in a moment.');}
  }
  return <main ref={pageRef} className={paused?'motion-paused':''} onPointerMove={e=>{if(paused)return;pageRef.current?.style.setProperty('--pointer-x',e.clientX+'px');pageRef.current?.style.setProperty('--pointer-y',e.clientY+'px');}}>
    <div className="pointer-aura" aria-hidden="true"/><div className="reading-progress" aria-hidden="true"/>

    <header className="nav wrap"><a className="brand" href="#" aria-label="ShareX home"><img className="brand-symbol" src="./sharex-logo.svg" alt=""/> ShareX</a><nav aria-label="Main navigation"><a href="#features">Features</a><a href="#playground">How it works</a><a href="https://getsharex.com/">Resources <ArrowUpRight size={13}/></a></nav><button className="motion-button" onClick={()=>setPaused(!paused)} aria-label={paused?"Resume animations":"Pause animations"} aria-pressed={paused}>{paused?<Play size={15}/>:<Pause size={15}/>}</button><a className="nav-source" href="https://github.com/ShareX/ShareX"><Code2 size={17}/> <span>Open source</span></a><a className="button small" href={release}>Download <ArrowDown/></a></header>
    <section className="hero wrap" id="playground">
      <div className="hero-copy"><span className="hero-index">THE SCREEN IS JUST THE BEGINNING. <span>↗</span></span><div className="eyebrow"><span className="live-dot"/> FREE. OPEN SOURCE. ALL YOURS.</div><h1>Capture<br/>without<br/><span>limits.</span><span className="heading-spark"><img src="./sharex-logo.svg" alt=""/></span></h1><p>Your screen has a story.<br/>Capture it. Make it clear. Share it anywhere.</p><div className="hero-actions"><a className="button" href={release}><Download size={19}/> Get ShareX for Windows <ArrowUpRight size={18}/></a><a className="demo-link" href="#demo-controls">Try it out <ArrowRight size={17}/></a></div><div className="fine-print"><Check size={13}/> Completely free <span>·</span> No ads <span>·</span> No account needed</div></div>
      <div className={`hero-visual ${flat?'flat':''}`} onPointerMove={e=>{if(paused||e.pointerType!=='mouse'||origin.current)return;const b=e.currentTarget.getBoundingClientRect();setTilt({x:5-(e.clientY-b.top)/b.height*9,y:-15+(e.clientX-b.left)/b.width*13});}} onPointerLeave={()=>setTilt({x:7,y:-13})}>
        <div className="scene-halo"/><div className="orbit orbit-one"/><div className="orbit orbit-two"/><span className="scene-label"><span className="live-dot"/> LIVE 3D CANVAS</span><span className="coordinate top">X: 0240&nbsp; Y: 0180</span><div className="window-stack" style={{transform:flat?'none':`rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) rotateZ(-3deg)`}}>
        <div className="back-window back-one"/><div className="back-window back-two"/>
        <div className="capture-window"><div className="window-bar"><div className="window-dots"><i/><i/><i/></div><span>Make room for your next idea.</span><span className="window-count">01 / 03</span></div><div className={`art-stage ${captured?'is-captured':''}`} ref={stage} onPointerDown={start} onPointerMove={drag} onPointerUp={()=>{if(!origin.current)return;origin.current=null;setMessage('Region selected. Capture it or add an annotation.');}} onPointerCancel={()=>{origin.current=null;}}>
        <Suspense fallback={<div className="scene-loading"><img src="./sharex-logo.svg" alt="Loading 3D scene"/></div>}><Scene paused={paused||captured}/></Suspense><div className="scene-grid" aria-hidden="true"/><div className="scan-sweep" aria-hidden="true"/><div className="art-caption"><span>LESS FRICTION.</span><strong>More flow.</strong></div><div className="selection" style={{left:selection.x+'%',top:selection.y+'%',width:selection.w+'%',height:selection.h+'%'}}><span className="selection-size">{Math.round(selection.w*12)} × {Math.round(selection.h*7.6)}</span><i/><i/><i/><i/>{annotated&&<div className="annotation"><MoveUpRight size={34}/><span>A little more clarity.</span></div>}</div><span className="art-meta">EXPERIMENT 001 / CREATIVE FLOW</span></div><div className="window-status"><span><span className="live-dot"/> {captured?'Capture ready':mode==='annotate'?'Annotation mode':'Region capture'}</span><span>PNG <span className="status-divider">|</span> 100%</span></div></div>
        <div className="capture-burst" key={burst} aria-hidden="true" data-fired={burst>0}/><div className="floating-toolbar"><button title="Select region" aria-label="Select region" className={tool==='region'?'selected':''} onClick={()=>{setTool('region');changeMode('capture');}}><Scan/></button><button title="Add arrow" aria-label="Add arrow" className={tool==='arrow'?'selected':''} onClick={()=>{setTool('arrow');setAnnotated(true);changeMode('annotate');}}><MoveUpRight/></button><button title="Add callout" aria-label="Add callout" onClick={()=>{setTool('text');setAnnotated(true);changeMode('annotate');}}><Type/></button><span/><button title="Capture region" aria-label="Capture region" className="capture-check" onClick={()=>{setCaptured(true);setBurst(b=>b+1);setMessage('Captured. Switch to Share to download your image.');}}><Check/></button></div>
        <div className="capture-toast"><span className="toast-icon"><Check size={16}/></span><div><strong>{captured?'Nice capture.':'Big ideas. Small shortcuts.'}</strong><span>{captured?'Ready for your next step.':'Your workflow, on autopilot.'}</span></div><kbd>PrtSc</kbd></div></div>
        <div className="visual-caption"><span><MousePointer2 size={13}/> REAL-TIME 3D. READY TO CAPTURE.</span><button onClick={()=>setFlat(!flat)} aria-pressed={flat}><Layers size={14}/>{flat?'Enable 3D':'Pause 3D'}</button></div>
      </div>
      <div className="demo-controls" id="demo-controls"><div className="demo-intro"><span className="live-dot"/> THE CAPTURE PLAYGROUND <span className="demo-badge">Interactive demo</span></div><Tabs value={mode} onValueChange={changeMode}><TabsList className="step-tabs"><TabsTrigger value="capture"><span>01</span> Capture</TabsTrigger><TabsTrigger value="annotate"><span>02</span> Annotate</TabsTrigger><TabsTrigger value="share"><span>03</span> Share</TabsTrigger></TabsList></Tabs><div className="demo-feedback"><span role="status">{message}</span>{mode==='share'?<button className="save-button" onClick={save}>Save PNG <Download size={15}/></button>:<button aria-label="Reset demo" title="Reset demo" onClick={()=>{setSelection({x:15,y:14,w:70,h:70});setAnnotated(false);setCaptured(false);changeMode('capture');}}><RotateCcw size={16}/></button>}</div></div>
    </section>
    <div className="spectrum-marquee" aria-hidden="true"><div>{Array.from({length:4},(_,i)=><span key={i}>CAPTURE <b>✦</b> ANNOTATE <b>✦</b> AUTOMATE <b>✦</b> SHARE <b>✦</b></span>)}</div></div><div className="trust-strip"><div className="wrap"><span>BUILT FOR YOUR EVERYDAY. <strong>READY FOR ANYTHING.</strong></span><span><Lock/> Privacy first</span><span><Code2/> Open by design</span><span><Zap/> Lightweight by nature</span></div></div>
    <section className="features wrap" id="features"><div className="section-heading"><div><div className="eyebrow">LESS BUSYWORK. MORE DOING.</div><h2>Small tool.<br/><span>Serious superpowers.</span></h2></div><p>Everything between “look at this”<br/>and “got it”, taken care of.</p></div><div className="feature-grid">{features.map((f,i)=><article key={f.title} className={`feature-card ${f.className}`} onPointerMove={e=>{const b=e.currentTarget.getBoundingClientRect();e.currentTarget.style.setProperty("--card-x",(e.clientX-b.left)+"px");e.currentTarget.style.setProperty("--card-y",(e.clientY-b.top)+"px");}}><div className="feature-top"><f.icon size={24}/><span>0{i+1}</span></div><div className="feature-mini" aria-hidden="true">{i===0?<div className="mini-region"><Crosshair/><span>Just the part that matters.</span></div>:i===1?<div className="waveform">{Array.from({length:28},(_,n)=><i key={n} style={{height:(15+Math.sin(n*1.8)**2*55)+'px',animationDelay:n*.06+'s'}}/>)}<span className="record-label"><i/> REC 00:12</span></div>:<div className="workflow-nodes"><span><Scan/></span><b>→</b><span><Square/></span><b>→</b><span><Upload/></span><b>→</b><span><Check/></span></div>}</div><span className="feature-label">{f.label}</span><h3>{f.title}</h3><p>{f.text}</p><button className="feature-more" onClick={()=>setExpanded(expanded===i?null:i)} aria-expanded={expanded===i}>Explore {i===0?'capture':i===1?'recording':'workflows'} <ChevronDown style={{transform:expanded===i?'rotate(180deg)':'none'}} size={17}/></button>{expanded===i&&<ul className="feature-details">{f.detail.map(d=><li key={d}><Check size={14}/>{d}</li>)}</ul>}</article>)}</div></section>
    <section className="open-source wrap" id="community"><div className="source-mark"><img src="./sharex-logo.svg" alt="ShareX original logo"/></div><div><div className="eyebrow">GOOD SOFTWARE BELONGS TO EVERYONE.</div><h2>Made by people.<br/>Powered by possibility.</h2><p>Free, open source, and built by a community that cares.<br/>Explore the code. Contribute an idea. Make ShareX yours.</p><a className="text-link" href="https://github.com/ShareX/ShareX">Find us on GitHub <ArrowUpRight size={17}/></a></div><div className="source-aside"><span>100%</span><p>free & open source</p><div>Zero ads. Zero subscriptions.<br/>Just a better way to share.</div></div></section>
    <section className="bottom-cta wrap"><div className="cta-orbits" aria-hidden="true"><i/><i/><i/><i/></div><span className="eyebrow">YOUR NEXT GREAT CAPTURE STARTS HERE.</span><h2>Ready when <em>you are.</em></h2><a className="button" href={release}><Download size={19}/> Download ShareX <ArrowUpRight size={18}/></a><span className="fine-print">Made for Windows. Free for everyone.</span></section>
    <footer className="wrap"><a className="brand" href="#"><img className="brand-symbol" src="./sharex-logo.svg" alt=""/> ShareX</a><span>Independent redesign concept · <a href="https://getsharex.com">Official ShareX site <ArrowUpRight size={12}/></a></span><div><a href="https://getsharex.com/changelog">Changelog</a><a href="https://getsharex.com/donate">Donate</a><a href="https://github.com/ShareX/ShareX" aria-label="ShareX GitHub"><Code2 size={18}/></a></div></footer>
  </main>;
}
function ArrowDown(){return <Download size={15}/>}
