# match local 1fps frames to probe thumbnails -> source id + offset
import glob,os,numpy as np
from PIL import Image
R='/Users/logge/Documents/Projects/bodycam-work/ref'
def th(f):
    a=np.asarray(Image.open(f).convert('L').resize((48,27)),np.float32); a-=a.mean(); n=np.linalg.norm(a)+1e-6; return (a/n).ravel()
loc={}
for d in sorted(glob.glob(R+'/all/*')):
    fs=sorted(glob.glob(d+'/*.jpg')); loc[os.path.basename(d)]=(np.stack([th(f) for f in fs]),fs)
for p in sorted(glob.glob(R+'/search/probe_*')):
    pid=p.split('probe_')[1]; fs=sorted(glob.glob(p+'/*.jpg'))
    if not fs: continue
    P=np.stack([th(f) for f in fs]); ts=[int(os.path.basename(f)[:5]) for f in fs]
    for name,(L,lf) in loc.items():
        S=P@L.T; best=S.max(1); idx=S.argmax(1)
        good=[(ts[i],idx[i]+1,round(float(best[i]),3)) for i in range(len(ts)) if best[i]>0.93]
        if len(good)>=1:
            offs=[t-(j-1) for t,j,_ in good]
            print(pid,name,len(good),'offsets',sorted(offs)[:6])
