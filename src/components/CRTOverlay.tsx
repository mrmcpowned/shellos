import { useRef, useEffect, useState, useCallback, type ReactNode } from 'react';
import { useShellOS } from '../hooks/useShellOS';
import type { Phase } from '../types';
import CRTWorker from '../workers/crtRenderer.worker?worker';

interface CRTOverlayProps {
  children: ReactNode;
  phase: Phase;
  hasAnimatedContent: boolean;
}

/**
 * CRT overlay using SnapDOM capture → Worker-owned WebGL barrel distortion.
 *
 * Architecture:
 * 1. DOM children render normally in a container (visible when CRT off, hidden when on)
 * 2. SnapDOM captures the DOM to SVG → Blob on the main thread (DOM access required)
 * 3. Blob is transferred to a Web Worker that owns the WebGL canvas
 * 4. Worker rasterizes blob → ImageBitmap → GPU texture, runs CRT shader at 60fps
 * 5. Main thread: zero rendering cost. Only DOM interaction + snapdom serialization.
 */

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function supportsOffscreen(): boolean {
  try {
    return typeof OffscreenCanvas !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function';
  } catch {
    return false;
  }
}

export default function CRTOverlay({ children, phase, hasAnimatedContent }: CRTOverlayProps) {
  const { settings } = useShellOS();
  const [webglOk] = useState(hasWebGL);
  const [offscreenOk] = useState(supportsOffscreen);
  const enabled = settings.crtEnabled && webglOk && offscreenOk;

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
  const workerRef = useRef<Worker | null>(null);
  // Key to force a fresh canvas element when transferControlToOffscreen fails (e.g. Strict Mode)
  const [canvasKey, setCanvasKey] = useState(0);

  const prevPhaseRef = useRef(phase);

  // Detect phase transitions that should replay the CRT power-on jolt
  const startTimeResetRef = useRef(false);

  // Boot→Desktop transition: state-driven black overlay
  const [bootTransition, setBootTransition] = useState<'idle' | 'black' | 'fading'>('idle');

  useEffect(() => {
    const prev = prevPhaseRef.current;
    const curr = phase;

    if (prev === 'poweron' && curr === 'booting') {
      // PowerOn→Booting: CRT turns on with jolt
      startTimeResetRef.current = true;
      workerRef.current?.postMessage({ type: 'uniforms', resetStartTime: true });
    } else if (prev === 'booting' && curr === 'desktop') {
      // Boot→Desktop: show black, wait for content capture, then fade out
      setBootTransition('black');
      setTimeout(() => setBootTransition('fading'), 400);
      setTimeout(() => setBootTransition('idle'), 900);
    } else if (prev === 'screensaver' && curr === 'desktop') {
      // Screensaver exit: jolt (screen wakes up)
      startTimeResetRef.current = true;
      workerRef.current?.postMessage({ type: 'uniforms', resetStartTime: true });
    } else if (prev === 'desktop' && curr === 'screensaver') {
      // Screensaver enter: jolt
      startTimeResetRef.current = true;
      workerRef.current?.postMessage({ type: 'uniforms', resetStartTime: true });
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

  // Detect cursor type by walking up the DOM tree, checking semantic cues
  const detectCursor = useCallback((el: Element | null): string => {
    let node: Element | null = el;
    while (node && node !== document.documentElement) {
      // Check inline style cursor
      const inlineCursor = (node as HTMLElement).style?.cursor;
      if (inlineCursor && inlineCursor !== 'none') {
        if (inlineCursor === 'text') return 'text';
        if (inlineCursor === 'pointer') return 'pointer';
        if (inlineCursor === 'grab' || inlineCursor === 'grabbing') return 'grab';
        if (inlineCursor === 'not-allowed') return 'not-allowed';
        if (inlineCursor.includes('resize')) return inlineCursor;
        if (inlineCursor === 'move') return 'grab';
      }
      // Check tag name
      const tag = node.tagName;
      if (tag === 'TEXTAREA' || (node as HTMLElement).isContentEditable) return 'text';
      if (tag === 'INPUT') {
        const type = (node as HTMLInputElement).type;
        return (type === 'range' || type === 'checkbox' || type === 'radio' || type === 'button' || type === 'submit') ? 'pointer' : 'text';
      }
      if (tag === 'BUTTON' || tag === 'A' || tag === 'SELECT') return 'pointer';
      // Check ARIA roles
      const role = node.getAttribute('role');
      if (role === 'button' || role === 'switch' || role === 'link' || role === 'tab' || role === 'menuitem') return 'pointer';
      // Check for known clickable CSS classes (cursor:pointer in stylesheet)
      if (node.classList) {
        const cl = node.classList;
        if (cl.contains('menu-item') || cl.contains('menu-dropdown-item') ||
            cl.contains('desktop-icon') || cl.contains('settings-toggle') ||
            cl.contains('settings-color-swatch') || cl.contains('settings-button') ||
            cl.contains('window-close-box') || cl.contains('screensaver')) return 'pointer';
        if (cl.contains('window-title-bar')) return 'grab';
      }
      node = node.parentElement;
    }
    return 'default';
  }, []);

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

      // Find element under mouse — check shadow roots too
      let el = document.elementFromPoint(e.clientX, e.clientY);
      if (el?.shadowRoot) {
        const shadowEl = el.shadowRoot.elementFromPoint(e.clientX, e.clientY);
        if (shadowEl) el = shadowEl;
      }
      cursorRef.current.dataset.cursor = detectCursor(el);
    }
  }, [detectCursor]);

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

  const rafRef = useRef<number>(0);
  const snapdomRef = useRef<typeof import('@zumer/snapdom').snapdom | null>(null);

  const [reducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  const intensity = reducedMotion ? settings.crtIntensity * 0.3 : settings.crtIntensity;
  const intensityRef = useRef(intensity);
  useEffect(() => {
    intensityRef.current = intensity;
    workerRef.current?.postMessage({ type: 'uniforms', intensity });
  }, [intensity]);

  // Decoupled capture loop — main thread only does snapdom serialization.
  // Worker owns the WebGL context and renders the CRT shader at 60fps independently.
  useEffect(() => {
    if (!enabled) return;

    const canvas = glCanvasRef.current;
    if (!canvas) return;

    let running = true;
    let capturing = false;
    let lastCaptureTime = 0;
    let cachedW = 0;
    let cachedH = 0;

    // Create worker
    const worker = new CRTWorker();
    workerRef.current = worker;

    worker.onerror = (e) => {
      console.error('CRT worker error:', e);
    };

    // Transfer canvas to worker (one-time, irreversible per canvas element).
    // If it throws (e.g. React Strict Mode re-run), bump the key to get a fresh canvas.
    let offscreen: OffscreenCanvas;
    try {
      offscreen = canvas.transferControlToOffscreen();
    } catch {
      worker.terminate();
      workerRef.current = null;
      // Canvas was already transferred (React Strict Mode re-run).
      // Schedule a key bump to get a fresh canvas element on next render.
      queueMicrotask(() => setCanvasKey(k => k + 1));
      return;
    }

    // Cache dimensions via ResizeObserver — no layout thrashing
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.round(entry.contentRect.width);
        const h = Math.round(entry.contentRect.height);
        if (w > 0 && h > 0 && (w !== cachedW || h !== cachedH)) {
          cachedW = w;
          cachedH = h;
          worker.postMessage({ type: 'resize', width: w, height: h });
        }
      }
    });
    if (domRef.current) {
      const dom = domRef.current;
      cachedW = dom.offsetWidth;
      cachedH = dom.offsetHeight;
      resizeObserver.observe(dom);
    }

    // Ensure non-zero dimensions (use fallback if layout hasn't happened yet)
    const initW = cachedW || window.innerWidth;
    const initH = cachedH || window.innerHeight;

    // Initialize worker with canvas
    const startTimeOffset = phaseRef.current === 'poweron' ? -10.0 : 0;
    worker.postMessage(
      { type: 'init', canvas: offscreen, width: initW, height: initH, startTimeOffset },
      [offscreen]
    );
    worker.postMessage({ type: 'uniforms', intensity: intensityRef.current, fade: 1.0 });

    // If a jolt was queued before worker was ready, send it now
    if (startTimeResetRef.current) {
      worker.postMessage({ type: 'uniforms', resetStartTime: true });
      startTimeResetRef.current = false;
    }

    // --- Phase 2: Dirty-region tracking ---
    // MutationObserver detects DOM changes; skip captures when nothing changed.
    let domDirty = true; // start dirty to ensure first capture
    const observer = new MutationObserver(() => { domDirty = true; });
    if (domRef.current) {
      observer.observe(domRef.current, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
        attributeFilter: ['style', 'class', 'data-pattern', 'data-crt'],
      });
    }

    // Variable refresh: animation-aware scheduling
    function getCaptureInterval() {
      if (phaseRef.current === 'booting') return 16;
      if (phaseRef.current === 'screensaver') return 33;
      const idleMs = performance.now() - lastActivityRef.current;
      if (idleMs < 200) return 16;
      if (idleMs < 1000) return 33;
      if (hasAnimatedContentRef.current) return 50;
      if (idleMs < 5000) return 200;
      return 500;
    }

    async function loadSnapdom() {
      if (!snapdomRef.current) {
        const mod = await import('@zumer/snapdom');
        snapdomRef.current = mod.snapdom;
        if (domRef.current && mod.preCache) {
          await mod.preCache(domRef.current, { embedFonts: true });
        }
      }
    }

    // Capture loop — rasterizes DOM via snapdom, transfers ImageBitmap to worker
    let captureCount = 0;
    async function capture() {
      if (!running || capturing || !domRef.current || !snapdomRef.current) return;
      const now = performance.now();
      const interval = getCaptureInterval();
      if (now - lastCaptureTime < interval) return;

      // Phase 2: skip capture if DOM hasn't changed and no animated content
      if (!domDirty && !hasAnimatedContentRef.current) return;

      capturing = true;
      lastCaptureTime = now;
      domDirty = false;

      try {
        const capturedCanvas = await snapdomRef.current.toCanvas(domRef.current, {
          scale: 1,
          embedFonts: true,
          fast: true,
          cache: 'auto',
        });

        // Create transferable ImageBitmap (zero-copy to worker)
        const bitmap = await createImageBitmap(capturedCanvas);
        worker.postMessage({ type: 'frame', bitmap }, [bitmap]);
        captureCount++;
        if (captureCount <= 3) {
          console.log('CRT: sent frame', captureCount, capturedCanvas.width, 'x', capturedCanvas.height);
        }
      } catch (e) {
        console.error('CRT capture error:', e);
        // Mark dirty to retry next tick
        domDirty = true;
      }

      capturing = false;
    }

    // Capture scheduling loop — runs on main thread at adaptive rate
    function scheduleCaptureLoop() {
      if (!running) return;
      capture();
      rafRef.current = requestAnimationFrame(scheduleCaptureLoop);
    }

    loadSnapdom().then(() => {
      scheduleCaptureLoop();
    });

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
      observer.disconnect();
      resizeObserver.disconnect();
      worker.postMessage({ type: 'dispose' });
      worker.terminate();
      workerRef.current = null;
    };
  }, [enabled, canvasKey]);

  // Cleanup when disabled or unmounted
  useEffect(() => {
    if (!enabled && workerRef.current) {
      workerRef.current.postMessage({ type: 'dispose' });
      workerRef.current.terminate();
      workerRef.current = null;
    }
    return () => {
      if (workerRef.current) {
        workerRef.current.postMessage({ type: 'dispose' });
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, [enabled]);

  if (!enabled) {
    const isDesktop = phase === 'desktop' || phase === 'screensaver' || phase === 'shutdown';
    return (
      <div className="crt-wrapper" style={isDesktop ? { background: 'var(--color-desktop-bg, #a8a8a8)' } : undefined}>
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
        key={canvasKey}
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

      {/* Transition overlay — above WebGL for fade-to/from-black */}
      {bootTransition !== 'idle' && (
        <div
          className={`crt-boot-transition ${bootTransition}`}
        />
      )}
    </div>
  );
}
