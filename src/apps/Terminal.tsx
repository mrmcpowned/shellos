import { useState, useRef, useCallback, useEffect } from 'react';
import { useShellOS } from '../contexts/ShellOSContext';
import { useUISounds } from '../hooks/useUISounds';
import { executeCommand } from './commands';

interface TerminalProps {
  isActive: boolean;
  onOpenFile: (path: string, content: string) => void;
  onShutdown: () => void;
  onCrash: () => void;
}

interface OutputLine {
  id: number;
  text: string;
}

let lineIdCounter = 0;

export default function Terminal({ isActive, onOpenFile, onShutdown, onCrash }: TerminalProps) {
  const { settings, updateSettings } = useShellOS();
  const { playKeystroke } = useUISounds();
  const [output, setOutput] = useState<OutputLine[]>([
    { id: lineIdCounter++, text: 'ShellOS Terminal v1.0\nType "help" for a list of commands.\n' },
  ]);
  const [input, setInput] = useState('');
  const [cwd, setCwd] = useState('/');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showMatrix, setShowMatrix] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, []);

  useEffect(scrollToBottom, [output, scrollToBottom]);

  const submitCommand = useCallback(
    (cmd: string) => {
      const prompt = `${cwd}> ${cmd}`;
      const result = executeCommand(cmd, {
        cwd,
        setCwd,
        setColor: (c) => updateSettings({ terminalColor: c }),
        openFile: onOpenFile,
        triggerShutdown: onShutdown,
        triggerCrash: onCrash,
      });

      if (result.clear) {
        setOutput([]);
      } else if (result.matrix) {
        setShowMatrix(true);
        setTimeout(() => setShowMatrix(false), 3000);
        setOutput((prev) => [
          ...prev,
          { id: lineIdCounter++, text: prompt },
          { id: lineIdCounter++, text: result.output },
        ]);
      } else {
        setOutput((prev) => [
          ...prev,
          { id: lineIdCounter++, text: prompt },
          ...(result.output ? [{ id: lineIdCounter++, text: result.output }] : []),
        ]);
      }

      if (cmd.trim()) {
        setHistory((prev) => [...prev, cmd]);
      }
      setHistoryIndex(-1);
      setInput('');
    },
    [cwd, updateSettings, onOpenFile, onShutdown, onCrash]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isActive) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        submitCommand(input);
        return;
      }

      if (e.key === 'Backspace') {
        e.preventDefault();
        setInput((prev) => prev.slice(0, -1));
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (history.length === 0) return;
        const newIdx = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIdx);
        setInput(history[newIdx]);
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (historyIndex === -1) return;
        const newIdx = historyIndex + 1;
        if (newIdx >= history.length) {
          setHistoryIndex(-1);
          setInput('');
        } else {
          setHistoryIndex(newIdx);
          setInput(history[newIdx]);
        }
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setInput((prev) => prev + e.key);
        playKeystroke();
      }
    },
    [isActive, input, history, historyIndex, submitCommand, playKeystroke]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Mobile: focus input
  useEffect(() => {
    if (isActive && mobileInputRef.current && window.innerWidth <= 768) {
      mobileInputRef.current.focus();
    }
  }, [isActive]);

  const handleMobileSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      submitCommand(input);
    },
    [input, submitCommand]
  );

  return (
    <div className="terminal" data-color={settings.terminalColor} ref={outputRef}>
      {showMatrix && <MatrixRain />}
      <div className="terminal-output">
        {output.map((line) => (
          <div key={line.id}>{line.text}</div>
        ))}
      </div>
      <div className="terminal-input-line">
        <span className="terminal-prompt">{cwd}&gt;&nbsp;</span>
        <span className="terminal-input">
          {input}
          <span className="terminal-cursor" />
        </span>
      </div>
      <form className="terminal-mobile-input" onSubmit={handleMobileSubmit}>
        <input
          ref={mobileInputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
      </form>
    </div>
  );
}

function MatrixRain() {
  const columns = Math.floor(window.innerWidth / 16);
  return (
    <div className="matrix-rain">
      {Array.from({ length: columns }, (_, i) => {
        const chars = Array.from({ length: 20 }, () =>
          String.fromCharCode(0x30a0 + Math.random() * 96)
        ).join('\n');
        const delay = Math.random() * 2;
        const duration = 1 + Math.random() * 2;
        return (
          <div
            key={i}
            className="matrix-column"
            style={{
              left: `${i * 16}px`,
              animationDelay: `${delay}s`,
              animationDuration: `${duration}s`,
            }}
          >
            {chars}
          </div>
        );
      })}
    </div>
  );
}
