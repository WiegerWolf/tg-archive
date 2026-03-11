/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./web/index.html', './web/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Outfit', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      keyframes: {
        cardHighlight: {
          '0%': { backgroundColor: 'transparent' },
          '35%': { backgroundColor: 'rgb(191 219 254 / 0.5)' },
          '100%': { backgroundColor: 'transparent' },
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        pulse2: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        slideInRight: {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
      },
      animation: {
        'card-highlight': 'cardHighlight 2s ease-in-out',
        'slide-down': 'slideDown 0.2s ease-out',
        'fade-in': 'fadeIn 0.15s ease-out',
        'pulse-slow': 'pulse2 2s ease-in-out infinite',
        'slide-in-right': 'slideInRight 0.2s ease-out',
      },
    },
  },
  plugins: [],
};
