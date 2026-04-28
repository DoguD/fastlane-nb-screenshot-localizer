export const SOURCE_LOCALE = 'en-US';

export const LOCALE_LANGUAGES: Record<string, string> = {
  'ar-SA': 'Arabic',
  cs: 'Czech',
  da: 'Danish',
  'de-DE': 'German',
  'es-ES': 'Spanish',
  'es-MX': 'Mexican Spanish',
  'fr-FR': 'French',
  he: 'Hebrew',
  hr: 'Croatian',
  id: 'Indonesian',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  'nl-NL': 'Dutch',
  no: 'Norwegian',
  pl: 'Polish',
  'pt-PT': 'Portuguese',
  'pt-BR': 'Brazilian Portuguese',
  ru: 'Russian',
  sv: 'Swedish',
  th: 'Thai',
  tr: 'Turkish',
  uk: 'Ukrainian',
  vi: 'Vietnamese',
  'zh-Hans': 'Simplified Chinese',
};

export const LOCALE_PEOPLE_TRAITS: Record<string, string> = {
  'ar-SA': 'Middle Eastern / Arab people; women may wear a hijab where appropriate',
  'es-MX': 'Mexican people with Latino features',
  id: 'Indonesian people with Southeast Asian / Malay features',
  ja: 'Japanese people',
  ko: 'Korean people',
  'pt-BR': 'Brazilian people with mixed Latin American features',
  th: 'Thai people with Southeast Asian features',
  tr: 'Turkish people with Mediterranean / West Asian features',
  vi: 'Vietnamese people with East / Southeast Asian features',
  'zh-Hans': 'Han Chinese people',
};

export const COPY_FROM_SOURCE: string[] = ['en-AU', 'en-CA', 'en-GB'];

export const SHARED_LOCALES: Record<string, string[]> = {
  'fr-FR': ['fr-CA'],
};
