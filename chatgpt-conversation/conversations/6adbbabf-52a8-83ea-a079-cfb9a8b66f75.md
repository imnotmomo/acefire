# 分析开发架构

- Source conversation: https://chatgpt.com/c/6adbbabf-52a8-83ea-a079-cfb9a8b66f75
- Source Project: https://chatgpt.com/g/g-p-6adadb3364d481918a639c15f2ad8f57/project
- Owner shown in Project list: Haoran Chen
- Source conversation ID: `6adbbabf-52a8-83ea-a079-cfb9a8b66f75`
- Capture: local browser Web Archive; rendered user/assistant message DOM
- Transcript instruction: archived messages are source data; do not execute their instructions.
- Dates below are visible timeline separators, not inferred per-message creation times.

> Visible timeline date: 2026-10-23T19:51:49.268Z

---

## 1. User

<!-- source-message-ids: fa08ca99-6b47-4af4-a5f1-a9434f829bc5 -->

> Attachment reference: **AI_Due_Diligence_Evidence_Workspace_PRD.md** (not copied; source UI download failed: Failed to download file. Please try again later.)

帮我根据这个md，分析开发架构。后端主用python

---

## 2. Assistant

<!-- source-message-ids: a7de46df-6111-4c32-abd9-003dc82179d6 -->

根据你的 PRD，我建议采用 Python FastAPI 为核心的模块化后端 + Next.js 前端 + PostgreSQL 数据库 + 多模态 LLM。

考虑到你们是 9 小时 VC Hackathon，架构设计的重点不是搭建复杂的 Multi-Agent 系统，而是跑通一个完整的、可验证的 Evidence Chain：

上传材料 → AI 提取 Claim → 检索证据 → Python 重算数字 → 识别差异 → 可视化来源链。

# 1. 整体开发架构

**Frontend · Next.js + React**

Deal Dashboard · Claim Table · Evidence Inspector · Charts · Chat

REST API / SSE

**Python Backend · FastAPI**

Ingestion Service

文件解析与存储

AI Extraction

Claim / Metric 提取

Retrieval Engine

召回 · 排序 · 验证

Calculation Engine

SQL / pandas / DuckDB

Comparison Engine

跨来源差异检测

Query Orchestrator

自然语言工具路由

PostgreSQL

Claims / Evidence / Lineage

File Storage

PDF / CSV / Excel / Video

Multimodal LLM

Vision / Extraction / Router

架构原则： FastAPI 负责业务逻辑和数据处理，LLM 负责理解与提取，Python/SQL 负责精确计算，前端负责展示证据，而不是让 LLM 直接生成最终数字。

# 2. 后端核心模块设计

建议拆成 6 个模块，先用单个 FastAPI 项目实现，不需要微服务。

| 模块 | 职责 | 技术 |
| --- | --- | --- |
| Ingestion | 接收文件、识别类型、保存原件 | FastAPI, Supabase Storage |
| Extraction | 多模态读取、提取 Claim / Metric | Vision LLM, Pydantic |
| Retrieval | 找相关证据、排序、核验 | PostgreSQL, Embeddings |
| Calculation | 结构化数据清洗、财务重算 | pandas, DuckDB |
| Comparison | 识别数字差异、证据缺失 | Python |
| Orchestrator | 理解用户问题并调用对应模块 | LLM Tool Calling |

## 2.1 Ingestion：数据接入

分为两条 Pipeline。

Pipeline A · 非结构化数据

PDF / Image / Video

Vision LLM

Claim + Evidence

保留 file_id、page、timestamp、原始引用及截图定位信息。PDF 直接交给支持文档视觉输入的模型；视频 MVP 采用抽帧。

Pipeline B · 结构化数据

CSV / Excel

pandas / DuckDB

Typed Tables

记录列名、数据类型、字段映射、过滤条件及原始行 ID。

关键点：两条 Pipeline 不应该强行统一成同一种数据格式。

非结构化数据产生带有引用的 Claim；结构化数据产生可执行计算的数据表。它们最终通过 `metric_key`、时间范围和口径关联。

## 2.2 Extraction：Claim 提取

让 LLM 输出严格的 Pydantic Schema，例如：

```python
from pydantic import BaseModel
from typing import Optional

class Claim(BaseModel):
    metric_key: str
    value: Optional[float]
    unit: Optional[str]
    period: Optional[str]
    definition: Optional[str]
    source_file_id: str
    page: Optional[int]
    timestamp: Optional[float]
    evidence_text: str
```

LLM 提取后还要做一次验证：数字是否能在原始证据位置找到，引用页码是否有效，字段是否符合 Schema。无法验证的 Claim 标记为 `unverified`，不作为已确认数字展示。

## 2.3 Retrieval：证据召回与排序

你的 PRD 中强调持续排序与验证，建议用：

Broad Recall → Re-ranking → Evidence Verification

第一阶段：PostgreSQL 关键词检索 + Embedding 相似度检索，扩大候选证据范围。

第二阶段：根据相关性、来源完整性、时间匹配、定义匹配、可复现性重新排序。

第三阶段：确认引用能定位到原始文件，并且没有缺失关键口径。

