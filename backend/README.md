# Member C：共享数据库、财务计算与公司报告 API

**当前本地应用已接入 Firebase。** 项目 `acefire-50248`、数据库 `acefire`；最新 Enfuce DuckDB、两份报告与 Circle 资料均已导入。启动用 `python run_local.py`，配置、数据契约及队友交接见 [Firebase integration](FIREBASE_INTEGRATION.md)。下方 DuckDB 命令保留为离线导入/兼容流程。

**Akta 是主要公司资料源；Orbis、PitchBook 等文件模拟用户通过网页上传的私有证据。** 两条通道共用 FastAPI、本地 DuckDB 文件及来源链，上传资料不能覆盖 Akta 主档。当前公司适配器只覆盖 Circle。

## B → C → 前端交接

- **B 负责读取和提取**：PDF/图片内容、Akta 公司资料及其他补充数据，并输出原始值、单位、期间、实体口径和来源定位。实时供应商获取与 PDF 提取不属于 C 的生产职责。
- **C 负责共享数据库、规范化与可追溯执行**：登记原文件，接收 B 的结构化 Claim，按明确单位规范化，执行财务计算和可比性检查，保存完整来源链。
- **前端读取完整结构化报告**：`GET /deals/{id}/report` 汇总可用主档、指标、计算、比较、覆盖情况、缺口和来源图；点击数字可回到具体文件与原始位置。

B 将 `ExtractedClaim` 列表提交到 `POST /deals/{id}/claims/batch`，请求体为 `{"claims": [...]}`，具体字段见 `/docs`。每条 Claim 引用已经登记、属于当前 Deal 的来源快照；C 保存 B 提供的 page、line、sheet/cell 或 JSON pointer，保留原始值再做确定性规范化。来源没有行号时保持未知，不把后生成的文本行号称为原文件行号。

报告的“完整”指把当前已有数据、全部已保存计算和明确缺口统一交付，不代表缺失财务数据已被补齐。没有证据的指标保留缺失原因，不能为了报告齐全而生成数字。

## 本地启动：优先使用已保存的 Akta 数据

从项目根目录运行：

```bash
python3 -m venv backend/.venv
source backend/.venv/bin/activate
python -m pip install -r backend/requirements.txt
cd backend
python -m app.cli init-db
python -m app.cli ingest-circle --akta-saved
python -m app.cli ingest-circle --local
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

打开 `http://127.0.0.1:8000/docs`。`--akta-saved` 离线读取 `data/akta/` 中用户已保存的真实 Akta 响应，不需要 API key，也不发起网络请求。`--local` 把现有 Circle 的 Orbis/PitchBook 文件作为模拟上传接入。两者是演示和交接契约的适配器，用来让 C 在 B 的实时流程完成前联调，不改变 B 负责资料读取/提取的分工。

当前两份 Akta 响应分别保存公司资料和财务估计，均对应 UUID `000004j`。主档包含 firmographic、location、product_offering、industry；财务响应只有 `valuation_estimate` 的 `$25B+` 区间，**没有 revenue estimate**。两份原文件及 profile 绑定分别保存，不用财务响应覆盖完整主档，也不从叙述中的产品效果数字推导已验证财务指标。

也可以用 `python -m app.cli demo-circle` 一次加载主档、模拟上传与下面的来源计算示例；命令会打印可供 UI 调用的 `lineage_url`。

数据库直接使用本地 DuckDB，默认文件是 `backend/.cache/acefire.duckdb`。`init-db` 自动创建目录、数据库文件与表。需要自定义位置时，在启动前设置：

```bash
export DUCKDB_PATH='/absolute/path/to/acefire.duckdb'
```

存储层使用 DuckDB Python API；原生表结构来自 `app/db_schema.py` 的 `SCHEMA_SQL`。`init-db` 负责当前本地 Schema 的初始化；旧 Enfuce 检查产物不是数据库迁移。

| 环境变量 | 用途 |
| --- | --- |
| `DUCKDB_PATH` | DuckDB 文件位置，默认 `backend/.cache/acefire.duckdb`。 |
| `AKTA_DATA_ROOT` | 已保存 Akta JSON 所在目录，默认项目 `data/akta/`。 |
| `DATA_ROOT` | 模拟上传案例的父目录，默认 `data/additional-cases/`。 |
| `SOURCE_CACHE_DIR` | 后续 API 响应与上传文件的缓存根目录。 |
| `AKTA_API_KEY` | 仅在选择实时 Akta 接入时于服务端提供。 |

