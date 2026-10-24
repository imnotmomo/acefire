# 美国公司独立案例数据

本目录增加三个互相独立的真实美国公司案例。每家公司保留自己的法人、期间和来源，不混成一家公司。现有 Enfuce 资料保持原位。

**已下载并核验发行人公开分发 PDF 5 份，已确认的数据库原生导出 13 份：Orbis 2 份 XLSX、PitchBook 11 张 PNG（10 张财务表、1 张员工图）。** 发行人 PDF 与供应商导出分开归档、计数；供应商文件不能当作发行人申报或内部底账。发行人 PDF 保留本次取得的字节，部分为 EDGAR 转换或新闻稿生成版本，不主张与 SEC 原始 HTML、旧下载地址或历史截止日的字节相同。三个案例仍是部分证据包。

| 案例 | 美国主体 | 财务窗口／披露时点 | 已保存内容 |
|---|---|---|---|
| [Marqeta](marqeta-2024/README.md) | Marqeta, Inc.，Delaware | FY2024；披露截止 2025-02-26，另保留 2023 合同生效日 | 3 份发行人 PDF：FY2024 10-K、业绩公告生成版、含 Block Amendment17 的 8-K/A；2 份衍生证据文件。演示材料仍缺 |
| [Circle](circle-2025-ipo/README.md) | Circle Internet Group, Inc.，Delaware | 2025-05-27 IPO 披露；历史 FY2022–FY2024、2025Q1 | 2 份发行人分发 PDF：2025-04-01 S-1（内含两份删节合同）及 2025-05-27 S-1/A Amendment3；提取与 Orbis 条件核对共 2 份衍生文件 |
| [BackerKit](backerkit-2025-offering/README.md) | Diaspora, Inc.（dba BackerKit），Delaware | FY2025 截至 2025-07-31；募资页面存在后续更新 | 募资、财务及 SAFE／SPV 模板索引；4 份衍生证据文件 |

新增 PDF、旧地址的失败历史、供应商来源与身份候选均保留在清单中。来源记录数量不等于已保存文件数量；同一 PDF 包含多份合同也只计为一个文件。各层 macOS `.DS_Store` 系统文件保留并排除在归档数据之外。实际文件数量、分类、SHA-256 与大小检查以 [manifest.json](manifest.json) 为准；来源 URL、日期、版本、期间、删节、缺口与下载结果保留在各目录的 `metadata.json`。

## 使用边界

- 2026 年抓取时间与 2024／2025 财务期间、当年披露日期分开保存。后续网页更新不能自动成为当时已知信息。
- 募资 SAFE／SPV 文件是公开模板，不能称为某位投资者已签署的协议。删节合同不能据此恢复省略条款。
- 同一发行人的年报、新闻稿和演示材料可能同源。数值一致表示处理一致，不表示独立核验底账。
- 尚未取得内部客户账、原生财务模型、完整未删节合同、FDD 或投资 memo；本目录不作投资结论。

## 补充数据库

Orbis 与 PitchBook 的后续索引或导出分别放在 `orbis-coverage/`、`pitchbook-coverage/`，状态以 manifest 为准；金融数据库导出、原始披露文件和人工提取分别计数。

| 来源 | 已保存观察 | 范围与限制 |
|---|---:|---|
| [Orbis](orbis-coverage/README.md) | 103：Marqeta 55、Circle 48 | 94 个数值、9 个 `n.a.`；另存两家原生 Summary XLSX 及各自只读核验报告；旧 UI 单位状态保持原样 |
| [PitchBook](pitchbook-coverage/README.md) | 147：Marqeta 48、Circle 95、BackerKit 4 | 145 个数值、2 个缺失；三个完整 profile、11 张原生 PNG。Circle 年度与先前 TTM 配置分开；BackerKit 4 项财务值隔离，不用于案例分析 |

合计 **250 个已结构化数据库财务观察单元**，包含 11 个缺失值和 4 个隔离值。CSV／JSON 副本、原生文件及核验报告不重复增加观察；原生文件中的额外年度和指标保留在文件内。另有 BackerKit 2 条供应商融资叙述，单独保存。PitchBook 的 20 项算术重放通过；Orbis 的 103 项原生单元格对照在声明的倍率、舍入、计数和缺失值规则下通过，均不构成独立审计。

两份 Orbis 原生 XLSX 明确标注 th USD，并把现金流标作 Net Income before D&A；它不是经营现金流。金额对照没有反向改写较早 UI 的未决倍率。PitchBook 金额仅按明确单位转换，百分比与 EPS 分开；分析师调整净利润／EBITDA 不自动等于 GAAP，Orbis Shareholders funds 不自动等于 PitchBook Total Equity，部分 margin 的相邻金额口径也未确认。Circle 原有 IPO／Orbis 条件核对未改写；2025／2026 后续期间及 2026 年历史视图不回填为截止日已知信息。

### 获取状态与阻断

