# burstaudio.py wav t0 t1 -> burst stats: shot onsets, peak/clip, crest, spectrum rolloffs, tail decay after last shot
import sys,wave,numpy as np
w=wave.open(sys.argv[1]); sr=w.getframerate(); ch=w.getnchannels(); t0,t1=float(sys.argv[2]),float(sys.argv[3])
w.setpos(int(t0*sr)); x=np.frombuffer(w.readframes(int((t1-t0+2.0)*sr)),np.int16).astype(np.float32)/32768
if ch>1: x=x.reshape(-1,ch).mean(1)
hop=sr//1000; n=len(x)//hop; fr=x[:n*hop].reshape(n,hop); pk=np.abs(fr).max(1); db=20*np.log10(np.sqrt((fr**2).mean(1))+1e-9)
N=int((t1-t0)*1000)
on=[];last=-999
for i in range(5,N):
    if db[i]-db[max(0,i-20):i-3].min()>12 and pk[i]>0.3 and i-last>40: on.append(i); last=i
iv=np.diff(on) if len(on)>1 else []
seg=x[:int((t1-t0)*sr)]
print(sys.argv[1].split('/')[-1],t0,t1,'shots',len(on),'interval ms med',np.median(iv) if len(iv) else None,'-> rpm',round(60000/np.median(iv)) if len(iv) else None)
print('  peak %.3f  samples>0.97: %.2f%%  crest(peak/rms) %.1f dB  rms %.1f dBFS'%(np.abs(seg).max(),(np.abs(seg)>0.97).mean()*100,20*np.log10(np.abs(seg).max()/np.sqrt((seg**2).mean())),20*np.log10(np.sqrt((seg**2).mean()))))
S=np.zeros(4097);
for i in on:
    a=x[i*hop:i*hop+8192];
    if len(a)==8192: S+=np.abs(np.fft.rfft(a*np.hanning(8192)))**2
f=np.fft.rfftfreq(8192,1/sr); c=np.cumsum(S)/S.sum()
bands=[(20,100),(100,250),(250,500),(500,1000),(1000,2000),(2000,4000),(4000,8000),(8000,12000),(12000,16000),(16000,20000)]
tot=S.sum(); print('  shot spectrum (170 ms) band energy dB rel max:',' '.join('%d-%d:%.0f'%(a,b,10*np.log10(S[(f>=a)&(f<b)].sum()/tot+1e-12)) for a,b in bands))
print('  rolloff 5/50/95%%: %.0f / %.0f / %.0f Hz'%(f[np.searchsorted(c,.05)],f[np.searchsorted(c,.5)],f[np.searchsorted(c,.95)]))
if on:
    L=on[-1]; env=np.convolve(db[L:L+1900],np.ones(15)/15,'same'); p=env[:30].max(); floor=np.percentile(db[L+1500:L+1990],20)
    out=[]
    for lv in (10,20,30,40):
        k=np.nonzero(env[10:]<p-lv)[0]; out.append(k[0]+10 if len(k) and p-lv>floor+3 else None)
    print('  tail after last shot: peak %.1f dB, floor %.1f dB, time to -10/-20/-30/-40 dB: %s ms'%(p,floor,out))
