import sys,glob,numpy as np,cv2
R='/Users/logge/Documents/Projects/bodycam-work/ref/all/'
print('video            n  Y.5%  Y5%  Y50%  Y95% Y99.5% clip%(>=250) black%(<=6) satMean  sat(Y>40) a*    b*   minRGBmed  maxCh>=250%')
for v in sys.argv[1:]:
    fs=sorted(glob.glob(R+v+'/*.jpg'))[::2]; S=[]
    for f in fs:
        im=cv2.imread(f); H,W=im.shape[:2]
        yy,xx=np.mgrid[0:H,0:W]; m=(((xx-W/2)/(0.47*W))**2+((yy-H/2)/(0.62*H))**2)<1
        m[:int(0.12*H)]=False  # skip OSD row
        px=im[m]; Y=cv2.cvtColor(px[None],cv2.COLOR_BGR2YCrCb)[0][:,0].astype(float)
        if Y.mean()<3: continue
        hsv=cv2.cvtColor(px[None],cv2.COLOR_BGR2HSV)[0]; lab=cv2.cvtColor(px[None],cv2.COLOR_BGR2LAB)[0].astype(float)
        S.append([*np.percentile(Y,[0.5,5,50,95,99.5]),(Y>=250).mean()*100,(Y<=6).mean()*100,hsv[:,1].mean()/2.55,hsv[Y>40,1].mean()/2.55 if (Y>40).any() else 0,lab[:,1].mean()-128,lab[:,2].mean()-128,px.min(1).mean(),(px.max(1)>=250).mean()*100])
    S=np.array(S); md=np.median(S,0)
    print(f'{v:15s}{len(S):4d} '+' '.join(f'{x:6.1f}' for x in md))
