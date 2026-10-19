import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from './markdown.ts';

describe('safe GitHub-flavored Markdown', () => {
  it('renders GitHub emoji shortcodes and native emoji without modifying code or link destinations', () => {
    const html = renderMarkdown(
      ':smile: :+1: :tada: :heart: :rocket: 👀 :not_an_emoji:\n\n`:+1:`\n\n```txt\n:smile:\n```\n\n[Ship :rocket:](https://example.com/:smile:)',
    );
    assert.match(html, /😄 👍 🎉 ❤️ 🚀 👀 :not_an_emoji:/);
    assert.match(html, /<code>:\+1:<\/code>/);
    assert.match(html, /class="language-txt">:smile:/);
    assert.match(html, /href="https:\/\/example.com\/:smile:"/);
    assert.match(html, /Ship 🚀/);
    assert.doesNotMatch(renderMarkdown(':constructor: :toString: :hasOwnProperty:'), /function|\[object/);
  });
  it('preserves checked and unchecked nested tasks without making the checklist interactive', () => {
    const html = renderMarkdown(
      '- [ ] Customer Reported Escalation Fix\n- [x] Customer Impact Infra Update\n  - If selected, choose one:\n    - [ ] GCP only\n    - [x] AWS only\n    - [ ] Platform Agnostic',
    );
    assert.equal((html.match(/type="checkbox"/g) || []).length, 5);
    assert.equal((html.match(/disabled checked/g) || []).length, 2);
    assert.equal((html.match(/disabled \/>/g) || []).length, 3);
    assert.match(html, /If selected, choose one:<ul>/);
    assert.doesNotMatch(html, /<input(?![^>]*disabled)/);
  });
  it('renders headings, emphasis, code, quotes, lists, links and soft breaks', () => {
    const html = renderMarkdown(
      '# Review\n\n**Important** — use `targetType`.\nNext line.\n\n> Quoted\n\n- First\n- Second\n\n[Source](https://github.com/acme/app)\n\n```ts\nconst value = 1;\n```',
    );
    for (const pattern of [
      /<h1>Review<\/h1>/,
      /<strong>Important<\/strong>/,
      /<code>targetType<\/code>/,
      /<br \/>/,
      /<blockquote>/,
      /<ul>/,
      /<li>First<\/li>/,
      /class="language-ts"/,
      /target="_blank"/,
      /rel="noopener noreferrer"/,
    ])
      assert.match(html, pattern);
  });
  it('renders tables, task lists, strikethrough and expandable details', () => {
    const html = renderMarkdown(
      '| Key | Value |\n| --- | --- |\n| Type | Enterprise |\n\n- [x] Done\n- [ ] Pending\n\n~~Old~~\n\n<details><summary>Agent cost breakdown</summary><p>Details</p></details>',
    );
    assert.match(html, /<table>/);
    assert.match(html, /<td>Enterprise<\/td>/);
    assert.match(html, /type="checkbox" disabled checked/);
    assert.match(html, /<del>Old<\/del>/);
    assert.match(html, /<details><summary>Agent cost breakdown<\/summary>/);
  });
  it('hides HTML comment markers without hiding code examples or review content', () => {
    const html = renderMarkdown('Review text\n\n<!-- PRIVATE_MARKER -->\n\n*Reviewer run*\n\n```html\n<!-- example -->\n```');
    assert.doesNotMatch(html, /PRIVATE_MARKER/);
    assert.match(html, /<em>Reviewer run<\/em>/);
    assert.match(html, /&lt;!-- example --&gt;/);
  });
  it('removes scripts, active embeds, event handlers, styles and DOM-clobbering names', () => {
    const html = renderMarkdown(
      '<script>alert(1)</script><iframe src="https://evil.test"></iframe><svg onload="alert(1)"></svg><p id="location" style="position:fixed" onclick="alert(1)">Safe</p><input name="cookie" type="password" autofocus>',
    );
    assert.doesNotMatch(html, /script|iframe|svg|onload|onclick|style=|id=|name=|autofocus|password|alert/);
    assert.match(html, /Safe/);
    assert.match(html, /type="checkbox" disabled/);
  });
  it('blocks unsafe and obfuscated URL schemes, including in images', () => {
    for (const url of ['javascript:alert(1)', 'jav&#x61;script:alert(1)', 'data:text/html,evil', 'vbscript:evil', '//evil.test']) {
      const html = renderMarkdown(`<a href="${url}">link</a><img src="${url}" onerror="evil()">`);
      assert.doesNotMatch(html, /href="(?:javascript|data|vbscript):|src="(?:javascript|data|vbscript):|onerror/);
    }
    assert.doesNotMatch(renderMarkdown('![image](http://evil.test/image)'), /src=/);
  });
  it('resolves relative links safely and protects external links and images', () => {
    const html = renderMarkdown(
      '[Guide](./docs/guide.md)\n\n![Diagram](https://example.com/image.png)',
      'https://github.com/acme/app/blob/main/',
    );
    assert.match(html, /href="https:\/\/github.com\/acme\/app\/blob\/main\/docs\/guide.md"/);
    assert.match(html, /loading="lazy"/);
    assert.match(html, /referrerpolicy="no-referrer"/);
  });
  it('keeps empty and malformed input safe', () => {
    assert.equal(renderMarkdown(''), '');
    assert.doesNotMatch(renderMarkdown('<a href="javascript:alert(1)"><strong>Test'), /javascript/);
    assert.match(renderMarkdown('<img src=x><p>Still readable'), /Still readable/);
  });
});
