export const CONTENT_FORMATS = ['post', 'video', 'story', 'article'] as const;

export type ContentFormat = (typeof CONTENT_FORMATS)[number];

export function isContentFormat(value: unknown): value is ContentFormat {
  return typeof value === 'string' && (CONTENT_FORMATS as readonly string[]).includes(value);
}
