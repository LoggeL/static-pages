# lateral CA: radial shift of R and B vs G in patches by radius (px @1280x720)
import sys,numpy as np,cv2
res={}
for p in sys.argv[1:]:
    im=cv2.imread(p).astype(np.float32); H,W=im.shape[:2]; cx,cy=W/2,H/2
    B,G,R=cv2.split(im); win=cv2.createHanningWindow((64,64),cv2.CV_32F)
    for yy in range(32,H-32,48):
        for xx in range(32,W-32,48):
            e=((xx-cx)/690)**2+((yy-cy)/520)**2
            if e>0.85: continue
            g=G[yy-32:yy+32,xx-32:xx+32]
            if g.std()<18: continue
            r=R[yy-32:yy+32,xx-32:xx+32]; b=B[yy-32:yy+32,xx-32:xx+32]
            (rx,ry),rr=cv2.phaseCorrelate(g,r,win); (bx,by),br=cv2.phaseCorrelate(g,b,win)
            if rr<0.3 or br<0.3: continue
            rad=np.hypot(xx-cx,yy-cy); u=np.array([xx-cx,yy-cy])/max(rad,1)
            k=int(rad//100); res.setdefault(k,[]).append((np.dot([rx,ry],u),np.dot([bx,by],u)))
for k in sorted(res):
    a=np.array(res[k]); print(f'r={k*100:4d}-{k*100+99}px n={len(a):4d}  R radial shift {np.median(a[:,0]):+.2f}px  B radial shift {np.median(a[:,1]):+.2f}px')
