# Orbis：美国公司补充资料

**已保存 2 份 Orbis 原生 Summary Excel，发行人原始申报文件数仍为 0。** 共 11 个归档文件：2 个原生 XLSX、5 个派生文件、4 个支持文件（README、metadata、两份核验报告）。各层 .DS_Store 保留并排除在归档计数外。

| 公司 | Orbis / BvD ID | 已结构化人工观察 | 原生 Summary 年度 |
|---|---|---:|---|
| Marqeta, Inc.，美国 Oakland | 146341334 / US274306690 | 55；11 指标×2021–2025 | 2019–2025；2021–2025 标记 10-K，2019–2020 标记 PROSP. |
| Circle Internet Group, Inc.，美国 New York | 674047230 / US992840247 | 48；12 指标×2022–2025，含 9 个 n.a. | 2022–2025；2025 标记 10-K，其余 PROSP. |

人工观察仍为 **103 项（94 个数值、9 个缺失值）**。CSV 与 JSON 是同组数据的两种表示；原生 Excel 和核验报告不重复增加观察数。两个未合并的 BackerKit 候选不计入财务观察。

## 文件与核验

- [Marqeta 原生 Summary](exports/Marqeta_US_Orbis_Summary_Safari_20261023.xlsx)：25,176 字节；单表 MARQETA__INC。
- [Circle 原生 Summary](exports/Circle_US_Orbis_Summary_Safari_20261023.xlsx)：22,476 字节；单表 CIRCLE_INTERNET_GROUP__INC。
- marqeta_orbis_xlsx_verification.json、circle_orbis_xlsx_verification.json：记录单元格、格式、期间、SHA-256 和只读核验结果。
- marqeta_orbis_observations.csv/json、circle_orbis_observations.csv/json：原人工界面摘录不变。
- backerkit_identity_candidates.json：两个身份候选，保持隔离。

两份 Excel 的 ZIP CRC、公司名称及 ID 已核对，没有公式、宏、外部工作簿链接或数据连接；普通网站／邮件超链接未打开。按 Spreadsheets 只读流程在内存检查并核对 XML，未重算、修改或重新导出工作簿。

103 项对应检查在声明条件下通过：52 项金额为原生千美元数值×1000 与旧 UI 原字符串相等；36 项比率按两位小数舍入一致；6 项员工数相等；9 项 n.a. 一致。金额仍为条件比较，**没有反向改写旧 UI 的单位或倍率**，也不是独立审计。

## 单位、定义和历史边界

原生列明确标注 th USD、Consolidated、Annual report、12 months、Unqualified、Original、US GAAP。Original 是供应商报表版本标签，不能理解为已下载发行人 10-K 原件。

两份原生 Summary 的现金流行明确写作 Cash flow [Net Income before D&A]，不能改称经营现金流。较早 UI 摘录保留当时标签和未决单位状态。Circle 原生 Shareholders funds 也不自动等于 PitchBook Total Equity；利润、调整后利润、合并范围及底层申报版本分别核实。

2026 年检索、文件名日期和财务期间分开保存。Circle FY2025 的 12 项观察晚于 IPO 截止日 2025-05-27；Marqeta FY2025 也晚于 FY2024 案例截止日 2025-02-26。PROSP. 未给出精确历史 S-1/A 版本，后续快照不能覆盖历史截止时点。

## 当前成功获取与历史事件

当前状态为 **native_successful_data_acquired**。主任务经用户明确授权，在已有登录的 Safari Columbia 机构会话中核实两家公司，以 Summary／当前公司／邮件复选框 0 正常提交两个新导出。此前该 Safari Exports 上下文为 0 条，这不证明旧作业已完成、失败或取消。

Marqeta 新作业 GUID 为 3f5c4069-2e1e-4cc6-a9c4-69787d015b46。Safari 站点下载权限提示曾出现，自动点击因用户切换应用而中断；之后提示消失、导出就绪并找到文件，**无法确认由谁批准**。Circle 排队后自动保存，没有再次点击 Download，也未出现额外权限提示；其 GUID 未观察到，不作推断。

旧 IP 作业最后已知 pending，当前结果仍未知；监控取消、自动审批拒绝、控制超时和旧错误页属于历史事件。较早 IAB Columbia 请求（GUID 前缀 0272515e）下载为 ERR_BLOCKED_BY_CLIENT，没有重试该 URL；用户明确授权的已有 Safari 会话是单独的正常访问上下文。新文件不被写成旧作业的成功结果。详细历史保留在 metadata。

## BackerKit 与缺口

BvD US358518533L、US292632908L 与 Diaspora, Inc.（dba BackerKit）的关系未解决，域名、注册信息及行业存在冲突或待核查项。两者保持 use_for_case_financial_analysis=false，不合并，不用候选财务替代募资资料。

仍缺发行人原始申报、客户账簿、内部模型、精确来源版本和完整合并范围。本目录是部分补充证据，不是完整内部资料室。