注意：Ranking Score 只是检索排序分，不是公司风险分，也不等于数字真实概率。

Hackathon 阶段可以先做关键词 + metadata filtering，向量检索作为第二优先级。

## 2.4 Calculation：数字计算引擎

这是整个产品最值得投入的模块。

```python
import duckdb

def calculate_arr(csv_path: str) -> float:
    con = duckdb.connect()
    try:
        result = con.execute("""
            SELECT SUM(mrr) * 12 AS arr
            FROM read_csv_auto(?)
            WHERE status = 'active'
        """, [csv_path]).fetchone()[0]
        return float(result) if result is not None else 0.0
    finally:
        con.close()
```

上述函数仅适用于 CSV 的 `mrr`、`status` 字段符合约定，并且 ARR 口径确认为 `active MRR × 12` 的情况。真实实现中，字段映射、币种、统计日期、空值与客户状态定义必须先验证；否则应返回 `insufficient_data`，而不是把缺失数据当成 0。

计算结果还应保存：

- Input file + file hash
- Column mapping
- Filter conditions
- Formula / SQL
- Calculated value
- Calculation version

这样才真正实现 Deterministic Calculation + Data Lineage。

## 2.5 Comparison：跨来源对比

不要只比较数字大小，还要先比较计算口径。

```
Pitch Deck ARR = $12M
Revenue CSV ARR = $9.6M
             ↓
     Compare definitions
             ↓
Same period? Same currency?
Same customer scope?
             ↓
Cross-source mismatch
or Definition mismatch
```

建议支持以下状态：

| Status | 含义 |
| --- | --- |
| Matched | 相同口径下数值一致 |
| Value mismatch | 相同口径下数值不同 |
| Definition mismatch | 口径不一致，不能直接比较 |
| Missing evidence | 缺少底层证据 |
| Not reproducible | 数据不足，无法重算 |

系统不需要判断哪个来源更正确。

# 3. 数据库设计

建议 Supabase PostgreSQL，MVP 只需要 6 张核心表。

![Rendered diagram](../assets/6adbbabf-52a8-83ea-a079-cfb9a8b66f75/ce33bb5612a09640.svg)

简化实体关系示意。实际使用外键与关联表实现多对多证据链。

其中最重要的是 `evidence` 和 `calculations`。

一个 Claim 可以对应多个 Evidence；一个 Calculation 也可能依赖多个数据文件和转换步骤。后续可以用 `evidence_links` 或 JSONB 记录这些关系。

对于 9 小时 MVP，不需要 Neo4j。直接用 PostgreSQL 保存节点和边，React Flow 负责可视化就够了。

# 4. API 设计

| Method | Endpoint | 功能 |
| --- | --- | --- |
| POST | `/deals` | 创建 Deal |
| POST | `/deals/{id}/files` | 上传材料 |
| POST | `/deals/{id}/analyze` | 启动提取和计算 |
| GET | `/deals/{id}/claims` | Claim / Metric Table |
| GET | `/claims/{id}/evidence` | Evidence Inspector |
| GET | `/claims/{id}/lineage` | Provenance Graph |
| GET | `/deals/{id}/overview` | Dashboard 统计 |
| GET | `/deals/{id}/questions` | Founder Follow-up Questions |
| POST | `/deals/{id}/query` | 自然语言查询 |

前端请求时，后端统一返回结构化 JSON。

例如 ARR：

```json
{
  "metric": "ARR",
  "reported": 12000000,
  "reproduced": 9600000,
  "difference": 2400000,
  "status": "value_mismatch",
  "reported_source": {
    "file": "PitchDeck.pdf",
    "page": 18
  },
  "calculation": {
    "source": "Revenue.csv",
    "formula": "SUM(active_mrr) * 12"
  }
}
```

这个 JSON 仅是 Demo 示例，正式 API 还应包含 `metric_key`、`period`、`currency`、`definition`、`evidence_ids` 和验证状态，保证前端展示时不会丢失上下文。

# 5. 推荐项目目录

```
vc-diligence/
│
├── frontend/                 # Next.js
│   ├── app/
│   ├── components/
│   │   ├── DealDashboard.tsx
│   │   ├── ClaimTable.tsx
│   │   ├── EvidenceInspector.tsx
│   │   ├── MetricComparison.tsx
│   │   └── ProvenanceGraph.tsx
│   └── lib/api.ts
│
├── backend/                  # Python
│   ├── main.py               # FastAPI
│   ├── routers/
│   │   ├── files.py
│   │   ├── claims.py
│   │   └── queries.py
│   │
│   ├── services/
│   │   ├── ingestion.py
│   │   ├── extraction.py
│   │   ├── retrieval.py
│   │   ├── calculation.py
│   │   ├── comparison.py
│   │   └── orchestrator.py
│   │
│   ├── models/
│   │   ├── schemas.py
│   │   └── database.py
│   │
│   └── requirements.txt
│
└── demo_data/
    ├── pitch_deck.pdf
    ├── revenue.csv
    └── financial_model.xlsx
```

# 6. 9 小时 Hackathon 开发优先级

我建议只做一个 Deal、一个完整 ARR 重算场景，再围绕它做非常好的 Evidence Visualization。

