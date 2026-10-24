# Ingenium Hackathon Pitch

## 一句话

**Ingenium turns an investment firm's metric playbook into an evidence-first data agent for every new deal.**

Ingenium 不是某一家公司的固定 Dashboard，也不是只会总结文档的聊天套壳。投资机构先定义自己的 Semantic Layer 与 Metric Catalog；创建新项目后，Agent 在该项目的 Data Room 中寻找兼容证据、执行指标逻辑，并把每个结果连回原始文件、期间、公式和假设。

## 为什么现在的尽调流程有问题

投资团队通常已经知道要看什么，但每个项目的数据表达方式都不同：收入可能散落在财务模型、Pitch Deck、管理层预测和第三方数据中；同一个名称可能对应不同期间、币种、主体和 Actual / Forecast 口径。

传统工具往往只给出一个数字或一段摘要。团队仍然需要手工回答：

- 这个数字来自哪里？
- 采用了哪个定义和期间？
- Actual 和 Forecast 是否被混在一起？
- 计算缺了什么数据？
- 报告中的表述能否回到原文？

## 产品答案

```text
Investment firm's Semantic Layer + Metric Catalog
                         ↓
                  Create New Project
                         ↓
             Search and structure the Data Room
                         ↓
       Match inputs by definition, period and scenario
                         ↓
          Calculate or explicitly return insufficient data
                         ↓
 Dashboard + lineage + cited report + follow-up questions
```

核心原则是：**每个数字必须是有来源的、可复现计算的，或者被明确拒绝计算。** Missing 不是 0，Forecast 不是 Actual，模型输出也不是独立验证。

## Pitch Catalog：三个主指标

### 1. Five-year total revenue

业务问题：在一个统一五年窗口内，公司累计产生或预计产生多少收入？

计算规则：

1. 选择最多五个不同财年，并保留每年的精确期间。
2. 同一年同时存在 Actual 与 Forecast 时，Actual 优先，避免重复计算。
3. Actual 年份不足五年时，使用 Forecast 年份补足。
4. 如果全部兼容数据仍不足五年，只汇总现有年份，同时显示 `n/5 years available`。
5. 主体范围、币种或收入定义不兼容时不得直接相加；应拆分展示或返回缺失状态。

Dashboard 输出：数值、年份覆盖、Actual/Forecast 构成、公式、输入记录和来源定位。

### 2. Catalog CAGR

当前投资机构 Catalog 的定义是：**已有历史 Actual 年度收入增速的算术平均值**。

```text
Catalog CAGR = sum(available historical Actual YoY growth rates)
               / number of available growth rates
```

这个机构定义不同于常规的 endpoint CAGR：

```text
Conventional CAGR = (ending revenue / starting revenue)^(1 / year intervals) - 1
```

产品必须展示 Catalog 公式和版本，不能悄悄替换定义，也不能默认把 Forecast 增速加入历史平均值。对外演示时建议称为 **Average annual revenue growth**，界面仍可保留机构内部别名 `CAGR`。

### 3. Valuation

优先级：

1. 如果资料中存在明确、可定位的估值，使用该估值并展示日期、币种和来源。
2. 如果不存在明确估值，计算 `Latest Actual Revenue × Revenue Multiple`。
3. Revenue Multiple 必须来自资料、交易条款或该投资机构 Catalog 中的场景参数，并标记为 assumption。
4. 缺少最近年度 Actual Revenue 或 Revenue Multiple 时，返回 `Insufficient data` 并生成明确的跟进问题，不能自行假设倍数。

## 4 分钟 Demo 路线

### 0:00–0:35｜问题与定位

从 Ingenium Landing 开始：投资团队的问题不是没有数据，而是数据分散、定义不一致、结论难以回到证据。

Pitch 话术：

> Every investment firm already has a mental model of the metrics it trusts. Ingenium turns that playbook into a reusable semantic layer, then runs it against every new data room with a complete evidence trail.

### 0:35–1:05｜Project 与 Data Room

进入 Projects，说明每一个 Project 都是隔离的尽调工作区。进入准备好的 Circle 或 `Enfuce · Document claims` 项目，展示已登记的来源、文件哈希和页码/字段定位。

