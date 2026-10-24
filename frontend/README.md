# Ingenium｜尽调证据工作台

Ingenium 面向 VC 尽调场景，将项目资料、财务指标、计算依据和报告编辑放在同一个工作区。用户可以从数字找到来源，也可以从来源回到报告，在保留证据和未解问题的前提下完成审核。

**Trusted diligence, powered by the world’s evidence.**

### 产品介绍首页与 Demo

网站根地址 `http://127.0.0.1:5173/` 展示 Ingenium landing page，内容包括 slogan、尽调痛点、三个工作区的真实预览、工作流程、目标用户、来源示例和联系入口。视觉主要参考 Keye，使用深海军蓝、蓝紫色原创立体 SVG 和本地 Manrope 字体。

所有 **Book a Demo / See the Platform** 按钮进入 `#/projects`；原有 `#/project/...` 深链接保持可用。平台中的 Ingenium 品牌链接可返回产品首页，不修改已有项目和报告。截图示例来自历史 Enfuce 工作区。

**Contact the team** 和方案询价使用用户指定的 `hello@ingenium.ai`，打开邮件草稿，不自动发送。可在 `frontend/.env` 设置 `VITE_CONTACT_EMAIL` 并重启 Vite 来更换公开联系邮箱。Demo 按钮进入平台，不代表完成预约；Team / Professional / Enterprise 展示订阅方案定位，没有在线付款或虚构价格。

首页入口在 `src/Site.tsx`，页面和样式分别为 `src/Landing.tsx`、`src/landing.css`；截图素材在 `public/images/`。设计与文案约定见 [`INGENIUM_LANDING.md`](INGENIUM_LANDING.md)。原 `acefire` 仓库名、API 配置和浏览器存储键保持兼容，不随展示品牌一起重命名。

`npm run test:landing` 验证 slogan、图片、标签交互、导航、联系草稿、Demo 跳转、移动端和减少动态效果偏好；需先启动 5173 开发服务。当前首页已通过 10 条浏览器流程，原有平台也通过 10 条回归流程；19 项单元测试通过。

产品由三个项目工作区和一个全局操作层组成：

| 工作区 | 用户的核心任务 |
| --- | --- |
| **Dashboard** | 看数据、核对口径、理解计算过程 |
| **Report** | 配置报告、阅读证据、人工修订、导出成果 |
| **Data room** | 管理资料、登记来源、查看文件 |
| **Contextual chat** | 围绕当前项目提问，跳转到对应证据或页面 |

