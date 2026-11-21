var Oe=Object.defineProperty;var qe=(S,t,s)=>t in S?Oe(S,t,{enumerable:!0,configurable:!0,writable:!0,value:s}):S[t]=s;var v=(S,t,s)=>qe(S,typeof t!="symbol"?t+"":t,s);(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))e(i);new MutationObserver(i=>{for(const o of i)if(o.type==="childList")for(const a of o.addedNodes)a.tagName==="LINK"&&a.rel==="modulepreload"&&e(a)}).observe(document,{childList:!0,subtree:!0});function s(i){const o={};return i.integrity&&(o.integrity=i.integrity),i.referrerPolicy&&(o.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?o.credentials="include":i.crossOrigin==="anonymous"?o.credentials="omit":o.credentials="same-origin",o}function e(i){if(i.ep)return;i.ep=!0;const o=s(i);fetch(i.href,o)}})();const oe=.42,Ct=3,We=.18,Ge=24,ne=[1975.53,2217.46,2489.02,2637.02,2959.96,3080],re=[523.25,659.25,783.99,987.77,1174.66],Ue={splash:75,iceFreeze:62,iceShatter:140,wallBreak:220,turbineComplete:350,magmaQuench:300,vortexFire:120,victory:800,mineExplosion:200,valveClank:75,portalWhoosh:95};function gt(S,t,s){return S<t?t:S>s?s:S}function Ne(){return typeof globalThis.performance<"u"?globalThis.performance.now():Date.now()}class _e{constructor(){v(this,"ctx",null);v(this,"unavailable",!1);v(this,"muted",!1);v(this,"masterGain",null);v(this,"busGain",null);v(this,"compressor",null);v(this,"noiseBuffer",null);v(this,"waterNoiseSource",null);v(this,"steamNoiseSource",null);v(this,"lowFlowFilter",null);v(this,"lowFlowGain",null);v(this,"rushFilter",null);v(this,"rushGain",null);v(this,"waterWarmthFilter",null);v(this,"steamHpFilter",null);v(this,"steamLpFilter",null);v(this,"steamGain",null);v(this,"turbineSine",null);v(this,"turbineTri",null);v(this,"turbineTriFilter",null);v(this,"turbineTriGain",null);v(this,"turbineGain",null);v(this,"relayNoiseSource",null);v(this,"relayCrackleFilter",null);v(this,"relayCrackleGain",null);v(this,"relayBuzzOsc",null);v(this,"relayBuzzFilter",null);v(this,"relayBuzzGain",null);v(this,"relayLfo",null);v(this,"relayLfoGain",null);v(this,"relayMasterGain",null);v(this,"smoothFlow",0);v(this,"smoothRush",0);v(this,"smoothSteam",0);v(this,"smoothRpm",0);v(this,"smoothRelay",0);v(this,"prevSplash",0);v(this,"iceChimeIndex",0);v(this,"voiceDeadlines",[]);v(this,"prevCounters",{iceFreeze:0,iceShatter:0,wallBreak:0,magmaQuench:0,turbineComplete:0,mineDetonate:0,valveToggle:0,portalPulse:0});v(this,"lastPlayedMs",{splash:-1e9,iceFreeze:-1e9,iceShatter:-1e9,wallBreak:-1e9,turbineComplete:-1e9,magmaQuench:-1e9,vortexFire:-1e9,victory:-1e9,mineExplosion:-1e9,valveClank:-1e9,portalWhoosh:-1e9})}unlock(){if(!this.unavailable)try{if(!this.ctx){const t=globalThis.AudioContext??globalThis.webkitAudioContext;if(!t){this.unavailable=!0;return}this.ctx=new t,this.initGraph(this.ctx)}if(this.ctx.state==="suspended"&&this.ctx.resume().catch(()=>{}),this.masterGain){const t=this.ctx.currentTime;this.masterGain.gain.cancelScheduledValues(t),this.masterGain.gain.setTargetAtTime(this.muted?0:oe,t,.025)}}catch{this.ctx=null,this.unavailable=!0}}setMuted(t){if(this.muted=!!t,!(!this.ctx||!this.masterGain))try{const s=this.ctx.currentTime;this.masterGain.gain.cancelScheduledValues(s),this.masterGain.gain.setTargetAtTime(this.muted?0:oe,s,.03)}catch{}}isMuted(){return this.muted}update(t,s){if(!this.ctx||this.unavailable||this.ctx.state==="closed")return;const e=Number.isFinite(s)?gt(s,.001,.25):.016,i=1-Math.exp(-e*8.5),o=this.ctx.currentTime,a=gt(t.particleCount/420,0,1),r=Math.max(0,t.avgSpeed||0),c=Math.max(0,t.kineticEnergy||0),l=1-Math.exp(-r*.42),d=gt(Math.log1p(c)/9.2,0,1),u=a*gt(.18+.52*l+.35*d,0,1),h=a*gt(.62*l+.38*d,0,1),n=gt(t.magmaSteamIntensity||0,0,1.4),p=Math.max(0,t.maxTurbineRpm||0),f=p<.05?0:gt(Math.pow(p/95,.72),0,1.15),m=gt(t.relayActiveIntensity||0,0,1.2);this.smoothFlow+=(u-this.smoothFlow)*i,this.smoothRush+=(h-this.smoothRush)*i,this.smoothSteam+=(Math.min(1,n)-this.smoothSteam)*i,this.smoothRpm+=(f-this.smoothRpm)*i,this.smoothRelay+=(Math.min(1,m)-this.smoothRelay)*i;try{if(this.lowFlowFilter&&this.lowFlowGain){const B=250+this.smoothFlow*210,E=a*(.04+this.smoothFlow*.24);this.lowFlowFilter.frequency.setTargetAtTime(B,o,.06),this.lowFlowGain.gain.setTargetAtTime(E,o,.06)}if(this.rushFilter&&this.rushGain){const B=860+this.smoothRush*760,E=a*(.005+Math.pow(this.smoothRush,1.35)*.27);this.rushFilter.frequency.setTargetAtTime(B,o,.06),this.rushGain.gain.setTargetAtTime(E,o,.06)}if(this.waterWarmthFilter){const B=1850+this.smoothRush*3100;this.waterWarmthFilter.frequency.setTargetAtTime(B,o,.07)}if(this.steamGain&&this.steamHpFilter&&(this.steamGain.gain.setTargetAtTime(this.smoothSteam*.22,o,.06),this.steamHpFilter.frequency.setTargetAtTime(2650-this.smoothSteam*700,o,.08)),this.turbineSine&&this.turbineTri&&this.turbineGain){const B=74+this.smoothRpm*112;this.turbineSine.frequency.setTargetAtTime(B,o,.07),this.turbineTri.frequency.setTargetAtTime(B*2,o,.07);const E=this.smoothRpm<.01?0:gt(this.smoothRpm*.062,0,.072);this.turbineGain.gain.setTargetAtTime(E,o,.07)}if(this.relayMasterGain&&this.relayBuzzFilter&&this.relayCrackleFilter){const B=this.smoothRelay<.008?0:gt(this.smoothRelay*.14,0,.16);this.relayMasterGain.gain.setTargetAtTime(B,o,.05),this.relayBuzzFilter.frequency.setTargetAtTime(450+this.smoothRelay*240,o,.07),this.relayCrackleFilter.frequency.setTargetAtTime(2450+this.smoothRelay*1250,o,.07)}}catch{return}const g=this.consumeCounterEdge("iceFreeze",t.iceFreezeCount),x=this.consumeCounterEdge("iceShatter",t.iceShatterCount),y=this.consumeCounterEdge("wallBreak",t.wallBreakCount),T=this.consumeCounterEdge("magmaQuench",t.magmaQuenchCount),b=this.consumeCounterEdge("turbineComplete",t.turbineCompletePulseCount),M=this.consumeCounterEdge("mineDetonate",t.mineDetonateCount),w=this.consumeCounterEdge("valveToggle",t.valveToggleCount),k=this.consumeCounterEdge("portalPulse",t.portalPulseCount);if(s<=0||this.muted||this.ctx.state!=="running"){this.prevSplash=t.splashIntensity||0;return}const C=Math.max(0,t.splashIntensity||0),A=C-this.prevSplash;this.prevSplash=C,(C>.22||C>.14&&A>.09)&&this.playSplash(gt(C,.25,1)),g&&this.playIceFreeze(),x&&this.playIceShatter(),y&&this.playWallBreak(),T&&this.playMagmaQuench(),b&&this.playTurbineComplete(),M&&this.playMineExplosion(),w&&this.playValveClank(),k&&this.playPortalWhoosh()}playSplash(t=.65){const s=this.readyForFoley("splash");if(!s||!this.busGain)return;const e=gt(t,.2,1),i=s.currentTime;try{const o=s.createOscillator(),a=s.createGain();o.type="sine";const r=330+Math.random()*65,c=890+Math.random()*140;if(o.frequency.setValueAtTime(r,i),o.frequency.exponentialRampToValueAtTime(c,i+.045),a.gain.setValueAtTime(1e-4,i),a.gain.linearRampToValueAtTime(.075*e,i+.006),a.gain.exponentialRampToValueAtTime(1e-4,i+.068),o.connect(a),a.connect(this.busGain),this.scheduleStop(o,[a],i+.075),o.start(i),this.noiseBuffer){const l=s.createBufferSource();l.buffer=this.noiseBuffer,l.loop=!0;const d=s.createBiquadFilter();d.type="bandpass",d.frequency.setValueAtTime(920+Math.random()*520,i),d.Q.setValueAtTime(1.5,i);const u=s.createGain();u.gain.setValueAtTime(1e-4,i),u.gain.linearRampToValueAtTime(.11*e,i+.007),u.gain.exponentialRampToValueAtTime(1e-4,i+.095),l.connect(d),d.connect(u),u.connect(this.busGain),this.scheduleStop(l,[d,u],i+.105),l.start(i,Math.random()*(Ct-.3))}}catch{}}playIceFreeze(){const t=this.readyForFoley("iceFreeze");if(!t||!this.busGain)return;const s=t.currentTime,e=ne[this.iceChimeIndex%ne.length]*(.985+Math.random()*.03);this.iceChimeIndex=(this.iceChimeIndex+1+Math.floor(Math.random()*2))%ne.length;try{const i=t.createBiquadFilter();i.type="lowpass",i.frequency.setValueAtTime(4800,s);const o=t.createOscillator();o.type="sine",o.frequency.setValueAtTime(e,s);const a=t.createOscillator();a.type="triangle",a.frequency.setValueAtTime(Math.min(3100,e*1.004),s);const r=t.createGain();r.gain.setValueAtTime(1e-4,s),r.gain.linearRampToValueAtTime(.068,s+.004),r.gain.exponentialRampToValueAtTime(1e-4,s+.16);const c=t.createGain();c.gain.setValueAtTime(1e-4,s),c.gain.linearRampToValueAtTime(.026,s+.004),c.gain.exponentialRampToValueAtTime(1e-4,s+.11),o.connect(r),a.connect(c),r.connect(i),c.connect(i),i.connect(this.busGain),this.scheduleStop(o,[r,i],s+.175),this.scheduleStop(a,[c],s+.125),o.start(s),a.start(s)}catch{}}playIceShatter(){const t=this.readyForFoley("iceShatter");if(!t||!this.busGain)return;const s=t.currentTime,e=[0,.022,.048,.078],i=[2420,3140,2760,3580];try{for(let r=0;r<e.length;r++){const c=s+e[r],l=i[r]*(.96+Math.random()*.08),d=t.createOscillator();d.type=r%2===0?"triangle":"sine",d.frequency.setValueAtTime(l,c),d.frequency.exponentialRampToValueAtTime(l*.94,c+.19);const u=t.createBiquadFilter();u.type="lowpass",u.frequency.setValueAtTime(5200,c);const h=t.createGain();h.gain.setValueAtTime(1e-4,c),h.gain.linearRampToValueAtTime(.068-r*.008,c+.003),h.gain.exponentialRampToValueAtTime(1e-4,c+.21),d.connect(u),u.connect(h),h.connect(this.busGain),this.scheduleStop(d,[u,h],c+.22),d.start(c)}const o=t.createOscillator();o.type="sine",o.frequency.setValueAtTime(140,s),o.frequency.exponentialRampToValueAtTime(46,s+.12);const a=t.createGain();if(a.gain.setValueAtTime(1e-4,s),a.gain.linearRampToValueAtTime(.18,s+.006),a.gain.exponentialRampToValueAtTime(1e-4,s+.15),o.connect(a),a.connect(this.busGain),this.scheduleStop(o,[a],s+.165),o.start(s),this.noiseBuffer){const r=t.createBufferSource();r.buffer=this.noiseBuffer,r.loop=!0;const c=t.createBiquadFilter();c.type="bandpass",c.frequency.setValueAtTime(3800,s),c.Q.setValueAtTime(1.8,s);const l=t.createGain();l.gain.setValueAtTime(1e-4,s),l.gain.linearRampToValueAtTime(.11,s+.003),l.gain.exponentialRampToValueAtTime(1e-4,s+.065),r.connect(c),c.connect(l),l.connect(this.busGain),this.scheduleStop(r,[c,l],s+.075),r.start(s,Math.random()*(Ct-.3))}}catch{}}playWallBreak(){const t=this.readyForFoley("wallBreak");if(!t||!this.busGain)return;const s=t.currentTime;try{const e=t.createOscillator();e.type="sine",e.frequency.setValueAtTime(118,s),e.frequency.exponentialRampToValueAtTime(32,s+.36);const i=t.createOscillator();i.type="triangle",i.frequency.setValueAtTime(155,s),i.frequency.exponentialRampToValueAtTime(44,s+.28);const o=t.createBiquadFilter();o.type="lowpass",o.frequency.setValueAtTime(240,s);const a=t.createGain();a.gain.setValueAtTime(1e-4,s),a.gain.linearRampToValueAtTime(.36,s+.01),a.gain.exponentialRampToValueAtTime(1e-4,s+.44);const r=t.createGain();if(r.gain.setValueAtTime(1e-4,s),r.gain.linearRampToValueAtTime(.16,s+.008),r.gain.exponentialRampToValueAtTime(1e-4,s+.32),e.connect(a),i.connect(o),o.connect(r),a.connect(this.busGain),r.connect(this.busGain),this.scheduleStop(e,[a],s+.46),this.scheduleStop(i,[o,r],s+.34),e.start(s),i.start(s),this.noiseBuffer){const c=[{offset:0,freq:380,q:.9,gain:.3,dur:.34},{offset:.05,freq:920,q:1.5,gain:.16,dur:.28},{offset:.13,freq:1380,q:1.8,gain:.11,dur:.25}];for(const l of c){const d=s+l.offset,u=t.createBufferSource();u.buffer=this.noiseBuffer,u.loop=!0;const h=t.createBiquadFilter();h.type=l.offset===0?"lowpass":"bandpass",h.frequency.setValueAtTime(l.freq,d),h.Q.setValueAtTime(l.q,d);const n=t.createGain();n.gain.setValueAtTime(1e-4,d),n.gain.linearRampToValueAtTime(l.gain,d+.008),n.gain.exponentialRampToValueAtTime(1e-4,d+l.dur),u.connect(h),h.connect(n),n.connect(this.busGain),this.scheduleStop(u,[h,n],d+l.dur+.02),u.start(d,Math.random()*(Ct-.5))}}}catch{}}playTurbineComplete(){const t=this.readyForFoley("turbineComplete");if(!t||!this.busGain)return;const s=t.currentTime,e=[{freq:293.66,delay:0,amp:.14,dur:.95},{freq:440,delay:.035,amp:.12,dur:.92},{freq:587.33,delay:.075,amp:.1,dur:1.05}];try{for(const i of e){const o=s+i.delay,a=t.createBiquadFilter();a.type="lowpass",a.frequency.setValueAtTime(2500,o),a.frequency.exponentialRampToValueAtTime(820,o+i.dur*.7),a.Q.setValueAtTime(1.2,o);const r=t.createOscillator();r.type="sine",r.frequency.setValueAtTime(i.freq,o);const c=t.createOscillator();c.type="triangle",c.frequency.setValueAtTime(i.freq*1.002,o);const l=t.createGain();l.gain.setValueAtTime(1e-4,o),l.gain.linearRampToValueAtTime(i.amp,o+.014),l.gain.exponentialRampToValueAtTime(1e-4,o+i.dur);const d=t.createGain();d.gain.setValueAtTime(1e-4,o),d.gain.linearRampToValueAtTime(i.amp*.65,o+.018),d.gain.exponentialRampToValueAtTime(1e-4,o+i.dur*.78),r.connect(l),c.connect(d),l.connect(a),d.connect(a),a.connect(this.busGain),this.scheduleStop(r,[l,a],o+i.dur+.03),this.scheduleStop(c,[d],o+i.dur+.03),r.start(o),c.start(o)}}catch{}}playMagmaQuench(){const t=this.readyForFoley("magmaQuench");if(!t||!this.busGain)return;const s=t.currentTime;try{if(this.noiseBuffer){const i=t.createBufferSource();i.buffer=this.noiseBuffer,i.loop=!0;const o=t.createBiquadFilter();o.type="bandpass",o.frequency.setValueAtTime(3400,s),o.frequency.exponentialRampToValueAtTime(1350,s+.58),o.Q.setValueAtTime(1.1,s);const a=t.createBiquadFilter();a.type="highpass",a.frequency.setValueAtTime(1600,s);const r=t.createGain();r.gain.setValueAtTime(1e-4,s),r.gain.linearRampToValueAtTime(.26,s+.02),r.gain.exponentialRampToValueAtTime(1e-4,s+.64),i.connect(a),a.connect(o),o.connect(r),r.connect(this.busGain),this.scheduleStop(i,[a,o,r],s+.66),i.start(s,Math.random()*(Ct-.8))}const e=[{freq:146.83,amp:.16,dur:.82},{freq:220,amp:.11,dur:.74},{freq:311.13,amp:.065,dur:.56}];for(const i of e){const o=t.createOscillator();o.type="triangle",o.frequency.setValueAtTime(i.freq,s+.02);const a=t.createBiquadFilter();a.type="lowpass",a.frequency.setValueAtTime(1350,s+.02),a.frequency.exponentialRampToValueAtTime(420,s+.02+i.dur);const r=t.createGain();r.gain.setValueAtTime(1e-4,s+.02),r.gain.linearRampToValueAtTime(i.amp,s+.032),r.gain.exponentialRampToValueAtTime(1e-4,s+.02+i.dur),o.connect(a),a.connect(r),r.connect(this.busGain),this.scheduleStop(o,[a,r],s+.04+i.dur),o.start(s+.02)}}catch{}}playVortexFire(){const t=this.readyForFoley("vortexFire");if(!t||!this.busGain)return;const s=t.currentTime;try{const e=t.createOscillator();e.type="sine",e.frequency.setValueAtTime(215,s),e.frequency.exponentialRampToValueAtTime(44,s+.14);const i=t.createGain();if(i.gain.setValueAtTime(1e-4,s),i.gain.linearRampToValueAtTime(.34,s+.007),i.gain.exponentialRampToValueAtTime(1e-4,s+.21),e.connect(i),i.connect(this.busGain),this.scheduleStop(e,[i],s+.23),e.start(s),this.noiseBuffer){const o=t.createBufferSource();o.buffer=this.noiseBuffer,o.loop=!0;const a=t.createBiquadFilter();a.type="bandpass",a.frequency.setValueAtTime(280,s),a.frequency.exponentialRampToValueAtTime(1420,s+.075),a.frequency.exponentialRampToValueAtTime(340,s+.29),a.Q.setValueAtTime(2,s);const r=t.createGain();r.gain.setValueAtTime(1e-4,s),r.gain.linearRampToValueAtTime(.28,s+.018),r.gain.exponentialRampToValueAtTime(1e-4,s+.3),o.connect(a),a.connect(r),r.connect(this.busGain),this.scheduleStop(o,[a,r],s+.32),o.start(s,Math.random()*(Ct-.4))}}catch{}}playVictory(){const t=this.readyForFoley("victory");if(!t||!this.busGain)return;const s=t.currentTime;try{for(let e=0;e<re.length;e++){const i=re[e],o=s+e*.095,a=e===re.length-1,r=a?1.35:.9,c=t.createBiquadFilter();c.type="lowpass",c.frequency.setValueAtTime(3600,o),c.frequency.exponentialRampToValueAtTime(1400,o+r);const l=t.createOscillator();l.type="sine",l.frequency.setValueAtTime(i,o);const d=t.createOscillator();d.type="triangle",d.frequency.setValueAtTime(i*1.003,o);const u=t.createGain();u.gain.setValueAtTime(1e-4,o),u.gain.linearRampToValueAtTime(a?.15:.115,o+.012),u.gain.exponentialRampToValueAtTime(1e-4,o+r);const h=t.createGain();h.gain.setValueAtTime(1e-4,o),h.gain.linearRampToValueAtTime(a?.055:.04,o+.015),h.gain.exponentialRampToValueAtTime(1e-4,o+r*.72),l.connect(u),d.connect(h),u.connect(c),h.connect(c),c.connect(this.busGain),this.scheduleStop(l,[u,c],o+r+.04),this.scheduleStop(d,[h],o+r+.04),l.start(o),d.start(o)}}catch{}}playMineExplosion(){const t=this.readyForFoley("mineExplosion");if(!t||!this.busGain)return;const s=t.currentTime;try{const e=t.createOscillator();e.type="sine",e.frequency.setValueAtTime(148,s),e.frequency.exponentialRampToValueAtTime(28,s+.36);const i=t.createGain();i.gain.setValueAtTime(1e-4,s),i.gain.linearRampToValueAtTime(.42,s+.006),i.gain.exponentialRampToValueAtTime(1e-4,s+.45),e.connect(i),i.connect(this.busGain),this.scheduleStop(e,[i],s+.48),e.start(s);const o=[{freq:392,amp:.11,dur:.42},{freq:622,amp:.075,dur:.34}];for(const r of o){const c=t.createOscillator();c.type="triangle",c.frequency.setValueAtTime(r.freq,s),c.frequency.exponentialRampToValueAtTime(r.freq*.88,s+r.dur);const l=t.createBiquadFilter();l.type="lowpass",l.frequency.setValueAtTime(1800,s),l.frequency.exponentialRampToValueAtTime(620,s+r.dur);const d=t.createGain();d.gain.setValueAtTime(1e-4,s),d.gain.linearRampToValueAtTime(r.amp,s+.005),d.gain.exponentialRampToValueAtTime(1e-4,s+r.dur),c.connect(l),l.connect(d),d.connect(this.busGain),this.scheduleStop(c,[l,d],s+r.dur+.03),c.start(s)}if(this.noiseBuffer){const r=t.createBufferSource();r.buffer=this.noiseBuffer,r.loop=!0;const c=t.createBiquadFilter();c.type="lowpass",c.frequency.setValueAtTime(680,s),c.frequency.exponentialRampToValueAtTime(130,s+.36);const l=t.createGain();l.gain.setValueAtTime(1e-4,s),l.gain.linearRampToValueAtTime(.32,s+.007),l.gain.exponentialRampToValueAtTime(1e-4,s+.38),r.connect(c),c.connect(l),l.connect(this.busGain),this.scheduleStop(r,[c,l],s+.41),r.start(s,Math.random()*(Ct-.6));const d=t.createBufferSource();d.buffer=this.noiseBuffer,d.loop=!0;const u=t.createBiquadFilter();u.type="bandpass",u.frequency.setValueAtTime(1180,s+.05),u.frequency.exponentialRampToValueAtTime(780,s+.38),u.Q.setValueAtTime(1.3,s+.05);const h=t.createGain();h.gain.setValueAtTime(1e-4,s+.05),h.gain.linearRampToValueAtTime(.16,s+.08),h.gain.exponentialRampToValueAtTime(1e-4,s+.42),d.connect(u),u.connect(h),h.connect(this.busGain),this.scheduleStop(d,[u,h],s+.45),d.start(s+.05,Math.random()*(Ct-.6))}const a=[{delay:.065,f0:320,f1:870},{delay:.125,f0:410,f1:1090},{delay:.195,f0:365,f1:940}];for(const r of a){const c=s+r.delay,l=t.createOscillator();l.type="sine",l.frequency.setValueAtTime(r.f0,c),l.frequency.exponentialRampToValueAtTime(r.f1,c+.05);const d=t.createGain();d.gain.setValueAtTime(1e-4,c),d.gain.linearRampToValueAtTime(.07,c+.006),d.gain.exponentialRampToValueAtTime(1e-4,c+.075),l.connect(d),d.connect(this.busGain),this.scheduleStop(l,[d],c+.085),l.start(c)}}catch{}}playValveClank(){const t=this.readyForFoley("valveClank");if(!t||!this.busGain)return;const s=t.currentTime;try{const e=t.createOscillator();e.type="triangle",e.frequency.setValueAtTime(280,s),e.frequency.exponentialRampToValueAtTime(140,s+.085);const i=t.createOscillator();i.type="sine",i.frequency.setValueAtTime(495,s),i.frequency.exponentialRampToValueAtTime(380,s+.09);const o=t.createBiquadFilter();o.type="lowpass",o.frequency.setValueAtTime(1450,s),o.frequency.exponentialRampToValueAtTime(520,s+.12);const a=t.createGain();a.gain.setValueAtTime(1e-4,s),a.gain.linearRampToValueAtTime(.24,s+.004),a.gain.exponentialRampToValueAtTime(1e-4,s+.13);const r=t.createGain();r.gain.setValueAtTime(1e-4,s),r.gain.linearRampToValueAtTime(.095,s+.003),r.gain.exponentialRampToValueAtTime(1e-4,s+.1),e.connect(o),o.connect(a),a.connect(this.busGain),i.connect(r),r.connect(this.busGain),this.scheduleStop(e,[o,a],s+.15),this.scheduleStop(i,[r],s+.12),e.start(s),i.start(s);const c=t.createOscillator();c.type="sine",c.frequency.setValueAtTime(1750,s+.014),c.frequency.exponentialRampToValueAtTime(980,s+.036);const l=t.createGain();if(l.gain.setValueAtTime(1e-4,s+.014),l.gain.linearRampToValueAtTime(.085,s+.017),l.gain.exponentialRampToValueAtTime(1e-4,s+.048),c.connect(l),l.connect(this.busGain),this.scheduleStop(c,[l],s+.055),c.start(s+.014),this.noiseBuffer){const d=t.createBufferSource();d.buffer=this.noiseBuffer,d.loop=!0;const u=t.createBiquadFilter();u.type="bandpass",u.frequency.setValueAtTime(2600,s),u.Q.setValueAtTime(2.6,s);const h=t.createGain();h.gain.setValueAtTime(1e-4,s),h.gain.linearRampToValueAtTime(.11,s+.002),h.gain.exponentialRampToValueAtTime(1e-4,s+.032),d.connect(u),u.connect(h),h.connect(this.busGain),this.scheduleStop(d,[u,h],s+.04),d.start(s,Math.random()*(Ct-.2))}}catch{}}playPortalWhoosh(){const t=this.readyForFoley("portalWhoosh");if(!t||!this.busGain)return;const s=t.currentTime;try{const e=t.createBiquadFilter();e.type="lowpass",e.frequency.setValueAtTime(2500,s);const i=t.createOscillator();i.type="sine",i.frequency.setValueAtTime(360,s),i.frequency.exponentialRampToValueAtTime(1120,s+.11),i.frequency.exponentialRampToValueAtTime(540,s+.32);const o=t.createOscillator();o.type="triangle",o.frequency.setValueAtTime(362,s),o.frequency.exponentialRampToValueAtTime(1127,s+.11),o.frequency.exponentialRampToValueAtTime(543,s+.32);const a=t.createGain();a.gain.setValueAtTime(1e-4,s),a.gain.linearRampToValueAtTime(.135,s+.045),a.gain.exponentialRampToValueAtTime(1e-4,s+.35);const r=t.createGain();if(r.gain.setValueAtTime(1e-4,s),r.gain.linearRampToValueAtTime(.05,s+.05),r.gain.exponentialRampToValueAtTime(1e-4,s+.33),i.connect(a),o.connect(r),a.connect(e),r.connect(e),e.connect(this.busGain),this.scheduleStop(i,[a,e],s+.37),this.scheduleStop(o,[r],s+.36),i.start(s),o.start(s),this.noiseBuffer){const c=t.createBufferSource();c.buffer=this.noiseBuffer,c.loop=!0;const l=t.createBiquadFilter();l.type="bandpass",l.frequency.setValueAtTime(760,s),l.frequency.exponentialRampToValueAtTime(2200,s+.11),l.frequency.exponentialRampToValueAtTime(1020,s+.33),l.Q.setValueAtTime(1.85,s);const d=t.createGain();d.gain.setValueAtTime(1e-4,s),d.gain.linearRampToValueAtTime(.19,s+.04),d.gain.exponentialRampToValueAtTime(1e-4,s+.35),c.connect(l),l.connect(d),d.connect(this.busGain),this.scheduleStop(c,[l,d],s+.37),c.start(s,Math.random()*(Ct-.5))}}catch{}}initGraph(t){const s=t.currentTime;this.busGain=t.createGain(),this.busGain.gain.setValueAtTime(1,s),this.compressor=t.createDynamicsCompressor(),this.compressor.threshold.setValueAtTime(-11,s),this.compressor.knee.setValueAtTime(18,s),this.compressor.ratio.setValueAtTime(4,s),this.compressor.attack.setValueAtTime(.004,s),this.compressor.release.setValueAtTime(.15,s),this.masterGain=t.createGain(),this.masterGain.gain.setValueAtTime(this.muted?0:oe,s),this.busGain.connect(this.compressor),this.compressor.connect(this.masterGain),this.masterGain.connect(t.destination),this.noiseBuffer=this.buildPinkBrownNoiseBuffer(t),this.waterNoiseSource=t.createBufferSource(),this.waterNoiseSource.buffer=this.noiseBuffer,this.waterNoiseSource.loop=!0,this.lowFlowFilter=t.createBiquadFilter(),this.lowFlowFilter.type="bandpass",this.lowFlowFilter.frequency.setValueAtTime(320,s),this.lowFlowFilter.Q.setValueAtTime(.9,s),this.lowFlowGain=t.createGain(),this.lowFlowGain.gain.setValueAtTime(0,s),this.rushFilter=t.createBiquadFilter(),this.rushFilter.type="bandpass",this.rushFilter.frequency.setValueAtTime(1150,s),this.rushFilter.Q.setValueAtTime(1.15,s),this.rushGain=t.createGain(),this.rushGain.gain.setValueAtTime(0,s),this.waterWarmthFilter=t.createBiquadFilter(),this.waterWarmthFilter.type="lowpass",this.waterWarmthFilter.frequency.setValueAtTime(2600,s),this.waterWarmthFilter.Q.setValueAtTime(.65,s),this.waterNoiseSource.connect(this.lowFlowFilter),this.lowFlowFilter.connect(this.lowFlowGain),this.lowFlowGain.connect(this.waterWarmthFilter),this.waterNoiseSource.connect(this.rushFilter),this.rushFilter.connect(this.rushGain),this.rushGain.connect(this.waterWarmthFilter),this.waterWarmthFilter.connect(this.busGain),this.waterNoiseSource.start(s),this.steamNoiseSource=t.createBufferSource(),this.steamNoiseSource.buffer=this.noiseBuffer,this.steamNoiseSource.loop=!0,this.steamHpFilter=t.createBiquadFilter(),this.steamHpFilter.type="highpass",this.steamHpFilter.frequency.setValueAtTime(2400,s),this.steamHpFilter.Q.setValueAtTime(.7,s),this.steamLpFilter=t.createBiquadFilter(),this.steamLpFilter.type="lowpass",this.steamLpFilter.frequency.setValueAtTime(7200,s),this.steamGain=t.createGain(),this.steamGain.gain.setValueAtTime(0,s),this.steamNoiseSource.connect(this.steamHpFilter),this.steamHpFilter.connect(this.steamLpFilter),this.steamLpFilter.connect(this.steamGain),this.steamGain.connect(this.busGain),this.steamNoiseSource.start(s,.9),this.turbineSine=t.createOscillator(),this.turbineSine.type="sine",this.turbineSine.frequency.setValueAtTime(78,s),this.turbineTri=t.createOscillator(),this.turbineTri.type="triangle",this.turbineTri.frequency.setValueAtTime(156,s),this.turbineTriFilter=t.createBiquadFilter(),this.turbineTriFilter.type="lowpass",this.turbineTriFilter.frequency.setValueAtTime(640,s),this.turbineTriGain=t.createGain(),this.turbineTriGain.gain.setValueAtTime(.28,s),this.turbineGain=t.createGain(),this.turbineGain.gain.setValueAtTime(0,s),this.turbineSine.connect(this.turbineGain),this.turbineTri.connect(this.turbineTriFilter),this.turbineTriFilter.connect(this.turbineTriGain),this.turbineTriGain.connect(this.turbineGain),this.turbineGain.connect(this.busGain),this.turbineSine.start(s),this.turbineTri.start(s),this.relayMasterGain=t.createGain(),this.relayMasterGain.gain.setValueAtTime(0,s),this.relayNoiseSource=t.createBufferSource(),this.relayNoiseSource.buffer=this.noiseBuffer,this.relayNoiseSource.loop=!0,this.relayCrackleFilter=t.createBiquadFilter(),this.relayCrackleFilter.type="bandpass",this.relayCrackleFilter.frequency.setValueAtTime(2800,s),this.relayCrackleFilter.Q.setValueAtTime(3.2,s),this.relayCrackleGain=t.createGain(),this.relayCrackleGain.gain.setValueAtTime(.58,s),this.relayBuzzOsc=t.createOscillator(),this.relayBuzzOsc.type="sawtooth",this.relayBuzzOsc.frequency.setValueAtTime(120,s),this.relayBuzzFilter=t.createBiquadFilter(),this.relayBuzzFilter.type="bandpass",this.relayBuzzFilter.frequency.setValueAtTime(520,s),this.relayBuzzFilter.Q.setValueAtTime(2.4,s),this.relayBuzzGain=t.createGain(),this.relayBuzzGain.gain.setValueAtTime(.28,s),this.relayLfo=t.createOscillator(),this.relayLfo.type="sine",this.relayLfo.frequency.setValueAtTime(18,s),this.relayLfoGain=t.createGain(),this.relayLfoGain.gain.setValueAtTime(620,s),this.relayLfo.connect(this.relayLfoGain),this.relayLfoGain.connect(this.relayCrackleFilter.frequency),this.relayNoiseSource.connect(this.relayCrackleFilter),this.relayCrackleFilter.connect(this.relayCrackleGain),this.relayCrackleGain.connect(this.relayMasterGain),this.relayBuzzOsc.connect(this.relayBuzzFilter),this.relayBuzzFilter.connect(this.relayBuzzGain),this.relayBuzzGain.connect(this.relayMasterGain),this.relayMasterGain.connect(this.busGain),this.relayNoiseSource.start(s,1.55),this.relayBuzzOsc.start(s),this.relayLfo.start(s)}consumeCounterEdge(t,s){const e=s||0,i=this.prevCounters[t];return this.prevCounters[t]=e,e>i}buildPinkBrownNoiseBuffer(t){const s=t.sampleRate||44100,e=Math.max(1,Math.floor(s*Ct)),i=Math.min(Math.floor(s*We),Math.floor(e*.25)),o=e+i,a=t.createBuffer(2,e,s);for(let r=0;r<2;r++){const c=new Float32Array(o);let l=0,d=0,u=0,h=0,n=0,p=0,f=0,m=0;for(let x=0;x<o;x++){const y=Math.random()*2-1;l=.99886*l+y*.0555179,d=.99332*d+y*.0750759,u=.969*u+y*.153852,h=.8665*h+y*.3104856,n=.55*n+y*.5329522,p=-.7616*p-y*.016898;const T=(l+d+u+h+n+p+f+y*.5362)*.065;f=y*.115926,m=m*.986+y*.095,c[x]=gt(T*.72+m*.42,-.85,.85)}const g=a.getChannelData(r);for(let x=0;x<e;x++)if(x<i){const y=x/i,T=Math.sin(y*Math.PI*.5),b=Math.cos(y*Math.PI*.5);g[x]=c[x]*T+c[e+x]*b}else g[x]=c[x]}return a}readyForFoley(t){if(!this.ctx||this.unavailable||this.muted||this.ctx.state!=="running")return null;const s=this.ctx.currentTime;for(let i=this.voiceDeadlines.length-1;i>=0;i--)this.voiceDeadlines[i]<=s&&this.voiceDeadlines.splice(i,1);if(this.voiceDeadlines.length>=Ge)return null;const e=Ne();return e-this.lastPlayedMs[t]<Ue[t]?null:(this.lastPlayedMs[t]=e,this.ctx)}scheduleStop(t,s,e){this.voiceDeadlines.push(e);let i=!1;const o=()=>{if(i)return;i=!0;const a=this.voiceDeadlines.indexOf(e);a!==-1&&this.voiceDeadlines.splice(a,1);try{t.disconnect();for(const r of s)r.disconnect()}catch{}};t.onended=o,t.stop(e)}}const K=16,Q=9,F=128,q=72,$=.125,G=8,Mt=-11.5,ct=7500,ft=1800,Tt=900,ve=250,ut=.042,ot={AIR:0,FLUID:1,SOLID:2},ht={NONE:0,ROCK:1,ICE:2,GATE:3,CRACKED_WALL:4,OBSIDIAN:5},Kt=.09,jt=.42,Te=16,ze=.12,He=.5,Ye=.8660254;class Xe{constructor(t,s){v(this,"stageEl");v(this,"callbacks");v(this,"enabled",!0);v(this,"sandbox",!1);v(this,"activeTool","surge");v(this,"pointerWorld",{x:K*.5,y:Q*.5,inside:!1});v(this,"activePointerId",null);v(this,"isPrimaryDown",!1);v(this,"isSecondaryDown",!1);v(this,"hasInteracted",!1);v(this,"vx",0);v(this,"vy",0);v(this,"prevStepX",K*.5);v(this,"prevStepY",Q*.5);v(this,"lastStrokeX",0);v(this,"lastStrokeY",0);v(this,"isChargingVortex",!1);v(this,"chargePos");v(this,"chargeTime",0);v(this,"releaseBurst");v(this,"shiftHeld",!1);v(this,"slowMoToggled",!1);v(this,"handleContextMenu",t=>{t.preventDefault()});v(this,"handlePointerDown",t=>{var a,r;if(this.callbacks.onUserGesture(),!this.enabled||t.button!==0&&t.button!==2||this.activePointerId!==null)return;const{wx:s,wy:e,inside:i}=this.clientToWorld(t.clientX,t.clientY);if(this.pointerWorld.x=s,this.pointerWorld.y=e,this.pointerWorld.inside=i,t.button===0&&((r=(a=this.callbacks).onTryClickWorld)!=null&&r.call(a,s,e))){this.hasInteracted||(this.hasInteracted=!0,this.callbacks.onFirstInteract());return}this.hasInteracted||(this.hasInteracted=!0,this.callbacks.onFirstInteract());const o=t.button===2;this.activePointerId=t.pointerId,this.isPrimaryDown=!o,this.isSecondaryDown=o;try{this.stageEl.setPointerCapture(t.pointerId)}catch{}this.prevStepX=s,this.prevStepY=e,this.vx=0,this.vy=0,this.activeTool==="ice"||this.activeTool==="rock"?(this.lastStrokeX=s,this.lastStrokeY=e,this.emitStrokePoint(s,e,o)):this.activeTool==="vortex"&&!o&&(this.chargePos={x:s,y:e},this.chargeTime=0,this.isChargingVortex=!0,this.releaseBurst=void 0)});v(this,"handlePointerMove",t=>{var a,r;const{wx:s,wy:e,inside:i}=this.clientToWorld(t.clientX,t.clientY);this.pointerWorld.x=s,this.pointerWorld.y=e,this.pointerWorld.inside=i;const o=this.isPrimaryDown||this.isSecondaryDown;if(!o){const c=this.enabled&&i&&!!((r=(a=this.callbacks).isHoveringInteractive)!=null&&r.call(a,s,e));this.stageEl.style.cursor=c?"pointer":"crosshair"}if(this.enabled&&!(this.activePointerId!==null&&t.pointerId!==this.activePointerId)&&o&&(this.activeTool==="ice"||this.activeTool==="rock")){const c=s-this.lastStrokeX,l=e-this.lastStrokeY,d=Math.hypot(c,l);if(d>=Kt){const u=Math.floor(d/Kt),h=1/d;for(let p=1;p<=u;p++){const f=p*Kt,m=this.lastStrokeX+c*f*h,g=this.lastStrokeY+l*f*h;this.emitStrokePoint(m,g,this.isSecondaryDown)}const n=u*Kt*h;this.lastStrokeX+=c*n,this.lastStrokeY+=l*n}}});v(this,"handlePointerUp",t=>{var a,r;if(this.activePointerId!==null&&t.pointerId!==this.activePointerId)return;const{wx:s,wy:e,inside:i}=this.clientToWorld(t.clientX,t.clientY);if(this.pointerWorld.x=s,this.pointerWorld.y=e,this.pointerWorld.inside=i,this.enabled&&(this.isPrimaryDown||this.isSecondaryDown)){if((this.activeTool==="ice"||this.activeTool==="rock")&&Math.hypot(s-this.lastStrokeX,e-this.lastStrokeY)>=.025)this.emitStrokePoint(s,e,this.isSecondaryDown);else if(this.activeTool==="vortex"&&this.isChargingVortex&&this.chargePos){const c=s-this.chargePos.x,l=e-this.chargePos.y,d=Math.hypot(c,l);let u=He,h=Ye;d>ze&&(u=c/d,h=l/d);const n=Math.min(1,.35+this.chargeTime*.9)*14.5;this.releaseBurst={x:this.chargePos.x,y:this.chargePos.y,dirX:u,dirY:h,strength:n},this.callbacks.onVortexFire()}}this.cancelActivePointer();const o=this.enabled&&i&&!!((r=(a=this.callbacks).isHoveringInteractive)!=null&&r.call(a,s,e));this.stageEl.style.cursor=o?"pointer":"crosshair"});v(this,"handlePointerCancel",t=>{this.activePointerId!==null&&t.pointerId!==this.activePointerId||(this.cancelActivePointer(),this.stageEl.style.cursor="crosshair")});v(this,"handlePointerLeave",()=>{this.pointerWorld.inside=!1,!this.isPrimaryDown&&!this.isSecondaryDown&&(this.stageEl.style.cursor="crosshair")});v(this,"handleKeyDown",t=>{if(this.shouldIgnoreKeyEvent(t))return;if(this.callbacks.onUserGesture(),t.code==="Escape"){t.repeat||(t.preventDefault(),this.callbacks.onToggleMenu());return}if(t.code==="KeyM"){t.repeat||(t.preventDefault(),this.callbacks.onToggleMute());return}if(!this.enabled)return;if(t.code==="Space"||t.key===" "){t.preventDefault(),t.repeat||this.callbacks.onShatterIce();return}if(t.key==="Shift"||t.code==="ShiftLeft"||t.code==="ShiftRight"){!t.repeat&&!this.shiftHeld&&(this.shiftHeld=!0,this.callbacks.onSlowMoChange(!0));return}if(t.repeat)return;if(t.code==="KeyT"){this.slowMoToggled=!this.slowMoToggled,this.callbacks.onSlowMoChange(this.shiftHeld||this.slowMoToggled);return}if(t.code==="KeyR"){this.callbacks.onRestart();return}const s=this.mapShortcutToTool(t);s&&(this.setActiveTool(s),this.callbacks.onToolChange(s))});v(this,"handleKeyUp",t=>{(t.key==="Shift"||t.code==="ShiftLeft"||t.code==="ShiftRight")&&this.shiftHeld&&(this.shiftHeld=!1,this.callbacks.onSlowMoChange(this.slowMoToggled))});v(this,"handleWindowBlur",()=>{this.cancelActivePointer(),this.shiftHeld&&(this.shiftHeld=!1,this.callbacks.onSlowMoChange(this.slowMoToggled))});this.stageEl=t,this.callbacks=s,this.stageEl.addEventListener("pointerdown",this.handlePointerDown),this.stageEl.addEventListener("pointermove",this.handlePointerMove),this.stageEl.addEventListener("pointerup",this.handlePointerUp),this.stageEl.addEventListener("pointercancel",this.handlePointerCancel),this.stageEl.addEventListener("pointerleave",this.handlePointerLeave),this.stageEl.addEventListener("contextmenu",this.handleContextMenu),window.addEventListener("keydown",this.handleKeyDown),window.addEventListener("keyup",this.handleKeyUp),window.addEventListener("blur",this.handleWindowBlur)}setEnabled(t){this.enabled=t,t||(this.cancelActivePointer(),this.stageEl.style.cursor="crosshair",this.shiftHeld&&(this.shiftHeld=!1,this.callbacks.onSlowMoChange(this.slowMoToggled)))}setSandbox(t){this.sandbox=t,!t&&(this.activeTool==="pour"||this.activeTool==="drain"||this.activeTool==="rock")&&(this.setActiveTool("surge"),this.callbacks.onToolChange("surge"))}setActiveTool(t){this.activeTool!==t&&(this.activeTool=t,t!=="vortex"&&(this.isChargingVortex=!1,this.chargePos=void 0,this.chargeTime=0))}getActiveTool(){return this.activeTool}setSlowMo(t){this.slowMoToggled=t}getPointerWorld(){return{x:this.pointerWorld.x,y:this.pointerWorld.y,inside:this.pointerWorld.inside}}update(t){if(t>1e-4){if(this.isPrimaryDown||this.isSecondaryDown){const s=(this.pointerWorld.x-this.prevStepX)/t,e=(this.pointerWorld.y-this.prevStepY)/t;this.vx=this.vx*(1-jt)+s*jt,this.vy=this.vy*(1-jt)+e*jt;const i=Math.hypot(this.vx,this.vy);if(i>Te){const o=Te/i;this.vx*=o,this.vy*=o}}else this.vx=0,this.vy=0;this.isChargingVortex&&this.isPrimaryDown&&(this.chargeTime+=t)}this.prevStepX=this.pointerWorld.x,this.prevStepY=this.pointerWorld.y}getToolInput(){const t=this.activeTool==="ice"||this.activeTool==="rock";return{tool:this.activeTool,active:t?this.isPrimaryDown||this.isSecondaryDown:this.isPrimaryDown,secondary:this.isSecondaryDown,x:this.pointerWorld.x,y:this.pointerWorld.y,vx:this.vx,vy:this.vy,chargePos:this.chargePos?{x:this.chargePos.x,y:this.chargePos.y}:void 0,chargeTime:this.chargeTime,releaseBurst:this.releaseBurst?{...this.releaseBurst}:void 0}}consumeBurst(){this.releaseBurst=void 0}dispose(){this.stageEl.removeEventListener("pointerdown",this.handlePointerDown),this.stageEl.removeEventListener("pointermove",this.handlePointerMove),this.stageEl.removeEventListener("pointerup",this.handlePointerUp),this.stageEl.removeEventListener("pointercancel",this.handlePointerCancel),this.stageEl.removeEventListener("pointerleave",this.handlePointerLeave),this.stageEl.removeEventListener("contextmenu",this.handleContextMenu),window.removeEventListener("keydown",this.handleKeyDown),window.removeEventListener("keyup",this.handleKeyUp),window.removeEventListener("blur",this.handleWindowBlur)}clientToWorld(t,s){const e=this.stageEl.getBoundingClientRect();if(e.width<=0||e.height<=0)return{wx:K*.5,wy:Q*.5,inside:!1};const i=(t-e.left)/e.width*K,o=(1-(s-e.top)/e.height)*Q,a=t>=e.left&&t<=e.right&&s>=e.top&&s<=e.bottom;return{wx:i,wy:o,inside:a}}emitStrokePoint(t,s,e){const i=Math.max(0,Math.min(K,t)),o=Math.max(0,Math.min(Q,s));this.activeTool==="ice"?e?this.callbacks.onEraseIce(i,o):this.callbacks.onPaintIce(i,o):this.activeTool==="rock"&&this.callbacks.onPaintRock(i,o,e)}cancelActivePointer(){this.activePointerId!==null&&this.releaseCaptureSafe(this.activePointerId),this.activePointerId=null,this.isPrimaryDown=!1,this.isSecondaryDown=!1,this.isChargingVortex=!1,this.chargePos=void 0,this.chargeTime=0,this.vx=0,this.vy=0}releaseCaptureSafe(t){try{this.stageEl.hasPointerCapture(t)&&this.stageEl.releasePointerCapture(t)}catch{}}shouldIgnoreKeyEvent(t){if(t.metaKey||t.ctrlKey||t.altKey)return!0;const s=t.target;if(!s)return!1;const e=s.tagName;return e==="INPUT"||e==="TEXTAREA"||s.isContentEditable}mapShortcutToTool(t){if(t.key==="1"||t.code==="Digit1")return"surge";if(t.key==="2"||t.code==="Digit2")return"ice";if(t.key==="3"||t.code==="Digit3")return"vortex";if(this.sandbox){if(t.key==="4"||t.code==="Digit4")return"pour";if(t.key==="5"||t.code==="Digit5")return"drain";if(t.key==="6"||t.code==="Digit6")return"rock"}return null}}const Ke=[{kind:"rect",x:0,y:0,w:.5,h:9},{kind:"rect",x:15.5,y:0,w:.5,h:9},{kind:"rect",x:0,y:8.5,w:16,h:.5}];function Bt(S,t){const s=t.filter(o=>o.y<.5&&o.y+o.h>0).map(o=>({x0:Math.max(.5,o.x),x1:Math.min(15.5,o.x+o.w)})).filter(o=>o.x1>o.x0).sort((o,a)=>o.x0-a.x0),e=[{kind:"rect",x:0,y:0,w:.5,h:.5},{kind:"rect",x:15.5,y:0,w:.5,h:.5}];let i=.5;for(const o of s)o.x0>i&&e.push({kind:"rect",x:i,y:0,w:Number((o.x0-i).toFixed(4)),h:.5}),i=Math.max(i,o.x1);return i<15.5&&e.push({kind:"rect",x:i,y:0,w:Number((15.5-i).toFixed(4)),h:.5}),[...Ke,...e,...S]}function xt(S,t){const s=Math.sqrt(S*S+t*t)||1;return[Number((S/s).toFixed(4)),Number((t/s).toFixed(4))]}function wt(S,t){const[s,e]=xt(S,t);return{dirX:s,dirY:e}}function ie(S,t){const[s,e]=xt(S,t);return{outDirX:s,outDirY:e}}const Pt={twilightTeal:{skyTop:[.05,.11,.19],skyBottom:[.12,.28,.35],rockTint:[.25,.32,.35],waterDeep:[.03,.23,.36],waterShallow:[.18,.76,.82],lightDir:xt(.52,.85),sunColor:[1,.86,.66],ambientLanterns:[{x:1.8,y:6.9,color:[.32,.88,.94],radius:3.2},{x:6.1,y:4.8,color:[.98,.74,.34],radius:2.8},{x:9.8,y:2.9,color:[1,.78,.38],radius:3},{x:14.3,y:1.4,color:[.35,.9,1],radius:2.8}]},sunlitEmerald:{skyTop:[.07,.19,.21],skyBottom:[.24,.46,.39],rockTint:[.31,.37,.31],waterDeep:[.03,.26,.29],waterShallow:[.22,.82,.72],lightDir:xt(.6,.8),sunColor:[1,.92,.7],ambientLanterns:[{x:1.9,y:5.7,color:[1,.82,.4],radius:2.8},{x:5,y:2.8,color:[.45,.95,.82],radius:3},{x:11.6,y:4.5,color:[1,.8,.38],radius:3.2}]},canyonAmber:{skyTop:[.15,.1,.19],skyBottom:[.43,.25,.18],rockTint:[.41,.31,.24],waterDeep:[.04,.21,.42],waterShallow:[.24,.7,.88],lightDir:xt(-.48,.88),sunColor:[1,.78,.5],ambientLanterns:[{x:4.8,y:3.5,color:[.38,.84,1],radius:3},{x:9.2,y:2.6,color:[.32,.78,.96],radius:3},{x:14,y:3.8,color:[1,.82,.42],radius:3.1}]},stormBasalt:{skyTop:[.07,.09,.15],skyBottom:[.19,.27,.34],rockTint:[.25,.28,.32],waterDeep:[.04,.2,.39],waterShallow:[.28,.76,.94],lightDir:xt(.45,.89),sunColor:[.84,.92,1],ambientLanterns:[{x:4.5,y:5.2,color:[1,.58,.24],radius:2.8},{x:9.4,y:2.1,color:[.35,.85,.95],radius:2.9},{x:13.3,y:2.2,color:[1,.76,.38],radius:3}]},deepSapphire:{skyTop:[.03,.06,.16],skyBottom:[.09,.19,.38],rockTint:[.26,.3,.41],waterDeep:[.02,.15,.45],waterShallow:[.22,.74,.99],lightDir:xt(0,1),sunColor:[.72,.86,1],ambientLanterns:[{x:4.5,y:5.3,color:[.38,.88,1],radius:3},{x:10.4,y:1.5,color:[1,.72,.28],radius:3.2},{x:8,y:7.4,color:[.32,.92,1],radius:3.2},{x:11.5,y:5.3,color:[.38,.88,1],radius:3}]},volcanicObsidian:{skyTop:[.11,.05,.06],skyBottom:[.29,.11,.08],rockTint:[.22,.2,.23],waterDeep:[.04,.22,.31],waterShallow:[.24,.76,.8],lightDir:xt(-.4,.92),sunColor:[1,.68,.44],ambientLanterns:[{x:7.7,y:1.4,color:[1,.42,.14],radius:3},{x:13,y:1.5,color:[1,.46,.16],radius:3.1},{x:13.2,y:7.1,color:[.4,.92,.96],radius:2.8}]},templeGold:{skyTop:[.1,.09,.2],skyBottom:[.3,.23,.27],rockTint:[.38,.34,.27],waterDeep:[.04,.25,.36],waterShallow:[.25,.8,.82],lightDir:xt(.25,.97),sunColor:[1,.88,.58],ambientLanterns:[{x:4,y:3.2,color:[.36,.88,1],radius:2.8},{x:7.4,y:2.4,color:[.35,.95,.88],radius:3},{x:9.5,y:5.3,color:[1,.78,.34],radius:3},{x:13.8,y:2,color:[1,.84,.42],radius:3}]},royalCrown:{skyTop:[.08,.05,.17],skyBottom:[.24,.16,.33],rockTint:[.29,.27,.37],waterDeep:[.04,.2,.46],waterShallow:[.28,.84,.97],lightDir:xt(.42,.91),sunColor:[1,.86,.56],ambientLanterns:[{x:4.4,y:4.5,color:[1,.8,.34],radius:3},{x:8.6,y:6.1,color:[.36,.92,1],radius:2.8},{x:11.7,y:4.2,color:[1,.46,.18],radius:2.7},{x:14.2,y:6.4,color:[1,.84,.42],radius:3.2}]},labCyan:{skyTop:[.05,.12,.2],skyBottom:[.13,.29,.41],rockTint:[.28,.34,.41],waterDeep:[.03,.26,.45],waterShallow:[.24,.86,.96],lightDir:xt(-.35,.94),sunColor:[.92,.97,1],ambientLanterns:[{x:8,y:6.8,color:[.32,.92,1],radius:3.4},{x:4.6,y:2.2,color:[.36,.88,.86],radius:3},{x:12.6,y:5.1,color:[1,.78,.38],radius:3}]}},Me=[{x:13.8,y:0,w:1.7,h:.68}],le={id:"demo",index:0,titleKey:"lvl.demo.title",subtitleKey:"lvl.demo.sub",hintKey:"lvl.demo.hint",parTime:60,maxFrostCells:800,maxTotalParticles:3800,theme:Pt.twilightTeal,solids:Bt([{kind:"rect",x:.5,y:7.9,w:1.9,h:.6},{kind:"rect",x:.5,y:.5,w:2,h:4.8},{kind:"rect",x:2.5,y:.5,w:3.2,h:.6},{kind:"poly",points:[[.5,5.3],[4.4,5.3],[4.4,5.75],[.5,6.1]]},{kind:"poly",points:[[5.4,3.25],[8.6,3.25],[8.6,3.65],[5.4,3.9]]},{kind:"circle",x:3.3,y:2.8,r:.45},{kind:"rect",x:13,y:.5,w:.5,h:1.5}],Me),spouts:[{id:"spout-demo",x:1.4,y:7.4,...wt(.92,-.39),speed:3.8,rate:250,radius:.22,maxParticles:1e6,enabled:!0}],pools:[{x:5.9,y:.55,w:6.9,h:1.35,fillFactor:.86}],drains:Me,turbines:[{id:"turbine-demo",x:9.7,y:2.9,radius:.82,targetCharge:1,decayRate:.02,lockOnFull:!1}],bodies:[{id:"ark-demo",kind:"ark",x:11.2,y:1.75,w:1.05,h:.52,density:.52}],goals:[],cisterns:[],gates:[],crackedWalls:[],magmaVents:[],seesaws:[{id:"seesaw-demo",x:6,y:4.75,length:2.3,thickness:.16,maxAngle:.34,restAngle:.1,damping:1.8}],portals:[{id:"portal-demo",inX:14.4,inY:1.45,outX:2.9,outY:7.3,...ie(.86,-.51),radius:.52,boost:1.35}]},we=[{x:.5,y:0,w:1.6,h:.68},{x:14,y:0,w:1.5,h:.68}],je={id:"level-1",index:1,titleKey:"lvl.1.title",subtitleKey:"lvl.1.sub",hintKey:"lvl.1.hint",parTime:25,maxFrostCells:450,maxTotalParticles:3600,theme:Pt.sunlitEmerald,solids:Bt([{kind:"rect",x:2.4,y:.5,w:.45,h:3.6},{kind:"rect",x:7.3,y:.5,w:.65,h:4},{kind:"rect",x:9.2,y:3.2,w:4.8,h:.4},{kind:"poly",points:[[7.95,.5],[14,.5],[7.95,.85]]}],we),spouts:[{id:"spout-1",x:1.5,y:7.4,...wt(.32,-.947),speed:3.3,rate:260,radius:.22,maxParticles:1e6,enabled:!0}],pools:[{x:2.95,y:.55,w:4.25,h:1.75,fillFactor:.88}],drains:we,turbines:[{id:"turbine-1",x:11.6,y:4.5,radius:.85,targetCharge:1,decayRate:.04,lockOnFull:!0}],bodies:[],goals:[],cisterns:[],gates:[],crackedWalls:[],magmaVents:[],valves:[{id:"valve-1",x:1.9,y:5.7,length:1.7,thickness:.18,angleA:.62,angleB:-.52,initialToggled:!1}]},ke=[{x:.5,y:0,w:1.6,h:.68},{x:14.95,y:0,w:.55,h:2.75}],$e={id:"level-2",index:2,titleKey:"lvl.2.title",subtitleKey:"lvl.2.sub",hintKey:"lvl.2.hint",parTime:35,maxFrostCells:550,maxTotalParticles:3800,theme:Pt.canyonAmber,solids:Bt([{kind:"rect",x:2.25,y:.5,w:.6,h:4.3},{kind:"rect",x:2.25,y:6.25,w:.6,h:2.25},{kind:"rect",x:2.85,y:.5,w:4,h:2.5},{kind:"rect",x:6.85,y:.5,w:.5,h:3.4},{kind:"rect",x:7.35,y:.5,w:3.85,h:1.1},{kind:"poly",points:[[10.2,1.6],[11.2,1.6],[11.2,2.5]]},{kind:"rect",x:11.2,y:.5,w:3.75,h:2},{kind:"rect",x:14.65,y:2.5,w:.3,h:.25},{kind:"rect",x:11.4,y:5.1,w:.45,h:3.4}],ke),spouts:[{id:"spout-2",x:1.32,y:7.5,...wt(-.06,-.998),speed:3.1,rate:280,radius:.22,maxParticles:1e6,enabled:!0}],pools:[{x:7.45,y:1.65,w:2.65,h:1,fillFactor:.88}],drains:ke,turbines:[],bodies:[{id:"ark-1",kind:"ark",x:9.2,y:2.3,w:1.05,h:.52,density:.52}],goals:[{id:"altar-2",bodyId:"ark-1",x:13,y:2.55,w:2,h:2.5}],cisterns:[],gates:[{id:"gate-1",x:11.4,y:2.5,w:.45,h:2.6,openOffsetX:0,openOffsetY:2.6,requiredTriggerIds:["relay-1"],speed:1.6}],crackedWalls:[],magmaVents:[],valves:[{id:"valve-2",x:1.62,y:5.75,length:1.5,thickness:.18,angleA:.72,angleB:-.52,initialToggled:!1}],relays:[{id:"relay-1",ax:3.4,ay:3.35,bx:6.2,by:3.35,radius:.48,linkedGateId:"gate-1",isObjective:!0}]},Ce=[{x:.5,y:0,w:1.5,h:.68},{x:14.15,y:0,w:1.35,h:.68}],Qe={id:"level-3",index:3,titleKey:"lvl.3.title",subtitleKey:"lvl.3.sub",hintKey:"lvl.3.hint",parTime:40,maxFrostCells:550,maxTotalParticles:3800,theme:Pt.stormBasalt,solids:Bt([{kind:"rect",x:2.1,y:.5,w:.4,h:4.5},{kind:"poly",points:[[2.5,.5],[7.4,.5],[7.4,3],[2.5,3.8]]},{kind:"rect",x:6.1,y:4.55,w:.4,h:.65},{kind:"rect",x:7.35,y:5.6,w:.55,h:2.9},{kind:"poly",points:[[7.85,.5],[8.55,.5],[8.55,2.7],[7.85,3]]},{kind:"rect",x:10.65,y:3.6,w:.55,h:4.9},{kind:"poly",points:[[11.2,.5],[14.1,.5],[14.1,1.32],[12.3,1.32]]}],Ce),spouts:[{id:"spout-3",x:1.4,y:7.8,...wt(.32,-.947),speed:3.3,rate:310,radius:.22,maxParticles:1e6,enabled:!0}],pools:[],drains:Ce,turbines:[{id:"turbine-1",x:9.4,y:2.1,radius:.78,targetCharge:1,decayRate:.025,lockOnFull:!0},{id:"turbine-2",x:13.3,y:2.2,radius:.82,targetCharge:1,decayRate:.025,lockOnFull:!0}],bodies:[],goals:[],cisterns:[],gates:[],crackedWalls:[{id:"wall-1",x:7.4,y:3,w:.45,h:2.6,maxHp:12,impactThreshold:2.5},{id:"wall-2",x:10.7,y:.5,w:.45,h:3.1,maxHp:14,impactThreshold:2.7}],magmaVents:[],valves:[{id:"valve-3",x:1.85,y:6.8,length:1.6,thickness:.18,angleA:.62,angleB:-.52,initialToggled:!1}],seesaws:[{id:"seesaw-1",x:4.5,y:4.9,length:3,thickness:.18,maxAngle:.45,restAngle:-.22,damping:1.4}],mines:[{id:"mine-1",x:5.4,y:5.08,radius:.27,density:.48}]},Se=[{x:.5,y:0,w:1,h:.68},{x:14.1,y:0,w:1.4,h:.68}],Ze={id:"level-4",index:4,titleKey:"lvl.4.title",subtitleKey:"lvl.4.sub",hintKey:"lvl.4.hint",parTime:40,maxFrostCells:500,maxTotalParticles:3800,theme:Pt.deepSapphire,solids:Bt([{kind:"rect",x:1.5,y:.5,w:.5,h:1.5},{kind:"rect",x:7.4,y:.5,w:.6,h:2.85},{kind:"poly",points:[[8,.5],[10.2,.5],[8,1.9]]},{kind:"poly",points:[[10.8,.5],[13.6,.5],[13.6,1.9]]},{kind:"poly",points:[[2.7,3.94],[6.3,4.24],[6.3,4.59],[2.7,4.29]]},{kind:"poly",points:[[9.7,4.24],[13.3,3.94],[13.3,4.29],[9.7,4.59]]}],Se),spouts:[{id:"spout-4",x:3.2,y:3.55,...wt(.25,-.968),speed:2.8,rate:220,radius:.22,maxParticles:1e6,enabled:!0}],pools:[{x:2.1,y:.55,w:5.2,h:1.7,fillFactor:.88}],drains:Se,turbines:[{id:"turbine-l",x:4.5,y:5.3,radius:.82,targetCharge:1,decayRate:.03,lockOnFull:!0},{id:"turbine-r",x:11.5,y:5.3,radius:.82,targetCharge:1,decayRate:.03,lockOnFull:!0}],bodies:[],goals:[],cisterns:[],gates:[],crackedWalls:[],magmaVents:[],portals:[{id:"portal-1",inX:10.5,inY:1.2,outX:8,outY:7.75,...ie(0,-1),radius:.62,boost:1.55}],valves:[{id:"valve-4",x:8,y:6.45,length:1.9,thickness:.18,angleA:.55,angleB:-.55,initialToggled:!1}]},Ae=[{x:.5,y:0,w:1.4,h:.68},{x:14.4,y:1.55,w:1.1,h:.5}],Je={id:"level-5",index:5,titleKey:"lvl.5.title",subtitleKey:"lvl.5.sub",hintKey:"lvl.5.hint",parTime:45,maxFrostCells:550,maxTotalParticles:3800,theme:Pt.volcanicObsidian,solids:Bt([{kind:"rect",x:2.05,y:.5,w:.45,h:4},{kind:"rect",x:5.6,y:.5,w:.35,h:1.95},{kind:"poly",points:[[5.95,.5],[6,.5],[6,1.05],[5.95,2.45]]},{kind:"rect",x:9.4,y:.5,w:2.2,h:.55},{kind:"rect",x:11.1,y:3.1,w:.5,h:5.4},{kind:"rect",x:14.4,y:.5,w:1.1,h:1.05},{kind:"rect",x:14.4,y:2.05,w:1.1,h:6.45}],Ae),spouts:[{id:"spout-5",x:1.3,y:7.6,...wt(.32,-.947),speed:3.2,rate:260,radius:.22,maxParticles:1e6,enabled:!0}],pools:[{x:2.55,y:.55,w:3,h:1.75,fillFactor:.88}],drains:Ae,turbines:[],bodies:[{id:"sphere-1",kind:"sphere",x:4.1,y:2.1,w:.68,h:.68,density:.5}],goals:[{id:"altar-5",bodyId:"sphere-1",x:12,y:6.4,w:2.4,h:1.6}],cisterns:[],gates:[],crackedWalls:[],magmaVents:[{id:"magma-bridge",x:6,y:.5,w:3.4,h:.55,maxHeat:16,reheatRate:2,goalQuench:!0},{id:"magma-geyser",x:11.6,y:.5,w:2.8,h:.55,maxHeat:280,reheatRate:28,goalQuench:!1}],valves:[{id:"valve-5",x:1.75,y:6,length:1.6,thickness:.18,angleA:.62,angleB:-.52,initialToggled:!1}]},Re=[{x:.5,y:0,w:1.5,h:.68},{x:14.7,y:0,w:.8,h:1.05}],ts={id:"level-6",index:6,titleKey:"lvl.6.title",subtitleKey:"lvl.6.sub",hintKey:"lvl.6.hint",parTime:45,maxFrostCells:600,maxTotalParticles:3800,theme:Pt.templeGold,solids:Bt([{kind:"rect",x:2.25,y:.5,w:.4,h:4.35},{kind:"rect",x:2.25,y:6.4,w:.4,h:2.1},{kind:"rect",x:2.65,y:.5,w:2.95,h:2.1},{kind:"rect",x:5.3,y:2.6,w:.3,h:.85},{kind:"rect",x:11.65,y:3.1,w:.55,h:.9},{kind:"rect",x:11.65,y:6.5,w:.55,h:2},{kind:"rect",x:12.2,y:3.5,w:2.3,h:.5},{kind:"rect",x:14.4,y:.5,w:.3,h:.48}],Re),spouts:[{id:"spout-6",x:1.32,y:7.6,...wt(-.06,-.998),speed:3.1,rate:300,radius:.22,maxParticles:1e6,enabled:!0}],pools:[{x:5.7,y:.55,w:5.8,h:1,fillFactor:.85}],drains:Re,turbines:[],bodies:[{id:"ark-6",kind:"ark",x:9.8,y:1.4,w:1.05,h:.52,density:.52}],goals:[{id:"altar-6",bodyId:"ark-6",x:12.6,y:.55,w:1.85,h:2.5}],cisterns:[],gates:[{id:"gate-6",x:11.7,y:.5,w:.45,h:2.6,openOffsetX:0,openOffsetY:2.6,requiredTriggerIds:["relay-6"],speed:1.6}],crackedWalls:[{id:"wall-6",x:11.7,y:4,w:.45,h:2.5,maxHp:12,impactThreshold:2.5}],magmaVents:[],valves:[{id:"valve-6",x:1.62,y:5.9,length:1.5,thickness:.18,angleA:.72,angleB:-.52,initialToggled:!1}],relays:[{id:"relay-6",ax:3.1,ay:2.95,bx:4.9,by:2.95,radius:.48,linkedGateId:"gate-6",linkedPumpId:"pump-6",isObjective:!0}],pumps:[{id:"pump-6",x:7.4,y:.85,...wt(.25,.968),force:38,range:6,radius:.95,requiredTriggerIds:["relay-6"]}],seesaws:[{id:"seesaw-6",x:9.5,y:5.1,length:2.8,thickness:.18,maxAngle:.42,restAngle:-.18,damping:1.4}],mines:[{id:"mine-6",x:7.4,y:1.55,radius:.28,density:.48}]},Be=[{x:.5,y:0,w:1.3,h:.68},{x:6.3,y:0,w:.9,h:.68},{x:15.1,y:2.4,w:.4,h:.65}],es={id:"level-7",index:7,titleKey:"lvl.7.title",subtitleKey:"lvl.7.sub",hintKey:"lvl.7.hint",parTime:65,maxFrostCells:750,maxTotalParticles:3800,theme:Pt.royalCrown,solids:Bt([{kind:"rect",x:1.9,y:.5,w:.4,h:4.7},{kind:"rect",x:2.3,y:3,w:1.6,h:.35},{kind:"rect",x:4.4,y:3,w:2,h:.35},{kind:"poly",points:[[2.3,.5],[5,.5],[2.3,1.1]]},{kind:"rect",x:6,y:.5,w:.3,h:.7},{kind:"rect",x:7.2,y:.5,w:.45,h:4.3},{kind:"poly",points:[[7.65,3.7],[10,3.7],[10,4.2],[7.65,4.8]]},{kind:"rect",x:9.95,y:6.4,w:.55,h:2.1},{kind:"rect",x:10.45,y:3.55,w:2.25,h:.15},{kind:"rect",x:9.95,y:5.65,w:.28,h:.75},{kind:"rect",x:11.8,y:.5,w:.35,h:1.15}],Be),spouts:[{id:"spout-7",x:1.35,y:7.9,...wt(.3,-.954),speed:3.3,rate:280,radius:.22,maxParticles:1e6,enabled:!0}],pools:[{x:7.75,y:.55,w:3.95,h:.95,fillFactor:.88}],drains:Be,turbines:[{id:"turbine-1",x:3.15,y:4.1,radius:.68,targetCharge:1,decayRate:.025,lockOnFull:!0,linkedGateId:"gate-crown"},{id:"turbine-2",x:5.35,y:4.1,radius:.68,targetCharge:1,decayRate:.025,lockOnFull:!0,linkedGateId:"gate-crown"}],bodies:[{id:"ark-crown",kind:"ark",x:10.6,y:1.3,w:1.05,h:.52,density:.52}],goals:[{id:"altar-crown",bodyId:"ark-crown",x:13.2,y:5.4,w:2,h:2.3}],cisterns:[],gates:[{id:"gate-crown",x:12.9,y:4.8,w:2.6,h:.42,openOffsetX:-2.4,openOffsetY:0,requiredTriggerIds:["turbine-1","turbine-2","relay-7"],speed:1.6}],crackedWalls:[{id:"dam-great",x:10,y:4.2,w:.45,h:2.2,maxHp:14,impactThreshold:2.5}],magmaVents:[{id:"magma-seal",x:10.45,y:3.7,w:2.25,h:.5,maxHeat:14,reheatRate:1.5,goalQuench:!0}],valves:[{id:"valve-7a",x:1.8,y:6.9,length:1.5,thickness:.18,angleA:.62,angleB:-.52,initialToggled:!1},{id:"valve-7b",x:3.8,y:5.65,length:1.8,thickness:.18,angleA:.48,angleB:-.48,initialToggled:!1}],portals:[{id:"portal-7",inX:5.4,inY:1.2,outX:7.6,outY:7.7,...ie(.28,-.96),radius:.56,boost:1.55}],seesaws:[{id:"seesaw-7",x:8.75,y:6.1,length:2,thickness:.16,maxAngle:.42,restAngle:-.22,damping:1.4}],mines:[{id:"mine-7",x:9.45,y:6.3,radius:.27,density:.48}],relays:[{id:"relay-7",ax:13,ay:.85,bx:14.9,by:.85,radius:.48,linkedGateId:"gate-crown",linkedPumpId:"pump-7",isObjective:!0}],pumps:[{id:"pump-7",x:14,y:.85,...wt(0,1),force:40,range:7,radius:1.25,requiredTriggerIds:["relay-7"]}]},_t=[je,$e,Qe,Ze,Je,ts,es],Pe=[{x:13.8,y:0,w:1.7,h:.68}],ce={id:"sandbox",index:8,isSandbox:!0,titleKey:"lvl.sb.title",subtitleKey:"lvl.sb.sub",hintKey:"lvl.sb.hint",parTime:120,maxFrostCells:1800,maxTotalParticles:6500,theme:Pt.labCyan,solids:Bt([{kind:"rect",x:1,y:3.8,w:3.8,h:.4},{kind:"rect",x:10.8,y:3.8,w:3.8,h:.4},{kind:"rect",x:8.8,y:.5,w:.8,h:.9},{kind:"rect",x:13,y:.5,w:.6,h:.7}],Pe),spouts:[{id:"spout-sb",x:8,y:7.8,...wt(0,-1),speed:3.4,rate:300,radius:.24,maxParticles:1e6,enabled:!0}],pools:[{x:.8,y:.55,w:7.6,h:1.65,fillFactor:.88}],drains:Pe,turbines:[{id:"turbine-sb",x:12.6,y:5.1,radius:.85,targetCharge:1,decayRate:.03,lockOnFull:!1}],bodies:[{id:"ark-sb",kind:"ark",x:4.6,y:2,w:1.05,h:.52,density:.52}],goals:[],cisterns:[],gates:[],crackedWalls:[{id:"wall-sb",x:4.1,y:4.2,w:.45,h:2.2,maxHp:14,impactThreshold:2.5}],magmaVents:[{id:"magma-sb",x:9.8,y:.5,w:2.4,h:.55,maxHeat:30,reheatRate:3,goalQuench:!1}],valves:[{id:"valve-sb",x:8,y:6.2,length:1.8,thickness:.18,angleA:.45,angleB:-.45,initialToggled:!1}],seesaws:[{id:"seesaw-sb",x:6.2,y:4.5,length:2.4,thickness:.16,maxAngle:.45,restAngle:-.15,damping:1.5}],mines:[{id:"mine-sb",x:6.7,y:4.8,radius:.26,density:.48}],portals:[{id:"portal-sb",inX:1.5,inY:2.6,outX:14.3,outY:7.2,...ie(-.78,-.625),radius:.52,boost:1.4}]},Fe={de:{gameTitle:"AQUALITH",gameSubtitle:"Meister der Lebenden Flut",titleTagline:"Forme Gezeiten, Eisbrücken und Strudel durch uralte versunkene Heiligtümer.",startCampaign:"Kampagne starten",continueCampaign:"Kampagne fortsetzen",openSandbox:"Gezeiten-Labor",selectChapter:"Kapitel wählen",closeMenu:"Schließen",backToMenu:"Menü",toolSurge:"Flutstoß",toolSurgeDesc:"Ziehen, um Wellen und Strömungen zu schleudern [1]",toolIce:"Eisform",toolIceDesc:"LMB malt Eisdämme & Rampen · RMB schmilzt Eis [2]",toolVortex:"Strudel-Kanone",toolVortexDesc:"Gedrückt halten zum Bündeln · loslassen für Wasserstoß [3]",toolShatter:"Eis sprengen",toolShatterDesc:"Alle Eisbarrieren gleichzeitig zertrümmern [Leertaste]",toolPour:"Wasserquelle",toolPourDesc:"Wasser direkt aus dem Nichts gießen",toolDrain:"Sog-Abfluss",toolDrainDesc:"Wasser lokal absaugen",toolRock:"Basalt-Meißel",toolRockDesc:"LMB baut Fels · RMB trägt Fels ab",sbTsunami:"Tsunami!",sbSpouts:"Quellen",sbTurbine:"+ Turbine",sbArk:"+ Arche",sbMagma:"+ Magma",sbWall:"+ Bruchwand",sbMine:"+ Mine",sbSeesaw:"+ Wippe",sbClearWater:"Becken leeren",hintLabel:"Hinweis",slowMo:"Zeitlupe",reset:"Neustart",mute:"Ton",qualityHigh:"Hoch",qualityUltra:"Ultra",frostGauge:"Eis-Vorrat",waterParticles:"Tropfen",chapterPrefix:"Kapitel",parTimeLabel:"Par-Zeit",bestTimeLabel:"Bestzeit",starsLabel:"Sterne",lockedLabel:"Freigeschaltet",victoryTitle:"Heiligtum Erweckt!",victorySubtitle:"Die Strömung fließt im Einklang mit dem Stein.",victoryTime:"Zeit",victoryPar:"Zielzeit",nextChapter:"Nächstes Kapitel",replayChapter:"Nochmal spielen",campaignComplete:"Alle 7 Heiligtümer gemeistert!",enterSandbox:"Ins Gezeiten-Labor",objTurbines:"Hydro-Turbinen laden",objRelics:"Relikt-Archen zum Altar geleiten",objWalls:"Brüchige Dämme sprengen",objMagma:"Magmaschlot zu Obsidian löschen",objCisterns:"Gegengewicht-Zisternen füllen",objRelays:"Hydro-Relais unter Strom setzen",objMines:"Hydro-Minen an Bruchwänden zünden",objSandbox:"Freies Experimentieren mit Wasser, Eis & Mechanik","lvl.demo.title":"Kaskade des Erwachens","lvl.demo.sub":"Lebende Wassersimulation","lvl.demo.hint":"Starte die Kampagne oder experimentiere im Gezeiten-Labor.","lvl.1.title":"Der Erste Überlauf","lvl.1.sub":"Umlenkventil, Flutstoß & Eisrampe","lvl.1.hint":"Klicke auf die goldene Weiche [Klick], um den Strom umzuleiten, und schleudere Wellen [1] oder baue eine Eisrampe [2] zur Turbine.","lvl.2.title":"Die Hydro-Brücke","lvl.2.sub":"Wasserleitfähigkeit & Schleusentor","lvl.2.hint":"Drehe das Ventil, damit Wasser die beiden Kupferelektroden verbindet — der Lichtbogen öffnet das Tor für die Arche!","lvl.3.title":"Die Wippen-Mine","lvl.3.sub":"Hydraulische Wippe & Hydro-Mine","lvl.3.hint":"Leite den Strom auf den linken Wippenarm: Die Hydro-Mine rollt in die Flut und sprengt beide Bruchwände!","lvl.4.title":"Siphon-Portale","lvl.4.sub":"Hydro-Portale & Doppel-Turbine","lvl.4.hint":"Schleudere Wasser ins Bernstein-Portal — oben schießt der Strahl heraus! Lenke ihn per Mittel-Ventil auf beide Turbinen.","lvl.5.title":"Obsidian & Dampf-Aufzug","lvl.5.sub":"Magma-Brücke & Auftriebs-Geysir","lvl.5.hint":"Drehe zuerst die Weiche zum Löschen der unteren Magma-Brücke. Rechts erzeugt leichtes Wasser Dampf, der die Kugel hebt!","lvl.6.title":"Das Geysir-Katapult","lvl.6.sub":"Relais-Strom, Druckgeysir & Mine","lvl.6.hint":"Schalte das Relais mit Wasser ein, sodass der Geysir die Mine auf die Wippe katapultiert und das Tor für die Arche sprengt!","lvl.7.title":"Die Große Zitadelle","lvl.7.sub":"Meisterprüfung aller Elemente","lvl.7.hint":"Weichen drehen, Portal speisen, Damm-Mine zünden, Relais schließen und die Kronen-Arche ins Heiligtum tragen!","lvl.sb.title":"Gezeiten-Labor","lvl.sb.sub":"Freie Physik-Sandbox","lvl.sb.hint":"Erschaffe Tsunamis, Portale, Wippen, Minen, Eis-Aquädukte und Magma-Geysire nach Belieben.",tutorialDrag:"Klicke das Ventil & schleudere Wasser!",valveClickHint:"Klicken zum Umschalten",slowMoBadge:"ZEITLUPE 0.35×"},en:{gameTitle:"AQUALITH",gameSubtitle:"Master of the Living Tide",titleTagline:"Sculpt tides, ice aqueducts, and hydro-vortices across ancient sunken sanctuaries.",startCampaign:"Start Campaign",continueCampaign:"Continue Campaign",openSandbox:"Tide Lab",selectChapter:"Select Chapter",closeMenu:"Close",backToMenu:"Menu",toolSurge:"Surge",toolSurgeDesc:"Drag through water to whip waves & currents [1]",toolIce:"Ice Sculpt",toolIceDesc:"LMB paints ice dams & ramps · RMB melts ice [2]",toolVortex:"Vortex Cannon",toolVortexDesc:"Hold to gather water · release for hydro-blast [3]",toolShatter:"Shatter Ice",toolShatterDesc:"Detonate all ice barriers at once [Space]",toolPour:"Pour Water",toolPourDesc:"Pour fresh water directly at cursor",toolDrain:"Vacuum Drain",toolDrainDesc:"Remove water locally",toolRock:"Basalt Chisel",toolRockDesc:"LMB sculpts stone · RMB carves stone",sbTsunami:"Tsunami!",sbSpouts:"Spouts",sbTurbine:"+ Turbine",sbArk:"+ Ark",sbMagma:"+ Magma",sbWall:"+ Cracked Wall",sbMine:"+ Mine",sbSeesaw:"+ Seesaw",sbClearWater:"Drain Basin",hintLabel:"Hint",slowMo:"Slow-Mo",reset:"Reset",mute:"Audio",qualityHigh:"High",qualityUltra:"Ultra",frostGauge:"Frost Budget",waterParticles:"Droplets",chapterPrefix:"Chapter",parTimeLabel:"Par Time",bestTimeLabel:"Best",starsLabel:"Stars",lockedLabel:"Unlocked",victoryTitle:"Sanctuary Awakened!",victorySubtitle:"The living current flows in harmony with the stone.",victoryTime:"Time",victoryPar:"Par",nextChapter:"Next Chapter",replayChapter:"Replay",campaignComplete:"All 7 Sanctuaries Mastered!",enterSandbox:"Enter Tide Lab",objTurbines:"Charge Hydro-Turbines",objRelics:"Float Relic Arks to Altar",objWalls:"Blast Cracked Dams",objMagma:"Quench Magma Seal into Obsidian",objCisterns:"Fill Counterweight Cisterns",objRelays:"Bridge Live Hydro-Relays",objMines:"Detonate Hydro-Mines on Walls",objSandbox:"Experiment freely with water, ice & hydraulics","lvl.demo.title":"Cascade of Awakening","lvl.demo.sub":"Live Fluid Simulation","lvl.demo.hint":"Start the campaign or experiment freely in Tide Lab.","lvl.1.title":"The First Spillway","lvl.1.sub":"Diverter Valve, Surge & Ice Ramp","lvl.1.hint":"Click the brass diverter valve to redirect the stream, then whip waves [1] or build an Ice ramp [2] onto the turbine.","lvl.2.title":"The Hydro Bridge","lvl.2.sub":"Water Conductivity & Sluice Lock","lvl.2.hint":"Flip the valve so water bridges both copper electrodes — the electric arc opens the bronze gate for the Ark!","lvl.3.title":"The Seesaw Mine","lvl.3.sub":"Hydraulic Seesaw & Buoyant Mine","lvl.3.hint":"Pour water onto the left seesaw arm to roll the Hydro-Mine into the torrent and blast both cracked walls!","lvl.4.title":"Siphon Portals","lvl.4.sub":"Hydro-Portals & Twin Turbines","lvl.4.hint":"Feed the Amber Portal in the basin — a roaring jet erupts overhead! Aim it across both turbines with the center valve.","lvl.5.title":"Obsidian & Steam Lift","lvl.5.sub":"Magma Bridge & Buoyant Geyser","lvl.5.hint":"Flip the left valve to quench the lower magma bridge into obsidian, then feed light water on the right for steam lift!","lvl.6.title":"The Geyser Catapult","lvl.6.sub":"Hydro-Relay, Pressure Jet & Mine","lvl.6.hint":"Bridge the Hydro-Relay to fire the Geyser Pump, launching the Mine onto the high seesaw to shatter the vault!","lvl.7.title":"The Grand Citadel","lvl.7.sub":"Master Trial of Every Element","lvl.7.hint":"Flip valves, feed the portal, launch the dam mine, bridge the relay, and ride the Crown Ark to the Sanctuary!","lvl.sb.title":"Tide Lab","lvl.sb.sub":"Free Physics Sandbox","lvl.sb.hint":"Play freely with tsunamis, portals, seesaws, hydro-mines, ice aqueducts, and magma geysers.",tutorialDrag:"Click the valve & surge the wave!",valveClickHint:"Click to toggle",slowMoBadge:"SLOW-MO 0.35×"}};function z(S,t){const s=Fe[S],e=Fe.en;return s[t]??e[t]??t}const he="'Inter', 'SF Pro Display', 'Segoe UI', system-ui, -apple-system, sans-serif",ss=.24;function et(S,t,s){return S<t?t:S>s?s:S}function At(S,t,s,e,i,o){const a=Math.min(o,e*.5,i*.5);S.beginPath(),S.moveTo(t+a,s),S.lineTo(t+e-a,s),S.arcTo(t+e,s,t+e,s+a,a),S.lineTo(t+e,s+i-a),S.arcTo(t+e,s+i,t+e-a,s+i,a),S.lineTo(t+a,s+i),S.arcTo(t,s+i,t,s+i-a,a),S.lineTo(t,s+a),S.arcTo(t,s,t+a,s,a),S.closePath()}class is{constructor(t){v(this,"canvas");v(this,"ctx");v(this,"width",1280);v(this,"height",720);v(this,"dpr",1);if(this.canvas=t,this.ctx=t.getContext("2d"),t.width>0&&t.height>0){const s=t.clientWidth;s>0&&t.width>s*1.15?(this.dpr=t.width/s,this.width=s,this.height=t.height/this.dpr):(this.width=t.width,this.height=t.height)}}resize(t,s,e){const i=Math.max(1,t),o=Math.max(1,s);if(typeof e=="number"&&Number.isFinite(e)&&e>0){this.dpr=et(e,1,3),this.width=i,this.height=o,this.canvas.width=Math.max(1,Math.round(i*this.dpr)),this.canvas.height=Math.max(1,Math.round(o*this.dpr));return}const a=this.canvas.clientWidth;if(a>0&&i>a*1.25)this.dpr=et(i/a,1,3),this.width=i/this.dpr,this.height=o/this.dpr,this.canvas.width=Math.max(1,Math.round(i)),this.canvas.height=Math.max(1,Math.round(o));else{const r=typeof globalThis.devicePixelRatio=="number"?et(globalThis.devicePixelRatio,1,2):1;this.dpr=r,this.width=i,this.height=o,this.canvas.width=Math.max(1,Math.round(i*r)),this.canvas.height=Math.max(1,Math.round(o*r))}}cx(t){return t/K*this.width}cy(t){return(1-t/Q)*this.height}getScale(){return this.width/K}render(t,s,e,i,o,a){const r=this.ctx;if(!r||this.width<=0||this.height<=0)return;r.save(),r.setTransform(1,0,0,1,0,0),r.clearRect(0,0,this.canvas.width,this.canvas.height),r.setTransform(this.dpr,0,0,this.dpr,0,0);const c=this.getScale(),l=et(c/80,.72,1.45);this.drawPortals(r,s.portals??[],c,l,o),this.drawPumps(r,s.pumps??[],c,l,o),this.drawRelicGoals(r,s.goals,c,l,o),this.drawMagmaVents(r,s.magmaVents,c,o),this.drawCrackedWalls(r,s.crackedWalls,c,l,o),this.drawCisterns(r,s.cisterns,c,l),this.drawTurbines(r,s.turbines,c,l,o),this.drawMines(r,s.mines??[],c,l,o),this.drawRelays(r,s.relays??[],c,l,o),this.drawValves(r,t,s.valves??[],i,c,l,o),a&&t.levelId==="level-1"&&this.drawLevel1DragHint(r,t,s,c,l,o),t.screen==="playing"&&i.inside&&this.drawToolCursor(r,t,e,i,c,l,o),t.slowMo&&this.drawSlowMoVignette(r,t,l,o),r.restore()}drawTurbines(t,s,e,i,o){for(const a of s){const r=this.cx(a.x),c=this.cy(a.y),d=a.radius*e+Math.max(5*i,.08*e),u=a.targetCharge>0?et(a.charge/a.targetCharge,0,1):a.completed?1:0;if(t.save(),t.beginPath(),t.arc(r,c,d,0,Math.PI*2),t.strokeStyle="rgba(148, 163, 184, 0.22)",t.lineWidth=2.5*i,t.stroke(),a.completed){const h=.5+.5*Math.sin(o*4.2);t.beginPath(),t.arc(r,c,d+(4+h*4)*i,0,Math.PI*2),t.strokeStyle=`rgba(251, 191, 36, ${.18+h*.2})`,t.lineWidth=5*i,t.stroke(),t.beginPath(),t.arc(r,c,d,0,Math.PI*2),t.strokeStyle="#fbbf24",t.lineWidth=3.2*i,t.shadowColor="rgba(251, 191, 36, 0.75)",t.shadowBlur=10*i,t.stroke(),t.shadowBlur=0,this.drawCompactReadout(t,r,this.pickVerticalLabelY(c,d,14*i),"100%","rgba(254, 243, 199, 0.96)","rgba(120, 53, 15, 0.72)","rgba(251, 191, 36, 0.65)",10.5*i)}else if(u>.005){const h=-Math.PI*.5,n=h+u*Math.PI*2;t.beginPath(),t.arc(r,c,d,h,n),t.strokeStyle="rgba(45, 212, 191, 0.32)",t.lineWidth=6.5*i,t.lineCap="round",t.stroke(),t.beginPath(),t.arc(r,c,d,h,n),t.strokeStyle="rgba(94, 234, 212, 0.85)",t.lineWidth=3*i,t.lineCap="round",t.stroke();const p=r+Math.cos(n)*d,f=c+Math.sin(n)*d;t.beginPath(),t.arc(p,f,3*i,0,Math.PI*2),t.fillStyle="#ccfbf1",t.fill(),u>=.03&&this.drawCompactReadout(t,r,this.pickVerticalLabelY(c,d,14*i),`${Math.round(u*100)}%`,"rgba(204, 251, 241, 0.95)","rgba(15, 23, 42, 0.68)","rgba(94, 234, 212, 0.52)",10.5*i)}t.restore()}}drawCisterns(t,s,e,i){for(const o of s){const a=this.cx(o.x),r=this.cy(o.y+o.h),c=o.w*e,l=o.h*e,d=et(o.fillRatio,0,1),u=o.activated?"#34d399":"#38bdf8",h=o.activated?"rgba(52, 211, 153, 0.35)":"rgba(56, 189, 248, 0.28)";t.save();const n=Math.min(12*i,c*.28,l*.28);if(t.strokeStyle=o.activated?"rgba(52, 211, 153, 0.78)":"rgba(56, 189, 248, 0.48)",t.lineWidth=1.8*i,t.lineCap="round",this.strokeCornerBrackets(t,a,r,c,l,n),d>.01||o.activated){const p=Math.max(6*i,.075*e),f=Math.max(24*i,l-6*i),m=8*i,g=a+c+m+p+38*i<this.width,x=g?a+c+m:a-m-p>40*i?a-m-p:a+c-p-4*i,y=r+(l-f)*.5;At(t,x,y,p,f,p*.5),t.fillStyle="rgba(15, 23, 42, 0.72)",t.fill(),t.strokeStyle="rgba(148, 163, 184, 0.35)",t.lineWidth=1.2*i,t.stroke();const T=Math.max(p,f*d),b=y+f-T;At(t,x+1,b+1,Math.max(1,p-2),Math.max(1,T-2),p*.45),t.fillStyle=u,t.shadowColor=h,t.shadowBlur=8*i,t.fill(),t.shadowBlur=0;const M=`${Math.round(d*100)}%`,w=g?x+p+22*i:x-22*i,k=et(y+f*(1-d*.5),16,this.height-16);this.drawCompactReadout(t,et(w,24,this.width-24),k,M,o.activated?"#d1fae5":"#e0f2fe","rgba(15, 23, 42, 0.72)",o.activated?"rgba(52, 211, 153, 0.65)":"rgba(56, 189, 248, 0.55)",10*i)}t.restore()}}drawCrackedWalls(t,s,e,i,o){for(const a of s){if(a.broken)continue;const r=a.maxHp>0?et(a.hp/a.maxHp,0,1):1,c=r<.995;if(a.stressGlow<=.08&&!c)continue;const l=this.cx(a.x),d=this.cy(a.y+a.h),u=a.w*e,h=a.h*e,n=et(a.stressGlow,0,1),p=.65+.35*Math.sin(o*9),f=et(n*.45*p+(c?.14:0),.08,.55);t.save(),t.fillStyle=`rgba(245, 158, 11, ${f*.35})`,t.fillRect(l,d,u,h),t.strokeStyle=`rgba(251, 191, 36, ${et(f*1.4,.35,.95)})`,t.lineWidth=2*i,t.strokeRect(l,d,u,h);const m=et(Math.max(u*1.15,42*i),40*i,84*i),g=6*i,x=et(l+u*.5-m*.5,10,this.width-m-10),y=d-14*i>12?d-14*i:d+h+8*i;At(t,x,y,m,g,g*.5),t.fillStyle="rgba(15, 23, 42, 0.78)",t.fill(),t.strokeStyle=`rgba(245, 158, 11, ${.45+n*.4})`,t.lineWidth=1.2*i,t.stroke();const T=Math.max(g*.6,(m-2)*r);At(t,x+1,y+1,T,Math.max(1,g-2),g*.4),t.fillStyle=r<.35?"#fb7185":"#f59e0b",t.fill(),t.restore()}}drawRelicGoals(t,s,e,i,o){for(const a of s){const r=this.cx(a.x),c=this.cy(a.y+a.h),l=a.w*e,d=a.h*e,u=r+l*.5,h=c+d*.5;if(t.save(),a.fulfilled){const g=.5+.5*Math.sin(o*3.8+a.pulse),x=t.createRadialGradient(u,h,2,u,h,Math.max(l,d)*.85);x.addColorStop(0,`rgba(254, 240, 138, ${.38+g*.14})`),x.addColorStop(.55,`rgba(251, 191, 36, ${.22+g*.1})`),x.addColorStop(1,"rgba(251, 191, 36, 0)"),t.fillStyle=x,t.fillRect(r-l*.35,c-d*.35,l*1.7,d*1.7),t.strokeStyle=`rgba(251, 191, 36, ${.75+g*.25})`,t.lineWidth=2.4*i,At(t,r,c,l,d,6*i),t.stroke()}else t.setLineDash([5*i,4*i]),t.strokeStyle="rgba(251, 191, 36, 0.42)",t.lineWidth=1.6*i,At(t,r,c,l,d,5*i),t.stroke(),t.setLineDash([]);const n=Math.sin(o*3.2+a.pulse)*4.5*i,p=et(c-16*i+n,22*i,this.height-20*i),f=9*i,m=6*i;t.shadowColor="rgba(251, 191, 36, 0.8)",t.shadowBlur=a.fulfilled?12*i:7*i,t.beginPath(),t.moveTo(u,p-11*i),t.lineTo(u+3.5*i,p-7*i),t.lineTo(u,p-3*i),t.lineTo(u-3.5*i,p-7*i),t.closePath(),t.fillStyle=a.fulfilled?"#fef08a":"#fbbf24",t.fill(),t.lineCap="round",t.lineJoin="round";for(let g=0;g<2;g++){const x=p+g*5.5*i;t.beginPath(),t.moveTo(u-f,x-m*.5),t.lineTo(u,x+m*.5),t.lineTo(u+f,x-m*.5),t.strokeStyle=g===0?"rgba(253, 224, 71, 0.72)":"#fbbf24",t.lineWidth=(g===0?1.8:2.5)*i,t.stroke()}t.restore()}}drawMagmaVents(t,s,e,i){for(const o of s){if(o.quenched)continue;const a=this.cx(o.x),r=this.cy(o.y+o.h),c=o.w*e,l=o.maxHeat>0?et(o.heat/o.maxHeat,.15,1):1,d=.5+.5*Math.sin(i*5.2+o.steamPulse);t.save();const u=Math.max(22,.55*e)*(.75+l*.45),h=t.createLinearGradient(0,r,0,r-u);h.addColorStop(0,`rgba(249, 115, 22, ${.24*l+d*.08})`),h.addColorStop(.55,`rgba(245, 158, 11, ${.11*l})`),h.addColorStop(1,"rgba(245, 158, 11, 0)"),t.fillStyle=h,t.fillRect(a-c*.08,r-u,c*1.16,u);const n=2;for(let p=0;p<n;p++){const f=(i*1.1+p*.5+o.steamPulse*.1)%1,m=r-4-f*u*.85,g=Math.sin(f*Math.PI)*.45*l;t.beginPath();const x=12;for(let y=0;y<=x;y++){const T=y/x,b=a+T*c,M=m+Math.sin(T*Math.PI*3+i*7+p*2)*2.2;y===0?t.moveTo(b,M):t.lineTo(b,M)}t.strokeStyle=`rgba(251, 146, 60, ${g})`,t.lineWidth=1.6,t.stroke()}t.restore()}}drawRelays(t,s,e,i,o){for(let a=0;a<s.length;a++){const r=s[a],c=et(r.charge,0,1),l=Math.max(9*i,r.radius*e),d=.5+.5*Math.sin(o*6.5+a*1.7);t.save();const u=[[this.cx(r.ax),this.cy(r.ay)],[this.cx(r.bx),this.cy(r.by)]];for(const[h,n]of u)if(t.beginPath(),t.arc(h,n,l+4*i,0,Math.PI*2),t.strokeStyle=r.active?`rgba(103, 232, 249, ${.42+d*.28})`:"rgba(56, 189, 248, 0.25)",t.lineWidth=(r.active?2.4:1.5)*i,t.stroke(),r.active&&(t.beginPath(),t.arc(h,n,l+(7+d*4)*i,0,Math.PI*2),t.strokeStyle=`rgba(34, 211, 238, ${.2+d*.22})`,t.lineWidth=3*i,t.stroke()),c>.02||r.active){const p=r.active?Math.PI*2:c*Math.PI*2,f=r.active?o*3.5:-Math.PI*.5;t.beginPath(),t.arc(h,n,l+4*i,f,f+p),t.strokeStyle=r.active?"#a5f3fc":"#38bdf8",t.lineWidth=2.6*i,t.lineCap="round",t.shadowColor="rgba(34, 211, 238, 0.85)",t.shadowBlur=(r.active?10:6)*i,t.stroke(),t.shadowBlur=0}if(r.bridgePath&&r.bridgePath.length>=2){const h=[],n=r.bridgePath,p=Math.floor(o*26);for(let f=0;f<n.length-1;f++){const m=this.cx(n[f][0]),g=this.cy(n[f][1]),x=this.cx(n[f+1][0]),y=this.cy(n[f+1][1]),T=x-m,b=y-g,M=Math.hypot(T,b);if(M<.5)continue;const w=Math.max(2,Math.min(6,Math.ceil(M/(18*i)))),k=-b/M,C=T/M;h.length===0&&h.push({x:m,y:g});for(let A=1;A<=w;A++){const B=A/w,E=m+T*B,L=g+b*B;if(f===n.length-2&&A===w)h.push({x:E,y:L});else{const D=f*31+A*17+a*53+p*97&65535,R=Math.sin(D*12.9898+78.233)*43758.5453,V=R-Math.floor(R)-.5,W=(4.5+7.5*Math.max(.35,c))*i;h.push({x:E+k*V*W,y:L+C*V*W})}}}if(h.length>=2){t.lineJoin="round",t.lineCap="round",t.beginPath(),t.moveTo(h[0].x,h[0].y);for(let f=1;f<h.length;f++)t.lineTo(h[f].x,h[f].y);t.strokeStyle=`rgba(34, 211, 238, ${.42+d*.2})`,t.lineWidth=6.5*i,t.shadowColor="rgba(56, 189, 248, 0.9)",t.shadowBlur=12*i,t.stroke(),t.shadowBlur=0,t.strokeStyle="rgba(103, 232, 249, 0.92)",t.lineWidth=2.6*i,t.stroke(),t.strokeStyle="#f8fafc",t.lineWidth=1.25*i,t.stroke()}}t.restore()}}drawValves(t,s,e,i,o,a,r){const c=s.screen==="playing",l=s.levelId==="level-1"||s.levelIndex===1;for(const d of e){const u=this.cx(d.x),h=this.cy(d.y),n=Math.max(.75,d.length*.58),p=Math.hypot(i.x-d.x,i.y-d.y),f=c&&i.inside&&p<=n,m=c&&l&&s.elapsed<10&&d.id==="valve-1";if(!f&&!m)continue;const g=Math.max(22*a,d.length*.54*o),x=.5+.5*Math.sin(r*4.8);if(t.save(),m){const y=r*.85%1;t.beginPath(),t.arc(u,h,g+y*16*a,0,Math.PI*2),t.strokeStyle=`rgba(251, 191, 36, ${(1-y)*.62})`,t.lineWidth=2.2*a,t.stroke(),t.beginPath(),t.arc(u,h,g+x*3*a,0,Math.PI*2),t.strokeStyle=`rgba(251, 191, 36, ${.48+x*.35})`,t.lineWidth=2.4*a,t.stroke()}if(f){t.beginPath(),t.arc(u,h,g+x*2.5*a,0,Math.PI*2),t.fillStyle="rgba(251, 191, 36, 0.09)",t.fill(),t.strokeStyle=`rgba(253, 224, 71, ${.72+x*.25})`,t.lineWidth=2.2*a,t.shadowColor="rgba(251, 191, 36, 0.75)",t.shadowBlur=9*a,t.stroke(),t.shadowBlur=0;const y=g+7*a,T=Math.sin(r*2.6)*.14,b=[[-Math.PI*.76+T,-Math.PI*.24+T],[Math.PI*.24+T,Math.PI*.76+T]];t.strokeStyle="#fde68a",t.lineWidth=2.1*a,t.lineCap="round";for(const[k,C]of b){t.beginPath(),t.arc(u,h,y,k,C),t.stroke();const A=u+Math.cos(C)*y,B=h+Math.sin(C)*y;this.drawArrowHead(t,A,B,C+Math.PI*.5,7*a,"#fde68a")}const M=z(s.lang,"valveClickHint"),w=h-y-18*a>20?h-y-18*a:h+y+18*a;this.drawCompactReadout(t,u,w,M,"#fef3c7","rgba(15, 23, 42, 0.84)","rgba(251, 191, 36, 0.72)",11*a)}t.restore()}}drawPortals(t,s,e,i,o){for(const a of s){const r=this.cx(a.inX),c=this.cy(a.inY),l=this.cx(a.outX),d=this.cy(a.outY),u=et(a.pulse,0,1);t.save();const h=l-r,n=d-c,p=Math.hypot(h,n);if(p>4){const y=-n/p,T=h/p,b=T<=0?1:-1,M=Math.min(85*i,p*.16)*b,w=(r+l)*.5+y*M,k=(c+d)*.5+T*M,C=.22+u*.55;t.setLineDash([4*i,7*i]),t.lineDashOffset=-o*(26+u*42)*i,t.beginPath(),t.moveTo(r,c),t.quadraticCurveTo(w,k,l,d),t.strokeStyle=`rgba(251, 191, 36, ${C})`,t.lineWidth=(1.6+u*1.4)*i,t.lineCap="round",u>.08&&(t.shadowColor="rgba(251, 191, 36, 0.75)",t.shadowBlur=8*i*u),t.stroke(),t.shadowBlur=0,t.setLineDash([])}const f=Math.max(10*i,a.radius*e);u>.02&&(t.beginPath(),t.arc(r,c,f*(1.08+u*.25),0,Math.PI*2),t.strokeStyle=`rgba(253, 224, 71, ${.35*u})`,t.lineWidth=2.5*i,t.stroke(),t.beginPath(),t.arc(l,d,f*(1.08+u*.25),0,Math.PI*2),t.strokeStyle=`rgba(103, 232, 249, ${.42*u})`,t.lineWidth=2.5*i,t.stroke());const m=a.outDirX,g=-a.outDirY,x=Math.hypot(m,g);if(x>.001){const y=m/x,T=g/x,b=Math.atan2(T,y),M=f+6*i,w=28*i,k=6.5*i;for(let C=0;C<3;C++){const A=(o*(1.5+u*1.6)+C/3)%1,B=M+A*w,E=l+y*B,L=d+T*B,P=Math.sin(A*Math.PI)*(.45+u*.5);this.strokeChevron(t,E,L,b,k,`rgba(165, 243, 252, ${P})`,2.1*i)}}t.restore()}}drawPumps(t,s,e,i,o){for(const a of s){if(!a.active||a.power<=.1)continue;const r=this.cx(a.x),c=this.cy(a.y),l=a.dirX,d=-a.dirY,u=Math.hypot(l,d);if(u<.001)continue;const h=l/u,n=d/u,p=Math.atan2(n,h),f=et(a.power,.1,1.3),m=et(a.range*.45,.75,2.5)*e,g=et(a.radius*e*.78,7*i,16*i);t.save(),t.beginPath(),t.arc(r,c,Math.max(8*i,a.radius*e),0,Math.PI*2),t.strokeStyle=`rgba(56, 189, 248, ${.35+f*.25})`,t.lineWidth=2*i,t.stroke();const x=4;for(let y=0;y<x;y++){const T=(o*(1.7+f*1.4)+y/x)%1,b=(.12+T*.88)*m,M=r+h*b,w=c+n*b,k=Math.sin(T*Math.PI)*et(.45+f*.4,0,.92);this.strokeChevron(t,M,w,p,g*(1-T*.22),`rgba(125, 211, 252, ${k})`,2.3*i)}t.restore()}}drawMines(t,s,e,i,o){for(const a of s){const r=this.cx(a.x),c=this.cy(a.y),l=Math.max(8*i,a.radius*e);if(t.save(),a.detonated){if(a.flash>.01){const d=et(a.flash,0,1),u=l+(1.45*(1-d)+.35)*e,h=t.createRadialGradient(r,c,2,r,c,u);h.addColorStop(0,`rgba(254, 240, 138, ${d*.38})`),h.addColorStop(.55,`rgba(251, 146, 60, ${d*.22})`),h.addColorStop(1,"rgba(249, 115, 22, 0)"),t.fillStyle=h,t.beginPath(),t.arc(r,c,u,0,Math.PI*2),t.fill(),t.beginPath(),t.arc(r,c,u*.92,0,Math.PI*2),t.strokeStyle=`rgba(253, 186, 116, ${d*.65})`,t.lineWidth=2.4*i,t.stroke()}}else{const d=.5+.5*Math.sin(o*5.2+a.x*1.3),u=et(a.flash,0,1),h=l+(4+d*3.5)*i;t.beginPath(),t.arc(r,c,h,0,Math.PI*2),t.strokeStyle=`rgba(245, 158, 11, ${.32+d*.34+u*.3})`,t.lineWidth=(1.8+u*1.2)*i,t.stroke(),u>.05&&(t.beginPath(),t.arc(r,c,l*1.8,0,Math.PI*2),t.fillStyle=`rgba(251, 146, 60, ${u*.22})`,t.fill())}t.restore()}}drawToolCursor(t,s,e,i,o,a,r){const c=this.cx(i.x),l=this.cy(i.y);switch(t.save(),s.activeTool){case"surge":{const d=Math.max(18,.3*o),u=r*2.2,h=e.active;t.beginPath(),t.arc(c,l,d,0,Math.PI*2),t.strokeStyle=h?"rgba(94, 234, 212, 0.32)":"rgba(56, 189, 248, 0.22)",t.lineWidth=(h?4.5:3)*a,t.stroke();for(let n=0;n<2;n++){const p=u+n*Math.PI;t.beginPath(),t.arc(c,l,d,p,p+Math.PI*.68),t.strokeStyle=h?"#5eead4":"#38bdf8",t.lineWidth=(h?2.8:2.1)*a,t.lineCap="round",t.stroke()}if(h){const n=e.vx,p=-e.vy,f=Math.hypot(n,p);if(f>.12){const m=n/f,g=p/f,x=et(22*a+f*.14*o,22*a,1.55*o),y=c+m*x,T=l+g*x;t.beginPath(),t.moveTo(c,l),t.lineTo(y,T),t.strokeStyle="rgba(94, 234, 212, 0.35)",t.lineWidth=6*a,t.lineCap="round",t.stroke(),t.beginPath(),t.moveTo(c,l),t.lineTo(y,T),t.strokeStyle="#99f6e4",t.lineWidth=2.4*a,t.stroke(),this.drawArrowHead(t,y,T,Math.atan2(g,m),9*a,"#99f6e4")}}break}case"ice":{const d=ss*o,u=s.frostMax>0?et((s.frostMax-s.frostUsed)/s.frostMax,0,1):1,h=e.secondary,n=!h&&u<=.001,p=h?"#fda4af":n?"#fbbf24":"#bae6fd",f=h?"#fb7185":u<.15?"#f87171":"#38bdf8";t.beginPath();for(let g=0;g<6;g++){const x=Math.PI/3*g-Math.PI/6,y=c+Math.cos(x)*d,T=l+Math.sin(x)*d;g===0?t.moveTo(y,T):t.lineTo(y,T)}t.closePath(),t.fillStyle=h?"rgba(251, 113, 133, 0.1)":"rgba(186, 230, 253, 0.12)",t.fill(),t.strokeStyle=p,t.lineWidth=2*a,t.shadowColor=h?"rgba(251, 113, 133, 0.6)":"rgba(125, 211, 252, 0.75)",t.shadowBlur=8*a,t.stroke(),t.shadowBlur=0;const m=d+5.5*a;t.beginPath(),t.arc(c,l,m,0,Math.PI*2),t.strokeStyle="rgba(148, 163, 184, 0.25)",t.lineWidth=2*a,t.stroke(),u>.005&&(t.beginPath(),t.arc(c,l,m,-Math.PI*.5,-Math.PI*.5+u*Math.PI*2),t.strokeStyle=f,t.lineWidth=2.6*a,t.lineCap="round",t.stroke());break}case"vortex":{if(e.active&&e.chargePos){const d=this.cx(e.chargePos.x),u=this.cy(e.chargePos.y),h=et(e.chargeTime/.75,0,1),n=et(.35+e.chargeTime*.9,.35,1),p=(.92-h*.52)*o,f=r*(3.6+h*7.5),m=.5+h*.48,g=t.createRadialGradient(d,u,1,d,u,p*.55);g.addColorStop(0,`rgba(207, 250, 254, ${.42+h*.42})`),g.addColorStop(1,"rgba(34, 211, 238, 0)"),t.fillStyle=g,t.beginPath(),t.arc(d,u,p*.55,0,Math.PI*2),t.fill(),t.lineCap="round";for(let R=0;R<3;R++){const V=f+R*Math.PI*2/3;t.beginPath();const W=22;for(let N=0;N<=W;N++){const _=N/W,Y=p*(1-_*.78),J=V+_*Math.PI*1.45,j=d+Math.cos(J)*Y,tt=u+Math.sin(J)*Y;N===0?t.moveTo(j,tt):t.lineTo(j,tt)}t.strokeStyle=`rgba(34, 211, 238, ${m})`,t.lineWidth=(1.6+h*1.4)*a,t.stroke()}t.beginPath(),t.arc(d,u,p,0,Math.PI*2),t.strokeStyle=`rgba(103, 232, 249, ${.35+h*.45})`,t.lineWidth=1.8*a,t.stroke();const x=i.x-e.chargePos.x,y=i.y-e.chargePos.y,T=Math.hypot(x,y),b=T>.12,M=b?x/T:.5,w=b?y/T:.8660254;b&&(t.setLineDash([4*a,4*a]),t.beginPath(),t.moveTo(d,u),t.lineTo(c,l),t.strokeStyle="rgba(165, 243, 252, 0.55)",t.lineWidth=1.6*a,t.stroke(),t.setLineDash([]));const k=n*14.5,C=M*k,A=w*k,B=b?10:6,E=.046;let L=d,P=u,D=Math.atan2(-w,M);for(let R=1;R<=B;R++){const V=R*E,W=e.chargePos.x+C*V,N=e.chargePos.y+A*V+.5*Mt*V*V,_=this.cx(W),Y=this.cy(N);D=Math.atan2(Y-P,_-L),L=_,P=Y;const J=(b?1:.55)*(1-R/(B+2));t.beginPath(),t.arc(_,Y,(3.2-R*.16)*a,0,Math.PI*2),t.fillStyle=`rgba(103, 232, 249, ${J*.9})`,t.fill()}this.drawArrowHead(t,L,P,D,8*a,`rgba(165, 243, 252, ${b?.85:.5})`)}else{const d=.32*o,u=r*1.8;for(let h=0;h<3;h++){const n=u+h*Math.PI*2/3;t.beginPath(),t.arc(c,l,d,n,n+1.25),t.strokeStyle="#22d3ee",t.lineWidth=2.1*a,t.lineCap="round",t.stroke()}t.beginPath(),t.arc(c,l,3*a,0,Math.PI*2),t.fillStyle="#a5f3fc",t.fill()}break}case"pour":{const d=.24*o;t.beginPath(),t.arc(c,l,d,0,Math.PI*2),t.fillStyle="rgba(56, 189, 248, 0.12)",t.fill(),t.strokeStyle="#38bdf8",t.lineWidth=2.2*a,t.stroke();const u=Math.sin(r*5)*2*a;t.beginPath(),t.moveTo(c,l-6*a+u),t.quadraticCurveTo(c+5*a,l+1*a+u,c,l+5.5*a+u),t.quadraticCurveTo(c-5*a,l+1*a+u,c,l-6*a+u),t.fillStyle="#7dd3fc",t.fill();break}case"drain":{const d=.28*o;t.beginPath(),t.arc(c,l,d,0,Math.PI*2),t.fillStyle="rgba(244, 63, 94, 0.1)",t.fill(),t.strokeStyle="#f43f5e",t.lineWidth=2.2*a,t.stroke();const u=r*1.4%1,h=d*(.85-u*.45);t.beginPath(),t.arc(c,l,h,0,Math.PI*2),t.strokeStyle=`rgba(251, 113, 133, ${1-u})`,t.lineWidth=1.6*a,t.stroke();break}case"rock":{const d=.24*o,u=e.secondary,h=u?"#fb7185":"#d97706";t.beginPath(),t.arc(c,l,d,0,Math.PI*2),t.fillStyle=u?"rgba(251, 113, 133, 0.1)":"rgba(217, 119, 6, 0.12)",t.fill(),t.strokeStyle=h,t.lineWidth=2.2*a,t.stroke();const n=d*.42;t.beginPath(),t.moveTo(c,l-n),t.lineTo(c+n,l),t.lineTo(c,l+n),t.lineTo(c-n,l),t.closePath(),t.strokeStyle=u?"rgba(253, 164, 175, 0.8)":"rgba(251, 191, 36, 0.78)",t.lineWidth=1.5*a,t.stroke();break}}t.restore()}drawSlowMoVignette(t,s,e,i){t.save();const o=this.width*.5,a=this.height*.5,r=Math.hypot(o,a),c=r*.52,l=.5+.5*Math.sin(i*2.4),d=t.createRadialGradient(o,a,c,o,a,r);d.addColorStop(0,"rgba(99, 102, 241, 0)"),d.addColorStop(.7,`rgba(79, 70, 229, ${.12+l*.04})`),d.addColorStop(1,`rgba(129, 140, 248, ${.28+l*.06})`),t.fillStyle=d,t.fillRect(0,0,this.width,this.height),t.strokeStyle="rgba(165, 180, 252, 0.35)",t.lineWidth=2*e,t.strokeRect(3,3,Math.max(1,this.width-6),Math.max(1,this.height-6));const u=z(s.lang,"slowMoBadge"),h=Math.round(12*e);t.font=`700 ${h}px ${he}`;const p=t.measureText(u).width+28*e,f=24*e,m=o-p*.5,g=et(this.height*.085,14,68);At(t,m,g,p,f,f*.5),t.fillStyle="rgba(30, 27, 75, 0.78)",t.fill(),t.strokeStyle="rgba(165, 180, 252, 0.65)",t.lineWidth=1.4*e,t.stroke(),t.beginPath(),t.arc(m+12*e,g+f*.5,3.2*e,0,Math.PI*2),t.fillStyle="#a5b4fc",t.fill(),t.fillStyle="#e0e7ff",t.textAlign="left",t.textBaseline="middle",t.fillText(u,m+20*e,g+f*.5+.5),t.restore()}drawLevel1DragHint(t,s,e,i,o,a){t.save();const r=e.turbines[0],c=!r||r.x>=7,l={x:this.cx(c?2.8:13.2),y:this.cy(2.25)},d={x:this.cx(c?4.7:11.3),y:this.cy(3.75)},u={x:this.cx(c?6.6:9.4),y:this.cy(4.15)},h=a%2.4/2.4,n=h<.15?h/.15:h>.78?Math.max(0,(1-h)/.22):1,p=et((h-.05)/.78,0,1);if(t.beginPath(),t.moveTo(l.x,l.y),t.quadraticCurveTo(d.x,d.y,u.x,u.y),t.setLineDash([6*o,6*o]),t.strokeStyle="rgba(94, 234, 212, 0.35)",t.lineWidth=2.2*o,t.stroke(),t.setLineDash([]),p>.02){t.beginPath();let w=l.x,k=l.y,C=l.x,A=l.y;for(let E=0;E<=18;E++){const L=E/18*p,P=1-L,D=P*P*l.x+2*P*L*d.x+L*L*u.x,R=P*P*l.y+2*P*L*d.y+L*L*u.y;E===0?t.moveTo(D,R):t.lineTo(D,R),E===17&&(C=D,A=R),w=D,k=R}t.strokeStyle=`rgba(94, 234, 212, ${.85*n})`,t.lineWidth=3.5*o,t.lineCap="round",t.shadowColor="rgba(45, 212, 191, 0.75)",t.shadowBlur=10*o,t.stroke(),t.shadowBlur=0;const B=Math.atan2(k-A,w-C);this.drawArrowHead(t,w,k,B,10*o,`rgba(153, 246, 228, ${n})`),t.beginPath(),t.arc(w,k,5*o,0,Math.PI*2),t.fillStyle=`rgba(204, 251, 241, ${.9*n})`,t.fill()}const f=z(s.lang,"tutorialDrag"),m=Math.round(13*o);t.font=`600 ${m}px ${he}`;const x=t.measureText(f).width+28*o,y=28*o,T=et(d.x,x*.5+14,this.width-x*.5-14),b=et(this.cy(4.85),24,this.height-24);At(t,T-x*.5,b-y*.5,x,y,y*.5),t.fillStyle="rgba(15, 23, 42, 0.78)",t.fill(),t.strokeStyle="rgba(94, 234, 212, 0.58)",t.lineWidth=1.5*o,t.stroke(),t.fillStyle="#e0f2fe",t.textAlign="center",t.textBaseline="middle",t.fillText(f,T,b+.5),t.restore()}drawCompactReadout(t,s,e,i,o,a,r,c){t.font=`700 ${Math.round(c)}px ${he}`;const l=t.measureText(i).width,d=c*.65,u=l+d*2,h=c*1.55,n=et(s,u*.5+4,this.width-u*.5-4),p=et(e,h*.5+4,this.height-h*.5-4);At(t,n-u*.5,p-h*.5,u,h,h*.5),t.fillStyle=a,t.fill(),t.strokeStyle=r,t.lineWidth=1.1,t.stroke(),t.fillStyle=o,t.textAlign="center",t.textBaseline="middle",t.fillText(i,n,p+.5)}pickVerticalLabelY(t,s,e){const i=t-s-e;return i>18?i:t+s+e}strokeCornerBrackets(t,s,e,i,o,a){t.beginPath(),t.moveTo(s,e+a),t.lineTo(s,e),t.lineTo(s+a,e),t.moveTo(s+i-a,e),t.lineTo(s+i,e),t.lineTo(s+i,e+a),t.moveTo(s+i,e+o-a),t.lineTo(s+i,e+o),t.lineTo(s+i-a,e+o),t.moveTo(s+a,e+o),t.lineTo(s,e+o),t.lineTo(s,e+o-a),t.stroke()}drawArrowHead(t,s,e,i,o,a){t.save(),t.translate(s,e),t.rotate(i),t.beginPath(),t.moveTo(0,0),t.lineTo(-o,-o*.48),t.lineTo(-o*.72,0),t.lineTo(-o,o*.48),t.closePath(),t.fillStyle=a,t.fill(),t.restore()}strokeChevron(t,s,e,i,o,a,r){t.save(),t.translate(s,e),t.rotate(i),t.beginPath(),t.moveTo(-o*.65,-o*.72),t.lineTo(o*.35,0),t.lineTo(-o*.65,o*.72),t.strokeStyle=a,t.lineWidth=r,t.lineCap="round",t.lineJoin="round",t.stroke(),t.restore()}}const de=`#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;
out vec2 vUv;

void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`,as=`#version 300 es
precision highp float;

in vec2 aPos;
in vec2 aVel;
in float aFoam;

uniform vec2 uWorldSize;
uniform vec2 uViewportSize;
uniform float uPointWorldDiameter;

out vec2 vVel;
out float vFoam;

void main() {
  vec2 ndc = (aPos / uWorldSize) * 2.0 - 1.0;
  gl_Position = vec4(ndc, 0.0, 1.0);
  float pxDiameter = uPointWorldDiameter * (uViewportSize.y / uWorldSize.y);
  gl_PointSize = clamp(pxDiameter, 4.0, 64.0);
  vVel = aVel;
  vFoam = aFoam;
}
`,os=`#version 300 es
precision highp float;

in vec2 vVel;
in float vFoam;

uniform float uIsFloat;
uniform float uSplatScale;

out vec4 fragColor;

void main() {
  vec2 d = (gl_PointCoord - 0.5) * 2.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;

  float w = exp(-r2 * 4.4) * (1.0 - smoothstep(0.72, 1.0, r2));
  float contrib = w * uSplatScale;

  // Normalize velocity into [-1, 1] covering up to ~16 m/s cleanly
  vec2 velNorm = clamp(vVel * 0.0625, -1.0, 1.0);
  float foamVal = clamp(vFoam, 0.0, 1.25);

  if (uIsFloat > 0.5) {
    fragColor = vec4(contrib, velNorm.x * contrib, velNorm.y * contrib, foamVal * contrib);
  } else {
    // Shift velocity to [0, 1] * contrib so additive RGBA8 never clips negative components
    vec2 velEnc = (0.5 + 0.5 * velNorm) * contrib;
    fragColor = vec4(contrib, velEnc.x, velEnc.y, clamp(foamVal, 0.0, 1.0) * contrib);
  }
}
`,ns=`#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uBlurStep;

out vec4 fragColor;

void main() {
  vec4 acc = texture(uTex, vUv) * 0.204164;
  acc += (texture(uTex, vUv + uBlurStep * 1.0) + texture(uTex, vUv - uBlurStep * 1.0)) * 0.180174;
  acc += (texture(uTex, vUv + uBlurStep * 2.0) + texture(uTex, vUv - uBlurStep * 2.0)) * 0.123832;
  acc += (texture(uTex, vUv + uBlurStep * 3.0) + texture(uTex, vUv - uBlurStep * 3.0)) * 0.066282;
  acc += (texture(uTex, vUv + uBlurStep * 4.0) + texture(uTex, vUv - uBlurStep * 4.0)) * 0.027631;
  fragColor = acc;
}
`,rs=`#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uTerrainSdfTex;
uniform sampler2D uTerrainKindTex;

uniform vec2 uWorldSize;
uniform float uTime;
uniform float uQuality;
uniform vec3 uSkyTop;
uniform vec3 uSkyBottom;
uniform vec3 uRockTint;
uniform vec2 uLightDir;
uniform vec3 uSunColor;

uniform int uNumLanterns;
uniform vec2 uLanternPos[12];
uniform vec3 uLanternColor[12];
uniform float uLanternRadius[12];

out vec4 fragColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * noise2D(p);
    p = rot * p * 2.03 + vec2(11.3, 7.1);
    a *= 0.5;
  }
  return v;
}

float voronoiEdge(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float md1 = 8.0;
  float md2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = vec2(hash21(n + g), hash21(n + g + vec2(37.2, 91.7)));
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < md1) {
        md2 = md1;
        md1 = d;
      } else if (d < md2) {
        md2 = d;
      }
    }
  }
  return sqrt(md2) - sqrt(md1);
}

vec3 computeBackdrop(vec2 worldPos, vec2 toSun) {
  float hNorm = clamp(worldPos.y / uWorldSize.y, 0.0, 1.0);
  vec3 sky = mix(uSkyBottom, uSkyTop, pow(max(hNorm, 1e-4), 0.82));

  // Soft horizon atmospheric glow toward sun azimuth
  vec2 sunAnchor = vec2(8.0 + toSun.x * 7.5, 9.2 + toSun.y * 2.0);
  float sunGlow = exp(-length((worldPos - sunAnchor) * vec2(0.22, 0.35)) * 0.7);
  sky += uSunColor * sunGlow * 0.24;

  // Parallax distant sunken aqueduct arches (far background)
  float farX = worldPos.x * 0.55 + 1.3;
  float farPillar = abs(fract(farX * 0.32) - 0.5);
  float farCol = (1.0 - smoothstep(0.055, 0.085, farPillar)) * step(worldPos.y, 7.6);
  float farArch = 1.0 - smoothstep(0.38, 0.42, length(vec2(fract(farX * 0.32) - 0.5, (worldPos.y - 6.7) * 0.28)));
  float farSilhouette = max(farCol * 0.7, (1.0 - farArch) * step(5.8, worldPos.y) * step(worldPos.y, 7.9));
  vec3 farColor = mix(uSkyBottom * 0.72, uRockTint * 0.38 + uSkyBottom * 0.48, 0.55);
  sky = mix(sky, farColor, farSilhouette * 0.35);

  // Midground fluted sanctuary temple columns & lintels
  float midPeriod = 3.25;
  float cellIdx = floor((worldPos.x + 0.65) / midPeriod);
  float colSeed = hash21(vec2(cellIdx, 4.1));
  if (colSeed > 0.22) {
    float lx = mod(worldPos.x + 0.65, midPeriod) - midPeriod * 0.5;
    float colW = 0.26 + colSeed * 0.08;
    float flute = 0.5 + 0.5 * cos(lx / colW * 18.0);
    float colMask = 1.0 - smoothstep(colW - 0.03, colW, abs(lx));
    float topBreak = 7.4 + colSeed * 1.4;
    colMask *= 1.0 - smoothstep(topBreak - 0.1, topBreak + 0.2, worldPos.y);
    // Horizontal carved band / capital
    float capital = (1.0 - smoothstep(colW * 1.25, colW * 1.35, abs(lx))) *
                    (1.0 - smoothstep(0.18, 0.24, abs(worldPos.y - (topBreak - 0.35))));
    float midMask = max(colMask, capital);
    vec3 midBase = mix(uSkyBottom * 0.55, uRockTint * 0.42, 0.45);
    vec3 midShade = midBase * (0.82 + 0.18 * flute) + uSunColor * 0.05 * max(0.0, sign(lx) * (-toSun.x));
    sky = mix(sky, midShade, midMask * 0.42);
  }

  // Soft cavern mist bands near lower basin
  float mist = fbm(vec2(worldPos.x * 0.32 + uTime * 0.06, worldPos.y * 0.65));
  float mistMask = (1.0 - smoothstep(0.2, 4.2, worldPos.y)) * (0.28 + 0.45 * mist);
  sky = mix(sky, mix(uSkyBottom, uSunColor, 0.14), mistMask * 0.22);

  // Volumetric diagonal sunlight rays
  vec2 perpLight = vec2(-toSun.y, toSun.x);
  float rayCoord = dot(worldPos - vec2(8.0, 9.0), perpLight);
  float ray1 = sin(rayCoord * 1.65 + uTime * 0.22) * 0.5 + 0.5;
  float ray2 = sin(rayCoord * 3.10 - uTime * 0.15 + 1.7) * 0.5 + 0.5;
  float ray3 = noise2D(vec2(rayCoord * 0.85 + uTime * 0.08, 2.3));
  float rays = pow(max(ray1 * 0.55 + ray2 * 0.25 + ray3 * 0.30, 1e-4), 2.1);
  float rayHeightFade = smoothstep(-0.5, 8.2, worldPos.y) * (1.0 - smoothstep(6.2, 9.4, worldPos.y * 0.6 + 2.0));
  sky += uSunColor * rays * (0.14 + 0.05 * uQuality) * (0.4 + 0.6 * rayHeightFade);

  // Floating sunlit dust motes in the sanctuary air
  vec2 moteUv = worldPos * vec2(2.6, 2.6) + vec2(-uTime * 0.14, -uTime * 0.22);
  vec2 mId = floor(moteUv);
  vec2 mF = fract(moteUv) - 0.5;
  float mRand = hash21(mId);
  if (mRand > 0.72) {
    vec2 mOff = vec2(hash21(mId + 1.3), hash21(mId + 7.9)) - 0.5;
    mOff *= 0.55;
    mOff += vec2(sin(uTime * 0.9 + mRand * 20.0), cos(uTime * 0.7 + mRand * 15.0)) * 0.09;
    float dMote = length(mF - mOff);
    float twinkle = 0.5 + 0.5 * sin(uTime * 2.5 + mRand * 40.0);
    float moteGlow = (1.0 - smoothstep(0.0, 0.075, dMote)) * twinkle * (0.35 + 0.65 * rays);
    sky += mix(uSunColor, vec3(1.0, 0.96, 0.85), 0.5) * moteGlow * 0.45;
  }

  return sky;
}

void main() {
  vec2 worldPos = vUv * uWorldSize;
  vec2 rawL = normalize(uLightDir + vec2(1e-5, 1e-4));
  vec2 toSun = rawL.y < 0.0 ? -rawL : rawL;

  vec4 sdfSample = texture(uTerrainSdfTex, vUv);
  float sdf = (sdfSample.r - 0.5) * 2.0;
  vec2 sdfN = normalize(sdfSample.gb * 2.0 - 1.0 + vec2(1e-5, 0.0));

  int kind = int(texture(uTerrainKindTex, vUv).r * 255.0 + 0.5);
  int edgeKind = kind;
  if (edgeKind == 0 && sdf < 0.09) {
    vec2 inwardUv = clamp(vUv - sdfN * vec2(1.0 / 128.0, 1.0 / 72.0), vec2(0.0), vec2(1.0));
    edgeKind = int(texture(uTerrainKindTex, inwardUv).r * 255.0 + 0.5);
    if (edgeKind == 0) {
      int k1 = int(texture(uTerrainKindTex, clamp(vUv + vec2(1.0 / 128.0, 0.0), vec2(0.0), vec2(1.0))).r * 255.0 + 0.5);
      int k2 = int(texture(uTerrainKindTex, clamp(vUv - vec2(1.0 / 128.0, 0.0), vec2(0.0), vec2(1.0))).r * 255.0 + 0.5);
      int k3 = int(texture(uTerrainKindTex, clamp(vUv + vec2(0.0, 1.0 / 72.0), vec2(0.0), vec2(1.0))).r * 255.0 + 0.5);
      int k4 = int(texture(uTerrainKindTex, clamp(vUv - vec2(0.0, 1.0 / 72.0), vec2(0.0), vec2(1.0))).r * 255.0 + 0.5);
      if (k1 == 1 || k1 == 2 || k1 == 5) edgeKind = k1;
      else if (k2 == 1 || k2 == 2 || k2 == 5) edgeKind = k2;
      else if (k3 == 1 || k3 == 2 || k3 == 5) edgeKind = k3;
      else if (k4 == 1 || k4 == 2 || k4 == 5) edgeKind = k4;
    }
  }

  vec3 skyCol = computeBackdrop(worldPos, toSun);

  // Ambient occlusion shadow in air near solid walls
  float airAo = smoothstep(-0.02, 0.45, sdf);
  skyCol *= mix(0.60, 1.0, airAo);

  // Add ambient lantern halos in air
  for (int i = 0; i < 12; i++) {
    if (i >= uNumLanterns) break;
    vec2 lPos = uLanternPos[i];
    vec3 lCol = uLanternColor[i];
    float lRad = max(uLanternRadius[i], 0.25);
    float dist = length(worldPos - lPos);
    float flicker = 0.94 + 0.06 * sin(uTime * 3.8 + float(i) * 2.3);
    float halo = exp(-(dist * dist) / (lRad * lRad * 0.42)) * 0.42
               + exp(-(dist * dist) / (lRad * lRad * 1.70)) * 0.14;
    float core = (1.0 - smoothstep(0.02, 0.11, dist)) * 1.15;
    skyCol += lCol * (halo + core) * flicker;
  }

  // Gate (3) and Cracked Wall (4) are drawn as smooth exact geometry in Mechanism Pass
  bool isTerrainMat = (edgeKind == 1 || edgeKind == 2 || edgeKind == 5);
  float solidMask = isTerrainMat ? (1.0 - smoothstep(-0.014, 0.014, sdf)) : 0.0;

  if (solidMask <= 0.001) {
    // Subtle framing vignette
    vec2 vig = vUv * (1.0 - vUv);
    float vigFactor = clamp(pow(max(vig.x * vig.y * 18.0, 1e-4), 0.22), 0.78, 1.0);
    fragColor = vec4(skyCol * vigFactor, 1.0);
    return;
  }

  // 2.5D bevel normal for carved stone / crystal / obsidian edges
  float rimFactor = smoothstep(-0.20, 0.0, sdf);
  vec2 texNoiseGrad = vec2(
    noise2D(worldPos * 7.5 + vec2(0.04, 0.0)) - noise2D(worldPos * 7.5 - vec2(0.04, 0.0)),
    noise2D(worldPos * 7.5 + vec2(0.0, 0.04)) - noise2D(worldPos * 7.5 - vec2(0.0, 0.04))
  ) * 0.65;
  vec3 N3 = normalize(vec3(
    sdfN.x * (0.25 + 0.75 * rimFactor) + texNoiseGrad.x * 0.35,
    sdfN.y * (0.25 + 0.75 * rimFactor) + texNoiseGrad.y * 0.35,
    mix(0.85, 0.32, rimFactor)
  ));
  vec3 L3 = normalize(vec3(toSun.x, toSun.y, 0.58));
  float ndotl = max(dot(N3, L3), 0.0);
  vec3 H3 = normalize(L3 + vec3(0.0, 0.0, 1.0));

  vec3 matColor = vec3(0.0);

  if (edgeKind == 1) {
    // Ancient Sanctuary Basalt Ashlar Masonry
    float rowH = 0.44;
    float colW = 0.88;
    float rowIdx = floor(worldPos.y / rowH);
    float xOff = mod(rowIdx, 2.0) * (colW * 0.5);
    vec2 blockCoord = vec2((worldPos.x + xOff) / colW, worldPos.y / rowH);
    vec2 blockId = floor(blockCoord);
    vec2 blockF = fract(blockCoord);

    float mortarX = min(blockF.x, 1.0 - blockF.x) * colW;
    float mortarY = min(blockF.y, 1.0 - blockF.y) * rowH;
    float mortar = smoothstep(0.0, 0.032, min(mortarX, mortarY));
    float stoneVar = 0.88 + 0.24 * hash21(blockId);

    float grain = fbm(worldPos * 3.8 + blockId * 3.1);
    float microVein = smoothstep(0.46, 0.54, fbm(worldPos * 9.0 + vec2(4.2, 1.9)));

    vec3 baseRock = uRockTint * stoneVar * (0.68 + 0.48 * grain);
    baseRock = mix(baseRock * 0.78, baseRock * 1.18, microVein * 0.35);
    // Darken mortar seams & add top stone bevel highlight
    baseRock *= mix(0.46, 1.0, mortar);
    float blockTopBevel = (1.0 - smoothstep(0.015, 0.06, mortarY)) * step(0.5, blockF.y);
    baseRock += uSunColor * blockTopBevel * 0.08 * mortar;

    // Deep interior cavern darkening + edge bevel rim highlight
    float interiorDepth = smoothstep(-0.85, -0.02, sdf);
    vec3 litRock = baseRock * (0.34 + 0.58 * ndotl + 0.22 * interiorDepth);

    // Moss / ancient sanctuary lichen along upward-facing stone ledges
    float mossNoise = fbm(worldPos * 6.2 + vec2(9.1, 2.7));
    float mossMask = smoothstep(0.28, 0.72, sdfN.y) * smoothstep(-0.14, -0.01, sdf) * smoothstep(0.36, 0.68, mossNoise);
    vec3 mossCol = vec3(0.14, 0.38, 0.22) * (0.7 + 0.5 * mossNoise) + uSunColor * 0.14 * ndotl;
    litRock = mix(litRock, mossCol, mossMask * 0.78);

    // Sunlit bevel edge glow
    float rim = smoothstep(-0.075, 0.0, sdf) * max(dot(sdfN, toSun), 0.0);
    litRock += uSunColor * rim * 0.34;
    matColor = litRock;
  } else if (edgeKind == 2) {
    // Translucent Glacial Ice Crystal
    float facet = voronoiEdge(worldPos * 3.6);
    float fineFacet = voronoiEdge(worldPos * 7.8 + vec2(4.5, 1.2));
    float crystalPlane = smoothstep(0.02, 0.36, facet);
    float innerCracks = 1.0 - smoothstep(0.0, 0.055, fineFacet);

    vec3 refractedBg = mix(skyCol, vec3(0.42, 0.84, 0.98), 0.62);
    vec3 iceCore = mix(vec3(0.28, 0.70, 0.90), vec3(0.74, 0.95, 1.0), crystalPlane * 0.75 + 0.25 * ndotl);
    matColor = mix(refractedBg, iceCore, 0.68);
    matColor += vec3(0.88, 0.99, 1.0) * innerCracks * 0.28;

    float iceSpec = pow(max(dot(N3, H3), 1e-4), 42.0);
    float frostRim = smoothstep(-0.085, 0.0, sdf);
    matColor += vec3(0.82, 0.97, 1.0) * frostRim * 0.42;
    matColor += mix(uSunColor, vec3(0.9, 0.98, 1.0), 0.65) * iceSpec * 0.72;
  } else {
    // Quenched Volcanic Obsidian Glass
    float conchoidal = voronoiEdge(worldPos * 4.4);
    float ripple = sin(conchoidal * 28.0 + fbm(worldPos * 6.0) * 4.0) * 0.5 + 0.5;
    vec3 glassBase = mix(vec3(0.04, 0.035, 0.07), vec3(0.11, 0.08, 0.16), ripple * 0.65);
    float glassSpec = pow(max(dot(N3, H3), 1e-4), 64.0);
    float edgeSheen = smoothstep(-0.065, 0.0, sdf);
    // Subtle deep violet & cooling amber edge refraction flecks
    matColor = glassBase * (0.6 + 0.55 * ndotl);
    matColor += vec3(0.48, 0.34, 0.75) * edgeSheen * 0.28;
    matColor += mix(uSunColor, vec3(0.85, 0.72, 1.0), 0.5) * glassSpec * 0.85;
    float coolingFleck = (1.0 - smoothstep(0.0, 0.035, conchoidal)) * smoothstep(0.55, 0.85, noise2D(worldPos * 5.1));
    matColor += vec3(0.65, 0.24, 0.08) * coolingFleck * 0.25;
  }

  // Lantern diffuse & specular bounce onto terrain surfaces
  for (int i = 0; i < 12; i++) {
    if (i >= uNumLanterns) break;
    vec2 lPos = uLanternPos[i];
    vec3 lCol = uLanternColor[i];
    float lRad = max(uLanternRadius[i], 0.25);
    vec2 toL = lPos - worldPos;
    float dist = length(toL);
    float atten = exp(-(dist * dist) / (lRad * lRad * 0.58));
    vec3 lDir3 = normalize(vec3(toL, 0.45));
    float lDiff = max(dot(N3, lDir3), 0.0);
    float lRim = smoothstep(-0.09, 0.0, sdf) * max(dot(sdfN, normalize(toL + vec2(1e-5))), 0.0);
    matColor += lCol * atten * (lDiff * 0.38 + lRim * 0.45);
  }

  vec3 finalRgb = mix(skyCol, matColor, solidMask);

  // Subtle framing vignette
  vec2 vig = vUv * (1.0 - vUv);
  float vigFactor = clamp(pow(max(vig.x * vig.y * 18.0, 1e-4), 0.22), 0.78, 1.0);
  fragColor = vec4(finalRgb * vigFactor, 1.0);
}
`,ls=`#version 300 es
precision highp float;

in vec2 aPos;
in vec2 aUv;
in vec4 aColor;
in vec4 aData; // [effectKind, param1, param2, param3]

uniform vec2 uWorldSize;

out vec2 vUv;
out vec2 vWorldPos;
out vec4 vColor;
out vec4 vData;

void main() {
  vec2 ndc = (aPos / uWorldSize) * 2.0 - 1.0;
  gl_Position = vec4(ndc, 0.0, 1.0);
  vUv = aUv;
  vWorldPos = aPos;
  vColor = aColor;
  vData = aData;
}
`,cs=`#version 300 es
precision highp float;

in vec2 vUv;
in vec2 vWorldPos;
in vec4 vColor;
in vec4 vData;

uniform float uTime;
uniform vec2 uLightDir;
uniform vec3 uSunColor;

out vec4 fragColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float voronoiEdge(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float md1 = 8.0;
  float md2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = vec2(hash21(n + g), hash21(n + g + vec2(41.7, 19.3)));
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < md1) { md2 = md1; md1 = d; }
      else if (d < md2) { md2 = d; }
    }
  }
  return sqrt(md2) - sqrt(md1);
}

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdRoundBox(vec2 p, vec2 b, float r) {
  return sdBox(p, b - vec2(r)) - r;
}

void main() {
  int kind = int(vData.x + 0.5);
  float p1 = vData.y;
  float p2 = vData.z;
  float p3 = vData.w;

  vec2 rawL = normalize(uLightDir + vec2(1e-5, 1e-4));
  vec2 toSun = rawL.y < 0.0 ? -rawL : rawL;

  vec3 rgb = vec3(0.0);
  float alpha = 0.0;
  vec3 additive = vec3(0.0);

  if (kind == 1) {
    // Drain Zone Grate
    float asp = max(p1, 0.2);
    vec2 p = (vUv - 0.5) * vec2(asp, 1.0);
    float frame = sdBox(p, vec2(asp * 0.5, 0.5));
    float inner = sdBox(p, vec2(asp * 0.5 - 0.06, 0.42));
    float frameMask = 1.0 - smoothstep(-0.01, 0.015, frame);
    float innerMask = 1.0 - smoothstep(-0.01, 0.01, inner);

    float bars = abs(fract(vUv.x * max(4.0, floor(asp * 6.0))) - 0.5);
    float barMask = 1.0 - smoothstep(0.11, 0.16, bars);
    float crossBar = 1.0 - smoothstep(0.035, 0.055, abs(vUv.y - 0.5));
    float metalMask = max(1.0 - innerMask, max(barMask, crossBar));

    float suction = (1.0 - smoothstep(0.0, 0.45, length(vUv - 0.5))) * (0.5 + 0.5 * sin(uTime * 4.0 + vUv.y * 12.0));
    vec3 abyss = vec3(0.02, 0.04, 0.07) + vec3(0.06, 0.24, 0.34) * suction * 0.6;
    vec3 bronze = mix(vec3(0.24, 0.18, 0.12), vec3(0.54, 0.42, 0.24), vUv.y * 0.5 + 0.25);

    rgb = mix(abyss, bronze, metalMask);
    alpha = frameMask * 0.88;
  } else if (kind == 2) {
    // Energy Conduit (p1 = chargeRatio, p2 = activated, p3 = length)
    float distCenter = abs(vUv.y - 0.5);
    float tubeMask = 1.0 - smoothstep(0.32, 0.48, distCenter);
    float coreMask = 1.0 - smoothstep(0.03, 0.22, distCenter);

    float flow = sin((vUv.x * max(p3, 1.0) * 4.5 - uTime * (1.8 + p1 * 3.0)) * 3.14159) * 0.5 + 0.5;
    float pulse = flow * flow * flow;

    vec3 dimCol = vec3(0.25, 0.20, 0.12);
    vec3 activeCol = mix(vec3(0.98, 0.72, 0.22), vec3(0.24, 0.92, 1.0), p2);
    float energy = max(0.25 * p1, p2 * 0.85) + pulse * (0.25 + 0.75 * max(p1, p2));

    rgb = dimCol * tubeMask * 0.45;
    alpha = tubeMask * 0.45;
    additive = activeCol * coreMask * energy * 0.85;
  } else if (kind == 3) {
    // Cistern Counterweight Sensor (p1 = fillRatio, p2 = activated, p3 = aspect)
    float asp = max(p3, 0.25);
    vec2 p = (vUv - 0.5) * vec2(asp, 1.0);
    float outer = sdRoundBox(p, vec2(asp * 0.5, 0.5), 0.06);
    float inner = sdRoundBox(p, vec2(asp * 0.5 - 0.07, 0.41), 0.03);

    float bodyMask = 1.0 - smoothstep(-0.01, 0.015, outer);
    float cavityMask = 1.0 - smoothstep(-0.01, 0.01, inner);

    vec3 frameBronze = mix(vec3(0.32, 0.23, 0.14), vec3(0.76, 0.58, 0.28), 0.35 + 0.4 * vUv.y + 0.25 * (1.0 - abs(vUv.x - 0.5)));
    // Corner rivets
    vec2 cornerP = abs(p) - vec2(asp * 0.5 - 0.04, 0.45);
    float rivet = 1.0 - smoothstep(0.014, 0.024, length(cornerP));
    frameBronze += vec3(0.35, 0.28, 0.15) * rivet;

    // Gauge ticks & inner backing
    float tick = (1.0 - smoothstep(0.004, 0.012, abs(fract(vUv.y * 8.0) - 0.5))) * step(0.68, vUv.x) * cavityMask;
    vec3 cavityBg = vec3(0.04, 0.07, 0.11) + vec3(0.35, 0.32, 0.20) * tick;

    // Glowing aqua level meter
    float fillLevel = 0.08 + 0.84 * clamp(p1, 0.0, 1.0);
    float meniscusWave = sin(vUv.x * 16.0 + uTime * 4.5) * 0.01;
    float fluidColMask = (1.0 - smoothstep(fillLevel + meniscusWave - 0.015, fillLevel + meniscusWave + 0.015, vUv.y)) * cavityMask;
    float meniscusLine = (1.0 - smoothstep(0.0, 0.024, abs(vUv.y - (fillLevel + meniscusWave)))) * cavityMask * step(0.01, p1);

    vec3 meterCol = mix(vec3(0.08, 0.58, 0.78), vec3(0.35, 0.96, 1.0), vUv.y * 0.5 + 0.35);
    if (p2 > 0.5) {
      meterCol = mix(meterCol, vec3(0.95, 0.88, 0.45), 0.45 + 0.2 * sin(uTime * 5.0));
    }

    vec3 inside = mix(cavityBg, meterCol, fluidColMask * 0.85);
    rgb = mix(frameBronze, inside, cavityMask);
    alpha = bodyMask * 0.92;
    additive = vec3(0.45, 0.98, 1.0) * meniscusLine * 0.75 + meterCol * fluidColMask * 0.25 + vec3(1.0, 0.84, 0.35) * p2 * bodyMask * 0.18;
  } else if (kind == 4) {
    // Relic Goal Sanctuary Altar (p1 = fulfilled, p2 = pulse, p3 = aspect)
    float asp = max(p3, 0.5);
    vec2 p = (vUv - 0.5) * vec2(asp, 1.0);
    float r = length(p * vec2(1.0, 1.05));
    float theta = atan(p.y, p.x + 1e-5);

    // Pedestal base at bottom
    float base = sdRoundBox(p - vec2(0.0, -0.36), vec2(asp * 0.42, 0.12), 0.03);
    float baseMask = 1.0 - smoothstep(-0.01, 0.015, base);
    vec3 stoneGold = mix(vec3(0.34, 0.28, 0.22), vec3(0.84, 0.68, 0.32), smoothstep(0.08, 0.14, vUv.y));

    // Shimmering portal ring
    float ringR = 0.36;
    float ring = 1.0 - smoothstep(0.015, 0.06, abs(r - ringR));
    float innerRing = 1.0 - smoothstep(0.005, 0.03, abs(r - ringR * 0.72));
    float ticks = 0.5 + 0.5 * cos(theta * 12.0 + uTime * (p1 > 0.5 ? 2.4 : 0.8));
    float coreAura = exp(-r * r * 14.0) * (0.45 + 0.35 * sin(uTime * 3.0) + p1 * 0.7);

    vec3 goldCol = vec3(1.0, 0.80, 0.32);
    vec3 aquaCol = vec3(0.28, 0.95, 1.0);
    vec3 portalCol = mix(aquaCol, goldCol, 0.4 + 0.4 * ticks + p1 * 0.3);

    rgb = stoneGold * baseMask;
    alpha = baseMask * 0.96;
    additive = portalCol * (ring * (0.52 + 0.48 * ticks) + innerRing * 0.35) * (0.55 + p2 * 0.35 + p1 * 0.38)
             + aquaCol * coreAura * 0.45;
  } else if (kind == 5) {
    // Magma Vent (p1 = heatRatio, p2 = quenched, p3 = steamPulse, vColor.a = aspect, vColor.r = goalQuench)
    float asp = max(vColor.a, 0.5);
    vec2 p = (vUv - 0.5) * vec2(asp, 1.0);
    float box = sdRoundBox(p, vec2(asp * 0.5, 0.5), 0.08);
    float edgeFade = 1.0 - smoothstep(-0.02, 0.015, box);
    float crack = voronoiEdge(vWorldPos * 3.2 + vec2(0.0, -uTime * 0.15 * (1.0 - p2)));
    float n = noise2D(vWorldPos * 5.0 + vec2(0.0, -uTime * 0.6 * (1.0 - p2)));

    float heat = clamp(p1, 0.0, 1.0) * (1.0 - p2);
    float vein = 1.0 - smoothstep(0.012, 0.11 * (0.45 + heat), crack);
    float coreGlow = 1.0 - smoothstep(0.06, 0.56, length((vUv - 0.5) * vec2(1.0, 1.15)));

    vec3 darkBasalt = vec3(0.07, 0.055, 0.075);
    vec3 obsidianQuenched = vec3(0.05, 0.045, 0.10) + vec3(0.32, 0.18, 0.45) * vein * 0.35;
    vec3 molten = mix(vec3(0.95, 0.20, 0.02), vec3(1.0, 0.90, 0.34), clamp(vein * 0.65 + coreGlow * 0.55 + n * 0.2, 0.0, 1.0));

    // Subtle golden seal trim if primary goal quench vent
    float rim = smoothstep(-0.08, -0.01, box) * vColor.r;
    vec3 baseCol = mix(darkBasalt, obsidianQuenched, p2);
    rgb = mix(baseCol, molten, vein * heat * 0.85);
    rgb = mix(rgb, vec3(0.75, 0.56, 0.24), rim * 0.55);
    alpha = edgeFade * 0.96;

    float pulse = 0.85 + 0.15 * sin(uTime * 5.2 + vWorldPos.x * 3.0);
    additive = molten * (vein * 0.75 + coreGlow * 0.55) * heat * pulse * edgeFade;
    additive += vec3(0.6, 0.75, 0.85) * p3 * coreGlow * 0.25 * p2;
  } else if (kind == 6) {
    // Cracked Basalt Wall (p1 = damage, p2 = stressGlow, p3 = aspect)
    float asp = max(p3, 0.25);
    vec2 p = (vUv - 0.5) * vec2(asp, 1.0);
    float box = sdRoundBox(p, vec2(asp * 0.5, 0.5), 0.03);
    float mask = 1.0 - smoothstep(-0.01, 0.012, box);

    // Stone blocks
    float seam = min(abs(fract(vWorldPos.x * 1.4) - 0.5), abs(fract(vWorldPos.y * 2.2) - 0.5));
    float stone = smoothstep(0.0, 0.05, seam);
    float grain = noise2D(vWorldPos * 5.5);
    vec3 rockCol = vColor.rgb * (0.62 + 0.38 * grain) * mix(0.55, 1.0, stone);

    // Fracture cracks scaling with damage & stressGlow
    float fissure = voronoiEdge(vWorldPos * 2.7 + vec2(1.4, 3.8));
    float crackWidth = mix(0.038, 0.105, clamp(p1 * 0.85 + p2 * 0.5, 0.0, 1.0));
    float crackMask = 1.0 - smoothstep(0.008, crackWidth, fissure);
    float glowAmt = clamp(0.18 + p1 * 0.9 + p2 * 0.85, 0.0, 1.35);

    vec3 emberCol = mix(vec3(0.95, 0.32, 0.05), vec3(1.0, 0.84, 0.36), clamp(glowAmt * 0.75, 0.0, 1.0));
    // Edge rim light
    float bevel = 1.0 - smoothstep(-0.06, 0.0, box);
    rockCol += uSunColor * (1.0 - bevel) * 0.14 * max(0.2, toSun.y);

    rgb = mix(rockCol, vec3(0.05, 0.03, 0.02), crackMask * 0.75);
    alpha = mask;
    additive = emberCol * crackMask * glowAmt * mask * 0.95;
  } else if (kind == 7) {
    // Sluice Gate Bulkhead (p1 = openProgress, p2 = isOpen, p3 = aspect)
    float asp = max(p3, 0.25);
    vec2 p = (vUv - 0.5) * vec2(asp, 1.0);
    float box = sdRoundBox(p, vec2(asp * 0.5, 0.5), 0.04);
    float mask = 1.0 - smoothstep(-0.01, 0.012, box);

    float border = smoothstep(-0.07, -0.04, box);
    float ribs = 1.0 - smoothstep(0.01, 0.04, abs(fract((p.x + p.y) * 1.4) - 0.5));
    float metalGrain = noise2D(vUv * vec2(18.0, 8.0));

    vec3 bronzeDark = vec3(0.22, 0.16, 0.10);
    vec3 bronzeBright = vec3(0.78, 0.58, 0.28);
    float sheen = 0.35 + 0.45 * vUv.y + 0.2 * (1.0 - abs(vUv.x - 0.5)) + 0.12 * metalGrain;
    vec3 metal = mix(bronzeDark, bronzeBright, clamp(sheen, 0.0, 1.0));
    metal = mix(metal, bronzeDark * 1.15, ribs * 0.35);
    metal += vec3(0.25, 0.20, 0.10) * border;

    // Corner bolts
    vec2 boltP = abs(p) - vec2(max(asp * 0.5 - 0.07, 0.02), 0.42);
    float bolt = 1.0 - smoothstep(0.016, 0.028, length(boltP));
    metal += vec3(0.4, 0.32, 0.18) * bolt;

    // Center glowing rune lock
    float runeR = length(p);
    float rune = 1.0 - smoothstep(0.004, 0.022, abs(runeR - 0.11));
    float runeCore = 1.0 - smoothstep(0.0, 0.055, runeR);
    vec3 runeCol = mix(vec3(1.0, 0.55, 0.16), vec3(0.25, 0.96, 1.0), p2);

    rgb = metal;
    alpha = mask;
    additive = runeCol * (rune * 0.9 + runeCore * 0.65) * mask * (0.65 + 0.35 * sin(uTime * 3.5));
  } else if (kind == 8) {
    // Sluice Gate Guide Rail
    float slot = 1.0 - smoothstep(0.15, 0.45, abs(vUv.x - 0.5));
    float dashes = 1.0 - smoothstep(0.15, 0.35, abs(fract(vUv.y * 6.0) - 0.5));
    rgb = vec3(0.10, 0.09, 0.08) + vec3(0.22, 0.18, 0.11) * dashes * 0.4;
    alpha = slot * 0.42;
  } else if (kind == 9) {
    // Rotating Brass Hydro-Turbine (p1 = chargeRatio, p2 = completed)
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    float theta = atan(p.y, p.x + 1e-5);

    // Outer brass rim ring
    float rim = (1.0 - smoothstep(0.93, 0.98, r)) * smoothstep(0.78, 0.83, r);
    // 6 beveled paddles
    float sector = abs(mod(theta + 3.14159265, 1.04719755) - 0.52359877);
    float bladeWidth = mix(0.22, 0.085, clamp(r, 0.2, 0.95));
    float blades = (1.0 - smoothstep(bladeWidth - 0.04, bladeWidth, sector)) * smoothstep(0.22, 0.28, r) * (1.0 - smoothstep(0.88, 0.95, r));
    // Hub disc
    float hub = 1.0 - smoothstep(0.29, 0.34, r);

    float mask = max(rim, max(blades, hub));
    float spec = 0.5 + 0.5 * cos(theta - 0.8);
    vec3 brass = mix(vec3(0.32, 0.22, 0.10), vec3(0.95, 0.74, 0.32), 0.35 + 0.55 * spec + 0.25 * (1.0 - r));
    // Dark rivet dots on rim
    float rimRivet = 1.0 - smoothstep(0.02, 0.038, length(vec2(sector, r - 0.88)));
    brass = mix(brass, vec3(0.98, 0.88, 0.55), rimRivet * 0.6);

    // Glowing charge core
    float core = 1.0 - smoothstep(0.04, 0.22, r);
    vec3 coreCol = mix(vec3(0.95, 0.45, 0.12), vec3(0.24, 0.96, 1.0), clamp(p1, 0.0, 1.0));
    if (p2 > 0.5) {
      coreCol = mix(coreCol, vec3(0.82, 1.0, 0.98), 0.45 + 0.25 * sin(uTime * 5.0));
    }

    rgb = mix(brass, coreCol, core * 0.85);
    alpha = mask;
    additive = coreCol * core * (0.35 + 0.85 * clamp(p1, 0.0, 1.0) + 0.4 * p2);
  } else if (kind == 10) {
    // Relic Ark Boat Hull + Luminous Core Crystal (p1 = inGoal)
    vec2 p = (vUv - 0.5) * 2.0;
    // Crescent boat hull SDF
    float keelY = -0.68 + 0.72 * p.x * p.x;
    float deckY = 0.22 + 0.30 * p.x * p.x;
    float hullMask = smoothstep(-0.04, 0.04, p.y - keelY)
                   * (1.0 - smoothstep(-0.04, 0.04, p.y - deckY))
                   * (1.0 - smoothstep(0.88, 0.98, abs(p.x)));
    float goldTrim = (1.0 - smoothstep(0.02, 0.11, abs(p.y - deckY))) * hullMask
                   + (1.0 - smoothstep(0.02, 0.10, abs(p.y - keelY))) * hullMask;
    float planks = sin(p.y * 22.0) * 0.5 + 0.5;
    vec3 hullWood = mix(vec3(0.30, 0.18, 0.10), vec3(0.55, 0.34, 0.18), planks * 0.5 + 0.3);
    vec3 goldCol = vec3(0.96, 0.78, 0.30) * (0.75 + 0.25 * p.y);
    vec3 arkCol = mix(hullWood, goldCol, goldTrim);

    // Suspended Relic Crystal above deck
    vec2 cp = p - vec2(0.0, 0.38);
    float cDist = abs(cp.x) * 1.45 + abs(cp.y) * 0.95;
    float crystalMask = 1.0 - smoothstep(0.28, 0.36, cDist);
    float crystalCradle = (1.0 - smoothstep(0.015, 0.045, abs(length(cp) - 0.34))) * step(cp.y, 0.08);
    vec3 crysCol = mix(vec3(0.18, 0.82, 0.98), vec3(0.85, 1.0, 1.0), 1.0 - smoothstep(0.04, 0.28, cDist));
    if (p1 > 0.5) crysCol = mix(crysCol, vec3(1.0, 0.94, 0.58), 0.4);

    float totalMask = max(hullMask, max(crystalMask, crystalCradle));
    rgb = mix(arkCol, goldCol, crystalCradle);
    rgb = mix(rgb, crysCol, crystalMask);
    alpha = totalMask;
    additive = crysCol * exp(-dot(cp, cp) * 9.0) * (0.55 + 0.55 * p1);
  } else if (kind == 11) {
    // Relic Sphere Astrolabe Orb (p1 = inGoal)
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    float sphereMask = 1.0 - smoothstep(0.78, 0.84, r);
    float outerRing = 1.0 - smoothstep(0.03, 0.09, abs(r - 0.90));
    float meridian = (1.0 - smoothstep(0.02, 0.06, abs(abs(p.x) - sqrt(max(0.0, 0.64 - p.y * p.y)) * 0.55))) * sphereMask;

    float sBase = max(0.0, 1.0 - length(p - vec2(-0.28, 0.32)) * 1.45);
    float spec = sBase * sBase * sBase;
    vec3 orbCol = mix(vec3(0.08, 0.45, 0.72), vec3(0.36, 0.95, 1.0), 0.3 + 0.5 * (1.0 - r));
    orbCol += vec3(0.85, 0.98, 1.0) * spec;
    vec3 goldRing = vec3(0.95, 0.76, 0.32);
    if (p1 > 0.5) orbCol = mix(orbCol, vec3(0.95, 0.92, 0.55), 0.35);

    rgb = mix(orbCol, goldRing, max(outerRing, meridian * 0.7));
    alpha = max(sphereMask, outerRing);
    additive = vec3(0.30, 0.92, 1.0) * exp(-r * r * 4.5) * (0.45 + 0.5 * p1);
  } else if (kind == 12) {
    // Brass Aqueduct Spout Nozzle (p1 = enabled)
    vec2 p = (vUv - 0.5) * 2.0;
    // Nozzle pointing +X in local frame
    float body = sdRoundBox(p, vec2(0.82, 0.62 - p.x * 0.12), 0.14);
    float collar = sdRoundBox(p - vec2(-0.55, 0.0), vec2(0.24, 0.78), 0.08);
    float mask = 1.0 - smoothstep(-0.02, 0.04, min(body, collar));
    float mouth = 1.0 - smoothstep(-0.02, 0.04, sdBox(p - vec2(0.64, 0.0), vec2(0.24, 0.36)));

    vec3 brass = mix(vec3(0.28, 0.20, 0.12), vec3(0.82, 0.64, 0.30), 0.5 + 0.35 * p.y - 0.15 * p.x);
    vec3 mouthCol = vec3(0.04, 0.08, 0.12) + vec3(0.18, 0.78, 0.96) * p1 * 0.55;
    rgb = mix(brass, mouthCol, mouth);
    alpha = mask;
    additive = vec3(0.24, 0.88, 1.0) * mouth * p1 * (0.4 + 0.2 * sin(uTime * 6.0));
  } else if (kind == 13) {
    // Turbine Stationary Outer Charge Arc (p1 = chargeRatio, p2 = completed)
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    float theta = atan(p.x, p.y + 1e-5); // 0 at top, increases clockwise
    float angNorm = mod(theta + 6.2831853, 6.2831853) / 6.2831853;

    float track = 1.0 - smoothstep(0.012, 0.045, abs(r - 0.94));
    float filled = step(angNorm, clamp(p1, 0.0, 1.0)) * smoothstep(0.0, 0.015, p1);
    vec3 bgTrack = vec3(0.14, 0.14, 0.16);
    vec3 arcCol = mix(vec3(0.98, 0.72, 0.24), vec3(0.26, 0.96, 1.0), clamp(p1, 0.0, 1.0));
    if (p2 > 0.5) arcCol = vec3(0.45, 1.0, 0.88);

    rgb = bgTrack * track * 0.6;
    alpha = track * 0.65;
    additive = arcCol * track * filled * (0.85 + 0.35 * p2);
  } else if (kind == 14) {
    // Hydro-Portal Entry Ring (Warm Amber-Gold + Inward Swirling Vortex Aura, p1 = pulse)
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    float theta = atan(p.y, p.x + 1e-5);
    float pulse = clamp(p1, 0.0, 2.0);
    float ringR = 0.68 + 0.03 * sin(uTime * 5.0) * (1.0 + pulse);

    // Inward logarithmic spiral vortex
    float spiral = sin(theta * 5.0 + log(max(r, 0.04)) * 8.5 + uTime * (4.2 + pulse * 4.0)) * 0.5 + 0.5;
    float swirlMask = (1.0 - smoothstep(0.05, ringR + 0.04, r)) * smoothstep(0.08, 0.42, r);
    float voidMask = 1.0 - smoothstep(0.42, 0.68, r);

    float outerRing = 1.0 - smoothstep(0.03, 0.095, abs(r - ringR));
    float innerRing = 1.0 - smoothstep(0.015, 0.05, abs(r - ringR * 0.74));
    float ticks = 0.5 + 0.5 * cos(theta * 12.0 + uTime * 2.4);
    float edgeSoft = 1.0 - smoothstep(0.82, 0.99, r);
    float halo = exp(-abs(r - ringR) * 8.5) * (0.42 + 0.60 * pulse) * edgeSoft;

    vec3 amberDeep = vec3(0.22, 0.07, 0.02);
    vec3 amberBright = vec3(1.0, 0.68, 0.18);
    vec3 goldWhite = vec3(1.0, 0.94, 0.62);
    vec3 vortexCol = mix(amberBright, goldWhite, spiral * 0.65 + pulse * 0.3);

    rgb = amberDeep;
    alpha = voidMask * 0.78;
    additive = vortexCol * (outerRing * (0.7 + 0.35 * ticks) + innerRing * 0.45 + swirlMask * spiral * 0.58 + halo) * (0.80 + 0.75 * pulse) * edgeSoft;
  } else if (kind == 15) {
    // Hydro-Portal Exit Ring (Luminous Cyan-Aqua + Outward Vortex Aura, p1 = pulse)
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    float theta = atan(p.y, p.x + 1e-5);
    float pulse = clamp(p1, 0.0, 2.0);
    float ringR = 0.68 + 0.03 * sin(uTime * 5.2 + 1.1) * (1.0 + pulse);

    // Outward swirling vortex
    float spiral = sin(theta * 5.0 - log(max(r, 0.04)) * 8.5 - uTime * (4.6 + pulse * 4.5)) * 0.5 + 0.5;
    float swirlMask = (1.0 - smoothstep(0.05, ringR + 0.04, r)) * smoothstep(0.08, 0.42, r);
    float voidMask = 1.0 - smoothstep(0.42, 0.68, r);

    float outerRing = 1.0 - smoothstep(0.03, 0.095, abs(r - ringR));
    float innerRing = 1.0 - smoothstep(0.015, 0.05, abs(r - ringR * 0.74));
    float ticks = 0.5 + 0.5 * cos(theta * 12.0 - uTime * 2.6);
    float edgeSoft = 1.0 - smoothstep(0.82, 0.99, r);
    float halo = exp(-abs(r - ringR) * 8.5) * (0.42 + 0.60 * pulse) * edgeSoft;

    vec3 cyanDeep = vec3(0.02, 0.14, 0.22);
    vec3 cyanBright = vec3(0.18, 0.90, 1.0);
    vec3 aquaWhite = vec3(0.84, 1.0, 1.0);
    vec3 vortexCol = mix(cyanBright, aquaWhite, spiral * 0.6 + pulse * 0.35);

    rgb = cyanDeep;
    alpha = voidMask * 0.75;
    additive = vortexCol * (outerRing * (0.7 + 0.35 * ticks) + innerRing * 0.45 + swirlMask * spiral * 0.58 + halo) * (0.80 + 0.75 * pulse) * edgeSoft;
  } else if (kind == 16) {
    // Hydro-Portal Exit Directional Nozzle Beam (p1 = pulse, p2 = boostScale)
    float radial = abs(vUv.y - 0.5) * 2.0;
    float halfBeam = mix(0.42, 0.88, vUv.x);
    float beamMask = 1.0 - smoothstep(halfBeam * 0.55, halfBeam, radial);
    float axial = smoothstep(0.0, 0.14, vUv.x) * (1.0 - smoothstep(0.32, 1.0, vUv.x));

    // Directional chevron waves flowing outward along +X
    float chevronPhase = fract((vUv.x - radial * 0.32) * 3.2 - uTime * 2.8);
    float chevron = (1.0 - smoothstep(0.18, 0.45, abs(chevronPhase - 0.5)));
    float pulse = clamp(p1, 0.0, 2.0);

    vec3 beamCol = mix(vec3(0.16, 0.88, 1.0), vec3(0.86, 1.0, 1.0), chevron * 0.55 + pulse * 0.3);
    float strength = beamMask * axial * (0.38 + 0.42 * chevron + 0.65 * pulse);
    rgb = beamCol;
    alpha = strength * 0.22;
    additive = beamCol * strength * 0.78;
  } else if (kind == 17) {
    // Floating Spiked Dark-Brass Hydro-Mine (p1 = flash, p2 = submergedRatio)
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    float theta = atan(p.y, p.x + 1e-5);

    // 8 protruding naval mine spikes
    float spikeSector = abs(mod(theta + 3.14159265, 0.78539816) - 0.39269908);
    float spikeTip = mix(0.12, 0.018, clamp((r - 0.65) / 0.31, 0.0, 1.0));
    float spikeMask = (1.0 - smoothstep(spikeTip - 0.02, spikeTip + 0.012, spikeSector))
                    * smoothstep(0.60, 0.66, r)
                    * (1.0 - smoothstep(0.91, 0.98, r));
    float sphereMask = 1.0 - smoothstep(0.67, 0.73, r);
    float mask = max(sphereMask, spikeMask);

    // Dark oxidized brass spherical hull + sharp metallic rim highlight
    vec3 rimCol = mix(vec3(0.12, 0.10, 0.09), vec3(0.55, 0.44, 0.28), clamp(0.45 + 0.55 * (p.y * 0.6 - p.x * 0.4), 0.0, 1.0));
    float sphereShade = clamp(0.35 + 0.65 * (0.5 + 0.5 * (-p.x * 0.45 + p.y * 0.72)), 0.0, 1.0);
    vec3 brassHull = mix(vec3(0.08, 0.07, 0.06), vec3(0.38, 0.30, 0.19), sphereShade);
    float rimHighlight = smoothstep(0.54, 0.69, r) * sphereMask * max(0.0, p.y * 0.7 - p.x * 0.35 + 0.25);
    brassHull += vec3(0.42, 0.36, 0.24) * rimHighlight;

    // Equatorial seam & rivet studs
    float band = 1.0 - smoothstep(0.04, 0.075, abs(p.y)) * sphereMask;
    brassHull = mix(brassHull * 0.85, brassHull, band);
    float stud = 1.0 - smoothstep(0.025, 0.048, length(vec2(spikeSector * 0.65, r - 0.55)));
    brassHull += vec3(0.28, 0.22, 0.14) * stud * sphereMask;

    // Pulsing crimson-amber explosive core & hazard vents
    float pulse = 0.55 + 0.45 * sin(uTime * 5.2 + p1 * 4.0);
    float flashBoost = clamp(p1, 0.0, 1.5);
    float coreGlow = 1.0 - smoothstep(0.05, 0.26, r);
    float hazardSlit = (1.0 - smoothstep(0.012, 0.036, abs(r - 0.38))) * step(0.12, spikeSector);
    vec3 crimsonCore = mix(vec3(0.95, 0.14, 0.04), vec3(1.0, 0.78, 0.22), coreGlow * 0.7 + flashBoost * 0.5);

    rgb = mix(rimCol, brassHull, sphereMask);
    rgb = mix(rgb, crimsonCore, max(coreGlow * 0.9, hazardSlit * 0.6));
    alpha = mask;
    additive = crimsonCore * (coreGlow * (0.65 + 0.6 * pulse + flashBoost) + hazardSlit * (0.35 + 0.4 * pulse + flashBoost)) * sphereMask;
  } else if (kind == 18) {
    // Hydraulic Seesaw Rotated Basalt-and-Brass Plank (p3 = aspect length/thickness)
    float asp = max(p3, 1.0);
    vec2 p = (vUv - 0.5) * vec2(asp, 1.0);
    float box = sdRoundBox(p, vec2(asp * 0.5, 0.5), 0.14);
    float mask = 1.0 - smoothstep(-0.02, 0.02, box);

    // Carved ancient basalt inner stone + beveled brass edge caps & rails
    float grain = noise2D(vWorldPos * 6.5);
    vec3 stone = vColor.rgb * (0.68 + 0.42 * grain);
    float edgeDist = -box;
    float brassRail = 1.0 - smoothstep(0.08, 0.14, edgeDist);
    float endCap = smoothstep(asp * 0.5 - 0.55, asp * 0.5 - 0.42, abs(p.x));
    float brassMask = max(brassRail, endCap);

    vec3 brass = mix(vec3(0.32, 0.24, 0.12), vec3(0.86, 0.66, 0.30), 0.35 + 0.55 * vUv.y);
    float bevelLight = (1.0 - smoothstep(0.0, 0.08, edgeDist)) * (0.3 + 0.7 * vUv.y);
    brass += uSunColor * bevelLight * 0.22;

    // Rivets along brass end caps
    vec2 rivetP = vec2(abs(p.x) - (asp * 0.5 - 0.28), abs(p.y) - 0.24);
    float rivet = 1.0 - smoothstep(0.035, 0.06, length(rivetP));
    brass += vec3(0.35, 0.28, 0.14) * rivet;

    rgb = mix(stone, brass, brassMask);
    alpha = mask;
  } else if (kind == 19) {
    // Hydraulic Seesaw Ornate Golden Fulcrum Pivot Hub
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    float theta = atan(p.y, p.x + 1e-5);
    float mask = 1.0 - smoothstep(0.88, 0.94, r);

    float outerRing = 1.0 - smoothstep(0.76, 0.84, r);
    float innerCap = 1.0 - smoothstep(0.38, 0.44, r);
    float sector = abs(mod(theta + 3.14159265, 1.04719755) - 0.52359877);
    float rivet = 1.0 - smoothstep(0.04, 0.07, length(vec2(sector * 0.62, r - 0.62)));

    vec3 darkBronze = vec3(0.24, 0.17, 0.09);
    vec3 gold = mix(vec3(0.62, 0.45, 0.18), vec3(0.98, 0.80, 0.34), 0.45 + 0.45 * p.y - 0.2 * p.x);
    rgb = mix(darkBronze, gold, outerRing * 0.45 + innerCap * 0.75 + rivet * 0.8);
    rgb += uSunColor * (1.0 - smoothstep(0.0, 0.12, abs(r - 0.84))) * 0.25;
    alpha = mask;
  } else if (kind == 20) {
    // Interactive Diverter Valve Beveled Bronze Vane (p1 = toggled, p3 = aspect)
    float asp = max(p3, 1.0);
    vec2 p = (vUv - 0.5) * vec2(asp, 1.0);
    float box = sdRoundBox(p, vec2(asp * 0.5, 0.5), 0.16);
    float mask = 1.0 - smoothstep(-0.02, 0.02, box);

    float ridge = 1.0 - smoothstep(0.03, 0.11, abs(p.y));
    float border = 1.0 - smoothstep(0.04, 0.10, -box);
    vec3 bronze = mix(vec3(0.28, 0.20, 0.11), vec3(0.84, 0.62, 0.28), 0.35 + 0.5 * vUv.y);
    bronze += vec3(0.26, 0.22, 0.12) * border;

    vec3 mintTeal = vec3(0.369, 0.918, 0.831);
    vec3 brassGold = vec3(0.988, 0.827, 0.302);
    vec3 inlayCol = mix(mintTeal, brassGold, p1 * 0.45);

    rgb = mix(bronze, inlayCol, ridge * 0.65);
    alpha = mask;
    additive = inlayCol * ridge * 0.35 * mask;
  } else if (kind == 21) {
    // Interactive Diverter Valve Luminous Clickable Hub Button (#5eead4 / #fcd34d brass ring, p1 = toggled)
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    float theta = atan(p.y, p.x + 1e-5);

    vec3 mintAqua = vec3(0.369, 0.918, 0.831);  // #5eead4
    vec3 brassGold = vec3(0.988, 0.827, 0.302); // #fcd34d

    float outerBezel = 1.0 - smoothstep(0.84, 0.91, r);
    float brassRing = (1.0 - smoothstep(0.78, 0.84, r)) * smoothstep(0.48, 0.54, r);
    float innerOrb = 1.0 - smoothstep(0.46, 0.52, r);
    float ticks = 0.5 + 0.5 * cos(theta * 4.0 + (p1 > 0.5 ? 0.7854 : 0.0));

    float pulse = 0.82 + 0.18 * sin(uTime * 4.0);
    float glint = exp(-dot(p - vec2(-0.14, 0.18), p - vec2(-0.14, 0.18)) * 18.0);
    vec3 ringCol = brassGold * (0.78 + 0.22 * (p.y + ticks * 0.4));
    vec3 coreCol = mix(mintAqua, vec3(0.88, 1.0, 0.97), glint * 0.75 + (1.0 - smoothstep(0.0, 0.25, r)) * 0.35);
    if (p1 > 0.5) {
      coreCol = mix(coreCol, brassGold, 0.28);
    }

    vec3 darkRim = vec3(0.08, 0.10, 0.12);
    rgb = mix(darkRim, ringCol, brassRing);
    rgb = mix(rgb, coreCol, innerOrb);
    alpha = outerBezel;

    float outerHalo = exp(-abs(r - 0.72) * 5.2) * (0.42 + 0.18 * sin(uTime * 3.2));
    additive = (coreCol * innerOrb * 0.55 + mix(mintAqua, brassGold, 0.5) * outerHalo) * pulse;
  } else if (kind == 22) {
    // Hydro-Relay Tesla Arc Filament (p1 = charge, p2 = active, p3 = length)
    float charge = clamp(p1, 0.0, 1.0);
    float endEnv = sin(clamp(vUv.x, 0.0, 1.0) * 3.14159265);
    float amp = mix(0.04, 0.15, max(charge, p2));

    float jag1 = (sin(vUv.x * max(p3, 1.0) * 9.0 - uTime * 20.0) * 0.6
                + sin(vUv.x * max(p3, 1.0) * 19.0 + uTime * 31.0) * 0.4) * amp * endEnv;
    float jag2 = (sin(vUv.x * max(p3, 1.0) * 11.0 + uTime * 24.0 + 1.8) * 0.55
                + cos(vUv.x * max(p3, 1.0) * 23.0 - uTime * 27.0) * 0.45) * amp * 1.15 * endEnv;

    float d1 = abs(vUv.y - 0.5 - jag1);
    float d2 = abs(vUv.y - 0.5 - jag2);
    float arc1 = 1.0 - smoothstep(0.015, 0.085, d1);
    float arc2 = 1.0 - smoothstep(0.015, 0.075, d2);
    float glow = exp(-d1 * 7.5) * 0.65 + exp(-d2 * 8.5) * 0.45;

    // Subtle dormant guide line when charge is near zero
    float guideDot = (1.0 - smoothstep(0.03, 0.09, abs(vUv.y - 0.5)))
                   * step(0.45, fract(vUv.x * max(p3, 1.0) * 3.0)) * 0.22;

    vec3 copperDim = vec3(0.76, 0.45, 0.20);
    vec3 teslaCyan = vec3(0.24, 0.94, 1.0);
    vec3 arcCol = mix(copperDim, teslaCyan, smoothstep(0.05, 0.55, charge) + p2 * 0.5);
    vec3 coreWhite = mix(arcCol, vec3(0.88, 1.0, 1.0), 0.72);

    float intensity = max(0.15, charge * 0.95 + p2 * 0.55);
    rgb = arcCol;
    alpha = guideDot * (1.0 - charge) * 0.4;
    additive = (coreWhite * (arc1 + arc2 * 0.7) * 0.85 + arcCol * glow * 0.75) * intensity * endEnv + copperDim * guideDot;
  } else if (kind == 23) {
    // Hydro-Relay Copper/Cyan Tesla Electrode Pylon (p1 = charge, p2 = active, p3 = isObjective)
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    float charge = clamp(p1, 0.0, 1.0);

    float baseMask = 1.0 - smoothstep(0.84, 0.91, r);
    // Concentric copper coil rings
    float coilWave = 0.5 + 0.5 * cos(r * 24.0);
    float coilMask = (1.0 - smoothstep(0.76, 0.83, r)) * smoothstep(0.32, 0.38, r);
    float coreOrb = 1.0 - smoothstep(0.26, 0.34, r);

    vec3 copperDark = vec3(0.36, 0.19, 0.09);
    vec3 copperBright = vec3(0.88, 0.54, 0.24);
    vec3 cyanGlow = vec3(0.22, 0.95, 1.0);
    vec3 coilCol = mix(copperDark, copperBright, coilWave * 0.8 + 0.2);

    // Energize coils & orb from warm copper to electric cyan with charge
    float energize = clamp(charge * 0.9 + p2 * 0.4, 0.0, 1.0);
    coilCol = mix(coilCol, cyanGlow, energize * coilWave * 0.52);
    vec3 orbCol = mix(vec3(0.85, 0.45, 0.16), vec3(0.62, 0.98, 1.0), energize);

    // Optional objective gold collar
    float objRing = (1.0 - smoothstep(0.018, 0.045, abs(r - 0.83))) * p3;
    coilCol = mix(coilCol, vec3(0.98, 0.82, 0.32), objRing * 0.85);

    rgb = mix(vec3(0.10, 0.09, 0.11), coilCol, coilMask);
    rgb = mix(rgb, orbCol, coreOrb);
    alpha = baseMask;

    float pulse = 0.78 + 0.22 * sin(uTime * 6.0);
    additive = cyanGlow * (coreOrb * (0.18 + 0.65 * energize) + coilMask * coilWave * energize * 0.35) * pulse
             + vec3(0.95, 0.68, 0.26) * objRing * 0.30;
  } else if (kind == 24) {
    // Geyser Pump Animated Cyan Hydro-Jet Plume Cone (p1 = power, p2 = active, p3 = range)
    float power = clamp(p1, 0.0, 1.0);
    if (power <= 0.01) discard;

    float halfCone = mix(0.18, 0.48, vUv.x);
    float radial = abs(vUv.y - 0.5) / max(halfCone, 0.05);
    float coneMask = 1.0 - smoothstep(0.62, 1.0, radial);
    float axialFade = smoothstep(0.0, 0.08, vUv.x) * (1.0 - smoothstep(0.50, 1.0, vUv.x));

    float flowWave = 0.5 + 0.5 * sin(vUv.x * max(p3, 1.0) * 8.5 - uTime * 15.0 - radial * 2.2);
    float coreJet = (1.0 - smoothstep(0.0, 0.48, radial)) * (1.0 - smoothstep(0.20, 0.82, vUv.x));
    vec3 cyanPlume = mix(vec3(0.14, 0.78, 0.98), vec3(0.82, 0.99, 1.0), coreJet);

    float strength = coneMask * axialFade * (0.45 + 0.55 * flowWave) * power;
    rgb = cyanPlume;
    alpha = strength * 0.26;
    additive = cyanPlume * strength * 0.92;
  } else if (kind == 25) {
    // Geyser Pump Bronze Directional Nozzle Housing (p1 = power, p2 = active)
    vec2 p = (vUv - 0.5) * 2.0;
    float baseBlock = sdRoundBox(p - vec2(-0.34, 0.0), vec2(0.46, 0.72), 0.14);
    float barrel = sdRoundBox(p - vec2(0.16, 0.0), vec2(0.56, 0.48 - p.x * 0.06), 0.10);
    float muzzleCollar = sdRoundBox(p - vec2(0.58, 0.0), vec2(0.16, 0.64), 0.06);
    float bodySdf = min(baseBlock, min(barrel, muzzleCollar));
    float mask = 1.0 - smoothstep(-0.03, 0.03, bodySdf);
    float throat = 1.0 - smoothstep(-0.02, 0.03, sdBox(p - vec2(0.64, 0.0), vec2(0.22, 0.34)));

    vec3 bronzeDark = vec3(0.24, 0.17, 0.10);
    vec3 bronzeBright = vec3(0.82, 0.62, 0.28);
    vec3 housing = mix(bronzeDark, bronzeBright, clamp(0.45 + 0.42 * p.y - 0.15 * p.x, 0.0, 1.0));
    float rim = 1.0 - smoothstep(0.0, 0.12, -bodySdf);
    housing += uSunColor * rim * 0.16 * max(0.2, p.y + 0.4);

    // Pressurized throat & status pressure orb
    float gaugeOrb = 1.0 - smoothstep(0.12, 0.20, length(p - vec2(-0.22, 0.0)));
    vec3 statusCol = mix(vec3(0.98, 0.58, 0.15), vec3(0.22, 0.96, 1.0), clamp(p1 + p2 * 0.5, 0.0, 1.0));
    vec3 throatCol = vec3(0.04, 0.08, 0.12) + vec3(0.18, 0.85, 1.0) * clamp(p1, 0.0, 1.0) * 0.65;

    rgb = mix(housing, throatCol, throat);
    rgb = mix(rgb, statusCol, gaugeOrb);
    alpha = mask;
    additive = statusCol * gaugeOrb * (0.45 + 0.75 * clamp(p1, 0.0, 1.0))
             + vec3(0.22, 0.92, 1.0) * throat * clamp(p1, 0.0, 1.0) * 0.55;
  }

  fragColor = vec4(rgb * alpha + additive, alpha);
}
`,hs=`#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uFluidTex;
uniform sampler2D uSceneTex;
uniform sampler2D uTerrainSdfTex;

uniform vec2 uWorldSize;
uniform float uTime;
uniform float uIsFloat;
uniform float uQuality;

uniform vec3 uWaterDeep;
uniform vec3 uWaterShallow;
uniform vec3 uSkyTop;
uniform vec3 uSkyBottom;
uniform vec2 uLightDir;
uniform vec3 uSunColor;

uniform int uNumLanterns;
uniform vec2 uLanternPos[12];
uniform vec3 uLanternColor[12];
uniform float uLanternRadius[12];

out vec4 fragColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float causticLayer(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float minD = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(hash21(i + g), hash21(i + g + vec2(17.3, 43.1)));
      o = 0.5 + 0.42 * sin(uTime * 1.45 + 6.2831 * o);
      float d = length(g + o - f);
      minD = min(minD, d);
    }
  }
  return pow(clamp(minD, 1e-4, 1.0), 3.4);
}

float sampleDensity(vec2 uv) {
  float r = texture(uFluidTex, uv).r;
  return r * (uIsFloat > 0.5 ? 1.0 : 1.75);
}

void main() {
  vec3 sceneCol = texture(uSceneTex, vUv).rgb;
  vec4 raw = texture(uFluidTex, vUv);
  float densityScale = uIsFloat > 0.5 ? 1.0 : 1.75;
  float density = raw.r * densityScale;

  if (density < 0.09) {
    fragColor = vec4(sceneCol, 1.0);
    return;
  }

  float waterAlpha = smoothstep(0.14, 0.28, density);
  if (waterAlpha <= 0.001) {
    fragColor = vec4(sceneCol, 1.0);
    return;
  }

  vec2 worldPos = vUv * uWorldSize;
  vec2 rawL = normalize(uLightDir + vec2(1e-5, 1e-4));
  vec2 toSun = rawL.y < 0.0 ? -rawL : rawL;

  // Unpack velocity & foam from fluid field
  vec2 vel = vec2(0.0);
  float foam = 0.0;
  if (raw.r > 0.002) {
    if (uIsFloat > 0.5) {
      vel = raw.gb / raw.r;
      foam = raw.a / raw.r;
    } else {
      vel = (raw.gb / raw.r - 0.5) * 2.0;
      foam = raw.a / raw.r;
    }
    vel *= 16.0;
  }

  // Smooth density gradient + curvature for liquid surface normals & foam crests
  vec2 eps = vec2(0.044 / uWorldSize.x, 0.044 / uWorldSize.y);
  float dL = sampleDensity(vUv - vec2(eps.x, 0.0));
  float dR = sampleDensity(vUv + vec2(eps.x, 0.0));
  float dD = sampleDensity(vUv - vec2(0.0, eps.y));
  float dU = sampleDensity(vUv + vec2(0.0, eps.y));
  vec2 grad = vec2(dR - dL, dU - dD);
  float laplacian = dL + dR + dD + dU - 4.0 * density;

  // Attenuate density-grid gradient inside deep pool cores so liquid stays glassy-smooth
  float surfaceBand = 1.0 - smoothstep(0.32, 0.95, density);
  vec2 smoothGrad = grad * (0.35 + 0.65 * surfaceBand);

  // Velocity-advected animated capillary micro-wave ripples
  vec2 flowShift = vel * 0.045;
  vec2 wp1 = worldPos * 3.6 - flowShift + vec2(uTime * 0.85, -uTime * 0.52);
  vec2 wp2 = worldPos * 7.4 - flowShift * 1.4 + vec2(-uTime * 0.65, uTime * 1.05);
  float speedBoost = 1.0 + clamp(length(vel) * 0.18, 0.0, 1.1);
  vec2 rippleGrad = vec2(
    cos(wp1.x * 1.3 + sin(wp1.y)) * 0.55 + cos(wp2.x - wp2.y * 0.8) * 0.45,
    sin(wp1.y * 1.4 + cos(wp1.x)) * 0.55 + sin(wp2.y + wp2.x * 0.7) * 0.45
  ) * 0.048 * speedBoost;

  vec3 N = normalize(vec3(-smoothGrad.x * 2.4 + rippleGrad.x, -smoothGrad.y * 2.4 + rippleGrad.y, 0.52));

  // Snell's Law refraction + chromatic RGB dispersion on steep crests
  vec3 refractedRay = refract(vec3(0.0, 0.0, -1.0), N, 0.75);
  vec2 refractOffset = refractedRay.xy * 0.046 * vec2(uWorldSize.y / uWorldSize.x, 1.0);
  float dispScale = (0.04 + 0.06 * uQuality) * (0.35 + 0.65 * length(N.xy));

  vec2 uvR = clamp(vUv + refractOffset * (1.0 - dispScale), vec2(0.001), vec2(0.999));
  vec2 uvG = clamp(vUv + refractOffset, vec2(0.001), vec2(0.999));
  vec2 uvB = clamp(vUv + refractOffset * (1.0 + dispScale), vec2(0.001), vec2(0.999));

  vec3 refractedScene = vec3(
    texture(uSceneTex, uvR).r,
    texture(uSceneTex, uvG).g,
    texture(uSceneTex, uvB).b
  );

  // Animated underwater caustics projected onto refracted background
  float terrainSdf = (texture(uTerrainSdfTex, uvG).r - 0.5) * 2.0;
  float localSdf = (texture(uTerrainSdfTex, vUv).r - 0.5) * 2.0;
  vec2 causticPos = worldPos * 1.65 - toSun * 0.35 + N.xy * 0.42;
  float c1 = causticLayer(causticPos + vec2(uTime * 0.14, -uTime * 0.09));
  float c2 = uQuality > 0.5 ? causticLayer(causticPos * 1.37 - vec2(uTime * 0.11, uTime * 0.12)) : c1;
  float caustics = (c1 * 0.6 + c2 * 0.4) * 1.45;
  float causticVisibility = (1.0 - smoothstep(0.2, 2.4, density)) * (0.55 + 0.45 * (1.0 - smoothstep(0.0, 0.6, abs(terrainSdf))));
  refractedScene += mix(uWaterShallow, uSunColor, 0.55) * caustics * causticVisibility * 0.42;

  // Beer-Lambert optical absorption (shallow bright turquoise -> deep rich sapphire)
  float opticalDepth = clamp(density * 0.85, 0.0, 2.2) * (0.62 + 0.38 * clamp(terrainSdf + 0.25, 0.0, 1.0));
  vec3 sigma = (vec3(1.0) - clamp(uWaterDeep, 0.02, 0.92)) * vec3(1.85, 1.05, 0.62);
  vec3 transmittance = exp(-sigma * opticalDepth);
  vec3 scatterCol = mix(uWaterShallow, uWaterDeep, smoothstep(0.18, 1.35, opticalDepth));
  vec3 waterBody = refractedScene * transmittance + scatterCol * (1.0 - transmittance) * 0.72;

  // Subsurface turquoise glow in sunlit thin wave crests
  float thinCrest = (1.0 - smoothstep(0.16, 0.55, density)) * max(0.0, dot(N.xy, toSun) * 0.5 + 0.5);
  waterBody += uWaterShallow * thinCrest * 0.22;

  // Schlick Fresnel reflection + Sun Specular Glints
  float cosTheta = clamp(N.z, 0.0, 1.0);
  float omc = 1.0 - cosTheta;
  float fresnel = 0.04 + 0.96 * (omc * omc * omc * omc);
  vec3 reflDir = reflect(vec3(0.0, 0.0, -1.0), N);
  vec3 skyRefl = mix(uSkyBottom, uSkyTop, clamp(0.5 + reflDir.y * 0.85, 0.0, 1.0));

  vec3 L3 = normalize(vec3(toSun.x, toSun.y, 0.72));
  vec3 H3 = normalize(L3 + vec3(0.0, 0.0, 1.0));
  float ndoth = max(dot(N, H3), 1e-4);
  float specSharp = pow(ndoth, 72.0);
  float specBroad = pow(ndoth, 14.0);

  vec3 waterColor = mix(waterBody, skyRefl, fresnel * 0.62);
  waterColor += uSunColor * (specSharp * 1.45 + specBroad * 0.16);

  // Warm Lantern reflections on water ripples
  for (int i = 0; i < 12; i++) {
    if (i >= uNumLanterns) break;
    vec2 toL = uLanternPos[i] - worldPos;
    float dist = length(toL);
    float rad = max(uLanternRadius[i], 0.25);
    float atten = exp(-(dist * dist) / (rad * rad * 0.65));
    vec3 lDir3 = normalize(vec3(toL, 0.65));
    vec3 lH = normalize(lDir3 + vec3(0.0, 0.0, 1.0));
    float lSpec = pow(max(dot(N, lH), 1e-4), 28.0);
    waterColor += uLanternColor[i] * atten * (0.14 + lSpec * 0.85);
  }

  // Whitewater Foam & crisp air-water meniscus (suppressed against rock floor/wall borders)
  float airBorder = smoothstep(0.02, 0.15, localSdf);
  float crestFactor = clamp((length(grad) * 1.35 - laplacian * 0.45) * surfaceBand, 0.0, 1.0);
  float meniscus = smoothstep(0.14, 0.21, density) * (1.0 - smoothstep(0.21, 0.34, density)) * airBorder;
  float bubbleTex = noise2D(worldPos * 16.0 - flowShift * 1.6) * 0.65 + noise2D(worldPos * 32.0 + uTime * 0.8) * 0.35;
  float foamTrigger = smoothstep(0.28, 0.90, foam * 0.88 + crestFactor * 0.42);
  float foamStrength = foamTrigger * (0.35 + 0.65 * smoothstep(0.32, 0.78, bubbleTex));
  foamStrength = clamp(foamStrength * 0.78 + meniscus * 0.55, 0.0, 0.92);

  vec3 foamColor = mix(uWaterShallow * 1.1 + 0.25, vec3(0.95, 0.99, 1.0), 0.84);
  waterColor = mix(waterColor, foamColor, foamStrength);

  vec3 finalRgb = mix(sceneCol, waterColor, waterAlpha);
  fragColor = vec4(finalRgb, 1.0);
}
`,ds=`#version 300 es
precision highp float;

in vec2 aCorner;      // [-1, 1]^2 quad corner
in vec4 aInstPosVel;  // [x, y, vx, vy]
in vec2 aInstLife;    // [life, maxLife]

uniform vec2 uWorldSize;

out vec2 vLocal;
out float vAlpha;

void main() {
  vec2 pos = aInstPosVel.xy;
  vec2 vel = aInstPosVel.zw;
  float speed = length(vel);
  vec2 dir = speed > 0.05 ? vel / speed : vec2(0.0, 1.0);
  vec2 perp = vec2(-dir.y, dir.x);

  float lifeRatio = clamp(aInstLife.x / max(aInstLife.y, 0.001), 0.0, 1.0);
  float radius = 0.026 * (0.65 + 0.35 * lifeRatio);
  float stretch = 1.0 + min(speed * 0.26, 2.2);

  vec2 world = pos + perp * (aCorner.x * radius) + dir * (aCorner.y * radius * stretch);
  vec2 ndc = (world / uWorldSize) * 2.0 - 1.0;
  gl_Position = vec4(ndc, 0.0, 1.0);

  vLocal = aCorner;
  vAlpha = smoothstep(0.0, 0.28, lifeRatio);
}
`,us=`#version 300 es
precision highp float;

in vec2 vLocal;
in float vAlpha;

uniform vec3 uWaterShallow;
uniform vec3 uSunColor;

out vec4 fragColor;

void main() {
  float r2 = dot(vLocal, vLocal);
  if (r2 > 1.0) discard;
  float disc = 1.0 - smoothstep(0.2, 1.0, r2);
  float glint = exp(-dot(vLocal - vec2(-0.2, 0.25), vLocal - vec2(-0.2, 0.25)) * 7.0);
  vec3 col = mix(uWaterShallow * 0.8 + 0.3, vec3(0.95, 0.99, 1.0), 0.65) + uSunColor * glint * 0.65;
  float a = disc * vAlpha * 0.85;
  fragColor = vec4(col * a, a);
}
`,ps=`#version 300 es
precision highp float;

in vec2 aCorner;
in vec4 aInstPosVel;
in vec2 aInstLife;

uniform vec2 uWorldSize;

out vec2 vLocal;
out float vAlpha;
out float vSeed;

void main() {
  vec2 pos = aInstPosVel.xy;
  vec2 vel = aInstPosVel.zw;
  float speed = length(vel);
  vec2 dir = speed > 0.05 ? vel / speed : vec2(0.0, 1.0);
  vec2 perp = vec2(-dir.y, dir.x);

  float lifeRatio = clamp(aInstLife.x / max(aInstLife.y, 0.001), 0.0, 1.0);
  float age = 1.0 - lifeRatio;
  float radius = mix(0.08, 0.24, age);
  float stretch = 1.0 + min(speed * 0.12, 0.45);

  vec2 world = pos + perp * (aCorner.x * radius) + dir * (aCorner.y * radius * stretch);
  vec2 ndc = (world / uWorldSize) * 2.0 - 1.0;
  gl_Position = vec4(ndc, 0.0, 1.0);

  vLocal = aCorner;
  vAlpha = smoothstep(0.0, 0.35, lifeRatio) * (1.0 - smoothstep(0.84, 1.0, lifeRatio));
  vSeed = fract(sin(dot(pos, vec2(12.9898, 78.233))) * 43758.5453);
}
`,fs=`#version 300 es
precision highp float;

in vec2 vLocal;
in float vAlpha;
in float vSeed;

uniform float uTime;
uniform vec3 uSunColor;

out vec4 fragColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

void main() {
  float r = length(vLocal);
  if (r > 1.0) discard;
  float wisp = noise2D(vLocal * 2.2 + vec2(vSeed * 10.0, -uTime * 0.7));
  float puff = 1.0 - smoothstep(0.15, 1.0, r + (wisp - 0.5) * 0.38);
  vec3 steamCol = mix(vec3(0.76, 0.84, 0.90), vec3(0.98, 0.98, 0.96) + uSunColor * 0.12, 0.45 + 0.55 * vLocal.y);
  float a = puff * vAlpha * 0.34;
  fragColor = vec4(steamCol * a, a);
}
`,ms=`#version 300 es
precision highp float;

in vec2 aCorner;
in vec4 aInstGeom; // [x, y, angle, size]
in vec3 aInstMeta; // [life, maxLife, kindFloat]

uniform vec2 uWorldSize;

out vec2 vLocal;
out float vAlpha;
out float vKind;

void main() {
  vec2 pos = aInstGeom.xy;
  float ang = aInstGeom.z;
  float sz = aInstGeom.w;
  float c = cos(ang);
  float s = sin(ang);
  vec2 rotCorner = vec2(aCorner.x * c - aCorner.y * s, aCorner.x * s + aCorner.y * c);

  vec2 world = pos + rotCorner * sz;
  vec2 ndc = (world / uWorldSize) * 2.0 - 1.0;
  gl_Position = vec4(ndc, 0.0, 1.0);

  float lifeRatio = clamp(aInstMeta.x / max(aInstMeta.y, 0.001), 0.0, 1.0);
  vLocal = aCorner;
  vAlpha = smoothstep(0.0, 0.25, lifeRatio);
  vKind = aInstMeta.z;
}
`,vs=`#version 300 es
precision highp float;

in vec2 vLocal;
in float vAlpha;
in float vKind;

uniform vec3 uRockTint;
uniform vec3 uSunColor;

out vec4 fragColor;

void main() {
  int kind = int(vKind + 0.5);
  // Angular polygonal shard shape
  float poly = max(abs(vLocal.x) * 0.85 + abs(vLocal.y) * 0.55, abs(vLocal.y) * 0.95);
  float mask = 1.0 - smoothstep(0.68, 0.86, poly);
  if (mask <= 0.001) discard;

  vec3 col = vec3(0.0);
  vec3 glow = vec3(0.0);

  if (kind == 0) {
    // Fractured basalt rock chip
    float shade = 0.55 + 0.45 * (vLocal.y * 0.5 + 0.5);
    col = uRockTint * shade + uSunColor * max(0.0, vLocal.y) * 0.16;
  } else if (kind == 1) {
    // Sparkling ice crystal shard
    float facet = step(0.0, vLocal.x + vLocal.y * 0.5);
    col = mix(vec3(0.55, 0.90, 1.0), vec3(0.92, 0.99, 1.0), facet * 0.7);
    glow = vec3(0.35, 0.85, 1.0) * 0.25;
  } else {
    // Incandescent magma ember
    float core = 1.0 - smoothstep(0.0, 0.7, length(vLocal));
    col = mix(vec3(1.0, 0.30, 0.05), vec3(1.0, 0.92, 0.48), core);
    glow = col * 0.85;
  }

  float a = mask * vAlpha;
  fragColor = vec4(col * a + glow * vAlpha, a);
}
`,$t=12,Ot=12,qt=6,Wt=6,Gt=7;class gs{constructor(t){v(this,"canvas");v(this,"gl");v(this,"width",1);v(this,"height",1);v(this,"quality","ultra");v(this,"useFloatFluid",!1);v(this,"disposed",!1);v(this,"fluidSplatProg");v(this,"blurProg");v(this,"worldTerrainProg");v(this,"mechProg");v(this,"waterCompositeProg");v(this,"sprayProg");v(this,"steamProg");v(this,"debrisProg");v(this,"quadVBO");v(this,"quadVAO");v(this,"fluidVAO");v(this,"fluidVBO");v(this,"fluidVBOCapacityFloats",ct*5);v(this,"mechVAO");v(this,"mechVBO");v(this,"mechData",new Float32Array(16384*Ot));v(this,"mechVertexCount",0);v(this,"mechVBOCapacityFloats",16384*Ot);v(this,"instQuadVBO");v(this,"sprayVAO");v(this,"sprayInstVBO");v(this,"sprayData",new Float32Array(ft*qt));v(this,"sprayCapacity",ft);v(this,"steamVAO");v(this,"steamInstVBO");v(this,"steamData",new Float32Array(Tt*Wt));v(this,"steamCapacity",Tt);v(this,"debrisVAO");v(this,"debrisInstVBO");v(this,"debrisData",new Float32Array(ve*Gt));v(this,"debrisCapacity",ve);v(this,"terrainSdfTex");v(this,"terrainKindTex");v(this,"terrainSdfBytes",new Uint8Array(F*q*4));v(this,"terrainKindBytes",new Uint8Array(F*q));v(this,"lastTerrainVersion",-1);v(this,"terrainUploaded",!1);v(this,"fluidFBO",null);v(this,"blurTempFBO",null);v(this,"fluidSmoothFBO",null);v(this,"sceneFBO",null);v(this,"lanternPos",new Float32Array($t*2));v(this,"lanternColor",new Float32Array($t*3));v(this,"lanternRadius",new Float32Array($t));v(this,"gateMap",new Map);v(this,"pumpMap",new Map);v(this,"triggerMap",new Map);this.canvas=t;const s={alpha:!1,antialias:!1,depth:!1,stencil:!1,powerPreference:"high-performance",preserveDrawingBuffer:!1},e=t.getContext("webgl2",s)??t.getContext("webgl2");if(!e)throw new Error("WebGL2 is not supported on this device or browser.");this.gl=e;const i=e.getExtension("EXT_color_buffer_float"),o=e.getExtension("OES_texture_float_linear");this.useFloatFluid=this.probeFloatFBO(i!==null&&o!==null),this.fluidSplatProg=this.createProgram(as,os,["uWorldSize","uViewportSize","uPointWorldDiameter","uIsFloat","uSplatScale"]),this.blurProg=this.createProgram(de,ns,["uTex","uBlurStep"]),this.worldTerrainProg=this.createProgram(de,rs,["uTerrainSdfTex","uTerrainKindTex","uWorldSize","uTime","uQuality","uSkyTop","uSkyBottom","uRockTint","uLightDir","uSunColor","uNumLanterns","uLanternPos","uLanternColor","uLanternRadius"]),this.mechProg=this.createProgram(ls,cs,["uWorldSize","uTime","uLightDir","uSunColor"]),this.waterCompositeProg=this.createProgram(de,hs,["uFluidTex","uSceneTex","uTerrainSdfTex","uWorldSize","uTime","uIsFloat","uQuality","uWaterDeep","uWaterShallow","uSkyTop","uSkyBottom","uLightDir","uSunColor","uNumLanterns","uLanternPos","uLanternColor","uLanternRadius"]),this.sprayProg=this.createProgram(ds,us,["uWorldSize","uWaterShallow","uSunColor"]),this.steamProg=this.createProgram(ps,fs,["uWorldSize","uTime","uSunColor"]),this.debrisProg=this.createProgram(ms,vs,["uWorldSize","uRockTint","uSunColor"]);const a=new Float32Array([-1,-1,1,-1,-1,1,1,1]);this.quadVBO=this.requireBuffer(),e.bindBuffer(e.ARRAY_BUFFER,this.quadVBO),e.bufferData(e.ARRAY_BUFFER,a,e.STATIC_DRAW),this.quadVAO=this.requireVAO(),e.bindVertexArray(this.quadVAO),e.bindBuffer(e.ARRAY_BUFFER,this.quadVBO),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,0,0),this.fluidVBO=this.requireBuffer(),e.bindBuffer(e.ARRAY_BUFFER,this.fluidVBO),e.bufferData(e.ARRAY_BUFFER,this.fluidVBOCapacityFloats*4,e.DYNAMIC_DRAW),this.fluidVAO=this.requireVAO(),e.bindVertexArray(this.fluidVAO),e.bindBuffer(e.ARRAY_BUFFER,this.fluidVBO),this.bindAttrib(this.fluidSplatProg.program,"aPos",2,20,0),this.bindAttrib(this.fluidSplatProg.program,"aVel",2,20,8),this.bindAttrib(this.fluidSplatProg.program,"aFoam",1,20,16),this.mechVBO=this.requireBuffer(),e.bindBuffer(e.ARRAY_BUFFER,this.mechVBO),e.bufferData(e.ARRAY_BUFFER,this.mechVBOCapacityFloats*4,e.DYNAMIC_DRAW),this.mechVAO=this.requireVAO(),e.bindVertexArray(this.mechVAO),e.bindBuffer(e.ARRAY_BUFFER,this.mechVBO);const r=Ot*4;this.bindAttrib(this.mechProg.program,"aPos",2,r,0),this.bindAttrib(this.mechProg.program,"aUv",2,r,8),this.bindAttrib(this.mechProg.program,"aColor",4,r,16),this.bindAttrib(this.mechProg.program,"aData",4,r,32),this.instQuadVBO=this.requireBuffer(),e.bindBuffer(e.ARRAY_BUFFER,this.instQuadVBO),e.bufferData(e.ARRAY_BUFFER,a,e.STATIC_DRAW),this.sprayInstVBO=this.requireBuffer(),e.bindBuffer(e.ARRAY_BUFFER,this.sprayInstVBO),e.bufferData(e.ARRAY_BUFFER,this.sprayCapacity*qt*4,e.DYNAMIC_DRAW),this.sprayVAO=this.setupInstancedVAO(this.sprayProg.program,this.sprayInstVBO,qt*4,[{name:"aInstPosVel",size:4,offset:0},{name:"aInstLife",size:2,offset:16}]),this.steamInstVBO=this.requireBuffer(),e.bindBuffer(e.ARRAY_BUFFER,this.steamInstVBO),e.bufferData(e.ARRAY_BUFFER,this.steamCapacity*Wt*4,e.DYNAMIC_DRAW),this.steamVAO=this.setupInstancedVAO(this.steamProg.program,this.steamInstVBO,Wt*4,[{name:"aInstPosVel",size:4,offset:0},{name:"aInstLife",size:2,offset:16}]),this.debrisInstVBO=this.requireBuffer(),e.bindBuffer(e.ARRAY_BUFFER,this.debrisInstVBO),e.bufferData(e.ARRAY_BUFFER,this.debrisCapacity*Gt*4,e.DYNAMIC_DRAW),this.debrisVAO=this.setupInstancedVAO(this.debrisProg.program,this.debrisInstVBO,Gt*4,[{name:"aInstGeom",size:4,offset:0},{name:"aInstMeta",size:3,offset:16}]),e.bindVertexArray(null),e.bindBuffer(e.ARRAY_BUFFER,null),this.terrainSdfTex=this.createTerrainTexture(e.RGBA8,e.RGBA,e.LINEAR),this.terrainKindTex=this.createTerrainTexture(e.R8,e.RED,e.NEAREST);const c=Math.max(1,t.width||t.clientWidth||1280),l=Math.max(1,t.height||t.clientHeight||720);this.resize(c,l)}resize(t,s){if(this.disposed)return;const e=Math.max(1,Math.floor(t)),i=Math.max(1,Math.floor(s));(this.canvas.width!==e||this.canvas.height!==i)&&(this.canvas.width=e,this.canvas.height=i),!(e===this.width&&i===this.height&&this.sceneFBO!==null)&&(this.width=e,this.height=i,this.rebuildFramebuffers())}setQuality(t){this.disposed||this.quality===t||(this.quality=t,this.rebuildFramebuffers())}render(t,s,e,i,o){if(this.disposed)return;const a=this.gl;if((this.canvas.width!==this.width||this.canvas.height!==this.height)&&this.canvas.width>0&&this.canvas.height>0&&(this.width=this.canvas.width,this.height=this.canvas.height,this.rebuildFramebuffers()),!this.fluidFBO||!this.blurTempFBO||!this.fluidSmoothFBO||!this.sceneFBO)return;this.syncTerrainTextures(e);const r=this.packLanternUniforms(o),c=this.quality==="ultra"?1:0,l=this.fluidFBO.width,d=this.fluidFBO.height;if(s.numParticles>0){a.bindFramebuffer(a.FRAMEBUFFER,this.fluidFBO.framebuffer),a.viewport(0,0,l,d),a.clearColor(0,0,0,0),a.clear(a.COLOR_BUFFER_BIT),a.enable(a.BLEND),a.blendEquation(a.FUNC_ADD),a.blendFunc(a.ONE,a.ONE);const n=Math.min(s.numParticles,Math.floor(s.particleVBOData.length/5));if(n>0){a.bindBuffer(a.ARRAY_BUFFER,this.fluidVBO),n*5>this.fluidVBOCapacityFloats&&(this.fluidVBOCapacityFloats=n*5,a.bufferData(a.ARRAY_BUFFER,this.fluidVBOCapacityFloats*4,a.DYNAMIC_DRAW)),a.bufferSubData(a.ARRAY_BUFFER,0,s.particleVBOData.subarray(0,n*5));const m=this.fluidSplatProg.uniforms;a.useProgram(this.fluidSplatProg.program),a.uniform2f(m.uWorldSize,K,Q),a.uniform2f(m.uViewportSize,l,d),a.uniform1f(m.uPointWorldDiameter,ut*7.2),a.uniform1f(m.uIsFloat,this.useFloatFluid?1:0),a.uniform1f(m.uSplatScale,this.useFloatFluid?.28:.16),a.bindVertexArray(this.fluidVAO),a.drawArrays(a.POINTS,0,n)}a.disable(a.BLEND),a.useProgram(this.blurProg.program),a.bindVertexArray(this.quadVAO);const p=this.blurProg.uniforms;a.uniform1i(p.uTex,0);const f=.023;a.activeTexture(a.TEXTURE0),a.bindFramebuffer(a.FRAMEBUFFER,this.blurTempFBO.framebuffer),a.viewport(0,0,this.blurTempFBO.width,this.blurTempFBO.height),a.bindTexture(a.TEXTURE_2D,this.fluidFBO.texture),a.uniform2f(p.uBlurStep,f/K,0),a.drawArrays(a.TRIANGLE_STRIP,0,4),a.bindFramebuffer(a.FRAMEBUFFER,this.fluidSmoothFBO.framebuffer),a.viewport(0,0,this.fluidSmoothFBO.width,this.fluidSmoothFBO.height),a.bindTexture(a.TEXTURE_2D,this.blurTempFBO.texture),a.uniform2f(p.uBlurStep,0,f/Q),a.drawArrays(a.TRIANGLE_STRIP,0,4)}else a.disable(a.BLEND),a.bindFramebuffer(a.FRAMEBUFFER,this.fluidSmoothFBO.framebuffer),a.viewport(0,0,this.fluidSmoothFBO.width,this.fluidSmoothFBO.height),a.clearColor(0,0,0,0),a.clear(a.COLOR_BUFFER_BIT);a.bindFramebuffer(a.FRAMEBUFFER,this.sceneFBO.framebuffer),a.viewport(0,0,this.sceneFBO.width,this.sceneFBO.height),a.disable(a.BLEND),a.useProgram(this.worldTerrainProg.program);const u=this.worldTerrainProg.uniforms;if(a.activeTexture(a.TEXTURE0),a.bindTexture(a.TEXTURE_2D,this.terrainSdfTex),a.uniform1i(u.uTerrainSdfTex,0),a.activeTexture(a.TEXTURE1),a.bindTexture(a.TEXTURE_2D,this.terrainKindTex),a.uniform1i(u.uTerrainKindTex,1),a.uniform2f(u.uWorldSize,K,Q),a.uniform1f(u.uTime,t),a.uniform1f(u.uQuality,c),a.uniform3fv(u.uSkyTop,o.skyTop),a.uniform3fv(u.uSkyBottom,o.skyBottom),a.uniform3fv(u.uRockTint,o.rockTint),a.uniform2fv(u.uLightDir,o.lightDir),a.uniform3fv(u.uSunColor,o.sunColor),a.uniform1i(u.uNumLanterns,r),a.uniform2fv(u.uLanternPos,this.lanternPos),a.uniform3fv(u.uLanternColor,this.lanternColor),a.uniform1fv(u.uLanternRadius,this.lanternRadius),a.bindVertexArray(this.quadVAO),a.drawArrays(a.TRIANGLE_STRIP,0,4),this.buildMechanismBatch(i,o),this.mechVertexCount>0){a.enable(a.BLEND),a.blendEquation(a.FUNC_ADD),a.blendFuncSeparate(a.ONE,a.ONE_MINUS_SRC_ALPHA,a.ZERO,a.ONE),a.bindBuffer(a.ARRAY_BUFFER,this.mechVBO);const n=this.mechVertexCount*Ot;n>this.mechVBOCapacityFloats&&(this.mechVBOCapacityFloats=n,a.bufferData(a.ARRAY_BUFFER,this.mechVBOCapacityFloats*4,a.DYNAMIC_DRAW)),a.bufferSubData(a.ARRAY_BUFFER,0,this.mechData.subarray(0,n)),a.useProgram(this.mechProg.program);const p=this.mechProg.uniforms;a.uniform2f(p.uWorldSize,K,Q),a.uniform1f(p.uTime,t),a.uniform2fv(p.uLightDir,o.lightDir),a.uniform3fv(p.uSunColor,o.sunColor),a.bindVertexArray(this.mechVAO),a.drawArrays(a.TRIANGLES,0,this.mechVertexCount)}a.bindFramebuffer(a.FRAMEBUFFER,null),a.viewport(0,0,this.width,this.height),a.disable(a.BLEND),a.useProgram(this.waterCompositeProg.program);const h=this.waterCompositeProg.uniforms;a.activeTexture(a.TEXTURE0),a.bindTexture(a.TEXTURE_2D,this.fluidSmoothFBO.texture),a.uniform1i(h.uFluidTex,0),a.activeTexture(a.TEXTURE1),a.bindTexture(a.TEXTURE_2D,this.sceneFBO.texture),a.uniform1i(h.uSceneTex,1),a.activeTexture(a.TEXTURE2),a.bindTexture(a.TEXTURE_2D,this.terrainSdfTex),a.uniform1i(h.uTerrainSdfTex,2),a.uniform2f(h.uWorldSize,K,Q),a.uniform1f(h.uTime,t),a.uniform1f(h.uIsFloat,this.useFloatFluid?1:0),a.uniform1f(h.uQuality,c),a.uniform3fv(h.uWaterDeep,o.waterDeep),a.uniform3fv(h.uWaterShallow,o.waterShallow),a.uniform3fv(h.uSkyTop,o.skyTop),a.uniform3fv(h.uSkyBottom,o.skyBottom),a.uniform2fv(h.uLightDir,o.lightDir),a.uniform3fv(h.uSunColor,o.sunColor),a.uniform1i(h.uNumLanterns,r),a.uniform2fv(h.uLanternPos,this.lanternPos),a.uniform3fv(h.uLanternColor,this.lanternColor),a.uniform1fv(h.uLanternRadius,this.lanternRadius),a.bindVertexArray(this.quadVAO),a.drawArrays(a.TRIANGLE_STRIP,0,4),a.enable(a.BLEND),a.blendEquation(a.FUNC_ADD),a.blendFunc(a.ONE,a.ONE_MINUS_SRC_ALPHA),this.renderSteam(t,s,o),this.renderSpray(s,o),this.renderDebris(i,o),a.bindVertexArray(null),a.activeTexture(a.TEXTURE0)}dispose(){if(this.disposed)return;this.disposed=!0;const t=this.gl;this.deleteFBO(this.fluidFBO),this.deleteFBO(this.blurTempFBO),this.deleteFBO(this.fluidSmoothFBO),this.deleteFBO(this.sceneFBO),this.fluidFBO=null,this.blurTempFBO=null,this.fluidSmoothFBO=null,this.sceneFBO=null,t.deleteTexture(this.terrainSdfTex),t.deleteTexture(this.terrainKindTex),t.deleteBuffer(this.quadVBO),t.deleteBuffer(this.fluidVBO),t.deleteBuffer(this.mechVBO),t.deleteBuffer(this.instQuadVBO),t.deleteBuffer(this.sprayInstVBO),t.deleteBuffer(this.steamInstVBO),t.deleteBuffer(this.debrisInstVBO),t.deleteVertexArray(this.quadVAO),t.deleteVertexArray(this.fluidVAO),t.deleteVertexArray(this.mechVAO),t.deleteVertexArray(this.sprayVAO),t.deleteVertexArray(this.steamVAO),t.deleteVertexArray(this.debrisVAO),t.deleteProgram(this.fluidSplatProg.program),t.deleteProgram(this.blurProg.program),t.deleteProgram(this.worldTerrainProg.program),t.deleteProgram(this.mechProg.program),t.deleteProgram(this.waterCompositeProg.program),t.deleteProgram(this.sprayProg.program),t.deleteProgram(this.steamProg.program),t.deleteProgram(this.debrisProg.program)}probeFloatFBO(t){if(!t)return!1;const s=this.gl;for(;s.getError()!==s.NO_ERROR;);const e=this.createFBO(4,4,!0),i=e!==null&&s.getError()===s.NO_ERROR;return e&&this.deleteFBO(e),i}rebuildFramebuffers(){this.deleteFBO(this.fluidFBO),this.deleteFBO(this.blurTempFBO),this.deleteFBO(this.fluidSmoothFBO),this.deleteFBO(this.sceneFBO);const t=this.quality==="ultra"?.625:.5,s=Math.max(64,Math.round(this.width*t)),e=Math.max(36,Math.round(this.height*t));let i=this.createFBO(s,e,this.useFloatFluid),o=this.createFBO(s,e,this.useFloatFluid),a=this.createFBO(s,e,this.useFloatFluid);if((!i||!o||!a)&&this.useFloatFluid&&(this.deleteFBO(i),this.deleteFBO(o),this.deleteFBO(a),this.useFloatFluid=!1,i=this.createFBO(s,e,!1),o=this.createFBO(s,e,!1),a=this.createFBO(s,e,!1)),!i||!o||!a)throw new Error("Failed to create complete WebGL2 fluid framebuffers.");const r=this.createFBO(this.width,this.height,!1);if(!r)throw new Error("Failed to create complete WebGL2 scene framebuffer.");this.fluidFBO=i,this.blurTempFBO=o,this.fluidSmoothFBO=a,this.sceneFBO=r}createFBO(t,s,e){const i=this.gl,o=i.createTexture(),a=i.createFramebuffer();if(!o||!a)return o&&i.deleteTexture(o),a&&i.deleteFramebuffer(a),null;i.bindTexture(i.TEXTURE_2D,o),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MIN_FILTER,i.LINEAR),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MAG_FILTER,i.LINEAR),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_S,i.CLAMP_TO_EDGE),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_T,i.CLAMP_TO_EDGE);const r=e?i.RGBA16F:i.RGBA8,c=e?i.HALF_FLOAT:i.UNSIGNED_BYTE;i.texImage2D(i.TEXTURE_2D,0,r,t,s,0,i.RGBA,c,null),i.bindFramebuffer(i.FRAMEBUFFER,a),i.framebufferTexture2D(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,o,0);const l=i.checkFramebufferStatus(i.FRAMEBUFFER);return i.bindFramebuffer(i.FRAMEBUFFER,null),i.bindTexture(i.TEXTURE_2D,null),l!==i.FRAMEBUFFER_COMPLETE?(i.deleteFramebuffer(a),i.deleteTexture(o),null):{framebuffer:a,texture:o,width:t,height:s,isFloat:e}}deleteFBO(t){t&&(this.gl.deleteFramebuffer(t.framebuffer),this.gl.deleteTexture(t.texture))}createTerrainTexture(t,s,e){const i=this.gl,o=i.createTexture();if(!o)throw new Error("Failed to create terrain texture.");return i.bindTexture(i.TEXTURE_2D,o),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MIN_FILTER,e),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MAG_FILTER,e),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_S,i.CLAMP_TO_EDGE),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_T,i.CLAMP_TO_EDGE),i.pixelStorei(i.UNPACK_ALIGNMENT,1),i.texImage2D(i.TEXTURE_2D,0,t,F,q,0,s,i.UNSIGNED_BYTE,null),i.bindTexture(i.TEXTURE_2D,null),o}syncTerrainTextures(t){if(t.dirty&&t.rebuildSDFIfDirty(),this.terrainUploaded&&t.version===this.lastTerrainVersion)return;const s=F*q,e=t.sdf,i=t.sdfNormX,o=t.sdfNormY,a=t.solidKind,r=this.terrainSdfBytes,c=this.terrainKindBytes;for(let d=0;d<s;d++){const u=a[d],h=d*4,n=Math.max(0,Math.min(1,e[d]*.5+.5)),p=Math.max(0,Math.min(1,i[d]*.5+.5)),f=Math.max(0,Math.min(1,o[d]*.5+.5)),m=Math.max(0,Math.min(1,u/5));r[h]=Math.round(n*255),r[h+1]=Math.round(p*255),r[h+2]=Math.round(f*255),r[h+3]=Math.round(m*255),c[d]=u}const l=this.gl;l.pixelStorei(l.UNPACK_ALIGNMENT,1),l.bindTexture(l.TEXTURE_2D,this.terrainSdfTex),l.texSubImage2D(l.TEXTURE_2D,0,0,0,F,q,l.RGBA,l.UNSIGNED_BYTE,r),l.bindTexture(l.TEXTURE_2D,this.terrainKindTex),l.texSubImage2D(l.TEXTURE_2D,0,0,0,F,q,l.RED,l.UNSIGNED_BYTE,c),l.bindTexture(l.TEXTURE_2D,null),this.lastTerrainVersion=t.version,this.terrainUploaded=!0}packLanternUniforms(t){const s=Math.min(t.ambientLanterns.length,$t);for(let e=0;e<s;e++){const i=t.ambientLanterns[e];this.lanternPos[e*2]=i.x,this.lanternPos[e*2+1]=i.y,this.lanternColor[e*3]=i.color[0],this.lanternColor[e*3+1]=i.color[1],this.lanternColor[e*3+2]=i.color[2],this.lanternRadius[e]=i.radius}return s}buildMechanismBatch(t,s){this.mechVertexCount=0;const e=t.portals??[],i=t.mines??[],o=t.seesaws??[],a=t.valves??[],r=t.relays??[],c=t.pumps??[];for(let h=0;h<t.drains.length;h++){const n=t.drains[h],p=n.w/Math.max(n.h,.01);this.pushAxisRect(n.x,n.y,n.w,n.h,1,1,1,1,1,p,0,0)}this.gateMap.clear();for(let h=0;h<t.gates.length;h++){const n=t.gates[h];this.gateMap.set(n.id,{cx:n.baseX+n.w*.5,cy:n.baseY+n.h*.5,open:n.isOpen?1:0})}this.pumpMap.clear();for(let h=0;h<c.length;h++){const n=c[h];this.pumpMap.set(n.id,{cx:n.x,cy:n.y,active:n.active?1:0})}this.triggerMap.clear();for(let h=0;h<t.turbines.length;h++){const n=t.turbines[h],p=Math.max(0,Math.min(1,n.charge/Math.max(n.targetCharge,.001))),f=n.completed?1:0;if(this.triggerMap.set(n.id,{cx:n.x,cy:n.y,ratio:p,active:f}),!n.linkedGateId)continue;const m=this.gateMap.get(n.linkedGateId);m&&this.pushConduitPath(n.x,n.y,m.cx,m.cy,p,n.completed||m.open>.5?1:0)}for(let h=0;h<t.cisterns.length;h++){const n=t.cisterns[h],p=n.x+n.w*.5,f=n.y+n.h*.5;if(this.triggerMap.set(n.id,{cx:p,cy:f,ratio:n.fillRatio,active:n.activated?1:0}),!n.linkedGateId)continue;const m=this.gateMap.get(n.linkedGateId);m&&this.pushConduitPath(p,f,m.cx,m.cy,n.fillRatio,n.activated||m.open>.5?1:0)}for(let h=0;h<r.length;h++){const n=r[h],p=(n.ax+n.bx)*.5,f=(n.ay+n.by)*.5,m=n.active?1:0;if(this.triggerMap.set(n.id,{cx:p,cy:f,ratio:n.charge,active:m}),n.linkedGateId){const g=this.gateMap.get(n.linkedGateId);if(g){const x=Math.hypot(g.cx-n.ax,g.cy-n.ay),y=Math.hypot(g.cx-n.bx,g.cy-n.by),T=x<=y?n.ax:n.bx,b=x<=y?n.ay:n.by;this.pushConduitPath(T,b,g.cx,g.cy,n.charge,n.active||g.open>.5?1:0)}}if(n.linkedPumpId){const g=this.pumpMap.get(n.linkedPumpId);if(g){const x=Math.hypot(g.cx-n.ax,g.cy-n.ay),y=Math.hypot(g.cx-n.bx,g.cy-n.by),T=x<=y?n.ax:n.bx,b=x<=y?n.ay:n.by;this.pushConduitPath(T,b,g.cx,g.cy,n.charge,n.active||g.active>.5?1:0)}}}for(let h=0;h<c.length;h++){const n=c[h];for(let p=0;p<n.requiredTriggerIds.length;p++){const f=n.requiredTriggerIds[p];let m=!1;for(let x=0;x<r.length;x++)if(r[x].id===f&&r[x].linkedPumpId===n.id){m=!0;break}if(m)continue;const g=this.triggerMap.get(f);g&&this.pushConduitPath(g.cx,g.cy,n.x,n.y,g.ratio,g.active||(n.active?1:0))}}for(let h=0;h<r.length;h++){const n=r[h],p=Math.hypot(n.bx-n.ax,n.by-n.ay);if(p>1e-4){const f=Math.max(.14,n.radius*.68);this.pushSegmentRibbon(n.ax,n.ay,n.bx,n.by,f,1,1,1,1,22,n.charge,n.active?1:0,p)}}for(let h=0;h<t.gates.length;h++){const n=t.gates[h],p=n.baseX+n.w*.5,f=n.baseY+n.h*.5,m=p+n.openOffsetX,g=f+n.openOffsetY;this.pushSegmentRibbon(p,f,m,g,.075,1,1,1,1,8,n.openProgress,0,0)}for(let h=0;h<t.cisterns.length;h++){const n=t.cisterns[h],p=n.w/Math.max(n.h,.01);this.pushAxisRect(n.x,n.y,n.w,n.h,1,1,1,1,3,n.fillRatio,n.activated?1:0,p)}for(let h=0;h<t.goals.length;h++){const n=t.goals[h],p=n.w/Math.max(n.h,.01);this.pushAxisRect(n.x,n.y,n.w,n.h,1,1,1,1,4,n.fulfilled?1:0,n.pulse,p)}for(let h=0;h<t.magmaVents.length;h++){const n=t.magmaVents[h],p=Math.max(0,Math.min(1,n.heat/Math.max(n.maxHeat,.001))),f=n.w/Math.max(n.h,.01);this.pushAxisRect(n.x,n.y,n.w,n.h,n.goalQuench?1:0,0,0,f,5,p,n.quenched?1:0,n.steamPulse)}const l=s.rockTint[0]*.88,d=s.rockTint[1]*.88,u=s.rockTint[2]*.88;for(let h=0;h<t.crackedWalls.length;h++){const n=t.crackedWalls[h];if(n.broken)continue;const p=1-Math.max(0,Math.min(1,n.hp/Math.max(n.maxHp,.001))),f=n.w/Math.max(n.h,.01);this.pushAxisRect(n.x,n.y,n.w,n.h,l,d,u,1,6,p,n.stressGlow,f)}for(let h=0;h<t.gates.length;h++){const n=t.gates[h],p=n.w/Math.max(n.h,.01);this.pushAxisRect(n.x,n.y,n.w,n.h,1,1,1,1,7,n.openProgress,n.isOpen?1:0,p)}for(let h=0;h<e.length;h++){const n=e[h],p=Math.max(.4,n.radius*2.85);this.pushRotatedRect(n.inX,n.inY,p,p,0,1,1,1,1,14,n.pulse,0,0);const f=Math.hypot(n.outDirX,n.outDirY)||1,m=n.outDirX/f,g=n.outDirY/f,x=Math.atan2(g,m),y=Math.max(.8,n.radius*3.1),T=Math.max(.45,n.radius*2.1),b=n.outX+m*(y*.5),M=n.outY+g*(y*.5);this.pushRotatedRect(b,M,y,T,x,1,1,1,1,16,n.pulse,n.boost,0),this.pushRotatedRect(n.outX,n.outY,p,p,0,1,1,1,1,15,n.pulse,0,0)}for(let h=0;h<c.length;h++){const n=c[h],p=Math.hypot(n.dirX,n.dirY)||1,f=n.dirX/p,m=n.dirY/p,g=Math.atan2(m,f),x=n.active?1:0;if(n.power>.01){const b=Math.max(.3,n.range),M=Math.max(.36,n.radius*2.7),w=n.x+f*(b*.5),k=n.y+m*(b*.5);this.pushRotatedRect(w,k,b,M,g,1,1,1,1,24,n.power,x,b)}const y=Math.max(.46,n.radius*2.4),T=Math.max(.38,n.radius*2.1);this.pushRotatedRect(n.x,n.y,y,T,g,1,1,1,1,25,n.power,x,0)}for(let h=0;h<r.length;h++){const n=r[h],p=Math.max(.42,n.radius*2.25),f=n.active?1:0,m=n.isObjective?1:0;this.pushRotatedRect(n.ax,n.ay,p,p,0,1,1,1,1,23,n.charge,f,m),this.pushRotatedRect(n.bx,n.by,p,p,0,1,1,1,1,23,n.charge,f,m)}for(let h=0;h<o.length;h++){const n=o[h],p=n.length/Math.max(n.thickness,.02);this.pushRotatedRect(n.x,n.y,n.length,n.thickness,n.angle,l,d,u,1,18,0,0,p);const f=Math.max(n.thickness*1.9,.3);this.pushRotatedRect(n.x,n.y,f,f,n.angle*.5,1,1,1,1,19,0,0,0)}for(let h=0;h<a.length;h++){const n=a[h],p=n.length/Math.max(n.thickness,.02),f=n.toggled?1:0;this.pushRotatedRect(n.x,n.y,n.length,n.thickness,n.angle,1,1,1,1,20,f,0,p);const m=Math.max(n.thickness*2.5,.42);this.pushRotatedRect(n.x,n.y,m,m,0,1,1,1,1,21,f,0,0)}for(let h=0;h<t.turbines.length;h++){const n=t.turbines[h],p=Math.max(0,Math.min(1,n.charge/Math.max(n.targetCharge,.001))),f=n.completed?1:0,m=n.radius*2.48;this.pushRotatedRect(n.x,n.y,m,m,0,1,1,1,1,13,p,f,0);const g=n.radius*2.08;this.pushRotatedRect(n.x,n.y,g,g,n.angle,1,1,1,1,9,p,f,0)}for(let h=0;h<i.length;h++){const n=i[h];if(n.detonated)continue;const p=Math.max(.24,n.radius*2.56);this.pushRotatedRect(n.x,n.y,p,p,n.angle,1,1,1,1,17,n.flash,n.submergedRatio,0)}for(let h=0;h<t.bodies.length;h++){const n=t.bodies[h],p=n.inGoal?1:0;if(n.kind==="ark"){const f=n.w/Math.max(n.h,.01);this.pushRotatedRect(n.x,n.y,n.w*1.08,n.h*1.18,n.angle,1,1,1,1,10,p,n.submergedRatio,f)}else{const f=Math.max(n.w,n.h)*1.16;this.pushRotatedRect(n.x,n.y,f,f,n.angle,1,1,1,1,11,p,n.submergedRatio,0)}}for(let h=0;h<t.spouts.length;h++){const n=t.spouts[h],p=Math.hypot(n.dirX,n.dirY)||1,f=n.dirX/p,m=n.dirY/p,g=Math.atan2(m,f),x=Math.max(.38,n.radius*3),y=Math.max(.26,n.radius*2.3),T=n.x-f*(x*.36),b=n.y-m*(x*.36);this.pushRotatedRect(T,b,x,y,g,1,1,1,1,12,n.enabled?1:0,0,0)}}pushConduitPath(t,s,e,i,o,a){const r=e-t,c=i-s,l=.055;if(Math.abs(r)>.35&&Math.abs(c)>.35){const d=r>=0?l*.5:-l*.5;this.pushSegmentRibbon(t,s,e+d,s,l,1,1,1,1,2,o,a,Math.abs(r)),this.pushSegmentRibbon(e,s,e,i,l,1,1,1,1,2,o,a,Math.abs(c))}else{const d=Math.hypot(r,c);this.pushSegmentRibbon(t,s,e,i,l,1,1,1,1,2,o,a,d)}}pushSegmentRibbon(t,s,e,i,o,a,r,c,l,d,u,h,n){const p=e-t,f=i-s,m=Math.hypot(p,f);if(m<1e-4)return;const g=-f/m*o,x=p/m*o;this.pushQuad(t-g,s-x,0,0,e-g,i-x,1,0,e+g,i+x,1,1,t+g,s+x,0,1,a,r,c,l,d,u,h,n)}pushAxisRect(t,s,e,i,o,a,r,c,l,d,u,h){this.pushQuad(t,s,0,0,t+e,s,1,0,t+e,s+i,1,1,t,s+i,0,1,o,a,r,c,l,d,u,h)}pushRotatedRect(t,s,e,i,o,a,r,c,l,d,u,h,n){const p=e*.5,f=i*.5,m=Math.cos(o),g=Math.sin(o),x=t+(-p*m- -f*g),y=s+(-p*g+-f*m),T=t+(p*m- -f*g),b=s+(p*g+-f*m),M=t+(p*m-f*g),w=s+(p*g+f*m),k=t+(-p*m-f*g),C=s+(-p*g+f*m);this.pushQuad(x,y,0,0,T,b,1,0,M,w,1,1,k,C,0,1,a,r,c,l,d,u,h,n)}pushQuad(t,s,e,i,o,a,r,c,l,d,u,h,n,p,f,m,g,x,y,T,b,M,w,k){const C=(this.mechVertexCount+6)*Ot;if(C>this.mechData.length){const E=new Float32Array(Math.max(this.mechData.length*2,C));E.set(this.mechData),this.mechData=E}let A=this.mechVertexCount*Ot;const B=this.mechData;A=this.writeMechVert(B,A,t,s,e,i,g,x,y,T,b,M,w,k),A=this.writeMechVert(B,A,o,a,r,c,g,x,y,T,b,M,w,k),A=this.writeMechVert(B,A,l,d,u,h,g,x,y,T,b,M,w,k),A=this.writeMechVert(B,A,t,s,e,i,g,x,y,T,b,M,w,k),A=this.writeMechVert(B,A,l,d,u,h,g,x,y,T,b,M,w,k),this.writeMechVert(B,A,n,p,f,m,g,x,y,T,b,M,w,k),this.mechVertexCount+=6}writeMechVert(t,s,e,i,o,a,r,c,l,d,u,h,n,p){return t[s]=e,t[s+1]=i,t[s+2]=o,t[s+3]=a,t[s+4]=r,t[s+5]=c,t[s+6]=l,t[s+7]=d,t[s+8]=u,t[s+9]=h,t[s+10]=n,t[s+11]=p,s+12}renderSteam(t,s,e){const i=Math.min(s.numSteam,s.stx.length);if(i<=0)return;const o=this.gl;i>this.steamCapacity&&(this.steamCapacity=i,this.steamData=new Float32Array(i*Wt),o.bindBuffer(o.ARRAY_BUFFER,this.steamInstVBO),o.bufferData(o.ARRAY_BUFFER,this.steamData.byteLength,o.DYNAMIC_DRAW));const a=this.steamData;for(let c=0;c<i;c++){const l=c*Wt;a[l]=s.stx[c],a[l+1]=s.sty[c],a[l+2]=s.stvx[c],a[l+3]=s.stvy[c],a[l+4]=s.stlife[c],a[l+5]=s.stmaxLife[c]}o.bindBuffer(o.ARRAY_BUFFER,this.steamInstVBO),o.bufferSubData(o.ARRAY_BUFFER,0,a.subarray(0,i*Wt)),o.useProgram(this.steamProg.program);const r=this.steamProg.uniforms;o.uniform2f(r.uWorldSize,K,Q),o.uniform1f(r.uTime,t),o.uniform3fv(r.uSunColor,e.sunColor),o.bindVertexArray(this.steamVAO),o.drawArraysInstanced(o.TRIANGLE_STRIP,0,4,i)}renderSpray(t,s){const e=Math.min(t.numSpray,t.spx.length);if(e<=0)return;const i=this.gl;e>this.sprayCapacity&&(this.sprayCapacity=e,this.sprayData=new Float32Array(e*qt),i.bindBuffer(i.ARRAY_BUFFER,this.sprayInstVBO),i.bufferData(i.ARRAY_BUFFER,this.sprayData.byteLength,i.DYNAMIC_DRAW));const o=this.sprayData;for(let r=0;r<e;r++){const c=r*qt;o[c]=t.spx[r],o[c+1]=t.spy[r],o[c+2]=t.svx[r],o[c+3]=t.svy[r],o[c+4]=t.slife[r],o[c+5]=t.smaxLife[r]}i.bindBuffer(i.ARRAY_BUFFER,this.sprayInstVBO),i.bufferSubData(i.ARRAY_BUFFER,0,o.subarray(0,e*qt)),i.useProgram(this.sprayProg.program);const a=this.sprayProg.uniforms;i.uniform2f(a.uWorldSize,K,Q),i.uniform3fv(a.uWaterShallow,s.waterShallow),i.uniform3fv(a.uSunColor,s.sunColor),i.bindVertexArray(this.sprayVAO),i.drawArraysInstanced(i.TRIANGLE_STRIP,0,4,e)}renderDebris(t,s){const e=t.debris,i=e.length;if(i<=0)return;const o=this.gl;i>this.debrisCapacity&&(this.debrisCapacity=i,this.debrisData=new Float32Array(i*Gt),o.bindBuffer(o.ARRAY_BUFFER,this.debrisInstVBO),o.bufferData(o.ARRAY_BUFFER,this.debrisData.byteLength,o.DYNAMIC_DRAW));const a=this.debrisData;for(let c=0;c<i;c++){const l=e[c],d=c*Gt;a[d]=l.x,a[d+1]=l.y,a[d+2]=l.angle,a[d+3]=l.size,a[d+4]=l.life,a[d+5]=l.maxLife,a[d+6]=l.kind==="rock"?0:l.kind==="ice"?1:2}o.bindBuffer(o.ARRAY_BUFFER,this.debrisInstVBO),o.bufferSubData(o.ARRAY_BUFFER,0,a.subarray(0,i*Gt)),o.useProgram(this.debrisProg.program);const r=this.debrisProg.uniforms;o.uniform2f(r.uWorldSize,K,Q),o.uniform3fv(r.uRockTint,s.rockTint),o.uniform3fv(r.uSunColor,s.sunColor),o.bindVertexArray(this.debrisVAO),o.drawArraysInstanced(o.TRIANGLE_STRIP,0,4,i)}createProgram(t,s,e){const i=this.gl,o=this.compileShader(i.VERTEX_SHADER,t),a=this.compileShader(i.FRAGMENT_SHADER,s),r=i.createProgram();if(!r)throw i.deleteShader(o),i.deleteShader(a),new Error("Failed to create WebGL2 shader program.");if(i.attachShader(r,o),i.attachShader(r,a),i.linkProgram(r),i.deleteShader(o),i.deleteShader(a),!i.getProgramParameter(r,i.LINK_STATUS)){const l=i.getProgramInfoLog(r)||"Unknown program link error";throw i.deleteProgram(r),new Error(`WebGL2 program link failed: ${l}`)}const c={};for(const l of e)c[l]=i.getUniformLocation(r,l);return{program:r,uniforms:c}}compileShader(t,s){const e=this.gl,i=e.createShader(t);if(!i)throw new Error("Failed to create WebGL2 shader.");if(e.shaderSource(i,s),e.compileShader(i),!e.getShaderParameter(i,e.COMPILE_STATUS)){const o=e.getShaderInfoLog(i)||"Unknown shader compile error";throw e.deleteShader(i),new Error(`WebGL2 shader compile failed: ${o}`)}return i}bindAttrib(t,s,e,i,o){const a=this.gl,r=a.getAttribLocation(t,s);r<0||(a.enableVertexAttribArray(r),a.vertexAttribPointer(r,e,a.FLOAT,!1,i,o))}setupInstancedVAO(t,s,e,i){const o=this.gl,a=this.requireVAO();o.bindVertexArray(a),o.bindBuffer(o.ARRAY_BUFFER,this.instQuadVBO);const r=o.getAttribLocation(t,"aCorner");r>=0&&(o.enableVertexAttribArray(r),o.vertexAttribPointer(r,2,o.FLOAT,!1,0,0),o.vertexAttribDivisor(r,0)),o.bindBuffer(o.ARRAY_BUFFER,s);for(const c of i){const l=o.getAttribLocation(t,c.name);l>=0&&(o.enableVertexAttribArray(l),o.vertexAttribPointer(l,c.size,o.FLOAT,!1,e,c.offset),o.vertexAttribDivisor(l,1))}return a}requireBuffer(){const t=this.gl.createBuffer();if(!t)throw new Error("Failed to create WebGL2 buffer.");return t}requireVAO(){const t=this.gl.createVertexArray();if(!t)throw new Error("Failed to create WebGL2 VAO.");return t}}const ue=F*q,It=F+1,Qt=It*q,Zt=F*(q+1),Ft=$*1.05,Et=K-$*1.05,Dt=$*1.05,Vt=Q-$*1.05,yt=192,Rt=108,Jt=yt*Rt,ee=2*ut,Ut=1/ee;class ys{constructor(){v(this,"numParticles",0);v(this,"px",new Float32Array(ct));v(this,"py",new Float32Array(ct));v(this,"vx",new Float32Array(ct));v(this,"vy",new Float32Array(ct));v(this,"foam",new Float32Array(ct));v(this,"temp",new Float32Array(ct));v(this,"numSpray",0);v(this,"spx",new Float32Array(ft));v(this,"spy",new Float32Array(ft));v(this,"svx",new Float32Array(ft));v(this,"svy",new Float32Array(ft));v(this,"slife",new Float32Array(ft));v(this,"smaxLife",new Float32Array(ft));v(this,"numSteam",0);v(this,"stx",new Float32Array(Tt));v(this,"sty",new Float32Array(Tt));v(this,"stvx",new Float32Array(Tt));v(this,"stvy",new Float32Array(Tt));v(this,"stlife",new Float32Array(Tt));v(this,"stmaxLife",new Float32Array(Tt));v(this,"u",new Float32Array(Qt));v(this,"v",new Float32Array(Zt));v(this,"pressure",new Float32Array(ue));v(this,"cellType",new Uint8Array(ue));v(this,"particleVBOData",new Float32Array(ct*5));v(this,"telemetry",{particleCount:0,avgSpeed:0,kineticEnergy:0,splashIntensity:0,iceFreezeCount:0,iceShatterCount:0,wallBreakCount:0,magmaSteamIntensity:0,magmaQuenchCount:0,maxTurbineRpm:0,maxTurbineCharge:0,turbineCompletePulseCount:0,mineDetonateCount:0,valveToggleCount:0,portalPulseCount:0,relayActiveIntensity:0});v(this,"prevU",new Float32Array(Qt));v(this,"duW",new Float32Array(Qt));v(this,"validU",new Uint8Array(Qt));v(this,"prevV",new Float32Array(Zt));v(this,"dvW",new Float32Array(Zt));v(this,"validV",new Uint8Array(Zt));v(this,"particleDensity",new Float32Array(ue));v(this,"cellCount",new Int32Array(Jt));v(this,"cellStart",new Int32Array(Jt+1));v(this,"cellEntries",new Int32Array(ct));v(this,"sdfDist",0);v(this,"sdfNx",0);v(this,"sdfNy",1);v(this,"simTime",0);v(this,"pourAccumulator",0);v(this,"stepImpactEnergy",0)}reset(){this.numParticles=0,this.numSpray=0,this.numSteam=0,this.simTime=0,this.pourAccumulator=0,this.stepImpactEnergy=0,this.u.fill(0),this.prevU.fill(0),this.duW.fill(0),this.validU.fill(0),this.v.fill(0),this.prevV.fill(0),this.dvW.fill(0),this.validV.fill(0),this.cellType.fill(ot.AIR),this.particleDensity.fill(0),this.pressure.fill(0),this.particleVBOData.fill(0);const t=this.telemetry;t.particleCount=0,t.avgSpeed=0,t.kineticEnergy=0,t.splashIntensity=0,t.iceFreezeCount=0,t.iceShatterCount=0,t.wallBreakCount=0,t.magmaSteamIntensity=0,t.magmaQuenchCount=0,t.maxTurbineRpm=0,t.maxTurbineCharge=0,t.turbineCompletePulseCount=0,t.mineDetonateCount=0,t.valveToggleCount=0,t.portalPulseCount=0,t.relayActiveIntensity=0}spawnPool(t,s,e,i,o,a=1){const r=o<ct?o:ct;if(this.numParticles>=r||e<=0||i<=0||a<=0)return 0;const c=a<=1?a:1,l=a>1?1/Math.sqrt(a):1,d=ee*l,u=d*.8660254,h=i*c,n=t+d*.35,p=t+e-d*.35,f=s+u*.35,m=s+h-u*.35;let g=0,x=0;for(let y=f;y<=m&&this.numParticles<r;y+=u,x++){const T=(x&1)===1?d*.5:0;for(let b=n+T;b<=p&&this.numParticles<r;b+=d){const M=b+(Math.random()-.5)*.004,w=y+(Math.random()-.5)*.004,k=M<Ft?Ft:M>Et?Et:M,C=w<Dt?Dt:w>Vt?Vt:w,A=this.numParticles++;this.px[A]=k,this.py[A]=C,this.vx[A]=0,this.vy[A]=0,this.foam[A]=0,this.temp[A]=.2,g++}}return g>0&&(this.packVBO(),this.telemetry.particleCount=this.numParticles),g}spawnJet(t,s,e,i,o,a,r,c=ct){const l=c<ct?c:ct;if(this.numParticles>=l||a<=0)return 0;let d=e,u=i;const h=Math.sqrt(d*d+u*u);h>1e-6?(d/=h,u/=h):(d=1,u=0);const n=-u,p=d,f=o<0?0:o>16?16:o,m=this.numParticles;let g=0;for(let x=0;x<a&&this.numParticles<l;x++){const y=(Math.random()*2-1)*r,T=Math.random()*.045;let b=t+n*y+d*T,M=s+p*y+u*T;b<Ft?b=Ft:b>Et&&(b=Et),M<Dt?M=Dt:M>Vt&&(M=Vt);const w=(Math.random()-.5)*.45,k=f*(.94+Math.random()*.12),C=this.numParticles++;this.px[C]=b,this.py[C]=M,this.vx[C]=d*k+n*w,this.vy[C]=u*k+p*w,this.foam[C]=.25,this.temp[C]=.2,g++}if(g>0){const x=this.particleVBOData;for(let y=m;y<this.numParticles;y++){const T=y*5;x[T]=this.px[y],x[T+1]=this.py[y],x[T+2]=this.vx[y],x[T+3]=this.vy[y],x[T+4]=this.foam[y]}this.telemetry.particleCount=this.numParticles}return g}spawnSpray(t,s,e,i,o){if(this.numSpray>=ft)return;const a=this.numSpray++;this.spx[a]=t,this.spy[a]=s,this.svx[a]=e,this.svy[a]=i;const r=o>1e-4?o:1e-4;this.slife[a]=r,this.smaxLife[a]=r}spawnSteam(t,s,e,i,o){if(this.numSteam>=Tt)return;const a=this.numSteam++;this.stx[a]=t,this.sty[a]=s,this.stvx[a]=e,this.stvy[a]=i;const r=o>1e-4?o:1e-4;this.stlife[a]=r,this.stmaxLife[a]=r}removeParticle(t){if(t<0||t>=this.numParticles)return;const s=--this.numParticles;t!==s&&(this.px[t]=this.px[s],this.py[t]=this.py[s],this.vx[t]=this.vx[s],this.vy[t]=this.vy[s],this.foam[t]=this.foam[s],this.temp[t]=this.temp[s])}triggerTsunami(t){const s=t<ct?t:ct;for(let a=0;a<this.numParticles;a++)if(this.px[a]<5){const r=1-this.px[a]/5;this.vx[a]+=(6+5*r)*.7,this.vy[a]+=1.6*r,this.foam[a]=Math.min(1,this.foam[a]+.45*r)}const e=ee*1.05,i=e*.8660254;let o=0;for(let a=.35;a<=5.2&&this.numParticles<s;a+=i,o++){const r=(o&1)===1?e*.5:0,c=2.6-a*.14;for(let l=.35+r;l<=c&&this.numParticles<s;l+=e){const d=this.numParticles++;this.px[d]=l+(Math.random()-.5)*.008,this.py[d]=a+(Math.random()-.5)*.008,this.vx[d]=9+Math.random()*2.5+a*.35,this.vy[d]=.5+a*.25+(Math.random()-.5)*.6,this.foam[d]=a>3.2?.85:.45,this.temp[d]=.2}}for(let a=0;a<90;a++)this.spawnSpray(1.2+Math.random()*1.4,3.5+Math.random()*1.8,8.5+Math.random()*4.5,1.5+Math.random()*3,.4+Math.random()*.45);this.packVBO(),this.telemetry.particleCount=this.numParticles}queryPressureRect(t,s,e,i){if(e<=0||i<=0)return 0;const o=Math.max(0,Math.floor(t*G)),a=Math.min(F-1,Math.floor((t+e)*G)),r=Math.max(0,Math.floor(s*G)),c=Math.min(q-1,Math.floor((s+i)*G));let l=0,d=0,u=0;for(let h=r;h<=c;h++){const n=h*F;for(let p=o;p<=a;p++){const f=n+p,m=this.cellType[f];if(m===ot.FLUID){l++;const g=this.pressure[f];g>0&&(u+=g)}else m===ot.SOLID&&d++}}if(l>0)return u/l;if(d>0){const h=Math.max(0,o-1),n=Math.min(F-1,a+1),p=Math.max(0,r-1),f=Math.min(q-1,c+1);let m=0,g=0;for(let x=p;x<=f;x++){const y=x*F;for(let T=h;T<=n;T++){const b=y+T;if(this.cellType[b]===ot.FLUID){m++;const M=this.pressure[b];M>0&&(g+=M)}}}if(m>0)return g/m}return 0}countParticlesInRect(t,s,e,i){if(e<=0||i<=0)return 0;const o=t+e,a=s+i;let r=0;for(let c=0;c<this.numParticles;c++){const l=this.px[c],d=this.py[c];l>=t&&l<=o&&d>=s&&d<=a&&r++}return r}step(t,s,e,i,o,a){if(t<=0)return;const r=t<1/30?t:1/30;this.simTime+=r,this.stepImpactEnergy=0,i.preStep(s,r),s.rebuildSDFIfDirty(),this.applyToolInput(r,s,e,a);const c=Mt*r;for(let d=0;d<this.numParticles;d++)this.vy[d]+=c;this.advectAndCollide(r,s,i),i.coupleParticles(this,s,r),this.pushParticlesApart(2,s,i),this.particlesToGrid(s);const l=o==="ultra"?32:26;this.solvePressure(l),this.gridToParticles(),this.stepEffectsAndPost(r,s,i,a)}applyToolInput(t,s,e,i){if(!e)return;const o=e.tool;if(o==="surge"&&e.active){let c=e.vx,l=e.vy;const d=Math.sqrt(c*c+l*l);if(d>15.5){const p=15.5/d;c*=p,l*=p}const u=c<0?-c:c;let h=0;if(l>=-.3*u){const p=l>.4?l*.55<4.5?l*.55:4.5:0,m=(u>.6?u*1.9:0)+p;h=m<11.5?m:11.5}const n=(d*.09<1?d*.09:1)*t*6.5;for(let p=0;p<this.numParticles;p++){const f=this.px[p]-e.x,m=this.py[p]-e.y,g=f*f+m*m;if(g>=2.1025)continue;const x=1-g/2.1025,y=20.5*x*t;this.vx[p]+=c*y,this.vy[p]+=(l*20.5+h)*x*t;const T=this.foam[p]+x*n;this.foam[p]=T>1?1:T}d>5&&Math.random()<.35&&this.spawnSpray(e.x+(Math.random()-.5)*.5,e.y+(Math.random()-.5)*.35,c*.8+(Math.random()-.5)*1.8,l*.8+1.5+Math.random()*1.8,.25+Math.random()*.25)}else if(o==="vortex"){if(e.active){const a=e.chargePos?e.chargePos.x:e.x,r=e.chargePos?e.chargePos.y:e.y,c=2.85,l=c*c,d=e.chargeTime*.6+1<2.1?e.chargeTime*.6+1:2.1,u=e.secondary?-1:1;for(let h=0;h<this.numParticles;h++){const n=a-this.px[h],p=r-this.py[h],f=n*n+p*p;if(f>=l)continue;const m=Math.sqrt(f),g=1-m/c,x=m>1e-4?n/m:0,y=m>1e-4?p/m:0,T=-y*u,b=x*u,M=this.vx[h]*x+this.vy[h]*y,w=this.vx[h]*T+this.vy[h]*b;let k,C,A;m<.42?(k=m/.42*24-M*6.5,C=(6.5*d-w)*9.5,A=-Mt*(1.02+.18*g)):(k=(16+26*g)*d-M*(2.5+2.5*g),C=(8.5*d-w)*(4+3.5*g),A=-Mt*(.45+.55*g)),this.vx[h]+=(x*k+T*C)*t,this.vy[h]+=(y*k+b*C+A)*t;const B=this.foam[h]+(.45+.45*g)*t;this.foam[h]=B>1?1:B}}if(e.releaseBurst){const a=e.releaseBurst;let r=a.dirX,c=a.dirY;const l=Math.sqrt(r*r+c*c);l>1e-6?(r/=l,c/=l):(r=1,c=0);const d=2.15,u=d*d,h=a.strength<17.5?a.strength:17.5;for(let n=0;n<this.numParticles;n++){const p=this.px[n]-a.x,f=this.py[n]-a.y,m=p*p+f*f;if(m>=u)continue;const x=1-Math.sqrt(m)/d,y=.52+.48*x*(2-x),T=h*y;this.vx[n]=this.vx[n]*.15+r*T,this.vy[n]=this.vy[n]*.15+c*T,this.foam[n]=1,Math.random()<.22&&this.spawnSpray(this.px[n],this.py[n],r*T*(.92+Math.random()*.35)+(Math.random()-.5)*2.4,c*T*(.92+Math.random()*.35)+(Math.random()-.5)*2.4,.32+Math.random()*.38)}this.stepImpactEnergy+=h*.085}}else if(o==="pour"&&e.active){if(this.sampleTerrainSDF(s,e.x,e.y),this.sdfDist>-.02){this.pourAccumulator+=t*360;const a=Math.floor(this.pourAccumulator);if(a>0){this.pourAccumulator-=a;const r=a<10?a:10,c=Math.max(-.8,Math.min(.8,e.vx*.2)),l=-1+Math.max(-.4,Math.min(.4,e.vy*.12));this.spawnJet(e.x,e.y,c,l,4.5,r,.13,i)}}}else if(o==="drain"&&e.active)for(let r=this.numParticles-1;r>=0;r--){const c=this.px[r]-e.x,l=this.py[r]-e.y;c*c+l*l<=.5625&&this.removeParticle(r)}}advectAndCollide(t,s,e){const i=t*.5,o=e.drains,a=o.length;for(let r=0;r<2;r++)for(let c=0;c<this.numParticles;c++){let l=this.px[c]+this.vx[c]*i,d=this.py[c]+this.vy[c]*i;this.sampleTerrainSDF(s,l,d);const u=this.sdfDist;if(u<ut){const h=this.sdfNx,n=this.sdfNy,p=ut-u;l+=h*p,d+=n*p;const f=this.vx[c],m=this.vy[c],g=f*h+m*n;if(g<0){const x=f-g*h,y=m-g*n,T=Math.floor((l-h*$*.6)*G),b=Math.floor((d-n*$*.6)*G);let M=s.getKindAtCell(T,b);M===ht.NONE&&(M=s.getKindAtCell(Math.floor(l*G),Math.floor(d*G)));const w=M===ht.ICE?.985:.94,k=-g,C=k>3.2?.12:0;if(this.vx[c]=x*w-C*g*h,this.vy[c]=y*w-C*g*n,k>3.2){const A=(k-3)*.14,B=this.foam[c]+(A<.85?A:.85);this.foam[c]=B>1?1:B,this.stepImpactEnergy+=(k-3.2)*.015;const E=(k-3.2)*.075;Math.random()<(E<.45?E:.45)&&this.spawnSpray(l,d,x*.65+h*k*.42+(Math.random()-.5)*2.2,y*.65+n*k*.42+Math.random()*2,.25+Math.random()*.35)}}}if(l<Ft?(l=Ft,this.vx[c]<0&&(this.vx[c]=0)):l>Et&&(l=Et,this.vx[c]>0&&(this.vx[c]=0)),d<Dt){let h=!1;for(let n=0;n<a;n++){const p=o[n];if(p.y<=$&&l>=p.x&&l<=p.x+p.w){h=!0;break}}h?d<.01&&(d=.01):(d=Dt,this.vy[c]<0&&(this.vy[c]=0))}else d>Vt&&(d=Vt,this.vy[c]>0&&(this.vy[c]=0));this.px[c]=l,this.py[c]=d}}pushParticlesApart(t,s,e){const i=this.numParticles;if(i<=1)return;const o=ee,a=o*o,r=this.cellCount,c=this.cellStart,l=this.cellEntries,d=this.px,u=this.py;for(let p=0;p<t;p++){r.fill(0);for(let m=0;m<i;m++){let g=Math.floor(d[m]*Ut),x=Math.floor(u[m]*Ut);g<0?g=0:g>=yt&&(g=yt-1),x<0?x=0:x>=Rt&&(x=Rt-1),r[x*yt+g]++}let f=0;for(let m=0;m<Jt;m++)f+=r[m],c[m]=f;c[Jt]=f;for(let m=0;m<i;m++){let g=Math.floor(d[m]*Ut),x=Math.floor(u[m]*Ut);g<0?g=0:g>=yt&&(g=yt-1),x<0?x=0:x>=Rt&&(x=Rt-1),l[--c[x*yt+g]]=m}for(let m=0;m<i;m++){const g=d[m],x=u[m];let y=Math.floor(g*Ut),T=Math.floor(x*Ut);y<0?y=0:y>=yt&&(y=yt-1),T<0?T=0:T>=Rt&&(T=Rt-1);const b=y>0?y-1:0,M=y<yt-1?y+1:yt-1,w=T>0?T-1:0,k=T<Rt-1?T+1:Rt-1;for(let C=w;C<=k;C++){const A=C*yt;for(let B=b;B<=M;B++){const E=A+B,L=c[E],P=c[E+1];for(let D=L;D<P;D++){const R=l[D];if(R<=m)continue;let V=d[R]-g,W=u[R]-x;const N=V*V+W*W;if(!(N>=a)){if(N>1e-12){const _=Math.sqrt(N),Y=.5*(o-_)/_;V*=Y,W*=Y}else{const _=(m&7)*.785398;V=Math.cos(_)*(.25*o),W=Math.sin(_)*(.25*o)}d[m]-=V,u[m]-=W,d[R]+=V,u[R]+=W}}}}}}const h=e.drains,n=h.length;for(let p=0;p<i;p++){let f=d[p],m=u[p];if(this.sampleTerrainSDF(s,f,m),this.sdfDist<ut){const g=ut-this.sdfDist;f+=this.sdfNx*g,m+=this.sdfNy*g}if(f<Ft?f=Ft:f>Et&&(f=Et),m<Dt){let g=!1;for(let x=0;x<n;x++){const y=h[x];if(y.y<=$&&f>=y.x&&f<=y.x+y.w){g=!0;break}}g?m<.01&&(m=.01):m=Dt}else m>Vt&&(m=Vt);d[p]=f,u[p]=m}}particlesToGrid(t){const s=this.cellType,e=this.u,i=this.v,o=this.duW,a=this.dvW,r=this.particleDensity;for(let g=0;g<q;g++){const x=g*F;for(let y=0;y<F;y++)s[x+y]=t.isSolidCell(y,g)?ot.SOLID:ot.AIR}e.fill(0),i.fill(0),o.fill(0),a.fill(0),r.fill(0);const c=this.numParticles,l=this.px,d=this.py,u=this.vx,h=this.vy;for(let g=0;g<c;g++){const x=l[g],y=d[g];let T=Math.floor(x*G),b=Math.floor(y*G);T<0?T=0:T>=F&&(T=F-1),b<0?b=0:b>=q&&(b=q-1);const M=b*F+T;s[M]===ot.AIR&&(s[M]=ot.FLUID);let w=x*G-.5,k=y*G-.5;w<0?w=0:w>F-1.0001&&(w=F-1.0001),k<0?k=0:k>q-1.0001&&(k=q-1.0001);const C=Math.floor(w),A=Math.floor(k),B=w-C,E=k-A,L=1-B,P=1-E,D=A*F+C;r[D]+=L*P,r[D+1]+=B*P,r[D+F]+=L*E,r[D+F+1]+=B*E;let R=x*G,V=y*G-.5;R<0?R=0:R>F-1e-4&&(R=F-1e-4),V<0?V=0:V>q-1.0001&&(V=q-1.0001);const W=Math.floor(R),N=Math.floor(V),_=R-W,Y=V-N,J=1-_,j=1-Y,tt=J*j,it=_*j,at=J*Y,nt=_*Y,rt=N*It+W,I=rt+1,U=rt+It,Z=U+1,st=u[g];e[rt]+=st*tt,e[I]+=st*it,e[U]+=st*at,e[Z]+=st*nt,o[rt]+=tt,o[I]+=it,o[U]+=at,o[Z]+=nt;let O=x*G-.5,X=y*G;O<0?O=0:O>F-1.0001&&(O=F-1.0001),X<0?X=0:X>q-1e-4&&(X=q-1e-4);const dt=Math.floor(O),kt=Math.floor(X),mt=O-dt,vt=X-kt,St=1-mt,Lt=1-vt,zt=St*Lt,Ht=mt*Lt,ge=St*vt,ye=mt*vt,Yt=kt*F+dt,be=Yt+1,ae=Yt+F,xe=ae+1,Xt=h[g];i[Yt]+=Xt*zt,i[be]+=Xt*Ht,i[ae]+=Xt*ge,i[xe]+=Xt*ye,a[Yt]+=zt,a[be]+=Ht,a[ae]+=ge,a[xe]+=ye}const n=this.prevU,p=this.validU;for(let g=0;g<q;g++){const x=g*F,y=g*It;for(let T=0;T<=F;T++){const b=y+T,M=T>0?s[x+T-1]:ot.SOLID,w=T<F?s[x+T]:ot.SOLID;if(M===ot.SOLID||w===ot.SOLID)e[b]=0,n[b]=0,p[b]=1;else if(o[b]>0){const k=e[b]/o[b];e[b]=k,n[b]=k,p[b]=1}else M===ot.FLUID||w===ot.FLUID?(e[b]=0,n[b]=0,p[b]=1):(e[b]=0,n[b]=0,p[b]=0)}}const f=this.prevV,m=this.validV;for(let g=0;g<=q;g++){const x=g*F,y=(g-1)*F,T=g*F;for(let b=0;b<F;b++){const M=x+b,w=g>0?s[y+b]:ot.AIR,k=g<q?s[T+b]:ot.SOLID;if(w===ot.SOLID||k===ot.SOLID)i[M]=0,f[M]=0,m[M]=1;else if(a[M]>0){const C=i[M]/a[M];i[M]=C,f[M]=C,m[M]=1}else w===ot.FLUID||k===ot.FLUID?(i[M]=0,f[M]=0,m[M]=1):(i[M]=0,f[M]=0,m[M]=0)}}}solvePressure(t){const o=this.cellType,a=this.pressure,r=this.particleDensity,c=this.u,l=this.v;a.fill(0);for(let d=0;d<t;d++)for(let u=0;u<q;u++){const h=u*F,n=u*It,p=u*F,f=(u+1)*F;for(let m=0;m<F;m++){const g=h+m;if(o[g]!==ot.FLUID)continue;const x=m>0&&o[g-1]!==ot.SOLID?1:0,y=m<F-1&&o[g+1]!==ot.SOLID?1:0,T=u>0?o[g-F]!==ot.SOLID?1:0:1,b=u<q-1&&o[g+F]!==ot.SOLID?1:0,M=x+y+T+b;if(M===0)continue;const w=n+m,k=w+1,C=p+m,A=f+m;let B=c[k]-c[w]+(l[A]-l[C]);const E=r[g]-3.6;if(E>0){const P=E<4?E:4;B-=1*P}const L=-B/M*1.85;a[g]+=L,c[w]-=x*L,c[k]+=y*L,l[C]-=T*L,l[A]+=b*L}}}gridToParticles(){const s=.07999999999999996,e=this.numParticles,i=this.px,o=this.py,a=this.vx,r=this.vy,c=this.u,l=this.prevU,d=this.validU,u=this.v,h=this.prevV,n=this.validV;for(let p=0;p<e;p++){const f=i[p],m=o[p];let g=f*G,x=m*G-.5;g<0?g=0:g>F-1e-4&&(g=F-1e-4),x<0?x=0:x>q-1.0001&&(x=q-1.0001);const y=Math.floor(g),T=Math.floor(x),b=g-y,M=x-T,w=1-b,k=1-M,C=T*It+y,A=C+1,B=C+It,E=B+1;let L=0,P=0,D=0;if(d[C]!==0){const O=w*k,X=c[C];L+=O*X,P+=O*(X-l[C]),D+=O}if(d[A]!==0){const O=b*k,X=c[A];L+=O*X,P+=O*(X-l[A]),D+=O}if(d[B]!==0){const O=w*M,X=c[B];L+=O*X,P+=O*(X-l[B]),D+=O}if(d[E]!==0){const O=b*M,X=c[E];L+=O*X,P+=O*(X-l[E]),D+=O}let R=a[p];if(D>0){const O=1/D;L*=O,P*=O,R=s*L+.92*(R+P)}let V=f*G-.5,W=m*G;V<0?V=0:V>F-1.0001&&(V=F-1.0001),W<0?W=0:W>q-1e-4&&(W=q-1e-4);const N=Math.floor(V),_=Math.floor(W),Y=V-N,J=W-_,j=1-Y,tt=1-J,it=_*F+N,at=it+1,nt=it+F,rt=nt+1;let I=0,U=0,Z=0;if(n[it]!==0){const O=j*tt,X=u[it];I+=O*X,U+=O*(X-h[it]),Z+=O}if(n[at]!==0){const O=Y*tt,X=u[at];I+=O*X,U+=O*(X-h[at]),Z+=O}if(n[nt]!==0){const O=j*J,X=u[nt];I+=O*X,U+=O*(X-h[nt]),Z+=O}if(n[rt]!==0){const O=Y*J,X=u[rt];I+=O*X,U+=O*(X-h[rt]),Z+=O}let st=r[p];if(Z>0){const O=1/Z;I*=O,U*=O,st=s*I+.92*(st+U)}if(!Number.isFinite(R)||!Number.isFinite(st))R=0,st=0;else{const O=R*R+st*st;if(O>342.25){const X=18.5/Math.sqrt(O);R*=X,st*=X}}a[p]=R,r[p]=st}}stepEffectsAndPost(t,s,e,i){const o=Math.exp(-1.7*t);for(let b=0;b<this.numParticles;b++){let M=this.foam[b]*o;const w=this.vx[b]*this.vx[b]+this.vy[b]*this.vy[b];w>25&&(M+=(Math.sqrt(w)-5)*.045*t),this.foam[b]=M>1?1:M<.002?0:M}const a=1-.75*t>0?1-.75*t:0,r=Mt*t;for(let b=this.numSpray-1;b>=0;b--){const M=this.slife[b]-t;if(M<=0){const C=--this.numSpray;b!==C&&(this.spx[b]=this.spx[C],this.spy[b]=this.spy[C],this.svx[b]=this.svx[C],this.svy[b]=this.svy[C],this.slife[b]=this.slife[C],this.smaxLife[b]=this.smaxLife[C]);continue}this.svy[b]+=r,this.svx[b]*=a,this.svy[b]*=a;let w=this.spx[b]+this.svx[b]*t,k=this.spy[b]+this.svy[b]*t;if(w<0||w>K||k<0||k>Q){this.slife[b]=0;continue}if(this.sampleTerrainSDF(s,w,k),this.sdfDist<.015){const C=this.sdfNx,A=this.sdfNy,B=.015-this.sdfDist;w+=C*B,k+=A*B;const E=this.svx[b]*C+this.svy[b]*A;if(E<0){const L=this.svx[b]-E*C,P=this.svy[b]-E*A;this.svx[b]=L*.7-.25*E*C,this.svy[b]=P*.7-.25*E*A}this.slife[b]=M-t*1.5}else this.slife[b]=M;this.spx[b]=w,this.spy[b]=k}const c=1-2.1*t>0?1-2.1*t:0,l=5.8*t,d=this.simTime;for(let b=this.numSteam-1;b>=0;b--){const M=this.stlife[b]-t;if(M<=0||this.sty[b]>Q-$){const k=--this.numSteam;b!==k&&(this.stx[b]=this.stx[k],this.sty[b]=this.sty[k],this.stvx[b]=this.stvx[k],this.stvy[b]=this.stvy[k],this.stlife[b]=this.stlife[k],this.stmaxLife[b]=this.stmaxLife[k]);continue}this.stlife[b]=M;const w=this.stx[b]*2.4+this.sty[b]*3.1+d*3.6;this.stvx[b]=(this.stvx[b]+Math.sin(w)*2.8*t)*c,this.stvy[b]=(this.stvy[b]+l)*c,this.stx[b]+=this.stvx[b]*t,this.sty[b]+=this.stvy[b]*t}e.postStep(this,s,t,i);const u=e.drains,h=u.length;if(h>0)for(let b=this.numParticles-1;b>=0;b--){const M=this.px[b],w=this.py[b];for(let k=0;k<h;k++){const C=u[k];if(M>=C.x&&M<=C.x+C.w&&(w>=C.y&&w<=C.y+C.h||C.y<=$&&w<=$*1.1)){this.removeParticle(b);break}}}const n=this.numParticles,p=this.particleVBOData;let f=0,m=0;for(let b=0;b<n;b++){const M=this.vx[b],w=this.vy[b],k=M*M+w*w;m+=k,f+=Math.sqrt(k);const C=b*5;p[C]=this.px[b],p[C+1]=this.py[b],p[C+2]=M,p[C+3]=w,p[C+4]=this.foam[b]}const g=this.telemetry;g.particleCount=n,g.avgSpeed=n>0?f/n:0,g.kineticEnergy=.5*m;const x=this.stepImpactEnergy<1?this.stepImpactEnergy:1,y=Math.exp(-7.5*t),T=g.splashIntensity*y+x*(1-Math.exp(-14*t));g.splashIntensity=T>1?1:T<.001?0:T}packVBO(){const t=this.numParticles,s=this.particleVBOData;for(let e=0;e<t;e++){const i=e*5;s[i]=this.px[e],s[i+1]=this.py[e],s[i+2]=this.vx[e],s[i+3]=this.vy[e],s[i+4]=this.foam[e]}}sampleTerrainSDF(t,s,e){const i=s<0?0:s>K-1e-4?K-1e-4:s,o=e<0?0:e>Q-1e-4?Q-1e-4:e;let a=i*G-.5,r=o*G-.5;a<0?a=0:a>F-1.0001&&(a=F-1.0001),r<0?r=0:r>q-1.0001&&(r=q-1.0001);const c=Math.floor(a),l=Math.floor(r),d=a-c,u=r-l,h=1-d,n=1-u,p=h*n,f=d*n,m=h*u,g=d*u,x=l*F+c,y=x+1,T=x+F,b=T+1,M=t.sdf,w=t.sdfNormX,k=t.sdfNormY;this.sdfDist=p*M[x]+f*M[y]+m*M[T]+g*M[b];let C=p*w[x]+f*w[y]+m*w[T]+g*w[b],A=p*k[x]+f*k[y]+m*k[T]+g*k[b];const B=Math.sqrt(C*C+A*A);if(B>1e-6){const E=1/B;this.sdfNx=C*E,this.sdfNy=A*E}else this.sdfNx=0,this.sdfNy=1}}function H(S,t,s){return S<t?t:S>s?s:S}const bs=60/(Math.PI*2),te=F*q;class xs{constructor(){v(this,"turbines",[]);v(this,"bodies",[]);v(this,"goals",[]);v(this,"cisterns",[]);v(this,"gates",[]);v(this,"crackedWalls",[]);v(this,"magmaVents",[]);v(this,"spouts",[]);v(this,"drains",[]);v(this,"debris",[]);v(this,"portals",[]);v(this,"mines",[]);v(this,"seesaws",[]);v(this,"valves",[]);v(this,"relays",[]);v(this,"pumps",[]);v(this,"isSandbox",!1);v(this,"sandboxCounter",0);v(this,"pendingValveToggleCount",0);v(this,"nearbyIndices",new Int32Array(ct));v(this,"ventTouchIndices",new Int32Array(ct));v(this,"magmaBoilAccum",new Map);v(this,"relayVisited",new Uint8Array(te));v(this,"relayParent",new Int32Array(te));v(this,"relayQueue",new Int32Array(te));v(this,"relayRawPath",new Int32Array(te));v(this,"seesawTorque",new Float64Array(16));v(this,"valveAngVel",new Float64Array(16));v(this,"obbOut",{hit:!1,nx:0,ny:0,pen:0,relVn:0,leverArm:0,x:0,y:0,vx:0,vy:0,impulseN:0})}loadLevel(t,s){this.isSandbox=!!t.isSandbox,this.sandboxCounter=0,this.pendingValveToggleCount=0,this.magmaBoilAccum.clear(),this.turbines=t.turbines.map(e=>({id:e.id,x:e.x,y:e.y,radius:e.radius,angle:0,angularVel:0,charge:0,targetCharge:e.targetCharge??1,decayRate:e.decayRate,lockOnFull:e.lockOnFull??!0,completed:!1,linkedGateId:e.linkedGateId})),this.bodies=t.bodies.map(e=>({id:e.id,kind:e.kind,x:e.x,y:e.y,vx:0,vy:0,angle:0,angularVel:0,w:e.w,h:e.h,density:e.density,submergedRatio:0,inGoal:!1,portalCooldown:0})),this.goals=t.goals.map(e=>({id:e.id,bodyId:e.bodyId,x:e.x,y:e.y,w:e.w,h:e.h,fulfilled:!1,pulse:0})),this.cisterns=t.cisterns.map(e=>({id:e.id,x:e.x,y:e.y,w:e.w,h:e.h,thresholdParticles:e.thresholdParticles,particleCount:0,fillRatio:0,activated:!1,linkedGateId:e.linkedGateId})),this.gates=t.gates.map(e=>({id:e.id,baseX:e.x,baseY:e.y,w:e.w,h:e.h,x:e.x,y:e.y,openOffsetX:e.openOffsetX,openOffsetY:e.openOffsetY,openProgress:0,requiredTriggerIds:[...e.requiredTriggerIds],speed:e.speed??1.4,isOpen:!1})),this.crackedWalls=t.crackedWalls.map(e=>({id:e.id,x:e.x,y:e.y,w:e.w,h:e.h,hp:e.maxHp,maxHp:e.maxHp,impactThreshold:e.impactThreshold,stressGlow:0,broken:!1})),this.magmaVents=t.magmaVents.map(e=>({id:e.id,x:e.x,y:e.y,w:e.w,h:e.h,heat:e.maxHeat,maxHeat:e.maxHeat,reheatRate:e.reheatRate,quenched:!1,goalQuench:e.goalQuench??!1,steamPulse:0})),this.spouts=t.spouts.map(e=>({id:e.id,x:e.x,y:e.y,dirX:e.dirX,dirY:e.dirY,speed:e.speed,rate:e.rate,radius:e.radius,maxParticles:e.maxParticles??1e6,emitted:0,enabled:e.enabled??!0,accumulator:0})),this.drains=t.drains.map(e=>({...e})),this.debris=[],this.portals=(t.portals??[]).map(e=>{const i=Math.hypot(e.outDirX,e.outDirY);return{id:e.id,inX:e.inX,inY:e.inY,outX:e.outX,outY:e.outY,outDirX:i>1e-5?e.outDirX/i:1,outDirY:i>1e-5?e.outDirY/i:0,radius:e.radius,boost:e.boost??1.2,pulse:0}}),this.mines=(t.mines??[]).map(e=>({id:e.id,x:e.x,y:e.y,vx:0,vy:0,angle:0,angularVel:0,radius:e.radius??.24,density:e.density??.48,spawnX:e.x,spawnY:e.y,detonated:!1,respawnTimer:0,submergedRatio:0,portalCooldown:0,flash:0})),this.seesaws=(t.seesaws??[]).map(e=>{const i=e.restAngle??0;return{id:e.id,x:e.x,y:e.y,length:e.length,thickness:e.thickness??.16,angle:i,angularVel:0,maxAngle:e.maxAngle??.52,restAngle:i,damping:e.damping??2.4}}),this.valves=(t.valves??[]).map(e=>{const i=e.initialToggled??!1;return{id:e.id,x:e.x,y:e.y,length:e.length,thickness:e.thickness??.14,angleA:e.angleA,angleB:e.angleB,angle:i?e.angleB:e.angleA,toggled:i}}),this.relays=(t.relays??[]).map(e=>({id:e.id,ax:e.ax,ay:e.ay,bx:e.bx,by:e.by,radius:e.radius??.35,charge:0,active:!1,linkedGateId:e.linkedGateId,linkedPumpId:e.linkedPumpId,isObjective:e.isObjective??!1,bridgePath:[]})),this.pumps=(t.pumps??[]).map(e=>{const i=Math.hypot(e.dirX,e.dirY),o=e.requiredTriggerIds.length===0;return{id:e.id,x:e.x,y:e.y,dirX:i>1e-5?e.dirX/i:0,dirY:i>1e-5?e.dirY/i:1,force:e.force,range:e.range,radius:e.radius,requiredTriggerIds:[...e.requiredTriggerIds],active:o,power:o?1:0}}),this.preStep(s,0)}preStep(t,s){const e=Math.max(0,s);this.valveAngVel.length<this.valves.length&&(this.valveAngVel=new Float64Array(this.valves.length));const i=1-Math.exp(-12*e);for(let o=0;o<this.valves.length;o++){const a=this.valves[o];let c=(a.toggled?a.angleB:a.angleA)-a.angle;for(;c>Math.PI;)c-=Math.PI*2;for(;c<-Math.PI;)c+=Math.PI*2;const l=c*i;a.angle+=l,this.valveAngVel[o]=e>1e-5?H(l/e,-12,12):0}for(const o of this.gates){const r=o.requiredTriggerIds.length>0&&o.requiredTriggerIds.every(l=>this.isTriggerSatisfied(l))?1:0,c=o.speed*e;o.openProgress<r?o.openProgress=Math.min(r,o.openProgress+c):o.openProgress>r&&(o.openProgress=Math.max(r,o.openProgress-c)),o.x=o.baseX+o.openOffsetX*o.openProgress,o.y=o.baseY+o.openOffsetY*o.openProgress,o.isOpen=o.openProgress>.72}this.syncDynamicSolids(t)}coupleParticles(t,s,e){if(e<=0)return;this.pendingValveToggleCount>0&&(t.telemetry.valveToggleCount=(t.telemetry.valveToggleCount??0)+this.pendingValveToggleCount,this.pendingValveToggleCount=0),this.seesawTorque.length<this.seesaws.length&&(this.seesawTorque=new Float64Array(this.seesaws.length)),this.seesawTorque.fill(0),this.stepRelays(t,e),this.stepPumps(t,e),this.stepTurbines(t,e),this.stepFluidOBBs(t,e),this.stepBodies(t,s,e);const i=this.stepMines(t,s,e);this.integrateSeesaws(e),this.stepPortals(t,s,e);const o=this.stepCrackedWalls(t,s,e);(i||o)&&this.syncDynamicSolids(s),this.stepMagmaVents(t,s,e),this.stepCisternsAndGoals(t,e)}postStep(t,s,e,i){if(!(e<=0)){for(const o of this.spouts){if(!o.enabled||o.emitted>=o.maxParticles)continue;if(t.numParticles>=i)break;o.accumulator+=o.rate*e;const a=Math.floor(o.accumulator);if(a<=0)continue;o.accumulator-=a;const r=o.maxParticles-o.emitted,c=i-t.numParticles,l=Math.min(a,r,c);if(l<=0)continue;const d=t.spawnJet(o.x,o.y,o.dirX,o.dirY,o.speed,l,o.radius,i);o.emitted+=d,d<l&&(o.accumulator=Math.min(o.accumulator,o.rate*.15))}for(let o=this.debris.length-1;o>=0;o--){const a=this.debris[o];if(a.life-=e,a.life<=0){this.debris[o]=this.debris[this.debris.length-1],this.debris.pop();continue}a.vy+=Mt*.9*e,a.vx*=Math.exp(-.35*e),a.x+=a.vx*e,a.y+=a.vy*e,a.angle+=a.angularVel*e;const r=s.sampleSDF(a.x,a.y),c=a.size*.5;if(r.dist<c){const l=Math.hypot(r.nx,r.ny),d=l>1e-4?r.nx/l:0,u=l>1e-4?r.ny/l:1,h=c-r.dist;a.x+=d*h,a.y+=u*h;const n=a.vx*d+a.vy*u;if(n<0){a.vx-=1.42*n*d,a.vy-=1.42*n*u;const p=-u,f=d,m=a.vx*p+a.vy*f;a.vx-=p*m*.22,a.vy-=f*m*.22,a.angularVel=a.angularVel*.75+m/Math.max(.04,a.size)*.25}}(a.x<-.5||a.x>K+.5||a.y<-.5||a.y>Q+1.5)&&(this.debris[o]=this.debris[this.debris.length-1],this.debris.pop())}}}spawnIceShards(t){const s=t.length;if(s===0)return;const i=Math.min(s,60),o=s/i;for(let a=0;a<i;a++){const r=t[Math.min(s-1,Math.floor(a*o))],c=1.2+Math.random()*.8;this.pushDebris({x:r.x+(Math.random()-.5)*.06,y:r.y+(Math.random()-.5)*.06,vx:(Math.random()-.5)*4.4,vy:1+Math.random()*3.4,angle:Math.random()*Math.PI*2,angularVel:(Math.random()-.5)*16,size:.045+Math.random()*.045,life:c,maxLife:c,kind:"ice"})}}toggleValveAt(t,s){let e=null,i=1/0;for(const o of this.valves){const a=Math.max(.85,o.length*.65),r=t-o.x,c=s-o.y,l=r*r+c*c;l<=a*a&&l<i&&(i=l,e=o)}return e?(e.toggled=!e.toggled,this.pendingValveToggleCount++,!0):!1}isHoveringValve(t,s){for(const e of this.valves){const i=Math.max(.75,e.length*.58),o=t-e.x,a=s-e.y;if(o*o+a*a<=i*i)return!0}return!1}isLevelComplete(){if(this.isSandbox)return!1;const t=this.magmaVents.filter(i=>i.goalQuench),s=this.relays.filter(i=>i.isObjective);return this.turbines.length>0||this.goals.length>0||t.length>0||s.length>0?this.turbines.every(i=>i.completed)&&this.goals.every(i=>i.fulfilled)&&t.every(i=>i.quenched)&&s.every(i=>i.active):this.crackedWalls.length>0?this.crackedWalls.every(i=>i.broken):this.cisterns.length>0?this.cisterns.every(i=>i.activated):!1}getObjectives(){if(this.isSandbox)return[{labelKey:"objSandbox",progress:0,done:!1}];const t=[],s=this.magmaVents.filter(i=>i.goalQuench);if(s.length>0){let i=0,o=0;for(const a of s)if(a.quenched)i++,o+=1;else{const r=Math.max(1e-4,a.maxHeat);o+=H(1-a.heat/r,0,1)}t.push({labelKey:"objMagma",progress:o/s.length,done:i===s.length,detail:`${i}/${s.length}`})}const e=this.relays.filter(i=>i.isObjective);if(e.length>0){let i=0,o=0;for(const a of e)a.active?(i++,o+=1):o+=H(a.charge/.75,0,1);t.push({labelKey:"objRelays",progress:o/e.length,done:i===e.length,detail:`${i}/${e.length}`})}if(this.crackedWalls.length>0){let i=0,o=0;for(const a of this.crackedWalls)if(a.broken)i++,o+=1;else{const r=Math.max(1e-4,a.maxHp);o+=H(1-a.hp/r,0,1)}t.push({labelKey:this.mines.length>0?"objMines":"objWalls",progress:o/this.crackedWalls.length,done:i===this.crackedWalls.length,detail:`${i}/${this.crackedWalls.length}`})}if(this.cisterns.length>0){let i=0,o=0;for(const a of this.cisterns)a.activated&&i++,o+=H(a.fillRatio,0,1);t.push({labelKey:"objCisterns",progress:o/this.cisterns.length,done:i===this.cisterns.length,detail:`${i}/${this.cisterns.length}`})}if(this.turbines.length>0){let i=0,o=0;for(const a of this.turbines)if(a.completed)i++,o+=1;else{const r=Math.max(1e-4,a.targetCharge);o+=H(a.charge/r,0,1)}t.push({labelKey:"objTurbines",progress:o/this.turbines.length,done:i===this.turbines.length,detail:`${i}/${this.turbines.length}`})}if(this.goals.length>0){let i=0;for(const o of this.goals)o.fulfilled&&i++;t.push({labelKey:"objRelics",progress:i/this.goals.length,done:i===this.goals.length,detail:`${i}/${this.goals.length}`})}return t}getSnapshot(){return{turbines:this.turbines.map(t=>({...t})),bodies:this.bodies.map(t=>({...t})),goals:this.goals.map(t=>({...t})),cisterns:this.cisterns.map(t=>({...t})),gates:this.gates.map(t=>({...t,requiredTriggerIds:[...t.requiredTriggerIds]})),crackedWalls:this.crackedWalls.map(t=>({...t})),magmaVents:this.magmaVents.map(t=>({...t})),spouts:this.spouts.map(t=>({...t})),drains:this.drains.map(t=>({...t})),debris:this.debris.map(t=>({...t})),portals:this.portals.map(t=>({...t})),mines:this.mines.map(t=>({...t})),seesaws:this.seesaws.map(t=>({...t})),valves:this.valves.map(t=>({...t})),relays:this.relays.map(t=>({...t,bridgePath:t.bridgePath.map(s=>[s[0],s[1]])})),pumps:this.pumps.map(t=>({...t,requiredTriggerIds:[...t.requiredTriggerIds]}))}}toggleSpouts(t){const s=t!==void 0?t:!this.spouts.some(e=>e.enabled);for(const e of this.spouts)e.enabled=s}addSandboxTurbine(t,s){this.turbines.push({id:`sb_turbine_${++this.sandboxCounter}`,x:H(t,.7,K-.7),y:H(s,.7,Q-.7),radius:.55,angle:0,angularVel:0,charge:0,targetCharge:1,decayRate:.05,lockOnFull:!0,completed:!1})}addSandboxBody(t,s,e){const i=e==="ark",o=i?1.05:.52,a=i?.42:.52;this.bodies.push({id:`sb_${e}_${++this.sandboxCounter}`,kind:e,x:H(t,o*.5+.2,K-o*.5-.2),y:H(s,a*.5+.2,Q-a*.5-.2),vx:0,vy:0,angle:0,angularVel:0,w:o,h:a,density:i?.48:.62,submergedRatio:0,inGoal:!1,portalCooldown:0})}addSandboxMagma(t,s){this.magmaVents.push({id:`sb_magma_${++this.sandboxCounter}`,x:H(t-1*.5,.25,K-1-.25),y:H(s-.28*.5,.25,Q-.28-.25),w:1,h:.28,heat:18,maxHeat:18,reheatRate:1.2,quenched:!1,goalQuench:!1,steamPulse:0})}addSandboxCrackedWall(t,s){this.crackedWalls.push({id:`sb_wall_${++this.sandboxCounter}`,x:H(t-.34*.5,.25,K-.34-.25),y:H(s-1.35*.5,.25,Q-1.35-.25),w:.34,h:1.35,hp:12,maxHp:12,impactThreshold:4.5,stressGlow:0,broken:!1})}addSandboxMine(t,s){const i=H(t,.44,K-.24-.2),o=H(s,.24+.2,Q-.24-.2);this.mines.push({id:`sb_mine_${++this.sandboxCounter}`,x:i,y:o,vx:0,vy:0,angle:0,angularVel:0,radius:.24,density:.48,spawnX:i,spawnY:o,detonated:!1,respawnTimer:0,submergedRatio:0,portalCooldown:0,flash:0})}addSandboxSeesaw(t,s){this.seesaws.push({id:`sb_seesaw_${++this.sandboxCounter}`,x:H(t,1.4,K-1.4),y:H(s,.9,Q-.9),length:2.4,thickness:.16,angle:0,angularVel:0,maxAngle:.5,restAngle:0,damping:2.4})}isTriggerSatisfied(t){for(const s of this.cisterns)if(s.id===t)return s.activated;for(const s of this.turbines)if(s.id===t){const e=s.targetCharge>0?s.charge/s.targetCharge:s.charge;return s.completed||e>=.95}for(const s of this.relays)if(s.id===t)return s.active;for(const s of this.valves)if(s.id===t)return s.toggled;return!1}syncDynamicSolids(t){t.clearDynamicSolids();for(const s of this.gates)t.stampDynamicRect(s.x,s.y,s.w,s.h,ht.GATE);for(const s of this.crackedWalls)s.broken||t.stampDynamicRect(s.x,s.y,s.w,s.h,ht.CRACKED_WALL);t.rebuildSDFIfDirty()}collideCircleWithOBB(t,s,e,i,o,a,r,c,l,d,u,h,n){const p=this.obbOut,f=t-a,m=s-r,g=c+l+o+.04;if(f*f+m*m>g*g)return p.hit=!1,p;const x=Math.cos(d),y=Math.sin(d),T=f*x+m*y,b=-f*y+m*x,M=H(T,-c,c),w=H(b,-l,l),k=T-M,C=b-w,A=k*k+C*C;let B,E,L;if(A>1e-10){if(A>=o*o)return p.hit=!1,p;const nt=Math.sqrt(A),rt=1/nt;B=k*rt,E=C*rt,L=o-nt}else{const nt=c-Math.abs(T),rt=l-Math.abs(b);rt<=nt?(B=0,E=b>=0?1:-1,L=rt+o):(B=T>=0?1:-1,E=0,L=nt+o)}const P=B*x-E*y,D=B*y+E*x,R=M*x-w*y,V=M*y+w*x,W=R*D-V*P,N=-u*V,_=u*R,Y=e-N,J=i-_,j=Y*P+J*D;let tt=e,it=i,at=0;if(j<0){at=-(1+h)*j,tt+=at*P,it+=at*D;const nt=-D,rt=P,I=Y*nt+J*rt;tt-=I*n*nt,it-=I*n*rt}return p.hit=!0,p.nx=P,p.ny=D,p.pen=L,p.relVn=j,p.leverArm=W,p.x=t+P*L,p.y=s+D*L,p.vx=tt,p.vy=it,p.impulseN=at,p}stepRelays(t,s){if(this.relays.length===0){t.telemetry.relayActiveIntensity=0;return}const e=t.cellType,i=this.relayVisited,o=this.relayParent,a=this.relayQueue,r=this.relayRawPath;let c=0;for(const l of this.relays){i.fill(0);let d=0,u=0;const h=l.radius+.28,n=h*h,p=Math.max(0,Math.floor((l.ax-h)*G)),f=Math.min(F-1,Math.floor((l.ax+h)*G)),m=Math.max(0,Math.floor((l.ay-h)*G)),g=Math.min(q-1,Math.floor((l.ay+h)*G));for(let y=m;y<=g;y++){const T=(y+.5)*$-l.ay,b=y*F;for(let M=p;M<=f;M++){const w=(M+.5)*$-l.ax;if(w*w+T*T<=n){const k=b+M;e[k]===ot.FLUID&&i[k]===0&&(i[k]=1,o[k]=-1,a[u++]=k)}}}let x=-1;for(;d<u;){const y=a[d++],T=y%F,b=y/F|0,M=(T+.5)*$-l.bx,w=(b+.5)*$-l.by;if(M*M+w*w<=n){x=y;break}for(let k=-1;k<=1;k++){const C=b+k;if(C<0||C>=q)continue;const A=C*F;for(let B=-1;B<=1;B++){if(B===0&&k===0)continue;const E=T+B;if(E<0||E>=F)continue;const L=A+E;e[L]===ot.FLUID&&i[L]===0&&(i[L]=1,o[L]=y,a[u++]=L)}}}if(x!==-1){let y=0,T=x;for(;T!==-1&&y<r.length;)r[y++]=T,T=o[T];const b=[[l.ax,l.ay]],M=Math.min(12,y);if(M>0)for(let w=0;w<M;w++){const k=M===1?y-1:Math.round((M-1-w)*(y-1)/(M-1)),C=r[H(k,0,y-1)],A=C%F,B=C/F|0;b.push([(A+.5)*$,(B+.5)*$])}b.push([l.bx,l.by]),l.bridgePath=b,l.charge=Math.min(1,l.charge+1.8*s)}else l.charge=Math.max(0,l.charge-.28*s),l.charge<.75&&(l.bridgePath=[]);l.active=l.charge>=.75,l.charge>c&&(c=l.charge)}t.telemetry.relayActiveIntensity=c}stepPumps(t,s){if(this.pumps.length===0)return;const e=t.numParticles,i=t.px,o=t.py,a=t.vx,r=t.vy,c=t.foam;for(const l of this.pumps){const d=l.requiredTriggerIds.length===0||l.requiredTriggerIds.every(y=>this.isTriggerSatisfied(y));l.active=d;const u=d?1:0,h=d?3.5:2.5;if(l.power<u?l.power=Math.min(1,l.power+h*s):l.power>u&&(l.power=Math.max(0,l.power-h*s)),l.power<=.01)continue;const n=l.dirX,p=l.dirY,f=-p,m=n,g=1/Math.max(.1,l.range),x=1/Math.max(.05,l.radius);for(let y=0;y<e;y++){const T=i[y]-l.x,b=o[y]-l.y,M=T*n+b*p;if(M<-.1||M>l.range)continue;const w=Math.abs(T*f+b*m);if(w>l.radius)continue;const k=1-.3*H(M*g,0,1),C=1-.3*H(w*x,0,1),A=l.force*l.power*k*C*s;if(a[y]+=n*A,r[y]+=p*A,c[y]=Math.min(1,c[y]+l.power*1.35*s),t.numSpray<ft&&Math.random()<.025*l.power*(s*60)){const B=3.8+Math.random()*2.8;t.spawnSpray(i[y],o[y],n*B+f*(Math.random()-.5)*1.4,p*B+m*(Math.random()-.5)*1.4,.22+Math.random()*.28)}}for(const y of this.bodies){const T=y.x-l.x,b=y.y-l.y,M=T*n+b*p;if(M<-.15||M>l.range)continue;const w=T*f+b*m,k=Math.min(y.w,y.h)*.45;if(Math.abs(w)>l.radius+k)continue;const C=l.force*l.power*.85*s;y.vx+=n*C,y.vy+=p*C,y.vx-=f*w*1.6*l.power*s,y.vy-=m*w*1.6*l.power*s}for(const y of this.mines){if(y.detonated)continue;const T=y.x-l.x,b=y.y-l.y,M=T*n+b*p;if(M<-.15||M>l.range)continue;const w=T*f+b*m;if(Math.abs(w)>l.radius+y.radius*.6)continue;const k=l.force*l.power*.95*s;y.vx+=n*k,y.vy+=p*k,y.vx-=f*w*2.4*l.power*s,y.vy-=m*w*2.4*l.power*s}}}stepFluidOBBs(t,s){const e=t.numParticles;if(e===0||this.seesaws.length===0&&this.valves.length===0)return;const i=t.px,o=t.py,a=t.vx,r=t.vy,c=t.foam,l=.055;for(let d=0;d<this.seesaws.length;d++){const u=this.seesaws[d],h=u.length*.5,n=u.thickness*.5;for(let p=0;p<e;p++){const f=this.collideCircleWithOBB(i[p],o[p],a[p],r[p],ut,u.x,u.y,h,n,u.angle,u.angularVel,.08,.03);f.hit&&(i[p]=f.x,o[p]=f.y,a[p]=f.vx,r[p]=f.vy,f.impulseN>0&&(this.seesawTorque[d]-=f.impulseN*f.leverArm*l,f.impulseN>1.8&&(c[p]=Math.min(1,c[p]+f.impulseN*.14*s*60))))}}for(let d=0;d<this.valves.length;d++){const u=this.valves[d],h=u.length*.5,n=u.thickness*.5,p=this.valveAngVel[d]??0;for(let f=0;f<e;f++){const m=this.collideCircleWithOBB(i[f],o[f],a[f],r[f],ut,u.x,u.y,h,n,u.angle,p,.08,.025);m.hit&&(i[f]=m.x,o[f]=m.y,a[f]=m.vx,r[f]=m.vy,m.impulseN>2&&(c[f]=Math.min(1,c[f]+.12)))}}}integrateSeesaws(t){for(let s=0;s<this.seesaws.length;s++){const e=this.seesaws[s],i=Math.max(1.6,e.length*e.length*1);e.angularVel+=this.seesawTorque[s]/i,e.angularVel+=(e.restAngle-e.angle)*3.8*t,e.angularVel=H(e.angularVel*Math.exp(-e.damping*t),-8,8),e.angle+=e.angularVel*t;const o=e.restAngle-e.maxAngle,a=e.restAngle+e.maxAngle;e.angle>a?(e.angle=a,e.angularVel>0&&(e.angularVel=0)):e.angle<o&&(e.angle=o,e.angularVel<0&&(e.angularVel=0))}}stepTurbines(t,s){if(t.telemetry.maxTurbineRpm=0,t.telemetry.maxTurbineCharge=0,this.turbines.length===0)return;const e=t.numParticles,i=t.px,o=t.py,a=t.vx,r=t.vy,c=t.foam;for(const l of this.turbines){const d=l.radius*1.15,u=l.radius*.14,h=d*d,n=u*u;let p=0,f=0;const m=l.angularVel;for(let T=0;T<e;T++){const b=i[T]-l.x,M=o[T]-l.y;if(b>d||b<-d||M>d||M<-d)continue;const w=b*b+M*M;if(w>=h||w<=n)continue;const k=Math.sqrt(w),C=1/k,A=b*C,B=M*C,E=-B,L=A,P=E*m*k,D=L*m*k,R=(a[T]-P)*E+(r[T]-D)*L;p+=R*k,f+=w,a[T]-=E*R*.22,r[T]-=L*R*.22;const V=Math.abs(m)*.45*s;a[T]+=A*V,r[T]+=B*V,c[T]=Math.min(1,c[T]+Math.abs(R)*.75*s),t.numSpray<ft&&(Math.abs(R)>1.8||Math.abs(m)>4)&&Math.random()<Math.min(.06,Math.abs(R)*.014)*(s*60)&&t.spawnSpray(i[T],o[T],P+A*(.9+Math.random()*.9)+(Math.random()-.5)*.7,D+B*(.9+Math.random()*.9)+.5,.25+Math.random()*.3)}if(f>1e-6){const T=Math.min(.85,f*s*.65);l.angularVel+=p/f*T}l.angularVel=H(l.angularVel*Math.exp(-1.15*s),-18,18),l.angle+=l.angularVel*s;const g=Math.abs(l.angularVel);g>1.6?l.charge=Math.min(l.targetCharge,l.charge+g*.085*s):l.completed&&l.lockOnFull||(l.charge=Math.max(0,l.charge-l.decayRate*s)),l.charge>=l.targetCharge*.995?l.completed||(l.completed=!0,l.charge=l.targetCharge,t.telemetry.turbineCompletePulseCount++):!l.lockOnFull&&l.completed&&l.charge<l.targetCharge*.95&&(l.completed=!1);const x=g*bs;x>t.telemetry.maxTurbineRpm&&(t.telemetry.maxTurbineRpm=x);const y=l.targetCharge>0?H(l.charge/l.targetCharge,0,1):0;y>t.telemetry.maxTurbineCharge&&(t.telemetry.maxTurbineCharge=y)}}ensureNearbyBuffer(t){this.nearbyIndices.length<t&&(this.nearbyIndices=new Int32Array(t))}stepBodies(t,s,e){if(this.bodies.length===0)return;const i=t.numParticles;this.ensureNearbyBuffer(i);const o=t.px,a=t.py,r=t.vx,c=t.vy,l=t.numSteam,d=t.stx,u=t.sty,h=t.stvx,n=t.stvy,p=.19*.19;for(const f of this.bodies){f.portalCooldown!==void 0&&f.portalCooldown>0&&(f.portalCooldown=Math.max(0,f.portalCooldown-e));const m=Math.cos(f.angle),g=Math.sin(f.angle),x=Math.max(f.w,f.h)*.65+.24;let y=0;for(let I=0;I<i;I++){const U=o[I]-f.x,Z=a[I]-f.y;U>=-x&&U<=x&&Z>=-x&&Z<=x&&(this.nearbyIndices[y++]=I)}let T=0,b=0,M=0,w=0,k=0,C=0,A=0,B=0,E=0,L=0;const P=f.w*.34,D=f.h*.34;for(let I=-1;I<=1;I++){const U=I*P;for(let Z=-1;Z<=1;Z++){const st=Z*D,O=f.x+U*m-st*g,X=f.y+U*g+st*m;let dt=0,kt=0,mt=0;for(let St=0;St<y;St++){const Lt=this.nearbyIndices[St],zt=o[Lt]-O,Ht=a[Lt]-X;zt*zt+Ht*Ht<=p&&(dt++,kt+=r[Lt],mt+=c[Lt])}const vt=dt===0?0:Math.min(1,dt/2.5);T+=vt,dt>0&&(b+=kt,M+=mt,w+=dt),I===-1?(k+=vt,A+=mt,B+=dt):I===1&&(C+=vt,E+=mt,L+=dt)}}const R=H(T/9,0,1);f.submergedRatio=R;const V=w>0?b/w:0,W=w>0?M/w:0,N=k/3,_=C/3,Y=B>0?A/B:0,J=L>0?E/L:0;let j=0,tt=0,it=0;const at=Math.max(f.w*.75,.42),nt=Math.max(f.h*1.2,.55);for(let I=0;I<l;I++){const U=Math.abs(d[I]-f.x),Z=Math.abs(u[I]-f.y);U<at&&Z<nt&&(j++,tt+=h[I],it+=Math.max(0,n[I]))}f.vy+=Mt*e;const rt=1/Math.max(.25,f.density)*R*Math.abs(Mt)*1.15;if(f.vy+=rt*e,R>0&&(f.vx+=(V-f.vx)*R*4.5*e,f.vy+=(W-f.vy)*R*5.2*e,f.vx+=(N-_)*1.9*e),j>0){const I=tt/j,U=it/j,Z=Math.min(26,j*2.6+U*.55);f.vy+=Z*e;const st=Math.min(1,j*.12);f.vx+=(I-f.vx)*st*2.4*e,f.vy*=Math.exp(-st*1.5*e)}if(f.kind==="ark"){const I=(_-N)*5+(J-Y)*.7;f.angularVel+=(-f.angle*9+I)*e,f.angularVel*=Math.exp(-3.5*e)}else f.angularVel*=Math.exp(-2.2*e);f.x+=f.vx*e,f.y+=f.vy*e,f.angle+=f.angularVel*e,this.clampArkAngle(f),this.collideBodyWithOBBs(f),this.collideBodyWithTerrain(f,s),this.clampArkAngle(f),this.pushWakeParticles(f,t,s,y,e)}}clampArkAngle(t){t.kind==="ark"&&(t.angle>.55?(t.angle=.55,t.angularVel>0&&(t.angularVel=0)):t.angle<-.55&&(t.angle=-.55,t.angularVel<0&&(t.angularVel=0)))}collideBodyWithOBBs(t){if(this.seesaws.length===0&&this.valves.length===0)return;const s=Math.max(.5,t.w*t.h*t.density*1.6);if(t.kind==="sphere"){const u=t.w*.5;for(let h=0;h<this.seesaws.length;h++){const n=this.seesaws[h],p=this.collideCircleWithOBB(t.x,t.y,t.vx,t.vy,u,n.x,n.y,n.length*.5,n.thickness*.5,n.angle,n.angularVel,.14,.018);if(!p.hit)continue;t.x=p.x,t.y=p.y,t.vx=p.vx,t.vy=p.vy;const f=t.vx*-p.ny+t.vy*p.nx;t.angularVel=t.angularVel*.65-f/Math.max(.1,u)*.35,p.impulseN>0&&(this.seesawTorque[h]-=p.impulseN*p.leverArm*s)}for(let h=0;h<this.valves.length;h++){const n=this.valves[h],p=this.collideCircleWithOBB(t.x,t.y,t.vx,t.vy,u,n.x,n.y,n.length*.5,n.thickness*.5,n.angle,this.valveAngVel[h]??0,.14,.1);p.hit&&(t.x=p.x,t.y=p.y,t.vx=p.vx,t.vy=p.vy)}return}const e=Math.min(.06,t.w*.25,t.h*.25),i=Math.max(.01,t.w*.5-e),o=Math.max(.01,t.h*.5-e),a=Math.max(2,Math.ceil(2*i/.14)+1),r=Math.cos(t.angle),c=Math.sin(t.angle),l=(t.w*t.w+t.h*t.h)/10,d=(u,h,n,p,f,m,g)=>{let x=0,y=0,T=0,b=0,M=0,w=0,k=0;const C=(R,V)=>{const W=R*r-V*c,N=R*c+V*r,_=this.collideCircleWithOBB(t.x+W,t.y+N,t.vx-t.angularVel*N,t.vy+t.angularVel*W,e,u,h,n,p,f,m,.08,.14);_.hit&&(b++,M+=W,w+=N,k+=_.leverArm,_.pen>x&&(x=_.pen,y=_.nx,T=_.ny))};for(let R=0;R<a;R++){const V=-i+2*i*R/(a-1);C(V,-o),C(V,o)}if(b===0)return;t.x+=y*x,t.y+=T*x;const A=M/b,B=w/b,E=k/b,L=t.vx-t.angularVel*B,P=t.vy+t.angularVel*A,D=L*y+P*T;if(D<0){const R=A*T-B*y,V=-1.08*D/(1+R*R/l);t.vx+=V*y,t.vy+=V*T,t.angularVel+=R*V/l*.5;const W=-T,N=y,_=L*W+P*N;t.vx-=W*_*.14,t.vy-=N*_*.14,g>=0&&(this.seesawTorque[g]-=V*E*s)}};for(let u=0;u<this.seesaws.length;u++){const h=this.seesaws[u];d(h.x,h.y,h.length*.5,h.thickness*.5,h.angle,h.angularVel,u)}for(let u=0;u<this.valves.length;u++){const h=this.valves[u];d(h.x,h.y,h.length*.5,h.thickness*.5,h.angle,this.valveAngVel[u]??0,-1)}}collideBodyWithTerrain(t,s){if(t.kind==="sphere"){const y=t.w*.5;for(let T=0;T<2;T++){const b=s.sampleSDF(t.x,t.y);if(b.dist<y){const M=Math.hypot(b.nx,b.ny),w=M>1e-4?b.nx/M:0,k=M>1e-4?b.ny/M:1,C=y-b.dist;t.x+=w*C,t.y+=k*C;const A=t.vx*w+t.vy*k;if(A<0){const B=A<-1.5?.25:.04;t.vx-=(1+B)*A*w,t.vy-=(1+B)*A*k;const E=-k,L=w,P=t.vx*E+t.vy*L;t.vx-=E*P*.12,t.vy-=L*P*.12,t.angularVel=t.angularVel*.65-P/Math.max(.1,y)*.35}}else break}t.x=H(t.x,y,K-y),t.y=H(t.y,y,Q-y);return}const e=Math.min(.06,t.w*.25,t.h*.25),i=Math.max(.01,t.w*.5-e),o=Math.max(.01,t.h*.5-e),a=Math.max(2,Math.ceil(2*i/.1)+1),r=Math.max(2,Math.ceil(2*o/.1)+1),c=Math.min(t.w,t.h)*.42,l=(t.w*t.w+t.h*t.h)/10,d=Math.cos(t.angle),u=Math.sin(t.angle);let h=0,n=0,p=0,f=0,m=0;const g=(y,T,b)=>{const M=y*d-T*u,w=y*u+T*d,k=s.sampleSDF(t.x+M,t.y+w);if(k.dist<b){const C=b-k.dist,A=Math.hypot(k.nx,k.ny),B=A>1e-4?k.nx/A:0,E=A>1e-4?k.ny/A:1;h++,n+=M,p+=w,f+=B*C,m+=E*C}};for(let y=0;y<a;y++){const T=-i+2*i*y/(a-1);g(T,-o,e),g(T,o,e)}for(let y=1;y<r-1;y++){const T=-o+2*o*y/(r-1);g(-i,T,e),g(i,T,e)}if(g(0,0,c),h>0){const y=n/h,T=p/h,b=Math.hypot(f,m),M=b>1e-6?f/b:0,w=b>1e-6?m/b:1,k=t.vx-t.angularVel*T,C=t.vy+t.angularVel*y,A=k*M+C*w;if(A<0){const B=y*w-T*M,L=-(1+(A<-1.8?.16:0))*A/(1+B*B/l);t.vx+=L*M,t.vy+=L*w,t.angularVel+=B*L/l*.65;const P=-w,D=M,R=k*P+C*D;t.vx-=P*R*.14,t.vy-=D*R*.14}for(let B=0;B<3;B++){const E=Math.cos(t.angle),L=Math.sin(t.angle);let P=0;const D=(R,V,W)=>{const N=R*E-V*L,_=R*L+V*E,Y=s.sampleSDF(t.x+N,t.y+_);if(Y.dist<W){const J=W-Y.dist;J>P&&(P=J);const j=Math.hypot(Y.nx,Y.ny),tt=j>1e-4?Y.nx/j:0,it=j>1e-4?Y.ny/j:1;t.x+=tt*J,t.y+=it*J;const at=t.vx*tt+t.vy*it;at<0&&(t.vx-=at*tt,t.vy-=at*it)}};for(let R=0;R<a;R++){const V=-i+2*i*R/(a-1);D(V,-o,e),D(V,o,e)}for(let R=1;R<r-1;R++){const V=-o+2*o*R/(r-1);D(-i,V,e),D(i,V,e)}if(D(0,0,c),P<=1e-4)break}}const x=Math.min(t.w,t.h)*.5;t.x=H(t.x,x,K-x),t.y=H(t.y,x,Q-x)}pushWakeParticles(t,s,e,i,o){if(i===0)return;const a=s.px,r=s.py,c=s.vx,l=s.vy,d=s.foam,u=Math.cos(t.angle),h=Math.sin(t.angle),n=t.w*.5,p=t.h*.5,f=Math.min(.45,o*16);if(t.kind==="sphere"){const m=n,g=m*m;for(let x=0;x<i;x++){const y=this.nearbyIndices[x],T=a[y]-t.x,b=r[y]-t.y,M=T*T+b*b;if(M>=g)continue;const w=Math.sqrt(M),k=w>1e-4?T/w:0,C=w>1e-4?b/w:-1,A=Math.min(.025,(m-w)*.6),B=a[y]+k*A,E=r[y]+C*A;e.sampleSDF(B,E).dist>.015&&(a[y]=B,r[y]=E),c[y]+=(t.vx*.4+k*.6-c[y]*.12)*f,l[y]+=(t.vy*.4+C*.6-l[y]*.12)*f,d[y]=Math.min(1,d[y]+(Math.abs(t.vx)+Math.abs(t.vy))*.12*o)}return}for(let m=0;m<i;m++){const g=this.nearbyIndices[m],x=a[g]-t.x,y=r[g]-t.y,T=x*u+y*h,b=-x*h+y*u;if(!(Math.abs(T)>=n||Math.abs(b)>=p)&&(c[g]+=(t.vx*.4-c[g]*.08)*f,l[g]+=(t.vy*.4-l[g]*.08)*f,b<=p*.25)){const M=n+T,w=n-T,k=p+b;let C=0,A=-1,B=k;M<B&&M<=w?(B=M,C=-1,A=0):w<B&&(B=w,C=1,A=0);const E=C*u-A*h,L=C*h+A*u,P=Math.min(.024,B*.55),D=a[g]+E*P,R=r[g]+L*P;e.sampleSDF(D,R).dist>.015&&(a[g]=D,r[g]=R),c[g]+=E*.55*f,l[g]+=L*.55*f,d[g]=Math.min(1,d[g]+(Math.abs(t.vx)+Math.abs(t.vy))*.14*o)}}}stepMines(t,s,e){if(this.mines.length===0)return!1;const i=t.numParticles;this.ensureNearbyBuffer(i);const o=t.px,a=t.py,r=t.vx,c=t.vy,l=t.foam,d=this.crackedWalls.some(n=>!n.broken),u=.19*.19;let h=!1;for(const n of this.mines){if(n.flash*=Math.exp(-4.5*e),n.detonated){(d||this.isSandbox)&&(n.respawnTimer-=e,n.respawnTimer<=0&&(n.x=n.spawnX,n.y=n.spawnY,n.vx=0,n.vy=0,n.angle=0,n.angularVel=0,n.detonated=!1,n.respawnTimer=0,n.portalCooldown=.4,n.submergedRatio=0,n.flash=.85));continue}n.portalCooldown>0&&(n.portalCooldown=Math.max(0,n.portalCooldown-e));const p=n.radius+.24;let f=0;for(let P=0;P<i;P++){const D=o[P]-n.x,R=a[P]-n.y;D>=-p&&D<=p&&R>=-p&&R<=p&&(this.nearbyIndices[f++]=P)}const m=n.radius*.55;let g=0,x=0,y=0,T=0,b=0,M=0;for(let P=0;P<5;P++){const D=P===1?-m:P===2?m:0,R=P===3?-m:P===4?m:0,V=n.x+D,W=n.y+R;let N=0,_=0,Y=0;for(let j=0;j<f;j++){const tt=this.nearbyIndices[j],it=o[tt]-V,at=a[tt]-W;it*it+at*at<=u&&(N++,_+=r[tt],Y+=c[tt])}const J=N===0?0:Math.min(1,N/2.5);g+=J,N>0&&(x+=_,y+=Y,T+=N),P===1?b=J:P===2&&(M=J)}const w=H(g/5,0,1);n.submergedRatio=w;const k=T>0?x/T:0,C=T>0?y/T:0;n.vy+=Mt*e;const A=1/Math.max(.25,n.density)*w*Math.abs(Mt)*1.15;n.vy+=A*e,w>0&&(n.vx+=(k-n.vx)*w*4.5*e,n.vy+=(C-n.vy)*w*5.2*e,n.vx+=(b-M)*1.9*e),n.angularVel*=Math.exp(-2*e),n.x+=n.vx*e,n.y+=n.vy*e,n.angle+=n.angularVel*e;const B=Math.max(.32,Math.PI*n.radius*n.radius*n.density*3.8);for(let P=0;P<this.seesaws.length;P++){const D=this.seesaws[P],R=this.collideCircleWithOBB(n.x,n.y,n.vx,n.vy,n.radius,D.x,D.y,D.length*.5,D.thickness*.5,D.angle,D.angularVel,.12,.015);if(!R.hit)continue;n.x=R.x,n.y=R.y,n.vx=R.vx,n.vy=R.vy;const V=n.vx*-R.ny+n.vy*R.nx;n.angularVel=n.angularVel*.65-V/Math.max(.08,n.radius)*.35,R.impulseN>0&&(this.seesawTorque[P]-=R.impulseN*R.leverArm*B)}for(let P=0;P<this.valves.length;P++){const D=this.valves[P],R=this.collideCircleWithOBB(n.x,n.y,n.vx,n.vy,n.radius,D.x,D.y,D.length*.5,D.thickness*.5,D.angle,this.valveAngVel[P]??0,.16,.1);R.hit&&(n.x=R.x,n.y=R.y,n.vx=R.vx,n.vy=R.vy)}for(let P=0;P<2;P++){const D=s.sampleSDF(n.x,n.y);if(D.dist<n.radius){const R=Math.hypot(D.nx,D.ny),V=R>1e-4?D.nx/R:0,W=R>1e-4?D.ny/R:1,N=n.radius-D.dist;n.x+=V*N,n.y+=W*N;const _=n.vx*V+n.vy*W;if(_<0){const Y=_<-1.5?.25:.05;n.vx-=(1+Y)*_*V,n.vy-=(1+Y)*_*W;const J=-W,j=V,tt=n.vx*J+n.vy*j;n.vx-=J*tt*.1,n.vy-=j*tt*.1,n.angularVel=n.angularVel*.65-tt/Math.max(.08,n.radius)*.35}}else break}if(n.x=H(n.x,n.radius,K-n.radius),n.y=H(n.y,n.radius,Q-n.radius),f>0){const P=n.radius*n.radius,D=Math.min(.45,e*16);for(let R=0;R<f;R++){const V=this.nearbyIndices[R],W=o[V]-n.x,N=a[V]-n.y,_=W*W+N*N;if(_>=P)continue;const Y=Math.sqrt(_),J=Y>1e-4?W/Y:0,j=Y>1e-4?N/Y:-1,tt=Math.min(.022,(n.radius-Y)*.55),it=o[V]+J*tt,at=a[V]+j*tt;s.sampleSDF(it,at).dist>.015&&(o[V]=it,a[V]=at),r[V]+=(n.vx*.4+J*.5-r[V]*.12)*D,c[V]+=(n.vy*.4+j*.5-c[V]*.12)*D}}let E=!1;for(const P of this.drains)if(n.x>=P.x&&n.x<=P.x+P.w&&(n.y>=P.y&&n.y<=P.y+P.h||P.y<=$&&n.y<=$+n.radius)){E=!0;break}if(E){n.detonated=!0,n.respawnTimer=1.6,n.flash=0;continue}const L=n.radius+.12;for(const P of this.crackedWalls){if(P.broken)continue;const D=H(n.x,P.x,P.x+P.w),R=H(n.y,P.y,P.y+P.h),V=D-n.x,W=R-n.y,N=Math.hypot(V,W);if(N>=L)continue;const _=H(Math.floor((n.x+D)*.5*G),0,F-1),Y=H(Math.floor((n.y+R)*.5*G),0,q-1);if(s.getKindAtCell(_,Y)===ht.ROCK)continue;const J=N>1e-4?V/N*.04:0,j=N>1e-4?W/N*.04:0,tt=H(Math.floor((D+J)*G),0,F-1),it=H(Math.floor((R+j)*G),0,q-1);if(s.getKindAtCell(tt,it)===ht.ROCK)continue;n.detonated=!0,n.respawnTimer=2.5,n.flash=1,P.hp=0,P.broken=!0,P.stressGlow=1,h=!0,s.dirty=!0;for(let I=0;I<20;I++){const U=1.8+Math.random()*1.4;this.pushDebris({x:P.x+Math.random()*P.w,y:P.y+Math.random()*P.h,vx:(Math.random()-.5)*8.5,vy:1+Math.random()*5.2,angle:Math.random()*Math.PI*2,angularVel:(Math.random()-.5)*16,size:.06+Math.random()*.08,life:U,maxLife:U,kind:"rock"})}for(let I=0;I<10;I++){const U=Math.random()*Math.PI*2,Z=2.8+Math.random()*5.6,st=1.2+Math.random()*.8;this.pushDebris({x:n.x+(Math.random()-.5)*.2,y:n.y+(Math.random()-.5)*.2,vx:Math.cos(U)*Z,vy:Math.sin(U)*Z+1.5,angle:Math.random()*Math.PI*2,angularVel:(Math.random()-.5)*18,size:.045+Math.random()*.055,life:st,maxLife:st,kind:"ember"})}const at=Math.min(35,ft-t.numSpray);for(let I=0;I<at;I++){const U=Math.random()*Math.PI*2,Z=3.2+Math.random()*6;t.spawnSpray(n.x+Math.cos(U)*.15,n.y+Math.sin(U)*.15,Math.cos(U)*Z,Math.sin(U)*Z+1.8,.35+Math.random()*.45)}const nt=2.6,rt=nt*nt;for(let I=0;I<i;I++){const U=o[I]-n.x,Z=a[I]-n.y,st=U*U+Z*Z;if(st>=rt)continue;const O=Math.sqrt(st),X=1-O/nt,dt=O>1e-4?1/O:0,kt=O>1e-4?U*dt:0,mt=O>1e-4?Z*dt:1,vt=12*X;r[I]+=kt*vt,c[I]+=mt*vt+2.2*X,l[I]=Math.min(1,l[I]+X)}t.telemetry.mineDetonateCount=(t.telemetry.mineDetonateCount??0)+1,t.telemetry.wallBreakCount++;break}}return h}stepPortals(t,s,e){if(this.portals.length===0)return;const i=t.numParticles,o=t.px,a=t.py,r=t.vx,c=t.vy,l=t.foam;for(const d of this.portals){d.pulse*=Math.exp(-4*e);const u=d.radius*d.radius,h=d.radius*.65+.12,n=-d.outDirY,p=d.outDirX;let f=!1;for(let m=0;m<i;m++){const g=o[m]-d.inX,x=a[m]-d.inY;if(g*g+x*x>=u)continue;const y=(Math.random()-.5)*.16;let T=d.outX+d.outDirX*h+n*y,b=d.outY+d.outDirY*h+p*y;const M=s.sampleSDF(T,b);M.dist<ut&&(T+=M.nx*(ut-M.dist),b+=M.ny*(ut-M.dist));const w=Math.hypot(r[m],c[m]),k=Math.max(6.8,w*d.boost);o[m]=H(T,ut,K-ut),a[m]=H(b,ut,Q-ut),r[m]=d.outDirX*k+n*(Math.random()-.5)*.45,c[m]=d.outDirY*k+p*(Math.random()-.5)*.45,l[m]=Math.min(1,l[m]+.35),f=!0}for(const m of this.bodies){if((m.portalCooldown??0)>0)continue;const g=m.kind==="sphere"?m.w*.5:Math.min(m.w,m.h)*.5,x=d.radius+g*.35,y=m.x-d.inX,T=m.y-d.inY;if(y*y+T*T>=x*x)continue;const b=d.radius*.65+.14+g*.55;let M=d.outX+d.outDirX*b,w=d.outY+d.outDirY*b;const k=s.sampleSDF(M,w);k.dist<g&&(M+=k.nx*(g-k.dist),w+=k.ny*(g-k.dist));const C=Math.hypot(m.vx,m.vy),A=Math.max(6.2,C*d.boost);m.x=H(M,g,K-g),m.y=H(w,g,Q-g),m.vx=d.outDirX*A,m.vy=d.outDirY*A,m.portalCooldown=.65,f=!0}for(const m of this.mines){if(m.detonated||m.portalCooldown>0)continue;const g=d.radius+m.radius*.35,x=m.x-d.inX,y=m.y-d.inY;if(x*x+y*y>=g*g)continue;const T=d.radius*.65+.14+m.radius*.6;let b=d.outX+d.outDirX*T,M=d.outY+d.outDirY*T;const w=s.sampleSDF(b,M);w.dist<m.radius&&(b+=w.nx*(m.radius-w.dist),M+=w.ny*(m.radius-w.dist));const k=Math.hypot(m.vx,m.vy),C=Math.max(6.2,k*d.boost);m.x=H(b,m.radius,K-m.radius),m.y=H(M,m.radius,Q-m.radius),m.vx=d.outDirX*C,m.vy=d.outDirY*C,m.portalCooldown=.65,m.flash=.7,f=!0}if(f&&(d.pulse=1,t.telemetry.portalPulseCount=(t.telemetry.portalPulseCount??0)+1,t.numSpray<ft)){const m=d.outX+d.outDirX*h,g=d.outY+d.outDirY*h;t.spawnSpray(m,g,d.outDirX*5.2+n*(Math.random()-.5)*1.6,d.outDirY*5.2+p*(Math.random()-.5)*1.6,.3+Math.random()*.25)}}}stepCrackedWalls(t,s,e){if(this.crackedWalls.length===0)return!1;const i=t.numParticles,o=t.px,a=t.py,r=t.vx,c=t.vy,l=t.foam;let d=!1;for(const u of this.crackedWalls){if(u.broken)continue;u.stressGlow*=Math.exp(-2.8*e);const h=u.x+u.w*.5,n=u.w*.5+.16,p=u.y-.04,f=u.y+u.h+.04;let m=0,g=0,x=0;for(let w=0;w<i;w++){const k=o[w],C=a[w];if(Math.abs(k-h)<n&&C>=p&&C<=f){m++;const A=r[w],B=c[w];x+=A;const E=Math.hypot(A,B);if(E>1.7){const P=(k<h?A:-A)>0?1.15:.85;g+=(E-1.4)*E*.032*P}l[w]>.25&&(g+=l[w]*.12)}}const y=Math.max(0,t.queryPressureRect(u.x-.35,u.y,u.w+.7,u.h)),T=m>=14?m*.0125:0,M=y*.58+Math.max(0,T-.7)*2.8+g;if(M>u.impactThreshold?(u.hp-=(M-u.impactThreshold)*e*2.2,u.stressGlow=1):u.impactThreshold>0&&(u.stressGlow=Math.max(u.stressGlow,Math.min(.85,.35*M/u.impactThreshold))),u.hp<=0){u.hp=0,u.broken=!0,d=!0;const w=m>0?x/m:0;for(let C=0;C<26;C++){const A=1.8+Math.random()*1.4;this.pushDebris({x:u.x+Math.random()*u.w,y:u.y+Math.random()*u.h,vx:(Math.random()-.5)*6.5+w*.55,vy:.6+Math.random()*4.4,angle:Math.random()*Math.PI*2,angularVel:(Math.random()-.5)*14,size:.06+Math.random()*.08,life:A,maxLife:A,kind:"rock"})}const k=Math.min(18,ft-t.numSpray);for(let C=0;C<k;C++)t.spawnSpray(u.x+Math.random()*u.w,u.y+Math.random()*u.h,(Math.random()-.5)*5+w*.5,1+Math.random()*3.5,.3+Math.random()*.4);t.telemetry.wallBreakCount++,s.dirty=!0}}return d}ensureVentTouchBuffer(t){this.ventTouchIndices.length<t&&(this.ventTouchIndices=new Int32Array(t))}stepMagmaVents(t,s,e){if(t.telemetry.magmaSteamIntensity=0,this.magmaVents.length===0)return;let i=0;for(const o of this.magmaVents){if(o.quenched){o.steamPulse*=Math.exp(-3.5*e);continue}const a=o.x-.08,r=o.x+o.w+.08,c=o.y,l=o.y+o.h+.18,d=t.numParticles;this.ensureVentTouchBuffer(d);const u=t.px,h=t.py,n=t.temp;let p=0;for(let f=0;f<d;f++){const m=u[f],g=h[f];m>=a&&m<=r&&g>=c&&g<=l&&(this.ventTouchIndices[p++]=f,n[f]=Math.min(1,n[f]+1.8*e))}if(p>0){o.heat-=p*.18*e,o.steamPulse=Math.min(1,o.steamPulse+e*5.5);const f=Math.min(12,6+p*.3),g=(this.magmaBoilAccum.get(o.id)??.85)+f*e,x=Math.min(p,Math.floor(g),3);if(this.magmaBoilAccum.set(o.id,g-x),x>0){const T=p/x,b=p>10?3:2;let M=p;for(let w=x-1;w>=0;w--){let k=Math.floor(w*T);if(k>=M&&(k=M-1),k<0)break;M=k;const C=this.ventTouchIndices[k],A=u[C],B=Math.max(h[C],o.y+o.h*.55);for(let E=0;E<b;E++)t.numSteam<Tt&&t.spawnSteam(A+(Math.random()-.5)*.14,B+Math.random()*.1,(Math.random()-.5)*.9,2.6+Math.random()*1.6,1.8+Math.random()*.9);t.removeParticle(C)}}const y=Math.min(1,p/22);y>i&&(i=y)}else o.steamPulse*=Math.exp(-3.5*e),this.magmaBoilAccum.set(o.id,.85);if(o.heat=Math.min(o.maxHeat,o.heat+o.reheatRate*e),o.heat<=0){o.quenched=!0,o.heat=0,o.steamPulse=1,s.addObsidianRect(o.x,o.y,o.w,o.h+.18),s.rebuildSDFIfDirty();for(let f=0;f<22&&!(t.numSteam>=Tt);f++)t.spawnSteam(o.x+Math.random()*o.w,o.y+o.h*.55+Math.random()*.2,(Math.random()-.5)*2.4,2.4+Math.random()*2.8,1.7+Math.random()*1.1);for(let f=0;f<16;f++){const m=1.3+Math.random()*.9;this.pushDebris({x:o.x+Math.random()*o.w,y:o.y+o.h*.5+Math.random()*.25,vx:(Math.random()-.5)*5.2,vy:2.2+Math.random()*4.5,angle:Math.random()*Math.PI*2,angularVel:(Math.random()-.5)*14,size:.045+Math.random()*.055,life:m,maxLife:m,kind:"ember"})}t.telemetry.magmaQuenchCount++}}t.telemetry.magmaSteamIntensity=i}stepCisternsAndGoals(t,s){const e=1-Math.exp(-6*s);for(const i of this.cisterns){const o=t.countParticlesInRect(i.x,i.y,i.w,i.h);i.particleCount=o;const a=i.thresholdParticles>0?H(o/i.thresholdParticles,0,1):1;i.fillRatio=H(i.fillRatio+(a-i.fillRatio)*e,0,1),i.activated?i.fillRatio<.62&&(i.activated=!1):i.fillRatio>=.85&&(i.activated=!0)}for(const i of this.bodies)i.inGoal=!1;for(const i of this.goals){let o=!1;const a=i.x+i.w*.5,r=i.y+i.h*.5;for(const c of this.bodies)if(!(i.bodyId&&c.id!==i.bodyId)&&c.x>=i.x&&c.x<=i.x+i.w&&c.y>=i.y&&c.y<=i.y+i.h){o=!0,c.inGoal=!0,c.vy+=Math.abs(Mt)*.88*s,c.vx+=(a-c.x)*7.5*s,c.vy+=(r-c.y)*7.5*s;const l=Math.exp(-5.5*s);c.vx*=l,c.vy*=l,c.angularVel*=l}i.fulfilled=o,o?i.pulse=Math.min(1,i.pulse+s*3.5):i.pulse*=Math.exp(-3*s)}}pushDebris(t){if(this.debris.length<ve){this.debris.push(t);return}let s=0,e=this.debris[0].life;for(let i=1;i<this.debris.length;i++)this.debris[i].life<e&&(e=this.debris[i].life,s=i);this.debris[s]=t}}const pt=F*q,pe=Math.max(F,q),Ee=1e6;function Ts(S,t,s){switch(S.kind){case"rect":return t>=S.x&&t<=S.x+S.w&&s>=S.y&&s<=S.y+S.h;case"circle":{const e=t-S.x,i=s-S.y;return e*e+i*i<=S.r*S.r}case"capsule":{const e=S.x2-S.x1,i=S.y2-S.y1,o=e*e+i*i;let a=o>1e-12?((t-S.x1)*e+(s-S.y1)*i)/o:0;a<0?a=0:a>1&&(a=1);const r=S.x1+a*e,c=S.y1+a*i,l=t-r,d=s-c;return l*l+d*d<=S.r*S.r}case"poly":{const e=S.points,i=e.length;if(i<3)return!1;let o=!1;for(let a=0,r=i-1;a<i;r=a++){const c=e[a][0],l=e[a][1],d=e[r][0],u=e[r][1];l>s!=u>s&&t<(d-c)*(s-l)/(u-l)+c&&(o=!o)}return o}}}function Ms(S){switch(S.kind){case"rect":return{minX:S.x,minY:S.y,maxX:S.x+S.w,maxY:S.y+S.h};case"circle":return{minX:S.x-S.r,minY:S.y-S.r,maxX:S.x+S.r,maxY:S.y+S.r};case"capsule":return{minX:Math.min(S.x1,S.x2)-S.r,minY:Math.min(S.y1,S.y2)-S.r,maxX:Math.max(S.x1,S.x2)+S.r,maxY:Math.max(S.y1,S.y2)+S.r};case"poly":{const t=S.points;if(t.length===0)return{minX:0,minY:0,maxX:-1,maxY:-1};let s=1/0,e=1/0,i=-1/0,o=-1/0;for(let a=0;a<t.length;a++){const r=t[a][0],c=t[a][1];r<s&&(s=r),r>i&&(i=r),c<e&&(e=c),c>o&&(o=c)}return{minX:s,minY:e,maxX:i,maxY:o}}}}class ws{constructor(){v(this,"solidKind",new Uint8Array(pt));v(this,"staticRock",new Uint8Array(pt));v(this,"iceMask",new Uint8Array(pt));v(this,"obsidianMask",new Uint8Array(pt));v(this,"dynamicMask",new Uint8Array(pt));v(this,"sdf",new Float32Array(pt));v(this,"sdfNormX",new Float32Array(pt));v(this,"sdfNormY",new Float32Array(pt));v(this,"frostCount",0);v(this,"version",0);v(this,"dirty",!1);v(this,"distToSolid",new Float32Array(pt));v(this,"distToOpen",new Float32Array(pt));v(this,"edtF",new Float64Array(pe));v(this,"edtV",new Int32Array(pe));v(this,"edtZ",new Float64Array(pe+1));this.loadLevel([]),this.version=0}loadLevel(t,s,e){this.staticRock.fill(0),this.iceMask.fill(0),this.obsidianMask.fill(0),this.dynamicMask.fill(0);for(let o=0;o<t.length;o++)this.rasterizeShape(t[o],1);if(s)for(let o=0;o<s.length;o++)this.rasterizeShape(s[o],0);for(let o=0;o<q;o++){const a=o*F;this.staticRock[a]=1,this.staticRock[a+F-1]=1}const i=(q-1)*F;for(let o=0;o<F;o++)this.staticRock[i+o]=1;for(let o=1;o<F-1;o++){const a=(o+.5)*$;let r=!1;if(e)for(let c=0;c<e.length;c++){const l=e[c];if(l.y<=$&&l.y+l.h>=0&&a>=l.x&&a<=l.x+l.w){r=!0;break}}r||(this.staticRock[o]=1)}this.frostCount=0,this.dirty=!0,this.rebuildSDFIfDirty()}rasterizeShape(t,s){const{minX:e,minY:i,maxX:o,maxY:a}=Ms(t);if(o<e||a<i)return;const r=Math.max(0,Math.floor(e*G)),c=Math.min(F-1,Math.floor(o*G)),l=Math.max(0,Math.floor(i*G)),d=Math.min(q-1,Math.floor(a*G));for(let u=l;u<=d;u++){const h=(u+.5)*$,n=u*F;for(let p=r;p<=c;p++){const f=(p+.5)*$;Ts(t,f,h)&&(this.staticRock[n+p]=s)}}}clearDynamicSolids(){let t=!1;for(let s=0;s<pt;s++)this.dynamicMask[s]!==0&&(this.dynamicMask[s]=0,t=!0);t&&(this.dirty=!0)}stampDynamicRect(t,s,e,i,o){if(e<=0||i<=0)return;const a=t+e,r=s+i,c=Math.max(0,Math.floor(t*G)),l=Math.min(F-1,Math.floor(a*G)),d=Math.max(0,Math.floor(s*G)),u=Math.min(q-1,Math.floor(r*G));let h=!1;for(let n=d;n<=u;n++){const p=(n+.5)*$;if(p<s||p>r)continue;const f=n*F;for(let m=c;m<=l;m++){const g=(m+.5)*$;if(g<t||g>a)continue;const x=f+m;this.dynamicMask[x]!==o&&(this.dynamicMask[x]=o,h=!0)}}h&&(this.dirty=!0)}addObsidianRect(t,s,e,i){if(e<=0||i<=0)return;const o=t+e,a=s+i,r=Math.max(0,Math.floor(t*G)),c=Math.min(F-1,Math.floor(o*G)),l=Math.max(0,Math.floor(s*G)),d=Math.min(q-1,Math.floor(a*G));let u=!1;for(let h=l;h<=d;h++){const n=(h+.5)*$;if(n<s||n>a)continue;const p=h*F;for(let f=r;f<=c;f++){const m=(f+.5)*$;if(m<t||m>o)continue;const g=p+f;this.obsidianMask[g]!==1&&(this.obsidianMask[g]=1,u=!0)}}u&&(this.dirty=!0)}paintIce(t,s,e,i){const o=[];if(e<=0||this.frostCount>=i)return{added:0,displacedCells:o};const a=e*e,r=Math.max(0,Math.floor((t-e)*G)),c=Math.min(F-1,Math.floor((t+e)*G)),l=Math.max(0,Math.floor((s-e)*G)),d=Math.min(q-1,Math.floor((s+e)*G));let u=0;for(let h=l;h<=d&&!(this.frostCount>=i);h++){const n=(h+.5)*$-s,p=n*n,f=h*F;for(let m=r;m<=c&&!(this.frostCount>=i);m++){const g=(m+.5)*$-t;if(g*g+p>a)continue;const x=f+m;this.staticRock[x]===0&&this.obsidianMask[x]===0&&this.dynamicMask[x]===0&&this.iceMask[x]===0&&(this.iceMask[x]=1,this.frostCount++,u++,o.push(x))}}return u>0&&(this.dirty=!0),{added:u,displacedCells:o}}eraseIce(t,s,e){if(e<=0||this.frostCount<=0)return 0;const i=e*e,o=Math.max(0,Math.floor((t-e)*G)),a=Math.min(F-1,Math.floor((t+e)*G)),r=Math.max(0,Math.floor((s-e)*G)),c=Math.min(q-1,Math.floor((s+e)*G));let l=0;for(let d=r;d<=c;d++){const u=(d+.5)*$-s,h=u*u,n=d*F;for(let p=o;p<=a;p++){const f=(p+.5)*$-t;if(f*f+h>i)continue;const m=n+p;this.iceMask[m]!==0&&(this.iceMask[m]=0,this.frostCount>0&&this.frostCount--,l++)}}return l>0&&(this.dirty=!0),l}shatterAllIce(){const t=[];if(this.frostCount===0){let s=!1;for(let e=0;e<pt;e++)if(this.iceMask[e]!==0){s=!0;break}if(!s)return t}for(let s=0;s<q;s++){const e=(s+.5)*$,i=s*F;for(let o=0;o<F;o++){const a=i+o;this.iceMask[a]!==0&&(this.iceMask[a]=0,t.push({x:(o+.5)*$,y:e}))}}return this.frostCount=0,t.length>0&&(this.dirty=!0),t}paintRock(t,s,e,i){if(e<=0)return;const o=e*e,a=Math.max(1,Math.floor((t-e)*G)),r=Math.min(F-2,Math.floor((t+e)*G)),c=Math.max(1,Math.floor((s-e)*G)),l=Math.min(q-2,Math.floor((s+e)*G));let d=!1;for(let u=c;u<=l;u++){const h=(u+.5)*$-s,n=h*h,p=u*F;for(let f=a;f<=r;f++){const m=(f+.5)*$-t;if(m*m+n>o)continue;const g=p+f;i?this.staticRock[g]!==0&&(this.staticRock[g]=0,d=!0):(this.staticRock[g]===0&&(this.staticRock[g]=1,d=!0),this.iceMask[g]!==0&&(this.iceMask[g]=0,this.frostCount>0&&this.frostCount--,d=!0))}}d&&(this.dirty=!0)}rebuildSDFIfDirty(){if(!this.dirty)return!1;const t=this.solidKind,s=this.staticRock,e=this.obsidianMask,i=this.dynamicMask,o=this.iceMask,a=this.distToSolid,r=this.distToOpen;for(let h=0;h<pt;h++){let n=ht.NONE;s[h]!==0?n=ht.ROCK:e[h]!==0?n=ht.OBSIDIAN:i[h]!==0?n=i[h]:o[h]!==0&&(n=ht.ICE),t[h]=n,n!==ht.NONE?(a[h]=0,r[h]=Ee):(a[h]=Ee,r[h]=0)}this.compute2DEDT(a),this.compute2DEDT(r);const c=this.sdf,l=.5*$;for(let h=0;h<pt;h++){const n=a[h];if(n>0){const f=Math.sqrt(n)*$-l;c[h]=f>0?f:0}else{const f=Math.sqrt(r[h])*$-l;c[h]=-(f>0?f:0)}}const d=this.sdfNormX,u=this.sdfNormY;for(let h=0;h<q;h++){const n=h>0?h-1:0,p=h<q-1?h+1:q-1,f=p-n,m=h*F,g=n*F,x=p*F;for(let y=0;y<F;y++){const T=y>0?y-1:0,b=y<F-1?y+1:F-1,M=b-T,w=m+y,k=(c[m+b]-c[m+T])/M,C=(c[x+y]-c[g+y])/f,A=Math.sqrt(k*k+C*C);if(A>1e-6){const B=1/A;d[w]=k*B,u[w]=C*B}else d[w]=0,u[w]=1}}return this.version++,this.dirty=!1,!0}compute2DEDT(t){const s=this.edtF,e=this.edtV,i=this.edtZ;for(let o=0;o<q;o++){const a=o*F;for(let c=0;c<F;c++)s[c]=t[a+c];let r=0;e[0]=0,i[0]=-1/0,i[1]=1/0;for(let c=1;c<F;c++){const l=s[c]+c*c;let d=e[r],u=(l-(s[d]+d*d))/(2*(c-d));for(;u<=i[r];)r--,d=e[r],u=(l-(s[d]+d*d))/(2*(c-d));r++,e[r]=c,i[r]=u,i[r+1]=1/0}r=0;for(let c=0;c<F;c++){for(;i[r+1]<c;)r++;const l=e[r],d=c-l;t[a+c]=d*d+s[l]}}for(let o=0;o<F;o++){for(let r=0;r<q;r++)s[r]=t[r*F+o];let a=0;e[0]=0,i[0]=-1/0,i[1]=1/0;for(let r=1;r<q;r++){const c=s[r]+r*r;let l=e[a],d=(c-(s[l]+l*l))/(2*(r-l));for(;d<=i[a];)a--,l=e[a],d=(c-(s[l]+l*l))/(2*(r-l));a++,e[a]=r,i[a]=d,i[a+1]=1/0}a=0;for(let r=0;r<q;r++){for(;i[a+1]<r;)a++;const c=e[a],l=r-c;t[r*F+o]=l*l+s[c]}}}isSolidCell(t,s){if(t<0||t>=F||s<0||s>=q)return!0;const e=s*F+t;return this.dirty?this.staticRock[e]!==0||this.obsidianMask[e]!==0||this.dynamicMask[e]!==0||this.iceMask[e]!==0:this.solidKind[e]!==ht.NONE}getKindAtCell(t,s){if(t<0||t>=F||s<0||s>=q)return ht.ROCK;const e=s*F+t;return this.dirty?this.staticRock[e]!==0?ht.ROCK:this.obsidianMask[e]!==0?ht.OBSIDIAN:this.dynamicMask[e]!==0?this.dynamicMask[e]:this.iceMask[e]!==0?ht.ICE:ht.NONE:this.solidKind[e]}sampleSDF(t,s){const e=t<0?0:t>K-1e-4?K-1e-4:t,i=s<0?0:s>Q-1e-4?Q-1e-4:s;let o=e*G-.5,a=i*G-.5;o<0?o=0:o>F-1.0001&&(o=F-1.0001),a<0?a=0:a>q-1.0001&&(a=q-1.0001);const r=Math.floor(o),c=Math.floor(a),l=o-r,d=a-c,u=1-l,h=1-d,n=u*h,p=l*h,f=u*d,m=l*d,g=c*F+r,x=g+1,y=g+F,T=y+1,b=this.sdf,M=this.sdfNormX,w=this.sdfNormY,k=n*b[g]+p*b[x]+f*b[y]+m*b[T];let C=n*M[g]+p*M[x]+f*M[y]+m*M[T],A=n*w[g]+p*w[x]+f*w[y]+m*w[T];const B=Math.sqrt(C*C+A*A);if(B>1e-6){const E=1/B;C*=E,A*=E}else C=0,A=1;return{dist:k,nx:C,ny:A}}}const ks=66,fe=7,se="http://www.w3.org/2000/svg";function lt(S,t="0 0 24 24",s="aq-icon"){const e=document.createElementNS(se,"svg");e.setAttribute("viewBox",t),e.setAttribute("fill","none"),e.setAttribute("stroke","currentColor"),e.setAttribute("stroke-width","1.85"),e.setAttribute("stroke-linecap","round"),e.setAttribute("stroke-linejoin","round"),e.setAttribute("aria-hidden","true"),e.setAttribute("class",s);for(const i of S){const o=document.createElementNS(se,"path");o.setAttribute("d",i),e.appendChild(o)}return e}function De(S="aq-star-svg"){const t=document.createElementNS(se,"svg");t.setAttribute("viewBox","0 0 24 24"),t.setAttribute("aria-hidden","true"),t.setAttribute("class",S);const s=document.createElementNS(se,"path");return s.setAttribute("d","M12 2.4l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.3l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95L12 2.4z"),t.appendChild(s),t}function me(S){const t=Math.max(0,Math.floor(S)),s=Math.floor(t/60),e=t%60;return`${String(s).padStart(2,"0")}:${String(e).padStart(2,"0")}`}function Ve(S){const t=Math.max(0,S),s=Math.floor(t/60),e=t-s*60,i=Math.floor(e),o=Math.min(9,Math.floor((e-i)*10));return`${String(s).padStart(2,"0")}:${String(i).padStart(2,"0")}.${o}`}function Cs(S){return Math.max(0,Math.round(S)).toLocaleString("de-DE")}function Ss(S,t,s){if(s&&s.levelIndex===t&&S[s.levelId])return S[s.levelId];const e=[String(t),`lvl${t}`,`lvl_${t}`,`lvl-${t}`,`lvl.${t}`,`level${t}`,`level_${t}`,`level-${t}`,`ch${t}`,`chapter${t}`,`chapter-${t}`];for(const o of e)if(S[o])return S[o];const i=new RegExp(`(?:^|[^\\d])${t}$`);for(const[o,a]of Object.entries(S))if(i.test(o)&&!o.includes("sb")&&!o.includes("demo"))return a}function As(S){for(const[t,s]of Object.entries(S))if(!(t.includes("sb")||t.includes("demo"))&&(s.stars>0||s.bestTime!==null))return!0;return!1}class Rs{constructor(t,s){v(this,"root");v(this,"callbacks");v(this,"chapterModalOpen",!1);v(this,"hintCollapsed",!1);v(this,"tutorialDismissed",!1);v(this,"lastNumericUpdateMs",0);v(this,"lastScreen",null);v(this,"lastLevelIndex",-1);v(this,"lastIsSandbox",null);v(this,"lastLang",null);v(this,"lastObjectiveSig","");v(this,"lastSnapshot",null);v(this,"titleScreen");v(this,"titleMuteBtn");v(this,"titleMuteOnIcon");v(this,"titleMuteOffIcon");v(this,"titleLangBtn");v(this,"titleLangDeSpan");v(this,"titleLangEnSpan");v(this,"titleSubtitleEl");v(this,"titleMainEl");v(this,"titleTaglineEl");v(this,"startCampaignBtn");v(this,"startCampaignLabel");v(this,"openSandboxBtn");v(this,"openSandboxLabel");v(this,"openChaptersBtn");v(this,"openChaptersLabel");v(this,"demoBadgeEl");v(this,"demoBadgeTextEl");v(this,"playingHud");v(this,"levelBadgePill");v(this,"levelTitleEl");v(this,"levelSubEl");v(this,"objectivesList");v(this,"objectiveRows",[]);v(this,"hintCard");v(this,"hintToggleBtn");v(this,"hintLabelEl");v(this,"hintBodyEl");v(this,"timerValueEl");v(this,"parValueEl");v(this,"frostBarFill");v(this,"frostBarTrack");v(this,"frostValueEl");v(this,"waterValueEl");v(this,"fpsValueEl");v(this,"slowMoBtn");v(this,"slowMoLabelEl");v(this,"restartBtn");v(this,"muteBtn");v(this,"muteOnIcon");v(this,"muteOffIcon");v(this,"qualityBtn");v(this,"qualityLabelEl");v(this,"langBtn");v(this,"langDeSpan");v(this,"langEnSpan");v(this,"menuBtn");v(this,"menuLabelEl");v(this,"slowMoBanner");v(this,"slowMoBannerText");v(this,"tutorialPill");v(this,"tutorialText");v(this,"sandboxRow");v(this,"coreDockRow");v(this,"toolButtons",[]);v(this,"sandboxButtons",[]);v(this,"shatterBtn");v(this,"shatterLabelEl");v(this,"chapterBackdrop");v(this,"chapterTitleEl");v(this,"chapterCloseBtn");v(this,"chapterCards",[]);v(this,"victoryBackdrop");v(this,"victoryStars",[]);v(this,"victoryBannerEl");v(this,"victoryTitleEl");v(this,"victorySubEl");v(this,"victoryTimeLabel");v(this,"victoryTimeVal");v(this,"victoryParLabel");v(this,"victoryParVal");v(this,"victoryNextBtn");v(this,"victoryNextLabel");v(this,"victoryReplayBtn");v(this,"victoryReplayLabel");v(this,"victoryChaptersBtn");v(this,"victoryChaptersLabel");v(this,"handleCaptureEscape",t=>{t.code==="Escape"&&this.chapterModalOpen&&(t.preventDefault(),t.stopImmediatePropagation(),this.setChapterModalOpen(!1))});v(this,"handleFirstStageInteract",t=>{var e;if(((e=this.lastSnapshot)==null?void 0:e.screen)!=="playing")return;const s=t.target;s&&s.closest("#stage")&&(this.tutorialDismissed=!0,this.tutorialPill.hidden=!0)});if(s!==void 0)this.root=t,this.callbacks=s;else{const I=document.getElementById("ui-root");if(!I)throw new Error("HUDController: #ui-root element not found");this.root=I,this.callbacks=t}this.root.textContent="",this.root.classList.add("aq-ui-root"),this.titleScreen=this.el("div","aq-title-screen");const e=this.el("div","aq-title-topbar");this.titleMuteBtn=this.makeButton("aq-icon-btn aq-glass-pill",()=>this.callbacks.onToggleMute()),this.titleMuteOnIcon=lt(["M11 5L6 9H2v6h4l5 4V5z","M15.5 8.5a5 5 0 0 1 0 7","M18.8 5.5a9.5 9.5 0 0 1 0 13"]),this.titleMuteOffIcon=lt(["M11 5L6 9H2v6h4l5 4V5z","M22 9l-6 6","M16 9l6 6"]),this.titleMuteOffIcon.style.display="none",this.titleMuteBtn.append(this.titleMuteOnIcon,this.titleMuteOffIcon),this.titleLangBtn=this.makeButton("aq-lang-pill aq-glass-pill",()=>this.callbacks.onToggleLang()),this.titleLangDeSpan=this.el("span","aq-lang-opt is-active","DE");const i=this.el("span","aq-lang-sep","|");this.titleLangEnSpan=this.el("span","aq-lang-opt","EN"),this.titleLangBtn.append(this.titleLangDeSpan,i,this.titleLangEnSpan),e.append(this.titleMuteBtn,this.titleLangBtn);const o=this.el("div","aq-title-hero");this.titleSubtitleEl=this.el("div","aq-title-subtitle"),this.titleMainEl=this.el("h1","aq-title-logo","AQUALITH"),this.titleTaglineEl=this.el("p","aq-title-tagline");const a=this.el("div","aq-title-actions");this.startCampaignBtn=this.makeButton("aq-btn aq-btn-primary",()=>this.callbacks.onStartCampaign()),this.startCampaignBtn.appendChild(lt(["M6 4l14 8-14 8V4z"])),this.startCampaignLabel=this.el("span"),this.startCampaignBtn.appendChild(this.startCampaignLabel),this.openSandboxBtn=this.makeButton("aq-btn aq-btn-brass",()=>this.callbacks.onOpenSandbox()),this.openSandboxBtn.appendChild(lt(["M3 16c2-2 4-2 6 0s4 2 6 0 4-2 6 0","M3 11c2-2 4-2 6 0s4 2 6 0 4-2 6 0"])),this.openSandboxLabel=this.el("span"),this.openSandboxBtn.appendChild(this.openSandboxLabel),this.openChaptersBtn=this.makeButton("aq-btn aq-btn-glass",()=>this.setChapterModalOpen(!0)),this.openChaptersBtn.appendChild(lt(["M4 4h7v7H4z","M13 4h7v7h-7z","M4 13h7v7H4z","M13 13h7v7h-7z"])),this.openChaptersLabel=this.el("span"),this.openChaptersBtn.appendChild(this.openChaptersLabel),a.append(this.startCampaignBtn,this.openSandboxBtn,this.openChaptersBtn),o.append(this.titleSubtitleEl,this.titleMainEl,this.titleTaglineEl,a),this.demoBadgeEl=this.el("div","aq-demo-badge aq-glass-pill");const r=this.el("span","aq-live-dot");this.demoBadgeTextEl=this.el("span"),this.demoBadgeEl.append(r,this.demoBadgeTextEl),this.titleScreen.append(e,o,this.demoBadgeEl),this.playingHud=this.el("div","aq-playing-hud"),this.playingHud.hidden=!0;const c=this.el("div","aq-topleft-col"),l=this.el("section","aq-glass-panel aq-objectives-panel"),d=this.el("div","aq-level-header");this.levelBadgePill=this.el("span","aq-chapter-badge"),this.levelTitleEl=this.el("div","aq-level-title"),this.levelSubEl=this.el("div","aq-level-sub");const u=this.el("div","aq-level-title-row");u.append(this.levelBadgePill,this.levelTitleEl),d.append(u,this.levelSubEl),this.objectivesList=this.el("ul","aq-objectives-list"),l.append(d,this.objectivesList),this.hintCard=this.el("div","aq-glass-panel aq-hint-card"),this.hintToggleBtn=this.makeButton("aq-hint-toggle",()=>{this.hintCollapsed=!this.hintCollapsed,this.hintCard.classList.toggle("is-collapsed",this.hintCollapsed),this.hintToggleBtn.setAttribute("aria-expanded",String(!this.hintCollapsed))}),this.hintToggleBtn.setAttribute("aria-expanded","true");const h=this.el("span","aq-hint-spark");this.hintLabelEl=this.el("span","aq-hint-label");const n=lt(["M6 9l6 6 6-6"],"0 0 24 24","aq-icon aq-hint-chevron");this.hintToggleBtn.append(h,this.hintLabelEl,n),this.hintBodyEl=this.el("p","aq-hint-body"),this.hintCard.append(this.hintToggleBtn,this.hintBodyEl),c.append(l,this.hintCard);const p=this.el("section","aq-glass-panel aq-topright-panel"),f=this.el("div","aq-telemetry-row"),m=this.el("div","aq-stat-chip aq-stat-timer");m.appendChild(lt(["M12 6v6l4 2","M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"])),this.timerValueEl=this.el("span","aq-mono","00:00"),this.parValueEl=this.el("span","aq-stat-par aq-mono"),m.append(this.timerValueEl,this.parValueEl);const g=this.el("div","aq-stat-chip aq-stat-frost");g.appendChild(lt(["M12 2v20","M4.93 4.93l14.14 14.14","M19.07 4.93L4.93 19.07","M2 12h20"])),this.frostBarTrack=this.el("div","aq-frost-track"),this.frostBarFill=this.el("div","aq-frost-fill"),this.frostBarTrack.appendChild(this.frostBarFill),this.frostValueEl=this.el("span","aq-mono aq-frost-num","0/0"),g.append(this.frostBarTrack,this.frostValueEl);const x=this.el("div","aq-stat-chip aq-stat-water");x.appendChild(lt(["M12 2.5C8 8 5.5 11.4 5.5 14.5a6.5 6.5 0 0 0 13 0c0-3.1-2.5-6.5-6.5-12z"])),this.waterValueEl=this.el("span","aq-mono","0"),this.fpsValueEl=this.el("span","aq-fps-tag aq-mono",""),x.append(this.waterValueEl,this.fpsValueEl),f.append(m,g,x);const y=this.el("div","aq-controls-row");this.slowMoBtn=this.makeButton("aq-ctrl-btn aq-slowmo-btn",()=>this.callbacks.onToggleSlowMo()),this.slowMoBtn.appendChild(lt(["M6 2h12","M6 22h12","M7 2c0 5 5 6 5 10s-5 5-5 10","M17 2c0 5-5 6-5 10s5 5 5 10"])),this.slowMoLabelEl=this.el("span","aq-ctrl-label"),this.slowMoBtn.appendChild(this.slowMoLabelEl),this.restartBtn=this.makeButton("aq-ctrl-btn aq-ctrl-icon-only",()=>this.callbacks.onRestart()),this.restartBtn.appendChild(lt(["M3 12a9 9 0 1 0 3-6.7L3 8","M3 3v5h5"])),this.muteBtn=this.makeButton("aq-ctrl-btn aq-ctrl-icon-only",()=>this.callbacks.onToggleMute()),this.muteOnIcon=lt(["M11 5L6 9H2v6h4l5 4V5z","M15.5 8.5a5 5 0 0 1 0 7","M18.8 5.5a9.5 9.5 0 0 1 0 13"]),this.muteOffIcon=lt(["M11 5L6 9H2v6h4l5 4V5z","M22 9l-6 6","M16 9l6 6"]),this.muteOffIcon.style.display="none",this.muteBtn.append(this.muteOnIcon,this.muteOffIcon),this.qualityBtn=this.makeButton("aq-ctrl-btn",()=>this.callbacks.onToggleQuality()),this.qualityLabelEl=this.el("span","aq-ctrl-label"),this.qualityBtn.appendChild(this.qualityLabelEl),this.langBtn=this.makeButton("aq-ctrl-btn aq-lang-compact",()=>this.callbacks.onToggleLang()),this.langDeSpan=this.el("span","aq-lang-opt is-active","DE");const T=this.el("span","aq-lang-sep","/");this.langEnSpan=this.el("span","aq-lang-opt","EN"),this.langBtn.append(this.langDeSpan,T,this.langEnSpan),this.menuBtn=this.makeButton("aq-ctrl-btn aq-ctrl-menu",()=>this.callbacks.onOpenMenu()),this.menuBtn.appendChild(lt(["M4 7h16","M4 12h16","M4 17h16"])),this.menuLabelEl=this.el("span","aq-ctrl-label"),this.menuBtn.appendChild(this.menuLabelEl),y.append(this.slowMoBtn,this.restartBtn,this.muteBtn,this.qualityBtn,this.langBtn,this.menuBtn),p.append(f,y),this.slowMoBanner=this.el("div","aq-slowmo-banner aq-glass-pill"),this.slowMoBanner.hidden=!0;const b=this.el("span","aq-slowmo-dot");this.slowMoBannerText=this.el("span"),this.slowMoBanner.append(b,this.slowMoBannerText),this.tutorialPill=this.el("div","aq-tutorial-pill aq-glass-pill"),this.tutorialPill.hidden=!0,this.tutorialPill.appendChild(lt(["M5 12h14","M13 6l6 6-6 6"])),this.tutorialText=this.el("span"),this.tutorialPill.appendChild(this.tutorialText);const M=this.el("div","aq-dock-container");this.sandboxRow=this.el("div","aq-glass-panel aq-sandbox-bar"),this.sandboxRow.hidden=!0;const w=[{tool:"pour",hotkey:"4",labelKey:"toolPour",descKey:"toolPourDesc",icon:["M12 2.5C8 8 5.5 11.4 5.5 14.5a6.5 6.5 0 0 0 13 0c0-3.1-2.5-6.5-6.5-12z"]},{tool:"drain",hotkey:"5",labelKey:"toolDrain",descKey:"toolDrainDesc",icon:["M4 5h16l-6 7v6l-4 2v-8L4 5z"]},{tool:"rock",hotkey:"6",labelKey:"toolRock",descKey:"toolRockDesc",icon:["M3 19l5-10 4 4 4-8 5 14H3z"]}];for(const I of w){const U=this.createToolButton(I);this.toolButtons.push(U),this.sandboxRow.appendChild(U.button)}this.sandboxRow.appendChild(this.el("span","aq-dock-divider"));const k=[{action:"tsunami",labelKey:"sbTsunami",variantClass:"aq-sb-tsunami"},{action:"toggleSpouts",labelKey:"sbSpouts",hasDot:!0},{action:"addTurbine",labelKey:"sbTurbine"},{action:"addArk",labelKey:"sbArk"},{action:"addMagma",labelKey:"sbMagma",variantClass:"aq-sb-magma"},{action:"addWall",labelKey:"sbWall"},{action:"addMine",labelKey:"sbMine",variantClass:"aq-sb-mine"},{action:"addSeesaw",labelKey:"sbSeesaw"},{action:"clearWater",labelKey:"sbClearWater",variantClass:"aq-sb-clear"}];for(const I of k){const U=this.makeButton(`aq-sb-pill ${I.variantClass??""}`.trim(),()=>this.callbacks.onSandboxAction(I.action));let Z;I.hasDot&&(Z=this.el("span","aq-spout-dot"),U.appendChild(Z));const st=this.el("span");U.appendChild(st),this.sandboxButtons.push({action:I.action,button:U,labelEl:st,statusDot:Z,labelKey:I.labelKey}),this.sandboxRow.appendChild(U)}this.coreDockRow=this.el("div","aq-glass-panel aq-tool-dock");const C=[{tool:"surge",hotkey:"1",labelKey:"toolSurge",descKey:"toolSurgeDesc",icon:["M3 12c2.5-3 5.5-3 8 0s5.5 3 8 0","M4 7c2.5-2.5 5-2.5 7.5 0","M5 17c2.5 2.5 5.5 2.5 8 0s4.5-2 6 0"]},{tool:"ice",hotkey:"2",labelKey:"toolIce",descKey:"toolIceDesc",icon:["M12 2l7 6-3 14H8L5 8l7-6z","M12 2v20","M5 8h14"]},{tool:"vortex",hotkey:"3",labelKey:"toolVortex",descKey:"toolVortexDesc",icon:["M12 12m-2 0a2 2 0 1 0 4 0","M12 12a5 5 0 0 1-5-5c0-3 3.5-5 7-4a8 8 0 0 1 6 8c0 5-4 9-9 9-4 0-7-2.5-8-6"]}];for(const I of C){const U=this.createToolButton(I);this.toolButtons.push(U),this.coreDockRow.appendChild(U.button)}this.coreDockRow.appendChild(this.el("span","aq-dock-divider")),this.shatterBtn=this.makeButton("aq-tool-btn aq-shatter-btn",()=>this.callbacks.onShatterIce());const A=this.el("span","aq-hotkey","Space"),B=lt(["M12 2l3 7 7-2-5 6 4 7-9-3-6 5 1-8-6-4 7-2 4-6z"]);this.shatterLabelEl=this.el("span","aq-tool-label"),this.shatterBtn.append(A,B,this.shatterLabelEl),this.coreDockRow.appendChild(this.shatterBtn),M.append(this.tutorialPill,this.sandboxRow,this.coreDockRow),this.playingHud.append(c,p,this.slowMoBanner,M),this.chapterBackdrop=this.el("div","aq-modal-backdrop aq-chapter-backdrop"),this.chapterBackdrop.hidden=!0,this.chapterBackdrop.addEventListener("click",I=>{I.target===this.chapterBackdrop&&this.setChapterModalOpen(!1)});const E=this.el("div","aq-glass-panel aq-modal-card aq-chapter-modal"),L=this.el("div","aq-modal-header");this.chapterTitleEl=this.el("h2","aq-modal-title"),this.chapterCloseBtn=this.makeButton("aq-icon-btn aq-modal-close",()=>this.setChapterModalOpen(!1)),this.chapterCloseBtn.appendChild(lt(["M18 6L6 18","M6 6l12 12"])),L.append(this.chapterTitleEl,this.chapterCloseBtn);const P=this.el("div","aq-chapter-grid");for(let I=1;I<=fe;I++){const U=this.makeButton("aq-chapter-card",()=>{this.setChapterModalOpen(!1),this.callbacks.onSelectLevel(I)}),Z=this.el("div","aq-chapter-card-top"),st=this.el("span","aq-chapter-num"),O=this.el("div","aq-chapter-stars"),X=[];for(let vt=0;vt<3;vt++){const St=De("aq-mini-star");X.push(St),O.appendChild(St)}Z.append(st,O);const dt=this.el("div","aq-chapter-card-title"),kt=this.el("div","aq-chapter-card-sub"),mt=this.el("div","aq-chapter-card-meta aq-mono");U.append(Z,dt,kt,mt),this.chapterCards.push({chapterIndex:I,button:U,badgeEl:st,starsWrap:O,starEls:X,titleEl:dt,subEl:kt,metaEl:mt}),P.appendChild(U)}const D=this.makeButton("aq-chapter-card aq-chapter-sandbox",()=>{this.setChapterModalOpen(!1),this.callbacks.onOpenSandbox()}),R=this.el("div","aq-chapter-card-top"),V=this.el("span","aq-chapter-num aq-sandbox-num","SANDBOX"),W=this.el("div","aq-chapter-stars");W.appendChild(lt(["M3 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0"])),R.append(V,W);const N=this.el("div","aq-chapter-card-title"),_=this.el("div","aq-chapter-card-sub"),Y=this.el("div","aq-chapter-card-meta","∞");D.append(R,N,_,Y),this.chapterCards.push({chapterIndex:"sandbox",button:D,badgeEl:V,starsWrap:W,starEls:[],titleEl:N,subEl:_,metaEl:Y}),P.appendChild(D),E.append(L,P),this.chapterBackdrop.appendChild(E),this.victoryBackdrop=this.el("div","aq-modal-backdrop aq-victory-backdrop"),this.victoryBackdrop.hidden=!0;const J=this.el("div","aq-glass-panel aq-modal-card aq-victory-modal"),j=this.el("div","aq-victory-stars");for(let I=0;I<3;I++){const U=De("aq-victory-star");U.style.setProperty("--star-delay",`${I*130}ms`),this.victoryStars.push(U),j.appendChild(U)}this.victoryBannerEl=this.el("div","aq-victory-campaign-banner"),this.victoryBannerEl.hidden=!0,this.victoryTitleEl=this.el("h2","aq-victory-title"),this.victorySubEl=this.el("p","aq-victory-subtitle");const tt=this.el("div","aq-victory-stats"),it=this.el("div","aq-victory-stat-box");this.victoryTimeLabel=this.el("span","aq-victory-stat-label"),this.victoryTimeVal=this.el("span","aq-victory-stat-val aq-mono"),it.append(this.victoryTimeLabel,this.victoryTimeVal);const at=this.el("div","aq-victory-stat-box");this.victoryParLabel=this.el("span","aq-victory-stat-label"),this.victoryParVal=this.el("span","aq-victory-stat-val aq-mono"),at.append(this.victoryParLabel,this.victoryParVal),tt.append(it,at);const nt=this.el("div","aq-victory-actions");this.victoryNextBtn=this.makeButton("aq-btn aq-btn-primary aq-victory-next",()=>{this.lastSnapshot&&this.lastSnapshot.levelIndex>=fe?this.callbacks.onOpenSandbox():this.callbacks.onNextLevel()}),this.victoryNextLabel=this.el("span"),this.victoryNextBtn.append(this.victoryNextLabel,lt(["M5 12h14","M13 6l6 6-6 6"]));const rt=this.el("div","aq-victory-secondary");this.victoryReplayBtn=this.makeButton("aq-btn aq-btn-glass",()=>this.callbacks.onRestart()),this.victoryReplayBtn.appendChild(lt(["M3 12a9 9 0 1 0 3-6.7L3 8","M3 3v5h5"])),this.victoryReplayLabel=this.el("span"),this.victoryReplayBtn.appendChild(this.victoryReplayLabel),this.victoryChaptersBtn=this.makeButton("aq-btn aq-btn-glass",()=>this.setChapterModalOpen(!0)),this.victoryChaptersBtn.appendChild(lt(["M4 4h7v7H4z","M13 4h7v7h-7z","M4 13h7v7H4z","M13 13h7v7h-7z"])),this.victoryChaptersLabel=this.el("span"),this.victoryChaptersBtn.appendChild(this.victoryChaptersLabel),rt.append(this.victoryReplayBtn,this.victoryChaptersBtn),nt.append(this.victoryNextBtn,rt),J.append(j,this.victoryBannerEl,this.victoryTitleEl,this.victorySubEl,tt,nt),this.victoryBackdrop.appendChild(J),this.root.append(this.titleScreen,this.playingHud,this.victoryBackdrop,this.chapterBackdrop),window.addEventListener("keydown",this.handleCaptureEscape,!0),window.addEventListener("pointerdown",this.handleFirstStageInteract,{passive:!0}),this.applyStaticTranslations("de")}setChapterModalOpen(t){this.chapterModalOpen!==t&&(this.chapterModalOpen=t,this.chapterBackdrop.hidden=!t,this.lastSnapshot&&(this.syncVictoryVisibility(this.lastSnapshot.screen),t&&this.updateChapterCards(this.lastSnapshot)))}isChapterModalOpen(){return this.chapterModalOpen}toggleChapterModal(){return this.setChapterModalOpen(!this.chapterModalOpen),this.chapterModalOpen}setTutorialVisible(t){this.tutorialDismissed=!t,t||(this.tutorialPill.hidden=!0)}update(t){this.lastSnapshot=t;const s=performance.now(),e=t.lang!==this.lastLang,i=t.screen!==this.lastScreen,o=t.levelIndex!==this.lastLevelIndex||t.isSandbox!==this.lastIsSandbox;e&&(this.lastLang=t.lang,document.documentElement.lang=t.lang,document.title=`${z(t.lang,"gameTitle")} — ${z(t.lang,"gameSubtitle")}`,this.applyStaticTranslations(t.lang)),i&&(this.lastScreen=t.screen,t.screen==="victory"&&(this.chapterModalOpen=!1,this.chapterBackdrop.hidden=!0),this.titleScreen.hidden=t.screen!=="title",this.playingHud.hidden=t.screen!=="playing",this.syncVictoryVisibility(t.screen)),o&&(this.lastLevelIndex=t.levelIndex,this.lastIsSandbox=t.isSandbox,this.sandboxRow.hidden=!t.isSandbox,this.hintCollapsed=t.levelIndex>1,this.hintCard.classList.toggle("is-collapsed",this.hintCollapsed),this.hintToggleBtn.setAttribute("aria-expanded",String(!this.hintCollapsed)),t.levelIndex!==1&&(this.tutorialDismissed=!1)),(e||o||i)&&(this.updateLevelMeta(t),this.updateTitleProgress(t),this.updateChapterCards(t),this.updateVictoryModal(t)),this.updateDiscreteControls(t);const a=t.screen==="playing"&&t.levelIndex===1&&!t.isSandbox&&!this.tutorialDismissed&&t.activeTool==="surge"&&t.elapsed<12;this.tutorialPill.hidden=!a;const r=t.objectives.map(l=>l.labelKey).join("|");(r!==this.lastObjectiveSig||e)&&(this.lastObjectiveSig=r,this.rebuildObjectiveRows(t.objectives,t.lang)),(e||i||o||s-this.lastNumericUpdateMs>=ks)&&(this.lastNumericUpdateMs=s,this.updateNumericReadouts(t))}dispose(){window.removeEventListener("keydown",this.handleCaptureEscape,!0),window.removeEventListener("pointerdown",this.handleFirstStageInteract),this.root.textContent=""}el(t,s,e){const i=document.createElement(t);return s&&(i.className=s),e!==void 0&&(i.textContent=e),i}makeButton(t,s){const e=document.createElement("button");return e.type="button",e.className=t,e.addEventListener("click",i=>{i.detail>0&&e.blur(),s()}),e}createToolButton(t){const s=this.makeButton("aq-tool-btn",()=>this.callbacks.onSelectTool(t.tool)),e=this.el("span","aq-hotkey",t.hotkey),i=lt(t.icon),o=this.el("span","aq-tool-label");return s.append(e,i,o),{tool:t.tool,button:s,labelEl:o,hotkeyEl:e,labelKey:t.labelKey,descKey:t.descKey}}syncVictoryVisibility(t){this.victoryBackdrop.hidden=t!=="victory"||this.chapterModalOpen}applyStaticTranslations(t){this.titleMainEl.textContent=z(t,"gameTitle"),this.titleSubtitleEl.textContent=z(t,"gameSubtitle"),this.titleTaglineEl.textContent=z(t,"titleTagline"),this.openSandboxLabel.textContent=z(t,"openSandbox"),this.openChaptersLabel.textContent=z(t,"selectChapter"),this.titleMuteBtn.title=`${z(t,"mute")} [M]`,this.hintLabelEl.textContent=z(t,"hintLabel"),this.slowMoLabelEl.textContent=z(t,"slowMo"),this.slowMoBtn.title=`${z(t,"slowMo")} [T / Shift]`,this.restartBtn.title=`${z(t,"reset")} [R]`,this.muteBtn.title=`${z(t,"mute")} [M]`,this.menuLabelEl.textContent=z(t,"backToMenu"),this.menuBtn.title=`${z(t,"backToMenu")} [Esc]`,this.slowMoBannerText.textContent=z(t,"slowMoBadge"),this.tutorialText.textContent=z(t,"tutorialDrag");for(const e of this.toolButtons){e.labelEl.textContent=z(t,e.labelKey);const i=z(t,e.descKey);e.button.title=i,e.button.dataset.tip=i}this.shatterLabelEl.textContent=z(t,"toolShatter");const s=z(t,"toolShatterDesc");this.shatterBtn.title=s,this.shatterBtn.dataset.tip=s;for(const e of this.sandboxButtons)e.labelEl.textContent=z(t,e.labelKey);this.chapterTitleEl.textContent=z(t,"selectChapter"),this.chapterCloseBtn.title=z(t,"closeMenu"),this.victoryBannerEl.textContent=z(t,"campaignComplete"),this.victoryTitleEl.textContent=z(t,"victoryTitle"),this.victorySubEl.textContent=z(t,"victorySubtitle"),this.victoryTimeLabel.textContent=z(t,"victoryTime"),this.victoryParLabel.textContent=z(t,"victoryPar"),this.victoryReplayLabel.textContent=z(t,"replayChapter"),this.victoryChaptersLabel.textContent=z(t,"selectChapter")}updateTitleProgress(t){const s=As(t.levelProgress)?"continueCampaign":"startCampaign";this.startCampaignLabel.textContent=z(t.lang,s),this.demoBadgeTextEl.textContent=`${z(t.lang,t.titleKey)} · ${z(t.lang,t.subtitleKey)}`}updateLevelMeta(t){const s=t.lang;t.isSandbox?(this.levelBadgePill.textContent="SANDBOX",this.levelBadgePill.classList.add("is-sandbox")):t.levelIndex>=1?(this.levelBadgePill.textContent=`${z(s,"chapterPrefix")} ${t.levelIndex}`,this.levelBadgePill.classList.remove("is-sandbox")):(this.levelBadgePill.textContent="DEMO",this.levelBadgePill.classList.remove("is-sandbox")),this.levelTitleEl.textContent=z(s,t.titleKey),this.levelSubEl.textContent=z(s,t.subtitleKey),this.hintBodyEl.textContent=z(s,t.hintKey),!t.isSandbox&&t.parTime>0?(this.parValueEl.textContent=`/ ${me(t.parTime)}`,this.parValueEl.hidden=!1):this.parValueEl.hidden=!0}updateDiscreteControls(t){const s=t.lang;this.titleLangDeSpan.classList.toggle("is-active",s==="de"),this.titleLangEnSpan.classList.toggle("is-active",s==="en"),this.langDeSpan.classList.toggle("is-active",s==="de"),this.langEnSpan.classList.toggle("is-active",s==="en"),this.titleMuteOnIcon.style.display=t.muted?"none":"",this.titleMuteOffIcon.style.display=t.muted?"":"none",this.titleMuteBtn.classList.toggle("is-muted",t.muted),this.muteOnIcon.style.display=t.muted?"none":"",this.muteOffIcon.style.display=t.muted?"":"none",this.muteBtn.classList.toggle("is-muted",t.muted),this.slowMoBtn.classList.toggle("is-active",t.slowMo),this.slowMoBtn.setAttribute("aria-pressed",String(t.slowMo)),this.slowMoBanner.hidden=!(t.screen==="playing"&&t.slowMo);const e=t.quality==="ultra"?"qualityUltra":"qualityHigh";this.qualityLabelEl.textContent=z(s,e),this.qualityBtn.classList.toggle("is-ultra",t.quality==="ultra");for(const i of this.toolButtons){const o=i.tool===t.activeTool;i.button.classList.toggle("is-active",o),i.button.setAttribute("aria-pressed",String(o))}this.shatterBtn.classList.toggle("has-ice",t.frostUsed>0);for(const i of this.sandboxButtons)i.action==="toggleSpouts"&&i.statusDot&&(i.button.classList.toggle("is-on",t.spoutsActive),i.button.setAttribute("aria-pressed",String(t.spoutsActive)))}rebuildObjectiveRows(t,s){this.objectivesList.textContent="",this.objectiveRows=[];for(const e of t){const i=this.el("li","aq-objective-row"),o=this.el("div","aq-objective-head"),a=this.el("span","aq-objective-check");a.appendChild(lt(["M5 13l4 4L19 7"],"0 0 24 24","aq-check-svg"));const r=this.el("span","aq-objective-label",z(s,e.labelKey)),c=this.el("span","aq-objective-detail aq-mono",e.detail??"");o.append(a,r,c);const l=this.el("div","aq-objective-track"),d=this.el("div","aq-objective-fill");l.appendChild(d),i.append(o,l),this.objectivesList.appendChild(i),this.objectiveRows.push({root:i,checkIcon:a,labelEl:r,detailEl:c,fillEl:d})}}updateNumericReadouts(t){if(this.timerValueEl.textContent=me(t.elapsed),t.frostMax<=0||t.frostMax>=5e3)this.frostValueEl.textContent=`${t.frostUsed} / ∞`,this.frostBarFill.style.width=t.frostUsed>0?"35%":"0%",this.frostBarTrack.classList.remove("is-near-full");else{const e=Math.max(0,Math.min(1,t.frostUsed/t.frostMax));this.frostValueEl.textContent=`${t.frostUsed}/${t.frostMax}`,this.frostBarFill.style.width=`${(e*100).toFixed(1)}%`,this.frostBarTrack.classList.toggle("is-near-full",e>=.85)}this.waterValueEl.textContent=Cs(t.waterCount),this.fpsValueEl.textContent=t.fps>0?`${Math.round(t.fps)} fps`:"";for(let e=0;e<this.objectiveRows.length;e++){const i=this.objectiveRows[e],o=t.objectives[e];if(!o)continue;i.root.classList.toggle("is-done",o.done);const a=Math.max(0,Math.min(1,o.done?1:o.progress))*100;i.fillEl.style.width=`${a.toFixed(1)}%`,i.detailEl.textContent=o.detail??""}}updateChapterCards(t){const s=t.lang;for(const e of this.chapterCards){if(e.chapterIndex==="sandbox"){e.titleEl.textContent=z(s,"lvl.sb.title"),e.subEl.textContent=z(s,"lvl.sb.sub"),e.button.classList.toggle("is-current",t.isSandbox);continue}const i=e.chapterIndex,o=Ss(t.levelProgress,i,t),a=o?o.stars:0;e.badgeEl.textContent=`${z(s,"chapterPrefix")} ${i}`,e.titleEl.textContent=z(s,`lvl.${i}.title`),e.subEl.textContent=z(s,`lvl.${i}.sub`);for(let c=0;c<e.starEls.length;c++)e.starEls[c].classList.toggle("is-earned",c<a);const r=o&&o.bestTime!==null?me(o.bestTime):"--:--";e.metaEl.textContent=`${z(s,"bestTimeLabel")}: ${r}`,e.button.classList.toggle("is-current",!t.isSandbox&&t.levelIndex===i)}}updateVictoryModal(t){const s=t.lang,e=t.levelIndex>=fe,i=t.starsEarned>0?Math.min(3,t.starsEarned):t.elapsed<=t.parTime?3:t.elapsed<=t.parTime*1.45?2:1;for(let o=0;o<this.victoryStars.length;o++)this.victoryStars[o].classList.toggle("is-earned",o<i);this.victoryBannerEl.hidden=!e,this.victoryTimeVal.textContent=Ve(t.elapsed),this.victoryParVal.textContent=Ve(t.parTime),this.victoryNextLabel.textContent=z(s,e?"enterSandbox":"nextChapter")}}const Ie="aqualith_progress_v1",Nt=1/60,Bs=.35,Le=.24,Ps=.26;function Fs(){try{const S=window.localStorage.getItem(Ie);if(!S)return{};const t=JSON.parse(S);return t&&typeof t=="object"?t:{}}catch{return{}}}function Es(S){const t={};for(const s of _t){const e=S==null?void 0:S[s.id];t[s.id]={stars:typeof(e==null?void 0:e.stars)=="number"?Math.max(0,Math.min(3,e.stars)):0,bestTime:typeof(e==null?void 0:e.bestTime)=="number"&&Number.isFinite(e.bestTime)?e.bestTime:null,unlocked:!0}}return t}function Ds(S){try{window.localStorage.setItem(Ie,JSON.stringify(S))}catch{}}function Vs(S,t){return t<=0||S<=t?3:S<=t*1.45?2:1}function bt(S,t,s){return S<t?t:S>s?s:S}class Ls{constructor(){v(this,"stageEl");v(this,"webglCanvas");v(this,"overlayCanvas");v(this,"uiRoot");v(this,"terrain",new ws);v(this,"fluid",new ys);v(this,"mechanisms",new xs);v(this,"audio",new _e);v(this,"renderer");v(this,"overlay");v(this,"tools");v(this,"hud");v(this,"screen","title");v(this,"currentLevel",le);v(this,"lang","de");v(this,"quality","ultra");v(this,"slowMo",!1);v(this,"elapsed",0);v(this,"starsEarned",0);v(this,"showDragHint",!0);v(this,"spoutsActive",!0);v(this,"levelProgress");v(this,"rafId",0);v(this,"lastFrameTimeMs",0);v(this,"accumulator",0);v(this,"animTime",0);v(this,"fps",60);v(this,"fpsFrames",0);v(this,"fpsWindowStartMs",0);v(this,"resizeObserver",null);v(this,"handleResize",()=>{const t=Math.max(1,Math.round(this.stageEl.clientWidth||1280)),s=Math.max(1,Math.round(this.stageEl.clientHeight||720)),e=this.quality==="ultra"?2:1.5,i=bt(window.devicePixelRatio||1,1,e);this.renderer.resize(Math.round(t*i),Math.round(s*i)),this.overlay.resize(t,s,i)});v(this,"loop",t=>{const s=Math.min(.05,Math.max(.001,(t-this.lastFrameTimeMs)/1e3));this.lastFrameTimeMs=t,this.fpsFrames++;const e=t-this.fpsWindowStartMs;e>=450&&(this.fps=this.fpsFrames*1e3/e,this.fpsFrames=0,this.fpsWindowStartMs=t);const i=this.screen==="playing"&&this.slowMo?Bs:1,o=s*i;this.accumulator+=o,this.animTime+=o;const a=this.screen==="playing"&&!this.hud.isChapterModalOpen();this.tools.setEnabled(a);let r=0;for(;this.accumulator>=Nt&&r<4;){this.accumulator-=Nt,r++,a&&this.tools.update(Nt);const h=a?this.tools.getToolInput():null;if(this.fluid.step(Nt,this.terrain,h,this.mechanisms,this.quality,this.currentLevel.maxTotalParticles),this.tools.consumeBurst(),this.screen==="playing"&&(this.elapsed+=Nt,!this.currentLevel.isSandbox&&this.mechanisms.isLevelComplete())){this.completeLevel();break}}this.accumulator>Nt*2&&(this.accumulator=0);const c=this.mechanisms.getSnapshot(),l=this.buildSnapshot(),d=this.tools.getToolInput(),u=this.tools.getPointerWorld();this.renderer.render(this.animTime,this.fluid,this.terrain,c,this.currentLevel.theme),this.overlay.render(l,c,d,u,this.animTime,this.showDragHint),this.hud.update(l),this.audio.update(this.fluid.telemetry,s),this.rafId=requestAnimationFrame(this.loop)});const t=document.getElementById("stage"),s=document.getElementById("webgl-canvas"),e=document.getElementById("overlay-canvas"),i=document.getElementById("ui-root");if(!(t instanceof HTMLElement)||!(s instanceof HTMLCanvasElement)||!(e instanceof HTMLCanvasElement)||!(i instanceof HTMLElement))throw new Error("AQUALITH: Required DOM elements (#stage, #webgl-canvas, #overlay-canvas, #ui-root) missing");this.stageEl=t,this.webglCanvas=s,this.overlayCanvas=e,this.uiRoot=i;const o=Fs();this.lang=o.lang==="en"?"en":"de",this.quality=o.quality==="high"?"high":"ultra",this.levelProgress=Es(o.levelProgress),o.muted&&this.audio.setMuted(!0),this.renderer=new gs(this.webglCanvas),this.renderer.setQuality(this.quality),this.overlay=new is(this.overlayCanvas),this.tools=new Xe(this.stageEl,{onUserGesture:()=>this.audio.unlock(),onToolChange:()=>this.pushHudUpdate(),onShatterIce:()=>this.shatterAllIce(),onPaintIce:(r,c)=>this.handlePaintIce(r,c),onEraseIce:(r,c)=>this.handleEraseIce(r,c),onPaintRock:(r,c,l)=>this.handlePaintRock(r,c,l),onTryClickWorld:(r,c)=>{if(this.screen!=="playing")return!1;const l=this.mechanisms.toggleValveAt(r,c);return l&&this.audio.playValveClank(),l},isHoveringInteractive:(r,c)=>this.screen==="playing"&&this.mechanisms.isHoveringValve(r,c),onSlowMoChange:r=>{this.screen==="playing"&&(this.slowMo=r,this.tools.setSlowMo(r))},onRestart:()=>{(this.screen==="playing"||this.screen==="victory")&&this.loadLevel(this.currentLevel,"playing")},onToggleMute:()=>this.toggleMute(),onToggleMenu:()=>this.handleEscapeMenu(),onFirstInteract:()=>{this.showDragHint=!1,this.hud.setTutorialVisible(!1)},onVortexFire:()=>this.audio.playVortexFire()}),this.hud=new Rs(this.uiRoot,{onStartCampaign:()=>{this.audio.unlock();const r=this.findNextUnfinishedChapter();this.selectCampaignChapter(r)},onSelectLevel:r=>{this.audio.unlock(),this.selectCampaignChapter(r)},onOpenSandbox:()=>{this.audio.unlock(),this.loadLevel(ce,"playing")},onSelectTool:r=>{this.audio.unlock(),this.tools.setActiveTool(r)},onShatterIce:()=>{this.audio.unlock(),this.shatterAllIce()},onToggleSlowMo:()=>{this.audio.unlock(),this.screen==="playing"&&(this.slowMo=!this.slowMo,this.tools.setSlowMo(this.slowMo))},onRestart:()=>{this.audio.unlock(),this.loadLevel(this.currentLevel,"playing")},onToggleMute:()=>{this.audio.unlock(),this.toggleMute()},onToggleQuality:()=>{this.audio.unlock(),this.quality=this.quality==="ultra"?"high":"ultra",this.renderer.setQuality(this.quality),this.handleResize(),this.persist()},onToggleLang:()=>{this.audio.unlock(),this.lang=this.lang==="de"?"en":"de",this.persist()},onOpenMenu:()=>{this.audio.unlock(),this.returnToTitle()},onNextLevel:()=>{this.audio.unlock();const r=this.currentLevel.index+1;r<=_t.length?this.selectCampaignChapter(r):this.loadLevel(ce,"playing")},onSandboxAction:r=>{this.audio.unlock(),this.handleSandboxAction(r)}}),this.setupResize(),this.loadLevel(le,"title"),this.exposeDebugApi();const a=performance.now();this.lastFrameTimeMs=a,this.fpsWindowStartMs=a,this.rafId=requestAnimationFrame(this.loop)}setupResize(){this.handleResize(),window.addEventListener("resize",this.handleResize),typeof ResizeObserver<"u"&&(this.resizeObserver=new ResizeObserver(()=>this.handleResize()),this.resizeObserver.observe(this.stageEl))}findNextUnfinishedChapter(){for(let t=0;t<_t.length;t++){const s=this.levelProgress[_t[t].id];if(!s||s.stars===0)return t+1}return 1}selectCampaignChapter(t){const s=Math.max(1,Math.min(_t.length,Math.floor(t))),e=_t[s-1];this.loadLevel(e,"playing")}returnToTitle(){this.hud.setChapterModalOpen(!1),this.loadLevel(le,"title")}handleEscapeMenu(){this.screen==="playing"?this.hud.isChapterModalOpen()?this.hud.setChapterModalOpen(!1):this.hud.setChapterModalOpen(!0):this.screen==="victory"&&this.hud.setChapterModalOpen(!1)}loadLevel(t,s){this.currentLevel=t,this.screen=s,this.elapsed=0,this.starsEarned=0,this.slowMo=!1,this.accumulator=0,this.spoutsActive=t.spouts.some(i=>i.enabled!==!1),this.showDragHint=s==="playing"&&t.id==="level-1",this.fluid.reset(),this.terrain.loadLevel(t.solids,t.carves,t.drains),this.mechanisms.loadLevel(t,this.terrain);for(const i of t.pools)this.fluid.spawnPool(i.x,i.y,i.w,i.h,t.maxTotalParticles,i.fillFactor??.9);const e=s==="playing";this.tools.setSandbox(!!t.isSandbox),this.tools.setActiveTool("surge"),this.tools.setSlowMo(!1),this.tools.setEnabled(e),e&&t.id==="level-1"&&this.hud.setTutorialVisible(!0),this.pushHudUpdate()}handlePaintIce(t,s){if(this.screen!=="playing")return;this.terrain.paintIce(t,s,Le,this.currentLevel.maxFrostCells).added>0&&(this.fluid.telemetry.iceFreezeCount+=1,this.audio.playIceFreeze())}handleEraseIce(t,s){this.screen==="playing"&&this.terrain.eraseIce(t,s,Le*1.15)}handlePaintRock(t,s,e){this.screen!=="playing"||!this.currentLevel.isSandbox||this.terrain.paintRock(t,s,Ps,e)}shatterAllIce(){if(this.screen!=="playing")return;const t=this.terrain.shatterAllIce();t.length>0&&(this.mechanisms.spawnIceShards(t),this.fluid.telemetry.iceShatterCount+=t.length,this.audio.playIceShatter())}handleSandboxAction(t){if(!this.currentLevel.isSandbox)return;const s=()=>(Math.random()-.5)*1.6;switch(t){case"tsunami":this.fluid.triggerTsunami(this.currentLevel.maxTotalParticles),this.audio.playVortexFire();break;case"toggleSpouts":this.mechanisms.toggleSpouts(),this.spoutsActive=this.mechanisms.spouts.some(e=>e.enabled);break;case"addTurbine":this.mechanisms.addSandboxTurbine(bt(8+s()*2.2,2.2,K-2.2),bt(4.8+s()*.8,2.2,Q-2));break;case"addArk":this.mechanisms.addSandboxBody(bt(8+s()*2,2,K-2),bt(6.2+s()*.5,2.4,Q-1.5),"ark");break;case"addMagma":this.mechanisms.addSandboxMagma(bt(8+s()*2.4,2.2,K-3.6),.55);break;case"addWall":this.mechanisms.addSandboxCrackedWall(bt(8+s()*2.2,2.2,K-2.2),.55);break;case"addMine":this.mechanisms.addSandboxMine(bt(8+s()*2.4,2.2,K-2.2),bt(5.8+s()*.6,2.6,Q-1.5));break;case"addSeesaw":this.mechanisms.addSandboxSeesaw(bt(8+s()*2,2.8,K-2.8),bt(3.6+s()*.6,2,Q-2.2));break;case"clearWater":this.fluid.reset();break}this.pushHudUpdate()}toggleMute(){const t=!this.audio.isMuted();this.audio.setMuted(t),this.persist()}persist(){Ds({lang:this.lang,quality:this.quality,muted:this.audio.isMuted(),levelProgress:this.levelProgress})}completeLevel(){this.screen="victory",this.slowMo=!1,this.tools.setSlowMo(!1),this.tools.setEnabled(!1),this.starsEarned=Vs(this.elapsed,this.currentLevel.parTime);const t=this.levelProgress[this.currentLevel.id]??{stars:0,bestTime:null},s=t.bestTime===null?this.elapsed:Math.min(t.bestTime,this.elapsed);this.levelProgress[this.currentLevel.id]={stars:Math.max(t.stars,this.starsEarned),bestTime:s,unlocked:!0},this.persist(),this.audio.playVictory(),this.pushHudUpdate()}buildSnapshot(){const t=this.mechanisms.getObjectives();return{screen:this.screen,levelId:this.currentLevel.id,levelIndex:this.currentLevel.index,isSandbox:!!this.currentLevel.isSandbox,titleKey:this.currentLevel.titleKey,subtitleKey:this.currentLevel.subtitleKey,hintKey:this.currentLevel.hintKey,elapsed:this.elapsed,parTime:this.currentLevel.parTime,frostUsed:this.terrain.frostCount,frostMax:this.currentLevel.maxFrostCells,activeTool:this.tools.getActiveTool(),slowMo:this.slowMo,muted:this.audio.isMuted(),quality:this.quality,lang:this.lang,fps:this.fps,waterCount:this.fluid.numParticles,objectives:t,starsEarned:this.starsEarned,levelProgress:this.levelProgress,spoutsActive:this.spoutsActive}}pushHudUpdate(){this.hud.update(this.buildSnapshot())}exposeDebugApi(){const t={getState:()=>this.buildSnapshot(),getTelemetry:()=>({...this.fluid.telemetry}),getMechanisms:()=>this.mechanisms.getSnapshot(),startCampaign:()=>this.selectCampaignChapter(1),selectLevel:s=>this.selectCampaignChapter(s),openSandbox:()=>this.loadLevel(ce,"playing"),returnToTitle:()=>this.returnToTitle(),triggerTsunami:()=>this.handleSandboxAction("tsunami")};window.__AQUALITH_DEBUG__=t}dispose(){var t;cancelAnimationFrame(this.rafId),window.removeEventListener("resize",this.handleResize),(t=this.resizeObserver)==null||t.disconnect(),this.tools.dispose(),this.hud.dispose(),this.renderer.dispose()}}const Is=new Ls;window.addEventListener("beforeunload",()=>Is.dispose(),{once:!0});
