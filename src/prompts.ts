export interface BuildPromptOptions {
  language: string;
  localeCode: string;
  peopleTraits?: string | null;
  keepTerms?: string[];
}

export function buildPrompt(opts: BuildPromptOptions): string {
  const { language, localeCode, peopleTraits, keepTerms } = opts;

  const keepClause =
    keepTerms && keepTerms.length > 0
      ? `proper nouns and brand names (${keepTerms.join(', ')}), `
      : '';

  let prompt =
    `Translate all visible text in this App Store screenshot from English to ${language}. ` +
    `This includes the large headline text at the top AND all text visible inside the phone screen mockup. ` +
    `Keep the exact same layout, colors, fonts, design, and visual style. ` +
    `Do NOT translate: ${keepClause}numbers, dates, units of measurement, or measurement values. ` +
    `Preserve all icons, images, and UI elements exactly as they are. ` +
    `IMPORTANT: Translated text must not overlap with other text or UI elements. ` +
    `If the translated text is longer than the original, reduce the font size slightly rather than letting it overflow or overlap. ` +
    `Ensure all text stays within its original bounding area and does not bleed into adjacent elements, ` +
    `the phone mockup, or the background. Keep clear separation between all text blocks and visual components.`;

  if (peopleTraits) {
    prompt +=
      ` In addition, replace any photographic human subjects in the screenshot ` +
      `(faces in app screens, profile pictures, hero photos) ` +
      `with ${peopleTraits}. Keep the same pose, framing, lighting, expression, ` +
      `and clothing style as the original. If multiple photos depict the same ` +
      `person across different states or moments, the replacement must remain ` +
      `the same individual in every instance — same face, same identity. ` +
      `Do NOT alter illustrated avatars, icons, emoji, logos, or any non-photographic ` +
      `graphics — those must stay exactly as they are.`;
  }

  if (localeCode === 'ar-SA') {
    prompt += ' Use right-to-left text direction where appropriate for Arabic.';
  } else if (localeCode === 'he') {
    prompt += ' Use right-to-left text direction where appropriate for Hebrew.';
  } else if (localeCode === 'ja') {
    prompt += ' Use natural Japanese with appropriate kanji, hiragana, and katakana.';
  } else if (localeCode === 'th') {
    prompt += ' Use natural Thai script with no spaces between words within a sentence.';
  } else if (localeCode === 'zh-Hans') {
    prompt += ' Use Simplified Chinese characters.';
  }

  return prompt;
}
