# recoil.py motion.npy wav fpx fps : shots from audio (peak>-4dBFS isolated) -> camera trajectory around shot
import sys,wave,numpy as np
mv,wv,fpx,fps=sys.argv[1],sys.argv[2],float(sys.argv[3]),float(sys.argv[4])
w=wave.open(wv); sr=w.getframerate(); x=np.frombuffer(w.readframes(w.getnframes()),np.int16).astype(np.float32)/32768
hop=sr//200; n=len(x)//hop; pk=np.abs(x[:n*hop].reshape(n,hop)).max(1)
db=20*np.log10(pk+1e-9); shots=[];last=-1e9
for i in range(1,n):
    if db[i]>-4 and db[i-1]<db[i]-6 and i-last>40: shots.append(i/200); last=i
a=np.load(mv); dx,dy,resp=a[:,0],a[:,1],a[:,2]; lum=a[:,4]
pit=np.cumsum(-np.degrees(np.arctan(dy/fpx))); yaw=np.cumsum(np.degrees(np.arctan(dx/fpx)))  # pitch up positive (image moves down)
T=[]
for t in shots:
    k=int(round(t*fps))
    if k<12 or k+48>=len(a) or resp[k-6:k+40].min()<0.05: continue
    p=pit[k-6:k+48]-pit[k-1]; y=yaw[k-6:k+48]-yaw[k-1]; L=lum[k-6:k+48]
    T.append((t,p,y,L))
print('shots',len(shots),'usable',len(T))
if T:
    P=np.array([q[1] for q in T]); Y=np.array([q[2] for q in T]); L=np.array([q[3] for q in T])
    tt=(np.arange(-6,48))/fps*1000
    mp=np.median(P,0); my=np.median(Y,0); ml=np.median(L/L[:,:6].mean(1,keepdims=True),0)
    for i in range(0,len(tt),2): print(f'  {tt[i]:6.0f} ms  pitch {mp[i]:+.2f}°  yaw {my[i]:+.2f}°  lum x{ml[i]:.2f}')
    pkk=np.argmax(np.abs(mp)); print('peak pitch',mp[pkk].round(2),'at',tt[pkk].round(),'ms; per-shot peak pitch p25/50/75',np.percentile(P.max(1),[25,50,75]).round(2),' |yaw| peak',np.percentile(np.abs(Y).max(1),[25,50,75]).round(2))