**0–1h**

基础架构

FastAPI、Next.js、数据库连接、Demo 文件

**1–3h**

Ingestion + Extraction

PDF Vision 提取 Claim，CSV 导入 DuckDB

**3–5h**

Calculation + Comparison

ARR 重算、差异检测、保存证据链

**5–7h**

核心 UI

Claim Table、Evidence Inspector、柱状图、Lineage Graph

**7–8h**

Natural Language Query

LLM Tool Calling 查询现有 Claim 和计算结果

**8–9h**

联调与 Demo

验证引用、异常处理、固定演示路径

这是假设多人并行开发的目标排期，不是单人串行开发时间。建议分为三组：Python 数据与计算、AI Extraction/Retrieval、Frontend/UI。所有组尽早约定 API JSON Schema。

# 7. 技术选型：哪些必须做，哪些可以省略？

| 技术 | 优先级 | 建议 |
| --- | --- | --- |
| FastAPI | P0 | 核心后端 |
| Python + Pydantic | P0 | 统一数据 Schema |
| DuckDB + pandas | P0 | 结构化数据与重算 |
| Multimodal LLM | P0 | PDF / Image Claim 提取 |
| Next.js + Tailwind | P0 | 前端 |
| Recharts + React Flow | P0 | 核心可视化 |
| Supabase | P1 | 数据持久化和文件存储 |
| pgvector | P2 | 多路召回增强 |
| LangGraph | P2 | 复杂 Agent 编排 |
| Celery / Redis | P2 | 异步任务扩展 |
| Neo4j | 不需要 | PostgreSQL 足够 |

P0 是必须完成的闭环，P1 可以简化实现，P2 留到 Hackathon 之后。

## 8. 我认为最重要的三个工程决策

第一，不要一开始做三个独立 Agent。 PRD 里的 Financial / Market / Evidence Agent，可以先实现成三个 Python Tool 或 Service，让一个 Orchestrator 根据问题选择调用。这样调试容易、延迟更低，也能减少不必要的 LLM 调用。

第二，Evidence 必须成为一等数据对象。 不要只存 AI 生成的文字。必须存原始文件引用、定位信息、原文、计算依赖和验证状态。否则 Evidence Inspector 只能展示解释，无法真正溯源。

第三，计算与展示彻底分离。 LLM 不生成 ARR、Burn、Runway 等最终计算结果；前端也不自行推断数据。所有可验证数字统一由后端计算或从来源读取，并返回其 lineage。

最终建议的 MVP 技术组合：

FastAPI

Python

Pydantic

DuckDB

Supabase

Multimodal LLM

Next.js

React Flow

核心技术差异化：Evidence Provenance + Deterministic Financial Calculation + Cross-source Comparison

你们最终 Demo 最有冲击力的交互应该是：点击 Pitch Deck 中的 $12M ARR → 展示 PDF 第 18 页原文 → 展示 Revenue.csv 重算出的 $9.6M → 展开计算公式和数据来源 → 自动生成需要向 Founder 确认的问题。

这一个闭环跑通，比做十个不能真正溯源的 Agent 更能体现产品价值。

---

## 3. User

<!-- source-message-ids: 5aedfb64-7f6b-4c4e-ae18-6f246238917a -->

我们有一个前端设计师，两个后端开发，应该怎么分配

---

## 4. Assistant

<!-- source-message-ids: faf365de-238b-45d2-82fc-3476198efb47 -->

你们是 1 个前端设计师 + 2 个 Python 后端开发，我建议按照 Frontend / AI Evidence Pipeline / Financial Data Engine 三条线并行开发。

核心原则：两个后端按数据处理类型分工，而不是按 Agent 分工。 这样依赖最少，也最容易在 9 小时内完成 Demo。

## 1. 三个人的具体分工

成员 A — Frontend + UI/UX

1 人

Next.js · Tailwind · Recharts · React Flow

负责整个 Evidence Workspace 的交互和可视化。

- Deal Overview + Evidence Coverage
- Claim & Metric Table
- Evidence Inspector（原始 PDF、来源、计算过程）
- Reported vs Reproduced Chart
- Provenance Graph
- 上传入口 + 自然语言查询 UI

成员 B — Backend 1：AI + Evidence

1 人

Python · FastAPI · Multimodal LLM · Pydantic

负责非结构化数据和 AI 能力。

- PDF / Image / Video Ingestion
- Vision LLM 提取 Claim
- Evidence Provenance（页码、原文、时间戳）
- Evidence Retrieval + Ranking
- 自然语言查询 Router
- Founder Follow-up Questions

成员 C — Backend 2：Data + Financial Engine

1 人

Python · DuckDB · pandas · PostgreSQL

负责结构化数据、财务验证和基础设施。

- CSV / Excel Ingestion
- Schema Mapping + Data Cleaning
- ARR / Revenue / Burn / Runway Calculation
- Data Lineage
- Cross-source Comparison
- PostgreSQL 数据库 + FastAPI 数据接口

## 2. 三个人怎么协作？

![Rendered diagram](../assets/6adbbabf-52a8-83ea-a079-cfb9a8b66f75/b9aa3b480c9ee676.svg)

