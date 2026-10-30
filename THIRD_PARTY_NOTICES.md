# Third-party components

## HiGHS / HiGHS-JS

- Native solver: https://github.com/ERGO-Code/HiGHS (MIT).
- WebAssembly adapter: https://github.com/lovasoa/highs-js (MIT).
- Pinned npm package: `highs@1.15.4` (registry tarball shasum `2ce13b7a543a564ab5449cae215736fdbd484a57`).
- Files: `vendor/highs/highs.js`, `vendor/highs/highs.wasm`, `vendor/highs/LICENSE`.
- The loader is unmodified. The Worker uses Emscripten's `instantiateWasm` hook to instantiate embedded bytes: this release's generated loader ignores the documented `wasmBinary` option. No network downloads are performed by the optimizer.

## SatisfactoryLP model reference

- https://github.com/0xjc/SatisfactoryLP (MIT).
- Snapshot commit: `2a4e3e134308a7d1cb0f3ff6b6968a0acf82281d`.
- Reference source: `tools/SatisfactoryLP.py`; license: `vendor/SatisfactoryLP-LICENSE`.
- The precompiled coefficient tables in `data/optimization.json` derive from the reference model, Coffee Stain's `Docs.json` (game 1.2.3.1), and Satisfactory Calculator map data (build 492064). Tables cover normal purity and all-pure extraction; geyser purity remains unchanged.
- `src/optimizer-core.js` adapts the model to browser-local mixed-integer optimization and the calculator's single-plan machine-group schema.
- The original game assets, names and recipe data remain the property of their respective owners. This is an unofficial planning tool.
