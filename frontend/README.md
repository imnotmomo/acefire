# Acefire 网页工作台

基于 React、TypeScript、Vite 的本地前端。全部网页代码、素材和测试位于本目录。

## 启动

在当前文件夹打开 PowerShell：

```powershell
npm install
npm run dev
```

打开 http://127.0.0.1:5173/ 。需要 Node.js 22.18+，已在 Node.js 24 验证。

## 已实现

- Projects：卡片 / 列表、搜索、行业筛选、新建项目。
- Dashboard：Enfuce 历史财务数据、月收入图、证据覆盖、可点击计算图和证据检查器。
- Report / Build：12 类模块、子主题、深度、地域、时间范围、证据范围、自定义 focus，拖动及键盘可用的按钮排序。
- Report / Review：带引用的本地报告预览、人工编辑、版本历史、证据 Findings、真实活动记录。
- Report / Export：可下载 PDF、DOCX、Markdown，附引用、原文位置及缺口说明。
- Data room：本地文件保存、分类、搜索、链接登记、文本 / 图片 / 视频 / PDF 查看器。
- Contextual chat：按当前项目提供有限的快照问答和工作区导航。
- 项目与报告使用 localStorage，上传文件使用 IndexedDB；刷新后保留，项目之间隔离。
- 390px 手机布局、可见键盘焦点、对话框焦点限制与 Escape 关闭。

## 数据和功能边界

Enfuce 数值来自仓库的 `database-design/demo_results.json` 和
`database-design/evidence/workbooks.json` 保存记录。公司与客户叙述来自
`database-design/evidence/reports.json`。界面呈现的是历史证据快照，
不代表当下公司数据、独立审计或投资建议。原始 Office 文件不随预览复制。

Circle、BackerKit 是空的起始工作区；不会继承 Enfuce 指标。新项目也不会被填入虚构数据。

报告生成目前是确定性快照组装，不调用大模型。配置会持久保存并出现在研究简报中；
所选财务子主题控制纳入哪些已有事实。深度、地域、时间、focus 和外部证据偏好
尚不触发实时检索或新的分析。缺少证据的模块明确显示缺口。上传文件不会自动解析。

聊天是有限的本地证据路由，不是开放式 AI 对话。原有 Python `/ask` 模块仍保留，
但当前 React 网页未连接它。后续应通过服务层接入检索、计算、报告生成和聊天 API，
并把存储改成团队后端。`src/domain.ts` 保留了项目、模块、报告和版本结构。

PDF 使用内置拉丁字体；原始中文 sheet 名请用 DOCX / Markdown 完整保留。
人工改写不会自动重新核实。引用被删除后，导出的引用列表也会随之更新。
浏览器清理会删除本地工作区，因此重要报告请及时导出。

## 验证

```powershell
npm test
npm run build
npm run test:e2e
```

端到端验证需要正在运行的开发服务器，并默认使用已安装的 Chrome。
若 Chrome 路径不同，设置 `PLAYWRIGHT_BROWSER_PATH` 为浏览器可执行文件路径。
验证结果、页面截图、导出的样例文件在忽略 Git 的 `test-results/` 中。

## 文件结构

```text
src/
  App.tsx           项目、导航、主框架
  Dashboard.tsx     财务图表与指标
  Report.tsx        Build / Review / Export
  DataRoom.tsx      本地文件与来源管理
  Evidence.tsx      证据检查器与计算图
  Chat.tsx          全局上下文问答
  domain.ts         纯业务逻辑、本地存储
  data.ts           模块和证据模型
  data/             保存的来源快照
  export.ts         报告下载
  styles.css        根据四张参考图实现的视觉和响应式样式
```

## 保留的 Python 服务

Run these commands from the project root in PowerShell:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r frontend/requirements.txt
$env:NICRRON_API_KEY = "your-api-key"
.\.venv\Scripts\python.exe -m uvicorn frontend.main:app --reload
```

For local development, the backend also loads `NICRRON_API_KEY` from the project root `.env` file (ignored by Git). Existing environment variables take precedence. Set `NICRRON_API_KEY` in the backend's environment in production. Never use a frontend/public environment variable for the key.

`POST /ask` accepts JSON:

```json
{"question": "Where does the reported ARR come from?"}
```

Successful response:

```json
{"answer": "The model's answer"}
```

The backend calls `https://api.nicrron.ai/v1/chat/completions` with model `nicrron/auto`. Only the answer is returned. Upstream errors use generic messages; credentials are never returned. Requests time out after 60 seconds of network inactivity. Blank questions and questions longer than 20,000 characters are rejected.

Tests use mocked upstream responses and require no API key or network calls:

```powershell
.\.venv\Scripts\python.exe -m unittest frontend.test_main -v
```

This endpoint sends the question only; document retrieval and evidence-backed answers are not implemented yet.
