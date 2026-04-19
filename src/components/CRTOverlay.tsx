import { useRef, useEffect, useState, useCallback, type ReactNode } from 'react';
import * as THREE from 'three';
import { useShellOS } from '../contexts/ShellOSContext';
import type { Phase } from '../types';

interface CRTOverlayProps {
  children: ReactNode;
  phase: Phase;
  hasAnimatedContent: boolean;
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

    // --- Defocus bloom (4-tap cross for performance) ---
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

export default function CRTOverlay({ children, phase, hasAnimatedContent }: CRTOverlayProps) {
  const { settings } = useShellOS();
  const [webglOk] = useState(hasWebGL);
  const enabled = settings.crtEnabled && webglOk;

  // Use refs so changes don't restart the capture/render effect
  const hasAnimatedContentRef = useRef(hasAnimatedContent);
  useEffect(() => {
    hasAnimatedContentRef.current = hasAnimatedContent;
  }, [hasAnimatedContent]);

  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const domRef = useRef<HTMLDivElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const transitionRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);

  // Fade: 1.0 = fully visible, 0.0 = black. Smoothly interpolates.
  const fadeTargetRef = useRef(1.0);
  const fadeCurrentRef = useRef(1.0);
  const prevPhaseRef = useRef(phase);

  // Detect phase transitions that should replay the CRT power-on jolt
  const startTimeResetRef = useRef(false);

  useEffect(() => {
    const prev = prevPhaseRef.current;
    const curr = phase;

    if (prev === 'poweron' && curr === 'booting') {
      // PowerOn→Booting: CRT turns on with jolt
      startTimeResetRef.current = true;
    } else if (prev === 'booting' && curr === 'desktop') {
      // Boot→Desktop: show black overlay above WebGL canvas,
      // wait for desktop to render + snapdom to capture, then fade in.
      if (transitionRef.current) {
        const el = transitionRef.current;
        el.style.opacity = '1';
        el.style.display = 'block';
        el.style.transition = 'none';
        // After desktop content is captured, fade out the overlay
        setTimeout(() => {
          el.style.transition = 'opacity 0.5s ease-out';
          el.style.opacity = '0';
          setTimeout(() => { el.style.display = 'none'; }, 500);
        }, 400);
      }
    } else if (prev === 'screensaver' && curr === 'desktop') {
      // Screensaver exit: jolt (screen wakes up)
      startTimeResetRef.current = true;
    } else if (prev === 'desktop' && curr === 'screensaver') {
      // Screensaver enter: jolt
      startTimeResetRef.current = true;
    }

    prevPhaseRef.current = phase;
  }, [phase]);

  // Custom cursor: track mouse and position the cursor div
  const lastActivityRef = useRef(0);
  const lastMousePosRef = useRef<{ x: number; y: number } | null>(null);

  // Initialize activity timestamp after mount
  useEffect(() => {
    lastActivityRef.current = performance.now();
  }, []);

  // Show cursor at last known position when phase transitions to desktop
  useEffect(() => {
    const p = phase;
    if ((p === 'desktop' || p === 'screensaver' || p === 'shutdown') && cursorRef.current && lastMousePosRef.current) {
      cursorRef.current.style.transform = `translate(${lastMousePosRef.current.x}px, ${lastMousePosRef.current.y}px)`;
      cursorRef.current.style.display = 'block';
    }
  }, [phase]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    lastActivityRef.current = performance.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    lastMousePosRef.current = { x, y };
    if (cursorRef.current) {
      // Only show custom cursor on desktop/screensaver phases
      const p = phaseRef.current;
      if (p !== 'desktop' && p !== 'screensaver' && p !== 'shutdown') {
        cursorRef.current.style.display = 'none';
        return;
      }
      cursorRef.current.style.transform = `translate(${x}px, ${y}px)`;
      cursorRef.current.style.display = 'block';
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (cursorRef.current) {
      cursorRef.current.style.display = 'none';
    }
  }, []);

  // Track keyboard activity too
  useEffect(() => {
    if (!enabled) return;
    const handler = () => { lastActivityRef.current = performance.now(); };
    document.addEventListener('keydown', handler);
    document.addEventListener('click', handler);
    document.addEventListener('scroll', handler, true);
    return () => {
      document.removeEventListener('keydown', handler);
      document.removeEventListener('click', handler);
      document.removeEventListener('scroll', handler, true);
    };
  }, [enabled]);

  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const rafRef = useRef<number>(0);
  const snapdomRef = useRef<typeof import('@zumer/snapdom').snapdom | null>(null);

  const [reducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  const intensity = reducedMotion ? settings.crtIntensity * 0.3 : settings.crtIntensity;
  const intensityRef = useRef(intensity);
  useEffect(() => {
    intensityRef.current = intensity;
  }, [intensity]);

  // Initialize Three.js scene
  const initGL = useCallback(() => {
    const canvas = glCanvasRef.current;
    if (!canvas) return;

    // Dispose old renderer if re-initializing
    if (rendererRef.current) {
      rendererRef.current.dispose();
      rendererRef.current = null;
    }

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
        uIntensity: { value: intensityRef.current },
        uFade: { value: 1.0 },
        uResolution: { value: new THREE.Vector2(1920, 1080) },
      },
    });
    materialRef.current = material;

