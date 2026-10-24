# Circle 2025 IPO：独立美国公司案例（部分资料）

案例披露截止日仍为 **2025-05-27**，涉及 FY2022–FY2024 及 2025Q1。发行人为 Circle Internet Group, Inc.，Delaware 注册、New York 办公。合同当事人 Circle Internet Financial, LLC 与 Coinbase Global, Inc. 分别保留，不自动混同法人或合并范围。

## 已保存的原始公开文件

**原始文件 2 个，均为 Circle 官方 IR 链接的发行人 PDF 分发件，按下载字节原样保存。**

| 文件 | 版本、来源和页数 |
|---|---|
| [2025-05-27 S-1/A Amendment No.3](originals/circle_s1a_20250527_amendment3.pdf) | accession 0001193125-25-126208；455 页。封面与拟议发行条件日期为 May27,2025。|
| [2025-04-01 初始 S-1，含合同附件](originals/circle_s1_20250401_with_contract_exhibits.pdf) | accession 0001193125-25-070481；682 页。初始 S-1 与 May27 修订稿是不同版本，单独保留。|

初始 S-1 内的合同按 PDF 物理页码（从1开始）定位：

- EX10.1 Collaboration Agreement：第350–392页，2023-08-18生效；签名表示页391，附件标题页392。
- EX10.2 Stablecoin Ecosystem Agreement：第393–408页，2024-11-14生效；签名表示页407，附件标题页408。

**两份合同包含在同一个 April1 PDF 内，不能把原始文件数算成4。** 两者保留公开的[*****]删节；附件页只有标题，没有底层附件内容。纸面/s/签名表示不是经核验的加密数字签名。

所有682／455页均通过结构及文本可读取检查；关键封面、合同首页、签名页和 May27拟议发行页已渲染后视觉核对。源文件未重写、未去除安全设置、未执行链接或脚本，SHA-256与原下载一致。公开PDF可以在不输入密码的情况下读取。

## 来源与取得边界

- [May27官方IR入口](https://investor.circle.com/financials/sec-filings/sec-filings-details/default.aspx?FilingId=18497671) → [PDF分发地址](https://d18rn0p25nwr6d.cloudfront.net/CIK-0001876042/5b9b06a4-e3e9-4884-a5bd-14850b18e68d.pdf)
- [April1官方IR入口](https://investor.circle.com/financials/sec-filings/sec-filings-details/default.aspx?FilingId=18334897) → [PDF分发地址](https://d18rn0p25nwr6d.cloudfront.net/CIK-0001876042/90d133fe-9b86-4570-81b2-dc260ff1a06a.pdf)

先前 SEC HTML 与 Circle IPO启动公告原地址返回 HTTP403，这些结果及未重试边界保留。此次是独立发现的发行人IR/CDN分发件，HTTP200。PDF不是原SEC HTML的相同字节表示。先前 May27浏览器调用中断的结果仍未知；后续独立HTTP成功并不证明旧浏览器动作完成。

## 提取、核对与缺口

extracted_evidence.json 和 orbis_ipo_reconciliation.json 两个派生证据文件保持原样。前者的财务算术、拟议发行条件仍按原来源与单位记录；后者保留原UI倍率、收入定义、合并范围及申报版本的条件限制，没有因新增PDF而自动宣告金额匹配。FY2025的12项Orbis观察仍排除在IPO截止视角外。

本目录共 **9个归档文件：2个原始PDF、2个派生证据、5个支持文件**；索引5条来源记录（两份合同各有来源记录，但共用一个保存的PDF）。metadata与verification记录每个文件的大小、哈希、版本及限制。download_results保留初次下载尝试的历史，后续成功获取另有明确记录。

仍缺原始公告HTML、合同被省略条款／附件内容、客户底账、内部月度模型、FDD与投资memo。没有验证完整再分发许可，也不表示完整内部资料室或独立财务审计。
