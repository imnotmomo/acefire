import test from 'node:test'
import assert from 'node:assert/strict'
import { ENFUCE, emptyWorkspace, defaultConfig, generateSections, reorder, reportMarkdown, citedEvidenceIds, safeUrl } from '../src/domain.ts'

test('reordering preserves every module and does not mutate the source', () => {
  const source = ['overview', 'market', 'financials']
  assert.deepEqual(reorder(source, 2, 0), ['financials', 'overview', 'market'])
  assert.deepEqual(source, ['overview', 'market', 'financials'])
  assert.deepEqual(reorder(source, -1, 2), source)
})

test('a new project never inherits Enfuce claims or metrics', () => {
  const project = { ...ENFUCE, id: 'a-new-project', name: 'New project' }
  const sections = generateSections(project, emptyWorkspace())
  assert.equal(sections.every(section => section.evidenceIds.length === 0), true)
  assert.doesNotMatch(reportMarkdown(project, sections), /3,452,682|16 customers|5,095/)
  assert.match(sections[0].content, /No supporting evidence/)
})

test('financial sub-topics control which facts are included; missing inputs are explicit', () => {
  const workspace = emptyWorkspace()
  workspace.order = ['financials']
  workspace.configs.financials = { ...defaultConfig('financials'), topics: ['Cash & runway'] }
  const [section] = generateSections(ENFUCE, workspace)
  assert.deepEqual(section.evidenceIds, [])
  assert.match(section.content, /cannot be calculated/)
  assert.doesNotMatch(section.content, /3,452,682/)
})

test('scope requests are preserved without implying live external research was performed', () => {
  const workspace = emptyWorkspace()
  workspace.order = ['market']
  workspace.configs.market = { ...defaultConfig('market'), scope: 'Internal + external', focus: 'Gen Z purchasing behavior', geography: 'US', depth: 'Deep' }
  const [section] = generateSections(ENFUCE, workspace)
  assert.match(section.content, /No external search has been executed/)
  assert.match(section.content, /Gen Z purchasing behavior/)
  assert.match(section.content, /deep · US/)
  assert.deepEqual(section.evidenceIds, [])
})

test('exports cite only references that remain in the edited text', () => {
  const workspace = emptyWorkspace()
  workspace.order = ['financials']
  const sections = generateSections(ENFUCE, workspace)
  sections[0].content = 'Human revision with just this reference. [gross]'
  assert.deepEqual(citedEvidenceIds(sections), ['gross'])
  const output = reportMarkdown(ENFUCE, sections)
  assert.match(output, /PL · F7:F9/)
  assert.doesNotMatch(output, /\- \[income\]/)
  assert.match(output, /not been reverified/)
})

test('source links reject script and data protocols', () => {
  assert.equal(safeUrl('javascript:alert(1)'), null)
  assert.equal(safeUrl('data:text/html,<h1>x</h1>'), null)
  assert.equal(safeUrl('not-a-url'), null)
  assert.equal(safeUrl('https://example.com/research'), 'https://example.com/research')
})
