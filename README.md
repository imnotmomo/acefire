# Acefire

面向 VC 尽调的证据工作台：查看财务数据与计算来源，配置和审核带引用的报告，管理项目资料。

**[阅读完整网页框架与开发说明 → frontend/README.md](frontend/README.md)**

完整说明涵盖页面层级、Report 的 Build → Review → Export 流程、证据模型、代码与路由、本地存储、后端接入边界、运行验证和 Git 协作。

Member B extracts PDF/Akta data. Member C stores it in local DuckDB, calculates metrics, and returns a source-bound company report to the frontend. Akta is the primary company source; Orbis and PitchBook files simulate private uploaded evidence.

- [Backend setup and API](backend/README.md)
- [Current data schema](database-design/README.md)
- [DuckDB schema](database-design/schema.sql)
- [Team agent instructions](AGENTS.md)
- [Shared team status](TEAM_STATUS.md)

Start teammate-agent tasks by reading the root agent instructions and per-person
status files. The three unconfirmed role assignments are intentionally blank.

The first implementation uses the two saved Circle Akta responses in `data/akta/`, without requiring a live API connection. The Orbis/PitchBook files simulate supplemental private uploads. Every calculation can return a file → input number → result graph with exact cell/JSON locations and source preview links.

The frontend framework and backend API are preserved as separate workstreams; wiring the frontend to the shared report/intake contracts is the next integration step.
