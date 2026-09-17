#!/usr/bin/env node
// Builds the Demo-Math-Journal organization index: README.md, index.html,
// and data/repos.json. Run by .github/workflows/build-index.yml on a
// schedule, or manually with `node scripts/build-index.mjs`.
//
// Requires a GITHUB_TOKEN with read access to public repositories (the
// default Actions token is enough — see SETUP.md).

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ORG = process.env.GITHUB_ORG || 'Demo-Math-Journal';
const TOKEN = process.env.GITHUB_TOKEN;
const EXCLUDED_LOGIN = 'twoodwardmidd'; // excluded contributor, case-insensitive
const API_BASE = 'https://api.github.com';
const MAX_PARAGRAPH_LENGTH = 320;

// The repo this workflow runs in is excluded from its own index.
const SELF_REPO_NAME = (process.env.GITHUB_REPOSITORY || `${ORG}/${ORG}.github.io`)
  .split('/')[1]
  .toLowerCase();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

if (!TOKEN) {
  console.error('GITHUB_TOKEN is not set. See SETUP.md.');
  process.exit(1);
}

// ---------------------------------------------------------------------
// GitHub API helpers
// ---------------------------------------------------------------------

async function ghRequest(url, { accept = 'application/vnd.github+json' } = {}) {
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': `${ORG}-index-builder`,
    },
  });
}

// Follows the `Link: <url>; rel="next"` header to collect every page of a
// GitHub list endpoint.
async function ghPaginate(initialUrl) {
  const items = [];
  let url = initialUrl;
  while (url) {
    const res = await ghRequest(url);
    if (!res.ok) {
      throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
    }
    const page = await res.json();
    items.push(...page);
    url = nextPageUrl(res.headers.get('link'));
  }
  return items;
}

function nextPageUrl(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

async function listOrgRepos(org) {
  const url = `${API_BASE}/orgs/${encodeURIComponent(org)}/repos?type=all&per_page=100&sort=full_name&direction=asc`;
  return ghPaginate(url);
}

// Returns the README's raw text, or null if the repo has no README.
async function getReadmeText(owner, repo) {
  const res = await ghRequest(`${API_BASE}/repos/${owner}/${repo}/readme`);
  if (res.status === 404) return null;
  if (!res.ok) {
    console.warn(`  README fetch failed for ${owner}/${repo}: ${res.status}`);
    return null;
  }
  const json = await res.json();
  if (!json.content) return null;
  return Buffer.from(json.content.replace(/\n/g, ''), 'base64').toString('utf-8');
}

// Returns { contributors, overflow } where contributors excludes bots and
// EXCLUDED_LOGIN, and overflow is true if GitHub declined to compute the
// full list (it does this for repos with very many contributors).
async function getContributors(owner, repo) {
  const url = `${API_BASE}/repos/${owner}/${repo}/contributors?per_page=100&anon=false`;
  try {
    const res = await ghRequest(url);
    if (res.status === 204) return { contributors: [], overflow: false }; // empty repo
    if (res.status === 403) return { contributors: [], overflow: true };
    if (!res.ok) {
      console.warn(`  Contributors fetch failed for ${owner}/${repo}: ${res.status}`);
      return { contributors: [], overflow: false };
    }
    const list = await ghPaginate(url);
    const contributors = list
      .filter((c) => c.type !== 'Bot' && c.login && c.login.toLowerCase() !== EXCLUDED_LOGIN)
      .sort((a, b) => b.contributions - a.contributions)
      .map((c) => ({ login: c.login, htmlUrl: c.html_url }));
    return { contributors, overflow: false };
  } catch (err) {
    console.warn(`  Contributors fetch errored for ${owner}/${repo}: ${err.message}`);
    return { contributors: [], overflow: false };
  }
}

// ---------------------------------------------------------------------
// README parsing: pull the first real paragraph out of a README's
// markdown, skipping front matter, headings, rules, tables, and
// badge/logo-only lines (e.g. shields.io build badges).
// ---------------------------------------------------------------------

function stripFrontMatter(markdown) {
  if (markdown.startsWith('---')) {
    const end = markdown.indexOf('\n---', 3);
    if (end !== -1) {
      const afterFence = markdown.indexOf('\n', end + 1);
      return afterFence === -1 ? '' : markdown.slice(afterFence + 1);
    }
  }
  return markdown;
}

function isSkippableLine(line) {
  const trimmed = line.trim();
  if (trimmed === '') return true;
  if (/^#{1,6}\s/.test(trimmed)) return true; // ATX heading
  if (/^(=+|-+)\s*$/.test(trimmed)) return true; // setext heading underline
  if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(trimmed)) return true; // hr
  if (/^\|/.test(trimmed)) return true; // table row
  if (/^<!--/.test(trimmed)) return true; // stray HTML comment marker

  // Badge / logo-only lines: strip every markdown image and link from the
  // line and see if anything meaningful is left.
  const withoutLinksAndImages = trimmed
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\s+/g, '');
  if (trimmed.includes('![') && withoutLinksAndImages.length < 3) return true;

  return false;
}

