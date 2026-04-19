import { useState, useCallback, useEffect } from 'react';

interface ShutdownScreenProps {
  onRestart: () => void;
}

type ShutdownPhase = 'confirm' | 'shutting-down' | 'safe' | 'off';

export default function ShutdownScreen({ onRestart }: ShutdownScreenProps) {
  const [phase, setPhase] = useState<ShutdownPhase>('confirm');

  const handleShutdown = useCallback(() => {
    setPhase('shutting-down');
    setTimeout(() => setPhase('safe'), 1500);
    setTimeout(() => setPhase('off'), 4000);
  }, []);

  const handleCancel = useCallback(() => {
    // This won't actually go back since the parent controls phase
    // The parent should handle this, but we show confirm as default
  }, []);

  useEffect(() => {
    if (phase === 'off') {
      const handler = () => onRestart();
      document.addEventListener('click', handler);
      document.addEventListener('keydown', handler);
      return () => {
        document.removeEventListener('click', handler);
        document.removeEventListener('keydown', handler);
      };
    }
  }, [phase, onRestart]);

  if (phase === 'confirm') {
    return (
      <div className="shutdown-confirm-overlay">
        <div className="shutdown-confirm-dialog">
          <div style={{ marginBottom: '8px', fontSize: '28px' }}>🐚</div>
          <div>Are you sure you want to shut down?</div>
          <div className="shutdown-confirm-buttons">
            <button className="system-error-btn" onClick={handleCancel}>
              Cancel
            </button>
            <button className="system-error-btn" onClick={handleShutdown}>
              Shut Down
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'shutting-down') {
    return (
      <div className="shutdown-screen">
        <div>Shutting down ShellOS...</div>
      </div>
    );
  }

  if (phase === 'safe') {
    return (
      <div className="shutdown-screen">
        <div>
          It is now safe to turn off<br />your computer.
        </div>
      </div>
    );
  }

  // phase === 'off'
  return (
    <div className="shutdown-screen crt-power-off" style={{ background: '#000' }}>
      <div style={{ opacity: 0.5, fontSize: '10px' }}>
        Click anywhere or press any key to restart
      </div>
    </div>
  );
}
