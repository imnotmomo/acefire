# PitchBook：三个美国独立案例的补充数据

已保存 **11 个提供商原生 PNG（10 张财务表、1 张员工图）、4 个观察 JSON、1 个验证支持 JSON、README 和 metadata，共 18 个交付文件**。原生下载保留原字节；**原始发行人文件为 0**，这些图片不是发行人申报、PDF 或 Excel。

| 公司与档案 | 原生文件 | 实际期间与限制 |
|---|---:|---|
| [Marqeta, Inc.](https://my.pitchbook.com/profile/54330-13/company/profile)，54330-13，美国 Oakland | 3 | 收入表 FY2021–2025；资产负债表、现金流 FY2023–2025。|
| [Circle Internet Group](https://my.pitchbook.com/profile/60145-57/company/profile)，60145-57，美国 New York | 5 | 两张 TTM 资产负债表/现金流图；另三张新年度配置：收入表 FY2021–2025、资产负债表/现金流 FY2023–2025。|
| [BackerKit / Diaspora, Inc](https://my.pitchbook.com/profile/104907-52/company/profile#financials)，104907-52，美国 San Francisco | 3 | FY2025 收入表、资产表、员工图；财务值隔离，禁止用于案例分析。|

原生文件全部在 `exports/`。所有图片显示 Created on: 24-Oct-2026 和 Source: PitchBook Data；金融图片显示 Thousands, USD。图片不印公司名、档案 ID 或来源 URL，归属依据是主任务核实的正常登录界面、下载上下文和文件名。文件名日期与图片创建日期分别保留，不猜测时区。`metadata.json` 列出 15 个来源记录及每个文件的字节数、SHA-256 和获取结果。系统生成的 `.DS_Store` 另行忽略，未删除或修改，不计入交付文件或证据。

## 已结构化数据与验证

金融观察仍为 **147 格：Marqeta48、Circle95、BackerKit4；145 个数值字符串、2 个明确空白**。另有两条 BackerKit 未独立核实融资陈述，未计入。新增原生图片没有重复增加观察；额外年度单元格保留在图片内。

- `marqeta_financial_observations.json`：16指标 × 2024、2025、TTM Jun2026。新增年度图片的32个重叠值完全一致。EPS单位未解决，未乘1000；Analyst Normalized与其他指标分开。
- `circle_balance_sheet_observations.json`：15格，来自早先三期TTM原生图。`circle_ttm_financial_observations.json`：65收入表格、15现金流格；收入表是五个TTM，不能当五个季度流量。Revenue Growth的Jun/Sep2025两格为空，经原生TH/TD位置核实，未补零。现金流原生图的15值完全一致。
- `backerkit_pitchbook_observations.json`：4个金融值、2条融资陈述及精简身份背景。`backerkit_native_exports_verification.json` 是只读图像验证支持，不是新增观察或下载原件。

20项Decimal算术回放全部通过（Marqeta9、Circle资产负债表3、Circle收入/现金流8）。全部11张PNG的签名、所有块CRC及SHA-256已核实；各图片已由负责代理视觉检查。这些验证不证明底层账簿、审计或发行人准确性。

## 口径和历史案例边界

Circle年度收入图的 EBIT、EBITDA、Net Income、EPS (Analyst Normalized) 在FY2021–2023为空，不能补零或反推。两家上市公司图中的部分margin与相邻分析师调整金额不是已确认的相同口径，不能自动组合。TTM流量、资产负债表存量、调整指标、EPS及供应商来源版本须区分。

Marqeta历史案例截止26-Feb-2025；JSON中的2025/TTM2026共32格排除，2024的16格也是2026当前历史视图，不能证明截止日已知值。Circle已有95格均晚于27-May-2025 IPO截止日；新年度图片中的FY2025排除，更早年度仍未验证为截止日版本。

BackerKit图只显示FY2025：收入23,695、资产3,689,284，单位标记ThousandsUSD；Reported Total Operating Profit/Loss为空，Operating Margin显示375.43%，不由此推利润或验证margin。界面最后更新28-Apr-2025与期间关系未解决，财年及底层来源未确认，**全部财务分析标记保持false，不修复单位或归零**。员工44、Last Capture06-Oct-2025、Progressive Growth0.00%仅作较晚背景。PitchBook明确Diaspora法定名称的匹配不能合并Orbis两个冲突候选。

## 仍未取得的资料

[Marqeta Q4 2024电话会](https://my.pitchbook.com/research-center/report/209760c8-2707-324d-a160-406f4eb87ec4)可读，日期26-Feb-2025，17页；没有保存全文或原件。早先下载未返回文件，当前旧审批状态无法由可用工具核实，旧审批未操作。公司研究报告Limited Access没有绕过。

早先Circle的TTM收入表下载结果仍未确认；本次成功的年度收入表是新配置的独立目标，没有重试旧动作。BackerKit Filings显示10条外部SEC.gov链接，没有提供商原生申报下载；没有点击这些链接或重试既有SEC/IR403。

仍缺原始发行人申报、签署合同、完整账簿及客户级数据。此次可访问提供商核心财务表下载已完成，不表示完整尽调案例已完成。没有存储账户名、令牌、私人联系方式或全文转录。
