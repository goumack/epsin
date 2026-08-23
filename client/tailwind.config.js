/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        marine: {
          50: '#f0f6ff', 100: '#e0edff', 200: '#bad8ff', 300: '#7db8ff',
          400: '#3894ff', 500: '#0d72f0', 600: '#0056cd', 700: '#0044a6',
          800: '#053a89', 900: '#0a3271',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
