# plumb-line calibration via edge chains (OpenCV). usage: lenscal2.py out_prefix frames...
import sys,numpy as np,cv2
W,H=1280,720; cx,cy=(W-1)/2,(H-1)/2
def segments(path):
    g=cv2.imread(path,0); g=cv2.GaussianBlur(g,(3,3),0)
    e=cv2.Canny(g,60,150)
    yy,xx=np.mgrid[0:H,0:W]; ell=((xx-cx)/680)**2+((yy-cy)/510)**2
    e[ell>0.80]=0; e[:,:3]=0;e[:,-3:]=0;e[:3]=0;e[-3:]=0
    cs,_=cv2.findContours(e,cv2.RETR_LIST,cv2.CHAIN_APPROX_NONE)
    segs=[]
    for c in cs:
        p=c[:,0,:].astype(np.float64)
        if len(p)<120: continue
        # contours of thin edges go out and back: take first half up to turnaround via unique ordering
        # split at sharp turns
        k=12; d=p[k:]-p[:-k]; ang=np.arctan2(d[:,1],d[:,0])
        da=np.abs(np.angle(np.exp(1j*(ang[k:]-ang[:-k]))))
        cut=np.nonzero(da>np.radians(25))[0]+k
        bounds=[0]+list(cut)+[len(p)]
        for a,b in zip(bounds[:-1],bounds[1:]):
            s=p[a:b]
            if len(s)<110: continue
            L=np.hypot(*(s[-1]-s[0]))
            if L<100: continue
            segs.append(s)
    return segs
def undist(P,f,model):
    x=P[:,0]-cx;y=P[:,1]-cy; rd=np.hypot(x,y)+1e-9
    if model=='equidistant': th=rd/f
    elif model=='stereo': th=2*np.arctan(rd/(2*f))
    elif model=='equisolid': th=2*np.arcsin(np.clip(rd/(2*f),0,1))
    elif model=='div':  # division model, f = 1/k scale: ru = rd/(1-(rd/f)^2)
        q=1-(rd/f)**2; ru=np.where(q>0.05,rd/np.maximum(q,0.05),np.nan); return np.c_[x*ru/rd,y*ru/rd]
    ru=np.where(th<np.radians(80),f*np.tan(np.minimum(th,np.radians(80))),np.nan)
    return np.c_[x*ru/rd,y*ru/rd]
def straight(Q):
    Q=Q[~np.isnan(Q).any(1)]
    if len(Q)<50: return np.nan
    Q=Q-Q.mean(0); u,s,vt=np.linalg.svd(Q,full_matrices=False)
    return s[1]/s[0]
segs=[]
for f in sys.argv[2:]: segs+=segments(f)
print('segments',len(segs))
# weight: only segments whose midpoint radius > 250 px (centre ones carry no info)
segs=[s for s in segs if np.hypot(*(s.mean(0)-[cx,cy]))>220]
print('off-centre segments',len(segs))
for model,grid in [('equidistant',np.arange(350,1600,25)),('stereo',np.arange(250,1600,25)),('div',np.arange(700,4000,50))]:
    res=[]
    for F in grid:
        v=np.array([straight(undist(s,F,model)) for s in segs]); v=v[~np.isnan(v)]
        res.append((F,np.median(v),np.mean(np.sort(v)[:int(len(v)*0.6)])))
    res=np.array(res); b=res[res[:,2].argmin()]
    if model=='equidistant': fov=np.degrees(2*640/b[0])
    elif model=='stereo': fov=np.degrees(4*np.arctan(640/(2*b[0])))
    else: fov=float('nan')
    print(model,'best',b[0],'trim-mean',round(b[2],5),'median',round(b[1],5),'hFOV',round(fov,1))
    print('   ',' '.join(f'{int(F)}:{m:.4f}' for F,_,m in res[::2]))
