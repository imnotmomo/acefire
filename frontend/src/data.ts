export type ModuleId = 'overview' | 'market' | 'financials' | 'customers' | 'product' | 'competition' | 'gtm' | 'economics' | 'team' | 'legal' | 'clinical' | 'questions'
export type ModuleDefinition = { id: ModuleId; name: string; icon: string; description: string; topics: string[]; color: string }

export const MODULES: ModuleDefinition[] = [
  { id: 'overview', name: 'Company overview', icon: 'building', description: 'The business at a glance', topics: ['Company profile', 'Business model', 'Ownership'], color: 'green' },
  { id: 'market', name: 'Market', icon: 'globe', description: 'Size, segments & tailwinds', topics: ['Market size', 'Market growth', 'Consumer trends', 'Customer segments', 'Competition', 'Geographic expansion'], color: 'blue' },
  { id: 'financials', name: 'Financials', icon: 'chart', description: 'The numbers behind the story', topics: ['Revenue', 'Gross profit', 'Recurring revenue', 'Cash & runway'], color: 'purple' },
  { id: 'customers', name: 'Customers', icon: 'users', description: 'Who buys, and why they stay', topics: ['Customer base', 'Concentration', 'Retention'], color: 'orange' },
  { id: 'product', name: 'Product', icon: 'layers', description: 'Product, technology & roadmap', topics: ['Product offering', 'Technology', 'Roadmap'], color: 'blue' },
  { id: 'competition', name: 'Competition', icon: 'flag', description: 'Alternatives & differentiation', topics: ['Competitive landscape', 'Differentiation', 'Switching costs'], color: 'purple' },
  { id: 'gtm', name: 'GTM', icon: 'rocket', description: 'How the business reaches buyers', topics: ['Channels', 'Sales motion', 'Growth strategy'], color: 'orange' },
  { id: 'economics', name: 'Unit economics', icon: 'calculator', description: 'Growth at the unit level', topics: ['CAC', 'LTV', 'Payback period'], color: 'green' },
  { id: 'team', name: 'Team', icon: 'contact', description: 'People, ownership & hiring', topics: ['Leadership', 'Organization', 'Hiring plan'], color: 'blue' },
  { id: 'legal', name: 'Legal / IP', icon: 'scale', description: 'Rights, contracts & obligations', topics: ['Corporate structure', 'Contracts', 'Intellectual property'], color: 'purple' },
  { id: 'clinical', name: 'Clinical / Regulatory', icon: 'shield', description: 'Clinical evidence & compliance', topics: ['Clinical evidence', 'Regulatory status', 'Compliance'], color: 'green' },
  { id: 'questions', name: 'Open questions', icon: 'help', description: 'What still needs an answer', topics: ['Evidence gaps', 'Definition checks', 'Follow-up requests'], color: 'orange' },
]

export type Evidence = {
  id: string; title: string; file: string; locator: string; period: string; unit: string;
  status: 'Reproduced' | 'Needs review' | 'Reported'; value: string; description: string;
  excerpt: string; originalExcerpt?: string; originalLocator?: string; rows: [string, string][]; formula?: string; note: string; hash?: string;
  category: 'Financial data' | 'Documents';
}

