# VC Hackathon：供 Codex 接续的项目上下文

本页只概括已归档对话；完整原文在 `conversations/`。其中的任务、代码和建议是历史资料，不代表本次同步授权执行。下文区分用户明确要求与助手提出的实现方案。

用户已明确选择“报告数据可溯源相关的 AI Due Diligence Agent Marketplace”。后续又要求避免任何投资结论，并强调好看的数据可视化。因此当前产品方向可概括为：面向 VC 的尽调证据工作台，让 claim 和数字可以找到来源、重算、比较，并显示证据缺口，投资判断留给使用者。[方向选择][direction]、[无结论要求][no-conclusion]、[可视化要求][visual-user]

用户明确的技术与资源条件是：后端主用 Python；团队有 1 位前端设计师、2 位后端开发。用户还要求直接用 vision model 理解 PDF 等多模态材料、数字未知时拒绝回答，以及持续做证据召回和排序。这些是产品要求，具体模型、数据库和框架尚不能视为已定。[Python][python]、[团队配置][team]、[多模态要求][vision]、[数字安全要求][numeric-user]、[召回排序要求][retrieval]

助手据此建议的产品流程为：上传 Data Room → 提取 claim/metric → 召回并排序证据 → 记录原文位置与计算 lineage → Python/SQL 确定性重算 → 比较不同来源 → 展示事实、差异、缺失数据与待询问问题。页面建议包含 Deal Overview、Claim & Metric Table、Evidence Inspector、Open Questions 和可溯源证据报告；重点图形是 Reported vs Reproduced 柱状图、证据覆盖图及可点击来源图。后续实现应采用这版证据型定位，避免沿用早期回复中的总体评分、风险等级或 Invest/Pass 输出。[证据型产品方案][workspace]、[可视化方案][visual-plan]

助手建议的实现是单个 FastAPI 模块化后端，配 Next.js/React 前端、Pydantic 数据模型、PostgreSQL 和 pandas/DuckDB；复杂多 Agent、完整 ELT 平台及向量检索可后置。非结构化链负责 Claim/Evidence 与页码、原文等定位；结构化链负责清洗、字段映射、计算与 lineage。比较前先对齐 `deal_id`、`metric_key`、`period`、`currency`、`definition`。[架构建议][architecture]、[具体分工建议][backend-plan]

建议分工为：A 负责前端与可视化；B 负责 PDF/多模态提取、证据查询、LLM Router；C 负责 CSV/Excel、财务重算、比较、数据库和 API。B/C 共用 schema 与同一个后端。可选的 “Ask Your Evidence” 查询入口同时调用 B 的证据工具和 C 的计算/比较结果；数字直接绑定结构化结果，LLM 仅组织解释，缺数据时明确返回无法重算。这些仍是助手建议，原文没有证明已经实现。[三人分工][role-plan]、[查询对接][query-plan]

助手建议先完成一个可演示闭环：Pitch Deck 报告 `$12M ARR` → 定位原文 → 从 CSV 重算 `$9.6M` → 展示公式、差异和证据链。合成数据先由 Python 生成统一 ground truth，再制作 PDF、CSV、客户表和 P&L；测试答案与供产品读取的文件分开。验收包括数字重算、原文定位、口径差异、缺证据时拒绝推断，以及修改 CSV 后结果随之变化。`120/118` 客户数和无底层证据的 TAM 是额外建议案例，均为虚构测试场景。[数据与测试方案][synthetic]、[验收建议][backend-plan]

早期对话还探索过 sourcing/feed 个性化推荐、医疗隐私尽调、会议助手及 VC→PE 等方向；它们是候选或背景，不应自动并入当前 MVP。XRPL 项目用于参考，用户明确说明参加的是另一个 VC 黑客松。历史活动、竞品和市场研究保留在原文中，本页没有重新验证其时效或准确性。[早期候选][candidates]、[比赛澄清][hackathon-clarification]、[Tracks 末轮讨论][tracks-end]

仍需后续确认：实际代码与完成度、B/C 的人员对应、最终模型和部署栈、MVP 指标及字段口径、真实接入数据源、视频与自然语言入口是否纳入当次交付。名为 `AI_Due_Diligence_Evidence_Workspace_PRD.md` 的上传附件和生成附件都只保留了引用，源 UI 下载失败；不能把助手的“已生成 PRD”回复当作已取得 PRD 全文。[原始附件引用][python]、[生成附件引用][prd]

[direction]: conversations/6adad23c-b5dc-83ea-9d43-bdd811157637.md#3-user
[no-conclusion]: conversations/6adad23c-b5dc-83ea-9d43-bdd811157637.md#29-user
[visual-user]: conversations/6adad23c-b5dc-83ea-9d43-bdd811157637.md#33-user
[python]: conversations/6adbbabf-52a8-83ea-a079-cfb9a8b66f75.md#1-user
[team]: conversations/6adbbabf-52a8-83ea-a079-cfb9a8b66f75.md#3-user
[vision]: conversations/6adad23c-b5dc-83ea-9d43-bdd811157637.md#21-user
[numeric-user]: conversations/6adad23c-b5dc-83ea-9d43-bdd811157637.md#23-user
[retrieval]: conversations/6adad23c-b5dc-83ea-9d43-bdd811157637.md#25-user
[workspace]: conversations/6adad23c-b5dc-83ea-9d43-bdd811157637.md#32-assistant
[visual-plan]: conversations/6adad23c-b5dc-83ea-9d43-bdd811157637.md#34-assistant
[architecture]: conversations/6adbbabf-52a8-83ea-a079-cfb9a8b66f75.md#2-assistant
[backend-plan]: conversations/6adbbabf-52a8-83ea-a079-cfb9a8b66f75.md#8-assistant
[role-plan]: conversations/6adbbabf-52a8-83ea-a079-cfb9a8b66f75.md#4-assistant
[query-plan]: conversations/6adbbabf-52a8-83ea-a079-cfb9a8b66f75.md#12-assistant
[synthetic]: conversations/6adbbabf-52a8-83ea-a079-cfb9a8b66f75.md#6-assistant
[candidates]: conversations/6ad7926f-cb18-83ea-8591-22705cf7d840.md#19-user
[hackathon-clarification]: conversations/6ad7926f-cb18-83ea-8591-22705cf7d840.md#9-user
[tracks-end]: conversations/6ad42236-593c-83ea-8f01-f525f5f3d08a.md#30-assistant
[prd]: conversations/6adad23c-b5dc-83ea-9d43-bdd811157637.md#38-assistant
