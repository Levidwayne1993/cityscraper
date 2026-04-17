'use client';

import { useEffect, useRef } from 'react';

export function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Full viewport
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    // Matrix characters — katakana + latin + digits + symbols
    const chars =
      'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン' +
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%^&*(){}[]|/<>~';
    const charArr = chars.split('');

    const fontSize = 14;
    const columns = Math.floor(canvas.width / fontSize);

    // Each column tracks its current y position
    const drops: number[] = Array(columns).fill(1);

    // Randomize initial positions
    for (let i = 0; i < drops.length; i++) {
      drops[i] = Math.random() * -100;
    }

    function draw() {
      if (!ctx || !canvas) return;

      // Semi-transparent black overlay creates trail effect
      ctx.fillStyle = 'rgba(10, 10, 10, 0.05)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.font = `${fontSize}px "JetBrains Mono", monospace`;

      for (let i = 0; i < drops.length; i++) {
        // Random character
        const char = charArr[Math.floor(Math.random() * charArr.length)];

        const x = i * fontSize;
        const y = drops[i] * fontSize;

        // Leading character is bright white-green
        if (Math.random() > 0.98) {
          ctx.fillStyle = '#ffffff';
        } else if (Math.random() > 0.9) {
          ctx.fillStyle = '#00ff41';
        } else {
          // Dimmer trailing characters
          const alpha = 0.15 + Math.random() * 0.35;
          ctx.fillStyle = `rgba(0, 255, 65, ${alpha})`;
        }

        ctx.fillText(char, x, y);

        // Reset drop to top with randomness
        if (y > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }

        drops[i]++;
      }
    }

    const interval = setInterval(draw, 50);

    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="matrix-rain-container"
      style={{ opacity: 0.4 }}
    />
  );
}