当前版本支持 **Circle 的 C 后端报告与证据工作流**，并保留 Enfuce 历史快照交互。Circle 从 DuckDB 后端读取已保存的公司数据；新增文件上传处理和 Akta 获取暂留空，等待数据队友接入。实时研究、资料解析和团队后端的完成情况统一说明在[后端与接入边界](#backend)中。产品不提供投资评分或 Invest / Pass 结论。

## 目录

1. [运行项目](#start)
2. [网页信息架构](#navigation)
3. [Projects：项目入口](#projects)
4. [Dashboard：数据与计算](#dashboard)
5. [Report：Build → Review → Export](#report)
6. [Data room 与全局 Chat](#sources-chat)
7. [证据模型与示例数据](#evidence)
8. [代码结构、路由与本地存储](#implementation)
9. [后端与接入边界](#backend)
10. [检查与验证](#validation)
11. [协作、Git 同步与后续开发](#collaboration)

<a id="start"></a>
## 1. 运行项目

### 环境要求

- Node.js **22.18.0 或更高版本**；当前已在 Node.js 24 验证。
- npm，随 Node.js 安装。
- 现代浏览器。前端预览不要求 Python 服务、大模型 API Key 或数据库启动。

### 从仓库启动

```powershell
git clone https://github.com/imnotmomo/acefire.git
cd acefire/frontend
npm ci
npm run dev
```

如果已在本地项目中，进入 `frontend` 后运行最后两条命令即可。仓库提交了 `package-lock.json`，首次安装使用 `npm ci` 复现锁定依赖；调整依赖时再使用 `npm install`。

开发地址：**http://127.0.0.1:5173/**。开发服务需要保持运行；只打开网址不会自动启动服务。端口启用了 `strictPort`，如果 5173 已占用，Vite 会报错，不会悄悄切换到其他端口。

### 构建与本地预览

```powershell
npm run build
npm run preview
```

构建产物位于 `frontend/dist/`，构建预览地址为 **http://127.0.0.1:4173/**。`preview` 是本地检查工具；当前仓库没有配置正式网站部署流程。直接双击 `index.html` 不能代替 Vite 服务。

<a id="navigation"></a>
## 2. 网页信息架构

```text
App
├── Projects
│   ├── 项目卡片 / 列表
│   ├── 搜索 / 行业筛选
│   └── Create project
└── Project
    ├── Dashboard
    │   ├── 财务总览与月度图表
    │   ├── Evidence coverage
    │   └── Metric detail
    │       ├── Source fields
    │       ├── Formula / Review
    │       └── Result
    ├── Report
    │   ├── Build：模块库、配置、排序、生成预览
    │   ├── Review：报告正文、Findings、人工编辑、活动与版本
    │   └── Export：PDF / DOCX / Markdown
    └── Data room
        ├── Documents
        ├── Financial data
        ├── External sources
        ├── Images / Video
        └── Source viewer

共享能力
├── Evidence inspector：从 Dashboard、报告引用或来源入口打开
└── Contextual chat：跨项目工作区的上下文提问入口
```

侧栏负责项目内导航，顶部面包屑标识当前位置。计算详情、证据检查、文件查看和编辑通过对话框展开，避免为短时查看增加新的页面层级。

建议首次体验顺序：首页 **Book a Demo** → 进入 **Enfuce** → 在 Dashboard 点击一个指标 → 查看计算图和来源 → 进入 Report 配置模块 → 生成预览并编辑 → 导出报告。

<a id="projects"></a>
## 3. Projects：项目入口

Projects 是工作台首页，提供项目检索、筛选和创建，并将用户带入具体项目。

项目卡片展示名称、行业、地域、来源数量、模块数量、跟进项及进入工作区的按钮。支持在卡片与列表布局之间切换；搜索会匹配名称、行业和地域，行业筛选可与搜索同时使用。

新建项目需要名称，可设置行业和地域。创建后直接进入该项目的 Report Builder。每个新项目使用默认报告结构，但**不继承其他项目的财务数字或证据**。

### 预置项目的区别

| 项目 | 初始内容 | 用途 |
| --- | --- | --- |
| Enfuce | 历史财务与叙述证据快照 | 演示指标、计算、引用和报告审核 |
| Circle | 读取 `circle-2025-ipo` 后端报告 | 实际计算结果、期间覆盖、冲突标记和文件来源追踪 |
| BackerKit | 空的起始工作区 | 展示项目管理和资料录入 |

首页的 Enfuce 跟进项和检查汇总来自预置示例，不是后台实时汇总，也不会因用户修改报告自动变成新的审计结果。后续接入项目 API 时应替换这些汇总来源。

<a id="dashboard"></a>
## 4. Dashboard：数据与计算

Dashboard 将“数值是多少”和“这个数值如何成立”放在同一条查看路径中。

### 财务总览

主区域展示 H1 2020 的 Revenue 或 Operating income，支持切换指标。月度图表使用保存的 `P&L - Group!C4:H4` 数据，并提供数据表入口，便于核对月份、单元格和金额。

当总览切换为 Operating income 时，图表仍表示纯 Revenue；界面会解释总额中另有其他营业收入。两个指标的定义不会被混用。

下方展示 2019 毛利润、MRR 工作表总额，以及五项示例检查的证据覆盖情况。覆盖图描述这个样本中哪些算术已复现、哪些口径仍需审核，不能解释为公司质量评分或整个 Data room 的覆盖率。

### Metric detail：计算过程

点击指标后，计算画布沿以下方向展开：

```text
原始字段 / 单元格 → 公式或比较规则 → 结果与限制
```

来源节点可点击，画布可缩放；放大或窄屏时可在画布内滚动。选中节点后，下方显示对应字段、公式及来源定位。随后可打开 Evidence inspector，进一步查看保存的摘录与原值。

画布呈现的是**已有计算记录**，不会在浏览器中执行任意 Excel 公式，也不会重新核验底层账本。没有证据的新项目显示空状态，并引导用户进入 Data room。

<a id="report"></a>
## 5. Report：Build → Review → Export

Report 将报告生成前的配置、生成后的审核和最终交付拆成三个阶段。模块配置与已经生成的报告正文分别保存；改变配置后，界面会提示需要重新生成，避免用户误以为旧正文已自动更新。

### 5.1 Build：定义报告结构与研究范围

Build 由模块库、报告结构和当前模块设置三部分组成。用户可搜索和添加模块，移除不需要的部分，通过拖放或上移 / 下移按钮调整顺序。

#### 模块库

| 模块 | 可配置的子主题 |
| --- | --- |
| Company overview | 公司概况、商业模式、股权 |
| Market | 市场规模、市场增长、消费趋势、客户分群、竞争、地域扩张 |
| Financials | 收入、毛利润、经常性收入、现金与 runway |
| Customers | 客户基础、集中度、留存 |
| Product | 产品、技术、路线图 |
| Competition | 竞争格局、差异化、转换成本 |
| GTM | 渠道、销售方式、增长策略 |
| Unit economics | CAC、LTV、回收期 |
| Team | 管理层、组织、招聘计划 |
| Legal / IP | 公司结构、合同、知识产权 |
| Clinical / Regulatory | 临床证据、监管状态、合规 |
| Open questions | 证据缺口、定义核对、后续资料请求 |

默认结构包含 Company overview、Market、Financials、Customers、Team 和 Open questions。其他模块按需加入；Clinical / Regulatory 是特定行业的可选模块。

#### 每个模块的配置

| 配置项 | 取值或输入 | 当前行为 |
| --- | --- | --- |
| Sub-topics | 勾选子主题 | 保存研究范围；部分已有证据模块据此筛选内容 |
| Depth | Brief / Standard / Deep | 保存目标深度并写入研究简报 |
| Geography | Global / Europe / US / Nordics / Asia Pacific | 保存目标地域 |
| Time horizon | Source period / Last 12 months / 3 years / 5 years | 保存目标时间范围，不改变历史来源的真实期间 |
| Evidence scope | Internal only / Internal + external | 保存来源偏好，外部研究请求会明确标记 |
| Additional focus | 自定义文本，最多 2,000 字符 | 保存具体关注点，附在对应模块中 |

例如 Market 可配置为：选择市场规模、增长、消费趋势和客户分群，深度设为 Deep，地域设为 US，证据范围选择 Internal + external，focus 填写 `Focus on Gen Z purchasing behavior`。

这个配置表达“接下来要研究什么”，本身不构成市场结论。当前只有已保存的证据可以进入事实段落；没有支持材料时，生成结果会列出请求范围和证据缺口。Financials 的收入、毛利润及经常性收入子主题已与对应快照事实关联。

### 5.2 Review：阅读、追溯与人工修订

Review 使用三栏审核布局：

| 区域 | 内容与操作 |
| --- | --- |
| 报告正文 | 按模块顺序阅读；通过顶部目录定位章节；点击引用打开证据；编辑章节正文 |
| Findings | 呈现来源中未解决的定义、调整或缺口；检查证据；把跟进要求加入报告 |
| Activity | 展示本地生成与修订事件；按 All / Human / System 筛选 |

正文中的 `[income]`、`[gross]` 等标记关联具体证据。编辑时保留这些标记即可保留引用链接。删除正文引用后，导出引用列表会重新计算，而不是继续列出已经没有被引用的来源。

每次实际改变正文的保存会记录修改前后内容、章节、时间和操作人。Version history 可查看对比；当前没有一键恢复旧版本的功能。来源跟进项可以加入 Open questions，或在该模块不存在时加入 Financials。

重新生成会用当前配置重新组装正文，替换现有章节中的人工编辑。仍保留且正文发生变化的章节会记录生成前后差异；移除模块不会为被删除章节新增修订记录，已有修订记录仍保留。人工编辑及已接受的建议不会自动重新验证，也不代表来源问题已解决。

### 5.3 Export：带着证据交付

| 格式 | 适用场景 | 说明 |
| --- | --- | --- |
| PDF | 阅读与分享 | 当前使用内置拉丁字体；不支持的中文等字符会被替换 |
| DOCX | 继续协作编辑 | 保留正文、标题和 Unicode 来源名称 |
| Markdown | 版本管理、复用或导入其他工具 | 导出纯文本正文及证据引用 |

导出内容包括当前报告章节、人工修改后的正文、仍被正文引用的来源、定位信息和证据限制。历史修订列表及原始资料文件不会打包进报告。

文件在浏览器中生成并下载。需要完整保留中文 sheet 名或其他非拉丁字符时，选择 DOCX 或 Markdown。

<a id="sources-chat"></a>
## 6. Data room 与全局 Chat

### Data room：来源管理

资料按 Documents、Financial data、External sources、Images / Video 分类，也可在 All sources 中统一检索。

用户可以选择或拖入本地文件。新增文件保存后标记为 `Not extracted`；外部来源链接标记为 `Not retrieved`。链接只允许 `http://` 和 `https://`，保存链接不等于获取其内容。

Source viewer 的显示方式取决于文件类型：

| 类型 | 查看方式 |
| --- | --- |
| TXT / CSV / TSV / Markdown / JSON | 文本预览，最多显示前 100,000 字符 |
| 图片、视频 | 浏览器原生媒体查看 |
| PDF | 浏览器内嵌查看，实际支持情况取决于浏览器 |
| 其他格式 | 下载原文件，用对应应用打开 |

预置 Enfuce 来源打开的是保存的摘录、字段和定位，不附带原始 Office 文件。移除用户新增来源只会移出本项目的资料列表，不会修改已生成报告；当前实现也没有清理对应 IndexedDB 二进制记录的逻辑。

### Contextual chat：跨工作区的提问入口

Chat 位于项目页面底部，携带当前项目和所在工作区信息。当前可回答收入、毛利润、MRR / ARR 缺口和客户数相关的有限快照问题，并提供证据按钮；也可以跳转到 Report Builder 或 Data room。

不受支持的问题会说明证据不足，不会补造数字。新建项目没有提取结果时，不会调用 Enfuce 的事实回答。当前对话保存在组件内存中，关闭聊天或重新加载页面后不会保留历史。

<a id="evidence"></a>
## 7. 证据模型与示例数据

### Evidence inspector

所有证据入口共用一个检查器，提供三个标签页：

- **Evidence**：摘录、保存的源字段、数值及结论边界。
- **Lineage**：来源字段、计算或审核节点、输出之间的关系。
- **Source details**：文件名、位置、期间、单位、读取方法，以及部分来源的 SHA-256；可复制引用信息。

### 状态的含义

| 状态 | 可以确认什么 | 不能据此推导什么 |
| --- | --- | --- |
| Reproduced | 保存的输入可复现已有算术结果 | 原始账本已经审计，或数字业务含义已全部确认 |
| Needs review | 定义、主体范围或其他条件需要补充确认 | 已确认数字冲突，或公司存在某种投资风险结论 |
| Reported | 来源中存在该描述或数字 | 已通过独立材料核实或重算 |

比较数字前需要确认主体、期间、币种、单位和指标定义。未知值保持缺失；例如不能在 ARR 定义未确认时直接将 MRR 乘以 12。

### 数据来源与数量口径

| 内容 | 保存位置 | 当前用途 |
| --- | --- | --- |
| 五项财务检查 | [`src/data/enfuce-checks.json`](src/data/enfuce-checks.json) | 由仓库已有的 `database-design/demo_results.json` 复制 |
| 六个月收入字段 | [`src/data/monthly-revenue.json`](src/data/monthly-revenue.json) | 从保存的工作簿证据提取，保留原值、规范化值与单元格 |
| 七条可查看证据 | [`src/data.ts`](src/data.ts) | 五项财务证据，加公司概况与客户数摘录 |
| 原始检查记录 | [`database-design/`](../database-design/) | 提供工作簿、报告摘录及口径说明，供开发核对 |

Dashboard 的五项检查中，三项为算术复现，两项仍涉及定义或范围审核；Data room 的三个预置来源是两个工作簿和一份 FDD 报告。检查数、证据摘录数和来源文件数分别计数，不能相互替代。

数据主要涉及 2017–2020 年的历史来源。导入前端的摘录不会随仓库其他数据文件自动刷新，后续应由统一服务提供版本化结果。

<a id="implementation"></a>
## 8. 代码结构、路由与本地存储

### 技术组成

前端使用 React 19、TypeScript 和 Vite；Lucide React 提供图标，jsPDF 与 docx 分别生成 PDF 和 Word 文件。图表、项目封面及计算连线使用本地 SVG / CSS，没有外部图片或字体依赖。具体依赖版本以 [`package.json`](package.json) 和锁文件为准。

### 文件职责

```text
frontend/
├── public/                    静态资源
├── src/
│   ├── App.tsx                应用壳、Projects、项目切换、全局对话框
│   ├── Dashboard.tsx          财务总览、图表、指标详情入口
│   ├── Report.tsx             Build / Review / Export 与修订操作
│   ├── DataRoom.tsx           资料录入、分类、检索和文件查看
│   ├── Evidence.tsx           Evidence inspector 与 Lineage
│   ├── Chat.tsx               有限证据问答和工作区导航
│   ├── domain.ts              数据类型、报告组装、引用、排序和存储
│   ├── data.ts                模块定义、默认结构、证据映射
│   ├── data/                  历史证据快照
│   ├── export.ts              文件导出
│   ├── ui.tsx                 图标、标签、空状态和对话框
│   ├── styles.css             页面视觉与响应式规则
│   └── main.tsx               React 入口
├── tests/                     业务与浏览器测试
├── main.py                    保留的独立 FastAPI 问答模块
├── test_main.py               Python 问答测试
├── requirements.txt           Python 依赖
├── DESIGN.md                  四张参考图对应的视觉约定
├── package.json               前端依赖和命令
├── tsconfig.json              TypeScript 配置
└── vite.config.ts             本地服务与构建配置
```

Python 文件与网页文件目前共同位于 `frontend`，这是现有目录结构；它们不会因此自动成为 React 应用的运行依赖。

### 路由

使用 URL hash 路由，浏览器前进、后退可切换页面。Evidence inspector、文件查看器和聊天不是独立 URL。

| 地址片段 | 页面 |
| --- | --- |
| `#/projects` | 项目首页，也是首次进入的默认页面 |
| `#/project/:projectId/dashboard` | 指标与财务总览 |
| `#/project/:projectId/report/build` | 模块配置与排序 |
| `#/project/:projectId/report/review` | 报告审核 |
| `#/project/:projectId/report/export` | 报告导出 |
| `#/project/:projectId/data-room` | 来源管理 |

### 数据关系与持久化

`Project` 标识项目；`Workspace` 保存模块顺序、模块配置、报告章节和修订记录；`Section` 保存正文、配置快照及证据 ID；`LocalDocument` 登记用户新增资料。多个章节可以引用同一条 `Evidence`。

| 存储位置 | 内容 |
| --- | --- |
| localStorage · `acefire:projects:v1` | 项目列表 |
| localStorage · `acefire:workspace:v1:<projectId>` | 各项目的模块配置、报告及修订 |
| localStorage · `acefire:documents:v1:<projectId>` | 各项目的文件 / 链接元数据 |
| IndexedDB · `acefire-files` / `files` | 以文件 ID 索引的本地二进制内容 |
| 组件内存 | 当前对话、筛选条件等临时界面状态 |

刷新后可以恢复已持久化内容，但清理站点数据会丢失本地项目与文件。不同浏览器、设备及 origin 不共享这些数据；`localhost` 和 `127.0.0.1` 也不是同一个 origin。当前没有账号、服务端持久化或多人同步。

<a id="backend"></a>
## 9. 后端与接入边界

### Circle：启动已接入的 C 后端

在两个终端分别运行。后端使用已保存的 Circle 文件，不发起新的 Akta 请求。

```bash
# Terminal 1 — repository root
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.lock
python -m app.cli demo-circle
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

```bash
# Terminal 2 — repository root; Node >= 22.18
cd frontend
npm ci
npm run dev
```

打开 `http://127.0.0.1:5173/#/project/circle/dashboard`。同一个 DuckDB 文件只运行一个后端进程；请勿添加多个 worker。

默认浏览器请求 `/api`，Vite 开发/预览代理到 `http://127.0.0.1:8000`。后端地址不同时，在 `frontend/.env.local` 设置 `ACEFIRE_BACKEND_URL`，参考 [`.env.example`](.env.example)。正式部署需要反向代理将 `/api/*` 转到 C 后端并去掉 `/api` 前缀；Vite 的开发代理不会进入静态构建。若设置独立域名的 `VITE_API_BASE_URL`，后端必须允许该页面的跨域来源。源码没有 API 密钥。

| 能力 | 当前实现 | 仍待接入 |
| --- | --- | --- |
| Circle Dashboard | 真实 `/report`、精确十进制字符串、计算结果、期间覆盖和非阻塞 `conflict_numbers` | 新的提取数据到达后刷新存储报告 |
| Circle Evidence / Lineage | 后端 UUID、公式、输入、原始文件、sheet/cell、JSON pointer、已提供的 page/line 与 SHA-256 | 未提供的位置保持未知；没有伪造逐行高亮 |
| Circle 报告与导出 | 根据已加载证据确定性生成章节；保留人工编辑、版本记录和 UUID 引用；Markdown / PDF / DOCX 包含来源 | 研究检索与叙述生成服务 |
| Circle Data room | 展示注册文件、提供原始文件预览/下载；上传与 Akta 获取按钮禁用并标记 pending | B 的上传处理与 Akta 获取流程 |
| 项目、模块、编辑历史 | 浏览器本地状态；Circle 映射到 `circle-2025-ipo` | 公司/项目列表创建 API、团队权限、服务端版本 |
| Enfuce / 其他项目 | 保留原有快照和本地演示；不继承 Circle 数据 | 对应公司的后端数据与映射 |
| Chat / 外部研究 | Circle 使用证据查看入口；Enfuce 保留本地快照问答 | 实时模型、搜索、来源获取 |

加载失败、未准备公司数据或 API 返回不兼容内容时，Circle 显示错误和重试入口，不替换成 Enfuce 数据。刷新报告不会重新获取 Akta 或自动覆盖人工编辑；需要用户明确重新生成报告章节。

深度、地域、时间范围和 focus 是草稿偏好，不会执行新研究或改变原始来源期间。缺失值不填零，部分月份不自动年化，冲突不会触发审批流程。所有财务运算由后端完成。

### 保留的 Python 问答服务

[`main.py`](main.py) 已提供 `POST /ask`，但 React 页面**尚未调用此接口**，`/api` 代理指向 C 财务后端，不代理此 `/ask` 服务。只启动该服务不会使底部 Chat 自动变为实时 AI。

在**仓库根目录**运行：

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r frontend/requirements.txt
$env:NICRRON_API_KEY = "your-api-key"
.\.venv\Scripts\python.exe -m uvicorn frontend.main:app --reload
```

该旧服务不要与 C 后端争用同一端口；它不是上述 Circle 工作流的一部分。其交互接口文档为 `/docs`。本地开发也会读取仓库根目录 `.env` 中的 `NICRRON_API_KEY`，已有环境变量优先。密钥不应进入浏览器环境变量或提交到 Git。

请求：`{"question":"Where does the reported ARR come from?"}`；成功响应：`{"answer":"..."}`。

服务将问题发送到 `https://api.nicrron.ai/v1/chat/completions`，使用 `nicrron/auto`。它校验问题长度和空白输入，设置 60 秒网络不活动超时，并对错误和密钥回显做处理。目前只传问题文本，没有项目证据检索、资料访问或确定性财务计算。

Circle 的 API 地址、代理、契约校验和错误状态已接入 C 后端。旧 Python 问答服务与 B 的上传/Akta 流程没有在本次接入中启用。

<a id="validation"></a>
## 10. 检查与验证

在 `frontend` 运行：

| 命令 | 检查内容 | 前置条件 |
| --- | --- | --- |
| `npm test` | 6 项业务测试：排序、项目隔离、子主题筛选、范围说明、引用导出、URL 协议 | 已安装依赖 |
| `npm run build` | TypeScript 类型检查与生产构建 | 已安装依赖 |
| `npm run test:e2e` | 10 条浏览器流程，覆盖主工作区、导出、上传、聊天和手机布局 | 5173 开发服务正在运行，且有可用 Chrome |

端到端测试使用无头浏览器和独立上下文，不读取日常浏览器中已有的项目数据。默认 Chrome 路径为 `C:/Program Files/Google/Chrome/Application/chrome.exe`；其他安装位置或兼容 Chromium 浏览器可通过 `PLAYWRIGHT_BROWSER_PATH` 指定：

```powershell
$env:PLAYWRIGHT_BROWSER_PATH = "C:\path\to\chrome.exe"
npm run test:e2e
```

结果、页面截图和导出样例保存到 `frontend/test-results/`，该目录不提交 Git。当前首版已通过上述 6 项业务测试、10 条浏览器流程及构建；这是本地原型验证，不代表生产环境或真实模型质量验收。

Python 测试从仓库根目录运行，使用模拟上游响应：

```powershell
.\.venv\Scripts\python.exe -m unittest frontend.test_main -v
```

<a id="collaboration"></a>
## 11. 协作、Git 同步与后续开发

### 目录和同步规则

网页代码与素材统一放在 `frontend/`。依赖、构建结果、测试产物、虚拟环境和 `.env` 等本地内容通过 `.gitignore` 排除。

当前用户电脑配置了 Windows 任务 `Acefire-AutoPush`，每 5 分钟提交 `frontend/` 的改动并推送到 `origin/main`。该任务是本机配置，克隆仓库不会自动创建。电脑需要开机、用户已登录且联网。

同步脚本遇到远程新提交、非 `main` 分支或其他目录已有暂存改动时会停止，等待人工处理，不会强制覆盖远程历史。操作方法和日志路径见 [`scripts/README.md`](../scripts/README.md)。

**Git 同步网页源码，不同步浏览器数据。** 在页面中新建的项目、上传文件、报告编辑及聊天不会因此上传 GitHub，也不等于正式网站部署。需要保留报告时使用 Export；需要跨设备协作时接入后端存储。

### 后续开发顺序

1. **统一数据契约与项目 API。** 对齐项目、来源、证据、指标、计算、章节和修订结构，替换本地项目持久化。
2. **完成资料处理链路。** 建立文件存储、提取状态、单元格 / 页码定位及来源版本，替换预置证据。
3. **扩展已接入的指标服务。** Circle 已使用 C 后端返回的数值、单位、期间、公式和来源。其他公司仍需各自的数据和项目映射。
4. **接入模块化报告生成。** 将 Build 配置转成检索请求，生成逐条带引用的章节，并保留人工修改历史。
5. **接入上下文 Chat 与团队协作。** 基于真实证据和计算工具回答，再完善权限、服务端审计、部署及跨设备使用。

实现时优先替换数据和服务边界，复用当前页面层级及组件职责。视觉方向见 [`DESIGN.md`](DESIGN.md)，历史数据设计见 [`database-design/README.md`](../database-design/README.md)。

### Circle 集成验证

启动上述后端和前端后，在 `frontend/` 运行 `npm run test:integration`。该测试读取实际存储报告，验证 Circle 页面、来源文件、精确数值、UUID 引用、报告导出、项目隔离、失败重试和 pending 控件；它不调用新增上传或 Akta 获取。`npm test` 检查契约/精度与报告逻辑，`npm run test:e2e` 保留原有 Enfuce 浏览器回归。Chrome 可通过 `PLAYWRIGHT_BROWSER_PATH` 指定；否则使用 Playwright 的 Chromium。

### 模型计算与句子来源追踪

Circle Dashboard 的计算工作区使用现有已登记数据：选择数值观察、可选原文句子，输入自然语言计算问题。后端调用 Nicrron `openai/gpt-6.1-sol` 生成代码并在受限本地 Python worker 运行。配置状态来自 `/calculation-runtime`，执行请求发到 `/calculate/agent`。源码、执行输出、精确值、原始文件与来源位置在结果的 Evidence / Lineage / Execution 中可查。

原文引用与模型解释分开；引用必须是所选文本中的逐字内容。当前句子来自已经保存的主档字段，保持原 JSON pointer 和文件 hash。没有新建 PDF 提取或上传/Akta 获取流程。模型结果保留为需核对的分析，不直接成为已审定指标；刷新后报告仍保留人工编辑与过期证据导出保护。

### Firebase 公司数据、已存报告与全公司 Chat

当前 API 使用 Firebase `acefire-50248` / `acefire`。进入 **Enfuce · Document claims**，在 Build 中可加载两份已存报告；原文句子、页码、文件 hash 可点击追踪。19 条未规范化数值仍为空，不由报告补齐。原 Enfuce 卡片保留历史演示，Circle 使用自己的独立数据。

侧边 Company chat 调用 Nicrron 模型，服务端提供该公司的全部已存资料，超出当前页可见数据；每个返回的引用必须与公司原文/结构化记录匹配。生成报告同样调用模型并验证引用，人工编辑在失败或刷新时保留。所有 Missing / Verify / Conflict 中的 Verify 均表示需要核对。详细 API、存储与启动说明见 [Firebase integration](../backend/FIREBASE_INTEGRATION.md)。`npm run test:firebase` 验证真实存储报告；`LIVE_COMPANY_CHAT=1` 才执行浏览器中的真实模型调用。