`.env.example` 是配置示例；`python run_local.py` 加载允许的 `backend/.env` 配置，直接运行 uvicorn 时需导出存储环境变量。不要把实际密钥写入源码、README、提交记录或浏览器代码。

## 两条数据通道

| 通道 | `provider` | `ingestion_channel` | `data_role` |
| --- | --- | --- | --- |
| Akta 公司资料，包括已保存的 API 响应 | `akta` | `provider_api` | `primary_company_data` |
| 网页上传或本地上传演示文件 | `orbis` / `pitchbook` / `uploaded` | `user_upload` | `supplemental_evidence` |

快照还记录 `visibility=deal_private`、`original_filename`、`uploaded_at`、SHA-256、取得时间和来源上下文。供应商名称保留为出处，不代表应用订阅了该供应商的实时 API。`primary_company_id` 只有在 Akta UUID、域名及法律实体核对后才填入。

网页端可向 `POST /deals/circle-2025-ipo/files` 提交 multipart `file`；可用 `provider` query 标记已知出处。后端保存原文件并登记来源；已知 Circle Orbis 原生工作簿可提取数值。通用 PDF、图片及其他上传文件目前只登记快照，不宣称已完成 OCR 或内容解析。

本版是单用户本地原型。`deal_private` 表达数据分类，尚不构成生产身份验证、租户隔离或访问控制保证；默认仅监听 localhost。

## API

