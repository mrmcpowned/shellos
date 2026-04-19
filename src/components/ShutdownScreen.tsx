import { useState, useCallback, useEffect } from 'react';

interface ShutdownScreenProps {
  onRestart: () => void;
  onCancel?: () => void;
}

type ShutdownPhase = 'confirm' | 'shutting-down' | 'safe' | 'off';

export default function ShutdownScreen({ onRestart, onCancel }: ShutdownScreenProps) {
  const [phase, setPhase] = useState<ShutdownPhase>('confirm');

  const handleShutdown = useCallback(() => {
    setPhase('shutting-down');
    setTimeout(() => setPhase('safe'), 1500);
    setTimeout(() => setPhase('off'), 4000);
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

  // Confirm dialog — same overlay style as SystemError
  if (phase === 'confirm') {
    return (
      <div className="system-error-overlay">
        <div className="system-error-dialog">
          <div className="system-error-icon">🐚</div>
          <div className="system-error-message">
            Are you sure you want to shut down?
          </div>
          <div className="system-error-buttons">
            {onCancel && (
              <button className="system-error-btn" onClick={onCancel}>
                Cancel
              </button>
            )}
            <button className="system-error-btn" onClick={handleShutdown}>
              Shut Down
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Shutting down / safe / off — full screen overlay
  return (
    <div className="system-error-overlay" style={{ background: 'rgba(0,0,0,0.85)' }}>
      <div className="system-error-dialog" style={{ border: 'none', boxShadow: 'none', background: 'transparent', color: '#fff' }}>
        <div className="system-error-icon">🐚</div>
        <div className="system-error-message" style={{ color: '#fff' }}>
          {phase === 'shutting-down' && 'Shutting down ShellOS...'}
          {phase === 'safe' && (
            <>It is now safe to turn off<br />your computer.</>
          )}
          {phase === 'off' && (
            <span style={{ opacity: 0.5, fontSize: '11px' }}>
              Click anywhere to restart
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
