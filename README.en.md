# Satisfactory Production Calculator

[简体中文](README.md) | **English**

A bilingual production planner for **Satisfactory**. Calculate production chains, machine configurations, material flows, and power requirements from available resources or production targets, then inspect their dependencies in interactive diagrams.

A static web application with browser-local saves and a standalone offline build. No backend is required.

## Features

| Module | Capabilities |
| --- | --- |
| Production planning | Calculate output from available supplies or reverse-plan inputs from targets; supports single-input constraints, locked targets, and alternate recipes |
| Machine configuration | List processes in upstream-to-downstream order with group inputs, outputs, machine counts, and last-machine clock and output rates |
| Overclocking and amplification | Global and machine-type clocks, Somersloops, power consumption, and Power Shard requirements |
| Power planning | Multiple independent electricity targets with integrated fuel, water, generation, and nuclear waste processing calculations |
| Visualization | Recipe-card canvas, network and tree views, dragging, zooming, fullscreen mode, and SVG export |
| Resources and logistics | Map resource nodes, extraction equipment, train throughput, and logistics capacity checks |
| Construction and progression | Construction materials, built-machine tracking, Space Elevator requirements, and HUB milestone progress |
| Custom rules | Multipliers for power consumption, generation, progression requirements, and recipe input consumption |
| Configuration management | Chinese/English interface, saved plans, and JSON import/export |

## Quick start

Download or clone this repository, then open the root `index.html` in a recent version of Chrome, Edge, or Firefox. No dependencies need to be installed.

Alternatively, start a local HTTP server:

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000> in your browser.

### Basic workflow

1. Add external supplies or resource extraction nodes.
2. Add final products, select recipes, and set production targets.
3. Review material balances, machine configurations, power consumption, and byproducts.
4. Inspect upstream and downstream connections in the diagrams and adjust clocks or recipes as needed.
5. Export the JSON configuration to back up or transfer your plan.

Use reverse planning to calculate raw material requirements from targets. Use single-input constraint mode when only one resource should limit output.

## Saving and transferring plans

Plans are automatically saved to localStorage in the current browser. They are not automatically uploaded to a server.

- Export JSON to back up a plan or import it in another browser or device.
- Local files and hosted websites do not share browser storage automatically. Export and import to migrate between them.
- Clearing site data removes locally saved plans. Keep backups of important configurations.

**This version does not include user accounts, cloud saves, or two-person real-time collaboration.** Hosting it on GitHub Pages does not enable those features automatically.

## Source structure

| Path | Description |
| --- | --- |
| `index.html` | Complete generated webpage for hosting or offline use |
| `src/template.html` | Page structure and build insertion points |
| `src/styles.css` | Interface styles |
| `src/solver.js` | Linear programming solver |
| `src/app.js` | Production, machines, power, map, progression, logistics, and configuration logic |
| `src/bootstrap.js` | Bundled data decompression and application startup |
| `data/` | Recipes, items, icons, map data, and translations |
| `scripts/build.py` | Build script for the standalone webpage |

The source uses vanilla JavaScript, HTML, and CSS. `src/app.js` is formatted for editing but remains a single script; it has not yet been split into ES Modules.

## Development and build

Building requires **Python 3.8+** and uses only the standard library. No npm or third-party Python dependencies are required.

```bash
python3 scripts/build.py
```

On Windows:

```powershell
py -3 scripts/build.py
```

After editing `src/` or `data/`, rebuild and commit the generated `index.html`. Direct edits to `index.html` are overwritten by the next build.

## GitHub Pages

This project can be published directly as a static website. In **Settings → Pages**, choose **Deploy from a branch**, then select the `main` branch and **/ (root)** folder.

Ensure `index.html` is in the repository root. Pages availability for private repositories depends on the GitHub account plan. Check the repository's Pages settings for its actual website URL and deployment status.

## Current limitations

