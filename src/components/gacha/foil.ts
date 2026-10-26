/**
 * SSR foil (ported from the v2 prototype foil.js): one raw WebGL fragment
 * shader that redraws the art and lays six flat PICO-8 bands with hard stops
 * on the card's outer band only, so the face is never tinted. Glints are
 * hard-edged round specks. Driven by the real pointer; it only redraws when
 * the pointer state changes. Returns a cleanup that stops the loop. No WebGL =
 * no foil canvas (the plain art stays visible underneath).
 */
export interface FoilState { x: number; y: number; lit: boolean }

const VS: string = 'attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}';
const FS: string = `precision mediump float;
varying vec2 v;
uniform sampler2D uTex; uniform vec2 uImg, uRes, uTilt, uFocal, uLight; uniform float uCell;
float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
vec3 band6(float h){ float i=mod(floor(h),6.);
  if(i<1.) return vec3(1.,0.,.302); if(i<2.) return vec3(1.,.639,0.); if(i<3.) return vec3(1.,.925,.153);
  if(i<4.) return vec3(0.,.894,.212); if(i<5.) return vec3(.161,.678,1.); return vec3(1.,.467,.659); }
void main(){
  vec2 fp=vec2(v.x,1.-v.y)*uRes;
  vec2 uv=fp/uRes;
  float s=max(uRes.x/uImg.x,uRes.y/uImg.y)*1.02;
  vec2 D=uImg*s, off=(uRes-D)*uFocal - uTilt*uRes*.01;
  vec3 art=texture2D(uTex,clamp((fp-off)/D,0.,1.)).rgb;
  vec2 c=uv-.5; float m=max(abs(c.x)*1.05,abs(c.y)*1.02);
  float edge=step(.445,m);                                  // hard-edged outer band only
  vec2 dir=normalize(vec2(1.,.72));
  vec3 fc=band6(dot(fp,dir)/(uCell*1.4)+uTilt.x*6.-uTilt.y*4.);
  vec3 col=mix(art,1.-(1.-art)*(1.-fc),.55*edge);           // screen-blend the flat band colour
  vec2 g=fp/uCell, id=floor(g), fr=fract(g)-.5;
  float h=hash(id), h2=hash(id+7.31);
  if(h>.6 && edge>.5){
    vec2 o=vec2(h2,fract(h*13.7))-.5; vec2 d=(fr-o*.6)*uCell;
    float r=uCell*(.08+.12*fract(h*41.));
    float tw=step(.5,fract(h*7.13+dot(uTilt,vec2(1.9,1.4))));
    col=mix(col,vec3(1.),tw*step(length(d),r));             // a round, hard-edged speck
  }
  gl_FragColor=vec4(clamp(col,0.,1.),1.);
}`;


export function mountFoil(canvas: HTMLCanvasElement, state: FoilState): () => void {
    const img = canvas.parentElement?.querySelector("img");
    const gl = canvas.getContext("webgl", { antialias: false, preserveDrawingBuffer: true });
    if (!gl || !img) return () => {};
    let raf = 0;
    let stopped = false;
    try {
        const sh = (type: number, text: string) => {
            const s = gl.createShader(type)!;
            gl.shaderSource(s, text);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
            return s;
        };
        const pr = gl.createProgram()!;
        gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS));
        gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
        gl.linkProgram(pr);
        gl.useProgram(pr);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(pr, "p");
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        const U = (n: string) => gl.getUniformLocation(pr, n);
        const focal = (img.style.objectPosition || "50% 30%").split(" ").map((v) => parseFloat(v) / 100);
        let last = "";
        const start = () => {
            if (stopped) return;
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            try {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            } catch {
                return; // tainted/cross-origin image: keep the plain art
            }
            for (const [k, val] of [
                [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
                [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
                [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
                [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
            ]) gl.texParameteri(gl.TEXTURE_2D, k, val);
            gl.uniform2f(U("uImg"), img.naturalWidth, img.naturalHeight);
            gl.uniform2f(U("uFocal"), focal[0], focal[1] ?? 0.3);
            const draw = () => {
                if (stopped) return;
                const dpr = Math.min(devicePixelRatio || 1, 3);
                const w = canvas.clientWidth;
                const h = canvas.clientHeight;
                const key = [w, h, state.x, state.y, state.lit].join();
                if (key !== last && w) {
                    last = key;
                    canvas.width = Math.round(w * dpr);
                    canvas.height = Math.round(h * dpr);
                    gl.viewport(0, 0, canvas.width, canvas.height);
                    gl.uniform2f(U("uRes"), canvas.width, canvas.height);
                    gl.uniform2f(U("uTilt"), state.x, state.y);
                    gl.uniform2f(U("uLight"), state.lit ? state.x + 0.5 : 0.26, state.lit ? state.y + 0.5 : 0.14);
                    gl.uniform1f(U("uCell"), Math.max(8, (w * dpr) / 22));
                    gl.drawArrays(gl.TRIANGLES, 0, 3);
                }
                raf = requestAnimationFrame(draw);
            };
            draw();
            canvas.closest(".c2")?.classList.add("gl");
        };
        if (img.complete && img.naturalWidth) start();
        else img.addEventListener("load", start, { once: true });
    } catch {
        return () => {};
    }
    return () => {
        stopped = true;
        cancelAnimationFrame(raf);
        gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
}
