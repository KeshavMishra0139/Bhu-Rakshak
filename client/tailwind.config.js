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
        sans: ['"Source Sans 3"', '"Noto Sans Devanagari"', '"Noto Sans Bengali"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        deva: ['"Noto Sans Devanagari"', '"Source Sans 3"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        // Headings: Outfit for Latin text; Devanagari and Bengali headings fall through to Noto.
        display: ['Outfit', '"Noto Sans Devanagari"', '"Noto Sans Bengali"', '"Source Sans 3"', 'system-ui', 'sans-serif'],
      },
      // One radius scale: cards 14px, controls 10px (see .btn / .input), pills round.
      borderRadius: { card: '14px', pill: '999px' },
      // Shadows tinted with the theme's deep teal instead of plain black (--shadow in index.css).
      boxShadow: {
        sm: '0 1px 2px 0 rgb(var(--shadow) / 0.07)',
        DEFAULT: '0 1px 3px 0 rgb(var(--shadow) / 0.09), 0 1px 2px -1px rgb(var(--shadow) / 0.09)',
        md: '0 6px 16px -4px rgb(var(--shadow) / 0.16), 0 2px 4px -2px rgb(var(--shadow) / 0.08)',
        lg: '0 14px 32px -8px rgb(var(--shadow) / 0.2), 0 4px 8px -4px rgb(var(--shadow) / 0.08)',
        xl: '0 22px 48px -12px rgb(var(--shadow) / 0.24)',
        '2xl': '0 32px 72px -16px rgb(var(--shadow) / 0.34)',
      },
    },
  },
  plugins: [],
};
