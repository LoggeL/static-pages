# gridsheet.py out.jpg cols tileW file... -> sheet with 10% grid lines and labels
import sys,os
from PIL import Image,ImageDraw
out,cols,tw=sys.argv[1],int(sys.argv[2]),int(sys.argv[3]); fs=sys.argv[4:]; th=tw*9//16
rows=(len(fs)+cols-1)//cols; sh=Image.new('RGB',(cols*tw,rows*th)); d=ImageDraw.Draw(sh)
for k,f in enumerate(fs):
    x=(k%cols)*tw;y=(k//cols)*th; sh.paste(Image.open(f).convert('RGB').resize((tw,th)),(x,y))
    for i in range(1,10):
        c=(0,255,255) if i==5 else (255,255,0)
        d.line((x+tw*i//10,y,x+tw*i//10,y+th),fill=c,width=1); d.line((x,y+th*i//10,x+tw,y+th*i//10),fill=c,width=1)
    lab=f.split('/')[-2][:8]+'/'+os.path.basename(f); d.rectangle((x,y,x+8*len(lab)//1.3,y+12),fill=(0,0,0)); d.text((x+2,y+1),lab,fill=(255,255,255))
sh.save(out,quality=90)
