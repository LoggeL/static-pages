# bob2: periodic camera bob via band-passed angular signals + autocorrelation
import sys,numpy as np
from scipy.signal import butter,sosfiltfilt
v,fpx,fps=sys.argv[1],float(sys.argv[2]),float(sys.argv[3])
a=np.load(v); dx,dy,resp=a[:,0].copy(),a[:,1].copy(),a[:,2]
bad=resp<0.08; dx[bad]=0; dy[bad]=0
pit=np.cumsum(np.degrees(np.arctan(dy/fpx))); yaw=np.cumsum(np.degrees(np.arctan(dx/fpx)))
sos=butter(2,[0.9,6],'bandpass',fs=fps,output='sos'); P=sosfiltfilt(sos,pit); Y=sosfiltfilt(sos,yaw)
yr=np.abs(np.gradient(sosfiltfilt(butter(2,0.8,'low',fs=fps,output='sos'),yaw)))*fps
N=int(4*fps); out=[]
for s in range(0,len(a)-N,int(fps)):
    if bad[s:s+N].mean()>0.05 or yr[s:s+N].mean()>25: continue
    p=P[s:s+N]-P[s:s+N].mean();
    if p.std()<0.08: continue
    ac=np.correlate(p,p,'full')[N-1:]; ac/=ac[0]
    lo,hi=int(0.28*fps),int(1.0*fps); k=lo+np.argmax(ac[lo:hi])
    if ac[k]<0.45: continue
    y=Y[s:s+N]-Y[s:s+N].mean(); acy=np.correlate(y,y,'full')[N-1:]; acy/=acy[0]
    lo2,hi2=int(0.5*fps),int(1.6*fps); k2=lo2+np.argmax(acy[lo2:hi2])
    out.append((s/fps,fps/k,ac[k],np.percentile(p,95)-np.percentile(p,5),fps/k2,acy[k2],np.percentile(y,95)-np.percentile(y,5)))
O=np.array(out)
print(v,'periodic windows',len(O))
for o in O: print('  t=%5.1f  pitch f=%.2fHz (ac %.2f) p-p %.2f° | yaw f=%.2fHz (ac %.2f) p-p %.2f°'%tuple(o))
if len(O): print(' MEDIAN pitch f %.2f Hz p-p %.2f° ; yaw f %.2f Hz p-p %.2f°'%(np.median(O[:,1]),np.median(O[:,3]),np.median(O[:,4]),np.median(O[:,6])))
