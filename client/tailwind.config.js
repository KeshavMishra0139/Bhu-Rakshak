/** Colours come from CSS variables (src/styles/index.css) so light/dark switch without rebuilds. */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        surface: v('surface'),
        'surface-2': v('surface-2'),
        ink: v('ink'),
        muted: v('muted'),
        line: v('line'),
        brand: v('brand'),
        'brand-deep': v('brand-deep'),
        'on-brand': v('on-brand'),
        focus: v('focus'),
        risk: {
          low: v('risk-low'),
          moderate: v('risk-moderate'),
          high: v('risk-high'),
          critical: v('risk-critical'),
        },
      },
      fontFamily: {
        sans: ['"Source Sans 3"', '"Noto Sans Devanagari"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        deva: ['"Noto Sans Devanagari"', '"Source Sans 3"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: { card: '10px', pill: '999px' },
    },
  },
  plugins: [],
};
