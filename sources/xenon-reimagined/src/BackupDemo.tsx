import { useEffect, useState } from 'react';
import { ArrowRight, Check, Database, Hash, Pause, Play, RotateCcw, ShieldCheck, Volume2 } from 'lucide-react';

const stages = [
  { title: 'Your server, before the changes.', command: 'Ready to create a backup', text: 'Save the channels, roles and settings you want to keep.', action: 'Create backup' },
  { title: 'Backup created.', command: '/backup create', text: 'The original structure is saved. Now let’s change the live server.', action: 'Change server' },
  { title: 'The server has changed.', command: '2 channels deleted · 1 added · 1 role removed', text: 'Rules and clips are gone. Projects is new. Your backup stays untouched.', action: 'Load backup' },
  { title: 'Restoring the saved structure…', command: '/backup load', text: 'Replacing the changed structure with the saved channels and roles.', action: 'Restoring…' },
  { title: 'Back to the way it was.', command: '/backup load', text: 'Rules, clips and the Moderator role are back. Projects is removed.', action: 'Replay demo' },
];
export default function BackupDemo() {
  const [stage, setStage] = useState(0);
  const [playing, setPlaying] = useState(false);
  const changed = stage === 2 || stage === 3;
  const saved = stage > 0;
  useEffect(() => {
    if (stage === 4 || (!playing && stage !== 3)) return;
    const timer = setTimeout(() => {
      setStage(stage + 1);
      if (stage === 3) setPlaying(false);
    }, stage === 3 ? 1800 : stage === 2 ? 4200 : 2800);
    return () => clearTimeout(timer);
  }, [stage, playing]);
  function next() {
    setPlaying(false);
    setStage(stage === 4 ? 0 : Math.min(stage + 1, 4));
  }
  function play() {
    if (playing) { setPlaying(false); return; }
    if (stage === 4) setStage(0);
    setPlaying(true);
  }
  const state = stages[stage];
  return <div className="backup-demo">
    <div className="demo-heading"><span>XE / BACKUP → CHANGE → RESTORE</span><span>INTERACTIVE DEMO</span></div>
    <ol className="demo-story" aria-label="Backup walkthrough">
      {['Create backup', 'Change server', 'Load backup'].map((label, i) => {
        const active = i === (stage < 2 ? 0 : stage === 2 ? 1 : 2);
        const complete = i === 0 ? stage >= 1 : i === 1 ? stage >= 2 : stage === 4;
        return <li key={label} className={`${active ? 'current' : ''} ${complete ? 'complete' : ''}`} aria-current={active ? 'step' : undefined}><span>{complete ? <Check size={13}/> : `0${i + 1}`}</span>{label}</li>;
      })}
    </ol>
    <div className={`server-window walkthrough-window ${changed ? 'server-changed' : ''} ${stage === 4 ? 'server-restored' : ''}`}>
      <div className="server-top"><span className="server-icon">M</span><b>My Community</b><span className="server-state">{changed ? 'MODIFIED' : stage === 4 ? 'RESTORED' : 'ORIGINAL'}</span></div>
      <div className="server-body">
        <aside aria-label="Live server channels and roles">
          <p>⌄ INFORMATION</p><span><Hash/>announcements</span>
          <span className={changed ? 'demo-deleted' : stage === 4 ? 'demo-returned' : ''}><Hash/>rules {changed && <del>−</del>}</span>
          <p>⌄ COMMUNITY</p><span className="channel-active"><Hash/>general</span>
          <span className={changed ? 'demo-deleted' : stage === 4 ? 'demo-returned' : ''}><Hash/>clips-and-media {changed && <del>−</del>}</span>
          {changed && <span className="demo-added"><Hash/>projects <b>+</b></span>}
          <span><Volume2/>Lounge</span><p>⌄ STAFF</p><span><Hash/>mod-log</span>
          <p>ROLES</p><div className="demo-roles"><span>Admin</span><span className={changed ? 'demo-deleted' : stage === 4 ? 'demo-returned' : ''}>Moderator</span><span>Member</span></div>
        </aside>
        <div className="server-content">
          <div className="channel-title"><Hash size={17}/> general <span>LIVE SERVER</span></div>
          <div className="demo-command"><code>{state.command}</code></div>
          <div className="bot-message"><span className="bot-icon"><img src="./logomark.svg" alt=""/></span><div><b>Xenon <em>APP</em></b>
            <div role="status" aria-live="polite" aria-atomic="true" className={`restore ${stage === 3 ? 'restoring' : ''}`}>
              {stage === 2 ? <RotateCcw size={25}/> : <ShieldCheck size={25}/>}
              <strong>{state.title}</strong><p>{state.text}</p>
              <div className="mini-bars">{Array.from({length:16}, (_,i)=><i key={i} style={{animationDelay:`${i * .08}s`}}/>)}</div>
              <span>{changed ? '41' : '42'} CHANNELS <i/> {changed ? '17' : '18'} ROLES</span>
            </div>
          </div></div>
          <div className={`saved-snapshot ${saved ? 'has-snapshot' : ''}`}><Database size={17}/><div><b>{saved ? 'Backup #001' : 'No backup yet'}</b><span>{saved ? '42 channels · 18 roles · original settings' : 'Create a snapshot of the original server'}</span></div>{saved && <ShieldCheck size={16}/>}</div>
        </div>
      </div>
    </div>
    <div className="demo-controls"><button className="demo-next" onClick={next} disabled={stage === 3}>{stage === 4 ? <RotateCcw size={16}/> : <ArrowRight size={16}/>} {state.action}</button><button className="demo-play" onClick={play} disabled={stage === 3} aria-label={playing ? 'Pause walkthrough' : 'Play walkthrough automatically'}>{playing ? <Pause size={15}/> : <Play size={15}/>} {playing ? 'Pause' : 'Auto play'}</button></div>
    <p className="demo-caption">{stage === 2 ? 'Live server changed. Saved backup unchanged.' : stage === 4 ? '42 channels, 18 roles, back the way they were.' : 'Follow each step, or watch the full sequence.'}</p>
  </div>;
}
