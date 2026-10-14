# CA during motion: frames sorted by angular speed; measure R/B global shift vs G (and per-region) at full res
import sys,subprocess,numpy as np,cv2
v,mv,fpx=sys.argv[1],sys.argv[2],float(sys.argv[3])
a=np.load(mv); sp=np.hypot(a[:,0],a[:,1])*4  # px/frame at 1280
ok=a[:,2]>0.1
idx=np.argsort(-(sp*ok))
out=[]
for bucket,(lo,hi) in enumerate([(0,1),(4,10),(10,25),(25,60),(60,200)]):
    sel=[i for i in np.nonzero(ok&(sp>=lo)&(sp<hi))[0]][::max(1,int(((sp>=lo)&(sp<hi)).sum()//12))][:12]
    vals=[]
    for i in sel:
        t=i/60
        r=subprocess.run(['ffmpeg','-v','error','-ss',f'{t:.3f}','-i',v,'-frames:v','1','-f','rawvideo','-pix_fmt','bgr24','-'],capture_output=True)
        if len(r.stdout)<1280*720*3: continue
        im=np.frombuffer(r.stdout,np.uint8).reshape(720,1280,3).astype(np.float32)
        B,G,R=cv2.split(im[60:500,200:1080]); w=cv2.createHanningWindow(G.shape[::-1],cv2.CV_32F)
        (rx,ry),_=cv2.phaseCorrelate(G,R,w); (bx,by),_=cv2.phaseCorrelate(G,B,w)
        d=np.array([a[i,0],a[i,1]]); d=d/(np.linalg.norm(d)+1e-9)
        vals.append((sp[i],np.dot([rx,ry],d),np.dot([bx,by],d),np.hypot(rx-bx,ry-by)))
    if vals:
        V=np.array(vals); print(f'speed {lo:3d}-{hi:3d}px/frame@720p60 n={len(V)}  R-shift along motion {np.median(V[:,1]):+.2f}  B {np.median(V[:,2]):+.2f}  |R-B| {np.median(V[:,3]):.2f}px')
