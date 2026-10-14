# focal length from orthogonal vanishing points (rectilinear assumption). usage: vpfocal.py frames...
import sys,numpy as np,cv2
rng=np.random.default_rng(1)
def segs(path):
    g=cv2.imread(path,0); H,W=g.shape
    try: lsd=cv2.createLineSegmentDetector(); L=lsd.detect(g)[0]
    except Exception: L=None
    if L is None:
        e=cv2.Canny(cv2.GaussianBlur(g,(3,3),0),50,140)
        L=cv2.HoughLinesP(e,1,np.pi/720,60,minLineLength=60,maxLineGap=4)
    L=L.reshape(-1,4).astype(float)
    cx,cy=(W-1)/2,(H-1)/2
    ln=np.hypot(L[:,2]-L[:,0],L[:,3]-L[:,1])
    mx,my=(L[:,0]+L[:,2])/2,(L[:,1]+L[:,3])/2
    ell=((mx-cx)/640)**2+((my-cy)/470)**2
    keep=(ln>45)&(ell<0.85)
    return L[keep],ln[keep],(cx,cy)
def homog(L):
    p1=np.c_[L[:,0],L[:,1],np.ones(len(L))]; p2=np.c_[L[:,2],L[:,3],np.ones(len(L))]
    l=np.cross(p1,p2); return l/np.linalg.norm(l[:,:2],axis=1,keepdims=True)
def ang_err(v,L):
    # angle between segment and line from midpoint to vp
    m=np.c_[(L[:,0]+L[:,2])/2,(L[:,1]+L[:,3])/2]; d=np.c_[L[:,2]-L[:,0],L[:,3]-L[:,1]]
    if abs(v[2])<1e-9: t=np.tile(v[:2],(len(L),1))
    else: t=v[:2]/v[2]-m
    c=np.abs((d*t).sum(1))/(np.linalg.norm(d,axis=1)*np.linalg.norm(t,axis=1)+1e-9)
    return np.degrees(np.arccos(np.clip(c,0,1)))
def ransac(L,w,thr=1.5,it=600):
    l=homog(L); best=None
    for _ in range(it):
        i,j=rng.choice(len(L),2,replace=False); v=np.cross(l[i],l[j])
        if np.linalg.norm(v)<1e-12: continue
        v=v/np.linalg.norm(v); inl=ang_err(v,L)<thr; s=w[inl].sum()
        if best is None or s>best[0]: best=(s,v,inl)
    # refine: least squares on inliers (smallest singular vector)
    s,v,inl=best; A=l[inl]*w[inl,None]; v=np.linalg.svd(A)[2][-1]; inl=ang_err(v,L)<thr
    return v,inl
fs=[]
for f in sys.argv[1:]:
    L,ln,(cx,cy)=segs(f)
    if len(L)<30: continue
    vps=[];rem=np.ones(len(L),bool)
    for k in range(3):
        if rem.sum()<12: break
        v,inl=ransac(L[rem],ln[rem]); idx=np.nonzero(rem)[0]
        if inl.sum()<8: break
        vps.append((v,inl.sum())); rem[idx[inl]]=False
    res=[]
    for a in range(len(vps)):
        for b in range(a+1,len(vps)):
            v1,v2=vps[a][0],vps[b][0]
            if abs(v1[2])<1e-9 or abs(v2[2])<1e-9: continue
            p1=v1[:2]/v1[2]-[cx,cy]; p2=v2[:2]/v2[2]-[cx,cy]
            q=-(p1@p2)
            if q>0 and np.linalg.norm(p1)<8000 and np.linalg.norm(p2)<8000:
                res.append(np.sqrt(q)); fs.append(np.sqrt(q))
    print(f.split('/')[-2][:10],f.split('/')[-1],'segs',len(L),'vps',[(int(n)) for _,n in vps],'f',[round(x) for x in res])
fs=np.array(fs)
print('N',len(fs),'median f',np.median(fs).round(1),'IQR',np.percentile(fs,[25,75]).round(1))
h,e=np.histogram(fs,bins=np.arange(150,1500,50)); print('hist',' '.join(f'{int(a)}:{c}' for a,c in zip(e[:-1],h)))
for fm in [np.median(fs)]:
    print('rect hFOV',np.degrees(2*np.arctan(640/fm)).round(1),'vFOV',np.degrees(2*np.arctan(360/fm)).round(1),'dFOV',np.degrees(2*np.arctan(734.4/fm)).round(1))
