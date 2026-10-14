import * as THREE from 'three';
import { createParams } from './params.js';
import { createOverlay } from './overlay.js';
import { createGpuTimer } from './timing.js';
import * as shaders from './shaders.js';

export { POSTFX_DEFAULTS } from './params.js';
const EMPTY_STATE = Object.freeze({});
const clamp = THREE.MathUtils.clamp;
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

/** w/h are physical output pixels. Layers 0/1 are world/viewmodel respectively. */
export function createBodycamPost(renderer, scene, camera, opts = {}) {
  if (!renderer.capabilities.isWebGL2) throw new Error('Bodycam-Post-FX benötigt WebGL2.');
  if (!renderer.extensions.has('EXT_color_buffer_float')) throw new Error('HDR-Renderziele werden von dieser GPU nicht unterstützt.');
  if (renderer.capabilities.logarithmicDepthBuffer || renderer.capabilities.reverseDepthBuffer)
    throw new Error('Bodycam-Reprojektion benötigt die normale WebGL-Tiefenprojektion.');
  const params = createParams(opts.params);
  const overlay = createOverlay(params);
  const gl = renderer.getContext();
  const timer = createGpuTimer(gl);
  const drawingSize = new THREE.Vector2();
  renderer.getDrawingBufferSize(drawingSize);
  let width = Math.max(1,Math.round(opts.width || drawingSize.x));
  let height = Math.max(1,Math.round(opts.height || drawingSize.y));
  let quality = 'high', disposed = false, elapsed = 0, frame = 0;
  let historyValid = false, blockHistory = false, blockIndex = 0;
  let previousBlockFrame = 0;
  const blockSettings = new Float64Array(12).fill(NaN);
  let previousTime = NaN, previousFlash = 0, previousDamage = 0, damagePulse = 0;
  let flashUntil = -1, nextRead = 0, pendingRead = false, meterEpoch = 0, pendingEpoch = 0;
  let measuredLog = Math.log2(params.exposure.key), ev = params.exposure.manualEV, evVelocity = 0;
  let previousTargetEV=ev, sceneBrightening=false;
  let meterSize = 0, bloomCount = 0, renderWidth = 0, renderHeight = 0;
  let previousOverscan = 0, previousProjectionX = 0, previousProjectionY = 0;
  const clearColor = new THREE.Color(), savedViewport = new THREE.Vector4(), savedScissor = new THREE.Vector4();
  const renderCamera = new THREE.PerspectiveCamera();
  renderCamera.matrixAutoUpdate = false; renderCamera.matrixWorldAutoUpdate = false;
  const vp = new THREE.Matrix4(), inverseVP = new THREE.Matrix4(), previousVP = new THREE.Matrix4();
  const previousPosition = new THREE.Vector3(), position = new THREE.Vector3();
  const previousRotation = new THREE.Quaternion(), rotation = new THREE.Quaternion();
  const black = new THREE.DataTexture(new Uint8Array([0,0,0,255]),1,1);
  black.needsUpdate = true;
  const quadScene = new THREE.Scene(), quadCamera = new THREE.Camera();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
  const quad = new THREE.Mesh(geometry); quad.frustumCulled = false; quadScene.add(quad);
  const materials = [];
  function material(fragmentShader, values) {
    const uniforms = {};
    for (const key of Object.keys(values)) uniforms[key] = { value: values[key] };
    const mat = new THREE.ShaderMaterial({ vertexShader: shaders.fullscreenVertex, fragmentShader,
      uniforms, depthTest:false, depthWrite:false, toneMapped:false, blending:THREE.NoBlending });
    materials.push(mat); return mat;
  }
  function target(name, depth = false, byte = false) {
    const rt = new THREE.WebGLRenderTarget(1,1,{ type:byte ? THREE.UnsignedByteType : THREE.HalfFloatType,
      format:THREE.RGBAFormat, minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter,
      depthBuffer:depth, stencilBuffer:false, generateMipmaps:false });
    rt.texture.name = `Bodycam.${name}`; rt.texture.colorSpace = THREE.NoColorSpace; return rt;
  }
  const world = target('world',true), viewmodel = target('viewmodel',true);
  world.depthTexture = new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
  world.depthTexture.name = 'Bodycam.depth'; world.resolveDepthBuffer = true;
  const composite = target('motion-and-viewmodel'), graded = target('grade-and-osd'), warped = target('lens');
  const blockTargets = [target('blocks-a'),target('blocks-b')];
  for (const rt of blockTargets) { rt.texture.minFilter=THREE.NearestFilter; rt.texture.magFilter=THREE.NearestFilter; }
  const meterTargets = [], bloomDown = [], bloomUp = [];
  const meterResult = target('meter-rgba8',false,true), meterBytes = new Uint8Array(4);
  meterResult.texture.minFilter = THREE.NearestFilter; meterResult.texture.magFilter = THREE.NearestFilter;
  const motion = material(shaders.motionFragment,{tWorld:world.texture,tDepth:world.depthTexture,tView:viewmodel.texture,
    inverseVP,previousVP,resolution:new THREE.Vector2(),nearFar:new THREE.Vector2(),shutterScale:0,maxPixels:160,depthReject:0.02,samples:10});
  const meter = material(shaders.meterFragment,{tSource:world.texture,centerWeight:0.85,centerSigma:0.32,floorLog:-16});
  const reduce = material(shaders.reduceFragment,{tSource:null,texel:new THREE.Vector2()});
  const encode = material(shaders.encodeMeterFragment,{tSource:null});
  const down = material(shaders.bloomDownFragment,{tSource:null,texel:new THREE.Vector2(),exposure:1,
    threshold:1,knee:0.5,radius:1,firstLevel:true});
  const up = material(shaders.bloomUpFragment,{tSource:null,tBase:null,texel:new THREE.Vector2(),radius:1});
  const grade = material(shaders.gradeFragment,{tSource:composite.texture,tBloom:black,tOverlay:overlay.texture,
    exposure:1,bloomStrength:0,saturation:0.8,warmth:0.06,toe:0.012,whiteClip:0.97,knee:0.9,toePower:1.05,
    osdEnabled:true,debugMode:0});
  const lens = material(shaders.lensFragment,{tSource:graded.texture,resolution:new THREE.Vector2(),
    shakeUV:new THREE.Vector2(),angularVelocity:new THREE.Vector3(),k1:0.06,k2:0.01,overscan:1.06,
    caR:0.0012,caB:-0.0015,rollingSec:0,debugMode:0});
  const blocks = material(shaders.blockFragment,{tSource:warped.texture,tHistory:blockTargets[0].texture,
    resolution:lens.uniforms.resolution.value,grid:new THREE.Vector2(),imageTiles:new THREE.Vector2(),frameIndex:0,previousFrameIndex:0,
    holdMin:2,holdMax:4,detailReject:0.04,historyReject:0.02,historyValid:false});
  const profileValues = Array.from({length:7},()=>new THREE.Vector3());
  const radiiValues = new Float32Array(8);
  const sensor = material(shaders.sensorFragment,{tSource:warped.texture,tBlocks:blockTargets[0].texture,tOverlay:overlay.texture,osdEnabled:true,
    resolution:new THREE.Vector2(),blockGrid:new THREE.Vector2(),imageTiles:new THREE.Vector2(),maskAxes:new THREE.Vector2(),
    outsideColor:new THREE.Vector3(),noiseLuma:new THREE.Vector3(),damageColor:new THREE.Vector3(),
    profile:profileValues,radii:radiiValues,rimInner:0.94,rimOuter:1.05,innerVignette:0.08,outsideBlur:8,
    sharpenAmount:0.5,sharpenRadius:1.2,haloClamp:0.1,noiseTick:0,noiseChroma:0.4,blockAmount:0,blockLuma:0.08,blockMaxDelta:0.02,
    ringing:0,damageAmount:0,damageSaturation:1.25,dropout:0,glitchAmount:0,glitchTick:0,stripePixels:7,
    syncPosition:0,maskEnabled:true,noiseEnabled:true,outputLinear:false,debugMode:0});
  // The rare VHS pass reads OSD coverage separately from the combined viewmodel/OSD mask.
  for (const key of ['resolution','shakeUV','angularVelocity','k1','k2','overscan','caR','caB','rollingSec']) {
    sensor.uniforms[key]=lens.uniforms[key];
  }
  sensor.uniforms.osdEnabled=grade.uniforms.osdEnabled;
  const diagnostics = {quality,width,height,renderWidth:0,renderHeight:0,frame:0,cpuMs:0,gpuMs:0,
    exposureEV:ev,targetEV:ev,luminance:params.exposure.key,readbacks:0,readbackPending:false,
    readbackError:null,contextLost:false,historyValid:false,flashBloom:false,msaa:0,bloomLevels:0,
    gpu:timer,snapshot:()=>({...diagnostics,gpu:timer.snapshot(),snapshot:undefined})};

  function draw(mat, rt) { quad.material=mat; renderer.setRenderTarget(rt); renderer.render(quadScene,quadCamera); }
  function resetHistory() {
    historyValid=false; blockHistory=false; previousTime=NaN; meterEpoch++;
    previousFlash=0; previousDamage=0; damagePulse=0; evVelocity=0; nextRead=0;
  }
  function setSize(w,h) {
    width=Math.max(1,Math.round(finite(w,1))); height=Math.max(1,Math.round(finite(h,1)));
    syncTargets(); overlay.setSize(width,height); resetHistory();
  }
  function setQuality(q) {
    if (!['low','medium','high'].includes(q)) throw new Error(`Unbekannte Post-FX-Qualität: ${q}`);
    quality=q; diagnostics.quality=q; syncTargets(); resetHistory();
  }
  function syncTargets() {
    const q=params.quality[quality];
    const w=Math.max(1,Math.round(width*clamp(finite(q.scale,1),0.25,1.5)));
    const h=Math.max(1,Math.round(height*clamp(finite(q.scale,1),0.25,1.5)));
    const msaa=clamp(Math.round(finite(q.msaa,0)),0,renderer.capabilities.maxSamples);
    if (world.samples!==msaa) {
      world.samples=msaa; viewmodel.samples=msaa; world.dispose(); viewmodel.dispose(); historyValid=false; blockHistory=false;
    }
    if (w!==renderWidth || h!==renderHeight || warped.width!==width || warped.height!==height) {
      renderWidth=w; renderHeight=h;
      world.setSize(w,h); viewmodel.setSize(w,h); composite.setSize(w,h); graded.setSize(w,h); warped.setSize(width,height);
      motion.uniforms.resolution.value.set(w,h); lens.uniforms.resolution.value.set(width,height);
      sensor.uniforms.resolution.value.set(width,height); historyValid=false; blockHistory=false;
    }
    const blockSize=Math.max(1,finite(params.blocks.sizePx1080,48)*height/1080);
    blocks.uniforms.imageTiles.value.set(width/blockSize,height/blockSize);
    sensor.uniforms.imageTiles.value.set(width/blockSize,height/blockSize);
    const bw=Math.max(1,Math.ceil(width/blockSize)), bh=Math.max(1,Math.ceil(height/blockSize));
    if (blockTargets[0].width!==bw || blockTargets[0].height!==bh) {
      for (const rt of blockTargets) rt.setSize(bw,bh);
      blocks.uniforms.grid.value.set(bw,bh); sensor.uniforms.blockGrid.value.set(bw,bh); blockHistory=false;
    }
    const levels=clamp(Math.round(finite(q.bloomLevels,4)),1,6);
    while (bloomDown.length<levels) { bloomDown.push(target('bloom-down')); bloomUp.push(target('bloom-up')); }
    bloomCount=levels;
    for(let i=0;i<levels;++i) {
      const dw=Math.max(1,Math.floor(w / 2**(i+1))), dh=Math.max(1,Math.floor(h / 2**(i+1)));
      bloomDown[i].setSize(dw,dh); bloomUp[i].setSize(dw,dh);
    }
    const requestedMeter=2**clamp(Math.round(Math.log2(Math.max(1,finite(params.exposure.meterSize,64)))),1,8);
    if (meterSize!==requestedMeter && !pendingRead) {
      for (const rt of meterTargets) rt.dispose(); meterTargets.length=0; meterSize=requestedMeter;
      for(let s=meterSize;s>=1;s/=2) { const rt=target('log-luma'); rt.setSize(s,s); meterTargets.push(rt); }
    }
    diagnostics.width=width; diagnostics.height=height; diagnostics.renderWidth=w; diagnostics.renderHeight=h;
    diagnostics.msaa=msaa; diagnostics.bloomLevels=levels;
  }
  function onMeterRead() {
    pendingRead=false; diagnostics.readbackPending=false;
    if (disposed || pendingEpoch!==meterEpoch || elapsed<flashUntil) return;
    diagnostics.readbackError=null;
    measuredLog=(meterBytes[0]*256+meterBytes[1])/65535*32-16;
    diagnostics.luminance=2**measuredLog; diagnostics.readbacks++;
  }
  function onMeterError(error) {
    pendingRead=false; diagnostics.readbackPending=false;
    diagnostics.readbackError=String(error?.message || error);
    nextRead=elapsed+Math.max(0.1,params.exposure.retrySec);
  }
  function readExposure() {
    meter.uniforms.centerWeight.value=clamp(finite(params.exposure.centerWeight,0.85),0,1);
    meter.uniforms.centerSigma.value=Math.max(0.001,finite(params.exposure.centerSigma,0.32));
    meter.uniforms.floorLog.value=clamp(finite(params.exposure.floorEV,-16),-16,0);
    draw(meter,meterTargets[0]);
    for(let i=1;i<meterTargets.length;++i) {
      const source=meterTargets[i-1]; reduce.uniforms.tSource.value=source.texture;
      reduce.uniforms.texel.value.set(1/source.width,1/source.height); draw(reduce,meterTargets[i]);
    }
    encode.uniforms.tSource.value=meterTargets[meterTargets.length-1].texture; draw(encode,meterResult);
    pendingRead=true; pendingEpoch=meterEpoch; diagnostics.readbackPending=true;
    renderer.readRenderTargetPixelsAsync(meterResult,0,0,1,1,meterBytes).then(onMeterRead,onMeterError);
    nextRead=elapsed+1/Math.max(0.1,finite(params.exposure.readHz,8));
  }
  function adaptExposure(dt,state) {
    const p=params.exposure, lo=Math.min(p.minEV,p.maxEV), hi=Math.max(p.minEV,p.maxEV);
    const targetEV=clamp(p.enabled ? Math.log2(Math.max(p.key,0.00001))-measuredLog+p.compensationEV+finite(state.exposureHint) : p.manualEV,lo,hi);
    if(Math.abs(targetEV-previousTargetEV)>0.005) sceneBrightening=targetEV<previousTargetEV;
    previousTargetEV=targetEV;
    if (!p.enabled) { ev=targetEV; evVelocity=0; }
    else {
      // Names refer to the scene transition in STYLE 3.2, not the gain direction.
      // Keep the pole through the overshoot; switching on the error sign changes its amplitude.
      const tau=Math.max(0.001,sceneBrightening ? p.tauBrighten : p.tauDarken);
      const overshoot=clamp(finite(p.overshoot,0),0,0.8);
      if (overshoot<0.001) { ev+=(targetEV-ev)*(1-Math.exp(-dt/tau)); evVelocity=0; }
      else {
        const log=Math.log(overshoot), zeta=-log/Math.sqrt(Math.PI*Math.PI+log*log);
        const omega=1/(zeta*tau), decay=1/tau, wd=omega*Math.sqrt(1-zeta*zeta);
        const x=ev-targetEV, b=(evVelocity+decay*x)/wd, e=Math.exp(-decay*dt), s=Math.sin(wd*dt), c=Math.cos(wd*dt);
        ev=targetEV+e*(x*c+b*s); evVelocity=e*((-decay*x+wd*b)*c+(-decay*b-wd*x)*s);
      }
      const bounded=clamp(ev,lo,hi); if(bounded!==ev) evVelocity=0; ev=bounded;
    }
    diagnostics.exposureEV=ev; diagnostics.targetEV=targetEV;
  }
  function blockSetting(index,value) {
    if(blockSettings[index]!==value) blockHistory=false;
    blockSettings[index]=value;
  }
  function updateUniforms(dt,state,flashEdge,blurAllowed) {
    const p=params, px=height/1080, exposure=2**ev, angular=state.angularVelocity;
    const ax=finite(angular?.x), ay=finite(angular?.y), az=finite(angular?.z);
    const angularSpeed=Math.hypot(ax,ay,az)*180/Math.PI;
    const mu=motion.uniforms;
    mu.nearFar.value.set(camera.near,camera.far);
    mu.shutterScale.value=blurAllowed && p.motionBlur.enabled ? Math.max(0,p.motionBlur.exposureSec)/Math.max(dt,0.001) : 0;
    mu.maxPixels.value=Math.max(0,p.motionBlur.maxPx1080)*renderHeight/1080;
    mu.samples.value=mu.shutterScale.value>0 ? clamp(Math.round(Math.min(p.motionBlur.samples,p.quality[quality].samples)),1,32) : 1;
    mu.depthReject.value=Math.max(0.00001,p.motionBlur.depthReject);
    const gu=grade.uniforms;
    gu.exposure.value=exposure; gu.bloomStrength.value=p.bloom.enabled ? p.bloom.strength : 0;
    gu.saturation.value=p.grade.saturation; gu.warmth.value=p.grade.warmIndoor;
    gu.toe.value=clamp(p.grade.toeCrush,0,0.99); gu.whiteClip.value=p.grade.whiteClip;
    gu.knee.value=p.grade.highlightsKnee; gu.toePower.value=Math.max(0.01,p.grade.toePower);
    gu.osdEnabled.value=p.osd.enabled; gu.debugMode.value=p.debug.mode;
    const lu=lens.uniforms;
    lu.k1.value=p.lens.enabled ? p.lens.k1 : 0; lu.k2.value=p.lens.enabled ? p.lens.k2 : 0;
    lu.overscan.value=p.lens.enabled ? Math.max(1,p.lens.overscan) : 1;
    lu.caR.value=p.lens.enabled ? p.lens.caR : 0; lu.caB.value=p.lens.enabled ? p.lens.caB : 0;
    lu.angularVelocity.value.set(ax,ay,az); lu.rollingSec.value=p.rollingShutter.enabled ? p.rollingShutter.readoutSec : 0;
    lu.debugMode.value=p.debug.mode;
    const damage=clamp(Math.max(finite(state.damage),damagePulse),0,1);
    const st=Math.floor(elapsed*Math.max(1,p.shake.rateHz)), ht=Math.floor(elapsed*Math.max(1,p.damage.shakeHz));
    const amp=clamp(finite(state.shake),0,1)*p.shake.pixels1080*px;
    const hitAmp=damage*p.damage.shakePx1080*px;
    lu.shakeUV.value.set((Math.sin(st*12.9898)*amp+Math.sin(ht*19.73)*hitAmp)/width,
      (Math.cos(st*7.233)*amp+Math.cos(ht*27.11)*hitAmp)/height);
    const bu=blocks.uniforms;
    bu.frameIndex.value=Math.floor(elapsed*Math.max(1,p.blocks.rateHz));
    bu.holdMin.value=Math.max(1,Math.min(p.blocks.holdFrames[0],p.blocks.holdFrames[1]));
    bu.holdMax.value=Math.max(bu.holdMin.value,Math.max(p.blocks.holdFrames[0],p.blocks.holdFrames[1]));
    bu.previousFrameIndex.value=previousBlockFrame;
    bu.detailReject.value=Math.max(0.0001,finite(p.blocks.detailReject,0.04));
    bu.historyReject.value=Math.max(0,finite(p.blocks.historyReject,0.02));
    // Changing the sampling grid or time buckets invalidates even an unchanged target size.
    blockSetting(0,p.blocks.sizePx1080); blockSetting(1,p.blocks.rateHz);
    blockSetting(2,bu.holdMin.value); blockSetting(3,bu.holdMax.value);
    blockSetting(4,lu.k1.value); blockSetting(5,lu.k2.value); blockSetting(6,lu.overscan.value);
    blockSetting(7,lu.caR.value); blockSetting(8,lu.caB.value); blockSetting(9,lu.rollingSec.value);
    blockSetting(10,bu.detailReject.value); blockSetting(11,bu.historyReject.value);
    const su=sensor.uniforms, mask=p.lens.mask;
    su.maskAxes.value.set(Math.max(0.01,mask.a),Math.max(0.01,mask.b));
    su.outsideColor.value.fromArray(mask.outside); su.noiseLuma.value.set(p.noise.lumaDark,p.noise.lumaMid,p.noise.lumaHigh);
    su.damageColor.value.fromArray(p.damage.color);
    for(let i=0;i<7;++i) profileValues[i].fromArray(mask.profile[i]);
    for(let i=0;i<8;++i) radiiValues[i]=mask.radii[i];
    su.rimInner.value=mask.rimInner; su.rimOuter.value=Math.max(mask.rimInner+0.001,mask.rimOuter);
    su.innerVignette.value=mask.innerVignette; su.outsideBlur.value=mask.outsideBlurPx1080*px;
    su.sharpenAmount.value=p.sharpen.amount; su.sharpenRadius.value=p.sharpen.radiusPx1080*px;
    su.haloClamp.value=Math.max(0,p.sharpen.haloClamp); su.noiseTick.value=Math.floor(elapsed*Math.max(0,p.noise.rateHz));
    su.noiseChroma.value=p.noise.chroma;
    const moving=angularSpeed>p.blocks.minAngVel ? clamp((angularSpeed-p.blocks.minAngVel)/Math.max(1,p.blocks.minAngVel*3),0,1) : -1;
    su.blockAmount.value=p.blocks.enabled ? Math.max(damage,moving<0 ? 0 : THREE.MathUtils.lerp(p.blocks.mix[0],p.blocks.mix[1],moving)) : 0;
    su.blockLuma.value=Math.max(0,p.blocks.lumaMax); su.ringing.value=quality==='high' ? p.blocks.ringing : 0;
    su.blockMaxDelta.value=Math.max(0.0001,finite(p.blocks.maxDelta,0.02));
    su.damageAmount.value=damage; su.damageSaturation.value=p.damage.saturation; su.dropout.value=damage*p.damage.dropout;
    su.glitchAmount.value=overlay.effect.disconnected*p.glitch.amount;
    su.glitchTick.value=Math.floor(elapsed*Math.max(1,p.glitch.stripeRateHz));
    su.stripePixels.value=p.glitch.stripePx1080*px; su.syncPosition.value=elapsed*p.glitch.syncSpeed;
    su.maskEnabled.value=mask.enabled; su.noiseEnabled.value=p.noise.enabled; su.debugMode.value=p.debug.mode;
    down.uniforms.exposure.value=exposure;
    down.uniforms.threshold.value=flashEdge ? p.bloom.flashThreshold : p.bloom.threshold;
    down.uniforms.knee.value=Math.max(0.0001,p.bloom.softKnee);
    down.uniforms.radius.value=p.bloom.radius; up.uniforms.radius.value=p.bloom.radius;
  }
  function render(dt,state=EMPTY_STATE) {
    if(disposed) return;
    diagnostics.contextLost=gl.isContextLost(); if(diagnostics.contextLost) return;
    const start=performance.now(), originalDt=finite(dt,1/60); dt=clamp(originalDt,0,0.1);
    const time=Number.isFinite(state.time) ? state.time : elapsed+dt;
    if(Number.isFinite(previousTime) && (time<previousTime || time-previousTime>params.motionBlur.resetGapSec)) resetHistory();
    elapsed=time;
    syncTargets(); overlay.update(elapsed,dt);
    const flash=clamp(finite(state.muzzleFlash),0,1), hit=clamp(finite(state.damage),0,1);
    const flashEdge=flash>0 && (previousFlash<=0 || flash>previousFlash+0.05);
    if(flash>0) flashUntil=elapsed+Math.max(0,params.exposure.flashHoldSec);
    if(flashEdge) meterEpoch++;
    if(hit>previousDamage+0.05) damagePulse=Math.max(damagePulse,hit);
    else damagePulse=Math.max(0,damagePulse-dt/Math.max(0.001,params.damage.durationSec));
    adaptExposure(dt,state);
    scene.updateMatrixWorld(); camera.updateWorldMatrix(true,false);
    renderCamera.near=camera.near; renderCamera.far=camera.far;
    renderCamera.matrixWorld.copy(camera.matrixWorld); renderCamera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    renderCamera.projectionMatrix.copy(camera.projectionMatrix);
    const overscan=params.lens.enabled ? Math.max(1,params.lens.overscan) : 1;
    renderCamera.projectionMatrix.elements[0]/=overscan; renderCamera.projectionMatrix.elements[5]/=overscan;
    renderCamera.projectionMatrixInverse.copy(renderCamera.projectionMatrix).invert();
    vp.multiplyMatrices(renderCamera.projectionMatrix,renderCamera.matrixWorldInverse); inverseVP.copy(vp).invert();
    position.setFromMatrixPosition(camera.matrixWorld); rotation.setFromRotationMatrix(camera.matrixWorld);
    if(overscan!==previousOverscan || camera.projectionMatrix.elements[0]!==previousProjectionX || camera.projectionMatrix.elements[5]!==previousProjectionY)
      historyValid=false;
    if(historyValid && (position.distanceTo(previousPosition)>params.motionBlur.cutDistance
      || rotation.angleTo(previousRotation)>params.motionBlur.cutAngleDeg*Math.PI/180)) historyValid=false;
    if(!historyValid) { previousVP.copy(vp); blockHistory=false; }
    updateUniforms(dt,state,flashEdge,historyValid && originalDt>0 && originalDt<params.motionBlur.resetGapSec);
    const savedTarget=renderer.getRenderTarget(), savedAutoClear=renderer.autoClear, savedTone=renderer.toneMapping;
    const savedFace=renderer.getActiveCubeFace(), savedMip=renderer.getActiveMipmapLevel();
    const savedExposure=renderer.toneMappingExposure, savedAlpha=renderer.getClearAlpha(), savedBackground=scene.background;
    const savedXr=renderer.xr.enabled, savedScissorTest=renderer.getScissorTest();
    renderer.getClearColor(clearColor); renderer.getViewport(savedViewport); renderer.getScissor(savedScissor);
    try {
      renderer.xr.enabled=false; renderer.autoClear=false; renderer.toneMapping=THREE.NoToneMapping;
      renderer.toneMappingExposure=1; renderer.setScissorTest(false);
      renderCamera.layers.set(0); renderer.setRenderTarget(world); renderer.clear(); renderer.render(scene,renderCamera);
      renderCamera.layers.set(1); scene.background=null; renderer.setClearColor(0,0);
      renderer.setRenderTarget(viewmodel); renderer.clear(); renderer.render(scene,renderCamera); scene.background=savedBackground;
      if(params.debug.gpuTiming) timer.begin();
      draw(motion,composite);
      if(params.exposure.enabled && !pendingRead && elapsed>=nextRead && elapsed>=flashUntil) readExposure();
      grade.uniforms.tBloom.value=black;
      if(params.bloom.enabled && params.bloom.strength!==0) {
        let source=composite;
        for(let i=0;i<bloomCount;++i) {
          down.uniforms.tSource.value=source.texture; down.uniforms.texel.value.set(1/source.width,1/source.height);
          down.uniforms.firstLevel.value=i===0; draw(down,bloomDown[i]); source=bloomDown[i];
        }
        for(let i=bloomCount-2;i>=0;--i) {
          up.uniforms.tSource.value=source.texture; up.uniforms.tBase.value=bloomDown[i].texture;
          up.uniforms.texel.value.set(1/source.width,1/source.height); draw(up,bloomUp[i]); source=bloomUp[i];
        }
        grade.uniforms.tBloom.value=source.texture;
      }
      draw(grade,graded); draw(lens,warped);
      if(params.blocks.enabled && sensor.uniforms.blockAmount.value>0) {
        blocks.uniforms.tHistory.value=blockTargets[blockIndex].texture; blocks.uniforms.historyValid.value=blockHistory;
        blockIndex=1-blockIndex; draw(blocks,blockTargets[blockIndex]); blockHistory=true;
        previousBlockFrame=blocks.uniforms.frameIndex.value;
      } else blockHistory=false; // Never reactivate colors retained through an idle interval.
      sensor.uniforms.tBlocks.value=blockTargets[blockIndex].texture;
      sensor.uniforms.outputLinear.value=savedTarget!==null;
      renderer.setRenderTarget(savedTarget,savedFace,savedMip);
      if(!savedTarget) renderer.setViewport(0,0,width/renderer.getPixelRatio(),height/renderer.getPixelRatio());
      quad.material=sensor; renderer.render(quadScene,quadCamera);
    } finally {
      timer.end(); scene.background=savedBackground; renderer.autoClear=savedAutoClear;
      renderer.toneMapping=savedTone; renderer.toneMappingExposure=savedExposure; renderer.xr.enabled=savedXr;
      renderer.setClearColor(clearColor,savedAlpha);
      renderer.setViewport(savedViewport); renderer.setScissor(savedScissor); renderer.setScissorTest(savedScissorTest);
      renderer.setRenderTarget(savedTarget,savedFace,savedMip);
    }
    previousVP.copy(vp); previousPosition.copy(position); previousRotation.copy(rotation);
    previousOverscan=overscan; previousProjectionX=camera.projectionMatrix.elements[0]; previousProjectionY=camera.projectionMatrix.elements[5];
    previousTime=time; previousFlash=flash; previousDamage=hit; historyValid=true;
    diagnostics.historyValid=true; diagnostics.frame=++frame; diagnostics.flashBloom=flashEdge;
    diagnostics.cpuMs=performance.now()-start; diagnostics.gpuMs=timer.lastMs;
  }
  function dispose() {
    if(disposed) return; disposed=true; meterEpoch++;
    renderer.domElement.removeEventListener('webglcontextrestored',restoreContext);
    for(const rt of [world,viewmodel,composite,graded,warped,meterResult,...blockTargets,...meterTargets,...bloomDown,...bloomUp]) rt.dispose();
    for(const mat of materials) mat.dispose();
    geometry.dispose(); black.dispose(); overlay.dispose(); timer.dispose();
  }
  function restoreContext() {
    resetHistory(); diagnostics.contextLost=false; diagnostics.readbackError=null;
    timer.restoreContext();
  }
  renderer.domElement.addEventListener('webglcontextrestored',restoreContext);
  setQuality(opts.quality || 'high'); overlay.setSize(width,height);
  return {render,setSize,setQuality,params,overlay,diagnostics,resetHistory,dispose};
}
