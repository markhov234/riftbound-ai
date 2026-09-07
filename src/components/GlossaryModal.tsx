import { useState } from 'react'
import { ALL_GLOSSARY } from '../data/glossary'

export default function GlossaryModal({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const query = q.toLowerCase().trim()
  const keywords = ALL_GLOSSARY.filter((e) => e.kind === 'keyword')
  const actions = ALL_GLOSSARY.filter((e) => e.kind === 'action')
  const rules = ALL_GLOSSARY.filter((e) => e.kind === 'rule')
  const match = (e: (typeof ALL_GLOSSARY)[number]) =>
    !query || e.term.toLowerCase().includes(query) || e.text.toLowerCase().includes(query)

  const Section = ({ title, entries }: { title: string; entries: typeof ALL_GLOSSARY }) => {
    const shown = entries.filter(match)
    if (shown.length === 0) return null
    return (
      <div className="mb-4">
        <h3 className="hud-label mb-2">{title}</h3>
        <div className="space-y-2">
          {shown.map((e) => (
            <div key={e.term} className="border-b border-line pb-2">
              <span className="font-bold text-accent uppercase tracking-wide text-xs">{e.term}</span>
              {e.cost && <span className="ml-2 hud-label">takes a cost</span>}
              <p className="text-xs text-txtDim leading-snug mt-0.5">{e.text}</p>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-line w-full max-w-lg max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 p-4 border-b border-line">
          <h2 className="hud-label text-txt">📖 Glossary</h2>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="flex-1 px-2 py-1 bg-bg border border-line text-sm text-txt placeholder-txtFaint"
          />
          <button onClick={onClose} className="text-txtDim hover:text-accent text-sm">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto p-4 text-txt">
          <Section title="Keywords" entries={keywords} />
          <Section title="Game actions" entries={actions} />
          <Section title="Rules terms" entries={rules} />
          <p className="hud-label normal-case tracking-normal mt-2">
            Source: riftbound.gg/rules/glossary — Core Rules revision 2026-07-16.
          </p>
        </div>
      </div>
    </div>
  )
}
