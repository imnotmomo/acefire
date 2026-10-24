# B 部分交接：非结构化资料 → 数据库 → 前端文字与来源

负责人：`chr950331`。本次发布仅包含文档与报告链路；Chat 功能留在本地，后续再上传。

## 交付边界

B 负责读取 PDF、Word、PowerPoint，提取数字和文字，核对原文位置，调用赞助商
Nicrron 生成前端需要的报告文字，附逐条 sourcing，并写入交给 C 的 **同一份 DuckDB**。
C 最新运行端使用 Firestore，并保留 DuckDB 导入和离线兼容；B 的离线处理不会
另建在线数据库或更换 C 的后端。C 继续负责精确归一化、计算、共享存储与前端服务。

```text
PDF / DOCX / PPTX / DOC / PPT
  → 保存原件与 SHA-256
  → PDF 阅读视图 + Office 原生定位
  → 分页批次 → Nicrron / openai/gpt-4.1
  → 数字、文字、原文引用、失败项
  → 独立校验来源哈希与原文位置
  → C source_snapshots + document_claims
  → 数字候选通过 C ExtractedClaim → source_observations
  → 按前端 12 模块生成文字 → 逐条来源对齐复核
  → narrative_reports → JSON / Markdown / 带原件的交接 ZIP
  → C 读取 API → 前端接入
```

## 代码结构

| 层 | 路径 | 职责 |
| --- | --- | --- |
| 文件准备 | `evidence/prepare_pdf.py`, `prepare_office.py`, `office_native.py` | 原件快照、阅读视图、PDF 页和 Word 段落/单元格/PPT 幻灯片定位 |
| 统一入口 | `evidence/ingest_document.py` | 识别支持格式，准备并可选提取整份文件 |
| 模型适配 | `integrations/nicrron.py`, `evidence/extract_nicrron.py` | 固定赞助商网关与模型；保留请求和实际模型信息 |
| 提取契约 | `evidence/models.py`, `claim.schema.json`, `extraction_prompt.md` | 文字、数字候选及证据结构 |
| 原文校验 | `evidence/import_claims.py`, `process_contract.py` | 独立读原件、核对引用、汇总批次和失败项；覆盖页数不等于穷尽提取 |
| 入库适配 | `evidence/save_to_db.py`, `app/document_intake.py` | 注册来源、保存文字；数字沿用 C 的接口，不补算未知数据 |
| 报告生成 | `evidence/generate_narrative.py`, `narrative_prompt.md` | 两模块一批生成，另行复核，输出逐条带来源的文字和缺口 |
| 报告存取 | `app/document_narrative.py`, `app/document_routes.py` | 三状态、不可变版本、来源校验与读取 API |
| 数据表扩展 | `database-design/document-intake.sql`, `narrative.sql` | 同一数据库中的新增表；C 财务 schema v1 不变 |
| Akta 补充 | `integrations/akta.py` | 可选公司背景；缓存可用不代表实时接口恢复 |

上述 Python 路径以 `backend/` 为根。详细契约见
[文档入库](DOCUMENT_INTAKE.md) 与 [前端正文和 sourcing](NARRATIVE_HANDOFF.md)。

## 给 C 的结构

| 表 | 保存内容 |
| --- | --- |
| `source_snapshots`（C 原有） | 文件身份、哈希、原件缓存路径和上传元数据 |
| `source_observations`（C 原有） | 通过 C 的数字 intake 保存原始数值、单位、期间、场景和定位 |
| `document_claims`（B 新增） | 文字事实、数字候选、原文证据、主体及原生/转换定位 |
| `narrative_reports`（B 新增） | 12 模块正文、状态、引用、来源范围、复核和不可变报告版本 |

前端模块 ID 与现有 `frontend/src/data.ts` 一致：`overview`, `market`,
`financials`, `customers`, `product`, `competition`, `gtm`, `economics`, `team`,
`legal`, `clinical`, `questions`。每个配置子主题都保留一项或多项展示记录。

- `verified`：文字经自动语义复核，与指定原文对齐；不代表独立事实确认或人工签核。
- `missing`：本轮已审阅材料不足以支持可发布答案，或复核未完成；不等于公司不存在该事项。
- `difference`：不同原始来源的说法确有差异，且主体、期间、范围、定义与场景明确可比。
  不把不同年份、预测/实际或不同牌照自动判成差异。

每条正文携带引用 ID；source 包含原文、文件名、页码、`snapshot_id`、SHA-256、
原件查看和定位地址。报告中的 `[citation-id]` 与 `evidenceIds` 已对应，C 不必重新写正文
或猜测引用。旧前端 Evidence 状态枚举仍需由 C/前端显式增加适配。

## 已完成的本地 Enfuce 样例

