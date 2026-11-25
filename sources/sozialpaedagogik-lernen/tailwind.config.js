/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['Fraunces', 'Georgia', 'serif'],
      },
      colors: {
        paper: {
          50: '#FAF8F5',
          100: '#F4EFE6',
          200: '#E8DFD1',
        },
        ink: {
          900: '#0F1419',
          800: '#171E26',
          700: '#222C37',
        },
      },
      boxShadow: {
        soft: '0 4px 20px -2px rgba(15, 20, 25, 0.06)',
        card: '0 10px 30px -5px rgba(15, 20, 25, 0.08)',
      },
    },
  },
  plugins: [],
};
