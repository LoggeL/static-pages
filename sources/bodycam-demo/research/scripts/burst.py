# burst.py video t0 t1 fps out.jpg [cols] [w]  -> labeled sheet of frames
import sys,subprocess,io,numpy as np
from PIL import Image,ImageDraw
v,t0,t1,fps,out=sys.argv[1],float(sys.argv[2]),float(sys.argv[3]),float(sys.argv[4]),sys.argv[5]
cols=int(sys.argv[6]) if len(sys.argv)>6 else 8; W=int(sys.argv[7]) if len(sys.argv)>7 else 240; H=W*9//16
r=subprocess.run(['ffmpeg','-v','error','-ss',str(t0),'-i',v,'-t',str(t1-t0),'-vf',f'fps={fps},scale={W}:{H}','-f','rawvideo','-pix_fmt','rgb24','-'],capture_output=True)
a=np.frombuffer(r.stdout,np.uint8).reshape(-1,H,W,3); n=len(a); rows=(n+cols-1)//cols
sh=Image.new('RGB',(cols*W,rows*H)); d=ImageDraw.Draw(sh)
for k in range(n):
    x=(k%cols)*W;y=(k//cols)*H; sh.paste(Image.fromarray(a[k]),(x,y)); d.rectangle((x,y,x+46,y+12),fill=(0,0,0)); d.text((x+2,y+1),f"{t0+k/fps:.2f}",fill=(255,255,0))
sh.save(out,quality=88); print(n,'frames')
