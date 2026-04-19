import { useRef, useEffect, useState, useCallback, type ReactNode } from 'react';
import * as THREE from 'three';
import { useShellOS } from '../contexts/ShellOSContext';

interface CRTOverlayProps {
  children: ReactNode;
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
  uniform float uIntensity;
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

    // --- Barrel distortion ---
    float barrelK = 0.2 * i;
    vec2 uv = barrelDistort(vUv, barrelK);

    // Clamp to edges — stretches edge pixels into corners
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

    // --- Brightness boost (compensate for capture quality loss) ---
    color.rgb *= 1.0 + 0.1 * i;

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

export default function CRTOverlay({ children }: CRTOverlayProps) {
  const { settings } = useShellOS();
  const [webglOk] = useState(hasWebGL);
  const enabled = settings.crtEnabled && webglOk;

  const domRef = useRef<HTMLDivElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
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
    renderer.setPixelRatio(1); // We control resolution via capture
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    cameraRef.current = camera;

    const texture = new THREE.Texture();
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    textureRef.current = texture;

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTexture: { value: texture },
        uTime: { value: 0 },
        uIntensity: { value: intensity },
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
    const CAPTURE_INTERVAL = 50; // ~20fps capture — good balance
    let lastCaptureTime = 0;

    async function loadSnapdom() {
      if (!snapdomRef.current) {
        const mod = await import('@zumer/snapdom');
        snapdomRef.current = mod.snapdom;
      }
    }

    // Capture loop — throttled, async
    async function capture() {
      if (!running || capturing || !domRef.current || !snapdomRef.current) return;
      const now = performance.now();
      if (now - lastCaptureTime < CAPTURE_INTERVAL) return;

      capturing = true;
      lastCaptureTime = now;

      try {
        const capturedCanvas = await snapdomRef.current.toCanvas(domRef.current, {
          scale: 1,
          embedFonts: false,
          fast: true,
          cache: 'full',
        });

        const texture = textureRef.current;
        if (texture) {
          texture.image = capturedCanvas;
          texture.needsUpdate = true;
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
        material.uniforms.uTime.value = performance.now() / 1000;
        material.uniforms.uIntensity.value = intensity;
        material.uniforms.uResolution.value.set(w, h);
        renderer.setSize(w, h, false);
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
  }, [enabled, intensity, initGL]);

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

      {/* WebGL layer — opaque, covers DOM, pointer-events:none so clicks pass through */}
      <canvas
        ref={glCanvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: 2,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
