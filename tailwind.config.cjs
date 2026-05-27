/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#16181c',
        border: '#2f3336',
        accent: '#1d9bf0',
        muted: '#71767b',
      },
    },
  },
  plugins: [],
};
