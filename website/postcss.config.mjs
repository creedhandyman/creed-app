// This file must exist even though the site uses plain CSS: without it,
// Next's PostCSS config lookup walks UP the repo and finds creed-app's
// root postcss.config.mjs (Tailwind 4), whose plugin isn't installed
// here — which breaks the Vercel build (root directory = website/).
const config = {
  plugins: {
    autoprefixer: {},
  },
};

export default config;