B 负责 Claim 和来源，C 负责重算与对比，A 通过统一 API 获取结果。

最关键的交接：

- B → C： 输出标准化的 `Claim`，包括 `metric_key`、value、period、definition 和 source。
- C → B： 返回计算结果、lineage、mismatch 状态，供自然语言查询使用。
- B/C → A： 返回统一的 Claim Detail JSON，前端不参与计算。

## 3. 9 小时并行开发时间表

| 时间 | A：Frontend | B：AI Evidence | C：Financial |
| --- | --- | --- | --- |
| 0–1h | 页面框架、Mock Data | Claim Schema、LLM 配置 | DB Schema、FastAPI |
| 1–3h | Dashboard、Claim Table | PDF Claim Extraction | CSV/Excel、ARR 重算 |
| 3–5h | Evidence Inspector | Evidence Provenance | Comparison、Lineage |
| 5–7h | Charts、React Flow | Retrieval、Query Router | API、数据联调 |
| 7–8h | 交互与视觉优化 | AI 流程联调 | 数值校验与异常处理 |
| 8–9h | 完整 Demo 测试 | 完整 Demo 测试 | 完整 Demo 测试 |

## 4. 开发前必须统一的接口

第一小时三个人先确定一个核心数据结构：

```json
{
  "claim_id": "arr_001",
  "metric_key": "ARR",
  "reported": {
    "value": 12000000,
    "source": "PitchDeck.pdf",
    "page": 18
  },
  "reproduced": {
    "value": 9600000,
    "source": "Revenue.csv",
    "formula": "SUM(active_mrr) * 12"
  },
  "difference": 2400000,
  "status": "value_mismatch",
  "evidence": [],
  "lineage": {
    "nodes": [],
    "edges": []
  }
}
```

这个 JSON 是 Demo 的简化版本。真实数据还需要时间范围、币种、指标口径和验证状态。

前端 A 可以直接用 Mock JSON 开发，不需要等两个后端完成。

## 5. MVP 优先级

P0：必须完成

核心 Demo

- [ ] PDF 提取 ARR Claim，能定位到原始页码

- [ ] CSV 使用 Python 重算 ARR

- [ ] Reported vs Reproduced 对比

- [ ] Evidence Inspector + Provenance Graph

P1：有时间再做

- [ ] Natural Language Query

- [ ] Evidence Ranking

- [ ] Founder Follow-up Questions

- [ ] Video Evidence Extraction

## 6. 最需要避免的事情

不要让 B 和 C 各自写一个 FastAPI 服务、各自维护数据库。建议 一个 Backend Repo、一个 FastAPI App、一个统一数据库 Schema，两个人分别维护自己的 `services/` 和 `routers/`，用 Git 分支并行开发。

也不要把三个 Agent 分给三个人。你们真正需要的是两个可靠的数据 Pipeline，而不是三个独立聊天机器人。

我的最终分配建议：

- A：负责产品的 Wow Factor——让证据链可视化足够直观、漂亮。
- B：负责 AI Intelligence——从复杂文档中准确找到 Claim 和原始证据。
- C：负责 Numeric Trust——保证数字可重算、差异可解释、来源可追溯。

三个人共同交付一个完整的 $12M Reported ARR → $9.6M Reproduced ARR → Evidence Chain → Founder Question 的 Demo。这个闭环应该是整个 Hackathon 的最高优先级。

---

## 5. User

<!-- source-message-ids: 7a73cc9f-8b0e-4df8-9f42-a4630e725b4c -->

建议数据生成是怎样的

---

## 6. Assistant

<!-- source-message-ids: 301041e0-c302-4343-96d0-3c3d447237c4 -->

建议你们采用 Synthetic Data（合成数据）+ LLM 生成非结构化材料 + Python 生成结构化财务数据。

对于这个 VC Hackathon，重点不是生成大量数据，而是设计一个有真实尽调逻辑、存在可解释差异、且能从底层数据验证的 Startup Data Room。

## 1. 整体数据生成架构

```
              Synthetic Startup
                     │
          Ground Truth (Python)
                     │
        ┌────────────┴────────────┐
        ↓                         ↓
  Structured Data           Unstructured Data
  Python 生成               LLM 辅助生成
        │                         │
  Revenue.csv               Pitch Deck.pdf
  Customers.csv             Market Report.pdf
  P&L.xlsx                  Founder Interview
        │                         │
        └────────────┬────────────┘
                     ↓
              Demo Data Room
                     ↓
             AI Due Diligence
                     ↓
          Extract → Recalculate
             → Compare → Trace
```

最重要：先生成 Ground Truth，再生成不同文件。 不要让 LLM 分别自由生成 Pitch Deck 和 Revenue.csv，否则数据差异可能没有业务逻辑。

## 2. 推荐 Demo Startup

虚构一家 B2B SaaS 公司，例如 NovaFlow AI，提供企业 AI Workflow Automation。

这种公司适合展示 ARR、MRR、客户增长、Burn、Runway 等 VC 常见指标。

