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
