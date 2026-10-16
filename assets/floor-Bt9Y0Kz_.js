import{An as e,G as t,K as n,Mn as r,N as i,On as a,f as o,kn as s,on as c,ot as l,u,yn as d}from"./three.core-BkJOoRIH.js";var f=class a extends n{constructor(n,u={}){super(n),this.isReflector=!0,this.type=`Reflector`,this.forceUpdate=!1,this._reflectionCameras=new WeakMap;let f=this,p=u.color===void 0?new o(8355711):new o(u.color),m=u.textureWidth||512,h=u.textureHeight||512,g=u.clipBias||0,_=u.shader||a.ReflectorShader,v=u.multisample===void 0?4:u.multisample,y=new l,b=new s,x=new s,S=new s,C=new t,w=new s(0,0,-1),T=new e,E=new s,D=new s,O=new e,k=new t,A=new r(m,h,{samples:v,type:i}),j=new c({name:_.name===void 0?`unspecified`:_.name,uniforms:d.clone(_.uniforms),fragmentShader:_.fragmentShader,vertexShader:_.vertexShader});j.uniforms.tDiffuse.value=A.texture,j.uniforms.color.value=p,j.uniforms.textureMatrix.value=k,this.material=j,this.onBeforeRender=function(e,t,n){let r=this.getReflectionCamera(n);if(x.setFromMatrixPosition(f.matrixWorld),S.setFromMatrixPosition(n.matrixWorld),C.extractRotation(f.matrixWorld),b.set(0,0,1),b.applyMatrix4(C),E.subVectors(x,S),E.dot(b)>0&&this.forceUpdate===!1)return;E.reflect(b).negate(),E.add(x),C.extractRotation(n.matrixWorld),w.set(0,0,-1),w.applyMatrix4(C),w.add(S),D.subVectors(x,w),D.reflect(b).negate(),D.add(x),r.position.copy(E),r.up.set(0,1,0),r.up.applyMatrix4(C),r.up.reflect(b),r.lookAt(D),r.far=n.far,r.updateMatrixWorld(),r.projectionMatrix.copy(n.projectionMatrix),k.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),k.multiply(r.projectionMatrix),k.multiply(r.matrixWorldInverse),k.multiply(f.matrixWorld),y.setFromNormalAndCoplanarPoint(b,x),y.applyMatrix4(r.matrixWorldInverse),T.set(y.normal.x,y.normal.y,y.normal.z,y.constant);let i=r.projectionMatrix;r.isOrthographicCamera?(O.x=(Math.sign(T.x)+i.elements[8])/i.elements[0],O.y=(Math.sign(T.y)+i.elements[9])/i.elements[5],O.z=-n.far,O.w=1):(O.x=(Math.sign(T.x)+i.elements[8])/i.elements[0],O.y=(Math.sign(T.y)+i.elements[9])/i.elements[5],O.z=-1,O.w=(1+i.elements[10])/i.elements[14]),T.multiplyScalar(2/T.dot(O)),i.elements[2]=T.x,i.elements[6]=T.y,r.isOrthographicCamera?(i.elements[10]=T.z-g,i.elements[14]=T.w-1):(i.elements[10]=T.z+1-g,i.elements[14]=T.w),f.visible=!1;let a=e.getRenderTarget(),o=e.xr.enabled,s=e.shadowMap.autoUpdate;e.xr.enabled=!1,e.shadowMap.autoUpdate=!1,e.setRenderTarget(A),e.state.buffers.depth.setMask(!0),e.autoClear===!1&&e.clear(),e.render(t,r),e.xr.enabled=o,e.shadowMap.autoUpdate=s,e.setRenderTarget(a);let c=n.viewport;c!==void 0&&e.state.viewport(c),f.visible=!0,this.forceUpdate=!1},this.getRenderTarget=function(){return A},this.dispose=function(){A.dispose(),f.material.dispose()},this.getReflectionCamera=function(e){let t=this._reflectionCameras.get(e);return t===void 0&&(t=e.clone(),this._reflectionCameras.set(e,t)),t}}};f.ReflectorShader={name:`ReflectorShader`,uniforms:{color:{value:null},tDiffuse:{value:null},textureMatrix:{value:null}},vertexShader:`
		uniform mat4 textureMatrix;
		varying vec4 vUv;

		#include <common>
		#include <logdepthbuf_pars_vertex>

		void main() {

			vUv = textureMatrix * vec4( position, 1.0 );

			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

			#include <logdepthbuf_vertex>

		}`,fragmentShader:`
		uniform vec3 color;
		uniform sampler2D tDiffuse;
		varying vec4 vUv;

		#include <logdepthbuf_pars_fragment>

		float blendOverlay( float base, float blend ) {

			return( base < 0.5 ? ( 2.0 * base * blend ) : ( 1.0 - 2.0 * ( 1.0 - base ) * ( 1.0 - blend ) ) );

		}

		vec3 blendOverlay( vec3 base, vec3 blend ) {

			return vec3( blendOverlay( base.r, blend.r ), blendOverlay( base.g, blend.g ), blendOverlay( base.b, blend.b ) );

		}

		void main() {

			#include <logdepthbuf_fragment>

			vec4 base = texture2DProj( tDiffuse, vUv );
			gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );

			#include <tonemapping_fragment>
			#include <colorspace_fragment>

		}`};var p={name:`GlossyFloorShader`,uniforms:{color:{value:null},tDiffuse:{value:null},textureMatrix:{value:null},strength:{value:.32},texel:{value:new a(1/512,1/512)},radius:{value:6}},vertexShader:`
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec2 vLocal;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0); // where this floor point lands in the mirror image
      vLocal = position.xy; // distance from the centre, for the fade
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #include <logdepthbuf_vertex>
    }`,fragmentShader:`
    uniform sampler2D tDiffuse;
    uniform float strength;
    uniform vec2 texel;
    uniform float radius;
    varying vec4 vUv;
    varying vec2 vLocal;
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      vec2 uv = vUv.xy / vUv.w;
      // centre + 4 diagonal samples = a cheap blur
      vec3 c = texture2D(tDiffuse, uv).rgb * 0.36;
      c += texture2D(tDiffuse, uv + texel * vec2( 2.0,  2.0)).rgb * 0.16;
      c += texture2D(tDiffuse, uv + texel * vec2(-2.0,  2.0)).rgb * 0.16;
      c += texture2D(tDiffuse, uv + texel * vec2( 2.0, -2.0)).rgb * 0.16;
      c += texture2D(tDiffuse, uv + texel * vec2(-2.0, -2.0)).rgb * 0.16;
      float fade = 1.0 - smoothstep(radius * 0.12, radius, length(vLocal));
      gl_FragColor = vec4(c * strength * fade, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`};function m(e){let t=new f(new u(p.uniforms.radius.value,64),{shader:p,textureWidth:512,textureHeight:512,clipBias:.003,multisample:0}),n=t.material;n.blending=2,n.transparent=!0,n.depthWrite=!1,t.rotation.x=-Math.PI/2,t.position.y=5e-4,t.renderOrder=.5,e.add(t);let r=0,i=0,a=n.uniforms.strength.value;return{mirror:t,setStrength(e){n.uniforms.strength.value=a*e},fit(e,a){let o=Math.max(64,Math.round(e*.5)),s=Math.max(64,Math.round(a*.5));(o!==r||s!==i)&&(r=o,i=s,t.getRenderTarget().setSize(r,i),n.uniforms.texel.value.set(1/r,1/i))}}}export{m as createGlossyFloor};