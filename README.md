# 幸福工厂产线计算器

**简体中文** | [English](README.en.md)

可离线使用的中英双语产线规划工具。此仓库包包含可直接发布的 `index.html`、可读源代码、完整内置数据及构建脚本。

**上传到 GitHub 后无需安装依赖或构建，直接发布根目录即可。**

## 上传到你的仓库

目标仓库：<https://github.com/seanz298/satisfactory-calculator>

1. 解压 `satisfactory-calculator-github.zip`。
2. 打开解压得到的 `satisfactory-calculator-github` 文件夹。
3. 在仓库选择 **Add file → Upload files**，将此文件夹里面的文件与目录一起拖入上传区域，并提交。
4. 确认仓库根目录直接有 `index.html` 和 `README.md`，不要再套一层 `satisfactory-calculator-github` 目录。
5. `.nojekyll` 等点号开头的文件可能被系统隐藏；使用普通分支发布本项目时，它不是运行所必需的。

个人 JSON 方案不在此压缩包内。更新网站不会自动把你本地保存的方案上传到 GitHub。

## 开启 GitHub Pages

1. 进入仓库 **Settings → Pages**。
2. **Build and deployment → Source** 选择 **Deploy from a branch**。
3. **Branch** 选择 `main`，文件夹选择 **/ (root)**，点击 **Save**。
4. 等待 GitHub 部署完成，在 Pages 设置页打开实际生成的网址。

预期网址：<https://seanz298.github.io/satisfactory-calculator/>。

免费 GitHub 账号通常需要将仓库设为公开才能使用 Pages。私有仓库能否启用 Pages 取决于账号套餐。修改仓库可见性会公开仓库内容，请在仓库设置中自行决定。

官方说明：

- <https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site>
- <https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages>

## 打开与保存

- **离线使用**：在较新的 Chrome、Edge 或 Firefox 中直接打开 `index.html`。
- **网页使用**：通过 GitHub Pages 网址打开。
- **配置备份**：使用页面上的“导出配置”，保存 JSON；使用“导入配置”恢复。
- **本地版迁移到网页**：先在原页面导出 JSON，再在网页导入。浏览器不会自动跨网址迁移 localStorage。
- 方案存储在当前浏览器中。不同浏览器、不同设备及不同网址拥有各自的数据；清除站点数据会清除本地保存。

**当前是单人／离线版本，尚未包含双人实时同步、账号或云端保存。** 仅发布到 GitHub Pages 不会自动获得协作功能。

## 已有功能

- 外部供给、资源点采集、产量反推和单输入约束。
- 默认／替代配方、锁定产量、多张独立发电量目标卡片。
- 发电燃料、水、核废料与后续工序统一配平。
- 机器清单按连接图的上游到下游顺序排列，循环工序归组。
- 显示本组输入材料、每分钟需求、输出与末台产量。
- 全局及同类机器频率、索莫晶体、机器数和耗电统计。
- 未开启超频时隐藏同类频率编辑，并限制实际频率不超过 100%；原设置保留供重新启用。
- 产线卡片画布、网络图、树状图、全屏、SVG 导出。
- 太空电梯与 HUB 需求、火车运力、地图与建设进度。
- 耗电／发电／阶段需求／配方消耗倍率设置。
- 中文与 English 切换；JSON 方案导入导出。

配方与地图采用此版本内置的数据快照；不承诺与未来游戏更新自动保持一致。具体游戏版本见页面的数据说明。

## 源代码目录

| 路径 | 用途 |
| --- | --- |
| `README.md` / `README.en.md` | 中文与英文使用说明 |
| `index.html` | 已构建的完整网页，也是离线单文件版，可直接发布 |
| `src/template.html` | 页面结构与构建插入点 |
| `src/styles.css` | 全部界面样式，按原样式顺序合并 |
| `src/solver.js` | 线性规划求解器 |
| `src/app.js` | 配平、机器、发电、地图、图鉴、阶段、火车、配置与中英界面逻辑 |
| `src/bootstrap.js` | 解压内置数据并启动页面 |
| `data/data.json` | 物品、建筑和配方数据 |
| `data/icons.json` | 内嵌物品图标 |
| `data/map.json` | 地图点位数据 |
| `data/terrain.json` | 地图底图数据 |
| `data/translations.json` | 界面英文翻译 |
| `scripts/build.py` | 仅用 Python 标准库，重新生成根目录 `index.html` |
| `.nojekyll` | 静态发布标识 |

`src/app.js` 已格式化以便编辑，目前仍为单个脚本，按原程序顺序保留全局函数；尚未拆成 ES Modules。数据中的内嵌图像是发布资源，不是加密代码。

## 修改后重新构建

需要 Python 3.8 或更新版本，不需要 npm 或第三方 Python 库。

Windows：

```powershell
py -3 scripts/build.py
```

macOS / Linux：

```bash
python3 scripts/build.py
```

然后打开生成的 `index.html` 检查，并提交到 GitHub。Pages 会发布新的根目录文件。

**只修改 `src/` 或 `data/` 而没有重新生成 `index.html`，网页不会更新。** 直接编辑生成后的 `index.html` 也会在下次构建时被覆盖。

本地 HTTP 预览（可选）：

```bash
python3 -m http.server 8000
```

浏览器打开 <http://localhost:8000>。

## 发布 Release（可选）

在仓库选择 **Releases → Draft a new release**，填写版本标签和说明，再附加整个源码 ZIP 或构建后的 `index.html`。Release 不会自动开启 GitHub Pages。

## 数据与许可说明

本工具不是 Coffee Stain Studios 的官方产品。Satisfactory 名称、图标、地图及游戏相关数据的权利归相应权利人所有。

此压缩包未为全部内容擅自指定统一的 MIT 或其他开源许可证。公开上传不等于授予开源许可；如需对外采用开源许可证，应由仓库所有者确认自有代码授权，并另外处理游戏资源及第三方内容的权利范围。