`{id}` 当前使用 `circle-2025-ipo`，具体请求模型见 `/docs`。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/deals/{id}/ingest/akta-saved` | 离线接入用户已保存的 Akta 响应。 |
| POST | `/deals/{id}/ingest/local` | 加载本地文件作为上传演示资料。 |
| POST | `/deals/{id}/files` | 上传私有补充证据；不覆盖公司主档。 |
| POST | `/deals/{id}/claims/batch` | B 提交带已登记来源引用和定位的 `ExtractedClaim` 列表，C 规范化并保存。 |
| GET | `/deals/{id}/report` | 完整可用公司报告：主档、指标、全部计算、比较、覆盖、缺口和来源图。 |
| GET | `/deals/{id}/company-profile` | Akta 主档与来源绑定。 |
| GET | `/deals/{id}/profiles` | 保留版本与 section 区分的 Akta profile 记录。 |
| GET | `/deals/{id}/sources` | 来源快照及两条通道分类。 |
| GET | `/sources/{snapshot_id}/file` | 本地来源文件。 |
| GET | `/deals/{id}/observations`、`/deals/{id}/claims` | 来源观察；claims 是查询别名。 |
| GET | `/claims/{claim_id}/evidence` | 单条 observation 的证据。 |
| GET | `/deals/{id}/overview`、`/deals/{id}/lineage` | 覆盖概况及完整来源图。 |
| POST | `/deals/{id}/compare`、`/deals/{id}/calculate` | 保守比较及白名单计算。 |
| POST | `/deals/{id}/calculate/revenue-dynamic` | 按实际来源覆盖动态计算收入；可选成对的 `target_start` / `target_end`。 |
| GET | `/deals/{id}/comparisons`、`/deals/{id}/calculations` | 已保存的结果和未决原因。 |
| GET | `/calculations/{calculation_id}/lineage` | 具体计算的输入链。 |
| POST | `/deals/{id}/replay/balance-sheet` | 单个已定位 Orbis 来源的资产组件加总；请求包含 `period_end`，可选 `snapshot_id`。 |

## UI 文件与数字可视化

`GET /calculations/{calculation_id}/lineage` 返回计算值、公式、输入数字、文件名、SHA-256、`preview_url` 与精确 locator，以及可用于 React Flow 的 `nodes` / `edges`。关系为 **文件 → 来源数字 → 计算结果**；同一文件的多个输入共用一个文件节点。`GET /sources/{snapshot_id}/file` 只返回已登记且 hash 未变化的文件。

`GET /sources/{snapshot_id}/preview?sheet=...&cell=I49` 提供只读 XLSX 窗口：原始缓存值、公式文本、单元格定位、sheet 列表、`row_start` / `column_start` 分页。每次先核对登记 SHA-256；不执行公式，不写入数字观察值。前端 Evidence inspector 的 File 标签使用此接口突出被引用的单元格；PDF、图片与纯文本使用原始文件接口，并在客户端再次检查 SHA-256。

真实示例：FY2024 Orbis 工作簿中的 `I49`（Non-current assets，$669,460,000）加 `I53`（Current assets，$45,164,949,000）得到 **$45,834,409,000**。这是同一来源的算术重现，保留未知 scenario，不声称完成跨来源或独立财务核验。

`GET /deals/{id}/company-profile` 同样返回 Akta 字段与文件的绑定：例如估值区间回到财务 JSON 的 `/response/data/financial_estimate/valuation_estimate`，不同来源的冲突值分别保留。前端读取保存的结构化值。模型只生成计算代码，最终数值必须来自本地执行输出；不能直接把模型回答中的数字当作计算结果。

前端可直接参考 `examples/circle_calculation_lineage.json`，这是用当前真实本地文件运行得到的 4 个节点、4 条边示例。

## 财务与来源边界

接入阶段不自动设置已审核 `definition_key`。比较前还需确认精确期间、实体范围、scenario、会计基础及单位；未知时返回 `not_comparable` 或 `insufficient_evidence`，不生成差额。

- Orbis 原生 XLSX 的 `th USD` 按明确单位规范化；旧人工观察的未决倍率不会被改写。`Cash flow [Net Income before D&A]` 不是经营现金流。
- PitchBook 目前接入现有 observation JSON 并登记 PNG，不包含通用 OCR；保留 TTM、缺失值和分析师调整口径。
- Akta 估计区间不变成精确金额、中点或历史财报。快照取得时间不是财务期间，2026 年视图不能回填为 Circle 2025-05-27 截止日已知信息。
- 当前网页的新计算使用 Nicrron `openai/gpt-6.1-sol` 生成 Python，在受限本地 worker 中执行；保留代码、输入、输出与来源。已有白名单函数及存量结果保留兼容，旧端点在 OpenAPI 中标为 deprecated，不作为新流程的自动回退。

金额以十进制字符串保存在 JSON payload 和 DuckDB `VARCHAR` 字段中；计算时显式转换成 Python `Decimal`，不经过二进制浮点数。来源原值、规范化值和计算结果分别留存。

### 动态期间与缺口

`GET /deals/{id}/report` 的 `data_period_coverage` 列出来源的实际月度、季度、年度或其他日期范围、重叠、缺口与未确认期间；它描述覆盖，不自动汇总财务数值，也不把三个月范围直接认定为公司的财务季度。

动态收入接口接受 `input_ids`（最多 2000 个、不可重复）。省略时只选择已审核 `definition_key=recognized_revenue` 的记录。未指定目标时使用来源的真实起止范围；指定目标时必须同时提供起止日。系统选取不重叠覆盖，避免把全年总额与包含在其中的月度/季度额重复相加。相同期间的多份来源存在歧义时，需要明确选源。

明确请求全年但只取得部分月份时，最终 `value=null`，`parameters.coverage.observed_total` 仅标记为 `partial_observed_periods`，并列出缺失区间。不会将部分期间收入年化、补齐或称为全年收入。计算后若可比数字不一致，返回 `conflict_numbers: true` 和冲突数字、差额及来源；原始值全部保留。前端可以显示该标记，不需要审批流程。口径未知的问题另列为需要核对。

## 后续实时 Akta 连接

保留 `python -m app.cli ingest-circle --akta` 与 `POST /deals/{id}/ingest/akta` 作为连接/契约演示工具，当前流程不依赖它们；生产中的 Akta 获取由 B 负责。官方 REST 公司搜索及 enrichment 返回 JSON；MCP `company_data` 返回 Markdown，`company_data_concise` 返回简短 JSON，鉴权使用 `x-api-key`。

此前 MCP/REST 访问受到 Cloudflare 403 / Error 1010 阻断；新密钥的 REST 检查也返回 403。新密钥的 MCP 检查因自动权限审查超时未执行，不能说已测试或判定密钥无效。当前真实公司数据来自用户已保存的两份响应，不宣称本环境的实时连接已恢复，也不继续重试或绕过拒绝。

官方契约：[MCP 设置](https://docs.akta.pro/docs/developer-tools/mcp/setup)、[公司搜索](https://docs.akta.pro/docs/supporting-apis/company-search)、[JSON 公司资料](https://docs.akta.pro/docs/company-data/quick-start)、[限流](https://docs.akta.pro/getting-started/rate-limits)。

## 开发与验证

从 `backend/` 运行 `python -m pip install -r requirements-dev.txt`、`python -m pytest -q`。离线 Akta 测试直接读取真实保存文件；实时连接契约另用模拟响应验证，两者不能混称。

测试覆盖离线 Akta 主档、上传隔离、重复导入、原始文件 hash、计算输入与文件图、数据库外键和保守财务计算；新增交接与报告行为应以当前测试运行结果为准。

修改 `app/db_schema.py` 中的原生 DuckDB Schema 后运行 `python scripts/export_schema.py`，从 `SCHEMA_SQL` 生成 `database-design/schema.sql`；共享 API 合约保存在 `app/schemas.py`。旧 `database-design/evidence/`、`demo_checks.py` 等是 Enfuce 留存资料，不是当前 Akta 主档或上传证据的入库结果。B/C 使用同一 DuckDB 数据库和合约；C 向前端及 LLM 提供报告和可追溯的结构化结果。

## 当前计算流程：LLM → 本地 Python → 来源链

在不修改已登记数据的前提下，从 Circle Dashboard 的计算工作区选择现有数值，输入计算问题，可额外选择原文句子作为证据/前提。模型使用 Nicrron 的 `openai/gpt-6.1-sol`，不需要 Solari 账户或密钥。

把模型密钥放在忽略提交的 `backend/.env`，参考 `.env.example`。`GET /calculation-runtime` 只返回配置状态与模型名称，不返回密钥。

`POST /deals/{id}/calculate/agent` 请求：

```json
{
  "question": "Use these source components to calculate the total and explain its limits.",
  "input_ids": ["registered-observation-id-1", "registered-observation-id-2"],
  "premise_ids": ["field:registered-snapshot-id:/firmographic/company_description_short"],
  "parameters": {}
}
```

`premise_ids` 可省略。当前原文来自已有 Akta 主档字段、B 的 document claims，以及已保存报告的原文引用；`GET /deals/{id}/text-evidence` 返回这些已绑定的文本。PDF/私有文件的新提取仍由 B 负责，本功能不会竞争读取或伪造尚未提供的段落。

模型返回 `calculate(inputs, parameters)` 的 Python 源码。服务器检查允许的数字处理语法，在无模型密钥的独立短生命周期子进程中执行，限制执行时间、资源和输出。该限制是本地执行策略，不声称具备容器或硬件 VM 的隔离级别。它不提供任意 shell、文件访问或网络工具。财务数据保持十进制字符串，代码使用 `Decimal`；结果为有限十进制字符串或明确的缺失状态。

`Calculation.parameters.agent_execution` 保存模型/生成契约、源码与 hash、输入 manifest/hash、执行 ID/时间/退出码/stdout/stderr、声明使用的数值 ID、原文引用、假设与限制。每个原文引用必须逐字出现在所选的原始文本中；它继续指向原始文件 hash 与 JSON pointer 或 B 提供的位置。自由生成的解释与原文引用分开展示。

图中全部已提供数值/文本输入保留，引用过的句子标为 premise，未引用的文本标为 supplied context。这是保守的输入来源链，不宣称已独立证明代码每一条动态数据流。模型生成的结果标记为需要核对，执行成功不等于财务口径经过独立验证。新指标使用 `agent.*` 命名空间，不能仅凭模型名称把它等同于已审定的 ARR/Revenue；已有来源冲突标记继续保留。

执行完成后刷新存储报告，在计算的 Evidence / Lineage / Execution 中查看数字和句子的出处。API 不可用、代码不合格或执行失败时返回明确错误，不回退到固定财务公式生成数字。
