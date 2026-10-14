# edge profile overshoot (halo) + noise in flat regions
import sys,numpy as np,cv2
profs=[];noise={}
for p in sys.argv[1:]:
    g=cv2.cvtColor(cv2.imread(p),cv2.COLOR_BGR2GRAY).astype(np.float32); H,W=g.shape
    gx=cv2.Sobel(g,cv2.CV_32F,1,0,ksize=3); gy=cv2.Sobel(g,cv2.CV_32F,0,1,ksize=3); m=np.hypot(gx,gy)
    ys,xs=np.nonzero(m>np.percentile(m,99.3))
    rng=np.random.default_rng(0); sel=rng.choice(len(xs),min(800,len(xs)),replace=False)
    for i in sel:
        x,y=xs[i],ys[i]
        if x<12 or y<12 or x>W-13 or y>H-13: continue
        d=np.array([gx[y,x],gy[y,x]]); d/=np.linalg.norm(d)
        t=np.arange(-8,9); px=x+t*d[0]; py=y+t*d[1]
        v=cv2.remap(g,px.astype(np.float32)[None],py.astype(np.float32)[None],cv2.INTER_LINEAR)[0]
        lo,hi=v[:3].mean(),v[-3:].mean()
        if hi-lo<40: continue
        profs.append((v-lo)/(hi-lo))
    # noise: 8x8 blocks with low gradient -> std of (g - blur)
    hp=g-cv2.GaussianBlur(g,(0,0),1.5); bl=cv2.blur(m,(16,16))
    for yy in range(16,H-16,16):
        for xx in range(16,W-16,16):
            if bl[yy,xx]<6:
                L=int(g[yy:yy+16,xx:xx+16].mean()//32); noise.setdefault(L,[]).append(hp[yy:yy+16,xx:xx+16].std())
P=np.median(np.array(profs),0)
print('edges',len(profs)); print(' median normalized edge profile (-8..8 px):',' '.join(f'{v:.2f}' for v in P))
print(' undershoot min(dark side) %.3f  overshoot max(bright side)-1 %.3f'%(P[:8].min(),P[9:].max()-1))
print(' 10-90%% rise width px: %.2f'%(np.interp(0.9,P,np.arange(-8,9))-np.interp(0.1,P,np.arange(-8,9))))
for L in sorted(noise): print(f' noise luma {L*32:3d}-{L*32+31}: hp-std median {np.median(noise[L]):.2f} (n={len(noise[L])})')
