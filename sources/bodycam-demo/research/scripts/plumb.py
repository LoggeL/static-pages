# plumb.py img "x0,y0,x1,y1;..." [out.png] -> snap approximate segments to real edges, then test lens models by straightness.
# models: polynomial barrel r_u = r_d*(1+k1*rn^2) (rn = r_d/(W/2)) and family r_d = f*k*tan(theta/k) -> rectilinear target.
import sys,numpy as np,cv2
img=cv2.imread(sys.argv[1]); g=cv2.GaussianBlur(cv2.cvtColor(img,cv2.COLOR_BGR2GRAY).astype(np.float32),(0,0),1.0)
H,W=g.shape; cx,cy=(W-1)/2,(H-1)/2
gx=cv2.Sobel(g,cv2.CV_32F,1,0,ksize=3); gy=cv2.Sobel(g,cv2.CV_32F,0,1,ksize=3)
lines=[]
for spec in sys.argv[2].split(';'):
    x0,y0,x1,y1=map(float,spec.split(',')); L=np.hypot(x1-x0,y1-y0); t=np.array([x1-x0,y1-y0])/L; n=np.array([-t[1],t[0]])
    pts=[]
    for s in np.linspace(0.03,0.97,int(L/6)):
        p=np.array([x0,y0])+s*L*t; best=None
        for o in np.arange(-14,14.5,0.5):
            q=p+o*n; xi,yi=int(round(q[0])),int(round(q[1]))
            if not(2<xi<W-2 and 2<yi<H-2): continue
            m=abs(gx[yi,xi]*n[0]+gy[yi,xi]*n[1])
            if best is None or m>best[0]: best=(m,q)
        if best and best[0]>25: pts.append(best[1])
    P=np.array(pts)
    # iterative outlier rejection vs. quadratic fit
    for _ in range(3):
        if len(P)<8: break
        u=(P-P.mean(0))@t; v=(P-P.mean(0))@n; c=np.polyfit(u,v,2); r=v-np.polyval(c,u); P=P[np.abs(r)<max(2.5*r.std(),1.0)]
    lines.append(P)
def straight(Q):
    Q=Q-Q.mean(0); u,s,vt=np.linalg.svd(Q,full_matrices=False); return np.sqrt(((Q@vt[1])**2).mean())/np.ptp(Q@vt[0])
def sag(Q):  # signed sagitta in px of a quadratic fit
    Q=Q-Q.mean(0); u,s,vt=np.linalg.svd(Q,full_matrices=False); a=Q@vt[0]; b=Q@vt[1]; c=np.polyfit(a,b,2); h=np.ptp(a)/2; return c[0]*h*h
for i,P in enumerate(lines):
    off=np.hypot(*(P.mean(0)-[cx,cy]))
    print(f'line {i}: n={len(P)} len={np.ptp(P[:,0])+0:.0f}x{np.ptp(P[:,1]):.0f} mid-offset {off:.0f}px  rms/len {straight(P)*1000:.2f}e-3  sagitta {sag(P):+.1f}px')
def und_k1(P,k1):
    x=P[:,0]-cx;y=P[:,1]-cy; s=1+k1*((x*x+y*y)/(W/2)**2); return np.c_[x*s,y*s]
def und_fk(P,f,k):
    x=P[:,0]-cx;y=P[:,1]-cy; r=np.hypot(x,y)+1e-9; th=k*np.arctan(r/(f*k)) if np.isfinite(k) else r/f
    th=np.minimum(th,np.radians(88)); s=f*np.tan(th)/r; return np.c_[x*s,y*s]
good=[P for P in lines if len(P)>=8]
base=np.mean([straight(P) for P in good])
print('raw (rectilinear) mean rms/len %.2fe-3'%(base*1000))
ks=np.arange(-0.2,0.81,0.01); r=[np.mean([straight(und_k1(P,k)) for P in good]) for k in ks]; i=int(np.argmin(r))
print('poly barrel k1 best %.2f  -> %.2fe-3'%(ks[i],r[i]*1000))
for k in [2.0,np.inf]:
    fs=np.arange(250,3000,10); r=[np.mean([straight(und_fk(P,f,k)) for P in good]) for f in fs]; i=int(np.argmin(r))
    print('fisheye k=%s best f %.0f -> %.2fe-3 (hFOV %.1f)'%(k,fs[i],r[i]*1000, 2*np.degrees((k*np.arctan(640/(fs[i]*k))) if np.isfinite(k) else 640/fs[i])))
if len(sys.argv)>3:
    for P in lines:
        for q in P: cv2.circle(img,(int(q[0]),int(q[1])),2,(0,0,255),-1)
    cv2.imwrite(sys.argv[3],img)
