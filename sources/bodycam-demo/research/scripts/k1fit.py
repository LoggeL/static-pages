# reuse groove tracker, fit polynomial radial k1 (normalized by W/2): r_u = r_d*(1+k1*rn^2+k2*rn^4)
import sys,numpy as np,runpy
sys.argv=['groove.py']+sys.argv[1:7]
ns=runpy.run_path(__file__.replace('k1fit.py','groove.py'))
lines=ns['lines']; resid=ns['resid']; cx,cy=ns['cx'],ns['cy']
def und(P,k1):
    x=P[:,0]-cx;y=P[:,1]-cy; rn2=(x*x+y*y)/640**2; s=1+k1*rn2; return np.c_[x*s,y*s]
ks=np.arange(-0.3,0.61,0.02); r=[np.mean([resid(und(p,k)) for p in lines]) for k in ks]
print('k1 best',round(ks[int(np.argmin(r))],2),' curve',' '.join(f'{k:.2f}:{v*1000:.2f}' for k,v in zip(ks[::3],r[::3])))
print('max r of tracked pts (px):',max(np.hypot(p[:,0]-cx,p[:,1]-cy).max() for p in lines).round())
