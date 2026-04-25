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
  // Shared flag: set by handleMouseMove, read by compositor effect
  const cursorDirtyRef = useRef(false);
  // Track previous cursor type to detect hover state changes
  const prevCursorTypeRef = useRef('default');
  // Expose window layers to handleMouseMove for hover-dirty marking
  const windowLayersRef = useRef<Map<string, { dirty: boolean }> | null>(null);

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
      // Mark cursor dirty for compositor (position changed)
      cursorDirtyRef.current = true;

      // Find element under mouse — check shadow roots too
      let el = document.elementFromPoint(e.clientX, e.clientY);
      if (el?.shadowRoot) {
        const shadowEl = el.shadowRoot.elementFromPoint(e.clientX, e.clientY);
        if (shadowEl) el = shadowEl;
      }
      const newCursorType = detectCursor(el);
      cursorRef.current.dataset.cursor = newCursorType;

      // When cursor type changes (e.g. entering/leaving close button),
      // mark the window under cursor dirty so its hover effect gets re-captured.
      if (newCursorType !== prevCursorTypeRef.current) {
        prevCursorTypeRef.current = newCursorType;
        if (el && windowLayersRef.current) {
          const winEl = (el as HTMLElement).closest?.('[data-window-id]');
          if (winEl) {
            const id = (winEl as HTMLElement).dataset.windowId;
            if (id) {
              const layer = windowLayersRef.current.get(id);
              if (layer) layer.dirty = true;
            }
          }
        }
      }
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

  // Layer-based compositing capture system.
  // Instead of capturing the entire DOM every frame, we split into layers:
  // - Background layer: desktop bg + menubar + icons (captured once, re-captured on change)
  // - Window layers: one per visible window (captured individually, only when dirty)
  // - Cursor layer: drawn directly onto composite canvas
  // Layers are composited in z-order on a 2D canvas, then transferred to the worker.
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

    let offscreen: OffscreenCanvas;
    try {
      offscreen = canvas.transferControlToOffscreen();
    } catch {
      worker.terminate();
      workerRef.current = null;
      queueMicrotask(() => setCanvasKey(k => k + 1));
      return;
    }

    // Cache dimensions via ResizeObserver
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.round(entry.contentRect.width);
        const h = Math.round(entry.contentRect.height);
        if (w > 0 && h > 0 && (w !== cachedW || h !== cachedH)) {
          cachedW = w;
          cachedH = h;
          compositeCanvas.width = w;
          compositeCanvas.height = h;
          bgDirty = true; // re-capture background at new size
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

    const initW = cachedW || window.innerWidth;
    const initH = cachedH || window.innerHeight;

    // Initialize worker with canvas
    const startTimeOffset = phaseRef.current === 'poweron' ? -10.0 : 0;
    worker.postMessage(
      { type: 'init', canvas: offscreen, width: initW, height: initH, startTimeOffset },
      [offscreen]
    );
    worker.postMessage({ type: 'uniforms', intensity: intensityRef.current, fade: 1.0 });

    if (startTimeResetRef.current) {
      worker.postMessage({ type: 'uniforms', resetStartTime: true });
      startTimeResetRef.current = false;
    }

    // --- Compositing canvas (2D, main thread) ---
    const compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = initW;
    compositeCanvas.height = initH;
    const compositeCtx = compositeCanvas.getContext('2d', { willReadFrequently: false })!;

    // --- Layer cache ---
    // Background: the domRef content with windows hidden
    let bgBitmap: ImageBitmap | null = null;
    let bgDirty = true;

    // Cursor layer: cached bitmap of the cursor element, re-captured on type change
    let cursorBitmap: ImageBitmap | null = null;
    let cursorType = ''; // track data-cursor to re-capture on change

    // Per-window: keyed by window ID
    interface WindowLayer {
      bitmap: ImageBitmap | null;
      dirty: boolean;
      x: number;
      y: number;
      w: number;
      h: number;
      zIndex: number;
      observer: MutationObserver | null;
      cleanup: (() => void) | null;
    }
    const windowLayers = new Map<string, WindowLayer>();
    windowLayersRef.current = windowLayers;

    // Global observer to detect background changes (menu, desktop, icons, phase).
    // Observes the entire domRef subtree but ignores mutations inside windows
    // (those are handled by per-window observers).
    let globalDirty = true;
    const globalObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        const target = m.target as HTMLElement;
        // Skip mutations inside window elements — handled by per-window observers
        if (target.closest?.('[data-window-id]')) continue;
        // Skip cursor element changes
        if (target.closest?.('.crt-custom-cursor') || target.classList?.contains('crt-custom-cursor')) continue;
        globalDirty = true;
        bgDirty = true;
        return;
      }
    });
    if (domRef.current) {
      globalObserver.observe(domRef.current, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    }

    // --- Scanning for windows ---
    function discoverWindows(): HTMLElement[] {
      if (!domRef.current) return [];
      return Array.from(domRef.current.querySelectorAll<HTMLElement>('[data-window-id]'));
    }

    // Setup per-window MutationObserver + scroll listener
    function setupWindowObserver(windowEl: HTMLElement, id: string) {
      const layer = windowLayers.get(id);
      if (!layer) return;

      const markDirty = () => {
        const l = windowLayers.get(id);
        if (l) l.dirty = true;
      };

      const mo = new MutationObserver(markDirty);
      mo.observe(windowEl, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
      layer.observer = mo;

      // Scroll events don't trigger MutationObserver — listen separately.
      // Use capture phase to catch scroll on any nested scrollable element.
      windowEl.addEventListener('scroll', markDirty, { passive: true, capture: true });
      layer.cleanup = () => {
        windowEl.removeEventListener('scroll', markDirty, { capture: true });
      };
    }

    // Sync layer map with current DOM
    function syncWindowLayers() {
      const windowEls = discoverWindows();
      const currentIds = new Set<string>();
      // Get domRef bounds to calculate window positions relative to capture container
      const containerRect = domRef.current?.getBoundingClientRect();

      for (const el of windowEls) {
        const id = el.dataset.windowId!;
        currentIds.add(id);

        // Use getBoundingClientRect for accurate position relative to container
        const rect = el.getBoundingClientRect();
        const x = containerRect ? Math.round(rect.left - containerRect.left) : 0;
        const y = containerRect ? Math.round(rect.top - containerRect.top) : 0;
        const w = Math.round(rect.width);
        const h = Math.round(rect.height);
        const zIndex = parseInt(el.style.zIndex) || 0;

        let layer = windowLayers.get(id);
        if (!layer) {
          // New window
          layer = { bitmap: null, dirty: true, x, y, w, h, zIndex, observer: null, cleanup: null };
          windowLayers.set(id, layer);
          setupWindowObserver(el, id);
          bgDirty = true; // re-capture bg without this window
        } else {
          // Check if position/size changed
          if (layer.x !== x || layer.y !== y || layer.w !== w || layer.h !== h || layer.zIndex !== zIndex) {
            if (layer.w !== w || layer.h !== h) {
              layer.dirty = true; // size change → re-capture content
            }
            layer.x = x;
            layer.y = y;
            layer.w = w;
            layer.h = h;
            layer.zIndex = zIndex;
          }
        }
      }

      // Remove stale layers
      for (const [id, layer] of windowLayers) {
        if (!currentIds.has(id)) {
          layer.observer?.disconnect();
          layer.cleanup?.();
          layer.bitmap?.close();
          windowLayers.delete(id);
          bgDirty = true;
        }
      }
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

    // Check if we're in a non-desktop phase (boot, screensaver, etc.)
    // These phases don't have windows, so use simple full-container capture.
    function isDesktopPhase() {
      const p = phaseRef.current;
      return p === 'desktop' || p === 'shutdown';
    }

    // Check if a menu dropdown is open — if so, fall back to full-container capture
    // to get correct z-ordering (menu above windows) and hover highlighting.
    function isMenuOpen() {
      return !!domRef.current?.querySelector('.menu-dropdown');
    }

    // Capture the background layer (desktop + menubar + icons, no windows)
    async function captureBackground() {
      if (!domRef.current || !snapdomRef.current) return;

      const capturedCanvas = await snapdomRef.current.toCanvas(domRef.current, {
        scale: 1,
        embedFonts: true,
        fast: true,
        cache: 'auto',
        // Exclude windows and cursor — capture only background + menubar + icons
        exclude: ['[data-window-id]', '.crt-custom-cursor'],
        excludeMode: 'remove',
      });

      bgBitmap?.close();
      bgBitmap = await createImageBitmap(capturedCanvas);
      bgDirty = false;
      console.log('CRT compositor: background captured', capturedCanvas.width, 'x', capturedCanvas.height);
    }

    // Capture a single window layer
    async function captureWindow(windowEl: HTMLElement, id: string) {
      if (!snapdomRef.current) return;
      const layer = windowLayers.get(id);
      if (!layer) return;

      // Temporarily neutralize the transform so snapdom captures the window
      // at (0,0) — we handle positioning during compositing.
      const savedTransform = windowEl.style.transform;
      windowEl.style.transform = 'none';

      const capturedCanvas = await snapdomRef.current.toCanvas(windowEl, {
        scale: 1,
        embedFonts: true,
        fast: true,
        cache: 'auto',
      });

      // Restore transform immediately
      windowEl.style.transform = savedTransform;

      layer.bitmap?.close();
      layer.bitmap = await createImageBitmap(capturedCanvas);
      layer.dirty = false;
      console.log('CRT compositor: window', id, 'captured', capturedCanvas.width, 'x', capturedCanvas.height, 'element', layer.w, 'x', layer.h);
    }

    // Full-container capture for non-desktop phases (boot, screensaver)
    async function captureFullContainer() {
      if (!domRef.current || !snapdomRef.current) return;

      const capturedCanvas = await snapdomRef.current.toCanvas(domRef.current, {
        scale: 1,
        embedFonts: true,
        fast: true,
        cache: 'auto',
      });

      const bitmap = await createImageBitmap(capturedCanvas);
      worker.postMessage({ type: 'frame', bitmap }, [bitmap]);
    }

    // Composite all layers and send to worker
    function compositeAndSend() {
      const w = compositeCanvas.width;
      const h = compositeCanvas.height;
      if (w === 0 || h === 0) return;

      compositeCtx.clearRect(0, 0, w, h);

      // Layer 0: Background
      if (bgBitmap) {
        compositeCtx.drawImage(bgBitmap, 0, 0, w, h);
      }

      // Window layers in z-order
      const sorted = [...windowLayers.entries()].sort((a, b) => a[1].zIndex - b[1].zIndex);
      for (const [, layer] of sorted) {
        if (layer.bitmap) {
          // Draw at natural bitmap size — snapdom captures include box-shadow/overflow
          compositeCtx.drawImage(layer.bitmap, layer.x, layer.y);
        }
      }

      // Cursor layer — topmost
      if (cursorBitmap && cursorRef.current && cursorRef.current.style.display !== 'none') {
        const pos = lastMousePosRef.current;
        if (pos) {
          compositeCtx.drawImage(cursorBitmap, pos.x, pos.y);
        }
      }

      // Transfer composite to worker
      createImageBitmap(compositeCanvas).then(bitmap => {
        if (!running) { bitmap.close(); return; }
        worker.postMessage({ type: 'frame', bitmap }, [bitmap]);
      });
    }

    // Main capture loop — captures dirty layers via snapdom (async, throttled)
    let captureCount = 0;
    async function capture() {
      if (!running || capturing || !domRef.current || !snapdomRef.current) return;
      const now = performance.now();
      const interval = getCaptureInterval();
      if (now - lastCaptureTime < interval) return;

      capturing = true;
      lastCaptureTime = now;

      try {
        // Non-desktop phases: simple full-container capture
        if (!isDesktopPhase()) {
          await captureFullContainer();
          captureCount++;
          if (captureCount <= 3) console.log('CRT compositor: full capture (non-desktop)', captureCount);
          capturing = false;
          return;
        }

        // Menu open: use full-container capture for correct z-ordering and hover states.
        // Always capture while menu is open — hover effects are CSS-only, no mutations.
        if (isMenuOpen()) {
          await captureFullContainer();
          capturing = false;
          return;
        }

        // Desktop phase: layer-based compositing
        syncWindowLayers();

        let layersDirty = globalDirty || bgDirty;
        globalDirty = false;

        // Capture background if dirty
        if (bgDirty) {
          await captureBackground();
          layersDirty = true;
        }

        // Capture dirty windows
        const windowEls = discoverWindows();
        const containerRect = domRef.current!.getBoundingClientRect();
        for (const el of windowEls) {
          const id = el.dataset.windowId!;
          const layer = windowLayers.get(id);
          if (layer && layer.dirty) {
            await captureWindow(el, id);
            layersDirty = true;
          }
          // Check if position changed (triggers re-composite but not re-capture)
          if (layer) {
            const rect = el.getBoundingClientRect();
            const x = Math.round(rect.left - containerRect.left);
            const y = Math.round(rect.top - containerRect.top);
            if (layer.x !== x || layer.y !== y) {
              layer.x = x;
              layer.y = y;
              layersDirty = true;
            }
          }
        }

        // Capture cursor if type changed (tiny element, ~16x22px)
        if (cursorRef.current && cursorRef.current.style.display !== 'none') {
          const newType = cursorRef.current.dataset.cursor || 'default';
          if (newType !== cursorType || !cursorBitmap) {
            cursorType = newType;
            if (snapdomRef.current) {
              const savedTransform = cursorRef.current.style.transform;
              cursorRef.current.style.transform = 'none';
              const cursorCanvas = await snapdomRef.current.toCanvas(cursorRef.current, {
                scale: 1,
                embedFonts: false,
                fast: true,
                cache: 'auto',
              });
              cursorRef.current.style.transform = savedTransform;
              cursorBitmap?.close();
              cursorBitmap = await createImageBitmap(cursorCanvas);
            }
            layersDirty = true;
          }
        }

        if (layersDirty) {
          compositeAndSend();
          captureCount++;
          if (captureCount <= 5) {
            const dirtyWins = [...windowLayers.values()].filter(l => !l.bitmap).length;
            console.log('CRT compositor: composite sent', captureCount, `(${windowLayers.size} windows, ${dirtyWins} uncached)`);
          }
        }
      } catch (e) {
        console.error('CRT compositor error:', e);
        bgDirty = true;
        globalDirty = true;
      }

      capturing = false;
    }

    // Fast composite-only pass for cursor movement (no snapdom, runs at rAF rate)
    // Only re-blits cached bitmaps — nearly free.
    // Skipped when menu is open (full-container capture handles everything).
    function fastCursorComposite() {
      if (cursorDirtyRef.current && bgBitmap && !capturing && !isMenuOpen()) {
        cursorDirtyRef.current = false;
        compositeAndSend();
      }
    }

    // Scheduling loop — runs at rAF rate for smooth cursor, triggers captures on schedule
    function scheduleCaptureLoop() {
      if (!running) return;
      // Fast path: cursor-only re-composite (no async, no snapdom)
      fastCursorComposite();
      // Slow path: capture dirty layers (async, throttled)
      capture();
      rafRef.current = requestAnimationFrame(scheduleCaptureLoop);
    }

    loadSnapdom().then(() => {
      scheduleCaptureLoop();
    });

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
      globalObserver.disconnect();
      for (const [, layer] of windowLayers) {
        layer.observer?.disconnect();
        layer.cleanup?.();
        layer.bitmap?.close();
      }
      windowLayers.clear();
      windowLayersRef.current = null;
      bgBitmap?.close();
      cursorBitmap?.close();
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
