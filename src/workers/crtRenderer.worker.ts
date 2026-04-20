/**
 * CRT Render Worker — owns the WebGL context and runs the CRT shader at 60fps.
 *
 * Communication protocol:
 * - Main → Worker: { type: 'init', canvas, width, height }
 * - Main → Worker: { type: 'frame', blob }          // captured SVG as Blob
 * - Main → Worker: { type: 'resize', width, height }
 * - Main → Worker: { type: 'uniforms', intensity, fade, startTime?, resetStartTime? }
 * - Main → Worker: { type: 'dispose' }
 */

// ---- Shaders (raw GLSL, no Three.js) ----

const VERT_SRC = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  // Map [-1,1] to [0,1], flip Y so top-left origin matches canvas/image
  vUv = vec2(aPosition.x * 0.5 + 0.5, 1.0 - (aPosition.y * 0.5 + 0.5));
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAG_SRC = `
precision mediump float;
uniform sampler2D uTexture;
uniform float uTime;
uniform float uStartTime;
uniform float uIntensity;
uniform float uFade;
uniform vec2 uResolution;
varying vec2 vUv;

vec2 barrelDistort(vec2 uv, float k) {
  vec2 cc = uv - 0.5;
  float r2 = dot(cc, cc);
  return uv + cc * r2 * k;
}

void main() {
  float i = uIntensity;
  float elapsed = uTime - uStartTime;

  // --- CRT power-on: electric jolt ---
  float t = clamp(elapsed / 0.6, 0.0, 1.0);

  float sx = elapsed < 0.05 ? 0.01 :
             elapsed < 0.15 ? mix(0.01, 1.0, pow((elapsed - 0.05) / 0.1, 0.3)) :
             1.0;
  sx = clamp(sx, 0.001, 1.0);

  float sy = elapsed < 0.12 ? 0.003 :
             elapsed < 0.3  ? mix(0.003, 1.0, pow((elapsed - 0.12) / 0.18, 0.4)) :
             1.0;
  sy = clamp(sy, 0.001, 1.0);

  float flash = elapsed < 0.05 ? 20.0 :
                elapsed < 0.15 ? mix(20.0, 4.0, (elapsed - 0.05) / 0.1) :
                elapsed < 0.3  ? mix(4.0, 1.3, (elapsed - 0.15) / 0.15) :
                mix(1.3, 1.0, clamp((elapsed - 0.3) / 0.3, 0.0, 1.0));

  vec3 tint = elapsed < 0.15 ? mix(vec3(0.6, 0.7, 1.0), vec3(1.0), elapsed / 0.15) : vec3(1.0);

  float noise = 0.0;
  if (elapsed < 0.3) {
    float n = fract(sin(dot(vUv * elapsed * 200.0, vec2(12.9898, 78.233))) * 43758.5453);
    noise = n * 0.2 * (1.0 - t);
  }

  vec2 powerUv = vUv;
  powerUv.x = 0.5 + (powerUv.x - 0.5) / sx;
  powerUv.y = 0.5 + (powerUv.y - 0.5) / sy;

  if (powerUv.x < 0.0 || powerUv.x > 1.0 || powerUv.y < 0.0 || powerUv.y > 1.0) {
    float edgeDist = max(
      max(-powerUv.x, powerUv.x - 1.0),
      max(-powerUv.y, powerUv.y - 1.0)
    );
    float glow = exp(-edgeDist * 20.0) * flash * 0.1 * (1.0 - t);
    gl_FragColor = vec4(glow * tint, 1.0);
    return;
  }

  // --- Barrel distortion ---
  float barrelK = 0.2 * i;
  vec2 uv = barrelDistort(powerUv, barrelK);
  uv = clamp(uv, 0.0, 1.0);

  vec2 texel = 1.0 / uResolution;

  // --- Base color ---
  vec4 color = texture2D(uTexture, uv);

  // --- Bloom (4-tap cross) ---
  float bloomR = 1.5 * i;
  vec4 bloom = vec4(0.0);
  bloom += texture2D(uTexture, uv + vec2( 0.0,     -texel.y) * bloomR);
  bloom += texture2D(uTexture, uv + vec2(-texel.x,  0.0)     * bloomR);
  bloom += texture2D(uTexture, uv + vec2( texel.x,  0.0)     * bloomR);
  bloom += texture2D(uTexture, uv + vec2( 0.0,      texel.y) * bloomR);
  bloom /= 4.0;
  color = mix(color, bloom, 0.15 * i);

  // --- Chromatic aberration ---
  vec2 center = uv - 0.5;
  float dist = length(center);
  float aberr = dist * dist * 0.6 * i * texel.x * 80.0;
  color.r = mix(color.r, texture2D(uTexture, uv + vec2(aberr * texel.x, 0.0)).r, 0.4);
  color.b = mix(color.b, texture2D(uTexture, uv - vec2(aberr * texel.x, 0.0)).b, 0.4);

  // --- Scanlines ---
  float scanline = sin(uv.y * uResolution.y * 1.5) * 0.5 + 0.5;
  scanline = 1.0 - pow(1.0 - scanline, 2.0) * 0.06 * i;
  color.rgb *= scanline;

  // --- Flicker ---
  float flicker = 1.0 - (sin(uTime * 8.3) * 0.003 + sin(uTime * 12.7) * 0.002) * i;
  color.rgb *= flicker;

  // --- Brightness boost ---
  color.rgb *= 1.0 + 0.1 * i;

  // --- Power-on effects ---
  color.rgb *= flash;
  color.rgb *= tint;
  color.rgb += noise;

  // --- Global fade ---
  color.rgb *= uFade;

  gl_FragColor = color;
}
`;

