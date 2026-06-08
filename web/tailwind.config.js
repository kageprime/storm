/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        storm: {
          bg: '#0f0f11',
          surface: '#1a1a1e',
          border: '#2a2a2e',
          accent: '#7c3aed',
          'accent-hover': '#6d28d9',
          text: '#e4e4e7',
          muted: '#71717a',
        },
      },
    },
  },
  plugins: [],
}
