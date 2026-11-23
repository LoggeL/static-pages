var e={eg:{title:`Essbereich im Erdgeschoss`,picture:`eg-blick.webp`,panorama:`eg.webp`},og:{title:`Wohnküche im Obergeschoss`,picture:`og-blick.webp`,panorama:`og.webp`},aussen:{title:`Haus von der Gartenseite`,picture:`aussen.webp`}},t=e=>new URL(`blender/`+e,document.baseURI).href,n=Math.PI/180,r=(e,t,n)=>Math.max(t,Math.min(n,e));function i(e){let t=e.getContext(`webgl`,{alpha:!1,antialias:!1,depth:!1,powerPreference:`low-power`});if(!t)return null;let i=(e,n)=>{let r=t.createShader(e);if(t.shaderSource(r,n),t.compileShader(r),!t.getShaderParameter(r,t.COMPILE_STATUS))throw Error(t.getShaderInfoLog(r));return r},a=i(t.VERTEX_SHADER,`
    attribute vec2 position;
    varying vec2 screen;
    void main() { screen = position; gl_Position = vec4(position, 0.0, 1.0); }
  `),o=i(t.FRAGMENT_SHADER,`
    precision highp float;
    varying vec2 screen;
    uniform vec4 lens;
    uniform sampler2D panorama;
    void main() {
      vec3 ray = normalize(vec3(screen.x * lens.x * lens.y, screen.y * lens.y, 1.0));
      float cp = cos(lens.w), sp = sin(lens.w);
      float y = ray.y * cp + ray.z * sp;
      float z = ray.z * cp - ray.y * sp;
      vec2 uv = vec2(fract(0.5 + (atan(ray.x, z) + lens.z) / 6.28318530718),
                     0.5 - asin(clamp(y, -1.0, 1.0)) / 3.14159265359);
      gl_FragColor = texture2D(panorama, uv);
    }
  `),s=t.createProgram();if(t.attachShader(s,a),t.attachShader(s,o),t.linkProgram(s),t.deleteShader(a),t.deleteShader(o),!t.getProgramParameter(s,t.LINK_STATUS))throw Error(t.getProgramInfoLog(s));t.useProgram(s);let c=t.getAttribLocation(s,`position`),l=t.getUniformLocation(s,`lens`),u=t.createBuffer();t.bindBuffer(t.ARRAY_BUFFER,u),t.bufferData(t.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),t.STATIC_DRAW),t.enableVertexAttribArray(c),t.vertexAttribPointer(c,2,t.FLOAT,!1,0,0);let d;function f(){d&&t.deleteTexture(d),d=null}return{clear:f,load(e){f();let n=t.getParameter(t.MAX_TEXTURE_SIZE),r=e;e.naturalWidth>n&&(r=document.createElement(`canvas`),r.width=n,r.height=Math.round(n*e.naturalHeight/e.naturalWidth),r.getContext(`2d`).drawImage(e,0,0,r.width,r.height)),d=t.createTexture(),t.bindTexture(t.TEXTURE_2D,d),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),t.texImage2D(t.TEXTURE_2D,0,t.RGB,t.RGB,t.UNSIGNED_BYTE,r)},draw({yaw:i,pitch:a,zoom:o}){if(!d||t.isContextLost()||!e.clientWidth||!e.clientHeight)return;let s=Math.min(window.devicePixelRatio||1,2),c=Math.round(e.clientWidth*s),u=Math.round(e.clientHeight*s);(e.width!==c||e.height!==u)&&(e.width=c,e.height=u);let f=c/u,p=r(Math.tan(42*n)/f,.38,.84)/o;t.viewport(0,0,c,u),t.uniform4f(l,f,p,i,a),t.drawArrays(t.TRIANGLES,0,3)}}}var a;function o(){let n=document.createElement(`dialog`);n.id=`blender-dialog`,n.setAttribute(`aria-labelledby`,`tour-heading`),n.innerHTML=`
    <div class="tour-shell">
      <header class="tour-header">
        <div class="tour-title"><p>Dautengasse · Wattenheim</p><h2 id="tour-heading">Haus in Blender</h2></div>
        <div class="tour-tabs" role="group" aria-label="Standpunkt wählen">
          <button data-room="eg">EG <span>· Essbereich</span></button>
          <button data-room="og">OG <span>· Wohnküche</span></button>
          <button data-room="aussen">Außen</button>
        </div>
        <button class="tour-close" type="button" aria-label="Blender-Ansichten schließen" title="Schließen">×</button>
      </header>
      <div class="tour-stage">
        <img class="tour-still" alt="">
        <canvas class="tour-pano" tabindex="0" aria-label="360-Grad-Raumansicht. Mit den Pfeiltasten umsehen, Plus und Minus zum Zoomen." hidden></canvas>
        <div class="tour-look" role="group" aria-label="Kamera einstellen" hidden>
          <button data-camera="out" aria-label="Herauszoomen">−</button>
          <button data-camera="reset" title="Blick zurücksetzen" aria-label="Blick zurücksetzen">↺</button>
          <button data-camera="in" aria-label="Hineinzoomen">+</button>
        </div>
      </div>
      <footer class="tour-foot">
        <span class="tour-status" role="status" aria-live="polite"></span>
        <div class="tour-actions"><a href="${t(`Wohnhaus-214.blend`)}" download>Blender-Datei</a><button class="tour-orbit">Modell isolieren</button></div>
      </footer>
    </div>`,document.getElementById(`app`).append(n);let a=n.querySelector(`.tour-stage`),o=n.querySelector(`canvas`),s=n.querySelector(`.tour-still`),c=n.querySelector(`.tour-status`),l=n.querySelector(`.tour-look`),u=[...n.querySelectorAll(`[data-room]`)],d=new Map,f,p=0,m,h,g=0,_={};function v(){Object.assign(_,{yaw:0,pitch:-.105,zoom:1})}function y(){n.open&&!o.hidden&&m?.draw(_)}function b(e){_.zoom=r(_.zoom*e,.7,2.8),y()}function x(e,t){_.yaw-=e,_.pitch=r(_.pitch+t,-1.52,1.52),y()}new ResizeObserver(y).observe(a);function S(e){o.hidden=!0,l.hidden=!0,c.textContent=e}async function C(r){r in e||(r=`eg`);let a=e[r],h=++p;f=r,n.dataset.room=r,d.clear(),v(),m?.clear();for(let e of u)e.setAttribute(`aria-pressed`,String(e.dataset.room===r));if(s.alt=a.title,s.src=t(a.picture),S(a.panorama?`Raumansicht wird geladen …`:`Gartenseite · Außenansicht`),a.panorama)try{if(m??=i(o),!m){S(a.title);return}let e=new Image;if(e.src=t(a.panorama),await e.decode(),h!==p||!n.open)return;m.load(e),o.hidden=!1,l.hidden=!1,y(),c.textContent=`360° · Ziehen zum Umsehen`}catch{h===p&&S(a.title+` · Einzelansicht`)}}o.addEventListener(`webglcontextlost`,t=>{t.preventDefault(),p++,m=null,S(e[f].title)}),o.addEventListener(`webglcontextrestored`,()=>{n.open&&C(f)}),u.forEach(e=>e.addEventListener(`click`,()=>C(e.dataset.room))),n.querySelector(`.tour-close`).onclick=()=>n.close(),n.querySelector(`.tour-orbit`).onclick=()=>{n.close(),h(f===`aussen`?`full`:f)},l.addEventListener(`click`,e=>{let t=e.target.closest(`button`)?.dataset.camera;t===`reset`?(v(),y()):t&&b(t===`in`?1.2:1/1.2)});function w(){let[e,t]=[...d.values()];return e&&t?Math.hypot(e.x-t.x,e.y-t.y):0}o.addEventListener(`pointerdown`,e=>{(e.pointerType!==`mouse`||e.button===0)&&(o.setPointerCapture(e.pointerId),d.set(e.pointerId,{x:e.clientX,y:e.clientY}),g=w())}),o.addEventListener(`pointermove`,e=>{let t=d.get(e.pointerId);if(t){if(d.set(e.pointerId,{x:e.clientX,y:e.clientY}),d.size===1){let n=1.8/(a.clientHeight*_.zoom);x((e.clientX-t.x)*n,(e.clientY-t.y)*n)}else if(d.size===2){let e=w();e>1&&g>1&&b(e/g),g=e}}});let T=e=>{d.delete(e.pointerId),g=w()};return o.addEventListener(`lostpointercapture`,T),o.addEventListener(`pointercancel`,T),o.addEventListener(`pointerup`,T),o.addEventListener(`wheel`,e=>{e.preventDefault(),b(Math.exp(-Math.sign(e.deltaY)*.1))},{passive:!1}),o.addEventListener(`keydown`,e=>{if(!(e.metaKey||e.ctrlKey||e.altKey)){switch(e.key){case`ArrowLeft`:x(.12,0);break;case`ArrowRight`:x(-.12,0);break;case`ArrowUp`:x(0,.12);break;case`ArrowDown`:x(0,-.12);break;case`+`:case`=`:b(1.2);break;case`-`:b(1/1.2);break;case`Home`:v(),y();break;default:return}e.preventDefault()}}),n.addEventListener(`close`,()=>{p++,d.clear(),m?.clear(),[`#innen`,`#innen-og`,`#blender`].includes(location.hash)&&history.replaceState(null,``,location.pathname+location.search)}),(e,t)=>{h=t,n.open||n.showModal(),C(e)}}function s(e,t){a??=o(),a(e,t)}export{s as openTour};