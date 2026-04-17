import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        matrix: {
          black: '#0a0a0a',
          dark: '#0d1117',
          green: '#00ff41',
          'green-dim': '#00cc33',
          'green-glow': '#00ff4180',
          cyan: '#00d4ff',
          'cyan-glow': '#00d4ff60',
          amber: '#ffb000',
          red: '#ff3333',
          panel: '#0d1b0e',
          'panel-border': '#00ff4130',
          card: '#0a150b',
          'card-hover': '#0f1f10',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        display: ['Orbitron', 'sans-serif'],
      },
      animation: {
        'matrix-fall': 'matrixFall 8s linear infinite',
        'glow-pulse': 'glowPulse 2s ease-in-out infinite',
        'scan-line': 'scanLine 4s linear infinite',
        'flicker': 'flicker 0.15s infinite',
        'slide-up': 'slideUp 0.5s ease-out',
        'fade-in': 'fadeIn 0.8s ease-out',
      },
      keyframes: {
        matrixFall: {
          '0%': { transform: 'translateY(-100vh)', opacity: '1' },
          '100%': { transform: 'translateY(100vh)', opacity: '0' },
        },
        glowPulse: {
          '0%, 100%': { boxShadow: '0 0 5px #00ff41, 0 0 10px #00ff4140' },
          '50%': { boxShadow: '0 0 20px #00ff41, 0 0 40px #00ff4160' },
        },
        scanLine: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        flicker: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.8' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      backgroundImage: {
        'grid-matrix': 'linear-gradient(rgba(0,255,65,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,65,0.03) 1px, transparent 1px)',
      },
      backgroundSize: {
        'grid-matrix': '50px 50px',
      },
    },
  },
  plugins: [],
};

export default config;