    const geometry = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
  }, []);

  // Decoupled capture + render loops for performance:
  // - Capture: runs snapdom at ~10fps (throttled), only when DOM has likely changed
  // - Render: runs WebGL shader at 60fps using the latest captured texture
  //   (keeps flicker/scanline animations smooth without re-capturing every frame)
  useEffect(() => {
    if (!enabled) return;

    let running = true;
    let capturing = false;
    let lastCaptureTime = 0;
    const captureReady = true;
    let cachedW = 0;
    let cachedH = 0;

    // Cache dimensions via ResizeObserver — no layout thrashing
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        cachedW = entry.contentRect.width;
        cachedH = entry.contentRect.height;
      }
    });
    if (domRef.current) {
      const dom = domRef.current;
      cachedW = dom.offsetWidth;
      cachedH = dom.offsetHeight;
      resizeObserver.observe(dom);
    }

    // Variable refresh: animation-aware scheduling
    // Priority: boot/screensaver > user input > animated windows > static windows > idle
    function getCaptureInterval() {
      if (phaseRef.current === 'booting') return 16;              // ~60fps — boot animation
      if (phaseRef.current === 'screensaver') return 33;          // ~30fps — screensaver animation
      const idleMs = performance.now() - lastActivityRef.current;
      if (idleMs < 200) return 16;                     // ~60fps — actively interacting
      if (idleMs < 1000) return 33;                    // ~30fps — recently active
      if (hasAnimatedContentRef.current) return 50;   // ~20fps — snake/terminal animating
      if (idleMs < 5000) return 200;                   // ~5fps — static windows, idle
      return 500;                                       // ~2fps — empty desktop, minimal CPU
    }

    async function loadSnapdom() {
      if (!snapdomRef.current) {
        const mod = await import('@zumer/snapdom');
        snapdomRef.current = mod.snapdom;
        // Pre-cache fonts so first capture doesn't stall
        if (domRef.current && mod.preCache) {
          await mod.preCache(domRef.current, { embedFonts: true });
        }
      }
    }

    // Capture loop — throttled, async
    async function capture() {
      if (!running || capturing || !captureReady || !domRef.current || !snapdomRef.current) return;
      const now = performance.now();
      if (now - lastCaptureTime < getCaptureInterval()) return;

      capturing = true;
      lastCaptureTime = now;

      try {
        const capturedCanvas = await snapdomRef.current.toCanvas(domRef.current, {
          scale: 1,
          embedFonts: true,
          fast: true,
          cache: 'auto',
        });

        // Reuse existing texture — just update the image source.
        // Avoids GPU alloc/dealloc churn that causes compounding delay.
        const tex = textureRef.current;
        if (tex) {
          tex.image = capturedCanvas;
          tex.needsUpdate = true;
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
        // Use cached dimensions — updated by ResizeObserver, not layout-thrashing reads
        const w = cachedW;
        const h = cachedH;

        const canvas = renderer.domElement;
        if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
          renderer.setSize(w, h, false);
          canvas.style.width = w + 'px';
          canvas.style.height = h + 'px';
        }

        const now = performance.now() / 1000;
        material.uniforms.uTime.value = now;
        // Set start time on first frame, or reset for power-on jolt replay.
        // During poweron phase, set start time far in the past so the jolt
        // animation is already "complete" and content renders normally.
        if (startTimeResetRef.current) {
          material.uniforms.uStartTime.value = now;
          startTimeResetRef.current = false;
        } else if (material.uniforms.uStartTime.value < 0) {
          material.uniforms.uStartTime.value = phaseRef.current === 'poweron' ? now - 10.0 : now;
        }
        material.uniforms.uIntensity.value = intensityRef.current;
        material.uniforms.uResolution.value.set(w, h);

        // Smooth fade interpolation (~60fps lerp)
        // Faster when fading in from black, slower for subtle adjustments
        const fadeGap = Math.abs(fadeTargetRef.current - fadeCurrentRef.current);
        const fadeSpeed = fadeGap > 0.5 ? 0.06 : 0.02;
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
      resizeObserver.disconnect();
    };
  }, [enabled, initGL]);

  // Cleanup renderer when disabled or unmounted
  useEffect(() => {
    if (!enabled) {
      rendererRef.current?.dispose();
      rendererRef.current = null;
      materialRef.current?.dispose();
      materialRef.current = null;
      textureRef.current?.dispose();
      textureRef.current = null;
    }
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
      materialRef.current?.dispose();
      materialRef.current = null;
      textureRef.current?.dispose();
      textureRef.current = null;
    };
  }, [enabled]);

  if (!enabled) {
    return (
      <div className="crt-wrapper">
        {children}
      </div>
    );
  }

  const showCustomCursor = phase === 'desktop' || phase === 'screensaver' || phase === 'shutdown';

  return (
    <div
      className={`crt-wrapper${showCustomCursor ? ' crt-cursor-hidden' : ''}`}
      style={{ position: 'relative' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* DOM layer — interactive underneath */}
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
        {/* Custom cursor — lives in the DOM so snapdom captures it,
            barrel distortion warps it with everything else */}
        <div ref={cursorRef} className="crt-custom-cursor" style={{ display: 'none' }} />
      </div>

      {/* WebGL layer — barrel distorted capture */}
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

      {/* Transition overlay — above WebGL for fade-to/from-black */}
      <div
        ref={transitionRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'black',
          zIndex: 3,
          pointerEvents: 'none',
          display: 'none',
        }}
      />
    </div>
  );
}
