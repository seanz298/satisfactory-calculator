# Satisfactory Production Calculator

**English** | [简体中文](README.zh-CN.md)

A bilingual (English / Chinese) production planner for **Satisfactory 1.2**. Plan production chains from the resources you have or the products you want, and get machine counts, clock speeds, material flows, power and byproducts — then inspect the whole factory as an interactive graph.

- **Use it online:** <https://seanz298.github.io/satisfactory-calculator/>
- **Use it offline:** download `satisfactory-calculator.html` from [Releases](https://github.com/seanz298/satisfactory-calculator/releases) and open it in Chrome, Edge or Firefox.

It is a single static web page: no backend, no account, no installation. Plans are saved in your browser.

## Features

| Area | What you can do |
| --- | --- |
| Production planning | Plan forward from supplies, reverse-plan from target products, or limit output by one input; lock targets and pick alternate recipes |
| Optimal recipes | In reverse mode, compare every recipe for every item and switch to the best mix for least raw resources, fewest machines, least power, or least of chosen resources; a one-click oil / aluminum preset is kept |
| Factory layout | Axure-style canvas: place machines at their real footprint, grid snapping and smart guides, rulers, align / distribute, groups, layers, floors, notes and links, PNG / SVG export |
| Supply checklist | Copy the external supply / reverse demand list as text, or download it as CSV |
| Machines and clocks | Machines sorted by milestone unlock (or flow order), per-machine clocks, Somersloops, Power Shards, and a one-click “fill last machines” that rounds every last machine up to full clock |
| Byproducts and fluids | Send leftovers to the AWESOME Sink (sinks, power and points are counted), set them as products, or add a downstream product; fluids are packaged into solids; recycle loops show circulation and the cheapest priming point |
| Power | Several independent power targets, fuel, water, generation and nuclear-waste chains in one balance |
| Production graph | Network, tree and card-canvas views with zoom, fullscreen, SVG export and manual material links drawn between ports |
| Sink-point optimizer | Maximize AWESOME Sink points across the whole map with the bundled HiGHS solver, limited to your unlocked alternate recipes |
| World and logistics | Interactive resource map, extractors, train throughput and belt / pipe capacity checks |
| Construction and progress | Building materials, built-machine tracking, Space Elevator and HUB milestone requirements |
| Plans | Save button and Ctrl+S, saved / unsaved indicator, several planner pages open at once (optional), export one plan or all plans as JSON, import and merge |
| Custom rules | Multipliers for power use, generation, progression costs and recipe inputs |

## Quick start

1. Open the [online version](https://seanz298.github.io/satisfactory-calculator/), or open `index.html` from this repository in a recent browser.
2. Add external supplies or resource nodes, or switch the mode to **Reverse: calculate inputs and machines**.
3. Add final products, choose recipes and set target rates.
4. Check machines, power and byproducts, then open **Flow and diagrams** to inspect connections.
5. Press **Save** (Ctrl+S / ⌘S). Use **Export → Export all plans** for a backup.

To serve the page locally instead of opening the file:

```bash
python3 -m http.server 8000
```

Then visit <http://localhost:8000>.

## Saving, exporting and importing

- Plans are saved automatically to `localStorage` in the current browser; nothing is uploaded. The header shows whether the current plan is saved.
- **Export → Export current plan** writes one plan as `Plan name.json`. **Export all plans** writes every saved plan, the current draft and the existing-factory baseline into one file.
- **Import and merge** accepts one or more JSON files and appends their plans; name collisions get a numbered suffix. An invalid file cancels the whole batch.
- The online page, the offline file and each browser keep separate storage. Export and import to move plans between them.
- Clearing site data deletes saved plans, so keep exported backups of important ones.
- There are no accounts, cloud saves or real-time collaboration.

## Optimizers

**Optimize all recipes** (reverse mode, section 05): pick a target — least raw resources (weighted by whole-map availability), fewest machines, least power, or least of chosen resources — and every recipe for every item is solved together. Ties are broken by the other cost (machines for the raw target, raw resources otherwise). Alternates follow the unlocked list in Settings; if none is set, all alternates are used. The new recipes are applied to the current plan and can be undone.

**Checklist** (section 04): copies the external materials (raw resources first) with demand, current supply and difference, plus the products, machine count and power; or downloads the same as a CSV that opens in Excel.

**Optimal oil / aluminum recipes** (reverse mode, section 05): solves all oil recipes (plastic, rubber, polymer resin, heavy oil residue, fuel, petroleum coke, turbofuel) and aluminum recipes (alumina, scrap, ingot, sheet, casing, silica) together. It first minimizes crude oil and bauxite, then the other raw resources weighted by whole-map availability. If unlocked alternates are set in Settings, only those are used. The result can be undone.

**Sink-point optimization** (Settings): maximizes sink points for the whole map. You choose the map purity, clock, Somersloop budget, reserved power, time limit and Alien Power Augmenter policy, and can cap raw extraction with the current plan's supplies. It runs the bundled HiGHS WebAssembly solver in a cancellable Web Worker, with no server or network needed. The model uses fixed clocks with integer machine rounding and tail underclocking, so results are optimal for that model, not for continuous clock speeds. The result is previewed first and then saved as a new editable plan.

## Project structure

| Path | Description |
| --- | --- |
| `index.html` | Generated single-file page for hosting or offline use |
| `src/template.html` | Page structure and build insertion points |
| `src/styles.css` | Styles |
| `src/app.js` | Planning, machines, power, graph, map, progression, logistics and plan management |
| `src/solver.js` | Linear-programming solver used by the planner |
| `src/plan-files.js` | Plan file export, import and merging |
| `src/optimizer-core.js`, `src/optimizer-ui.js` | Sink-point optimizer model and interface |
| `src/bootstrap.js` | Bundled data decompression and startup |
| `data/` | Recipes, items, icons, map data, optimizer tables and translations |
| `vendor/highs/` | Pinned HiGHS-JS WebAssembly solver |
| `scripts/build.py`, `scripts/package.py` | Build the page; package clean sources into `dist/` |
| `tests/` | Calculation and file-handling tests |

The code is plain JavaScript, HTML and CSS with no framework.

## Development

Building needs **Python 3.8+** and only the standard library:

```bash
python3 scripts/build.py      # Windows: py -3 scripts/build.py
```

After editing `src/` or `data/`, rebuild and commit the generated `index.html`; direct edits to `index.html` are overwritten.

Tests need **Node.js 18+** and no npm install:

```bash
for t in tests/*.cjs; do node "$t"; done
```

## GitHub Pages

In **Settings → Pages**, choose **Deploy from a branch**, then select `main` and **/ (root)**. `index.html` must stay in the repository root.

## Limitations

- Game data is a bundled snapshot of version 1.2.3.1 and is not updated automatically.
- Results are steady-state material balances. Startup time, pipe filling and other transient behavior are not simulated.
- When an optimal solution mixes two recipes for one item, only the dominant recipe is applied, so the result can be slightly above the true optimum.

## Feedback

Report bugs and ideas in [Issues](https://github.com/seanz298/satisfactory-calculator/issues). For calculation problems, include the steps to reproduce, the expected result and an exported plan JSON; screenshots help for interface issues.

## Licensing and acknowledgments

This project is not affiliated with Coffee Stain Studios. The Satisfactory name, icons, maps and related assets belong to their owners.

No blanket open-source license has been chosen yet; a public repository does not grant redistribution rights for all content. Third-party components and their licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
