import sys,numpy as np
from PIL import Image
f=sys.argv[1]
m=np.asarray(Image.open(f).convert('RGB'),np.float32)/255; L=m.mean(2); H,W=L.shape; cx,cy=(W-1)/2,(H-1)/2
inner=np.median(L[int(H*.3):int(H*.7),int(W*.3):int(W*.7)])
pts=[]
for ang in np.radians(np.arange(5,90,2.5)):
  for q in [1,-1]:
    for sx in [1,-1]:
      dx,dy=np.cos(ang)*sx,np.sin(ang)*q
      prof=[];last=None
      for s in np.arange(200,900,0.5):
        x,y=cx+dx*s,cy+dy*s
        if x<0 or y<0 or x>W-1 or y>H-1: break
        v=L[int(round(y)),int(round(x))]
        if v<0.5*inner: pts.append((x-cx,y-cy,np.degrees(ang))); break
P=np.array(pts)
if len(P):
  # fit x^2/a^2+y^2/b^2=1 via least squares on (x^2,y^2)
  A=np.c_[P[:,0]**2,P[:,1]**2]; sol=np.linalg.lstsq(A,np.ones(len(P)),rcond=None)[0]
  a,b=1/np.sqrt(sol); print(f'{f.split("/")[-1]}: n={len(P)} a={a:.1f}px ({a/(W/2):.3f} W/2) b={b:.1f}px ({b/(H/2):.3f} H/2) a/b={a/b:.3f}  resid={np.std(P[:,0]**2/a**2+P[:,1]**2/b**2-1):.3f}')
  r=np.hypot(P[:,0]/a,P[:,1]/b)
# edge ring colour: sample along 45deg ray near boundary
ang=np.radians(35); prof=[]
for s in np.arange(500,800,2):
  x,y=cx-np.cos(ang)*s,cy-np.sin(ang)*s
  if x<0 or y<0: break
  prof.append((round(s),*(m[int(y),int(x)]*255).round().astype(int)))
print(' ring profile (s, R,G,B):',prof[::4])
