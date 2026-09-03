import { Button } from '@/components/ui/button'
import { translateIn, useLanguage } from '@/i18n'
import { setLanguage, type Language } from '@/i18n/language'

/** The language each state leads to. Two languages, so the toggle is a swap. */
const NEXT: Record<Language, Language> = { en: 'fr', fr: 'en' }

/** Two letters, upper case: the ISO 639-1 code of the language you would get. */
const CODE: Record<Language, string> = { en: 'EN', fr: 'FR' }

/**
 * The public header's language control (F24).
 *
 * **It names the destination, not the state** — `FR` while you are reading
 * English — which is the same rule `theme-toggle.tsx` follows and for the reason
 * its `NEXT_LABEL` comment gives.
 *
 * Two letters rather than an icon, having rejected the two obvious icons: a globe
 * does not say *which* language, and a flag is a country rather than a language,
 * which is wrong about French before it is wrong about anything else.
 *
 * **The accessible name is written in the language it leads to.** Somebody
 * stranded in a language they cannot read is exactly the person who needs to find
 * this control, so it is not translated with the rest of the page — it is always
 * the other side's own sentence.
 */
export function LanguageToggle() {
  const language = useLanguage()
  const next = NEXT[language]

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => setLanguage(next)}
      aria-label={translateIn(next, 'language.switchTo')}
      // `font-mono` and the eyebrow tracking so that two letters read as a code
      // rather than as a truncated word, matching the uppercase labels elsewhere
      // in both headers.
      className="tracking-eyebrow font-mono text-xs"
    >
      {CODE[next]}
    </Button>
  )
}
