# t3-office (vendored)

The office scene from [felixgollnhuber/t3-office](https://github.com/felixgollnhuber/t3-office) at
`b14eb1c1f02933df071f62f32f79ed954dceadd8`, MIT (see `LICENSE`). Only `src/`, `index.html` and the npm
manifests are kept; the dev server, its SQLite reader and `public/` are not.

The Android SSH workflow builds it with `npm ci && npx vite build` into one `dist/index.html` and copies
that into the APK's assets. The app pushes thread snapshots in through `src/bridge.ts`.

Local changes: `src/bridge.ts` (new), `vite.config.ts` (rewritten), the bridge hooks in `src/t3source.ts`
and the render loop in `src/main.ts`, and a CSP that blocks all network access in `index.html`.
