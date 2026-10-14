import sys,wave,numpy as np
w=wave.open(sys.argv[1]); sr=w.getframerate(); x=np.frombuffer(w.readframes(w.getnframes()),np.int16).astype(np.float32)/32768
hop=sr//100; n=len(x)//hop; fr=x[:n*hop].reshape(n,hop)
pk=np.abs(fr).max(1); rms=np.sqrt((fr**2).mean(1)+1e-12); db=20*np.log10(rms)
# onset: rms jump > 14 dB vs median of previous 200ms and peak > -12 dBFS
ev=[]; last=-100
for i in range(20,n):
    base=np.median(db[i-20:i-2])
    if db[i]-base>14 and pk[i]>0.25 and i-last>8:
        ev.append(i); last=i
print(sys.argv[1], 'events:',len(ev), 'peak-max', pk.max().round(3), 'clip%%', (np.abs(x)>0.99).mean()*100)
print(' '.join(f"{i/100:.2f}" for i in ev))
