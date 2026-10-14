# maskprofile.py mean.png a b -> RGB profile vs elliptical radius rho=sqrt((x/a)^2+(y/b)^2), averaged over angles (excl. top OSD and bottom weapon)
import sys,numpy as np
from PIL import Image
m=np.asarray(Image.open(sys.argv[1]).convert('RGB'),np.float32); H,W,_=m.shape; cx,cy=(W-1)/2,(H-1)/2
a,b=float(sys.argv[2]),float(sys.argv[3])
yy,xx=np.mgrid[0:H,0:W]; rho=np.sqrt(((xx-cx)/a)**2+((yy-cy)/b)**2); ang=np.degrees(np.arctan2(yy-cy,xx-cx))
sel=((np.abs(ang)<35)|(np.abs(ang)>145))  # left/right sectors only (cleanest)
for r0 in np.arange(0.0,1.12,0.02):
    k=sel&(rho>=r0)&(rho<r0+0.02)
    if k.sum()<20: continue
    c=m[k].mean(0); print(f'rho {r0:.2f}-{r0+0.02:.2f} n={k.sum():6d} RGB {c[0]:6.1f} {c[1]:6.1f} {c[2]:6.1f}  L {c.mean():6.1f}')
c=m[(rho>1.08)].mean(0); print('outside (rho>1.08) RGB',c.round(1))