范围只有 31 页 April 2020 Deck，不包含 Memo、FDD、Akta 或外部研究。

| 项目 | 实际结果 |
| --- | --- |
| 原始提取 | 39 条记录：20 条文字、19 条数字候选；36 条去重的原文证据 |
| 原始失败项 | 45 条单独保存，未作为通过的证据写入数据库 |
| C 数字观察 | 19 条，保留原始表达；归一化值全为空，没有强行补算 |
| 前端报告 | 12 模块；46 verified / 23 missing / 0 difference；60 个精确引用 |
| 最新报告版本 | `36fbcf8c-d8cc-5643-aa6b-e802762fe1ed` |
| 来源复核 | 40 条措辞/引用修订后重新调用模型复核；无人类签核或独立外部核实 |
| 实测 | 从持久化 DB 读回全部模块与 60 个引用，核对原件 SHA-256；原始记录和数字未被覆盖 |

Enfuce 的 `enfuce-2020` / `enfuce-document-workspace` 是暂定文档工作区映射，
不是已确认的法律实体/Akta 匹配。没有可比的多来源差异，故 difference 为零。
办公室文件转换使用真实文件测试和模拟模型；本阶段真实模型提取/生成验证使用 PDF。

## 从新环境运行

在仓库根目录，用 Python 3.10+ 创建环境。固定依赖保留 C 原有版本，并增加 PDF
运行库与测试库；Word/PPT 转换还需安装 LibreOffice。

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.lock -r backend/requirements.txt
export PYTHONPATH=.:backend
export NICRRON_API_KEY_FILE=/absolute/path/outside/repo/nicrron_key.txt
```

1. 用 `python -m backend.evidence.ingest_document --file ... --deal-id ... --output runtime/run-v1 --extract` 准备和提取。
2. 按 [DOCUMENT_INTAKE.md](DOCUMENT_INTAKE.md) 提供明确的 C Company 映射，用 `save_to_db` 写入来源与文字，可选 `--submit-numbers`。
3. 按 [NARRATIVE_HANDOFF.md](NARRATIVE_HANDOFF.md) 用注册的 PDF snapshot ID 运行 `generate_narrative`，生成全部模块、复核并入库。
4. 同一个 DuckDB 文件只运行一个写进程；CLI 导入/生成时先停使用该文件的 API。
5. API 必须指向同一数据库；不设置时 C 的默认 `.cache` 数据库与 B 的 `runtime` 数据库不同。

```bash
DUCKDB_PATH="$PWD/runtime/acefire.duckdb" PYTHONPATH=backend \
  python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

| 读取接口 | 内容 |
| --- | --- |
| `GET /deals/{id}/document-claims` | 原始文字与数字候选及证据 |
| `GET /deals/{id}/document-numeric-packet` | 可提交给 C 原有数字 intake 的请求体 |
| `GET /deals/{id}/narrative-report?report_id=...` | 指定版本的完整前端文字、状态和引用 |
| `GET /deals/{id}/narrative-evidence/{citation_id}?report_id=...` | 所选项目和报告版本内的引用详情 |
| `GET /sources/{snapshot_id}/file`（C 原有） | 经哈希核对的原件/阅读视图 |

## 发布内容与下一步

GitHub 发布源代码、SQL、测试和契约文档。`runtime/` 下的 DuckDB、原件、模型响应、
生成 JSON/Markdown/ZIP、机器配置和密钥不上传到公开仓库。克隆代码不会自动获得
本机 Enfuce 数据；C 需通过单独的私有渠道取得生成的 `c-package.zip` 或自行重跑。
该包包含完整 JSON、正文、source metadata 和 PDF 字节；移动数据库本身不会移动原件。

C 已提供 Firestore 导入和已存报告适配，详见 [C 的最新集成说明](FIREBASE_INTEGRATION.md)。
前端使用 `enfuce-documents` 打开导入的 `enfuce-2020`；旧 `enfuce` 保留历史演示。
C 将上游自动 verified 作为待人工 Verify 处理，保留差异和缺失，不把模型复核当成人工核验。
本次保留该适配及全部 C 现有功能；后续新材料仍由 B 处理，再交给 C 通过其导入器更新。
后续可扩展 Memo/FDD、完善源文件处理和语义复核；当前没有 Embedding 或外部研究。
按用户最新要求，Chat 功能本次不上传。

## 本次发布验证

早期隔离 B 快照后端测试为 **245 passed，1 skipped**；对齐 C 最新代码后集成回归为 **353 passed，1 skipped**，并检查 Git 空白错误、
新增文件范围和凭据模式。集成回归覆盖 C 已有测试，但本次没有新增 B Chat、部署 Firebase 或重新运行前端浏览器套件。
前端、C 的 `app/narrative.py`、公司 Chat 和计算实现都保持最新版本不变。
