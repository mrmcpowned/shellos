import { useCallback, useMemo, type ReactNode } from 'react';
import { Rnd } from 'react-rnd';
import { motion } from 'framer-motion';
import type { WindowState } from '../types';

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
        <div className="window-body">{children}</div>
      </motion.div>
    ),
    [windowState.title, isActive, onClose, onFocus, children]
  );

  if (isMobile || windowState.minimized) {
    if (windowState.minimized) return null;
    return (
      <div
        className="window-chrome"
        style={{ zIndex: windowState.zIndex }}
      >
        {content}
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
    </Rnd>
  );
}
