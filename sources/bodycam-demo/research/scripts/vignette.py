# mean frame per video -> vignette profile + mask boundary
import glob,os,sys,numpy as np
from PIL import Image
R='/Users/logge/Documents/Projects/bodycam-work/ref'
out=R+'/analysis'; os.makedirs(out,exist_ok=True)
for v in sys.argv[1:]:
    fs=sorted(glob.glob(f'{R}/all/{v}/*.jpg'))
    acc=None;n=0
    for f in fs:
        a=np.asarray(Image.open(f).convert('RGB'),np.float32)/255
        if a.mean()<0.03: continue
        acc=a if acc is None else acc+a; n+=1
    m=acc/n; Image.fromarray((m/m.max()*255).clip(0,255).astype(np.uint8)).save(f'{out}/mean_{v}.png')
    L=m.mean(2); H,W=L.shape; cy,cx=H/2,W/2
    c=L[int(H*0.4):int(H*0.6),int(W*0.4):int(W*0.6)].mean()
    # horizontal profile through center row and diagonal
    row=L[int(cy)-3:int(cy)+3].mean(0)/c
    print(v,'n',n,'center',round(c,3))
    print('  row x/W:',' '.join(f'{x/W:.2f}:{row[x]:.2f}' for x in range(0,W//2,40)))
    col=L[:,int(cx)-3:int(cx)+3].mean(1)/c
    print('  col y/H:',' '.join(f'{y/H:.2f}:{col[y]:.2f}' for y in range(0,H//2,36)))
    # diagonal
    t=np.linspace(0,0.5,26); d=[L[int(H*tt),int(W*tt)]/c for tt in t]
    print('  diag t:',' '.join(f'{tt:.2f}:{dd:.2f}' for tt,dd in zip(t,d)))
    # mask boundary: where profile drops below 0.25 along rays
    r=[]
    for ang in np.linspace(0,np.pi/2,10):
        for s in np.linspace(0,1.2,600):
            x=cx+s*cx*np.cos(ang)*1.0; y=cy-s*cx*np.sin(ang)
            if x>=W-1 or y<=0: r.append((round(np.degrees(ang)),None)); break
            if L[int(y),int(x)]/c<0.3: r.append((round(np.degrees(ang)),round(np.hypot(x-cx,y-cy)/ (W/2),3))); break
    print('  r(0.3) / (W/2) by angle:',r)
