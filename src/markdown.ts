import { Marked, type Token, type Tokens } from 'marked';
import { nameToEmoji } from 'gemoji';
import sanitizeHtml from 'sanitize-html';

// GitHub logins are up to 39 alphanumerics with single inner hyphens; a word character before `@` makes it an email.
const mention =
  /(^|[^\w`])@(?=[A-Za-z0-9-]{1,39}(?![A-Za-z0-9-]))([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)(?:\/([A-Za-z0-9](?:[\w-]*[A-Za-z0-9])?))?(?![\w-])/g;
const mentionLink = (login: string, team?: string) =>
  team
    ? `<a class="user-mention" href="https://github.com/orgs/${login}/teams/${team}" data-team="${login}/${team}">@${login}/${team}</a>`
    : `<a class="user-mention" href="https://github.com/${login}" data-login="${login}">@${login}</a>`;

function mentionTokens(text: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of text.matchAll(mention)) {
    const start = match.index + match[1].length;
    const html = mentionLink(match[2], match[3]);
    if (start > last) tokens.push({ type: 'text', raw: text.slice(last, start), text: text.slice(last, start) });
    tokens.push({ type: 'html', raw: html, text: html, block: false } as Tokens.HTML);
    last = match.index + match[0].length;
  }
  if (tokens.length && last < text.length) tokens.push({ type: 'text', raw: text.slice(last), text: text.slice(last) });
  return tokens;
}
// Mentions only replace plain text, skipping code and anything already inside a Markdown or raw HTML link.
function linkMentions(tokens: Token[]) {
  let opaque = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type === 'html')
      opaque = Math.max(0, opaque + (/^<(a|code|pre)\b/i.test(token.text) ? 1 : /^<\/(a|code|pre)>/i.test(token.text) ? -1 : 0));
    if (opaque || ['code', 'codespan', 'link', 'image', 'html', 'escape'].includes(token.type)) continue;
    if (token.type === 'text' && !('tokens' in token && token.tokens)) {
      const parts = mentionTokens(token.text);
      if (parts.length) {
        tokens.splice(index, 1, ...parts);
        index += parts.length - 1;
      }
      continue;
    }
    const nested = token as { tokens?: Token[]; items?: Token[]; header?: Tokens.TableCell[]; rows?: Tokens.TableCell[][] };
    for (const children of [
      nested.tokens,
      nested.items,
      ...(nested.header ?? []).map(cell => cell.tokens),
      ...(nested.rows ?? []).flat().map(cell => cell.tokens),
    ])
      if (children) linkMentions(children);
  }
  return tokens;
}

const markdown = new Marked({
  gfm: true,
  breaks: true,
  hooks: { processAllTokens: linkMentions },
  walkTokens(token) {
    if (token.type === 'text')
      token.text = token.text.replace(/:([a-zA-Z0-9_+-]+):/g, (match: string, name: string) =>
        Object.hasOwn(nameToEmoji, name) ? nameToEmoji[name] : match,
      );
  },
});

// The `@token` the caret is completing, unless it sits in a fenced block or inline code on its line.
export function mentionQuery(text: string, caret: number) {
  const before = text.slice(0, caret);
  const match = /(?:^|[^\w`])@([A-Za-z0-9-]*)$/.exec(before);
  if (!match) return null;
  const start = caret - match[1].length - 1;
  const line = before.slice(before.lastIndexOf('\n', start) + 1, start);
  const fences = before.slice(0, start).match(/^[ \t]*(```|~~~)/gm)?.length ?? 0;
  if (fences % 2 || (line.match(/`/g)?.length ?? 0) % 2) return null;
  return { start, query: match[1] };
}

export function renderMarkdown(body: string, baseUrl = 'https://github.com/') {
  return sanitizeHtml(markdown.parse(body, { async: false }), {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'details', 'summary', 'input', 'img', 'del'],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel', 'class', 'data-login', 'data-team'],
      code: ['class'],
      input: ['type', 'checked', 'disabled'],
      img: ['src', 'alt', 'title', 'loading', 'referrerpolicy'],
      th: ['align'],
      td: ['align'],
      ol: ['start'],
    },
    allowedClasses: { code: [/^language-[\w+-]+$/], a: ['user-mention'] },
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
