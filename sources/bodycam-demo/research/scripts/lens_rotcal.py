# lens_rotcal.py video motion.npy [maxpairs] -> self-calibration of the lens projection from rotational camera motion.
# Projection family r = f*k*tan(theta/k): k=1 rectilinear, k=2 stereographic, k->inf equidistant.
# For each (f,k): unproject tracked point pairs to rays, fit best rotation (Kabsch), score = median angular residual.
import sys,subprocess,numpy as np,cv2
v,mv=sys.argv[1],sys.argv[2]; maxpairs=int(sys.argv[3]) if len(sys.argv)>3 else 60
W,H=1280,720; cx,cy=(W-1)/2,(H-1)/2; FPS=60
a=np.load(mv); sp=np.hypot(a[:,0],a[:,1])*4   # px/frame @1280
ok=(a[:,2]>0.15)
# slow, steady pans: speed 3..12 px/frame for 8 consecutive frames
cand=[i for i in range(10,len(a)-12) if ok[i:i+8].all() and (sp[i:i+8]>3).all() and (sp[i:i+8]<12).all()]
sel=[];last=-999
for i in cand:
    if i-last>45: sel.append(i); last=i
rng=np.random.default_rng(0)
if len(sel)>maxpairs: sel=sorted(rng.choice(sel,maxpairs,replace=False))
def grab(t):
    r=subprocess.run(['ffmpeg','-v','error','-ss','%.4f'%t,'-i',v,'-frames:v','1','-f','rawvideo','-pix_fmt','gray','-'],capture_output=True)
    return np.frombuffer(r.stdout,np.uint8).reshape(H,W)
yy,xx=np.mgrid[0:H,0:W]
mask=((((xx-cx)/640)**2+((yy-cy)/470)**2)<0.92).astype(np.uint8)*255
mask[:110,:]=0                                   # OSD band
mask[int(H*0.55):,int(W*0.30):int(W*0.80)]=0     # weapon/hands move with camera
P=[];Q=[]
for i in sel:
    t=(i+0.5)/FPS; d=6
    A=grab(t); B=grab(t+d/FPS)
    if A.size==0 or B.size==0: continue
    p0=cv2.goodFeaturesToTrack(A,400,0.01,12,mask=mask)
    if p0 is None or len(p0)<40: continue
    p1,st,err=cv2.calcOpticalFlowPyrLK(A,B,p0,None,winSize=(21,21),maxLevel=4)
    pb,st2,_=cv2.calcOpticalFlowPyrLK(B,A,p1,None,winSize=(21,21),maxLevel=4)
    good=(st[:,0]==1)&(st2[:,0]==1)&(np.linalg.norm(pb-p0,axis=2)[:,0]<0.5)
    if good.sum()<40: continue
    P.append(p0[good,0]); Q.append(p1[good,0])
print('pairs',len(P),'pts',sum(len(p) for p in P))
def rays(p,f,k):
    x=p[:,0]-cx; y=p[:,1]-cy; r=np.hypot(x,y)+1e-9
    th=k*np.arctan(r/(f*k)) if np.isfinite(k) else r/f
    s=np.sin(th)/r; return np.c_[x*s,y*s,np.cos(th)]
def score(f,k):
    res=[]
    for p,q in zip(P,Q):
        u=rays(p,f,k); w=rays(q,f,k)
        best=None
        for it in range(25):   # RANSAC-lite on 3 points then refine on inliers
            idx=rng.choice(len(u),3,replace=False)
            M=w[idx].T@u[idx]; U,S,Vt=np.linalg.svd(M); R=U@np.diag([1,1,np.linalg.det(U@Vt)])@Vt
            e=np.arccos(np.clip(np.sum((u@R.T)*w,1),-1,1))
            n=(e<np.radians(0.15)).sum()
            if best is None or n>best[0]: best=(n,R)
        R=best[1]; e=np.arccos(np.clip(np.sum((u@R.T)*w,1),-1,1)); inl=e<np.radians(0.3)
        if inl.sum()<10: continue
        M=w[inl].T@u[inl]; U,S,Vt=np.linalg.svd(M); R=U@np.diag([1,1,np.linalg.det(U@Vt)])@Vt
        e=np.arccos(np.clip(np.sum((u@R.T)*w,1),-1,1))
        # residual in pixels-equivalent at centre focal (normalise by f so models compare fairly)
        # reprojection error in pixels: rotate rays, project with the model
        z=u@R.T; th=np.arccos(np.clip(z[:,2],-1,1)); rr=(f*k*np.tan(th/k)) if np.isfinite(k) else f*th
        s_=rr/(np.hypot(z[:,0],z[:,1])+1e-12); pp=np.c_[z[:,0]*s_+cx,z[:,1]*s_+cy]
        d=np.linalg.norm(pp-q,axis=1); res.append(np.median(d[d<8]))
    return np.median(res)
def score_E(f,k):
    res=[]
    for p,q in zip(P,Q):
        u=rays(p,f,k); w=rays(q,f,k)
        a2=(u[:,:2]/u[:,2:3]).astype(np.float64); b2=(w[:,:2]/w[:,2:3]).astype(np.float64)
        E,m=cv2.findEssentialMat(a2,b2,focal=1.0,pp=(0.,0.),method=cv2.RANSAC,prob=0.999,threshold=0.0015)
        if E is None: continue
        E=E[:3]
        n=u@E.T; e=np.abs(np.sum(n*w,1))/np.linalg.norm(n,axis=1)
        e=np.degrees(np.arcsin(np.clip(e,0,1)))
        res.append(np.median(e)*np.pi/180*f)
    return np.median(res)
MODE=sys.argv[4] if len(sys.argv)>4 else 'rot'
if MODE=='E': score=score_E
best=None
for k in [1.0,1.25,1.5,1.75,2.0,2.5,3.0,4.0,np.inf]:
    row=[]
    for f in np.arange(250,1400,25):
        rng=np.random.default_rng(1); s=score(f,k); row.append((s,f))
        if best is None or s<best[0]: best=(s,f,k)
    s,f=min(row);
    hf=2*np.degrees(k*np.arctan(640/(f*k)) if np.isfinite(k) else 640/f)
    print(f'k={k:5}: best f={f:.0f}px@1280  med res {s:.3f} px  hFOV(edge)={hf:.1f}')
print('BEST',best)
