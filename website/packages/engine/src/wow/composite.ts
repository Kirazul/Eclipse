/**
 * The body composite, on the GPU: each layer is drawn by rect into a render target
 * with its blend mode, once per change and never per frame. The formulas read the
 * destination, which fixed-function blending cannot do for overlay, so each layer
 * renders into scratch while sampling what is already there, and is copied back.
 * Row 0 of every image is v = 0 and NDC y = -1, so nothing is flipped along the way.
 */
import {
  ClampToEdgeWrapping,
  Color,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NearestFilter,
  NoBlending,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  Vector4,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from "three";

export interface DrawnLayer {
  rect: { x: number; y: number; w: number; h: number };
  blend: number;
  texture: Texture;
  /** A colour with no art for this shape colours the shape's own, lightness kept. rgb 0..1. */
  tint?: readonly [number, number, number];
  /** Drawn into the emissive channel, by its rules: RaceComposite.h BlendEmissive. */
  emissive?: boolean;
}

const LAYER_VS = /* glsl */ `
uniform vec4 uRect;
varying vec2 vSrc;
varying vec2 vDst;
void main() {
  vSrc = uv;
  vDst = uRect.xy + uv * uRect.zw;
  gl_Position = vec4(vDst * 2.0 - 1.0, 0.0, 1.0);
}`;

const LAYER_FS = /* glsl */ `
uniform sampler2D uSrc;
uniform sampler2D uDst;
uniform int uMode;
uniform vec4 uTint;
uniform float uEmissive;
varying vec2 vSrc;
varying vec2 vDst;
vec3 overlay(vec3 d, vec3 s) {
  vec3 lo = 2.0 * d * s;
  vec3 hi = 1.0 - 2.0 * (1.0 - d) * (1.0 - s);
  return mix(hi, lo, step(s, vec3(0.5 - 1e-5)));
}
void main() {
  vec4 src = texture2D(uSrc, vSrc);
  if (uTint.a > 0.5) {
    float l = dot(src.rgb, vec3(0.2126, 0.7152, 0.0722));
    float t = max(dot(uTint.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.001);
    src.rgb = clamp(uTint.rgb * l / t, 0.0, 1.0);
  }
  vec4 dst = texture2D(uDst, vDst);
  vec4 res;
  if (uEmissive > 0.5) {
    // RaceComposite.h BlendEmissive: 10 is drawn art erasing the glow under it, 16 and 17
    // weigh by the channel's own alpha. Alpha is no strength: the result is forced to 1.
    float sa = src.a;
    if (uMode == 1 || uMode == 2) res = src;
    else if (uMode == 9 || uMode == 15) res = vec4(src.rgb * sa + dst.rgb * (1.0 - sa), 1.0);
    else if (uMode == 10) res = vec4(dst.rgb * (1.0 - sa), 1.0);
    else {
      float oa = sa + dst.a * (1.0 - sa);
      vec3 c = oa > 0.0 ? (src.rgb * sa + dst.rgb * dst.a * (1.0 - sa)) / oa : vec3(0.0);
      res = vec4(c, uMode == 17 && max(src.r, max(src.g, src.b)) > 0.0 ? 0.0 : oa);
    }
  } else if (uMode == 0 || uMode == 1) {
    res = src;
  } else if (uMode == 9 || uMode == 15) {
    float a = uMode == 9 ? src.a + dst.a * (1.0 - src.a) : src.a * src.a + dst.a * (1.0 - src.a);
    res = vec4(src.rgb * src.a + dst.rgb * (1.0 - src.a), a);
  } else {
    vec4 c;
    if (uMode == 4) c = dst * src;
    else if (uMode == 7) c = vec4(1.0 - (1.0 - dst.rgb) * (1.0 - src.rgb), src.a);
    else c = vec4(overlay(dst.rgb, src.rgb), src.a);
    res = vec4(c.rgb * c.a + dst.rgb * (1.0 - c.a), c.a * c.a + dst.a * (1.0 - c.a));
  }
  gl_FragColor = res;
}`;

const COPY_VS = /* glsl */ `
uniform vec4 uRect;
varying vec2 vUv;
void main() {
  vUv = uRect.xy + uv * uRect.zw;
  gl_Position = vec4(vUv * 2.0 - 1.0, 0.0, 1.0);
}`;

const COPY_FS = /* glsl */ `
uniform sampler2D uSrc;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(uSrc, vUv); }`;

function scratchTarget(w: number, h: number): WebGLRenderTarget {
  const t = new WebGLRenderTarget(w, h, {
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    colorSpace: NoColorSpace,
  });
  t.texture.wrapS = t.texture.wrapT = ClampToEdgeWrapping;
  return t;
}

export class CompositeRenderer {
  /** How many composites have been drawn: proof that it is once per change. */
  runs = 0;

  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly geometry = new PlaneGeometry(2, 2);
  private readonly layerMat = new ShaderMaterial({
    vertexShader: LAYER_VS,
    fragmentShader: LAYER_FS,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uRect: { value: new Vector4() },
      uSrc: { value: null },
      uDst: { value: null },
      uMode: { value: 0 },
      uTint: { value: new Vector4() },
      uEmissive: { value: 0 },
    },
  });
  private readonly copyMat = new ShaderMaterial({
    vertexShader: COPY_VS,
    fragmentShader: COPY_FS,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
    uniforms: { uRect: { value: new Vector4() }, uSrc: { value: null } },
  });
  private readonly quad = new Mesh(this.geometry, this.layerMat);
  private a: WebGLRenderTarget | null = null;
  private b: WebGLRenderTarget | null = null;

  constructor(private readonly renderer: WebGLRenderer) {
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    // The plane's corners are -1..1 in position and 0..1 in uv; the shaders use uv only.
  }

  /** Draws a fresh composite. The caller owns the result and swaps it in when it wants. */
  render(width: number, height: number, layers: readonly DrawnLayer[], anisotropy: number, repeat = false): WebGLRenderTarget {
    const out = new WebGLRenderTarget(width, height, {
      // A model texture wraps on some bodies (retail's types 7, 20, 26); the skin canvas never does.
      ...(repeat ? { wrapS: RepeatWrapping, wrapT: RepeatWrapping } : {}),
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
      colorSpace: NoColorSpace,
      anisotropy,
    });
    out.texture.flipY = false;

    if (!this.a || this.a.width !== width || this.a.height !== height) {
      this.a?.dispose();
      this.b?.dispose();
      this.a = scratchTarget(width, height);
      this.b = scratchTarget(width, height);
    }
    const a = this.a;
    const b = this.b!;
    const r = this.renderer;
    const keepTarget = r.getRenderTarget();
    const keepAutoClear = r.autoClear;
    const keepAlpha = r.getClearAlpha();
    const keepColor = r.getClearColor(_clear).getHex();
    const keepScissor = r.getScissorTest();
    r.autoClear = false;
    r.setScissorTest(false);
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(a);
    r.clear(true, false, false);

    const layerU = this.layerMat.uniforms as Record<string, { value: unknown }>;
    const copyU = this.copyMat.uniforms as Record<string, { value: unknown }>;
    for (const layer of layers) {
      const rect = (layerU.uRect!.value as Vector4).set(
        layer.rect.x / width,
        layer.rect.y / height,
        layer.rect.w / width,
        layer.rect.h / height,
      );
      layerU.uSrc!.value = layer.texture;
      layerU.uDst!.value = a.texture;
      layerU.uMode!.value = layer.blend;
      (layerU.uTint!.value as Vector4).set(layer.tint?.[0] ?? 0, layer.tint?.[1] ?? 0, layer.tint?.[2] ?? 0, layer.tint ? 1 : 0);
      layerU.uEmissive!.value = layer.emissive ? 1 : 0;
      this.quad.material = this.layerMat;
      r.setRenderTarget(b);
      r.render(this.scene, this.camera);

      (copyU.uRect!.value as Vector4).copy(rect);
      copyU.uSrc!.value = b.texture;
      this.quad.material = this.copyMat;
      r.setRenderTarget(a);
      r.render(this.scene, this.camera);
    }

    // The one draw into the mipmapped target: three builds its mips exactly once.
    (copyU.uRect!.value as Vector4).set(0, 0, 1, 1);
    copyU.uSrc!.value = a.texture;
    this.quad.material = this.copyMat;
    r.setRenderTarget(out);
    r.render(this.scene, this.camera);

    r.setRenderTarget(keepTarget);
    r.setClearColor(keepColor, keepAlpha);
    r.autoClear = keepAutoClear;
    r.setScissorTest(keepScissor);
    layerU.uSrc!.value = layerU.uDst!.value = copyU.uSrc!.value = null;
    this.runs++;
    return out;
  }

  dispose(): void {
    this.a?.dispose();
    this.b?.dispose();
    this.a = this.b = null;
    this.layerMat.dispose();
    this.copyMat.dispose();
    this.geometry.dispose();
  }
}

const _clear = new Color();
