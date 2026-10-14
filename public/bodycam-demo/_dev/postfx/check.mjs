// Test tool only. Requires an existing Playwright installation, no deploy dependency.
// node public/bodycam-demo/_dev/postfx/check.mjs [--work /path] [--url http://127.0.0.1:8953/bodycam-demo/_dev/postfx/]
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const args=process.argv.slice(2), option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const work=option('--work','/Users/logge/Documents/Projects/bodycam-work/codex/C5');
const url=option('--url','http://127.0.0.1:8953/bodycam-demo/_dev/postfx/');
const require=createRequire(import.meta.url);
let playwright;
try { playwright=require('playwright'); }
catch { playwright=require(process.env.PLAYWRIGHT_MODULE || '/Users/logge/Documents/Projects/bodycam-work/tools/node_modules/playwright'); }
const output=path.join(work,'qa'); await fs.mkdir(output,{recursive:true});
const browser=await playwright.chromium.launch({headless:true,
  executablePath:process.env.CHROMIUM_PATH || '/Users/logge/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
const errors=[], warnings=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());else if(m.type()==='warning')warnings.push(m.text());});
page.on('requestfailed',r=>errors.push(`${r.url()}: ${r.failure()?.errorText}`));
const report={errors,warnings,screenshots:[],performance:{},functional:{}};
const write=(name,value)=>fs.writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n');
async function shot(name) { await page.screenshot({path:path.join(output,`${name}.png`)}); report.screenshots.push(`${name}.png`); }
try {
  await page.goto(`${url}?clean=1&paused=1`,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.postfxDemo);
  await page.evaluate(()=>window.postfxDemo.ready);
  report.hardware=await page.evaluate(()=>{
    const gl=postfxDemo.renderer.getContext(), ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
      version:gl.getParameter(gl.VERSION),userAgent:navigator.userAgent,devicePixelRatio,
      timer:postfxDemo.post.diagnostics.gpu.supported};
  });
  await write('params.json',await page.evaluate(()=>postfxDemo.post.params));
  await page.evaluate(()=>{const d=postfxDemo;d.post.params.exposure.enabled=false;d.post.params.exposure.manualEV=0;d.render();});
  for(const scenario of ['still','spin','dark','muzzle']) {
    await page.evaluate(name=>{
      const d=postfxDemo; d.setScenario(name,{time:2-1/60});d.step(1/60);
    },scenario);
    await shot(scenario);
  }
  await page.evaluate(()=>{postfxDemo.setScenario('still');postfxDemo.setMode('raw');}); await shot('raw');
  await page.evaluate(()=>postfxDemo.setMode('post'));
  for(const [mode,name] of [[1,'mask'],[2,'lens'],[3,'osd']]) {
    await page.evaluate(mode=>{const d=postfxDemo;d.post.params.debug.mode=mode;d.post.params.sharpen.amount=0;d.render();},mode);
    await shot(name);
  }
  const overlay=await page.evaluate(()=>({metrics:postfxDemo.post.overlay.metrics,png:postfxDemo.post.overlay.canvas.toDataURL('image/png')}));
  await write('overlay.json',overlay.metrics);
  await fs.writeFile(path.join(output,'overlay.png'),Buffer.from(overlay.png.split(',')[1],'base64'));
  await page.evaluate(()=>{const d=postfxDemo;d.tune.reset();d.post.params.exposure.enabled=false;d.connection(false);}); await shot('disconnected');
  await page.evaluate(()=>postfxDemo.connection(true)); await shot('connected');
  await page.evaluate(()=>{postfxDemo.setScenario('still');postfxDemo.damage();}); await shot('damage');
  console.log('Screenshots and calibration fields captured.');

  // Each GPU measurement encloses motion/composite, meter, bloom, grading, lens and sensor.
  // Scene/viewmodel rasterization is outside the query, CPU time is separately reported.
  for(const quality of ['low','medium','high']) {
    report.performance[quality]=await page.evaluate(async quality=>{
      const d=postfxDemo;d.setQuality(quality);d.tune.reset();d.setScenario('spin');
      const raf=()=>new Promise(resolve=>requestAnimationFrame(resolve));
      for(let i=0;i<90;++i) {await raf();d.step(1/60);}
      d.post.diagnostics.gpu.reset();
      const cpu=[],intervals=[];let previous=performance.now();
      for(let i=0;i<180;++i) {await raf();const now=performance.now();intervals.push(now-previous);previous=now;d.step(1/60);cpu.push(d.post.diagnostics.cpuMs);}
      await raf();d.post.diagnostics.gpu.poll();
      const stats=values=>{values.sort((a,b)=>a-b);return {median:values[Math.floor(values.length*.5)],p95:values[Math.floor(values.length*.95)]};};
      return {gpu:d.post.diagnostics.gpu.snapshot(),cpuMs:stats(cpu),frameIntervalMs:stats(intervals),
        renderSize:[d.post.diagnostics.renderWidth,d.post.diagnostics.renderHeight],msaa:d.post.diagnostics.msaa,
        bloomLevels:d.post.diagnostics.bloomLevels,readbacks:d.post.diagnostics.readbacks,
        readbackError:d.post.diagnostics.readbackError};
    },quality);
    await write('results.json',report); console.log(`GPU ${quality}: ${JSON.stringify(report.performance[quality].gpu)}`);
  }
  report.functional=await page.evaluate(async()=>{
    const d=postfxDemo,r=d.renderer,p=d.post;
    d.setScenario('still');d.tune.reset();p.params.exposure.enabled=false;
    const original={tone:r.toneMapping,exp:r.toneMappingExposure,auto:r.autoClear,layers:d.camera.layers.mask,bg:d.scene.background};
    r.toneMappingExposure=1.37;r.autoClear=false;d.camera.layers.mask=5;
    d.step(1/60);
    const restores=r.toneMapping===original.tone && r.toneMappingExposure===1.37 && !r.autoClear && d.camera.layers.mask===5 && d.scene.background===original.bg;
    r.toneMappingExposure=original.exp;r.autoClear=original.auto;d.camera.layers.mask=original.layers;
    const THREE=await import('three'),output=new THREE.WebGLRenderTarget(1920,1080,{type:THREE.HalfFloatType});
    output.viewport.set(11,13,900,500);output.scissor.set(17,19,800,400);output.scissorTest=true;
    r.setRenderTarget(output);d.step(1/60);
    const viewport=r.getCurrentViewport(new THREE.Vector4()),gl=r.getContext();
    const outputRestored=r.getRenderTarget()===output&&viewport.equals(output.viewport)
      &&Array.from(gl.getParameter(gl.SCISSOR_BOX)).every((v,i)=>v===output.scissor.getComponent(i))
      &&gl.isEnabled(gl.SCISSOR_TEST);
    r.setRenderTarget(null);output.dispose();
    const before={...r.info.memory};
    for(let i=0;i<120;++i) {d.step(1/60);if(i%12===0)await new Promise(requestAnimationFrame);}
    const after={...r.info.memory};
    d.setScenario('still');d.fire();const first=p.diagnostics.flashBloom;d.step(1/120);const second=p.diagnostics.flashBloom;
    p.params.exposure.enabled=true;const reads=p.diagnostics.readbacks;
    d.setScenario('muzzle');for(let i=0;i<12;++i){d.step(1/60);await new Promise(requestAnimationFrame);}
    const flashReadbacks=p.diagnostics.readbacks-reads;
    d.setSize(960,540);d.step(1/60);const resized=[p.diagnostics.renderWidth,p.diagnostics.renderHeight,p.overlay.canvas.width,p.overlay.canvas.height];
    d.setSize(1920,1080);d.setScenario('still');d.render();
    const glError=r.getContext().getError();
    return {restoresRendererAndCamera:restores,restoresOutputTarget:outputRestored,memoryBefore:before,memoryAfter:after,
      stableResources:before.textures===after.textures&&before.geometries===after.geometries,
      flashThresholdFirstFrame:first,flashThresholdSecondFrame:second,flashReadbacks,resized,glError};
  });
  await write('results.json',report);
  console.log(`Functional: ${JSON.stringify(report.functional)}`);
  if(errors.length || warnings.some(x=>/shader|WebGL|framebuffer/i.test(x)) || !report.functional.restoresRendererAndCamera
    || !report.functional.restoresOutputTarget || !report.functional.stableResources || report.functional.glError || report.functional.flashReadbacks!==0
    || !report.functional.flashThresholdFirstFrame || report.functional.flashThresholdSecondFrame) process.exitCode=1;
} finally { await browser.close(); await write('results.json',report); }
