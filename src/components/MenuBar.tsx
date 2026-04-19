import { useState, useEffect, useCallback, useRef } from 'react';
import { useUISounds } from '../hooks/useUISounds';

interface MenuBarProps {
  activeAppName: string | null;
  onAbout: () => void;
  onSettings: () => void;
  onShutdown: () => void;
  onForceError: () => void;
}

export default function MenuBar({
  activeAppName,
  onAbout,
  onSettings,
  onShutdown,
  onForceError,
}: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [time, setTime] = useState(formatTime());
  const menuRef = useRef<HTMLDivElement>(null);
  const { playMenuClick } = useUISounds();

  function formatTime() {
    const d = new Date();
    let h = d.getHours();
    const m = d.getMinutes().toString().padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${ampm}`;
  }

  useEffect(() => {
    const id = setInterval(() => setTime(formatTime()), 60000);
    return () => clearInterval(id);
  }, []);

  const toggleMenu = useCallback((name: string) => {
    playMenuClick();
    setOpenMenu((prev) => (prev === name ? null : name));
  }, [playMenuClick]);

  const handleAction = useCallback((action: () => void) => {
    setOpenMenu(null);
    playMenuClick();
    action();
  }, [playMenuClick]);

  // Close menu on outside click
  useEffect(() => {
    if (!openMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    // Use setTimeout to avoid the current click event from closing the menu
    const timer = setTimeout(() => {
      document.addEventListener('click', handler);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handler);
    };
  }, [openMenu]);

  return (
    <div className="menu-bar" ref={menuRef}>
      <div
        className={`menu-item ${openMenu === 'shell' ? 'active' : ''}`}
        onClick={() => toggleMenu('shell')}
      >
        🐚
        {openMenu === 'shell' && (
          <div className="menu-dropdown">
            <div className="menu-dropdown-item" onClick={() => handleAction(onAbout)}>
              About ShellOS
            </div>
            <div className="menu-dropdown-separator" />
            <div className="menu-dropdown-item" onClick={() => handleAction(onSettings)}>
              Settings...
            </div>
            <div className="menu-dropdown-separator" />
            <div className="menu-dropdown-item" onClick={() => handleAction(onForceError)}>
              Force Error
            </div>
            <div className="menu-dropdown-separator" />
            <div className="menu-dropdown-item" onClick={() => handleAction(onShutdown)}>
              Shut Down...
            </div>
          </div>
        )}
      </div>

      {activeAppName && <div className="menu-active-app">{activeAppName}</div>}

      <div className="menu-clock">{time}</div>
    </div>
  );
}
