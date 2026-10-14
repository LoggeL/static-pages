# track dark horizontal grooves from seed column, then fit fisheye models. usage: groove.py img x_seed x_min x_max y0 y1 [out.png]
import sys,numpy as np,cv2
img=cv2.imread(sys.argv[1]); g=cv2.GaussianBlur(cv2.cvtColor(img,cv2.COLOR_BGR2GRAY).astype(np.float32),(0,0),1.5)
xs,x0,x1,y0,y1=map(int,sys.argv[2:7]); H,W=g.shape; cx,cy=(W-1)/2,(H-1)/2
col=g[:,xs-2:xs+3].mean(1)
seeds=[y for y in range(y0,y1) if col[y]<col[y-3:y+4].min()+0.01 and col[y]==col[y-4:y+5].min() and (col[y-5]+col[y+5])/2-col[y]>12]
lines=[]
for sy in seeds:
    pts=[(xs,sy)]
    for dirn in (1,-1):
        y=float(sy); x=xs
        while True:
            x+=dirn*2
            if x<x0 or x>x1: break
            yi=int(round(y)); win=g[yi-2:yi+3,x]
            if len(win)<5 or yi<8 or yi>H-8: break
            y=yi-2+int(np.argmin(win))
            # sub-pixel
            if (g[yi-6:yi+7,x].mean()-g[int(y),x])<8: break
            pts.append((x,y))
    p=np.array(sorted(pts))
    if np.ptp(p[:,0])>350: lines.append(p)
print('grooves',len(lines))
def undist(P,f,model):
    x=P[:,0]-cx;y=P[:,1]-cy; rd=np.hypot(x,y)+1e-9
    th={'equidistant':rd/f,'stereo':2*np.arctan(rd/(2*f)),'equisolid':2*np.arcsin(np.clip(rd/(2*f),0,1)),'rect':np.arctan(rd/f)}[model]
    ru=f*np.tan(np.minimum(th,np.radians(85))); return np.c_[x*ru/rd,y*ru/rd]
def resid(Q):
    Q=Q-Q.mean(0); u,s,vt=np.linalg.svd(Q,full_matrices=False); n=vt[1]
    d=Q@n; L=np.ptp(Q@vt[0]); return np.sqrt((d**2).mean())/L
for model in ['equidistant','stereo','equisolid']:
    best=None
    for f in np.arange(250,2000,10):
        r=np.mean([resid(undist(p,f,model)) for p in lines])
        if best is None or r<best[1]: best=(f,r)
    f=best[0]
    fov={'equidistant':2*640/f,'stereo':4*np.arctan(640/(2*f)),'equisolid':4*np.arcsin(min(640/(2*f),1))}[model]
    vf={'equidistant':2*360/f,'stereo':4*np.arctan(360/(2*f)),'equisolid':4*np.arcsin(min(360/(2*f),1))}[model]
    df={'equidistant':2*734.4/f,'stereo':4*np.arctan(734.4/(2*f)),'equisolid':4*np.arcsin(min(734.4/(2*f),1))}[model]
    print(f'{model:12s} f={f:.0f}px@720p  resid={best[1]*1000:.2f}e-3 (raw {np.mean([resid(p.astype(float)) for p in lines])*1000:.2f}e-3)  hFOV={np.degrees(fov):.1f} vFOV={np.degrees(vf):.1f} dFOV={np.degrees(df):.1f}')
if len(sys.argv)>7:
    for p in lines:
        for a,b in zip(p[:-1],p[1:]): cv2.line(img,tuple(map(int,a)),tuple(map(int,b)),(0,0,255),1)
    cv2.imwrite(sys.argv[7],img)
