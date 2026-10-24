# Enfuce 数据怎么接入、数据库怎么设计

建议先做 **一个 Enfuce Deal、一套 PostgreSQL、四份核心资料的证据闭环**。文件继续作为原件保存；数据库保存文件身份、证据位置、提取结果、指标口径、计算依赖和比较结果。

这份设计基于当前本地数据。已完成文件登记、重点资料检查和五项数字回放检查；还没有创建 PostgreSQL 实例、执行迁移或批量提取全部 PDF。

## 现有数据能做什么

[文件清单](data_inventory.json) 已登记 366 个文件：339 PDF、13 XLSX、11 DOCX、3 PPTX，共约 317 MiB。13 个 XLSX 中有一个 `~$` Excel 临时锁文件，应跳过，因此有 365 个可接入原件。发现一组不同路径、相同 SHA-256 的文件；保留两条来源记录，不能仅靠文件名推断法人身份，也不能仅按 hash 删除来源。

| 数据层 | 当前资料 | 第一版用途 |
| --- | --- | --- |
| 叙述和汇总 | FDD PPTX、Investment Memo DOCX | 提取 reported claim、原文、页/段定位、报告精度 |
| 结构化财务 | P&L/MRR、June 2020 Financials | 映射指标、读取原值/公式/缓存、确定性重算 |
| 支持资料 | 财报 PDF、合同、公司/合规/人事资料 | 先做文件登记；按具体 claim 的缺口再检索和提取 |

第一批使用以下四份文件，不必一开始处理全部 365 份：

1. [FDD 报告](../data/Enfuce/Enfuce_FDD_0910_v4.pptx)：报告数字及来源定位。
2. [Investment Memo](<../data/Enfuce/20200730 Enfuce Investment Memo-CLEAN.docx>)：叙述中的数字和定义。
3. [历史/预测 P&L 与 MRR](<../data/Enfuce/Enfuce 09-07/B. Financial and Tax Information/Enfuce P_L  2017- 2022F by Qs.xlsx>)：实际 2017–2019、预测 2020–2022 及 MRR 明细。
4. [June 2020 Financials](<../data/Enfuce/M. Supplmental FDD/June  2020 Finacials.xlsx>)：集团半年财务及中文汇总。

本次检查读取了 12 个真实工作簿的结构，对其中 7 个财务工作簿取了相关样本，并检查了上述两个叙述报告。339 个 PDF 尚未逐份提取；Memo 内嵌图片中的财务表也未在本次文本检查中识别。

## 数据流

```mermaid
flowchart LR
  F[原始文件与版本] --> E[证据定位<br/>页、段、单元格]
  E --> C[Claims<br/>数字、实体、期间、口径]
  C --> N[单位与定义确认]
  N --> R[Python Decimal 重算]
  C --> P[可比性检查与对比]
  R --> P
  P --> UI[数字对比、证据链、待确认问题]
```