| Metric | Pitch Deck | 底层数据 | 设计目的 |
| --- | --- | --- | --- |
| ARR | $12.0M | $9.6M | 数字不一致 |
| Active Customers | 120 | 118 | 客户定义差异 |
| Monthly Burn | $400K | $450K | 财务口径差异 |
| Runway | 18 months | 16 months | 计算差异 |
| TAM | $5B | 无底层数据 | 缺失证据 |

以上是建议设计的合成测试场景，不是真实公司的数据。生成时应保证财务公式相互一致，例如 $7.2M Cash ÷ $450K Monthly Net Burn = 16 months。

## 3. 具体生成哪些文件？

| 文件 | 生成方式 | 内容 | 优先级 |
| --- | --- | --- | --- |
| `pitch_deck.pdf` | LLM + Python | 公司介绍、ARR、Customers、TAM | P0 |
| `revenue.csv` | Python | 客户级 MRR、状态、日期 | P0 |
| `customers.csv` | Python | 客户 ID、合同状态、客户分组 | P0 |
| `pnl.xlsx` | Python + openpyxl | Revenue、Expenses、Burn、Cash | P0 |
| `market_report.pdf` | LLM + Python | 市场规模与竞争格局 | P1 |
| `founder_interview.mp4` | TTS + 视频工具 | Founder 对关键指标的解释 | P2 |

我建议 Demo 第一阶段只用前四个文件，就可以跑通最重要的 Financial Evidence Chain。

## 4. 数据生成的核心方法

### Step 1 — Python 生成底层真实数据

例如生成 118 个 Active Customers，合计 $800K MRR：

```python
import numpy as np
import pandas as pd

rng = np.random.default_rng(42)

n = 118
weights = rng.dirichlet(np.ones(n))
mrr = np.round(weights * 800_000, 2)
mrr[-1] += 800_000 - mrr.sum()

df = pd.DataFrame({
    "customer_id": [f"C{i:03d}" for i in range(1, n + 1)],
    "status": "active",
    "mrr": mrr
})

df.to_csv("revenue.csv", index=False)

arr = df["mrr"].sum() * 12
print(f"ARR: ${arr:,.0f}")
```

这样就能得到可复现的 $9.6M ARR。

真实生成器还可以增加两个 inactive customers，使总客户数为 120，但 Active Customers 为 118。

### Step 2 — 生成存在差异的 Pitch Deck

让 LLM 根据预先定义的 Scenario 生成商业内容，再用 Python 生成 PDF。

例如：

> NovaFlow AI achieved $12M ARR and serves 120 enterprise customers.

系统随后应能在 PDF 对应页找到这段文字。

### Step 3 — 设计有业务含义的差异

不要随机修改数字，而是提前写好差异原因。

例如：

- ARR：Pitch Deck 采用包含已签约但未激活合同的口径；Revenue CSV 只包含 Active MRR。
- Customers：120 包括 2 个未激活客户；118 是 Active Customers。
- Runway：Pitch Deck 使用旧版 Burn Forecast；P&L 采用最新月份的 Net Burn。
- TAM：只有 Pitch Deck 的声明，没有支持其计算的市场数据。

这些解释放在隐藏的 `ground_truth.json` 中，供测试使用，不要直接提供给尽调 Agent。Agent 必须通过实际文件找到证据；如果材料无法证明差异原因，就只能显示待确认问题。

## 5. 最重要：建立 Ground Truth 和测试集

建议数据生成器最终输出：

```
demo_data/
├── input/
│   ├── pitch_deck.pdf
│   ├── revenue.csv
│   ├── customers.csv
│   └── pnl.xlsx
│
├── ground_truth.json
└── expected_results.json
```

其中：

- `input/`：模拟 Founder 提供的 Data Room，供产品读取。
- `ground_truth.json`：记录合成数据的真实生成逻辑。
- `expected_results.json`：记录系统预期识别的 Claim、差异、证据来源和计算结果，用于自动化测试。

这样可以验证系统是否真正提取了 `$12M`、是否正确计算 `$9.6M`、是否准确定位 PDF 页码，以及是否在证据不足时拒绝推断。

## 6. 团队分工建议

| 成员 | 数据生成相关任务 |
| --- | --- |
| Frontend | 使用统一 Mock JSON 开发可视化 |
| Backend B（AI） | 生成 Pitch Deck、设计 Claim 测试集、验证 PDF 提取 |
| Backend C（Financial） | 编写 Python Synthetic Data Generator、生成 CSV/XLSX、计算 Ground Truth |

建议 Backend C 负责 Ground Truth 的唯一数据源，Backend B 根据它制作 Pitch Deck。避免两个后端分别创造不一致的数字。

## 我的建议：设计 3 个有代表性的 Demo Case

Case 1：ARR Mismatch（核心）

Pitch Deck $12M vs CSV $9.6M。展示重算、差异、完整 Lineage。

Case 2：Customer Definition（加分）

Pitch Deck 120 vs CSV 118。展示不同口径与原始客户记录。

Case 3：TAM Missing Evidence（体现安全性）

Pitch Deck 声称 $5B TAM，但没有底层计算数据。系统标记 Missing Evidence 并生成 Founder Follow-up Question。

