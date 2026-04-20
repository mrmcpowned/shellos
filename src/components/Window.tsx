import { useCallback, useMemo, useRef, useEffect, useState, type ReactNode } from 'react';
import { Rnd } from 'react-rnd';
import { motion } from 'framer-motion';
import type { WindowState } from '../types';
import { useShellOS } from '../hooks/useShellOS';

interface WindowProps {
  windowState: WindowState;
  isActive: boolean;
  onClose: () => void;
  onFocus: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  children: ReactNode;
}

export default function Window({
  windowState,
  isActive,
  onClose,
  onFocus,
  onMove,
  onResize,
  children,
}: WindowProps) {
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;

  const handleDragStop = useCallback(
    (_e: unknown, d: { x: number; y: number }) => {
      onMove(d.x, d.y);
    },
    [onMove]
  );

  const handleResizeStop = useCallback(
    (
      _e: unknown,
      _dir: unknown,
      ref: HTMLElement,
      _delta: unknown,
      position: { x: number; y: number }
    ) => {
      onResize(ref.offsetWidth, ref.offsetHeight);
      onMove(position.x, position.y);
    },
    [onResize, onMove]
  );

  const { settings } = useShellOS();
  const crtOn = settings.crtEnabled;
  const [scrollState, setScrollState] = useState({ visible: false, thumbTop: 0, thumbHeight: 30 });
  const cleanupRef = useRef<(() => void) | null>(null);

  const bodyRef = useCallback((el: HTMLDivElement | null) => {
    // Clean up previous
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }

    if (!el || !crtOn) {
      setScrollState({ visible: false, thumbTop: 0, thumbHeight: 30 });
      return;
    }

    const update = () => {
      // Check body first, then known scrollable children
      let target: HTMLElement = el;
      if (el.scrollHeight <= el.clientHeight + 1) {
        const child = el.querySelector('.terminal, .file-explorer, .settings-panel, .text-editor-content, .browser-content') as HTMLElement | null;
        if (child && child.scrollHeight > child.clientHeight + 1) {
          target = child;
        }
      }

      const { scrollTop, scrollHeight, clientHeight } = target;
      const visible = scrollHeight > clientHeight + 1;
      if (!visible) {
        setScrollState({ visible: false, thumbTop: 0, thumbHeight: 30 });
        return;
      }
      const thumbHeight = Math.max(24, (clientHeight / scrollHeight) * clientHeight);
      const scrollRange = scrollHeight - clientHeight;
      const thumbRange = clientHeight - thumbHeight;
      const thumbTop = scrollRange > 0 ? (scrollTop / scrollRange) * thumbRange : 0;
      setScrollState({ visible: true, thumbTop, thumbHeight });
    };

    el.addEventListener('scroll', update, { passive: true, capture: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // Watch for content changes (new terminal output, etc.)
    // Debounced: coalesce rapid mutations into a single rAF callback
    let moRafPending = false;
    const mo = new MutationObserver(() => {
      if (!moRafPending) {
        moRafPending = true;
        requestAnimationFrame(() => {
          moRafPending = false;
          update();
        });
      }
    });
    // childList only — characterData changes don't affect scrollHeight
    mo.observe(el, { childList: true, subtree: true });
    update();

    cleanupRef.current = () => {
      el.removeEventListener('scroll', update, { capture: true });
      ro.disconnect();
      mo.disconnect();
    };
  }, [crtOn]);

  useEffect(() => {
    return () => { if (cleanupRef.current) cleanupRef.current(); };
  }, []);

  const content = useMemo(
    () => (
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.8, opacity: 0 }}
        transition={{ duration: 0.15 }}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
        }}
        onPointerDown={onFocus}
        role="dialog"
        aria-label={windowState.title}
      >
        <div className={`window-title-bar ${isActive ? '' : 'inactive'}`}>
          <div className="window-close-box" onClick={onClose} title="Close">
            ✕
          </div>
          <div className="window-title-text">{windowState.title}</div>
        </div>
        <div
          ref={bodyRef}
          className={`window-body ${crtOn ? 'window-body-crt' : ''}`}
        >
          {children}
        </div>
      </motion.div>
    ),
    [windowState.title, isActive, onClose, onFocus, children, crtOn, bodyRef]
  );

  const scrollbar = crtOn && scrollState.visible ? (
    <div className="window-scrollbar">
      <div className="window-scrollbar-track">
        <div
          className="window-scrollbar-thumb"
          style={{ top: scrollState.thumbTop, height: scrollState.thumbHeight }}
        />
      </div>
    </div>
  ) : null;

  if (isMobile || windowState.minimized) {
    if (windowState.minimized) return null;
    return (
      <div className="window-chrome" style={{ zIndex: windowState.zIndex }}>
        {content}
        {scrollbar}
      </div>
    );
  }

  return (
    <Rnd
      position={{ x: windowState.x, y: windowState.y }}
      size={{ width: windowState.width, height: windowState.height }}
      onDragStop={handleDragStop}
      onResizeStop={handleResizeStop}
      dragHandleClassName="window-title-bar"
      minWidth={300}
      minHeight={200}
      bounds="parent"
      style={{
        zIndex: windowState.zIndex,
        position: 'absolute',
      }}
      className="window-chrome"
      enableResizing={{
        bottom: true,
        right: true,
        bottomRight: true,
        top: false,
        left: false,
        topRight: false,
        topLeft: false,
        bottomLeft: false,
      }}
    >
      {content}
      {scrollbar}
    </Rnd>
  );
}
