# Deploying NEUROFORM

`npm run build` produces `dist/`: static files only. No server-side code, no
environment variables, no backend. The build uses relative URLs (`base: './'`),
so it works at a domain root or in a sub-path.

Requirements for the host: serve `.wasm` as `application/wasm` (all hosts below
do by default; NEUROFORM also falls back to a non-streaming load if the type is
wrong) and serve `sw.js` from the same directory as `index.html`.

## Vercel

Import the repository with root directory `neuroform`. `vercel.json` sets
everything else: the build command, output directory `dist`, and cache headers.
The build command first runs `scripts/ensure-rust.sh`, which adds the
`wasm32-unknown-unknown` target to an existing Rust toolchain, or installs a
minimal stable toolchain if `cargo` is missing. Vercel's build image currently
includes Rust (cargo 1.92 in November 2026), so only the target is added there,
and a full build takes about 35 seconds. A prebuilt `dist/` can also be deployed
directly with `vercel deploy dist`.

New Vercel projects protect every generated `*.vercel.app` address with Vercel
Authentication by default. To make the production site public while keeping
preview deployments protected, add a project domain (Settings → Domains), for
example `<project>-<account>.vercel.app`: project domains are exempt from the
default protection.

## Netlify

`netlify.toml` is included (`base = "neuroform"`, `publish = "dist"`). Its build
command runs `scripts/ensure-rust.sh` first, as on Vercel (not yet tried on
Netlify). A prebuilt `dist/` can
also be deployed with `netlify deploy --dir dist --prod`.

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
