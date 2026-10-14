# edgetrack.py img "x_seed,y_seed,x_min,x_max[;...]" -> track horizontal-ish edges (max |dI/dy|), fit fisheye models
import sys,numpy as np,cv2
img=cv2.imread(sys.argv[1]); g=cv2.GaussianBlur(cv2.cvtColor(img,cv2.COLOR_BGR2GRAY).astype(np.float32),(0,0),1.2)
H,W=g.shape; cx,cy=(W-1)/2,(H-1)/2; gy=np.abs(np.gradient(g,axis=0))
lines=[]
for spec in sys.argv[2].split(';'):
    xs,ys,x0,x1=map(int,spec.split(','))
    pts=[]
    for d in (1,-1):
        y=ys; x=xs
        while x0<=x<=x1:
            win=gy[y-3:y+4,x]; y=y-3+int(np.argmax(win)); pts.append((x,y)); x+=d*2
    lines.append(np.array(sorted(set(pts)),float))
def resid(Q):
    Q=Q-Q.mean(0); u,s,vt=np.linalg.svd(Q,full_matrices=False); return np.sqrt(((Q@vt[1])**2).mean())/np.ptp(Q@vt[0])
def und(P,f,m):
    x=P[:,0]-cx;y=P[:,1]-cy; rd=np.hypot(x,y)+1e-9
    th={'equidistant':rd/f,'stereo':2*np.arctan(rd/(2*f))}[m] if m!='k1' else None
    if m=='k1':
        s=1+f*(rd/(W/2))**2; return np.c_[x*s,y*s]
    ru=f*np.tan(np.minimum(th,np.radians(85))); return np.c_[x*ru/rd,y*ru/rd]
print('raw resid',np.mean([resid(p) for p in lines])*1000)
for m,grid in [('equidistant',np.arange(150,1500,5)),('stereo',np.arange(100,1500,5)),('k1',np.arange(0,1.5,0.01))]:
    r=[np.mean([resid(und(p,F,m)) for p in lines]) for F in grid]; b=grid[int(np.argmin(r))]
    hf={'equidistant':lambda f:np.degrees(2*(W/2)/f),'stereo':lambda f:np.degrees(4*np.arctan((W/2)/(2*f))),'k1':lambda f:np.nan}[m](b)
    df={'equidistant':lambda f:np.degrees(2*np.hypot(W,H)/2/f),'stereo':lambda f:np.degrees(4*np.arctan(np.hypot(W,H)/2/(2*f))),'k1':lambda f:np.nan}[m](b)
    print(f'{m}: best {b:.2f} resid {min(r)*1000:.2f}e-3 hFOV {hf:.1f} dFOV {df:.1f}')
if len(sys.argv)>3:
    for p in lines:
        for a,b in zip(p[:-1],p[1:]): cv2.line(img,tuple(map(int,a)),tuple(map(int,b)),(0,0,255),1)
    cv2.imwrite(sys.argv[3],img)
