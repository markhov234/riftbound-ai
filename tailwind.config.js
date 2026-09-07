/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Riftbound domain colors (still label runes / domains)
        fury: '#c0392b',
        calm: '#16a085',
        order: '#2980b9',
        chaos: '#8e44ad',
        body: '#27ae60',
        mind: '#f39c12',
        // Terminal HUD palette
        bg: '#0b0b0c',
        panel: '#141414',
        panel2: '#1c1c1c',
        line: '#2b2b2b',
        line2: '#3a3a3a',
        accent: '#e8622c',
        accentDim: '#a6461d',
        txt: '#d4d4d4',
        txtDim: '#8a8a8a',
        txtFaint: '#585858',
        danger: '#e0403a',
        // legacy aliases so un-migrated classNames still resolve during the pass
        board: '#0b0b0c',
        card: '#141414',
        'card-hover': '#1c1c1c',
      },
      fontFamily: {
        mono: ['ui-monospace', 'JetBrains Mono', 'SF Mono', 'Menlo', 'Consolas', 'monospace'],
        display: ['ui-monospace', 'JetBrains Mono', 'SF Mono', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