不要声称当前浏览器上传已经自动完成全链路处理；新上传处理仍是待接入能力。Pitch 使用预先准备并已导入的来源数据。

### 1:05–2:20｜Ask the data / Calculation Lab

展示已有 Observation，然后选择来源输入并运行一个 Catalog 指标。首选 Five-year total revenue，因为它能同时展示：

- 多年份输入；
- Actual 与 Forecast 标签；
- 缺失年份覆盖；
- Agent 生成的 Python；
- 结果、执行记录和来源绑定。

如果现场模型或 Firebase 不稳定，打开已经保存的 Calculation，直接展示 value → formula → inputs → source 的链路，不进行付费实时调用。

### 2:20–3:10｜Evidence 与差异

点击结果进入 Evidence / Lineage：展示原始文件、精确位置、原值、公式和输入节点。强调 Ingenium 不会在来源冲突时偷偷选一个“正确答案”，也不会把 Missing 当成 0。

### 3:10–3:45｜Report Review

进入 Report，选择一段文字或数字。右侧 Findings 只展示该段明确引用的证据；Human revisions 与 Agent advice 分开。导出 Markdown 或 DOCX，说明引用随报告交付。

### 3:45–4:00｜收尾

> Other tools generate an answer. Ingenium generates an answer you can challenge: the definition, the calculation, the original evidence, and the missing data are all visible.

## 建议的 7 页 Pitch Deck

1. **Title** — Trusted diligence, powered by the world's evidence.
2. **Problem** — 投资团队重复寻找、核对和重建关键数字。
3. **Insight** — 每家投资机构已经有自己的指标语义，只是没有被产品化。
4. **Product** — Semantic Layer → Data Room → Agent Calculation → Evidence → Report。
5. **Live Demo** — Five-year revenue、Catalog CAGR、Valuation 三个指标。
6. **Why us** — 可复用机构定义、项目级隔离、精确溯源、明确拒绝缺失计算。
7. **Roadmap / Ask** — 自动 Catalog Runner、新文件实时处理、机构权限与生产部署。

## 当前代码与 Pitch 声明边界

### 已实现并可展示

- Ingenium Landing、Projects 与项目工作区；
- 历史 Enfuce 本地证据 Demo；
- Circle / Enfuce Document Claims 的后端 Report 与来源链路；
- PDF/Office 文档抽取及 source-bound claims 的代码路径；
- Firebase 存储与 DuckDB 导入/离线兼容；
- Agent 生成 Python、受限本地执行和计算审计记录；
- Evidence / Lineage、来源原文与数值冲突展示；
- 带引用的 Report Build / Review / Export；
- 全公司证据范围内、带引用校验的 Company Chat。

### Pitch 前必须在演示电脑准备

- 已授权的 Firebase/Google credentials；
- Nicrron API Key 与指定模型；
- 已导入的演示公司数据和原始文件 manifest；
- 本地 backend `127.0.0.1:8017` 与 frontend `127.0.0.1:5173`；
- 至少一个预先保存的成功 Calculation，作为断网或模型失败的 fallback。

### Roadmap，不能说成已完成

- New Project 创建后自动遍历并运行完整 Metric Catalog；
- 面向投资机构的 Catalog 管理与版本发布 UI；
- 浏览器新上传文件的自动抽取、归一化和即时入库；
- 生产级团队认证、权限、托管与多租户隔离；
- 已恢复的实时 Akta 数据连接。

## Demo 前检查清单

- [ ] 从全新浏览器窗口依次走完 Landing → Project → Dashboard → Evidence → Report。
- [ ] 确认演示项目、来源文件、页码和计算结果与 Pitch 话术一致。
- [ ] 确认 Actual / Forecast、币种、期间和 entity scope 标签可见。
- [ ] 准备 Five-year revenue 的成功结果，以及 Valuation 缺失倍数的拒绝结果。
- [ ] 提前打开需要的页面，关闭无关通知和开发工具。
- [ ] 保存一份离线演示录屏或关键截图。
- [ ] 不在屏幕、日志或仓库中展示 API Key、ADC 路径或私有文件路径。
