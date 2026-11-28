import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Marked } from 'marked';

const guides = [
  ['index', 'Getting started'],
  ['chat', 'Chat and keys'],
  ['policies', 'Agent limits'],
  ['repositories', 'Pull requests and main'],
  ['commands', 'Commands'],
  ['authentication', 'Accounts and clans'],
  ['webhooks', 'GitHub webhooks'],
];
// Operator guides (hosting, database) stay in the repository, not on the user site.
const published = new Set(guides.map(([slug]) => slug));
const repositoryDocs = 'https://github.com/clqn-org/clqn/blob/main/docs/';

// Only repository-authored Markdown enters this build. Render it once so the
// published pages and their fragment links work even with JavaScript disabled.
const markdown = new Marked({
  renderer: {
    heading({ tokens, text, depth }) {
      const id = text
        .toLowerCase()
        .replace(/[^a-z0-9 -]/g, '')
        .trim()
        .replace(/\s+/g, '-');
      return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
    },
  },
  walkTokens(token) {
    // Guides reference shared images as assets/…; the site serves them one level up.
    if (token.type === 'image' && token.href.startsWith('assets/')) token.href = `../${token.href}`;
    if (token.type !== 'link') return;
    if (token.href === '../README.md#install') token.href = '../download.html';
    else
      token.href = token.href.replace(/^([\w-]+)\.md(?=#|$)/, (_, slug) =>
        published.has(slug) ? `../docs/${slug}.html` : `${repositoryDocs}${slug}.md`,
      );
  },
});

export async function buildDocs(source, output) {
  await mkdir(output, { recursive: true });
  for (const [slug, title] of guides) {
    const sourceText = await readFile(new URL(`${slug}.md`, source), 'utf8');
    const canonicalPath = slug === 'index' ? '/docs/' : `/docs/${slug}.html`;
    const links = guides.map(([page, name]) => {
      const current = page === slug ? ' aria-current="page"' : '';
      // Hosts also serve the index at /docs without a slash, so name the folder explicitly.
      return `<li><a href="../docs/${page}.html"${current}>${name}</a></li>`;
    });
    const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#151619">
  <title>${title} · clqn docs</title>
  <link rel="canonical" href="https://clqn.org${canonicalPath}">
  <link rel="icon" href="../assets/logo.svg" type="image/svg+xml">
  <link rel="stylesheet" href="../site.css">
</head>
<body class="docs-body">
  <a class="skip-docs" href="#guide">Skip to guide</a>
  <div class="docs">
    <header class="bar">
      <a class="path" href="../index.html" aria-label="clqn home"><span aria-hidden="true">~/</span>clqn</a>
      <a href="../download.html">Download</a>
    </header>
    <div class="reader">
      <nav aria-label="Documentation">
        <p>Documentation</p>
        <ul>${links.join('\n')}</ul>
      </nav>
      <main id="guide" tabindex="-1"><article>${markdown.parse(sourceText)}</article></main>
    </div>
  </div>
</body>
</html>
`;
    await writeFile(new URL(`${slug}.html`, output), page);
  }
}
