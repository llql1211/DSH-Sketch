<!--
维护规则：
- 本文件遵循 Keep a Changelog 1.1.0 与 Semantic Versioning 2.0.0。
- [未发布] 在最上面；已发布版本按新到旧排列，必须带日期（YYYY-MM-DD）。
- 只记录用户可见的改动，分组为 Added / Changed / Deprecated / Removed / Fixed / Security，只显示非空分组。
- 发布时：把 [未发布] 改为“[X.Y.Z] - 日期”，再在最上面新建空的 [未发布]，并补版本对比链接。
- 因严重 bug 撤下的版本标 [YANKED]，不要删掉条目。
- 版本号不带 v，git tag 带 v；compare 链接里的版本号与实际 tag 名逐字一致。
- fork 仓库（可选）：用 +fork.N 时，N 是构建元数据，不参与优先级比较；换上游基线时 N 重置为 1。
- fork 仓库（可选）：改动被上游收录后，原条目加删除线并注明收录版本、日期、PR 号；可加「上游收录情况」小节汇总。
- 本 fork 定位：自下一版起按独立演进采用 `A.B.C+upstream.X.Y.Z`（A.B.C 为本 fork 独立版本，X.Y.Z 为上游基线）；构建元数据不参与优先级比较，已发布 tag 不改写。
-->

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/lang/zh-CN/).

本文件按版本倒序记录本 fork 相对上游的用户可见改动。

## [未发布]

说明：新版本将命名为 0.1.0+upstream.0.3.0

## [0.3.0+fork.1] - 2026-11-26

基线：上游 **v0.3.0**（commit `370936c`）。`+fork.1` 是构建元数据，不参与版本优先级比较。

### Added

- 正文围栏内就地渲染图卡并支持 `ref` 复用：新增围栏卡片与图表组件、任意围栏图卡 JSON 渲染、`show_card` 结果回显 `ref`、状态型 `card-ref` Definition、清理旧 draft 提示
- 卡片与函数图支持 PNG 导出与一键复制：保存按钮、插图按比例居中、`data-card-export` 图片座位、右键复制图片、Clipboard API 复制当前画面
- 新增坐标轴等比显示开关，单比例尺扩短轴且不裁剪曲线
- 流程图支持 `TB` / `LR` 方向并在卡片中居中：方向校验、分向布局与回边、箭头衔接修正、放大视图保持原始像素尺寸
- 新增 `docs/FORK.md` fork 说明文档，README 增加一行 fork 导航

### Changed

- 设置 fork 元数据与版本标识：包名、作者、仓库/主页/issue 地址改为 llql1211/DSH-Sketch，各包版本统一为 `0.3.0+fork.1`，恢复 bundle 中英文 meta、CI 配置与 `.npmrc` 的 fork 设置
- 适配 DSH 0.2.2 的依赖与兼容性声明：对齐各包 engines 与依赖，移除 bundle 对 DSH 自带 cordis 的依赖声明
- 图形提示词切到围栏格式（`aisketch` / `aisketch-plot`）

### Removed

- `show_card` 不再接受 `table` 卡片，表格回归正文 Markdown（fork-only 产品取舍）

### Fixed

- 修复曲线对比与定义域端点的绘制缺口：按全部曲线拟合 y 轴、二分补入精确边界点
- 让围栏中的工具参数别名正确绘制对比曲线：围栏与工具元数据统一归一化，兼容 `curves` / `x_min` / `x_max` 与 `range` 写法
- 图表与卡片文字适配 DSH 主题：配色随明暗自适应、修正暗色文字发黑与字体回退到宋体
- 说明预览文字方块是宿主无字体栅格化下的占位符，发布卡片渲染真实字形

[未发布]: <https://github.com/llql1211/DSH-Sketch/compare/v0.3.0+fork.1...HEAD>
[0.3.0+fork.1]: <https://github.com/llql1211/DSH-Sketch/compare/v0.3.0...v0.3.0+fork.1>
