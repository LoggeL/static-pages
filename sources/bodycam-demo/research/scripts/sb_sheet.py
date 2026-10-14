# storyboard mhtml -> contact sheets with timestamps
import sys, email, re, io
from PIL import Image, ImageDraw
src, outprefix = sys.argv[1], sys.argv[2]
msg = email.message_from_binary_file(open(src,'rb'))
html=None; imgs=[]
for part in msg.walk():
    ct=part.get_content_type()
    if ct=='text/html': html=part.get_payload(decode=True).decode()
    elif ct.startswith('image/'):
        data=part.get_payload(decode=True)
        try: imgs.append(Image.open(io.BytesIO(data)).convert('RGB'))
        except Exception:
            import subprocess,tempfile,os
            tf=tempfile.mktemp(suffix='.webp'); open(tf,'wb').write(data)
            r=subprocess.run(['ffmpeg','-v','error','-y','-i',tf,'-f','image2pipe','-vcodec','png','-'],capture_output=True)
            os.remove(tf)
            try: imgs.append(Image.open(io.BytesIO(r.stdout)).convert('RGB'))
            except Exception: imgs.append(Image.new('RGB',(800,450)))
slides=re.findall(r'(\d\d):(\d\d):(\d\d),(\d+) – (\d\d):(\d\d):(\d\d),(\d+)',html)
tiles=[]
for (a,b,c,d,e,f,g,h),im in zip(slides,imgs):
    t0=int(a)*3600+int(b)*60+int(c)+int(d)/1000; t1=int(e)*3600+int(f)*60+int(g)+int(h)/1000
    W,H=im.size; tw,th=160,90; cols=W//tw; rows=H//th
    n=cols*rows
    # yt storyboard: fixed interval per tile; estimate from slide duration assuming full slides
    for i in range(n):
        x=(i%cols)*tw; y=(i//cols)*th
        t=im.crop((x,y,x+tw,y+th))
        if t.getextrema()[0][1]<3: continue
        tiles.append((t,t0,t1,i,n))
# compute per-tile time: interval = first full slide duration / n
out=[]
for t,t0,t1,i,n in tiles:
    out.append((t,t0+i*(slides and ( (tiles[0][2]-tiles[0][1])/tiles[0][4]))))
per=60
for s in range(0,len(out),per):
    chunk=out[s:s+per]; cols=10; rows=(len(chunk)+cols-1)//cols
    sheet=Image.new('RGB',(cols*160,rows*102),(0,0,0)); d=ImageDraw.Draw(sheet)
    for k,(t,ts) in enumerate(chunk):
        x=(k%cols)*160;y=(k//cols)*102; sheet.paste(t,(x,y)); d.text((x+2,y+90),f"{int(ts//60)}:{int(ts%60):02d}",fill=(255,255,0))
    sheet.save(f"{outprefix}_{s//per:02d}.jpg",quality=88)
print(len(out),"tiles; interval",(tiles[0][2]-tiles[0][1])/tiles[0][4])
