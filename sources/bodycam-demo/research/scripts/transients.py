# transients.py wav t0 t1 [thr_db] -> list of transient times (spectral-flux-ish on HF band) with peak dBFS
import sys,wave,numpy as np
w=wave.open(sys.argv[1]); sr=w.getframerate(); t0,t1=float(sys.argv[2]),float(sys.argv[3]); thr=float(sys.argv[4]) if len(sys.argv)>4 else 9
w.setpos(int(t0*sr)); x=np.frombuffer(w.readframes(int((t1-t0)*sr)),np.int16).astype(np.float32)/32768
if w.getnchannels()>1: x=x.reshape(-1,w.getnchannels()).mean(1)
# HF emphasis
y=np.diff(x,prepend=0)
hop=int(sr*0.005); n=len(y)//hop; fr=y[:n*hop].reshape(n,hop)
db=10*np.log10((fr**2).mean(1)+1e-12); pk=20*np.log10(np.abs(x[:n*hop].reshape(n,hop)).max(1)+1e-9)
out=[];last=-1e9
for i in range(40,n):
    base=np.median(db[i-40:i-4])
    if db[i]-base>thr and i-last>20: out.append((t0+i*hop/sr,db[i]-base,pk[i:i+20].max())); last=i
for t,d,p in out: print(f"{t:7.3f}s  +{d:4.1f}dB  peak {p:5.1f} dBFS")
