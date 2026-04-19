import { useRef, useEffect, useState, useCallback, type ReactNode } from 'react';
import * as THREE from 'three';
import { useShellOS } from '../contexts/ShellOSContext';
import type { Phase } from '../types';

interface CRTOverlayProps {
  children: ReactNode;
  phase: Phase;
}

/**
 * CRT overlay using SnapDOM capture → WebGL barrel distortion.
 *
 * Architecture:
 * 1. DOM children render normally in a container (visible when CRT off, hidden when on)
 * 2. SnapDOM captures the DOM to a canvas continuously
 * 3. A WebGL canvas renders the capture through a CRT shader with:
 *    - Barrel distortion (bilinear texture sampling = perfectly smooth)
 *    - Scanlines, bloom, vignette, chromatic aberration, flicker
 * 4. The DOM stays underneath (invisible but interactive) for click/keyboard handling
 */

// Vertex shader — fullscreen quad
const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

// Fragment shader — barrel distortion + CRT effects
const fragmentShader = `
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
    vec2 distorted = uv + cc * r2 * k;
    return distorted;
  }

  void main() {
    float i = uIntensity;
    float elapsed = uTime - uStartTime;

    // --- CRT power-on: electric jolt (0.3s total) ---
    // Phase 1 (0-0.05s): bright dot flash
    // Phase 2 (0.05-0.15s): horizontal snap to full width
    // Phase 3 (0.15-0.3s): vertical snap to full height
    // Then brightness settles over 0.3s

    float t = clamp(elapsed / 0.6, 0.0, 1.0);

    // Horizontal: instant snap
    float sx = elapsed < 0.05 ? 0.01 :
               elapsed < 0.15 ? mix(0.01, 1.0, pow((elapsed - 0.05) / 0.1, 0.3)) :
               1.0;
    sx = clamp(sx, 0.001, 1.0);

    // Vertical: snaps open right after horizontal
    float sy = elapsed < 0.12 ? 0.003 :
               elapsed < 0.3  ? mix(0.003, 1.0, pow((elapsed - 0.12) / 0.18, 0.4)) :
               1.0;
    sy = clamp(sy, 0.001, 1.0);

    // Brightness: intense flash then quick settle
    float flash = elapsed < 0.05 ? 20.0 :
                  elapsed < 0.15 ? mix(20.0, 4.0, (elapsed - 0.05) / 0.1) :
                  elapsed < 0.3  ? mix(4.0, 1.3, (elapsed - 0.15) / 0.15) :
                  mix(1.3, 1.0, clamp((elapsed - 0.3) / 0.3, 0.0, 1.0));

    // Blue-white tint during jolt
    vec3 tint = elapsed < 0.15 ? mix(vec3(0.6, 0.7, 1.0), vec3(1.0), elapsed / 0.15) : vec3(1.0);

    // Static burst during jolt
    float noise = 0.0;
    if (elapsed < 0.3) {
      float n = fract(sin(dot(vUv * elapsed * 200.0, vec2(12.9898, 78.233))) * 43758.5453);
      noise = n * 0.2 * (1.0 - t);
    }

    // Apply scaling from center
    vec2 powerUv = vUv;
    powerUv.x = 0.5 + (powerUv.x - 0.5) / sx;
    powerUv.y = 0.5 + (powerUv.y - 0.5) / sy;

    // Outside the expanding area: black with faint glow
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

    // Clamp to edges
    uv = clamp(uv, 0.0, 1.0);

    vec2 texel = 1.0 / uResolution;

    // --- Base color with bilinear sampling (smooth!) ---
    vec4 color = texture2D(uTexture, uv);

    // --- Defocus bloom ---
    float bloomR = 1.5 * i;
    vec4 bloom = vec4(0.0);
    bloom += texture2D(uTexture, uv + vec2(-texel.x, -texel.y) * bloomR);
    bloom += texture2D(uTexture, uv + vec2( 0.0,     -texel.y) * bloomR);
    bloom += texture2D(uTexture, uv + vec2( texel.x, -texel.y) * bloomR);
    bloom += texture2D(uTexture, uv + vec2(-texel.x,  0.0)     * bloomR);
    bloom += texture2D(uTexture, uv + vec2( texel.x,  0.0)     * bloomR);
    bloom += texture2D(uTexture, uv + vec2(-texel.x,  texel.y) * bloomR);
    bloom += texture2D(uTexture, uv + vec2( 0.0,      texel.y) * bloomR);
    bloom += texture2D(uTexture, uv + vec2( texel.x,  texel.y) * bloomR);
    bloom /= 8.0;
    color = mix(color, bloom, 0.15 * i);

    // --- Chromatic aberration ---
    vec2 center = uv - 0.5;
    float dist = length(center);
    float aberr = dist * dist * 0.6 * i * texel.x * 80.0;
    color.r = mix(color.r, texture2D(uTexture, uv + vec2(aberr * texel.x, 0.0)).r, 0.4);
    color.b = mix(color.b, texture2D(uTexture, uv - vec2(aberr * texel.x, 0.0)).b, 0.4);

    // --- Scanlines (very subtle — avoid moiré with captured content) ---
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

    // --- Global fade (used for boot→desktop transition) ---
    color.rgb *= uFade;

    gl_FragColor = color;
  }
`;

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export default function CRTOverlay({ children, phase }: CRTOverlayProps) {
  const { settings } = useShellOS();
  const [webglOk] = useState(hasWebGL);
  const enabled = settings.crtEnabled && webglOk;

  const domRef = useRef<HTMLDivElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);

  // Fade: 1.0 = fully visible, 0.0 = black. Smoothly interpolates.
  const fadeTargetRef = useRef(1.0);
  const fadeCurrentRef = useRef(1.0);
  const prevPhaseRef = useRef(phase);

  // Detect boot→desktop transition: smooth dim and recover
  useEffect(() => {
    if (prevPhaseRef.current === 'booting' && phase === 'desktop') {
      // Dim to 40% then smoothly fade back — the lerp in render loop handles the smoothing
      fadeCurrentRef.current = 0.4;
      fadeTargetRef.current = 1.0;
    }
    prevPhaseRef.current = phase;
  }, [phase]);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const rafRef = useRef<number>(0);
  const snapdomRef = useRef<typeof import('@zumer/snapdom').snapdom | null>(null);

  const [reducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  const intensity = reducedMotion ? settings.crtIntensity * 0.3 : settings.crtIntensity;

  // Initialize Three.js scene
  const initGL = useCallback(() => {
    const canvas = glCanvasRef.current;
    if (!canvas || rendererRef.current) return;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: false });
    renderer.setPixelRatio(1);
    renderer.autoClear = true;
    renderer.setClearColor(0xa8a8a8, 1); // desktop gray fallback during resize
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    cameraRef.current = camera;

    const texture = new THREE.Texture();
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    textureRef.current = texture;

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTexture: { value: texture },
        uTime: { value: 0 },
        uStartTime: { value: -1 },
        uIntensity: { value: intensity },
        uFade: { value: 1.0 },
        uResolution: { value: new THREE.Vector2(1920, 1080) },
      },
    });
    materialRef.current = material;

    const geometry = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
  }, [intensity]);

  // Decoupled capture + render loops for performance:
  // - Capture: runs snapdom at ~10fps (throttled), only when DOM has likely changed
  // - Render: runs WebGL shader at 60fps using the latest captured texture
  //   (keeps flicker/scanline animations smooth without re-capturing every frame)
  useEffect(() => {
    if (!enabled) return;

    let running = true;
    let capturing = false;
    const captureInterval = phase === 'booting' ? 32 : 50;
    let lastCaptureTime = 0;
    let captureReady = true;

    async function loadSnapdom() {
      if (!snapdomRef.current) {
        const mod = await import('@zumer/snapdom');
        snapdomRef.current = mod.snapdom;
      }
    }

    // Capture loop — throttled, async
    async function capture() {
      if (!running || capturing || !captureReady || !domRef.current || !snapdomRef.current) return;
      const now = performance.now();
      if (now - lastCaptureTime < captureInterval) return;

      capturing = true;
      lastCaptureTime = now;

      try {
        const capturedCanvas = await snapdomRef.current.toCanvas(domRef.current, {
          scale: 1,
          embedFonts: false,
          fast: true,
          cache: 'full',
        });

        // Create a fresh texture from the capture each time — avoids stale size issues
        const material = materialRef.current;
        if (material) {
          const oldTex = textureRef.current;
          if (oldTex) oldTex.dispose();

          const newTex = new THREE.CanvasTexture(capturedCanvas);
          newTex.minFilter = THREE.LinearFilter;
          newTex.magFilter = THREE.LinearFilter;
          newTex.generateMipmaps = false;
          newTex.wrapS = THREE.ClampToEdgeWrapping;
          newTex.wrapT = THREE.ClampToEdgeWrapping;
          textureRef.current = newTex;
          material.uniforms.uTexture.value = newTex;
        }
      } catch {
        // Skip failed capture
      }

      capturing = false;
    }

    // Render loop — 60fps, only updates shader uniforms + renders
    function render() {
      if (!running) return;

      const renderer = rendererRef.current;
      const material = materialRef.current;
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      const dom = domRef.current;

      if (renderer && material && scene && camera && dom) {
        const w = dom.offsetWidth;
        const h = dom.offsetHeight;

        // Update canvas size to match DOM — critical on window resize
        const canvas = renderer.domElement;
        if (canvas.width !== w || canvas.height !== h) {
          renderer.setSize(w, h, false);
          canvas.style.width = w + 'px';
          canvas.style.height = h + 'px';
        }

        const now = performance.now() / 1000;
        material.uniforms.uTime.value = now;
        // Set start time on first frame
        if (material.uniforms.uStartTime.value < 0) {
          material.uniforms.uStartTime.value = now;
        }
        material.uniforms.uIntensity.value = intensity;
        material.uniforms.uResolution.value.set(w, h);

        // Smooth fade interpolation (~60fps lerp)
        const fadeSpeed = 0.02; // slow smooth recovery
        fadeCurrentRef.current += (fadeTargetRef.current - fadeCurrentRef.current) * fadeSpeed;
        material.uniforms.uFade.value = fadeCurrentRef.current;

        renderer.render(scene, camera);
      }

      // Trigger capture check (non-blocking)
      capture();

      rafRef.current = requestAnimationFrame(render);
    }

    loadSnapdom().then(() => {
      initGL();
      render();
    });

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [enabled, intensity, phase, initGL]);

  // Cleanup renderer on unmount
  useEffect(() => {
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
      materialRef.current?.dispose();
      textureRef.current?.dispose();
    };
  }, []);

  if (!enabled) {
    return (
      <div className="crt-wrapper">
        <div className="crt-screen-glow">{children}</div>
      </div>
    );
  }

  return (
    <div className="crt-wrapper" style={{ position: 'relative' }}>
      {/* DOM layer — underneath the canvas. Users click through the canvas
           (pointer-events:none) to interact with the DOM. The canvas fully
           occludes it visually (alpha:false = opaque WebGL context). */}
      <div
        ref={domRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          zIndex: 1,
        }}
      >
        {children}
      </div>

      {/* WebGL layer — fades in over 600ms to seamlessly take over from DOM */}
      <canvas
        ref={glCanvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          zIndex: 2,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
