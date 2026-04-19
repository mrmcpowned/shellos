import { useState, useEffect, useRef, useCallback } from 'react';

interface SnakeProps {
  isActive: boolean;
}

const GRID = 20;
const CELL = 16;
const CANVAS_SIZE = GRID * CELL;
const INITIAL_SPEED = 150;

type Dir = 'up' | 'down' | 'left' | 'right';
type Point = { x: number; y: number };

export default function Snake({ isActive }: SnakeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);

  const snakeRef = useRef<Point[]>([{ x: 10, y: 10 }]);
  const dirRef = useRef<Dir>('right');
  const foodRef = useRef<Point>(randomFood());
  const speedRef = useRef(INITIAL_SPEED);
  const runningRef = useRef(true);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  function randomFood(): Point {
    return {
      x: Math.floor(Math.random() * GRID),
      y: Math.floor(Math.random() * GRID),
    };
  }

  const resetGame = useCallback(() => {
    snakeRef.current = [{ x: 10, y: 10 }];
    dirRef.current = 'right';
    foodRef.current = randomFood();
    speedRef.current = INITIAL_SPEED;
    runningRef.current = true;
    setScore(0);
    setGameOver(false);
  }, []);

  // Game loop
  useEffect(() => {
    if (!isActive || gameOver) {
      runningRef.current = false;
      return;
    }
    runningRef.current = true;

    const tick = () => {
      if (!runningRef.current) return;

      const snake = snakeRef.current;
      const head = { ...snake[0] };
      const dir = dirRef.current;

      if (dir === 'up') head.y--;
      else if (dir === 'down') head.y++;
      else if (dir === 'left') head.x--;
      else if (dir === 'right') head.x++;

      // Wall collision
      if (head.x < 0 || head.x >= GRID || head.y < 0 || head.y >= GRID) {
        setGameOver(true);
        runningRef.current = false;
        return;
      }

      // Self collision
      if (snake.some((s) => s.x === head.x && s.y === head.y)) {
        setGameOver(true);
        runningRef.current = false;
        return;
      }

      snake.unshift(head);

      // Food
      if (head.x === foodRef.current.x && head.y === foodRef.current.y) {
        setScore((s) => s + 1);
        foodRef.current = randomFood();
        if (speedRef.current > 60) speedRef.current -= 5;
      } else {
        snake.pop();
      }

      // Draw
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

        // Food
        ctx.fillStyle = '#ff3333';
        ctx.fillRect(
          foodRef.current.x * CELL + 1,
          foodRef.current.y * CELL + 1,
          CELL - 2,
          CELL - 2
        );

        // Snake
        ctx.fillStyle = '#33ff33';
        snake.forEach((s, i) => {
          const brightness = i === 0 ? '#33ff33' : '#22cc22';
          ctx.fillStyle = brightness;
          ctx.fillRect(s.x * CELL + 1, s.y * CELL + 1, CELL - 2, CELL - 2);
        });

        // Grid lines (subtle)
        ctx.strokeStyle = '#111';
        for (let i = 0; i <= GRID; i++) {
          ctx.beginPath();
          ctx.moveTo(i * CELL, 0);
          ctx.lineTo(i * CELL, CANVAS_SIZE);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, i * CELL);
          ctx.lineTo(CANVAS_SIZE, i * CELL);
          ctx.stroke();
        }
      }

      setTimeout(tick, speedRef.current);
    };

    setTimeout(tick, speedRef.current);

    return () => {
      runningRef.current = false;
    };
  }, [isActive, gameOver]);

  // Keyboard controls
  useEffect(() => {
    if (!isActive) return;
    const handleKey = (e: KeyboardEvent) => {
      const map: Record<string, Dir> = {
        ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
        w: 'up', s: 'down', a: 'left', d: 'right',
        W: 'up', S: 'down', A: 'left', D: 'right',
      };
      const dir = map[e.key];
      if (!dir) return;
      e.preventDefault();
      const curr = dirRef.current;
      const opposites: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };
      if (dir !== opposites[curr]) dirRef.current = dir;
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isActive]);

  // Touch controls
  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const handleTouchEnd = (e: TouchEvent) => {
      if (!touchStartRef.current) return;
      const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
      const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
      touchStartRef.current = null;
      if (Math.abs(dx) > Math.abs(dy)) {
        dirRef.current = dx > 0 ? 'right' : 'left';
      } else {
        dirRef.current = dy > 0 ? 'down' : 'up';
      }
    };
    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, []);

  return (
    <div className="snake-game">
      <div className="snake-score">Score: {score}</div>
      <canvas
        ref={canvasRef}
        width={CANVAS_SIZE}
        height={CANVAS_SIZE}
        className="snake-canvas"
      />
      {gameOver && (
        <div className="snake-game-over">
          <h3>GAME OVER</h3>
          <div>Score: {score}</div>
          <button className="snake-replay-btn" onClick={resetGame}>
            Play Again
          </button>
        </div>
      )}
    </div>
  );
}
