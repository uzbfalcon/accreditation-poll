import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
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