// ---- WebGL setup (raw, no Three.js) ----

let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
let program: WebGLProgram | null = null;
let texture: WebGLTexture | null = null;

// Uniform locations
let uTimeLoc: WebGLUniformLocation | null = null;
let uStartTimeLoc: WebGLUniformLocation | null = null;
let uIntensityLoc: WebGLUniformLocation | null = null;
let uFadeLoc: WebGLUniformLocation | null = null;
let uResolutionLoc: WebGLUniformLocation | null = null;

// State
let width = 1920;
let height = 1080;
let intensity = 1.0;
let startTime = -1.0;
let fadeCurrent = 1.0;
let fadeTarget = 1.0;
let rafId = 0;
// Phase 3: track texture dimensions to avoid unnecessary re-allocation
let texWidth = 0;
let texHeight = 0;

function compileShader(type: number, src: string): WebGLShader | null {
  if (!gl) return null;
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('CRT shader compile error:', gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function initGL(canvas: OffscreenCanvas) {
  gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) {
    console.error('CRT worker: WebGL not available on OffscreenCanvas');
    return;
  }
  console.log('CRT worker: WebGL context created', canvas.width, 'x', canvas.height);

  const vs = compileShader(gl.VERTEX_SHADER, VERT_SRC);
  const fs = compileShader(gl.FRAGMENT_SHADER, FRAG_SRC);
  if (!vs || !fs) return;

  program = gl.createProgram();
  if (!program) return;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, 'aPosition');
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('CRT shader link error:', gl.getProgramInfoLog(program));
    return;
  }

  gl.useProgram(program);

  // Cache uniform locations
  uTimeLoc = gl.getUniformLocation(program, 'uTime');
  uStartTimeLoc = gl.getUniformLocation(program, 'uStartTime');
  uIntensityLoc = gl.getUniformLocation(program, 'uIntensity');
  uFadeLoc = gl.getUniformLocation(program, 'uFade');
  uResolutionLoc = gl.getUniformLocation(program, 'uResolution');

  // Fullscreen quad: two triangles covering [-1, 1]
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,  1, -1,  -1, 1,
    -1,  1,  1, -1,   1, 1,
  ]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // Create texture
  texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Initialize with 1x1 gray pixel (desktop fallback)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array([168, 168, 168, 255]));

  gl.clearColor(168 / 255, 168 / 255, 168 / 255, 1);
}

function render() {
  if (!gl || !program) {
    rafId = requestAnimationFrame(render);
    return;
  }

  gl.viewport(0, 0, width, height);

  const now = performance.now() / 1000;

  // Initialize start time on first render
  if (startTime < 0) {
    startTime = now;
  }

  // Smooth fade interpolation
  const fadeGap = Math.abs(fadeTarget - fadeCurrent);
  const fadeSpeed = fadeGap > 0.5 ? 0.06 : 0.02;
  fadeCurrent += (fadeTarget - fadeCurrent) * fadeSpeed;

  // Set uniforms
  gl.uniform1f(uTimeLoc, now);
  gl.uniform1f(uStartTimeLoc, startTime);
  gl.uniform1f(uIntensityLoc, intensity);
  gl.uniform1f(uFadeLoc, fadeCurrent);
  gl.uniform2f(uResolutionLoc, width, height);

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  rafId = requestAnimationFrame(render);
}

function updateTexture(bitmap: ImageBitmap) {
  if (!gl || !texture) return;

  try {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // Phase 3: if bitmap matches existing texture size, use texSubImage2D
    // to update in-place (avoids GPU memory re-allocation)
    if (bitmap.width === texWidth && bitmap.height === texHeight) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      texWidth = bitmap.width;
      texHeight = bitmap.height;
    }
    bitmap.close();
  } catch (e) {
    console.error('CRT worker: texture upload failed:', e);
  }
}

function dispose() {
  cancelAnimationFrame(rafId);
  if (gl) {
    if (texture) gl.deleteTexture(texture);
    if (program) gl.deleteProgram(program);
    gl = null;
    program = null;
    texture = null;
  }
}

// ---- Message handler ----

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;

  switch (msg.type) {
    case 'init': {
      const canvas = msg.canvas as OffscreenCanvas;
      width = msg.width;
      height = msg.height;
      canvas.width = width;
      canvas.height = height;
      // If startTime was pre-set (e.g. poweron phase), use it
      if (typeof msg.startTimeOffset === 'number') {
        startTime = performance.now() / 1000 + msg.startTimeOffset;
      }
      initGL(canvas);
      render();
      break;
    }

    case 'frame': {
      updateTexture(msg.bitmap as ImageBitmap);
      break;
    }

    case 'resize': {
      width = msg.width;
      height = msg.height;
      if (gl) {
        const canvas = gl.canvas as OffscreenCanvas;
        canvas.width = width;
        canvas.height = height;
      }
      break;
    }

    case 'uniforms': {
      if (typeof msg.intensity === 'number') intensity = msg.intensity;
      if (typeof msg.fade === 'number') fadeTarget = msg.fade;
      if (typeof msg.resetStartTime === 'boolean' && msg.resetStartTime) {
        startTime = performance.now() / 1000;
      }
      if (typeof msg.startTimeOffset === 'number') {
        startTime = performance.now() / 1000 + msg.startTimeOffset;
      }
      break;
    }

    case 'dispose': {
      dispose();
      break;
    }
  }
};
