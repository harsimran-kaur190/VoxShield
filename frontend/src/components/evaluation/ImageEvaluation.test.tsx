import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import imageEval from '../../data/imageEval.json'
import { ImageEvaluation } from './ImageEvaluation'

describe('ImageEvaluation', () => {
  it('shows only the held-out numbers from the summary file, never typed-in figures', () => {
    // React escapes & and quotes in text; undo that so the generated paragraph can be compared verbatim.
    const html = renderToStaticMarkup(<ImageEvaluation />).replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#x27;', "'")
    expect(html).toContain(`${Math.round((imageEval.main.accuracy ?? 0) * 100)}%`)
    expect(html).toContain(String(imageEval.main.auc))
    expect(html).toContain(imageEval.where_it_fails)
    expect(html).toContain(String(imageEval.dataset.test))
    for (const source of imageEval.dataset.sources) expect(html).toContain(source.dataset)
  })
})
