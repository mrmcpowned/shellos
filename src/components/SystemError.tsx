import { useEffect } from 'react';
import { useUISounds } from '../hooks/useUISounds';
import { SHELL_SAD } from '../assets/shellArt';
import type { ErrorState } from '../types';

interface SystemErrorProps {
  error: ErrorState;
  onRestart: () => void;
  onContinue: () => void;
}

export default function SystemError({ error, onRestart, onContinue }: SystemErrorProps) {
  const { playErrorBeep } = useUISounds();

  // Play error beep on mount
  useEffect(() => {
    playErrorBeep();
  }, [playErrorBeep]);

  return (
    <div className="system-error-overlay">
      <div className="system-error-dialog">
        {error.fatal ? (
          <pre className="system-error-icon" style={{ fontSize: '12px', textAlign: 'left' }}>
            {SHELL_SAD}
          </pre>
        ) : (
          <div className="system-error-icon">💣</div>
        )}
        <div className="system-error-message">
          {error.fatal
            ? 'A fatal system error has occurred.'
            : 'Sorry, a system error occurred.'}
          <br />
          {error.message}
        </div>
        <div className="system-error-code">Error ID: {error.code}</div>
        <div className="system-error-buttons">
          <button className="system-error-btn" onClick={onRestart}>
            Restart
          </button>
          {!error.fatal && (
            <button className="system-error-btn" onClick={onContinue}>
              Continue
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Utility: generate a random error
export function randomErrorChance(): boolean {
  return Math.random() < 0.005; // 0.5% chance
}

export function makeRandomError(): ErrorState {
  const errors = [
    { message: 'Unexpected kernel panic in CONCH.DRV', code: '0x0000DEAD' },
    { message: 'Stack overflow in ShellTerm module', code: '0xBAADF00D' },
    { message: 'Invalid opcode at address 0xFFFF', code: '0xDEADBEEF' },
    { message: 'Memory allocation failed — out of shells', code: '0x00C0FFEE' },
    { message: 'Bus error on conch bus lane 7', code: '0xFACEFEED' },
  ];
  const err = errors[Math.floor(Math.random() * errors.length)];
  return { ...err, fatal: false };
}
