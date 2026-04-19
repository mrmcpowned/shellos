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
  const outputRef = useRef<HTMLDivElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  const cursorRef = useRef<HTMLSpanElement>(null);

  // JS-driven cursor blink — CSS animations don't survive snapdom cloning
  useEffect(() => {
    const el = cursorRef.current;
    if (!el) return;
    let visible = true;
    const id = setInterval(() => {
      visible = !visible;
      el.style.opacity = visible ? '1' : '0';
    }, 530);
    return () => clearInterval(id);
  }, []);

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
        // Matrix rain: simulate cmatrix by clearing screen and rendering
        // full "frames" where each column has a falling head character
        // with a trail of random chars behind it
        setOutput([{ id: lineIdCounter++, text: result.output }]);

        const cols = 50;
        const rows = 20;
        // Each column: current head position (row index), speed (rows per tick)
        const columns: { pos: number; speed: number; chars: string[] }[] =
          Array.from({ length: cols }, () => ({
            pos: -Math.floor(Math.random() * rows),
            speed: 1 + Math.floor(Math.random() * 2),
            chars: Array.from({ length: rows }, () =>
              String.fromCharCode(0x30a0 + Math.random() * 96)
            ),
          }));

        let ticks = 0;
        const matrixInterval = setInterval(() => {
          // Build a frame: each row is a string of characters
          const frame: string[] = [];
          for (let r = 0; r < rows; r++) {
            let row = '';
            for (let c = 0; c < cols; c++) {
              const col = columns[c];
              const dist = col.pos - r;
              if (dist >= 0 && dist < 6) {
                // In the trail — show a character
                row += col.chars[r % col.chars.length];
              } else {
                row += ' ';
              }
            }
            frame.push(row);
          }

          // Advance each column
          for (const col of columns) {
            col.pos += col.speed;
            if (col.pos > rows + 8) {
              col.pos = -Math.floor(Math.random() * 6);
              col.speed = 1 + Math.floor(Math.random() * 2);
              // Randomize chars for next pass
              for (let i = 0; i < col.chars.length; i++) {
                col.chars[i] = String.fromCharCode(0x30a0 + Math.random() * 96);
              }
            }
          }

          // Replace output with the frame
          setOutput([{ id: lineIdCounter++, text: frame.join('\n') }]);
          ticks++;

          if (ticks >= 60) {
            clearInterval(matrixInterval);
            setOutput((prev) => [
              ...prev,
              { id: lineIdCounter++, text: '\n[Matrix disconnected]\n' },
            ]);
          }
        }, 80);
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
      <div className="terminal-output">
        {output.map((line) => (
          <div key={line.id}>{line.text}</div>
        ))}
      </div>
      <div className="terminal-input-line">
        <span className="terminal-prompt">{cwd}&gt;&nbsp;</span>
        <span className="terminal-input">
          {input}
          <span ref={cursorRef} className="terminal-cursor" />
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
