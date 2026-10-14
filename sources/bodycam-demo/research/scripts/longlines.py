# longlines.py frames... -> long straight segments (LSD) and how far off-centre they reach; evidence for/against fisheye.
# Additionally: sagitta test - sample edge points along each long segment on the real image gradient and fit a circle/line.
import sys,numpy as np,cv2
W,H=1280,720; cx,cy=(W-1)/2,(H-1)/2
tot=[];
for p in sys.argv[1:]:
    g=cv2.imread(p,0); lsd=cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD); L=lsd.detect(g)[0]
    if L is None: continue
    L=L.reshape(-1,4); ln=np.hypot(L[:,2]-L[:,0],L[:,3]-L[:,1]); L=L[ln>220]; ln=ln[ln>220]
    for (x0,y0,x1,y1),l in zip(L,ln):
        # perpendicular distance of the line from image centre (fisheye bends lines with large offset most)
        d=abs((x1-x0)*(cy-y0)-(y1-y0)*(cx-x0))/l
        rmax=max(np.hypot(x0-cx,y0-cy),np.hypot(x1-cx,y1-cy))
        tot.append((l,d,rmax,p.split('/')[-2][:6]+'/'+p.split('/')[-1]))
tot.sort(key=lambda t:-t[1]*t[0])
print('long segments >220px:',len(tot))
for t in tot[:25]: print('len %4.0f  offset-from-centre %4.0f  rmax %4.0f  %s'%t)
# predicted sagitta for equidistant fisheye f=405 of a straight line at offset d spanning length l (approx)
f=405
for d in [150,250,350]:
    for l in [300,500]:
        # world line at angle: offset d in rectilinear(f) -> map through equidistant and measure sagitta
        xs=np.linspace(-l/2,l/2,50); ys=np.full_like(xs,d); r=np.hypot(xs,ys); th=np.arctan(r/f); rd=f*th; s=rd/r
        X=xs*s;Y=ys*s; sag=Y.max()-Y.min()
        print(f'equidistant f={f}: straight line offset {d}px length {l}px would bow by ~{sag:.0f}px')
