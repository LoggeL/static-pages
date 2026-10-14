import sys,glob,os
from PIL import Image,ImageDraw
d,pre=sys.argv[1],sys.argv[2]
fs=sorted(glob.glob(d+'/*.jpg')); per=48; cols=6
for s in range(0,len(fs),per):
    ch=fs[s:s+per]; rows=(len(ch)+cols-1)//cols
    sh=Image.new('RGB',(cols*320,rows*180)); dr=ImageDraw.Draw(sh)
    for k,f in enumerate(ch):
        im=Image.open(f).convert('RGB').resize((320,180)); x=(k%cols)*320;y=(k//cols)*180
        sh.paste(im,(x,y)); t=int(os.path.basename(f)[:5]); dr.rectangle((x,y,x+44,y+14),fill=(0,0,0)); dr.text((x+3,y+2),f"{t//60}:{t%60:02d}",fill=(255,255,0))
    sh.save(f"{pre}_{s//per:02d}.jpg",quality=85)
