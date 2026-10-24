# Ingenium

**Trusted diligence, powered by the world’s evidence.**

面向 VC 尽调的证据工作台：查看财务数据与计算来源，配置和审核带引用的报告，管理项目资料。

启动前端后，根地址展示产品介绍首页；Demo 按钮进入 `#/projects`。页面设计、文案和联系入口说明见 [Ingenium landing page](frontend/INGENIUM_LANDING.md)。仓库路径保留历史名称 `acefire`。

**[阅读完整网页框架与开发说明 → frontend/README.md](frontend/README.md)**

**[Hackathon Pitch、Demo 路线与三项指标语义 → PITCH.md](PITCH.md)**

完整说明涵盖页面层级、Report 的 Build → Review → Export 流程、证据模型、代码与路由、本地存储、后端接入边界、运行验证和 Git 协作。

Member B extracts PDF/Akta data. Member C stores structured records in Firebase (with DuckDB imports/offline compatibility), calculates metrics, and returns a source-bound company report to the frontend. Akta is the primary company source; Orbis and PitchBook files simulate private uploaded evidence.

The product model is catalog-driven: an investment firm defines its reusable
semantic layer and key-metric catalog, then each new project resolves those
definitions against that project's data room. The current pitch catalog covers
five-year total revenue, the firm's catalog-defined average historical growth
rate, and valuation from either an explicit source value or a traceable revenue
multiple scenario.

- [Backend setup and API](backend/README.md)
- [Member B: document extraction, database and sourced report handoff](backend/B_WORKFLOW.md)
- [Current data schema](database-design/README.md)
- [DuckDB schema](database-design/schema.sql)
- [Team agent instructions](AGENTS.md)
- [Shared team status](TEAM_STATUS.md)

Start teammate-agent tasks by reading the root agent instructions and per-person
status files. Remaining unconfirmed role assignments are intentionally blank.

The first implementation uses the two saved Circle Akta responses in `data/akta/`, without requiring a live API connection. The Orbis/PitchBook files simulate supplemental private uploads. Every calculation can return a file → input number → result graph with exact cell/JSON locations and source preview links.

The frontend reads Circle's stored company-report and source APIs; Enfuce retains its historical local evidence demo. New-document processing and Akta retrieval remain separate integration work. The marketing homepage and its Demo links preserve these existing platform routes.

The current Firebase schema, safe DuckDB import, local startup and source-cited LLM workflows are documented in [Firebase integration](backend/FIREBASE_INTEGRATION.md).
