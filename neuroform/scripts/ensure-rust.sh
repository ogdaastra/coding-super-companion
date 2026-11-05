#!/bin/sh
# Makes sure Rust and its wasm32 target are available for `npm run build`.
# Hosted build images (Vercel, Netlify) do not include Rust; this installs a
# minimal stable toolchain into ~/.cargo when cargo is missing, and is a no-op
# (apart from adding the target) when Rust is already installed.
set -eu
export PATH="$HOME/.cargo/bin:$PATH"
if ! command -v cargo >/dev/null 2>&1; then
  echo "[rust] cargo not found; installing a minimal stable toolchain"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs |
    sh -s -- -y --no-modify-path --profile minimal --default-toolchain stable --target wasm32-unknown-unknown
else
  rustup target add wasm32-unknown-unknown >/dev/null 2>&1 || true
fi
cargo --version