function toPlainText(markdown) {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links -> link text
    .replace(/`([^`]*)`/g, '$1') // inline code
    .replace(/(\*\*|__)(.*?)\1/g, '$2') // bold
    .replace(/(\*|_)(.*?)\1/g, '$2') // italic
    .replace(/^>\s?/gm, '') // blockquote markers
    .replace(/\s+/g, ' ')
    .trim();
}

function extractFirstParagraph(markdown) {
  if (!markdown) return null;
  const body = stripFrontMatter(markdown).replace(/<!--[\s\S]*?-->/g, '');
  const lines = body.split('\n');

  let paragraphLines = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (paragraphLines.length === 0) {
      if (isSkippableLine(line)) continue;
      paragraphLines.push(line);
    } else {
      if (line.trim() === '') break;
      paragraphLines.push(line);
    }
  }

  if (paragraphLines.length === 0) return null;
  const text = toPlainText(paragraphLines.join(' '));
  if (!text) return null;
  return text.length > MAX_PARAGRAPH_LENGTH
    ? `${text.slice(0, MAX_PARAGRAPH_LENGTH).trimEnd()}…`
    : text;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function humanize(text) {
  return text
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function titleCaseFromRepoName(name) {
  return humanize(name);
}

// Reads site.json for a human-editable site title and description. This
// file is never written by this script, so your edits persist across
// every scheduled rebuild. Falls back to a hyphen-free version of the org
// name, and no description, if the file is missing or a field is unset.
async function loadSiteConfig() {
  const defaults = { title: humanize(ORG), description: null };
  try {
    const raw = await readFile(path.join(ROOT, 'site.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      title:
        typeof parsed.title === 'string' && parsed.title.trim()
          ? parsed.title.trim()
          : defaults.title,
      description:
        typeof parsed.description === 'string' && parsed.description.trim()
          ? parsed.description.trim()
          : defaults.description,
    };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`Could not read site.json, using defaults: ${err.message}`);
    }
    return defaults;
  }
}

// ---------------------------------------------------------------------
// Gather data for every repo
// ---------------------------------------------------------------------

async function buildRepoEntries() {
  console.log(`Listing repositories in ${ORG}...`);
  const rawRepos = (await listOrgRepos(ORG)).filter(
    (r) => r.name.toLowerCase() !== SELF_REPO_NAME
  );
  rawRepos.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  console.log(`Found ${rawRepos.length} repositories (excluding this index repo).`);

  const entries = [];
  for (const repo of rawRepos) {
    console.log(`Processing ${repo.full_name}...`);
    const [readmeText, contributorInfo] = await Promise.all([
      getReadmeText(repo.owner.login, repo.name),
      getContributors(repo.owner.login, repo.name),
    ]);

    const firstParagraph = extractFirstParagraph(readmeText);

    entries.push({
      name: repo.name,
      displayTitle: titleCaseFromRepoName(repo.name),
      htmlUrl: repo.html_url,
      description: repo.description || null,
      summary: firstParagraph || repo.description || null,
      contributors: contributorInfo.contributors,
      contributorsOverflow: contributorInfo.overflow,
      isFork: repo.fork,
      isArchived: repo.archived,
      updatedAt: repo.pushed_at,
    });
  }
  return entries;
}

// ---------------------------------------------------------------------
// Render README.md
// ---------------------------------------------------------------------

function renderReadme(entries, builtAt, site) {
  const lines = [];
  lines.push('<!-- AUTO-GENERATED by scripts/build-index.mjs — do not edit by hand.');
  lines.push('     Changes here are overwritten on the next scheduled run. -->');
  lines.push('');
  lines.push(`# ${site.title}`);
  lines.push('');
  if (site.description) {
    lines.push(site.description);
    lines.push('');
  }
  lines.push(
    `An automatically generated index of every repository in the [${ORG}](https://github.com/${ORG}) organization. Rebuilt nightly by [GitHub Actions](.github/workflows/build-index.yml). See [SETUP.md](SETUP.md) for how it works.`
  );
  lines.push('');
  lines.push(`_Last built: ${builtAt}_`);
  lines.push('');

  if (entries.length === 0) {
    lines.push('_No repositories found._');
  }

  for (const entry of entries) {
    lines.push(`## [${entry.displayTitle}](${entry.htmlUrl})`);
    lines.push('');
    if (entry.summary) {
      lines.push(entry.summary);
    } else {
      lines.push('_No description available._');
    }
    lines.push('');
    lines.push(`**Contributors:** ${formatContributorsMarkdown(entry)}`);
    lines.push('');
  }

  return lines.join('\n');
}

function formatContributorsMarkdown(entry) {
  if (entry.contributors.length === 0) {
    return entry.contributorsOverflow ? '_too many to list_' : '_none listed_';
  }
  const names = entry.contributors.map((c) => `[@${c.login}](${c.htmlUrl})`).join(', ');
  return entry.contributorsOverflow ? `${names}, _and more_` : names;
}