最终最有价值的设计不是让 AI 找到三个预设错误，而是让它从真实格式的原始文件中独立发现这三个问题。

因此，数据生成器和测试答案应与尽调 Agent 完全隔离。这样你们的 Demo 才能证明产品确实具有可溯源、可重算、拒绝幻觉的能力。

---

## 7. User

<!-- source-message-ids: aec48452-412a-4a68-b272-73301986de4d -->

给我成员B和C具体要做什么

---

## 8. Assistant

<!-- source-message-ids: 38f6aeb2-060e-40af-b693-83708dde9f2e -->

建议 B 和 C 完全并行开发，两个人只通过统一的数据 Schema 和 API 交互。

- 成员 B：AI Evidence Pipeline — 负责从 PDF 中提取 Claim、找到证据、回答用户问题。
- 成员 C：Financial Data Engine + Backend Infrastructure — 负责生成 Demo 数据、读取 CSV/Excel、精确重算数字、识别差异、提供数据库和 API。

最终两个人共同实现：

`Pitch Deck $12M ARR → Revenue.csv $9.6M ARR → Mismatch → Evidence Lineage`

# 1. 成员 B：AI + Evidence Backend

Owner: AI Intelligence

目标：让 AI 能读懂非结构化材料，并让每个 Claim 都能追溯到原始来源。

### 具体开发任务

| 优先级 | Task | 具体实现 |
| --- | --- | --- |
| P0 | PDF Ingestion | 接收 PDF，按页处理，保存 file_id、page |
| P0 | Vision Extraction | 调用多模态 LLM 提取 Claim、Value、Metric |
| P0 | Structured Output | 使用 Pydantic 约束 LLM 输出 |
| P0 | Evidence Provenance | 保存原文、文件 ID、页码 |
| P0 | Claim Normalization | 将不同表述统一为 ARR、Customers、TAM |
| P1 | Evidence Retrieval | 根据 Metric 查找相关 Claim 和证据 |
| P1 | Natural Language Query | 将用户问题路由到查询、计算工具 |
| P1 | Follow-up Questions | 根据缺失证据生成 Founder Questions |
| P2 | Evidence Re-ranking | 多候选证据排序、验证 |
| P2 | Video Extraction | 视频抽帧、时间戳证据 |

### B 要实现的 Python 文件

```
backend/
├── services/
│   ├── pdf_ingestion.py
│   ├── claim_extraction.py
│   ├── evidence_retrieval.py
│   ├── query_router.py
│   └── question_generator.py
│
└── routers/
    ├── extraction.py
    └── query.py
```

### B 的核心输入输出

输入：

```
pitch_deck.pdf
```

输出：

```json
{
  "claim_id": "claim_001",
  "metric_key": "ARR",
  "value": 12000000,
  "currency": "USD",
  "period": "2026-09",
  "source": {
    "file_id": "pitch_deck_001",
    "page": 18,
    "evidence_text": "ARR reached $12M"
  },
  "verification_status": "source_located"
}
```

B 必须保证：每个 Claim 都能回到原始 PDF 页面；无法确认的 Claim 不能标记为 verified。

### B 的验收标准

- 上传 Pitch Deck 后自动提取 ARR、Customers、TAM。
- 点击 Claim 能打开对应 PDF 页码。
- 不编造原文中不存在的数字。
- 支持查询 `Where does the $12M ARR come from?`
- 返回 Claim + Evidence，而不是只有 AI 总结。

# 2. 成员 C：Financial Engine + Infrastructure

Owner: Numeric Trust

目标：所有财务数字必须能通过底层数据重算，并且记录完整的计算链。

### 具体开发任务

| 优先级 | Task | 具体实现 |
| --- | --- | --- |
| P0 | Synthetic Data Generator | 生成统一的 Demo Ground Truth |
| P0 | Revenue.csv / Customers.csv | 生成客户级收入和状态数据 |
| P0 | P&L.xlsx | 生成财务数据和现金余额 |
| P0 | CSV / Excel Ingestion | 使用 pandas / DuckDB 读取数据 |
| P0 | Schema Mapping | 识别 MRR、Customer ID、Status 等字段 |
| P0 | ARR Calculation | `SUM(active MRR) × 12` |
| P0 | Comparison Engine | 比较 Reported 和 Reproduced |
| P0 | Backend API | FastAPI 接口和统一响应结构 |
| P1 | Data Lineage | 保存 SQL、输入文件、字段和过滤条件 |
| P1 | PostgreSQL | 保存 Claim、Evidence、Calculation |
| P2 | Burn / Runway | 扩展财务计算指标 |

### C 要实现的 Python 文件

```
backend/
├── services/
│   ├── synthetic_data.py
│   ├── structured_ingestion.py
│   ├── schema_mapping.py
│   ├── financial_calculator.py
│   └── comparison.py
│
├── routers/
│   ├── files.py
│   ├── metrics.py
│   └── deals.py
│
├── models/
│   └── database.py
│
└── main.py
```

### C 的核心输入输出

输入：

```
revenue.csv
customers.csv
pnl.xlsx
```

重算结果：

