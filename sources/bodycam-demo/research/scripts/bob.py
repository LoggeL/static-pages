import sys,numpy as np
v,fpx,fps=sys.argv[1],float(sys.argv[2]),float(sys.argv[3])
a=np.load(v); dx,dy,resp=a[:,0],a[:,1],a[:,2]
dx[resp<0.08]=0; dy[resp<0.08]=0
yaw=np.degrees(np.arctan(dx/fpx))*fps; pit=np.degrees(np.arctan(dy/fpx))*fps   # deg/s
print(v.split('/')[-1],'frames',len(a),'yaw-rate |p50,p90,p99| deg/s',np.percentile(np.abs(yaw),[50,90,99]).round(1),'pitch-rate',np.percentile(np.abs(pit),[50,90,99]).round(1))
N=int(3.0*fps); hits=[]
for s in range(0,len(a)-N,int(fps/2)):
    y=np.cumsum(np.degrees(np.arctan(dy[s:s+N]/fpx))); x=np.cumsum(np.degrees(np.arctan(dx[s:s+N]/fpx)))
    if np.mean(resp[s:s+N])<0.25: continue
    t=np.arange(N)/fps; y=y-np.polyval(np.polyfit(t,y,2),t); x=x-np.polyval(np.polyfit(t,x,2),t)
    Y=np.abs(np.fft.rfft(y*np.hanning(N),8*N)); X=np.abs(np.fft.rfft(x*np.hanning(N),8*N)); fr=np.fft.rfftfreq(8*N,1/fps)
    band=(fr>1.2)&(fr<3.5)
    if Y[band].max()>3*np.median(Y[(fr>0.5)&(fr<8)]) and np.abs(np.degrees(np.arctan(dx[s:s+N]/fpx))).sum()<35 and np.std(y)>0.2:
        fy=fr[band][Y[band].argmax()]; bandx=(fr>0.6)&(fr<2.0); fx=fr[bandx][X[bandx].argmax()]
        hits.append((s/fps,fy,(y.max()-y.min())/2,fx,(x.max()-x.min())/2,np.std(y),np.std(x)))
H=np.array(hits)
if len(H):
    print('  walking-like windows',len(H))
    for h in H[:: max(1,len(H)//8)]: print('   t=%.1fs  f_pitch=%.2fHz amp_pitch=±%.2f° | f_yaw=%.2fHz amp_yaw=±%.2f°  (sd %.2f/%.2f)'%tuple(h))
    print('  MEDIAN f_pitch %.2f Hz  amp ±%.2f°  sd %.2f° | f_yaw %.2f Hz amp ±%.2f° sd %.2f°'%(np.median(H[:,1]),np.median(H[:,2]),np.median(H[:,5]),np.median(H[:,3]),np.median(H[:,4]),np.median(H[:,6])))
