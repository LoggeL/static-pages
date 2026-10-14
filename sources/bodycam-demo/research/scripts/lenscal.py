# plumb-line auto calibration: find fisheye focal f (px @1280x720) maximizing Hough line concentration
import sys,glob,numpy as np
from PIL import Image
W,H=1280,720; cx,cy=(W-1)/2,(H-1)/2
def edges(f):
    a=np.asarray(Image.open(f).convert('L'),np.float32)
    gx=np.zeros_like(a);gy=np.zeros_like(a)
    gx[1:-1,1:-1]=(a[1:-1,2:]-a[1:-1,:-2])*2+(a[:-2,2:]-a[:-2,:-2])+(a[2:,2:]-a[2:,:-2])
    gy[1:-1,1:-1]=(a[2:,1:-1]-a[:-2,1:-1])*2+(a[2:,:-2]-a[:-2,:-2])+(a[2:,2:]-a[:-2,2:])
    m=np.hypot(gx,gy)
    # NMS (4 dirs)
    ang=(np.round(np.arctan2(gy,gx)/(np.pi/4))%4).astype(int)
    nms=np.zeros_like(m,bool)
    for k,(dy,dx) in enumerate([(0,1),(1,1),(1,0),(1,-1)]):
        s=(ang==k)
        n1=np.roll(np.roll(m,dy,0),dx,1); n2=np.roll(np.roll(m,-dy,0),-dx,1)
        nms|=s&(m>=n1)&(m>=n2)
    y,x=np.nonzero(nms&(m>np.percentile(m,93)))
    # inside lens mask ellipse (shrunk) and not too close to border
    e=((x-cx)/650)**2+((y-cy)/480)**2
    k=(e<0.92)&(x>4)&(x<W-5)&(y>4)&(y<H-5)
    return x[k]-cx,y[k]-cy,m[y[k],x[k]],a.var()
def sharp(f):
    a=np.asarray(Image.open(f).convert('L').resize((320,180)),np.float32)
    l=a[1:-1,1:-1]*4-a[:-2,1:-1]-a[2:,1:-1]-a[1:-1,:-2]-a[1:-1,2:]; return l.var()
def undist(x,y,f,model):
    rd=np.hypot(x,y)+1e-9
    if model=='equidistant': th=rd/f
    elif model=='stereo': th=2*np.arctan(rd/(2*f))
    elif model=='equisolid': th=2*np.arcsin(np.clip(rd/(2*f),0,0.9999))
    elif model=='orthographic': th=np.arcsin(np.clip(rd/f,0,0.9999))
    ok=th<np.radians(78)
    ru=f*np.tan(np.minimum(th,np.radians(78)))
    return x*ru/rd,y*ru/rd,ok
TH=np.linspace(0,np.pi,360,endpoint=False); C,S=np.cos(TH),np.sin(TH)
def score(x,y,w):
    rho=np.outer(x,C)+np.outer(y,S)  # N x 360
    rb=np.round(rho/1.5).astype(np.int64); rb-=rb.min()
    idx=rb*360+np.arange(360)[None,:]
    acc=np.bincount(idx.ravel(),weights=np.repeat(w[:,None],360,1).ravel())
    return (acc**2).sum()/ (w.sum()**2)
files=sys.argv[2:]; model=sys.argv[1]
fs=np.arange(300,1400,25)
tot=np.zeros(len(fs))
for f in files:
    x,y,m,_=edges(f)
    if len(x)>20000:
        sel=np.random.default_rng(0).choice(len(x),20000,replace=False); x,y,m=x[sel],y[sel],m[sel]
    w=np.ones(len(x))
    sc=[]
    for F in fs:
        xu,yu,ok=undist(x,y,F,model); sc.append(score(xu[ok],yu[ok],w[ok]))
    sc=np.array(sc); sc/=sc.max(); tot+=sc
    print(f.split('/')[-2][:12],f.split('/')[-1],'best f',fs[sc.argmax()],'hFOV',round(np.degrees(2*{'equidistant':lambda r:r/fs[sc.argmax()],'stereo':lambda r:2*np.arctan(r/(2*fs[sc.argmax()])),'equisolid':lambda r:2*np.arcsin(min(r/(2*fs[sc.argmax()]),1)),'orthographic':lambda r:np.arcsin(min(r/fs[sc.argmax()],1))}[model](640)),1))
b=fs[tot.argmax()]; print('ALL',model,'best f',b, ' curve:',' '.join(f'{F}:{t/len(files):.3f}' for F,t in zip(fs,tot)))
