/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        body: '#f9f9f9',
        text: '#000000',
        accent: { DEFAULT: '#d51522', hover: '#e61938' },
        primary: { DEFAULT: '#d51522', hover: '#e61938' },
        secondary: { DEFAULT: '#242424', hover: '#141414' },
        success: '#57d367',
        info: '#2dcfe9',
        warning: '#e9af43',
        danger: '#fd7379',
        light: '#e8e8e8',
        dark: '#000000',
      },
      borderRadius: {
        btn: '10px',
        card: '16px',
        lg: '12px',
      },
      boxShadow: {
        card: '0 1px 2px 0 rgba(16, 24, 40, 0.04), 0 1px 3px 0 rgba(16, 24, 40, 0.06)',
        'card-md': '0 4px 16px -2px rgba(16, 24, 40, 0.10), 0 2px 6px -2px rgba(16, 24, 40, 0.06)',
        pop: '0 12px 32px -8px rgba(16, 24, 40, 0.18)',
      },
      fontSize: {
        btn: '15px',
      },
    },
  },
  plugins: [],
};