- The application uses a bundled game data snapshot and does not automatically fetch future game updates. The included data version is shown in the application.
- Production connections are generated from the calculated material flow. Manual connections cannot currently constrain which factory supplies another factory.
- Results represent steady-state material balances for the configured plan. They do not simulate startup times, pipe filling, or all transient behavior in the game.

## Feedback

Report bugs and suggestions through [Issues](https://github.com/seanz298/satisfactory-calculator/issues). For calculation problems, include reproduction steps, expected results, and a JSON configuration suitable for public sharing. Screenshots are useful for interface issues.

## Licensing and acknowledgments

This project is not an official Coffee Stain Studios product. The Satisfactory name, game icons, maps, and related assets belong to their respective rights holders.

This repository package does not yet specify a blanket open-source license. Public visibility does not imply identical redistribution rights for all content. Licensing for the code and game assets should be considered separately.

## Sink-point optimization and unlocked alternate recipes

Open **Settings → Unlocked alternate recipes** to search and select the recipes you own. Select all/clear are supported; initial selection is empty. Default recipes remain available. Selections constrain the optimizer, not manually configured production. Preferences persist with each plan and survive import/export, plan switching and undo/redo.

In the general settings page, choose normal or all-pure map resources, production clock, available Somersloops, reserved power, time limit and an Alien Power Augmenter policy. Optionally cap raw extraction using the current plan's raw supplies; unspecified resources still use map ceilings. Intermediate supplies are not treated as free resources. Preview the result and save it as one new editable machine-group plan.

Optimization uses the embedded, pinned HiGHS-JS WebAssembly solver inside a cancellable Web Worker. No server, Python installation or network access is required at runtime. Time-limited feasible results are distinguished from proven optima of the configured model. This is a fixed-clock MILP model with integer machine rounding and tail underclocking, not a globally optimal continuous-clock nonlinear model.

The model includes integer Somersloop allocation, extraction power, water recycling, alternate recipes, conversion, closed nuclear-waste processing and integer sink counts at 30 MW each. Augmenters use 10 Somersloops each; fueled units consume 5 Alien Power Matrices/min each. Sub-1% tail loads use capacity groups and the calculator's existing intermittent-duty logic.

Power uses averages. Reserve power for transport, extra pipeline pumps and load fluctuations. Optimization assumes standard 1× world input/power rules; the generated generation multiplier represents augmenter effects. Extraction and sink demand are recorded as extra load; geothermal and augmenter base power are recorded as explicit electricity supply. Do not add them twice. Optimization summaries are historical and need rerunning after manual changes.

Sources/licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). New source modules: `src/optimizer-core.js`, `src/optimizer-ui.js`, `data/optimization.json`, `vendor/highs/`.

Checks (Node.js 18+, no npm install): `node tests/optimizer.cjs`, `node tests/integration.cjs`, `node tests/scenarios.cjs`.

## Plan files and importing

- Export one plan at a time as `Plan name.json`; whole-workspace export is no longer available.
- The header exports the current draft. Each saved-plan row exports that saved snapshot.
- Import accepts multiple JSON files and appends their plans without replacing the active draft, existing plans or baseline. Name collisions receive a numbered suffix.
- Legacy workspace and version-12 state files are supported. Identical active/saved snapshots are deduplicated within a legacy file; differing unsaved drafts are preserved.
- An invalid file rejects the entire import batch before changes are committed.
- New format: `satisfactory-plan`, `configVersion: 1`, with name, kind, gameVersion, savedAt and state. The state version remains 12. Workspace persistence remains internal to the browser.

Static explanatory footnotes have been removed; units, controls, calculation status and errors remain. Existing calculation rules are unchanged.

`src/plan-files.js` owns file handling. Old preview builds and generated/failed test snapshots were removed. Tests now create inputs in memory. Runtime data, licenses and model reference source remain.

Run `node tests/plan-files.cjs`, `node tests/integration.cjs`, and `node tests/scenarios.cjs`. Build with `python3 scripts/build.py`; package clean sources with `python3 scripts/package.py` (output: `dist/`). Browser testing was unavailable in this environment.
