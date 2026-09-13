/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Riftbound domain colors. These are *card data*, not chrome — six
        // domains that must stay tellable apart at a glance — so they keep
        // their own hues and only get re-seated against the cooler ground.
        fury: '#ff5a4d',
        calm: '#2fd4c4',
        order: '#5b9dff',
        chaos: '#b06bff',
        body: '#3ecf8e',
        mind: '#ffb800',

        /* ── Surfaces ───────────────────────────────────────────────────────
           A lit aubergine table. Navy was cold and read as "software"; this
           leans warm, which is what stops a dark UI feeling dated, and it sets
           Arcane Cyan against a near-complement so the accent sings instead of
           blending into its own ground. Every step is a step up in luminance
           from the table, so panels sit *above* it rather than cutting holes. */
        bg: '#241B2E', // the table
        bg2: '#2D2239', // raised board areas
        panel: '#372A47', // panels, rails, bars, modals
        panel2: '#453455', // inset / elevated panels
        line: '#553F6B', // hairlines
        line2: '#715591', // emphasised hairlines

        /* ── Primary accent — Arcane Cyan ───────────────────────────────────
           Energy, active-state glows, primary actions, and *your* side of the
           board. Deliberately the only thing on screen this saturated. */
        accent: '#00F5FF',
        accentBright: '#8AFBFF',
        accentDim: '#17A2AF',

        /* ── Secondary — Radiant Amber ──────────────────────────────────────
           Rarity, legends, Power, victory banners, and any callout that must
           outrank the interface without meaning "danger". */
        gold: '#FFB800',
        goldBright: '#FFD166',
        goldDim: '#8A6400',

        /* Gear links and targeting. Kept inside the cool half of the palette
           so it reads as a relative of the cyan rather than a sixth hue. */
        hextech: '#4A90C2',

        txt: '#F6F1FA',
        txtDim: '#C0B0CE',
        txtFaint: '#8F7DA0',

        /* ── Alert / combat — Eldritch Crimson ──────────────────────────────
           Damage, lethal, combat triggers, and the opponent's side. */
        danger: '#FF2A54',
        dangerDim: '#8C142C',

        // Legacy alias — a couple of `bg-board` usages remain.
        board: '#14243E',
      },
      fontSize: {
        // The whole sub-14px range, named. Anything smaller than 'micro' is
        // not readable on a board you scan rather than read.
        micro: ['10px', { lineHeight: '1.35' }],
        tiny: ['11px', { lineHeight: '1.4' }],
      },
      // A single easing for every state change, so the board feels like one
      // surface reacting rather than a dozen widgets animating independently.
      transitionTimingFunction: {
        calm: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
      },
      fontFamily: {
        // Body / UI. Was monospace, which is why every screen read as a terminal.
        sans: ['Inter', 'Noto Sans KR', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        // Titles, card names, big numbers.
        display: ['Marcellus', 'Noto Serif KR', 'Georgia', 'Times New Roman', 'serif'],
        // Kept for tabular stats only — where monospace is actually the right call.
        mono: ['ui-monospace', 'JetBrains Mono', 'SF Mono', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        // A top inner highlight + soft drop, so panels read as lit objects
        // rather than flat rectangles with a 1px outline. The highlight is a
        // cool white now, to match the Slate surfaces it sits on.
        panel: 'inset 0 1px 0 rgba(214,233,255,0.06), 0 2px 8px rgba(0,0,0,0.55)',
        raised: 'inset 0 1px 0 rgba(214,233,255,0.10), 0 4px 16px rgba(0,0,0,0.65)',
        glow: '0 0 0 1px rgba(0,245,255,0.35), 0 0 18px rgba(0,245,255,0.18)',
      },
    },
  },
  plugins: [],
}