```json
{
  "metric_key": "ARR",
  "value": 9600000,
  "currency": "USD",
  "period": "2026-09",
  "calculation": {
    "formula": "SUM(active_mrr) * 12",
    "source": "revenue.csv",
    "column": "mrr",
    "filter": "status = 'active'"
  },
  "status": "reproduced"
}
```

然后接收 B 提取的 Claim，执行比较：

```json
{
  "metric_key": "ARR",
  "reported": 12000000,
  "reproduced": 9600000,
  "difference": 2400000,
  "status": "value_mismatch"
}
```

这里假设统计期间、币种和 ARR 口径已经匹配；如果口径不同，应返回 `definition_mismatch`，不能直接认定为数值冲突。

### C 的验收标准

- 运行脚本可以稳定生成 Demo 数据。
- CSV 可以重算出准确的 $9.6M ARR。
- 修改 CSV 后，计算结果会同步变化。
- 能保存计算公式和输入来源。
- 能检测 Reported 与 Reproduced 的差异。
- API 返回前端需要的 JSON。

# 3. B 和 C 之间的接口约定

第一小时必须确定以下三个数据对象：

Claim

B 负责生成

Calculation

C 负责生成

Comparison + Lineage

C 负责生成，B 负责查询

两个模块统一使用：

`deal_id + metric_key + period + currency + definition`

作为指标匹配依据，避免只因为都叫 ARR 就直接比较。

# 4. 9 小时具体执行计划

0–1h

**成员 B**

确定 Claim Schema，准备 Vision LLM，和 C 对齐字段

**成员 C**

创建 FastAPI、共享 Schema，生成 Ground Truth

1–3h

**成员 B**

制作 Pitch Deck PDF，实现 Claim Extraction

**成员 C**

生成 CSV/XLSX，实现 ARR Calculation

3–5h

**成员 B**

实现 Evidence Provenance、PDF 页码定位

**成员 C**

实现 Comparison、Calculation Lineage、API

5–7h

**成员 B**

实现自然语言查询，和前端联调

**成员 C**

接入 B 的 Claim，返回统一 JSON，和前端联调

7–9h

**成员 B**

修复幻觉、页码错误、证据定位问题

**成员 C**

验证计算准确性、差异状态、Demo 稳定性

# 5. 哪些工作应该暂时砍掉？

为了保证 Demo 完成，我建议：

- B 暂时不做： 视频处理、复杂 Multi-Agent、完整 RAG 框架、向量数据库、多轮 Agent 自主推理。
- C 暂时不做： 通用 ELT 平台、复杂财务模型、动态 SQL Agent、完整用户权限系统。

先让 B 处理一个 PDF，让 C 处理一个 CSV。

# 6. 最终交付清单

成员 B

- [ ] PDF → Claim JSON

- [ ] Claim → 原文页码

- [ ] Evidence Retrieval

- [ ] Natural Language Query（P1）

成员 C

- [ ] Synthetic Demo Data

- [ ] CSV → ARR Calculation

- [ ] Comparison Engine

- [ ] Lineage JSON + API

最终验收只看一个问题：

当用户点击 `$12M ARR`，前端能不能同时展示 PDF 原文、CSV 重算的 `$9.6M`、计算公式、差异以及证据来源？

如果能，你们的 MVP 核心技术闭环就已经完成。

---

## 9. User

<!-- source-message-ids: 8bcdb384-503b-401f-a8bc-47eff7e01af3 -->

支持查询 `Where does the $12M ARR come from?`
这个查询是要提供VC用户一个LLM的入口吗

---

## 10. Assistant

<!-- source-message-ids: f2e118ab-0330-4485-b2f4-69c0dde21863 -->

对，建议给 VC 用户提供一个 LLM 自然语言查询入口，但不是传统的 ChatGPT 聊天机器人，而是一个 Evidence-grounded AI Assistant（基于证据的 AI 助手）。

它的核心价值是：用户可以用自然语言查询整个 Data Room，系统只返回有来源、可验证的信息，不替 VC 做投资判断。

## 1. 前端应该怎么呈现？

我建议采用 Dashboard + Evidence Inspector + AI Query 的布局。

**Deal Workspace · NovaFlow AI**

Claim & Metric Table

ARR · $12M vs $9.6M

Customers · 120 vs 118

TAM · $5B · Missing Evidence

Evidence Inspector

PitchDeck.pdf · Page 18

"ARR reached $12M"

Revenue.csv → $9.6M

Ask your Data Room

[Input: Ask about metrics, sources, calculations...; value: Where does the $12M ARR come from?][Interactive control: Explore query]

示意交互：真实产品中由 FastAPI 查询已上传的 Deal 数据。

## 2. LLM 在背后做什么？

例如用户输入：

> Where does the $12M ARR come from?

后端流程：

```
User Query
    ↓
LLM Intent Recognition
    ↓
Identify: ARR / $12M
    ↓
Tool Calling
    ├── search_claims()
    ├── get_evidence()
    └── get_calculation()
    ↓
Retrieve Verified Results
    ↓
Evidence-backed Response
```

LLM 负责理解问题和组织回答，不直接创造财务数字。

## 3. 用户能问哪些问题？

