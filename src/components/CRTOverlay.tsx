import { useRef, useEffect, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { EffectComposer } from '@react-three/postprocessing';
import { Effect, BlendFunction } from 'postprocessing';
import * as THREE from 'three';
import { useShellOS } from '../contexts/ShellOSContext';
import CRTScreen from './CRTScreen';

/*
  Full CRT shader — applied globally. Tuned for readability:
  - Defocus bloom: samples 8 neighbors → warm soft-focus CRT look
  - Scanlines: gentle brightness modulation (not dark bands)
  - Vignette: edge darkening (matches CSS inset shadow for doubled effect)
  - Chromatic aberration: tiny, edges only
  - Flicker: barely perceptible brightness oscillation
  - Screen bulge handled by CSS perspective transform on DOM
*/
const crtShader = `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec2 uResolution;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    float i = uIntensity;
    vec2 texel = 1.0 / uResolution;

    // --- Defocus / phosphor bloom ---
    float bloomRadius = 1.5 * i;
    vec4 bloom = vec4(0.0);
    bloom += texture2D(inputBuffer, uv + vec2(-texel.x, -texel.y) * bloomRadius);
    bloom += texture2D(inputBuffer, uv + vec2( 0.0,     -texel.y) * bloomRadius);
    bloom += texture2D(inputBuffer, uv + vec2( texel.x, -texel.y) * bloomRadius);
    bloom += texture2D(inputBuffer, uv + vec2(-texel.x,  0.0)     * bloomRadius);
    bloom += texture2D(inputBuffer, uv + vec2( texel.x,  0.0)     * bloomRadius);
    bloom += texture2D(inputBuffer, uv + vec2(-texel.x,  texel.y) * bloomRadius);
    bloom += texture2D(inputBuffer, uv + vec2( 0.0,      texel.y) * bloomRadius);
    bloom += texture2D(inputBuffer, uv + vec2( texel.x,  texel.y) * bloomRadius);
    bloom /= 8.0;

    float bloomMix = 0.15 * i;
    vec4 color = mix(inputColor, bloom, bloomMix);

    // --- Chromatic aberration (edges only) ---
    vec2 center = uv - 0.5;
    float dist = length(center);
    float aberr = dist * dist * 0.8 * i * texel.x * 100.0;
    color.r = mix(color.r, texture2D(inputBuffer, uv + vec2(aberr * texel.x, 0.0)).r, 0.5);
    color.b = mix(color.b, texture2D(inputBuffer, uv - vec2(aberr * texel.x, 0.0)).b, 0.5);

    // --- Scanlines (gentle brightness modulation) ---
    float scanline = sin(uv.y * uResolution.y * 3.14159265) * 0.5 + 0.5;
    scanline = 1.0 - pow(1.0 - scanline, 3.0) * 0.12 * i;
    color.rgb *= scanline;

    // --- Vignette ---
    vec2 vigUV = uv * 2.0 - 1.0;
    float vignette = 1.0 - dot(vigUV * 0.5, vigUV * 0.5);
    vignette = pow(clamp(vignette, 0.0, 1.0), 0.35);
    vignette = mix(1.0, vignette, 0.6 * i);
    color.rgb *= vignette;

    // --- Flicker ---
    float flicker = 1.0 - (sin(uTime * 8.3) * 0.003 + sin(uTime * 12.7) * 0.002) * i;
    color.rgb *= flicker;

    // --- Brightness boost to compensate ---
    color.rgb *= 1.0 + 0.05 * i;

    outputColor = color;
  }
`;

class CRTEffect extends Effect {
  uniforms: Map<string, THREE.Uniform>;

  constructor() {
    const uniforms = new Map<string, THREE.Uniform>([
      ['uTime', new THREE.Uniform(0)],
      ['uIntensity', new THREE.Uniform(0.5)],
      ['uResolution', new THREE.Uniform(new THREE.Vector2(1920, 1080))],
    ]);

    super('CRTEffect', crtShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms,
    });

    this.uniforms = uniforms;
  }
}

function CRTPass({ intensity }: { intensity: number }) {
  const effectRef = useRef<CRTEffect>(null!);
  const { size } = useThree();

  useEffect(() => {
    if (!effectRef.current) {
      effectRef.current = new CRTEffect();
    }
  }, []);

  useEffect(() => {
    if (effectRef.current) {
      effectRef.current.uniforms.get('uIntensity')!.value = intensity;
      effectRef.current.uniforms.get('uResolution')!.value.set(size.width, size.height);
    }
  }, [intensity, size]);

  useFrame(({ clock }) => {
    if (effectRef.current) {
      effectRef.current.uniforms.get('uTime')!.value = clock.getElapsedTime();
    }
  });

  if (!effectRef.current) {
    effectRef.current = new CRTEffect();
  }

  return (
    <EffectComposer>
      <primitive object={effectRef.current} />
    </EffectComposer>
  );
}

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

interface CRTOverlayProps {
  children: ReactNode;
}

export default function CRTOverlay({ children }: CRTOverlayProps) {
  const { settings } = useShellOS();
  const [webglSupported] = useState(hasWebGL);
  const showWebGL = settings.crtEnabled && webglSupported;

  const [reducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  const effectiveIntensity = reducedMotion ? settings.crtIntensity * 0.3 : settings.crtIntensity;

  return (
    <div className="crt-wrapper">
      <CRTScreen>
        {children}
      </CRTScreen>

      {showWebGL && (
        <Canvas
          className="crt-canvas-overlay"
          gl={{ alpha: true, antialias: false }}
          style={{ position: 'fixed', top: 0, left: 0, pointerEvents: 'none', zIndex: 9999 }}
        >
          <CRTPass intensity={effectiveIntensity} />
        </Canvas>
      )}
    </div>
  );
}