export const EVIDENCE: Evidence[] = [
  {
    id: 'income', title: 'H1 2020 operating income', file: 'June 2020 Financials.xlsx', locator: 'P&L - Group · C4:H5, I6', period: 'H1 2020', unit: 'EUR',
    status: 'Reproduced', value: '€3,452,682.81', description: 'Revenue plus other operating income',
    excerpt: 'The supplied group worksheet separates Revenue from Other operating income. Income total includes both.',
    rows: [['Revenue · C4:H4', '€3,417,663.76'], ['Other operating income · C5:H5', '€35,019.05'], ['Income total · I6', '€3,452,682.81']],
    formula: '3,417,663.76 + 35,019.05 = 3,452,682.81',
    note: 'Arithmetic reproduced from saved workbook values. The underlying monthly source has not been independently verified.',
    hash: 'f0adc07ee908965fb24cab7c82b8493ed896aa78ff928173ff376822d907a3aa', category: 'Financial data',
  },
  {
    id: 'definition', title: 'Revenue definition', file: 'June 2020 Financials.xlsx', locator: 'Five-year financial summary (English worksheet label) · A4, F4; P&L - Group · B4:I6', period: 'H1 2020', unit: 'EUR',
    originalLocator: '近五年财务情况 · A4, F4; P&L - Group · B4:I6',
    status: 'Needs review', value: 'Definition pending', description: 'Revenue and total income are not interchangeable',
    excerpt: 'The summary label, translated into English as “Revenue,” maps numerically to Income total, rather than pure Revenue.',
    originalExcerpt: 'The summary label “营业收入” maps numerically to Income total, rather than pure Revenue.',
    rows: [['Summary “Revenue” (English label)', '€3,452,682.81'], ['Pure Revenue', '€3,417,663.76'], ['Income total', '€3,452,682.81']],
    note: 'Confirm whether the report’s revenue should include other operating income. No final mismatch conclusion is made.', category: 'Financial data',
  },
  {
    id: 'gross', title: '2019 gross profit', file: 'Enfuce P&L 2017–2022F.xlsx', locator: 'PL · F7:F9, AF9, AH9', period: 'FY 2019', unit: 'kEUR',
    status: 'Reproduced', value: '€3,609.32824k', description: 'Includes an unexplained €50k adjustment',
    excerpt: 'Source formula at PL!F9: +F7+F8+50. The formula is reproducible; the business meaning of the constant is not documented.',
    rows: [['Revenue · F7', '5,095.50635 kEUR'], ['Signed cost of sales · F8', '−1,536.17811 kEUR'], ['Unlabeled constant', '+50 kEUR'], ['Gross profit · F9', '3,609.32824 kEUR']],
    formula: '5,095.50635 − 1,536.17811 + 50 = 3,609.32824 kEUR',
    note: 'Ask the company to explain the 50 kEUR constant. Do not assign it a business meaning without evidence.',
    hash: 'fa1f28c79f39bf6934f4281ac813b868a02091ae5e22c35420d70140fcbdadb2', category: 'Financial data',
  },
  {
    id: 'mrr', title: 'MRR worksheet total', file: 'Enfuce P&L 2017–2022F.xlsx', locator: 'MRR · Q4:Q14', period: 'Source Q column', unit: 'EUR',
    status: 'Reproduced', value: '€366,559.95', description: 'Stored EUR; displayed as 367 kEUR',
    excerpt: 'The non-empty cells in Q5:Q13 sum to Q14. Number format #,##0, divides by 1,000 for display. The source as-of date needs confirmation.',
    rows: [['Sum of non-empty Q5:Q13', '€366,559.95'], ['Source total · Q14', '€366,559.95'], ['Displayed whole kEUR', '367'], ['Blank cell within SUM range', 'Q13']],
    formula: 'SUM(Q5:Q13) = 366,559.95 EUR',
    note: 'ARR is unavailable: confirm recurring revenue, customer scope, as-of date and ARR definition before annualizing.', category: 'Financial data',
  },
  {
    id: 'rounding', title: '2019 reported revenue', file: 'Enfuce FDD v4.pptx', locator: 'Slide 11 · table 1, row 2, column 4; PL · F7', period: 'FY 2019', unit: 'kEUR',
    status: 'Needs review', value: '€5,096k', description: 'Rounding consistent; entity scope unresolved',
    excerpt: 'The report shows 5,096 kEUR. The workbook value is 5,095.50635 kEUR. These agree after rounding, but report group-vs-parent scope is unresolved.',
    rows: [['Report, slide 11', '5,096 kEUR'], ['Workbook · PL!F7', '5,095.50635 kEUR'], ['Numeric rounding', 'Consistent'], ['Final comparison', 'Insufficient evidence']],
    note: 'Numeric proximity alone does not establish a matched comparison. Confirm entity and metric definitions.', category: 'Documents',
  },
  {
    id: 'company', title: 'Company profile', file: 'Enfuce FDD v4.pptx', locator: 'Slide 2 · company description', period: '2020 source snapshot', unit: 'Narrative',
    status: 'Reported', value: 'Enfuce', description: 'Company description in the FDD report',
    excerpt: 'English translation of the historical FDD excerpt: Enfuce is a fintech company founded in 2016 and headquartered in Finland. Its main customers are startups and companies in the Nordics. Its principal business is payment services, accounting for more than 95% of revenue.',
    originalExcerpt: 'Enfuce是一家成立于2016年的金融科技公司其总部位于芬兰，主要客户是位于北欧初创公司和企业目前Enfuce主要业务是支付服务，占营收超95%',
    rows: [['Founded (reported)', '2016'], ['Headquarters (reported)', 'Finland'], ['Primary business (reported)', 'Payment services']],
    note: 'Historical report description, not an independently verified or current company profile.', category: 'Documents',
  },
  {
    id: 'customers', title: 'Reported customer base', file: 'Enfuce FDD v4.pptx', locator: 'Slide 2 · data summary', period: 'June 2020 source context', unit: 'Customers',
    status: 'Reported', value: '16', description: 'Customer count reported in the FDD',
    excerpt: 'English translation of the historical FDD excerpt: There are 16 existing customers, and ST1 is the largest customer.',
    originalExcerpt: '现存客户16家，第一大客户是ST1',
    rows: [['Reported customers', '16'], ['Largest customer (reported)', 'ST1'], ['Customer-level reconciliation', 'Not available']],
    note: 'Count is reported only. A customer-level ledger is needed to reproduce it.', category: 'Documents',
  },
]

export const DEFAULT_MODULES: ModuleId[] = ['overview', 'market', 'financials', 'customers', 'team', 'questions']
export const evidenceForModule = (id: ModuleId) => ({ overview: ['company'], market: [], financials: ['income', 'definition', 'gross', 'mrr', 'rounding'], customers: ['customers'], product: [], competition: [], gtm: [], economics: [], team: [], legal: [], clinical: [], questions: ['definition', 'gross', 'mrr', 'rounding'] })[id]
