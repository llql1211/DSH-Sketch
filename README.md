# dsh-aisketch

给 [DSH](https://github.com/deepseek-ai/deepseek-harness)（DeepSeek Harness）加一条「**模型只给结构，客户端负责作图**」的卡片通道。

**English TL;DR** — dsh-aisketch renders graphics from JSON written inline in the assistant's answer. The model supplies structure only; a deterministic engine owns geometry. Tables stay as ordinary Markdown in the prose. MIT, zero base changes.

本 fork 的用法（DSH 0.2.2）：

| 正文围栏 | 内容 | 用户看到什么 |
|---|---|---|
| ```aisketch | `{"kind":"flowchart"\|"draw"\|"figure", "payload":{...}}` | 就地渲染的流程图 / 手绘插画 / 教学示意图 |
| ```aisketch | `{"ref":"<show_card 结果里的 ref>"}` | 复用最近一次 `show_card` 的规格，正文不必再抄一遍 JSON |
| ```aisketch-plot | `{"expr":"x^2", ...}` | 可交互函数图像：六种模式、参数滑块、追踪读数 |

表格直接写成 Markdown，不再交给插件。`show_card` / `sketch_function` 工具保留为私有的规格校验与预览通道，公开图片一律由正文围栏渲染，所以图片正好落在解说文字之间，不会堆在回答末尾，也不会被工作步骤折叠隐藏。画图时可以只写 `{"ref":...}`：工具结果会回显一个 ref，客户端从持久化的 `tool/call` 参数里取回同一份规格，省掉正文里重复的长 JSON；直写完整 spec 的围栏仍然支持。

![license](https://img.shields.io/badge/license-MIT-blue)
![CI](https://github.com/QinLuza/dsh-aisketch/actions/workflows/ci.yml/badge.svg)
![tests](https://img.shields.io/badge/tests-552%20passed-brightgreen)
![dsh](https://img.shields.io/badge/dsh-0.2.2--rc.3-111)

**零 base 改动**：全部走官方扩展点（`conversation.chat.markdown.fence` 围栏层、tool 注册），没有一行改动 `@deepseek-ai/dsh-*`。

![手绘插画卡](docs/assets/screenshots/draw-illustration.png)

---

## 一、它补的是哪一块

模型想把一件事讲清楚时，手上常常只有文字。于是它写 Markdown 表格、画 ASCII 图，或者更糟——生成一段 HTML/SVG 让你渲染。前两者难看且难读，后者是在执行模型生成的代码，还不可回放。

`dsh-aisketch` 换了一条路：**模型只交结构，几何由确定性引擎算**。

```jsonc
// show_card：模型只给节点和连线，位置/换行/箭头锚点由客户端算
{
  "kind": "flowchart",
  "payload": {
    "nodes": [
      { "id": "check", "label": "n 是偶数？", "shape": "decision" },
      { "id": "even",  "label": "输出 n/2",   "shape": "process"  }
    ],
    "edges": [{ "from": "check", "to": "even", "label": "是" }]
  }
}
```

同一份 payload 必然画出同一张图；回放一个旧会话，卡片一模一样，不需要 Host 再参与。

### 与 DSH 本体的关系

| | DSH 本体已有 | 本插件补的 |
|---|---|---|
| 卡片怎么来 | 每个内置工具自己的卡片模型（read / grep / diff / terminal / web / image …），渲染器写死在客户端 | **一条通用通道**：模型自选内容，`kind` 决定用哪个渲染器；加一种卡片 = 注册一个组件 |
| 交付物 | `present`：把**已有文件**声明为最终交付物，只记路径不搬内容 | 把**结构化内容本身**交付到会话里，不需要先落盘 |
| 图表/流程图 | 官方工具目录里没有通用绘图、图表、流程图工具 | 表格、流程图、手绘、教学示意图、六种函数图 |
| 可见性 | 工具调用属于「回合过程」，会被工作步骤展示模式折叠 | 卡片同时挂 `turnTail` 产出物槽位（详见「已知限制」） |

---

## 二、现在能画什么

### 1. `show_card` → `table`

`columns` + `rows`，1..12 列、≤500 行；表头吸顶、数字右对齐等宽、`null` 显示 `--`、超宽横向滚动。

![物理量表](docs/assets/screenshots/table-physics.png)

### 2. `show_card` → `flowchart`

1..40 节点、≤80 连线，`shape` ∈ `terminal` / `process` / `decision`。分层布局、分支标签、回边绕右侧 gutter、共享端点自动扇开。点卡片右上角可放大显示。

![奇偶判断流程图](docs/assets/screenshots/flowchart-parity.png)

### 3. `show_card` → `draw`

手绘卡：模型只写中心线、形状、文字、胶带或像素网格；钢笔出锋、书法笔角度、荧光笔半透明、铅笔颗粒、手绘抖动全部由引擎算。`show_card(draw)` 只做私有预览：工具结果带图、自检和 `ref`；模型随后在正文写 `{"ref":"..."}` 围栏发布，用户只看到这张公开卡片。`draw` 工具调用本身（无论是否带 `draft`）都不会再渲染成卡片，所以不会重影。

![山湖小屋手绘插画](docs/assets/screenshots/draw-illustration.png)

#### 0.3 起：光与墨也是字段

| 字段 | 用在 | 解决什么 |
|---|---|---|
| `background` | 载荷级 | 画布底色（夜色、牛皮纸），不必拿一个整幅矩形元素伪造 |
| `strokeOpacity` | `path` / `shape` | 同一支笔的浓淡：远处更淡、压住的辅助线；不用换浅色，也不改笔型 |
| `dash` | `path` | 自由曲线画虚线（被挡的棱、轨迹）；此前只有 `shape` 有 |
| `fill` 渐变 | `path` / `shape` | `linear` / `radial` + 2..8 个色标（CSS 角度、`from`/`to` 简写）；一条字段替代 8–12 条色带 |
| `blend` | `path` / `shape` / `pixels` | `normal` / `multiply` / `screen` / `overlay` / `soft-light`：光叠在物体上 |
| `blur` | `path` / `shape` | 光柱、光晕、雾、景深；`blur` 是可见扩散半径，两端都按 σ = blur/2 计算 |

渐变和模糊都按**元素自身的包围盒**解析几何，模型不给坐标，所以「同一份载荷必然同一张图」对它们同样成立；光栅预览逐像素采样，模型看到的预览和卡片一致。

<p>
  <img src="docs/assets/screenshots/draw-dashed-prism.png" width="49%" alt="虚线隐藏棱的三棱柱" />
  <img src="docs/assets/screenshots/draw-gradient-dusk.png" width="49%" alt="渐变天空与径向光晕的黄昏海景" />
</p>
<p>
  <img src="docs/assets/screenshots/draw-light-blur.png" width="49%" alt="screen 光柱 + multiply 暗部 + blur 柔边" />
  <img src="docs/assets/screenshots/draw-scene-snapshot.png" width="49%" alt="位图快照渲染的山中小屋" />
</p>

**渲染是一次性的**：卡片先离屏栅格化成位图再上屏，滚动与放大不再重栅格化。同一张 340 条 `path` 的卡实测：首次滚动从中位 41ms / 单帧 407ms 回到 17ms，放大从 539ms 卡顿降到约 97ms。

**显示尺寸**：`draw` 与 `figure` 图片保持画布比例、居中显示，宽高分别封顶 760px / 456px，且不会被放大到超过画布原尺寸。这样既不会在框内出现纵向滚动，也不会让一张图撑满会话栏、把正文挤出视野；需要看细节时点卡片右上角 ⤢，放大层会放宽到 1200px / 86vh。

### 4. `show_card` → `figure`

教学示意图不塞进 `draw`：前者怕错，后者怕平庸。`figure` 只接受模板与语义参数，坐标、角度、锚点、标签位置全部由渲染器构造。

| 模板 | 模型填什么 | 渲染器保证什么 |
|---|---|---|
| `incline_force` | 角度、质量、摩擦系数、可选 g/分量/数值 | 物块置于斜面；G 竖直、N 垂直斜面、f 沿斜面向上；力的大小由 m/g/θ/μ 计算 |
| `connected_bodies` | 桌面质量、悬挂质量、摩擦系数、可选 g/数值 | 桌面块经定滑轮连悬挂块；T/N/G/f 锚在对应块面上；T 不伪造数值 |
| `orbital_diagram` | 元素符号（H–Zn） | 由参考表推导电子排布与各亚层电子数；按洪特规则画轨道框、↑↓ 与电子排布式 |
| `atom_shell` | 元素符号（H–Ca） | Z 和电子层数从内置参考表推导；电子均匀落位、核标 +Z、K/L/M… 图例 |

<p>
  <img src="docs/assets/screenshots/figure-incline-30.png" width="49%" alt="斜面受力" />
  <img src="docs/assets/screenshots/figure-connected-table-pulley.png" width="49%" alt="桌面连接体" />
</p>
<p>
  <img src="docs/assets/screenshots/figure-orbital-zn.png" width="49%" alt="Zn 电子排布轨道图" />
  <img src="docs/assets/screenshots/figure-atom-na.png" width="49%" alt="Na 原子壳层" />
</p>

### 5. `sketch_function` → 六种模式

| 模式 | 画什么 |
|---|---|
| `plain` | 单曲线，y 轴按表达式自适应 |
| `compare` | 多曲线对比（共享窗口，各自独立采样） |
| `tangent` | 指定点的切线（数值微分） |
| `riemann` | n 个矩形逼近定积分 |
| `taylor` | 泰勒展开到 n 阶（展开点可选） |
| `data` | 折线 / 柱状 / 散点 / 饼图 |

<p>
  <img src="docs/assets/screenshots/sketch-single.png" width="49%" alt="单曲线" />
  <img src="docs/assets/screenshots/sketch-compare.png" width="49%" alt="曲线对比" />
</p>
<p>
  <img src="docs/assets/screenshots/sketch-tangent.png" width="49%" alt="切线" />
  <img src="docs/assets/screenshots/sketch-riemann.png" width="49%" alt="黎曼和" />
</p>
<p>
  <img src="docs/assets/screenshots/sketch-taylor.png" width="49%" alt="泰勒展开" />
  <img src="docs/assets/screenshots/sketch-data.png" width="49%" alt="数据图表" />
</p>

带 `params` 时出参数滑块；拖拽期间 y 窗口冻结，另有追踪读数（悬停、点按钉住、键盘步进）。交互态全部在组件本地，不写回 spec、不发 Host 调用。

---

## 三、三条设计边界

1. **不执行模型生成的代码。** 没有 `eval`、没有 `new Function`、不把生成的 HTML/SVG 字符串塞进 DOM。`draw` 的路径串只经过自己的迷你语法解析器；未知命令、空路径、指数记法一律拒绝，错误带 `element N:` 前缀，模型可以自己改。
2. **几何是载荷的纯函数。** 流程图分层、换行、箭头锚点、扇开偏移，函数图采样、视窗、数值微分/积分，全部由确定性引擎算。同一 spec 必然同一张图，因此回放等价，也能在 vitest 里断言，不需要 DOM。
3. **校验在 Host 就做。** 列数/行数、节点数/连线数、id 唯一、`shape` 取值、每条连线必须指向已声明节点；不做「画出来少一条边」这种事。报错让模型自己改。

---

## 四、安装

### 方式一：link 安装（本 fork 已在 DSH 0.2.2-rc.3 桌面端验证）

```bash
# 本 fork 的 dev 分支已把依赖与兼容性声明对齐 0.2.2
git clone https://github.com/QinLuza/dsh-aisketch.git
cd dsh-aisketch
git checkout dev

# 构建两个浏览器半边（客户端模块系统读 lib/client.js 原样下发）
pnpm install
pnpm build:client

# 装进 profile
dsh plugin --profile <profile> add link:<repo>/packages/sketch-bundle
```

桌面端（Electron）的 `desktop` profile 请用应用自己的**插件面板**，安装来源填 `packages/sketch-bundle` 的绝对路径；或通过内置 `plugin_manager` 的 `install_bundle` 安装同一路径。

### 方式二：从 Git 仓库安装

在插件面板里填本仓库地址，或使用插件市场支持的 Git 安装语法；包目录是 `packages/sketch-bundle`。本仓库没有发布 npm 包，`@aisketch/*` 只是公开作用域名，不依赖 npm 在线安装。

### 兼容性

`packages/sketch-bundle/package.json` 已声明：

```json
{ "engines": { "dsh": ">=0.2.2-rc.3 <0.3.0" } }
```

本 fork 已在 `0.2.2-rc.3` 桌面端实测：四个插件行 active，`show_card(table)` 与 `sketch_function` 调用成功，539 个测试与类型检查通过。上游 v0.3.0 仍只声明 `>=0.1.7-rc.2 <0.2.0`，在 0.2.x 上会被安装器拒绝；本 fork 的 `dev` 分支修正了这一点。DSH 升级到 0.3 之前请重新核对这个范围。

**改完 Host 半（`cards-core` / `cards-tool` / `sketch-core` / `sketch-tool`）必须重启应用；改完 client 半必须重新构建 `lib/client.js` 并重启。** 运行中重建 client 产物会让整批插件加载失败。

---

## 五、架构

七个包，全部 `@aisketch/*`，**base 仓一行未改**：

| 包 | 职责 |
|---|---|
| `packages/cards-core` | 卡片契约内核：版本化 `CardSpec`、限额校验、`table`/`flowchart`/`draw`/`figure` 载荷解析、`draw` 几何引擎与自检。零依赖 |
| `packages/cards-tool` | Host 工具 `show_card`：schema、拒绝原因、摘要、`draw` 离屏预览与回读 |
| `packages/client-ui-cards` | 浏览器半边：`card` 聊天节点 + `turnTail` 产出物面；`CardView` 按 `spec.kind` 经 registry 派发 |
| `packages/sketch-core` | 纯函数内核：自写 Pratt 表达式解析器、参数摘要、几何采样。零依赖 |
| `packages/sketch-tool` | Host 工具 `sketch_function`：schema、校验、摘要、`presentationMeta` |
| `packages/client-ui-sketch` | 浏览器半边：`tool.call.toolview` 过程行 + `turnTail` 产出物卡，同一 `SketchFigure` |
| `packages/sketch-bundle` | 装配包：`dsh.bundle.patch` → `cordis.patch.yml`（4 行 insert） |

### 两张脸

| 面 | 槽位 | 何时可见 |
|---|---|---|
| 过程行 | `tool.call.toolview`（key = 工具名） | 回合进行中、折叠区打开时实时出图 |
| 产出物 | `conversation.chat.turnTail` | 回合结束后常驻；数据源是持久化事件，回放等价 |

只挂 `toolview` 的卡片会在回合结束后被「回合过程折叠」藏掉；`turnTail` 是 base 留给产出物的槽位。两条通道都同时挂两张脸。

---

## 六、质量与验收

- **539 例**单元/集成测试（cards-core 194 / client-ui-cards 170 / sketch-core 58 / cards-tool 52 / client-ui-sketch 37 / sketch-tool 28），六个包 `tsc --noEmit` 全清。
- 真机验收不是「没报错」：函数图 canvas 像素回读（曲线/坐标轴非零）；流程图截图读到胶囊起点、菱形判断、是/否分支与汇合箭头；电子排布图逐项核对轨道数、电子数与洪特规则；渐变/模糊读渲染后的 DOM（`linearGradient` 停点、`stroke-dasharray`、`filter`）而不是只看截图。
- 回归钉：wiring 闸门（少注册一张脸即红）、`turnTail` 发布键必须等于 Definition 的 kind、draw 的 draft/final 过滤、虚线只能落在描边型笔上、渐变角度按 CSS 约定。

```bash
pnpm test          # 539 passed
pnpm typecheck     # 六个包全清
pnpm build:client  # 两个 lib/client.js
```

---

## 七、已知限制（照实说）

- **公开卡片只来自正文围栏。** 把 spec 或 `{"ref":...}` 写进 ` ```aisketch ` 围栏，图片就落在解说文字之间；工作步骤的四档展示设置不会影响它。`show_card` 调用是私有预览/校验通道，不再向对话投影可见卡片，所以也不存在「过程行 + 产出物行」看到同一张卡两次的问题。
- **`ref` 围栏取不到图？** 说明对应的 `tool/call` 事件已经不在当前加载窗口（例如老会话翻页）。改在围栏里直写完整 spec 即可；完整 spec 始终随正文一起持久化。
- **「轨迹」页看不到卡片**：卡片的 view target 是 `chat`，轨迹页按设计只显示原始调用。
- `figure` 目前只有四个模板，不是通用约束求解器；标签位置固定，不做自动避让。
- `orbital_diagram` 支持 H–Zn，`atom_shell` 支持 H–Ca；超出范围会直接报错，不会猜。
- `draw` 是确定性矢量手绘，不是像素级绘画模型；`show_card(draw)` 永远是私有预览，公开图片只来自正文围栏。`ref` 围栏依赖对应 `tool/call` 事件仍在加载窗口内；老会话翻页后可能取不到，这时直写完整 spec 的围栏更稳。
- **`draw` 卡片是一张位图快照**：图里的文字不可选中；每张 1200×800 的卡约占 8.6MB 显存（缓存上限 6 张）；首次上屏有约 100–300ms 的占位。换来的是滚动与放大不再重栅格化。
- 模糊、混合模式、渐变都受绘制部件数量影响：三四百条 `path` 的卡仍会比几十条的慢一档，提示词里建议把大色块合并、少用重复罩染。
- Host 半与 client 半的改动都需要重启应用才生效（无 HMR）。运行中不要重建 client 产物。

---

## 八、参与贡献

- 注册你自己的卡片 `kind`：一个载荷解析器 + 一个渲染器 + 一组测试；
- 用出问题请带 `show_card` 的原始参数开 issue；
- 如果它帮你省掉了一坨 ASCII 图，欢迎 star。

---

## License

MIT © 2026 QinLuza. 见 [LICENSE](LICENSE)。
