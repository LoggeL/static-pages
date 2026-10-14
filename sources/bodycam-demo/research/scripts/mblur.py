# motion-blur length vs inter-frame displacement (horizontal pans) -> shutter fraction
import sys,subprocess,numpy as np
v,mv=sys.argv[1],sys.argv[2]
a=np.load(mv); dx=a[:,0]*4; dy=a[:,1]*4; ok=(a[:,2]>0.1)&(np.abs(dx)>3*np.abs(dy)+2)
res=[]
for lo,hi in [(6,12),(12,24),(24,48),(48,90)]:
    cand=np.nonzero(ok&(np.abs(dx)>=lo)&(np.abs(dx)<hi))[0]
    # require neighbours also moving similarly (steady pan)
    cand=[i for i in cand if 2<i<len(a)-2 and np.all(np.abs(dx[i-1:i+2]-dx[i])<0.25*abs(dx[i]))]
    cand=cand[::max(1,len(cand)//10)][:10]; L=[]
    for i in cand:
        r=subprocess.run(['ffmpeg','-v','error','-ss',f'{i/60:.4f}','-i',v,'-frames:v','1','-f','rawvideo','-pix_fmt','gray','-'],capture_output=True)
        if len(r.stdout)<1280*720: continue
        g=np.frombuffer(r.stdout,np.uint8).reshape(720,1280).astype(np.float32)[60:420,200:1080]
        d=np.diff(g,axis=1); d-=d.mean(1,keepdims=True)
        F=np.fft.rfft(d,2*d.shape[1],axis=1); ac=np.fft.irfft(np.abs(F)**2,axis=1)[:, :120].mean(0); ac/=ac[0]
        k=2+np.argmin(ac[2:110]); L.append((abs(dx[i]),k,ac[k]))
    if L:
        L=np.array(L); res.append(L); print(f'pan {lo:2d}-{hi:2d}px/frame: n={len(L)} disp med {np.median(L[:,0]):.1f}px  blur len med {np.median(L[:,1]):.1f}px  ratio {np.median(L[:,1]/L[:,0]):.2f}  (ac min {np.median(L[:,2]):.2f})')
