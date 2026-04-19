import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useBootSound } from '../hooks/useBootSound';
import { useShellOS } from '../hooks/useShellOS';
import { SHELL_FRAME_1, SHELL_FRAME_2, SHELL_FRAME_3 } from '../assets/shellArt';

interface BootSequenceProps {
  onComplete: () => void;
}

interface BootLine {
  text: string;
  delay: number;
  action?: 'memory' | 'shell1' | 'shell2' | 'shell3';
}

const BOOT_LINES: BootLine[] = [
  { text: 'ShellOS BIOS v1.0 — Conch Computing Inc.', delay: 300 },
  { text: '(c) 2026 Conch Computing Inc. All Rights Reserved\n', delay: 200 },
  { text: '', delay: 500, action: 'shell1' },
  { text: '', delay: 600, action: 'shell2' },
  { text: '', delay: 600, action: 'shell3' },
  { text: '\nDetecting CPU... 6502 @ 1MHz — OK', delay: 400 },
  { text: 'Memory: ', delay: 100, action: 'memory' },
  { text: 'HDD0: 20MB — OK', delay: 400 },
  { text: 'FDD0: 1.44MB — OK\n', delay: 300 },
  { text: 'Starting ShellOS...', delay: 800 },
  { text: 'Welcome to ShellOS v1.0!\n', delay: 600 },
];

export default function BootSequence({ onComplete }: BootSequenceProps) {
  const [visibleLines, setVisibleLines] = useState<string[]>([]);
  const [shellFrame, setShellFrame] = useState('');
  const [memoryCount, setMemoryCount] = useState<number | null>(null);
  const [dots, setDots] = useState('');
  const [completed, setCompleted] = useState(false);
  const skipRef = useRef(false);
  const { playPostBeep, playMemoryTick, playDriveSeek, playBootChime } = useBootSound();
  const { settings } = useShellOS();
  const quickBoot = useRef(
    settings.quickBootEnabled && localStorage.getItem('shellos-booted') === 'true'
  );

  const skipBoot = useCallback(() => {
    if (skipRef.current) return;
    skipRef.current = true;
    setCompleted(true);
    localStorage.setItem('shellos-booted', 'true');
    onComplete();
  }, [onComplete]);

  useEffect(() => {
    if (quickBoot.current) {
      // Quick boot: 1s flash
      const timer = setTimeout(skipBoot, 1000);
      setVisibleLines(['ShellOS BIOS v1.0 — Quick Boot...']);
      return () => clearTimeout(timer);
    }

    let lineIndex = 0;
    let timeoutId: ReturnType<typeof setTimeout>;

    const processLine = () => {
      if (skipRef.current || lineIndex >= BOOT_LINES.length) {
        if (!skipRef.current) {
          setCompleted(true);
          localStorage.setItem('shellos-booted', 'true');
          playBootChime();
          // Wait 2.5s after boot complete, then transition (shader handles the fade)
          setTimeout(onComplete, 2500);
        }
        return;
      }

      const line = BOOT_LINES[lineIndex];
      lineIndex++;

      if (line.action === 'shell1') {
        setShellFrame(SHELL_FRAME_1);
        playPostBeep();
        timeoutId = setTimeout(processLine, line.delay);
      } else if (line.action === 'shell2') {
        setShellFrame(SHELL_FRAME_2);
        timeoutId = setTimeout(processLine, line.delay);
      } else if (line.action === 'shell3') {
        setShellFrame(SHELL_FRAME_3);
        timeoutId = setTimeout(processLine, line.delay);
      } else if (line.action === 'memory') {
        setVisibleLines((prev) => [...prev, line.text]);
        // Animate memory count
        let mem = 0;
        const memInterval = setInterval(() => {
          mem += 64;
          if (mem > 640) {
            clearInterval(memInterval);
            setMemoryCount(null);
            setVisibleLines((prev) => {
              const last = prev.length - 1;
              const updated = [...prev];
              updated[last] = `Memory: 640K OK`;
              return updated;
            });
            playDriveSeek();
            timeoutId = setTimeout(processLine, 300);
            return;
          }
          setMemoryCount(mem);
          playMemoryTick();
        }, 60);
        return;
      } else {
        if (line.text.includes('Starting ShellOS')) {
          setVisibleLines((prev) => [...prev, line.text]);
          // Animate dots
          let dotCount = 0;
          const dotInterval = setInterval(() => {
            dotCount++;
            setDots('.'.repeat(dotCount));
            if (dotCount >= 3) clearInterval(dotInterval);
          }, 250);
          timeoutId = setTimeout(processLine, line.delay);
        } else {
          setVisibleLines((prev) => [...prev, line.text]);
          timeoutId = setTimeout(processLine, line.delay);
        }
      }
    };

    timeoutId = setTimeout(processLine, 500);

    return () => {
      clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Skip on any keypress
  useEffect(() => {
    const handleKey = () => skipBoot();
    document.addEventListener('keydown', handleKey);
    document.addEventListener('click', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('click', handleKey);
    };
  }, [skipBoot]);

  return (
    <div className="boot-screen">
      {shellFrame && (
        <motion.pre
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          {shellFrame}
        </motion.pre>
      )}
      <AnimatePresence>
        {visibleLines.map((line, i) => (
          <motion.div
            key={i}
            className="boot-line"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.1 }}
          >
            {line}
            {memoryCount !== null && i === visibleLines.length - 1 && (
              <span className="boot-memory-counter">{memoryCount}K</span>
            )}
            {line.includes('Starting ShellOS') && dots}
          </motion.div>
        ))}
      </AnimatePresence>
      {completed && (
        <motion.div
          className="boot-line"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          Boot complete.
        </motion.div>
      )}
      {!completed && (
        <div className="boot-skip">
          {completed ? '' : 'Press any key to skip'}
        </div>
      )}
    </div>
  );
}
