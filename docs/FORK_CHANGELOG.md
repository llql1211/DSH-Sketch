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

### Added

- `sketch_function` 改为函数画布：1–8 条 `y=f(x)` 曲线共享窗口，支持显式 x/y 范围、逐曲线颜色/实线虚线/粗细/标签与图例、画布级参数滑块
- 画布新增可叠加的辅助层 `marks`：切线、面积、泰勒多项式、有限长竖线（`vline`，默认从 y=0 到 f(x)，可带数值标签）、数据点注释与文本注释，同一张图可同时画多个；工具摘要回报斜率、积分误差与展开系数
- `show_card` 新增 `chart` kind：折线/柱状/散点/饼图接受真实 `series` 与 `categories`，纯函数渲染并支持明暗主题

### Changed

- 曲线定义域直接用 x 窗口表达，不再为表达式定义域或隐式曲线 `f(x,y)=0` 增加语法；旧 `expr`/`compare`/`mode` 围栏由统一适配层升级为画布 spec
- 虚线只开放 `solid`/`dashed`/`dotted` 预设，避免模型写出人眼无法区分的任意虚线数组

### Removed

- 移除 `sketch_function` 的六种 mode 与写死示例数据的 `data` 模式；含 `data`/`dataset` 的旧围栏不再静默降级成函数线，而是明确返回空状态

### Fixed

- 修复对比曲线标签解析不一致：工具预检改用出图引擎同一个 `splitCurveLine`，带括号/运算符的标签或中文冒号标签不再被静默丢弃，而是报出可操作的错误；摘要也不再列出没有采样点的曲线，并在参数说明中写明标签约束

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
