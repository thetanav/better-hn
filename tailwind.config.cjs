/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        surface: '#16181c',
        border: '#2f3336',
        accent: '#ff6600',
        muted: '#71767b',
      },
    },
  },
  plugins: [],
};
