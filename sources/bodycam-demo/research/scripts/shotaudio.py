# shotaudio.py wav [label] -> isolated shot analysis: peak, clip run, decay (-20/-40 dB times), spectral rolloff, ambient ducking (pumping)
import sys,wave,numpy as np
w=wave.open(sys.argv[1]); sr=w.getframerate(); ch=w.getnchannels()
x=np.frombuffer(w.readframes(w.getnframes()),np.int16).astype(np.float32)/32768
if ch>1: x=x.reshape(-1,ch).mean(1)
hop=sr//1000; n=len(x)//hop; fr=x[:n*hop].reshape(n,hop); pk=np.abs(fr).max(1); rms=np.sqrt((fr**2).mean(1)+1e-12)
db=20*np.log10(rms+1e-9)
# isolated shots: peak > 0.7, no other >0.5 within previous 400 ms and next 600 ms
cand=np.nonzero(pk>0.45)[0]; shots=[]; last=-10**9
for i in cand:
    if i-last<50: last=i; continue
    if i>500 and i<n-1200 and pk[i-300:i-5].max()<0.2 and pk[i+90:i+450].max()<0.45: shots.append(i)
    last=i
print(sys.argv[1].split('/')[-1],'sr',sr,'isolated shots',len(shots),'clip-pct total %.3f'%((np.abs(x)>0.985).mean()*100))
D20=[];D40=[];RO=[];DUCK=[];CLIP=[];CEN=[];LO=[]
for i in shots:
    s=i*hop; seg=x[s-int(0.3*sr):s+int(1.2*sr)]
    base=np.median(db[i-400:i-50]); p=db[i:i+30].max()
    env=np.convolve(db[i:i+1200],np.ones(10)/10,'same')
    def t_to(level):
        k=np.nonzero(env[15:]<p-level)[0]; return (k[0]+15) if len(k) else np.nan
    D20.append(t_to(20)); D40.append(t_to(40) if p-40>base else np.nan)
    a=x[s:s+int(0.15*sr)]; clip=np.abs(a)>0.985; CLIP.append(clip.sum()/sr*1000)
    S=np.abs(np.fft.rfft(a*np.hanning(len(a))))**2; f=np.fft.rfftfreq(len(a),1/sr); c=np.cumsum(S)/S.sum()
    RO.append(f[np.searchsorted(c,0.95)]); CEN.append((f*S).sum()/S.sum()); LO.append(f[np.searchsorted(c,0.05)])
    # ambient ducking: rms 0.6-1.0 s after vs before (only if shot tail gone)
    DUCK.append(np.median(db[i+600:i+1000])-base)
    print('  t=%.2fs peak %.1f dBFS base %.1f clip %.1f ms  -20dB@%s ms -40dB@%s ms  roll95 %.0f Hz cent %.0f Hz  amb after-before %+.1f dB'%(i/1000,p,base,CLIP[-1],D20[-1],D40[-1],RO[-1],CEN[-1],DUCK[-1]))
if shots:
    print(' MEDIAN clip %.1f ms | -20 dB %.0f ms | -40 dB %.0f ms | roll95 %.0f Hz | centroid %.0f Hz | roll05 %.0f Hz | ambient delta %+.1f dB'%tuple(np.nanmedian(v) for v in [CLIP,D20,D40,RO,CEN,LO,DUCK]))
