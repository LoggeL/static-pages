const STAGES = [0.1, 0.4, 1, 2, 4, 8, 16, 30];
const N_ROUNDS = 5;
let tracks = [], queue = [], roundIdx = 0, stage = 0, results = [], mode = 'daily', seedStr = '';
let audio = new Audio(), stopTimer = null;

const $ = id => document.getElementById(id);
const els = { play: $('playBtn'), input: $('guessInput'), suggest: $('suggest'),
  guess: $('guessBtn'), more: $('moreBtn'), skip: $('skipBtn'), fb: $('feedback'),
  dots: $('dots'), stageText: $('stageText'), stageLabel: $('stageLabel'),
  fill: $('progressFill'), game: $('gameCard'), result: $('resultCard'),
  rTitle: $('resultTitle'), rLines: $('resultLines'), share: $('shareText'),
  date: $('dateLabel'), round: $('roundLabel') };

function berlinDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
}
function hashStr(s){ let h = 2166136261 >>> 0; for (let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619);} return h >>> 0; }
function mulberry32(a){ return function(){ a|=0; a = a+0x6D2B79F5|0; let t = Math.imul(a^a>>>15, 1|a); t = t+Math.imul(t^t>>>7, 61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function pickSongs(seed, n){
  const rnd = mulberry32(hashStr(seed));
  const idx = tracks.map((_,i)=>i);
  for (let i=idx.length-1;i>0;i--){ const j = Math.floor(rnd()*(i+1)); [idx[i],idx[j]]=[idx[j],idx[i]]; }
  // Pro Runde nur verschiedene Songs (keine zwei Varianten desselben Titels).
  const picked = [], seenCanon = new Set();
  for (const i of idx){
    const k = canon(tracks[i].title);
    if (seenCanon.has(k)) continue;
    seenCanon.add(k); picked.push(tracks[i]);
    if (picked.length >= n) break;
  }
  return picked;
}
function fmt(s){ return (s < 1 ? s.toFixed(1) : Math.round(s)) + 's'; }
// Kanonischer Titel: Klammer- und Versionszusätze (Live, Remix, …) fallen weg,
// damit Varianten desselben Songs immer als richtig zählen.
function canon(s){
  return s.trim().toLowerCase()
    .replace(/\s*[\(\[].*?[\)\]]/g, ' ')
    .replace(/\s*[-–—]\s*(live|remix|remaster|acoustic|unplugged|radio\s*edit|extended|sped\s*up|slowed|stripped|demo|version)\s*$/, '')
    .replace(/[:;!?"'.,]/g, '')
    .replace(/\s+/g, ' ').trim();
}

async function init(){
  tracks = await (await fetch('tracks.json')).json();
  startDaily();
  els.play.onclick = playSnippet;
  els.guess.onclick = submitGuess;
  els.skip.onclick = () => advance(false, true);
  els.more.onclick = () => { if (stage < STAGES.length-1){ stage++; renderStage(); setFb('Mehr gehört: jetzt ' + fmt(STAGES[stage]), ''); } };
  $('freeBtn').onclick = startFree;
  $('dailyBtn').onclick = startDaily;
  $('copyBtn').onclick = () => { navigator.clipboard?.writeText(els.share.textContent); setFb('Kopiert! 📋','ok'); };
  els.input.addEventListener('input', onType);
  els.input.addEventListener('keydown', e => {
    if (e.key === 'Enter'){ const a = els.suggest.querySelector('li.active'); if (a) els.input.value = a.textContent; submitGuess(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){ e.preventDefault(); moveActive(e.key === 'ArrowDown' ? 1 : -1); }
  });
  document.addEventListener('click', e => { if (!e.target.closest('.autocomplete')) els.suggest.hidden = true; });
}
function startDaily(){ mode='daily'; seedStr = berlinDate(); beginRound(); }
function startFree(){ mode='free'; seedStr = 'free-' + Date.now() + '-' + Math.random(); beginRound(); }
function beginRound(){
  queue = pickSongs(seedStr, N_ROUNDS);
  roundIdx = 0; results = [];
  els.result.hidden = true; els.game.hidden = false;
  els.date.textContent = mode==='daily' ? '📅 Tagesrätsel ' + seedStr : '🎲 Freies Spiel';
  startSong();
}
function cur(){ return queue[roundIdx]; }
function startSong(){
  stage = 0; els.input.value=''; els.suggest.hidden = true;
  audio.pause(); clearTimeout(stopTimer);
  audio.src = 'audio/' + cur().id + '.mp3';
  audio.preload = 'auto'; audio.load();
  els.round.textContent = `Song ${roundIdx+1} / ${N_ROUNDS}`;
  renderStage(); setFb('', '');
}
function renderStage(){
  els.stageText.textContent = fmt(STAGES[stage]) + ' / 30s';
  els.stageLabel.textContent = `Versuch ${stage+1} von ${STAGES.length} · mögliche Punkte: ${(STAGES.length-stage)*100}`;
  els.dots.innerHTML = STAGES.map((_,i)=>`<span class="${i<stage?'done':i===stage?'cur':''}"></span>`).join('');
  els.fill.style.width = ((roundIdx + stage/STAGES.length) / N_ROUNDS * 100) + '%';
}
function playSnippet(){
  const t = cur();
  audio.pause(); clearTimeout(stopTimer);
  audio.currentTime = Math.min(t.onset || 0, Math.max(0, (audio.duration||30) - 1));
  audio.play().catch(()=>setFb('Audio konnte nicht abgespielt werden.','bad'));
  stopTimer = setTimeout(()=>audio.pause(), STAGES[stage]*1000);
}
function norm(s){ return s.trim().toLowerCase(); }
function submitGuess(){
  const v = els.input.value;
  if (!v.trim()){ setFb('Bitte einen Titel eingeben oder Skip drücken.','bad'); return; }
  if (canon(v) === canon(cur().title)) advance(true, false);
  else advance(false, false);
}
function advance(correct, skipped){
  audio.pause(); clearTimeout(stopTimer);
  const last = stage === STAGES.length - 1;
  if (correct){
    const pts = (STAGES.length - stage) * 100;
    results.push({ track: cur(), stage, pts, solved: true });
    setFb(`✅ Richtig! „${cur().title}" – ${pts} Punkte`, 'ok');
    setTimeout(nextSong, 1200);
  } else if (!last){
    stage++;
    renderStage();
    setFb(skipped ? `⏭ Übersprungen – jetzt ${fmt(STAGES[stage])}` : `❌ Falsch – jetzt ${fmt(STAGES[stage])}`, 'bad');
  } else {
    results.push({ track: cur(), stage, pts: 0, solved: false });
    setFb(`😢 Leider nicht. Lösung: „${cur().title}" (${cur().album})`, 'bad');
    setTimeout(nextSong, 1800);
  }
}
function nextSong(){
  roundIdx++;
  els.fill.style.width = (roundIdx / N_ROUNDS * 100) + '%';
  if (roundIdx >= N_ROUNDS) showResults();
  else startSong();
}
function boxes(st){ if (st<0) return '❌'; return ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣'][st] || '8️⃣'; }
function showResults(){
  els.game.hidden = true; els.result.hidden = false;
  const total = results.reduce((a,r)=>a+r.pts,0);
  els.rTitle.textContent = `🏁 Fertig! ${total} / ${N_ROUNDS*800} Punkte`;
  els.rLines.innerHTML = results.map((r,i)=>`<div>${r.solved?'✅':'❌'} ${i+1}. <b>${r.track.title}</b> <span style="color:var(--mut)">(${r.track.album})</span> – ${r.solved ? fmt(STAGES[r.stage])+' · '+r.pts+' P.' : 'nicht erraten'}</div>`).join('');
  const head = mode==='daily' ? `🎵 Lino Heardle ${seedStr}` : `🎵 Lino Heardle (frei)`;
  els.share.textContent = head + ` – ${total}/${N_ROUNDS*800}\n` + results.map(r=>r.solved?boxes(r.stage):'❌').join('');
  els.fill.style.width = '100%';
}
// Autocomplete
function onType(){
  const q = norm(els.input.value);
  if (!q){ els.suggest.hidden = true; return; }
  // Exakte Dubletten nur einmal zeigen; Varianten (Live, Remix, …) bleiben
  // sichtbar, zählen per canon() aber alle als richtig.
  const seen = new Set(), hits = [];
  for (const t of tracks){
    if (hits.length >= 8) break;
    const k = norm(t.title);
    if (k.includes(q) && !seen.has(k)){ seen.add(k); hits.push(t); }
  }
  if (!hits.length){ els.suggest.hidden = true; return; }
  els.suggest.innerHTML = hits.map((t,i)=>`<li class="${i===0?'active':''}">${t.title}</li>`).join('');
  els.suggest.hidden = false;
  els.suggest.querySelectorAll('li').forEach(li=>li.onclick=()=>{ els.input.value=li.textContent; els.suggest.hidden=true; els.input.focus(); });
}
function moveActive(d){
  const items = [...els.suggest.querySelectorAll('li')];
  if (!items.length) return;
  let i = items.findIndex(li=>li.classList.contains('active'));
  i = (i + d + items.length) % items.length;
  items.forEach(li=>li.classList.remove('active'));
  items[i].classList.add('active');
  items[i].scrollIntoView({block:'nearest'});
}
function setFb(msg, cls){ els.fb.textContent = msg; els.fb.className = cls; }
init();