// ---------------------------------------------------------------------
// Render index.html
// ---------------------------------------------------------------------

function formatContributorsHtml(entry) {
  if (entry.contributors.length === 0) {
    return entry.contributorsOverflow
      ? '<span class="text-body-secondary">too many to list</span>'
      : '<span class="text-body-secondary">none listed</span>';
  }
  const links = entry.contributors
    .map((c) => `<a href="${escapeHtml(c.htmlUrl)}">@${escapeHtml(c.login)}</a>`)
    .join(', ');
  return entry.contributorsOverflow
    ? `${links}, <span class="text-body-secondary">and more</span>`
    : links;
}

function renderRepoCard(entry) {
  const searchKey = escapeHtml(
    `${entry.displayTitle} ${entry.name} ${entry.description || ''}`.toLowerCase()
  );
  const summary = entry.summary
    ? escapeHtml(entry.summary)
    : '<span class="text-body-secondary">No description available.</span>';
  const badges = [
    entry.isArchived ? '<span class="badge text-bg-secondary">Archived</span>' : '',
    entry.isFork ? '<span class="badge text-bg-secondary">Fork</span>' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return `      <div class="col-12 col-md-6 col-lg-4 repo-card" data-repo-search="${searchKey}">
        <article class="card h-100">
          <div class="card-body d-flex flex-column">
            <h2 class="h5 card-title">
              <a href="${escapeHtml(entry.htmlUrl)}">${escapeHtml(entry.displayTitle)}</a>
              ${badges}
            </h2>
            <p class="card-text flex-grow-1">${summary}</p>
            <p class="card-text small mb-0">
              <span class="fw-semibold">Contributors:</span>
              ${formatContributorsHtml(entry)}
            </p>
          </div>
        </article>
      </div>`;
}

function renderHtml(entries, builtAt, site) {
  const cards = entries.map(renderRepoCard).join('\n');
  const repoWorkflowUrl = process.env.GITHUB_REPOSITORY
    ? `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions`
    : `https://github.com/${ORG}/${ORG}.github.io/actions`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(site.title)} — Repository Index</title>
  <meta name="description" content="${escapeHtml(site.description || `An index of repositories in the ${ORG} GitHub organization, rebuilt automatically.`)}">
  <script>
    // Set light/dark theme before first paint, based on the visitor's OS
    // preference, using Bootstrap 5.3's built-in color modes.
    (function () {
      try {
        var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-bs-theme', prefersDark ? 'dark' : 'light');
      } catch (e) {}
    })();
  </script>
  <link
    href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"
    rel="stylesheet"
    integrity="sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH"
    crossorigin="anonymous">
  <link rel="stylesheet" href="assets/style.css">
</head>
<body>
  <a class="visually-hidden-focusable skip-link" href="#main-content">Skip to main content</a>

  <header class="border-bottom py-4 mb-4">
    <div class="container">
      <h1 class="h3 mb-1">${escapeHtml(site.title)}</h1>
      ${site.description ? `<p>${escapeHtml(site.description)}</p>\n      ` : ''}<p class="text-body-secondary mb-0">Repository index, rebuilt automatically. Last built: <time datetime="${builtAt}">${builtAt}</time>.</p>
    </div>
  </header>

  <main id="main-content" class="container pb-5">
    <div class="row mb-4">
      <div class="col-12 col-md-6">
        <label for="repo-search" class="form-label">Filter repositories</label>
        <input type="search" id="repo-search" class="form-control" placeholder="Type a repo name or keyword…">
        <div id="repo-search-status" class="form-text" aria-live="polite">Showing ${entries.length} of ${entries.length} repositories.</div>
      </div>
    </div>

    <div class="row g-4" id="repo-list">
${cards}
    </div>

    <p id="no-results" class="text-body-secondary mt-4 d-none" role="status">No repositories match your filter.</p>
  </main>

  <footer class="border-top py-4 mt-5">
    <div class="container small text-body-secondary">
      Built automatically by <a href="${escapeHtml(repoWorkflowUrl)}">GitHub Actions</a> from the
      <a href="https://github.com/${escapeHtml(ORG)}">${escapeHtml(ORG)}</a> organization.
    </div>
  </footer>

  <script src="assets/filter.js" defer></script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

async function main() {
  const site = await loadSiteConfig();
  const entries = await buildRepoEntries();
  const builtAt = new Date().toISOString();

  await mkdir(path.join(ROOT, 'data'), { recursive: true });
  await writeFile(path.join(ROOT, 'README.md'), renderReadme(entries, builtAt, site), 'utf-8');
  await writeFile(path.join(ROOT, 'index.html'), renderHtml(entries, builtAt, site), 'utf-8');
  await writeFile(
    path.join(ROOT, 'data', 'repos.json'),
    JSON.stringify(
      { org: ORG, title: site.title, description: site.description, builtAt, repos: entries },
      null,
      2
    ),
    'utf-8'
  );

  console.log(`Wrote README.md, index.html, and data/repos.json for ${entries.length} repositories.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
