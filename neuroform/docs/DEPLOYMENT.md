# Deploying NEUROFORM

`npm run build` produces `dist/`: static files only. No server-side code, no
environment variables, no backend. The build uses relative URLs (`base: './'`),
so it works at a domain root or in a sub-path.

Requirements for the host: serve `.wasm` as `application/wasm` (all hosts below
do by default; NEUROFORM also falls back to a non-streaming load if the type is
wrong) and serve `sw.js` from the same directory as `index.html`.

## Vercel

Framework preset *Other*, root directory `neuroform`, build command
`npm run build`, output directory `dist`. Rust must be available in the build
image; the simplest route is to build in CI and deploy `dist/` (`vercel deploy
dist --prebuilt` or the Vercel GitHub integration with a build step).
`vercel.json` sets cache headers.

## Netlify

`netlify.toml` is included (`base = "neuroform"`, `publish = "dist"`). Netlify's
build image does not include Rust: either add a Rust install step to the build
command or deploy a prebuilt `dist/` with `netlify deploy --dir dist --prod`.

## Cloudflare Pages

Build command `npm run build`, output `dist`, root `neuroform`, or upload a
prebuilt `dist/` with `wrangler pages deploy dist`. `public/_headers` (copied to
`dist/_headers`) sets caching for Netlify and Cloudflare Pages.

## GitHub Pages or any static server

Copy `dist/` to the web root (or a sub-path). For a quick local check:
`npm run preview`.

## Caching

Assets in `dist/assets/` have content hashes and can be cached forever.
`index.html` and `sw.js` should be revalidated (`no-cache`) so new deployments are
picked up; the service worker then replaces the old cache.

## Optional: cross-origin isolation

NEUROFORM does not need `SharedArrayBuffer`. If a host can send
`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`, the Settings dialog will report the
page as isolated; nothing else changes today.
