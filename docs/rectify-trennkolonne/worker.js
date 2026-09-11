import { SimulationSession } from './session.js';
import { ColumnModel } from './model.js';

let session,playing=true,speed=30,selected=8,visible=true,lastTime=performance.now(),lastPost=0;
const emit=(extra={})=>{if(session)self.postMessage({type:'state',playing,speed,...session.frame(selected),...extra});};

self.onmessage=({data})=>{
  try{
    switch(data.type){
      case 'case': {const fresh=new SimulationSession(data.id);session=fresh;selected=Math.min(8,session.model.n-2);playing=true;break;}
      case 'configure': {const fresh=new SimulationSession(session.caseId,data.params);session=fresh;selected=Math.min(selected,session.model.n-1);break;}
      case 'play': playing=!!data.playing;break;
      case 'visibility':visible=!!data.visible;break;
      case 'speed': if(![1,10,30,60,120,300].includes(data.speed))throw new Error('Ungültiges Tempo.');speed=data.speed;break;
      case 'edit': session.edit(data.patch,data.label);break;
      case 'select':selected=Math.max(0,Math.min(session.model.n-1,Number(data.stage)||0));break;
      case 'remember':session.remember();break;
      case 'clearReference':session.reference=null;break;
      case 'mixed': {const mixed=new ColumnModel(session.model.p);mixed.snapshot();session.model=mixed;session.custom=true;session.reference=null;session.history=[];session.events=[];session.log=[{t:0,label:'Siedend und gefüllt, mit einheitlicher Feedzusammensetzung gestartet.'}];session.record();break;}
      case 'steady': {const fresh=new SimulationSession(session.caseId,session.model.p);session=fresh;break;}
      case 'export': self.postMessage({type:'export',data:session.save()});return;
      case 'import': {const fresh=SimulationSession.restore(data.data);session=fresh;selected=1;playing=false;break;}
      default:throw new Error('Unbekannter Befehl.');
    }
    lastTime=performance.now();emit({requestId:data.requestId});
  }catch(error){self.postMessage({type:'error',message:error.message,requestId:data.requestId});emit();}
};

setInterval(()=>{
  const now=performance.now(),dt=Math.min(.3,(now-lastTime)/1000);lastTime=now;
  if(!session||!playing||!visible)return;
  try{
    session.advance(dt*speed);
    if(now-lastPost>=250){lastPost=now;emit();}
  }catch(error){playing=false;self.postMessage({type:'error',message:error.message});try{session.record();emit();}catch{}}
},100);
