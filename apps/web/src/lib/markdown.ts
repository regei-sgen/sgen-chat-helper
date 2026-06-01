import { marked } from 'marked';
import hljs from 'highlight.js';

marked.setOptions({
  gfm: true,
  breaks: false,
});

marked.use({
  renderer: {
    code(token) {
      const lang = (token.lang ?? '').match(/\S*/)?.[0] ?? '';
      let html = token.text;
      if (lang && hljs.getLanguage(lang)) {
        try {
          html = hljs.highlight(token.text, { language: lang, ignoreIllegals: true }).value;
        } catch {
          html = hljs.highlightAuto(token.text).value;
        }
      } else {
        html = hljs.highlightAuto(token.text).value;
      }
      return `<pre><code class="hljs language-${lang}">${html}</code></pre>`;
    },
  },
});

export function renderMarkdown(input: string | null | undefined): string {
  if (!input) return '';
  return marked.parse(input, { async: false }) as string;
}
