import { useEffect, useRef, useCallback } from 'react';
import { useShellOS } from '../hooks/useShellOS';

interface ScreenSaverProps {
  onDismiss: () => void;
}

export default function ScreenSaver({ onDismiss }: ScreenSaverProps) {
  const { settings } = useShellOS();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  const dismiss = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    onDismiss();
  }, [onDismiss]);

  useEffect(() => {
    const handleInput = () => dismiss();
    // Delay registering listeners to avoid the triggering click/mousemove
    // from immediately dismissing the screensaver
    const timer = setTimeout(() => {
      document.addEventListener('mousemove', handleInput);
      document.addEventListener('keydown', handleInput);
      document.addEventListener('click', handleInput);
      document.addEventListener('touchstart', handleInput);
    }, 500);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousemove', handleInput);
      document.removeEventListener('keydown', handleInput);
      document.removeEventListener('click', handleInput);
      document.removeEventListener('touchstart', handleInput);
    };
  }, [dismiss]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    if (settings.screensaverMode === 'starfield') {
      runStarfield(ctx, canvas, rafRef);
    } else {
      runBouncing(ctx, canvas, rafRef);
    }

    return () => cancelAnimationFrame(rafRef.current);
  }, [settings.screensaverMode]);

  return (
    <div className="screensaver" onClick={dismiss}>
      <canvas ref={canvasRef} />
    </div>
  );
}

function runStarfield(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  rafRef: React.MutableRefObject<number>
) {
  const stars: { x: number; y: number; z: number }[] = [];
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  for (let i = 0; i < 200; i++) {
    stars.push({
      x: (Math.random() - 0.5) * canvas.width,
      y: (Math.random() - 0.5) * canvas.height,
      z: Math.random() * canvas.width,
    });
  }

  function frame() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const star of stars) {
      star.z -= 4;
      if (star.z <= 0) {
        star.x = (Math.random() - 0.5) * canvas.width;
        star.y = (Math.random() - 0.5) * canvas.height;
        star.z = canvas.width;
      }

      const sx = (star.x / star.z) * 300 + cx;
      const sy = (star.y / star.z) * 300 + cy;
      const size = Math.max(0.5, (1 - star.z / canvas.width) * 3);
      const brightness = Math.floor((1 - star.z / canvas.width) * 255);

      ctx.fillStyle = `rgb(${brightness}, ${brightness}, ${brightness})`;
      ctx.beginPath();
      ctx.arc(sx, sy, size, 0, Math.PI * 2);
      ctx.fill();
    }

    rafRef.current = requestAnimationFrame(frame);
  }

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  frame();
}

function runBouncing(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  rafRef: React.MutableRefObject<number>
) {
  let x = canvas.width / 4;
  let y = canvas.height / 4;
  let vx = 2;
  let vy = 1.5;
  let hue = 0;
  const text = '🐚 ShellOS';

  ctx.font = '48px "Press Start 2P", monospace';

  function frame() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    x += vx;
    y += vy;

    const textWidth = 320;
    const textHeight = 48;

    if (x <= 0 || x + textWidth >= canvas.width) {
      vx = -vx;
      hue = (hue + 60) % 360;
    }
    if (y - textHeight <= 0 || y >= canvas.height) {
      vy = -vy;
      hue = (hue + 60) % 360;
    }

    ctx.fillStyle = `hsl(${hue}, 100%, 60%)`;
    ctx.fillText(text, x, y);

    rafRef.current = requestAnimationFrame(frame);
  }

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  frame();
}
