#!/usr/bin/env node
// Real central-factory readback and deterministic close material comparisons.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const options = Object.fromEntries(process.argv.slice(2).reduce((rows, arg, i, all) => {
  if (arg.startsWith('--')) rows.push([arg.slice(2), all[i + 1]]); return rows;
}, []));
const work = path.resolve(options.work || '/Users/logge/Documents/Projects/bodycam-work/codex/C14/optimize');
const output = path.join(work, 'browser'); await fs.mkdir(output, { recursive: true });
const base = options.base || 'http://127.0.0.1:8964';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || '/Users/logge/Documents/Projects/bodycam-work/tools/node_modules/playwright/index.mjs'));
const report = JSON.parse(await fs.readFile(path.join(work, 'reports/glb.json'), 'utf8'));
const models = report.files.filter(item => !item.preserved).map(item => item.path);
const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><style>html,body{margin:0;background:#080b10}canvas{display:block}</style><script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"}}</script></head><body><script type="module">
import * as THREE from 'three';
import { createAssetLoaders } from '/bodycam-demo/js/core/loaders.js';
const renderer = new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setSize(1280,720);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;document.body.append(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color(0x151a21);
const camera=new THREE.PerspectiveCamera(38,1280/720,.001,200);
const ambient=new THREE.HemisphereLight(0xdfe8ff,0x4a3528,1.3);scene.add(ambient);
const sun=new THREE.DirectionalLight(0xffffff,3.2);sun.position.set(-2,3,4);scene.add(sun);
const assets=createAssetLoaders({renderer});let root=null;
function dispose(object){ if(!object)return; const geometries=new Set(),materials=new Set(),textures=new Set();
 object.traverse(o=>{if(o.isMesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});
 for(const m of materials){for(const v of Object.values(m))if(v?.isTexture)textures.add(v);m.dispose();}
 for(const g of geometries)g.dispose();for(const t of textures)t.dispose();scene.remove(object);
}
function render(){renderer.render(scene,camera); const err=renderer.getContext().getError();if(err)throw new Error('WebGL error '+err);}
window.audit={renderer:renderer.getContext().getParameter(renderer.getContext().getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL),
 async model(relative,profile='after'){dispose(root);const start=performance.now();const data=await assets.gltf.loadAsync((profile==='before'?'/__c14_sources/before/':'/bodycam-demo/')+relative);root=data.scene;scene.add(root);root.updateMatrixWorld(true);
 const bounds=new THREE.Box3().setFromObject(root),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
 const radius=Math.max(size.x/(1280/720),size.y,size.z*.55)*.5;camera.position.copy(center).add(new THREE.Vector3(radius*.85,radius*.35,radius*3.6));camera.lookAt(center);camera.updateProjectionMatrix();
 let triangles=0,meshes=0,skinned=0,nonfinite=0;root.traverse(o=>{if(!o.isMesh)return;meshes++;skinned+=Number(o.isSkinnedMesh===true);triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;
 for(const a of Object.values(o.geometry.attributes))for(let i=0;i<a.count;i++)for(let k=0;k<a.itemSize;k++)nonfinite+=Number(!Number.isFinite(a[['getX','getY','getZ','getW'][k]](i)));});render();render();
 if(nonfinite)throw new Error('Nonfinite mesh attributes '+relative);return{relative,ms:performance.now()-start,meshes,triangles,skinned,bounds:[bounds.min.toArray(),bounds.max.toArray()],calls:renderer.info.render.calls};},
 async normal(id,profile){dispose(root);const base='/__c14_sources/'+profile+'/textures/';const index=await(await fetch(base+'index.json')).json();const source=base+id+'/'+(index[id].files?.normal||'normal.jpg');const tex=await assets.texture.loadAsync(source);tex.colorSpace=THREE.NoColorSpace;tex.flipY=false;tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.repeat.set(.5,.5);tex.offset.set(.2,.2);tex.anisotropy=8;
 const material=new THREE.MeshStandardMaterial({color:0xb8bec7,normalMap:tex,roughness:.72,metalness:0});root=new THREE.Mesh(new THREE.PlaneGeometry(1.3,.73125),material);scene.add(root);
 ambient.intensity=.14;sun.intensity=3.2;sun.position.set(-1,.25,.5);camera.position.set(0,0,1.065);camera.lookAt(0,0,0);render();render();return{image:[tex.image.width,tex.image.height],texture:source};},
 close(){dispose(root);assets.dispose();renderer.dispose();}};window.ready=true;
</script></body></html>`;
const browser = await chromium.launch({ headless: true, executablePath: '/Users/logge/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', args: ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist'] });
const errors = [], warnings = [], requests = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror',error=>errors.push(String(error)));
  page.on('console',event=>{if(event.type()==='error')errors.push(event.text());if(event.type()==='warning')warnings.push(event.text());});
  page.on('requestfailed',request=>errors.push(request.url()+': '+request.failure()?.errorText));
  page.on('response',response=>{if(response.status()>=400)errors.push(response.status()+' '+response.url());requests.push(response.url());});
  await page.route('**/__c14_asset_check',route=>route.fulfill({contentType:'text/html',body:html}));
  await page.route('**/__c14_sources/**', async route=>{
    const relative=new URL(route.request().url()).pathname.slice('/__c14_sources/'.length), [profile,...parts]=relative.split('/');
    if(!['before','after'].includes(profile)||parts.includes('..'))throw new Error('Unexpected routed path');
    const root=profile==='before'?path.join(work,'originals'):path.join(work,'staging');
    const body=await fs.readFile(path.join(root,...parts));
    // Before snapshots can have legacy names; truthfully label their bytes.
    const contentType=body.subarray(0,4).toString()==='RIFF'&&body.subarray(8,12).toString()==='WEBP'?'image/webp'
      :body[0]===255&&body[1]===216&&body[2]===255?'image/jpeg'
      :body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png'
      :parts.at(-1).endsWith('.json')?'application/json':'application/octet-stream';
    await route.fulfill({contentType,body});
  });
  await page.goto(base+'/__c14_asset_check');await page.waitForFunction(()=>window.ready,{timeout:60000});
  const result={renderer:await page.evaluate(()=>window.audit.renderer),models:[],normals:[],errors,warnings};
  const captures=new Set(['carbine','officer','house_shell','toilet','bathtub','bath_vanity','mirror_cabinet','washing_machine','dryer','water_heater','tree_dead','bush_dead','fridge_open','kitchen_sink_cab_90','microwave','range_hood','stove_old']);
  for(const relative of models){
    let before=null;
    if(captures.has(path.basename(relative,'.glb'))){before=await page.evaluate(p=>window.audit.model(p,'before'),relative);await page.screenshot({path:path.join(output,path.basename(relative,'.glb')+'-before.png')});}
    const after=await page.evaluate(p=>window.audit.model(p),relative);
    if(before){after.before=before;after.countsMatch=before.triangles===after.triangles&&before.meshes===after.meshes&&before.skinned===after.skinned;if(!after.countsMatch)errors.push('Mesh count changed: '+relative);await page.screenshot({path:path.join(output,path.basename(relative,'.glb')+'.png')});}
    result.models.push(after);
  }
  for(const id of ['plaster_painted_dirty','concrete_floor','wood_floor_worn','metal_rusty'])for(const profile of ['before','after']){
    result.normals.push({id,profile,...await page.evaluate(({id,profile})=>window.audit.normal(id,profile),{id,profile})});
    await page.screenshot({path:path.join(output,'normal-'+id+'-'+profile+'.png')});
  }
  await page.evaluate(()=>window.audit.close());
  result.localRequests=[...new Set(requests.filter(url=>url.startsWith(base)))];
  result.passed=errors.length===0&&warnings.length===0&&result.models.length===models.length;
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(result,null,2));
  if(!result.passed)throw new Error(JSON.stringify({errors,warnings}));
  console.log(JSON.stringify({passed:result.passed,models:result.models.length,normalPairs:result.normals.length/2,renderer:result.renderer}));
} finally {await browser.close();}
