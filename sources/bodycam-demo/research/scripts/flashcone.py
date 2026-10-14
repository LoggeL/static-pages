# radial luminance profile around flashlight hotspot; angles via rectilinear f
import sys,numpy as np,cv2
f=float(sys.argv[1])
for p in sys.argv[2:]:
    im=cv2.imread(p); Y=cv2.cvtColor(im,cv2.COLOR_BGR2YCrCb)[:,:,0].astype(float); H,W=Y.shape
    b=cv2.GaussianBlur(Y,(0,0),12); cy,cx=np.unravel_index(np.argmax(b),b.shape)
    yy,xx=np.mgrid[0:H,0:W]
    # angle from hotspot direction
    def ray(x,y): v=np.stack([(x-(W-1)/2)/f,(y-(H-1)/2)/f,np.ones_like(x,float)],-1); return v/np.linalg.norm(v,axis=-1,keepdims=True)
    c=ray(np.array(cx,float),np.array(cy,float)); A=np.degrees(np.arccos(np.clip((ray(xx,yy)*c).sum(-1),-1,1)))
    prof=[];edges=np.arange(0,46,2.5)
    for a0,a1 in zip(edges[:-1],edges[1:]):
        m=(A>=a0)&(A<a1); prof.append(np.median(Y[m]) if m.sum()>50 else np.nan)
    sat=(Y>=245); ang_sat=np.percentile(A[sat],90) if sat.sum()>30 else 0
    print(p.split('/')[-2][:8]+'/'+p.split('/')[-1],'hotspot px',(cx,cy),f'pos {cx/W:.2f},{cy/H:.2f}','sat90pct angle {:.1f}deg'.format(ang_sat),' prof(med Y per 2.5°):',' '.join('%.0f'%v for v in prof))