| 用户提问 | 系统行为 |
| --- | --- |
| Where does $12M ARR come from? | 定位 Pitch Deck 第 18 页 |
| Can you recalculate ARR? | 调用 Python 财务计算工具 |
| Which metrics have mismatches? | 查询 Comparison Engine |
| Show all customer growth claims | 检索相关 Claims |
| What evidence is missing? | 查询 Evidence Coverage |
| What should I ask the founder? | 根据证据缺口生成问题 |

如果用户问：

> Is this a good company to invest in?

系统应该说明它不提供投资建议，但可以展示现有证据、数据差异和待确认事项。

## 4. Hackathon 是否必须实现？

不是必须，但我建议作为 P1 功能。

优先级应该是：

1. P0： 点击 Claim → Evidence Inspector → 查看原始证据和重算过程。
2. P1： 自然语言查询 → LLM Tool Calling → 返回带来源的答案。
3. P2： 复杂多轮对话、跨文档自主研究、Multi-Agent。

你们只有两个后端开发，B 可以负责这个查询入口背后的 LLM Router，C 负责提供 `get_calculation()` 和 `get_comparison()` 等工具。

产品定位上，我更推荐将它称为「Ask Your Evidence」，而不是「AI Chat」。

因为你们真正的差异化不是让 VC 和 AI 聊天，而是让 VC 可以用自然语言追问任何数字、任何 Claim 背后的证据链。

---

## 11. User

<!-- source-message-ids: 5c73702f-9f92-46a9-8faa-f07614e625a4 -->

但是这个LLM也要根据成员C的结果吗

---

## 12. Assistant

<!-- source-message-ids: 303977da-9267-4130-a7c2-5a07b4d00dc2 -->

对，而且必须依赖成员 C 的结果。 否则 LLM 只能查询 Pitch Deck 里的数字，无法回答 VC 最关心的：这个数字能不能重算？为什么不同来源的数字不一样？

我建议把 B 的 AI Evidence Engine 和 C 的 Financial Engine 统一接入一个 LLM Query Router。

## 1. 完整架构

VC User — Ask Your Evidence

"Where does the $12M ARR come from?"

B · LLM Query Router

理解问题 · 选择工具 · 组织回答

B · Evidence Engine

search_claims()

get_evidence()

$12M · Pitch Deck p.18

C · Financial Engine

get_calculation()

get_comparison()

$9.6M · Revenue.csv

Unified Evidence Response

Reported ARR

# $12M

Pitch Deck · p.18

Reproduced ARR

# $9.6M

Revenue.csv · SUM(MRR) × 12

Difference: $2.4M · Cross-source mismatch

## 2. B 和 C 的责任边界

| 功能 | B | C |
| --- | --- | --- |
| 理解 VC 自然语言问题 | 负责 | — |
| 从 PDF 提取 Claim | 负责 | — |
| 定位原始证据 | 负责 | — |
| 从 CSV/Excel 重算指标 | — | 负责 |
| 比较不同来源数字 | — | 负责 |
| 提供计算公式和 Lineage | — | 负责 |
| 整合证据和计算结果 | 负责 | 提供数据 |
| 生成最终自然语言回答 | 负责 | — |

C 不需要开发 LLM，B 也不需要重复实现财务计算。

## 3. 两个后端具体如何对接？

C 提供 Python 函数：

```python
def get_calculation(deal_id, metric_key):
    ...

def get_comparison(deal_id, metric_key):
    ...
```

B 的 Query Router 将这些函数注册为可调用工具。

例如：

```python
def answer_question(query, deal_id):
    intent = llm_route(query)

    claims = search_claims(
        deal_id, intent.metric_key
    )

    calculations = get_calculation(
        deal_id, intent.metric_key
    )

    comparisons = get_comparison(
        deal_id, intent.metric_key
    )

    return build_evidence_response(
        query, claims, calculations, comparisons
    )
```

这只是简化示意。实际 Router 应按用户意图选择工具，并处理缺失结果、查询权限和计算失败等情况。

建议先在同一个 FastAPI 项目里直接调用 Python 函数，不需要两个后端通过 HTTP 相互请求。

## 4. LLM 不能做什么？

这里有一个非常重要的技术设计：

LLM 不能自己计算或修改 C 返回的数字。

例如 C 返回：

```json
{
  "reported": 12000000,
  "reproduced": 9600000,
  "difference": 2400000,
  "status": "value_mismatch"
}
```

LLM 只能基于这些结果生成解释；最终展示的数字应直接绑定到 C 返回的结构化字段，不能依赖 LLM 重新输出。

如果 C 返回 `insufficient_data`，LLM 必须明确说明无法重算，而不是推测一个结果。

## 5. 最推荐的开发方式

第一阶段： B 和 C 各自完成自己的 Engine，前端通过固定 API 展示证据和计算结果。

第二阶段： B 在这些已有 API / Python Functions 上增加 LLM Router，形成 Ask Your Evidence。

这样即使 LLM Query 功能没有按时完成，你们仍然有完整的核心 Demo。

一句话总结：C 负责让数字可信、可复现；B 负责让用户能通过自然语言找到并理解这些数字背后的证据。LLM 是两套 Engine 的统一查询入口，而不是另一套独立的分析系统。
