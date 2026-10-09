/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    borderRadius: {
      none: '0', sm: '4px', DEFAULT: '6px', md: '6px', lg: '8px', xl: '8px',
      '2xl': '10px', '3xl': '12px', xl2: '10px', full: '9999px',
    },
    extend: {
      colors: {
        accent: '#5C00EE',
        tint: '#B0A8FA',
        bg: '#0D0D0D',
        card: '#1A1A1A',
        chip: '#2A2A2A',
        sub: '#9E9E9E',
      },
    },
  },
  plugins: [],
};