原件放在 `data/` 或以后选定的对象存储；不要把文件二进制塞进普通业务表。结构化字段用于筛选和关联，`JSONB` 用于不同证据的定位信息。金额使用精确 `NUMERIC`，Python 侧用 `Decimal`，保留原值及规范化过程。[PostgreSQL 数字类型](https://www.postgresql.org/docs/current/datatype-numeric.html)、[JSON 类型](https://www.postgresql.org/docs/current/datatype-json.html)

## 表怎么分

[schema.sql](schema.sql) 是对应的 PostgreSQL DDL 草案。下面八张主表表达业务对象，另三张表保存关联和处理记录。

| 表 | 保存什么 | Enfuce 例子 |
| --- | --- | --- |
| `deals` | 一个尽调项目 | Enfuce |
| `entities` | 被描述的法人或集团范围 | Group、EFS、ELS、EPS、Sweden；Group 不是一个子公司的别名 |
| `files` | 每个原件版本的路径、SHA-256、类型 | 同名新版本另存；同内容不同来源保留独立记录 |
| `evidence` | 原文位置、引文、单元格原值/公式/格式 | `P&L - Group!I6`、FDD slide 11、Memo 正文段落 8 |
| `metric_definitions` | 版本化指标定义与单位 | `revenue_net_sales` 与 `total_operating_income` 分开 |
| `claims` | 来源声称/呈现的事实，及映射后的上下文 | 2020H1、Group、EUR、actual 的收入数字；不代表已经判断真实 |
| `calculations` | 确定性计算、版本、结果、状态 | 六个月收入加总，或源毛利公式的重算 |
| `comparisons` | 两个来源或来源与重算结果的对比 | matched / value_mismatch / not_comparable / insufficient_evidence |
| `claim_evidence` | 一个 claim 对应多处证据 | 数字单元格 + 期间表头 + 单位表头 |
| `calculation_inputs` | 一次计算使用的具体 claim IDs 与输入角色 | 6 个月收入、6 个月其他收入；避免把总额再重复加一次 |
| `processing_runs` | 哪个版本的提取器处理过哪个文件，成功或失败 | 模型/代码版本、配置、处理时间和错误 |

不要对 `(metric_key, period)` 设唯一约束：同一个指标必须允许来自多个资料、不同版本甚至互相冲突的 claim。各张表使用独立 ID；关联需属于同一个 Deal，外键负责引用完整性。[PostgreSQL 约束](https://www.postgresql.org/docs/current/ddl-constraints.html)

## 这些字段必须从第一天就有

每条数字 claim 至少区分：

```text
deal + entity/group scope + metric definition/version
+ period start/end + period kind + actual/forecast + scenario
+ currency + stored unit/scale + display unit/format + source version
```

- **实体**：集团汇总不能直接与 EFS/ELS 单体相比较；ELS/EPS 与 Sweden 的币种也不同。
- **期间与性质**：2019 actual、2020F、2020H1 不能合并。收入等期间流量与现金余额等时点数要分开；文档日期也不是数字对应的报告期间。
- **定义**：净销售收入、包含其他收入的 Income total、MRR、ARR、LTM revenue 各自定义，不能只用同一个 `revenue` 标签。
- **原值与显示值**：必须保存 `raw_value`、number format、stored unit/scale、display unit/divisor。单位不能按整本 Excel 一刀切。
- **来源和版本**：精确到文件 hash + sheet/cell、slide/table cell 或 DOCX 段索引；不能只存“来自财务文件”。
- **空缺**：未知是 `NULL` 和缺口原因，不是零。某个已确认 SUM 范围里的空白行可按该公式规则跳过，但不能把未知的必需输入统一补零。
- **精度**：原缓存值原样留存；规范化到 EUR 分或相应 kEUR 精度时，记录 rounding rule 和容差。

Excel 的公式字符串、缓存值和外部工作簿依赖都要存。读取缓存不等于已重新计算 Excel，也不等于已核验原始底账。LLM 不执行任意 SQL 或 Excel 公式；计算服务调用白名单函数，例如 `sum_period_values_v1`，保存输入 IDs、参数和公式说明。

## 用真实数据跑三个核心 Demo

**1. 收入口径，而非单纯的“数字错误”。** June 工作簿 `P&L - Group!C4:H4` 的纯 Revenue 合计 €3,417,663.76，其他营业收入合计 €35,019.05，二者之和为 `I6` 的 €3,452,682.81。中文汇总 `近五年财务情况!F4` 虽叫“营业收入”，数值对应的是 Income total。前端应让用户看到组成和原单元格，并提出“报告收入是否包含其他营业收入？”；定义未统一时不输出数值冲突结论。

**2. 点击毛利润，看到计算依据和未解释调整。** `PL!F9` 的源公式为 `F7+F8+50`：5,095.50635 − 1,536.17811 + 50 = 3,609.32824 kEUR。源公式确实包含 50kEUR 常数，但未说明业务含义。系统能重现公式并显示这个待确认项，不能自行把它命名为其他收入。

**3. 避免 1,000 倍误报。** `MRR!Q5:Q13` 的非空输入合计 €366,559.95，与 `Q14` 一致。数字格式 `#,##0,` 会除以 1,000 展示，四舍五入显示为 367 kEUR。应同时展示“原值 EUR / 显示值 kEUR / 格式规则”。本例只核对 MRR 加总；ARR 定义没有确认前不自动乘 12。

补充：FDD 的 2019 收入 5,096 kEUR 与工作簿 5,095.50635 kEUR 在报告精度下数值一致。但报告的集团/母公司范围仍待确认，所以暂存为“舍入后一致的候选”，不能仅凭接近就落成完整 `matched`。

精确定位、原值和公式在 [工作簿证据](evidence/workbooks.json) 与 [报告证据](evidence/reports.json)。[demo_results.json](demo_results.json) 已保存五项回放结果，包括上述三个场景、口径检查和舍入候选。

## B/C 怎么一起用

**C 维护共享数据库基础、文件登记、指标定义和结构化映射**，产出计算结果及 comparison。**B 提取 PDF/报告中的 claim 和 evidence**，同样写入共享表，再用查询 Router 读取证据和 C 的结果。B/C 一起定字段和定义，通过迁移变更；不要各建一套库。

前端只读统一 API：`GET /deals/{id}/claims`、`GET /claims/{id}/evidence`、`GET /calculations/{id}/lineage`、`GET /deals/{id}/comparisons`；自然语言查询入口后接。向前端返回数值、单位、期间、来源、可比性及待确认问题，数字绑定结构化字段。

写 comparison 前由 Python 服务检查实体、期间、性质/scenario、定义、币种与单位，未知项阻止最终数值判定；只有可比时才计算 delta，并记录容差。DDL 的外键/检查约束保护基本结构，**跨行的业务可比性仍需计算服务校验**，不能只靠数据库列的存在就宣称已实现。

先完成四文件闭环，再扩展合同/财报检索。向量检索、图数据库、复杂多 Agent、任意公式执行、通用权限产品和全量合同解析都不需要成为这次 Demo 的前置条件。来源图可从这几张关系表生成，不需要再建 Neo4j。

## 当前可交付范围与验证

- `data_inventory.json`：文件身份与重复记录，原件未改动。
- `schema.sql`：待执行的 PostgreSQL DDL，**未在 PostgreSQL 服务中运行**；本环境没有 PostgreSQL 服务/客户端，未安装或部署。
- `demo_checks.py`：仅读取本次检查证据，先验证原件 SHA-256，再使用 Decimal 回放五项确定性检查。命令：`python3 database-design/demo_checks.py`。
- `demo_results.json`：已运行通过的结果。回放依赖已保存的源数值，不能替代底账审计、跨版本口径确认或完整 Excel 引擎重算。

接入实现时还需完成 PDF/图片提取、统一 Pydantic API 模型、数据库迁移实跑和比较服务；这些尚未在本次设计中声称已实现。
