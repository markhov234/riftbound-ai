import { useState } from 'react'
import { ALL_GLOSSARY } from '../data/glossary'
import { koFor } from '../data/glossary.ko'
import { useLocale } from '../i18n'

export default function GlossaryModal({ onClose }: { onClose: () => void }) {
  const { locale, t } = useLocale()
  const ko = locale === 'ko'
  const [q, setQ] = useState('')
  const query = q.toLowerCase().trim()
  const keywords = ALL_GLOSSARY.filter((e) => e.kind === 'keyword')
  const actions = ALL_GLOSSARY.filter((e) => e.kind === 'action')
  const rules = ALL_GLOSSARY.filter((e) => e.kind === 'rule')
  // Search both languages, so typing "방벽" or "shield" finds the same entry.
  const match = (e: (typeof ALL_GLOSSARY)[number]) => {
    if (!query) return true
    const k = koFor(e)
    return (
      e.term.toLowerCase().includes(query) ||
      e.text.toLowerCase().includes(query) ||
      !!k?.term.includes(query) ||
      !!k?.text.includes(query)
    )
  }

  const Section = ({ title, entries }: { title: string; entries: typeof ALL_GLOSSARY }) => {
    const shown = entries.filter(match)
    if (shown.length === 0) return null
    return (
      <div className="mb-4">
        <h3 className="hud-label mb-2">{title}</h3>
        <div className="space-y-2">
          {shown.map((e) => {
            // The English term stays the headline in both languages — it is what
            // is printed on the card art — with the Korean gloss beside it.
            const k = ko ? koFor(e) : undefined
            return (
              <div key={e.term} className="border-b border-line pb-2">
                <span className="display-face text-accent text-sm">
                  {e.term}
                </span>
                {k && <span className="ml-2 text-xs font-bold text-txt">{k.term}</span>}
                {e.cost && <span className="ml-2 hud-label">{t('glossary.takesACost')}</span>}
                <p className="text-xs text-txtDim leading-snug mt-0.5">{k ? k.text : e.text}</p>
                {k && (
                  <p className="text-micro text-txtFaint leading-snug mt-1">{e.text}</p>
                )}
              </div>
            )
          })}
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
          <h2 className="hud-label text-txt">{t('glossary.title')}</h2>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('glossary.search')}
            className="flex-1 px-2 py-1 bg-bg border border-line text-sm text-txt placeholder-txtFaint"
          />
          <button onClick={onClose} className="text-txtDim hover:text-accent text-sm">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto p-4 text-txt">
          <Section title={t('glossary.keywords')} entries={keywords} />
          <Section title={t('glossary.actions')} entries={actions} />
          <Section title={t('glossary.rules')} entries={rules} />
          <p className="hud-label normal-case tracking-normal mt-2">
            {t('glossary.source')}
          </p>
          {locale !== 'en' && (
            <p className="hud-label normal-case tracking-normal mt-1">
              {t('glossary.englishNote')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
