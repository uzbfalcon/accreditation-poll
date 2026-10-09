import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'],
        // Raqamlar (INN, ball, foiz) — alohida monospace emas, Inter'ning bir xil kenglikdagi raqamlari (globals.css)
        mono: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      // O'qiladigan minimal o'lchamlar: 2xs (11px) — faqat katta harfli belgilar, caption (12px) — izohlar,
      // xs (13px) — interfeys matni, sm (14px) — asosiy matn
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
        caption: ['0.75rem', { lineHeight: '1.125rem' }],
        xs: ['0.8125rem', { lineHeight: '1.25rem' }],
        sm: ['0.875rem', { lineHeight: '1.375rem' }],
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        brand: {
          50: "#eef5fc",
          100: "#dbe9f9",
          200: "#bed7f4",
          300: "#90beed",
          400: "#5da0e4",
          500: "#0653c9",
          600: "#0653c9",
          700: "#0546aa",
          800: "#073c8c",
          900: "#0b3374",
          950: "#07204c",
        },
        teal: {
          50: "#eef5fc",
          100: "#dbe9f9",
          200: "#bed7f4",
          300: "#90beed",
          400: "#5da0e4",
          500: "#0653c9",
          600: "#0653c9",
          700: "#0546aa",
          800: "#073c8c",
          900: "#0b3374",
          950: "#07204c",
        },
      },
    },
  },
  plugins: [],
};
export default config;
