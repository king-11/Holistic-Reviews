import { Marked } from 'marked';
import { nameToEmoji } from 'gemoji';
import sanitizeHtml from 'sanitize-html';

const markdown = new Marked({
  gfm: true,
  breaks: true,
  walkTokens(token) {
    if (token.type === 'text')
      token.text = token.text.replace(/:([a-zA-Z0-9_+-]+):/g, (match: string, name: string) =>
        Object.hasOwn(nameToEmoji, name) ? nameToEmoji[name] : match,
      );
  },
});

export function renderMarkdown(body: string, baseUrl = 'https://github.com/') {
  return sanitizeHtml(markdown.parse(body, { async: false }), {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'details', 'summary', 'input', 'img', 'del'],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      code: ['class'],
      input: ['type', 'checked', 'disabled'],
      img: ['src', 'alt', 'title', 'loading', 'referrerpolicy'],
      th: ['align'],
      td: ['align'],
      ol: ['start'],
    },
    allowedClasses: { code: [/^language-[\w+-]+$/] },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowedSchemesByTag: { img: ['https'] },
    allowProtocolRelative: false,
    parseStyleAttributes: false,
    transformTags: {
      a: (_tag, attributes) => {
        let href = attributes.href || '';
        try {
          href = new URL(href, baseUrl).href;
        } catch {
          href = '';
        }
        return { tagName: 'a', attribs: { ...attributes, href, target: '_blank', rel: 'noopener noreferrer' } };
      },
      input: (_tag, attributes) => ({
        tagName: 'input',
        attribs: { type: 'checkbox', disabled: '', ...('checked' in attributes ? { checked: '' } : {}) },
      }),
      img: (_tag, attributes) => ({ tagName: 'img', attribs: { ...attributes, loading: 'lazy', referrerpolicy: 'no-referrer' } }),
    },
  });
}
