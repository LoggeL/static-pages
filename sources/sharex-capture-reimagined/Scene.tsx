import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/** A real-time, pointer-responsive sculpture in the four ShareX brand colors. */
export default function Scene({ paused }: { paused: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const frozen = useRef(paused);
  useEffect(() => { frozen.current = paused; }, [paused]);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true }); }
    catch { el.dataset.fallback = 'true'; return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setClearColor(0x060912, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.55;
    renderer.domElement.setAttribute('aria-label', 'Rotating sculpture in the original ShareX colors');
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0, 10.4);
    const group = new THREE.Group();
    scene.add(group);
    const colors = [0x3675ff, 0xff5042, 0xf6ff00, 0x14e620];
    const materials: THREE.Material[] = [];
    const geometries: THREE.BufferGeometry[] = [];
    const lights = new THREE.AmbientLight(0xffffff, 2.2);
    scene.add(lights);
    [[0x8dbeff, 5, 4, 5], [0xffffff, -5, 0, 4], [0xffe886, 0, -5, 3]].forEach(([color,x,y,z]) => {
      const light = new THREE.PointLight(color, 75, 30); light.position.set(x,y,z);scene.add(light);
    });
    const geo = new THREE.TorusGeometry(1.55, 0.13, 20, 150);
    geometries.push(geo);
    colors.forEach((color,i) => {
      const mat = new THREE.MeshPhysicalMaterial({ color, metalness: 0.45, roughness: 0.21, clearcoat: 1, clearcoatRoughness: 0.12, emissive: color, emissiveIntensity: 0.12 });
      materials.push(mat);
      const ring = new THREE.Mesh(geo,mat);
      ring.rotation.set(Math.PI / 2.8 + i * .36, i * Math.PI / 4, i * .45);
      ring.scale.setScalar(1 + i * .085);
      group.add(ring);
    });
    const coreGeo = new THREE.IcosahedronGeometry(.48, 0);
    const coreMat = new THREE.MeshPhysicalMaterial({color:0xddeaff,metalness:.9,roughness:.1,clearcoat:1,emissive:0x3675ff,emissiveIntensity:.18});
    const core = new THREE.Mesh(coreGeo, coreMat);group.add(core);geometries.push(coreGeo);materials.push(coreMat);
    const pointPositions = new Float32Array(180 * 3);
    for(let i=0;i<180;i++){const n=i*2.399963;const r=2.4+(i%17)*.13;pointPositions[i*3]=Math.cos(n)*r;pointPositions[i*3+1]=Math.sin(n)*r;pointPositions[i*3+2]=Math.sin(i*1.77)*2;}
    const pointGeo=new THREE.BufferGeometry();pointGeo.setAttribute('position',new THREE.BufferAttribute(pointPositions,3));
    const pointMat=new THREE.PointsMaterial({color:0x6a96dc,size:.017,transparent:true,opacity:.6});const particles=new THREE.Points(pointGeo,pointMat);scene.add(particles);geometries.push(pointGeo);materials.push(pointMat);
    const size=()=>{const {width,height}=el.getBoundingClientRect();renderer.setSize(width,height);camera.aspect=width/Math.max(1,height);camera.updateProjectionMatrix();};
    const resize=new ResizeObserver(size);resize.observe(el);size();
    let visible=true;const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;});observer.observe(el);
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
    let tx=0,ty=0,angle=.5,frame=0,previous=0;
    const move=(e:PointerEvent)=>{const b=el.getBoundingClientRect();tx=(e.clientX-b.left)/b.width-.5;ty=(e.clientY-b.top)/b.height-.5;};
    const parent=el.parentElement!;parent.addEventListener('pointermove',move);
    function render(now:number){frame=requestAnimationFrame(render);const dt=Math.min((now-previous)/1000,.04);previous=now;if(!visible||document.hidden)return;
      if(!frozen.current&&!reduced.matches){angle+=dt*.18;group.rotation.y+=(angle+tx*.3-group.rotation.y)*.045;group.rotation.x+=(.38+ty*.3-group.rotation.x)*.045;group.rotation.z=Math.sin(angle*.6)*.16;core.rotation.y-=dt*.5;particles.rotation.z=angle*.025;}
      renderer.render(scene,camera);
    }
    group.rotation.set(.38,.5,0);frame=requestAnimationFrame(render);
    return()=>{cancelAnimationFrame(frame);resize.disconnect();observer.disconnect();parent.removeEventListener('pointermove',move);geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());renderer.dispose();renderer.domElement.remove();};
  },[]);
  return <div className="live-scene" ref={host}><img className="scene-fallback" src="./sharex-logo.svg" alt="ShareX"/></div>;
}
