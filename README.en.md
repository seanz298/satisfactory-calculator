# Satisfactory Production Calculator

[简体中文](README.md) | **English**

A bilingual production planner that works offline. This package includes a ready-to-publish `index.html`, readable source code, all bundled data, and a build script.

**No installation or build is required to publish the included version. Upload the files and publish the repository root.**

## Upload to GitHub

Repository: <https://github.com/seanz298/satisfactory-calculator>

1. Extract `satisfactory-calculator-github.zip`.
2. Open the extracted `satisfactory-calculator-github` folder.
3. In the repository, select **Add file → Upload files**. Upload the files and directories inside that folder, then commit.
4. Make sure `index.html` and `README.md` are directly in the repository root. Do not place them inside another `satisfactory-calculator-github` directory.
5. Your file manager may hide dotfiles such as `.nojekyll`. This project does not require that file to run when published from a branch.

The package does not include personal JSON plans. Updating the website does not upload plans stored in your browser to GitHub.

## Enable GitHub Pages

1. Open the repository's **Settings → Pages**.
2. Under **Build and deployment → Source**, select **Deploy from a branch**.
3. Select the `main` branch and **/ (root)** folder, then click **Save**.
4. Wait for deployment to finish and open the actual website URL shown in the Pages settings.

Expected URL: <https://seanz298.github.io/satisfactory-calculator/>.

GitHub Free generally requires a public repository for Pages. Pages availability for private repositories depends on your account plan. Changing repository visibility exposes its contents; choose the visibility in your repository settings.

Official documentation:

- <https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site>
- <https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages>

## Open the calculator and save plans

- **Offline:** open `index.html` directly in a recent version of Chrome, Edge, or Firefox.
- **Online:** open the GitHub Pages website.
- **Back up a plan:** use **Export config** to save a JSON file. Restore it with **Import config**.
- **Move from the local file to the website:** export your configuration from the old page and import it on the website. Browser localStorage does not migrate automatically between origins.
- Plans are stored in the current browser. Different browsers, devices, and website origins have separate storage. Clearing site data removes locally saved plans.

**This is currently a single-user, offline-capable version. It does not include two-person real-time synchronization, user accounts, or cloud saves.** Publishing it on GitHub Pages does not enable collaboration automatically.

## Features

- External supplies, resource extraction, reverse planning, and a single-input constraint mode.
- Standard and alternate recipes, locked production targets, and multiple independent electricity target cards.
- Integrated balancing of generator fuel, water, nuclear waste, and downstream processing.
- Machine lists ordered from upstream to downstream using the production graph, with recycling processes grouped together.
- Input materials, total input rates for each recipe group, outputs, and last-machine output rates.
- Global and machine-type clock settings, Somersloops, machine counts, and power consumption estimates.
- Machine-type clock controls are hidden when overclocking is disabled. Effective clocks are capped at 100%, while custom settings are retained for later use.
- Recipe-card canvas, network and tree views, fullscreen mode, and SVG export.
- Space Elevator and HUB requirements, train capacity, an interactive map, and construction progress.
- Multipliers for power consumption, power generation, milestone requirements, and recipe input consumption.
- Chinese/English language switching and JSON configuration import/export.

Recipes and maps use the data snapshot bundled with this version. They do not automatically track future game updates. See the in-app data information for the included game version.

## Source files

| Path | Purpose |
| --- | --- |
| `README.md` / `README.en.md` | Chinese and English documentation |
| `index.html` | Complete, prebuilt website; also the standalone offline file |
| `src/template.html` | Page structure and build insertion points |
| `src/styles.css` | All interface styles, combined in their original order |
| `src/solver.js` | Linear programming solver |
| `src/app.js` | Production balancing, machines, power, map, catalog, milestones, trains, configurations, and language logic |
| `src/bootstrap.js` | Decompresses bundled data and starts the application |
| `data/data.json` | Item, building, and recipe data |
| `data/icons.json` | Embedded item icons |
| `data/map.json` | Map locations |
| `data/terrain.json` | Map background data |
| `data/translations.json` | English interface translations |
| `scripts/build.py` | Rebuilds the root `index.html` using only the Python standard library |
| `.nojekyll` | Static publishing marker |

`src/app.js` is formatted for editing but remains a single script with global functions in the original execution order. It has not been split into ES Modules. Embedded images in the data files are application assets, not encrypted source code.

## Rebuild after editing

Requires Python 3.8 or later. No npm packages or third-party Python packages are needed.

Windows:

```powershell
py -3 scripts/build.py
```

macOS / Linux:

```bash
python3 scripts/build.py
```

Open the generated `index.html`, check the result, and commit it to GitHub. Pages will publish the updated root file.

**Editing `src/` or `data/` without rebuilding `index.html` does not update the website.** Direct edits to the generated `index.html` are overwritten by the next build.

Optional local HTTP preview:

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000> in your browser.

## Publish a Release (optional)

In the repository, select **Releases → Draft a new release**. Add a version tag and release notes, then attach the source ZIP or the generated `index.html`. Creating a Release does not enable GitHub Pages automatically.

## Game assets and licensing

This tool is not an official Coffee Stain Studios product. The Satisfactory name, icons, maps, and game-related data belong to their respective rights holders.

This package does not assign a blanket MIT or other open-source license to all included content. Public availability is not itself an open-source license grant. Before adding an open-source license, the repository owner should confirm the license for their own code and separately account for game assets and third-party content.
