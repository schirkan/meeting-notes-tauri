const languages = {
  'de-DE': 'German', 'en-US': 'English (United States)', 'en-GB': 'English (United Kingdom)',
  'fr-FR': 'French', 'es-ES': 'Spanish', 'it-IT': 'Italian', 'pt-BR': 'Portuguese (Brazil)',
  'nl-NL': 'Dutch', 'pl-PL': 'Polish', 'tr-TR': 'Turkish', 'ja-JP': 'Japanese'
}

export function SpeechLanguageOptions({ language }: { language: string }) {
  return <>
    {!Object.hasOwn(languages, language) && <option value={language}>{language}</option>}
    {Object.entries(languages).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
  </>
}
