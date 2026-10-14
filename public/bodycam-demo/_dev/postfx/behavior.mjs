// Controlled GPU checks for exposure, camera reprojection, viewmodel and 30 Hz noise.
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
let playwright;try{playwright=require('playwright');}catch{playwright=require(process.env.PLAYWRIGHT_MODULE||'/Users/logge/Documents/Projects/bodycam-work/tools/node_modules/playwright');}
const dir=process.env.C5_WORK||'/Users/logge/Documents/Projects/bodycam-work/codex/C5';
await fs.mkdir(`${dir}/qa`,{recursive:true});
const browser=await playwright.chromium.launch({headless:true,
  executablePath:process.env.CHROMIUM_PATH||'/Users/logge/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1920,height:1080}}), errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try {
  await page.goto(process.env.C5_URL||'http://127.0.0.1:8953/bodycam-demo/_dev/postfx/?paused=1&clean=1',{waitUntil:'networkidle'});
  await page.evaluate(async()=>{
    const THREE=await import('three'),{createBodycamPost}=await import('../../js/postfx/bodycam.js');
    const d=window.postfxDemo;d.pause();d.post.dispose();
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(82,16/9,.025,70);scene.add(camera);
    scene.background=new THREE.Color().setRGB(.18,.18,.18);
    const post=createBodycamPost(d.renderer,scene,camera,{params:{osd:{enabled:false},lens:{enabled:false,mask:{enabled:false}},
      bloom:{enabled:false},noise:{enabled:false},sharpen:{amount:0},blocks:{enabled:false},motionBlur:{enabled:false},
      grade:{saturation:1,warmIndoor:0,toeCrush:0,toePower:1}}});
    const state={time:0,angularVelocity:new THREE.Vector3(),linearVelocity:new THREE.Vector3(),muzzleFlash:0,damage:0,shake:0};
    window.c5Fixture={THREE,scene,camera,post,state,renderer:d.renderer};
  });
  const exposure=await page.evaluate(async()=>{
    const f=c5Fixture,series=[]; const raf=()=>new Promise(requestAnimationFrame);
    async function sample(label,luminance,n=130,flash=0) {
      f.scene.background.setRGB(luminance,luminance,luminance);f.state.muzzleFlash=flash;
      const frames=[];
      for(let i=0;i<n;++i){await raf();f.state.time+=.05;f.post.render(.05,f.state);frames.push({t:i*.05,ev:f.post.diagnostics.exposureEV,target:f.post.diagnostics.targetEV});}
      const p=f.post.diagnostics;series.push({label,input:luminance,ev:p.exposureEV,target:p.targetEV,meter:p.luminance,reads:p.readbacks,
        max:Math.max(...frames.map(x=>x.ev)),min:Math.min(...frames.map(x=>x.ev)),frames});
    }
    await sample('middle',.18,50);await sample('dark',.018);await sample('bright',1.8,170);
    const reads=f.post.diagnostics.readbacks;await sample('flash',18,24,1);
    const flashReads=f.post.diagnostics.readbacks-reads;
    await sample('return',.18,180);
    return {series,flashReads,readbackError:f.post.diagnostics.readbackError};
  });
  console.log('Exposure sweep complete.');
  await page.evaluate(()=>{
    const f=c5Fixture,{THREE}=f,p=f.post.params;
    p.exposure.enabled=false;p.exposure.manualEV=0;p.motionBlur.enabled=true;p.motionBlur.depthReject=.02;
    f.scene.background.setRGB(0,0,0);f.state.muzzleFlash=0;
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;const c=canvas.getContext('2d');
    c.fillStyle='#000';c.fillRect(0,0,1024,1024);c.fillStyle='#fff';c.fillRect(510,0,4,1024);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const world=new THREE.Mesh(new THREE.PlaneGeometry(12,12),new THREE.MeshBasicMaterial({map:texture}));world.position.z=-4;f.scene.add(world);
    const view=new THREE.Mesh(new THREE.PlaneGeometry(.01,.1),new THREE.MeshBasicMaterial({color:0xff00ff}));view.position.set(.32,-.22,-.4);view.layers.set(1);f.camera.add(view);
    f.world=world;f.view=view;f.post.resetHistory();f.camera.rotation.y=0;f.state.time=30;f.post.render(1/60,f.state);
  });
  await page.screenshot({path:`${dir}/qa/motion-before.png`});
  await page.evaluate(()=>{const f=c5Fixture;f.camera.rotation.y=.025;f.state.time+=1/60;f.state.angularVelocity.y=1.5;f.post.render(1/60,f.state);});
  await page.screenshot({path:`${dir}/qa/motion-after.png`});
  await page.evaluate(()=>{const f=c5Fixture;f.post.resetHistory();f.post.render(1/60,f.state);});
  await page.screenshot({path:`${dir}/qa/motion-reset.png`});
  // A foreground world plane cannot occlude the separate layer-1 target.
  await page.evaluate(()=>{const f=c5Fixture;f.world.position.z=-.1;f.world.material.map=null;f.world.material.color.setRGB(0,0,0);f.world.material.needsUpdate=true;f.post.render(0,f.state);});
  await page.screenshot({path:`${dir}/qa/viewmodel-wall.png`});
  await page.evaluate(()=>{
    const f=c5Fixture;f.world.visible=false;f.view.visible=false;f.scene.background.setRGB(.03,.03,.03);
    f.post.params.motionBlur.enabled=false;f.post.params.noise.enabled=true;f.state.angularVelocity.set(0,0,0);
  });
  for(const [name,time] of [['noise-a',40],['noise-b',40.016],['noise-c',40.034]]) {
    await page.evaluate(time=>{const f=c5Fixture;f.state.time=time;f.post.render(1/60,f.state);},time);
    await page.screenshot({path:`${dir}/qa/${name}.png`});
  }
  const disposal=await page.evaluate(()=>{const f=c5Fixture;const before={...f.renderer.info.memory};f.post.dispose();f.post.dispose();
    return {before,after:{...f.renderer.info.memory},glError:f.renderer.getContext().getError()};});
  const result={exposure,disposal,errors};await fs.writeFile(`${dir}/qa/behavior.json`,JSON.stringify(result,null,2)+'\n');
  const s=exposure.series;
  const passed=!errors.length&&!exposure.readbackError&&exposure.flashReads===0&&Math.abs(s[0].ev)<.04
    &&Math.abs(s[1].target-Math.log2(10))<.04&&Math.abs(s[1].ev-s[1].target)<.06
    &&s[1].max>s[1].target+.1&&Math.abs(s[2].ev+2)<.03&&Math.abs(s[4].ev)<.04&&!disposal.glError;
  console.log(JSON.stringify({passed,exposure:s.map(({frames,...row})=>row),flashReads:exposure.flashReads,disposal,errors},null,2));
  if(!passed)process.exitCode=1;
} finally {await browser.close();}
