/** Radial refraction studied at noho.ink; see reference-evidence/noho-motion.md. */
const vertex = `
attribute vec2 position;
varying vec2 uv;
void main(){ uv=position*.5+.5; gl_Position=vec4(position,0.,1.); }
`;
const fragment = `
precision highp float;
uniform sampler2D picture;
uniform vec2 resolution;
uniform float imageAspect;
uniform float time;
varying vec2 uv;
float wave(vec2 p){
 float r=length(p);
 float phase=.55*time-(r+.55*r*r);
 if(phase<0.) return 0.;
 return sin(30.*phase)*exp(-3.*phase)/(1.+r*11.5);
}
void main(){
 vec2 point=clamp(uv,0.,1.);
 vec2 direction=point-.5;
 float aspect=resolution.x/resolution.y;
 vec2 radial=vec2(direction.x*aspect,direction.y);
 float height=wave(radial);
 float dx=wave(radial+vec2(.01,0.))-height;
 float dy=wave(radial+vec2(0.,.01))-height;
 vec3 normal=normalize(vec3(-dx*2.5,-dy*2.5,1.));
 vec2 refracted=point+normal.xy*.23;
 vec2 fit=vec2(1.);
 if(imageAspect>aspect) fit.y=aspect/imageAspect;
 else fit.x=imageAspect/aspect;
 vec2 samplePoint=(refracted-.5)/fit+.5;
 float inside=step(0.,samplePoint.x)*step(samplePoint.x,1.)*step(0.,samplePoint.y)*step(samplePoint.y,1.);
 vec4 color=texture2D(picture,clamp(samplePoint,0.,1.))*inside;
 float reveal=1.-smoothstep(-10.,4.,distance(point,vec2(.5))*25.-pow(time*3.,2.));
 float alpha=color.a*reveal;
 // Premultiplied transparency keeps PRISM's existing gradient behind the object.
 gl_FragColor=vec4((color.rgb+height*.08)*alpha,alpha);
}
`;

// Preserve the reference wave trajectory, but fit storefront scrolling speed.
export const WAVE_SPEED = 3;
export const WAVE_DURATION = 3200 / WAVE_SPEED;
export const WAVE_HANDOFF = 2850 / WAVE_SPEED;

/** One short-lived context per visible object, released on completion or failure. */
export function createImageWave(image: HTMLImageElement) {
 const canvas=document.createElement('canvas');
 canvas.className='image-wave-canvas';
 canvas.setAttribute('aria-hidden','true');
 const gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:false,depth:false,stencil:false});
 if(!gl)return null;
 const shaders:WebGLShader[]=[];
 let program:WebGLProgram|null=null;
 let buffer:WebGLBuffer|null=null;
 let texture:WebGLTexture|null=null;
 const dispose=()=>{
  canvas.remove();
  if(texture)gl.deleteTexture(texture);
  if(buffer)gl.deleteBuffer(buffer);
  if(program)gl.deleteProgram(program);
  shaders.forEach(shader=>gl.deleteShader(shader));
  gl.getExtension('WEBGL_lose_context')?.loseContext();
 };
 try{
  const compile=(kind:number,source:string)=>{
   const shader=gl.createShader(kind);if(!shader)throw new Error('Shader unavailable');
   shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);
   if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error('Shader compilation failed');
   return shader;
  };
  program=gl.createProgram();if(!program)throw new Error('Program unavailable');
  gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));
  gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));
  gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Program linking failed');
  gl.useProgram(program);
  buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  const position=gl.getAttribLocation(program,'position');
  gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
  texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
  if(gl.getError()!==gl.NO_ERROR)throw new Error('Texture unavailable');
  gl.uniform1i(gl.getUniformLocation(program,'picture'),0);
  gl.uniform1f(gl.getUniformLocation(program,'imageAspect'),image.naturalWidth/image.naturalHeight);
  const time=gl.getUniformLocation(program,'time');
  const resolution=gl.getUniformLocation(program,'resolution');
  const resize=()=>{
   const style=getComputedStyle(image);
   const px=(value:string)=>parseFloat(value)||0;
   const left=px(style.paddingLeft),top=px(style.paddingTop);
   const width=image.clientWidth-left-px(style.paddingRight);
   const height=image.clientHeight-top-px(style.paddingBottom);
   const dpr=Math.min(devicePixelRatio||1,2);
   canvas.width=Math.max(1,Math.round(width*dpr));canvas.height=Math.max(1,Math.round(height*dpr));
   Object.assign(canvas.style,{left:`${image.offsetLeft+left}px`,top:`${image.offsetTop+top}px`,width:`${width}px`,height:`${height}px`,transform:style.transform,transformOrigin:style.transformOrigin,filter:style.filter});
   gl.viewport(0,0,canvas.width,canvas.height);gl.uniform2f(resolution,width,height);
  };
  resize();
  return {canvas,dispose,resize,draw(seconds:number){
   if(gl.isContextLost())return false;
   gl.uniform1f(time,seconds);gl.drawArrays(gl.TRIANGLES,0,3);return true;
  }};
 }catch{dispose();return null;}
}
