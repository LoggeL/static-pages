# motion.py video out.npy [fps] : per-frame global translation (phase correlation) on upper-central region, 320x180
import sys,subprocess,numpy as np,cv2
v,out=sys.argv[1],sys.argv[2]; fps=float(sys.argv[3]) if len(sys.argv)>3 else 60
W,H=320,180
p=subprocess.Popen(['ffmpeg','-v','error','-i',v,'-vf',f'fps={fps},scale={W}:{H}','-f','rawvideo','-pix_fmt','gray','-'],stdout=subprocess.PIPE)
win=cv2.createHanningWindow((200,96),cv2.CV_32F)
prev=None;res=[]
while True:
    b=p.stdout.read(W*H)
    if len(b)<W*H: break
    a=np.frombuffer(b,np.uint8).reshape(H,W).astype(np.float32)
    roi=a[14:110,60:260]  # upper-central region (avoid weapon at bottom and mask corners)
    if prev is not None:
        (dx,dy),resp=cv2.phaseCorrelate(prev,roi,win)
        res.append((dx,dy,resp,roi.mean(),a.mean()))
    else: res.append((0,0,0,roi.mean(),a.mean()))
    prev=roi
np.save(out,np.array(res,np.float32)); print(out,len(res))