- **本次已保存的发行人公开分发文件**：Marqeta 3 份、Circle 2 份，共 5 份 PDF，放在各自案例的 `originals/`。法律实体、文档版本、期间、页数、SHA-256 与关键页面已核验；源文件未重写。Marqeta 年报 PDF 的修改时间晚于披露日，公告 PDF 为后续生成；Circle 两份 PDF 为发行人分发的 EDGAR 转换版本。这些版本信息不会被抹去，也不据此宣称冻结了历史网页。
- **公开文件剩余缺口**：BackerKit 的官方财务附件、SAFE／SPV 模板及募资页原始文件仍未保存；新发现的 SEC 审计附件也返回 HTTP 403。Marqeta 独立 Earnings Supplement 仍缺，新发现的收益 8-K 包下载超时且未保存；Circle 同日 IPO 公告的原始 HTML 也未保存。旧拒绝地址未被重试或通过改头、代理绕过；网页衍生事实不计为原件。
- **Circle 中断下载**：较早的浏览器 S-1/A 下载连接中断，未返回保存路径，原动作结果仍未知。重连后检查项目目录和 Downloads 未找到目标文件，再经正常 HTTP 取得发行人已公开链接的 S-1/A PDF；此后续成功不证明旧浏览器请求完成，也不证明旧审批已处理。
- **Orbis 当前成功获取**：经用户明确授权，在用户已有登录的 Safari Columbia 机构会话正常取得 [Marqeta Summary](orbis-coverage/exports/Marqeta_US_Orbis_Summary_Safari_20261023.xlsx) 与 [Circle Summary](orbis-coverage/exports/Circle_US_Orbis_Summary_Safari_20261023.xlsx)，状态为 `native_successful_data_acquired`。两份 Excel 的公司 ID、期间、单位、ZIP CRC 和哈希已核对；未修改或重算。Marqeta 站点下载权限提示后的批准者无法确认；Circle 自动保存，未另点 Download。
- **Orbis 历史事件**：旧 IP 作业最后已知 pending，当前结果仍未知；旧监控刷新曾被自动审批拒绝，后续超时也未读到状态。另一个旧 IAB Columbia 请求为 `ERR_BLOCKED_BY_CLIENT`，没有重试该 URL。新 Safari 文件是不同上下文中的新导出，不证明旧任务完成、失败或取消。此前 Circle 未渲染表单的事件也仅作历史记录。
- **BackerKit 隔离**：Orbis 两个候选存在域名／注册信息冲突，未合并进 Diaspora, Inc.。PitchBook 完整 profile 明示法律名称与案例相符，但其 4 个财务值的期间、更新日期和来源基础尚未核实，另行隔离；这也没有解决两个 Orbis 候选的身份。PitchBook 的千美元标签本身没有已证实的冲突。
- **PitchBook 已确认下载**：Marqeta 三张年度财务表、Circle 两张 TTM 表及三张新的年度表、BackerKit 两张财务表和员工图，共 11 张 PNG。文件签名、块 CRC、大小、SHA-256 和视觉内容已核验。图片的 `Created on` 为 24-Oct-2026；公司归属依赖已核实的 profile／下载上下文，不能仅靠图片本身。Circle 年度收入表为 FY2021–2025，年度资产负债表／现金流为 FY2023–2025；FY2025 排除于历史 IPO 视角。现金流图片部分行名带省略号，完整标签依赖界面记录。
- **仍未确认的旧下载**：Marqeta Q4/FY2024 电话会日期 2025-02-26，17 页可读，但未保存全文或确认原件。旧 Circle TTM 收入表下载结果也未确认；本次年度收入表是新配置的独立成功目标，没有重试旧动作。它们未被计为原生文件。
- **待审批与工具限制**：旧下载审批 ID 为 `manager:786730af115b4ae590afe3fd66d2e985:1`。用户已授权代批下载，但当前暴露工具仍无法查看或操作该审批，未确认它已处理；父任务转述的当前自定义规则正文也不可读，原生 Codex 应用控制另被拒绝。授权与实际执行结果分别记录。

连接数据时以 **case_id＋经核实的法律实体／CIK** 为基础，另存 BvD、PitchBook 等供应商 ID。品牌名相同不足以合并母公司、子公司或 SPV。供应商数据的 as-of、检索时间、会计期间和合并口径都单独记录。2026 年导出作为补充快照，不能覆盖历史案例事实。

用户放入项目顶层的 13 个下载文件（2 份 Excel、11 张 PNG）已按来源归入 `orbis-coverage/exports/` 与 `pitchbook-coverage/exports/`，并移除顶层重复位置。移动前后逐个验证 SHA-256 一致；现有规范归档内容未变，不重复计入来源、原生导出或观察数。后续入库以本目录的文件路径和哈希去重。

## 重新验证

从项目根目录运行：

```bash
python3 -B data/additional-cases/verify_cases.py
```

脚本只更新全局 `manifest.json`，检查安全路径、已列出的 SHA-256／大小、文件分类、原生导出计数和美国主体信息，并按 JSON 观察数组核对记录数，避免重复计算副本。发现缺失、哈希不符或范围问题只报告，不修复案例文件。`--check-only` 只检查；manifest 自身及所有层级的 `.DS_Store` 不参与数据计数或内容哈希，系统文件的排除路径会记录在清单中。

原生数据库导出必须有明确来源记录；不能只因文件扩展名是 CSV、Excel 或 Parquet 就计作原生导出。没有明确文件角色的补充文件保留为未分类并报警。
