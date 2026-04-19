import { useState, useCallback, useRef } from 'react';

interface DesktopIconProps {
  icon: string;
  label: string;
  onOpen: () => void;
}

export default function DesktopIcon({ icon, label, onOpen }: DesktopIconProps) {
  const [selected, setSelected] = useState(false);
  const lastClickRef = useRef(0);
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;

  const handleClick = useCallback(
    (e: React.PointerEvent) => {
      // Mobile: single tap opens
      if (isMobile || e.pointerType === 'touch') {
        onOpen();
        return;
      }

      const now = Date.now();
      if (now - lastClickRef.current < 400) {
        // Double-click
        onOpen();
        lastClickRef.current = 0;
      } else {
        // Single-click: select
        setSelected(true);
        lastClickRef.current = now;
      }
    },
    [isMobile, onOpen]
  );

  const handleBlur = useCallback(() => setSelected(false), []);

  return (
    <div
      className={`desktop-icon ${selected ? 'selected' : ''}`}
      onPointerDown={handleClick}
      onBlur={handleBlur}
      tabIndex={0}
      role="button"
      aria-label={`Open ${label}`}
    >
      <span className="desktop-icon-emoji">{icon}</span>
      <span className="desktop-icon-label">{label}</span>
    </div>
  );
}
