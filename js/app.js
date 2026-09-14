/**
 * app.js
 *
 * Client-side, no-build index page for a GitHub org or user account.
 * On "Load repos" it calls the GitHub REST API directly from the browser,
 * pulls each repo's title from its README (first "# Heading" line, falling
 * back to the repo name) and its top contributors as "author(s)", and
 * renders the result as a grid of cards. Nothing is pre-built or cached;
 * every page load reflects GitHub's current state.
 *
 * No dependencies beyond Bootstrap 5 (CSS only, loaded in index.html).
 */

const GITHUB_API = "https://api.github.com";
const MAX_CONTRIBUTORS_SHOWN = 5;

const els = {
  form: document.getElementById("load-form"),
  ownerInput: document.getElementById("owner-input"),
  ownerType: document.getElementById("owner-type"),
  tokenInput: document.getElementById("token-input"),
  sortSelect: document.getElementById("sort-select"),
  filterInput: document.getElementById("filter-input"),
  loadBtn: document.getElementById("load-btn"),
  status: document.getElementById("status"),
  grid: document.getElementById("repo-grid"),
};

// Repos currently loaded, kept in memory so filter/sort don't re-fetch.
let loadedRepos = [];

function setStatus(message) {
  els.status.textContent = message;
}

function authHeaders(token) {
  const headers = { Accept: "application/vnd.github+json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

/** Fetch every repo for an org or user, following pagination. */
async function fetchAllRepos(ownerType, owner, token) {
  const repos = [];
  let url = `${GITHUB_API}/${ownerType}/${encodeURIComponent(owner)}/repos?per_page=100&type=public`;

  while (url) {
    const response = await fetch(url, { headers: authHeaders(token) });

    if (!response.ok) {
      throw await buildApiError(response, owner);
    }

    const page = await response.json();
    page.forEach((repo) => repos.push(repo));

    const linkHeader = response.headers.get("Link");
    url = parseNextLink(linkHeader);
  }

  return repos.filter((repo) => !repo.fork);
}

/** Parse the "next" URL out of a GitHub Link header, or return null. */
function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  const parts = linkHeader.split(",");
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

async function buildApiError(response, owner) {
  if (response.status === 404) {
    return new Error(`No org or user named "${owner}" was found on GitHub.`);
  }
  if (response.status === 403 && response.headers.get("X-RateLimit-Remaining") === "0") {
    const resetEpoch = Number(response.headers.get("X-RateLimit-Reset"));
    const resetTime = Number.isFinite(resetEpoch)
      ? new Date(resetEpoch * 1000).toLocaleTimeString()
      : "later";
    return new Error(
      `GitHub API rate limit reached. It resets at ${resetTime}. ` +
        `Add a personal access token under "Advanced" to raise the limit to 5,000/hour.`
    );
  }
  return new Error(`GitHub API request failed (HTTP ${response.status}).`);
}

/** Decode a GitHub Contents API base64 payload as UTF-8 text. */
function decodeBase64Content(base64) {
  const cleaned = base64.replace(/\n/g, "");
  const binary = atob(cleaned);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

const HTML_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  middot: "·",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  copy: "©",
  reg: "®",
  trade: "™",
};

function decodeHtmlEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, entity) => {
    if (entity[0] === "#") {
      const codePoint =
        entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : whole;
    }
    return entity in HTML_ENTITIES ? HTML_ENTITIES[entity] : whole;
  });
}

/**
 * Clean up a raw markdown H1 line for display as a title: real-world READMEs
 * (e.g. most popular open-source projects) put shields.io badges and links
 * directly in the title line, e.g. "# [React](url) [![build](img)](url) ...".
 * This strips images, unwraps links to their link text, decodes HTML
 * entities, and trims any punctuation-only debris badges leave behind.
 */
function sanitizeReadmeHeading(raw) {
  let text = raw;
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ""); // drop images (most badges)
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"); // unwrap links to their text
  text = decodeHtmlEntities(text);
  text = text.replace(/[`*_]/g, ""); // stray markdown emphasis characters
  text = text.replace(/\s+/g, " ").trim();
  text = text.replace(/[\s.,;:|·\-]+$/, "").trim(); // trailing badge debris
  return text;
}

/** Read a repo's README and pull out its first "# Heading" as a title. */
async function fetchReadmeTitle(owner, repoName, token) {
  const url = `${GITHUB_API}/repos/${owner}/${repoName}/readme`;
  const response = await fetch(url, { headers: authHeaders(token) });

  if (!response.ok) {
    return null; // No README, or inaccessible -- caller falls back to repo name.
  }

  const data = await response.json();
  const text = decodeBase64Content(data.content);

  for (const line of text.split("\n")) {
    const match = line.match(/^#\s+(.+?)\s*$/);
    if (match) {
      const cleaned = sanitizeReadmeHeading(match[1]);
      if (cleaned) return cleaned;
    }
  }
  return null;
}

/** Read a repo's top contributors (already sorted by contribution count by the API). */
async function fetchContributors(owner, repoName, token) {
  const url = `${GITHUB_API}/repos/${owner}/${repoName}/contributors?per_page=${MAX_CONTRIBUTORS_SHOWN}`;
  const response = await fetch(url, { headers: authHeaders(token) });

  if (!response.ok) {
    return []; // Empty repo, disabled contributors list, etc. -- caller falls back to owner.
  }

  return response.json();
}

function formatUpdated(isoDate) {
  const date = new Date(isoDate);
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function titleCaseFromRepoName(name) {
  return name
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Build one repo card as DOM nodes (no innerHTML with API text, to stay safe by default). */
function buildRepoCard(repo) {
  const col = document.createElement("div");
  col.className = "col-12 col-md-6 col-lg-4";

  const card = document.createElement("article");
  card.className = "card repo-card shadow-sm";

  const body = document.createElement("div");
  body.className = "card-body d-flex flex-column";

  // Title, linked to the repo.
  const titleEl = document.createElement("h3");
  titleEl.className = "h5 card-title";
  const titleLink = document.createElement("a");
  titleLink.href = repo.html_url;
  titleLink.textContent = repo.displayTitle;
  titleEl.appendChild(titleLink);
  body.appendChild(titleEl);

  // Description.
  if (repo.description) {
    const desc = document.createElement("p");
    desc.className = "card-text text-secondary";
    desc.textContent = repo.description;
    body.appendChild(desc);
  }

  // Topics.
  if (repo.topics && repo.topics.length > 0) {
    const topicsWrap = document.createElement("p");
    topicsWrap.className = "mb-2";
    repo.topics.forEach((topic) => {
      const badge = document.createElement("span");
      badge.className = "badge text-bg-light border topic-badge me-1 mb-1";
      badge.textContent = topic;
      topicsWrap.appendChild(badge);
    });
    body.appendChild(topicsWrap);
  }

  // Meta line: language, stars, last updated.
  const meta = document.createElement("p");
  meta.className = "small text-secondary mb-3";
  const metaParts = [];
  if (repo.language) metaParts.push(repo.language);
  metaParts.push(`★ ${repo.stargazers_count}`);
  metaParts.push(`updated ${formatUpdated(repo.pushed_at)}`);
  meta.textContent = metaParts.join(" · ");
  body.appendChild(meta);

  // Authors / contributors.
  const authorsWrap = document.createElement("div");
  authorsWrap.className = "mb-3";
  const authorsLabel = document.createElement("div");
  authorsLabel.className = "small text-secondary mb-1";
  authorsLabel.textContent = repo.contributors.length > 0 ? "Contributors" : "Owner";
  authorsWrap.appendChild(authorsLabel);

  const authorsList = document.createElement("div");
  authorsList.className = "d-flex flex-wrap gap-2 align-items-center";

  const authorEntries =
    repo.contributors.length > 0
      ? repo.contributors
      : [{ login: repo.owner.login, avatar_url: repo.owner.avatar_url, html_url: repo.owner.html_url }];

  authorEntries.forEach((person) => {
    const link = document.createElement("a");
    link.href = person.html_url;
    link.className = "d-inline-flex align-items-center gap-1 text-decoration-none";
    link.title = person.login;

    const img = document.createElement("img");
    img.src = person.avatar_url;
    img.alt = `${person.login} avatar`;
    img.className = "contributor-avatar";
    img.loading = "lazy";
    img.width = 28;
    img.height = 28;

    const label = document.createElement("span");
    label.className = "small";
    label.textContent = person.login;

    link.appendChild(img);
    link.appendChild(label);
    authorsList.appendChild(link);
  });

  authorsWrap.appendChild(authorsList);
  body.appendChild(authorsWrap);

  // Links row, pushed to the bottom of the card.
  const linksRow = document.createElement("div");
  linksRow.className = "mt-auto d-flex flex-wrap gap-2";

  const repoLink = document.createElement("a");
  repoLink.href = repo.html_url;
  repoLink.className = "btn btn-sm btn-outline-primary";
  repoLink.textContent = "View on GitHub";
  linksRow.appendChild(repoLink);

  const pagesUrl = repo.homepage || (repo.has_pages ? `https://${repo.owner.login}.github.io/${repo.name}/` : null);
  if (pagesUrl) {
    const pagesLink = document.createElement("a");
    pagesLink.href = pagesUrl;
    pagesLink.className = "btn btn-sm btn-outline-secondary";
    pagesLink.textContent = "Live site";
    linksRow.appendChild(pagesLink);
  }

  body.appendChild(linksRow);
  card.appendChild(body);
  col.appendChild(card);
  return col;
}

function sortRepos(repos, sortKey) {
  const sorted = repos.slice();
  if (sortKey === "name") {
    sorted.sort((a, b) => a.displayTitle.localeCompare(b.displayTitle));
  } else if (sortKey === "stars") {
    sorted.sort((a, b) => b.stargazers_count - a.stargazers_count);
  } else {
    sorted.sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at));
  }
  return sorted;
}

function filterRepos(repos, query) {
  if (!query) return repos;
  const needle = query.trim().toLowerCase();
  if (!needle) return repos;
  return repos.filter((repo) => {
    const haystack = [repo.displayTitle, repo.name, repo.description || "", ...(repo.topics || [])]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

function render() {
  const sortKey = els.sortSelect.value;
  const query = els.filterInput.value;
  const visible = filterRepos(sortRepos(loadedRepos, sortKey), query);

  els.grid.textContent = "";
  visible.forEach((repo) => els.grid.appendChild(buildRepoCard(repo)));

  if (loadedRepos.length > 0) {
    setStatus(`Showing ${visible.length} of ${loadedRepos.length} repositories.`);
  }
}

async function loadRepos(event) {
  event.preventDefault();

  const owner = els.ownerInput.value.trim();
  const ownerType = els.ownerType.value;
  const token = els.tokenInput.value.trim();

  if (!owner) return;

  els.loadBtn.disabled = true;
  els.filterInput.disabled = true;
  els.grid.textContent = "";
  loadedRepos = [];
  setStatus(`Loading repositories for ${owner}…`);

  // Remember the last-used owner locally (this browser only) as a convenience.
  try {
    localStorage.setItem("repoIndex.owner", owner);
    localStorage.setItem("repoIndex.ownerType", ownerType);
  } catch (err) {
    // Private browsing / disabled storage -- not essential, continue silently.
  }

  const params = new URLSearchParams(window.location.search);
  params.set("owner", owner);
  params.set("type", ownerType);
  history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);

  try {
    const repos = await fetchAllRepos(ownerType, owner, token);

    if (repos.length === 0) {
      setStatus(`${owner} has no public, non-fork repositories.`);
      els.loadBtn.disabled = false;
      return;
    }

    setStatus(`Found ${repos.length} repositories. Reading titles and contributors…`);

    // Enrich each repo with its README title and contributors. Run with
    // limited concurrency so a large org doesn't fire 100+ requests at once.
    const enriched = await mapWithConcurrency(repos, 6, async (repo) => {
      const [title, contributors] = await Promise.all([
        fetchReadmeTitle(owner, repo.name, token).catch(() => null),
        fetchContributors(owner, repo.name, token).catch(() => []),
      ]);
      repo.displayTitle = title || titleCaseFromRepoName(repo.name);
      repo.contributors = contributors;
      return repo;
    });

    loadedRepos = enriched;
    els.filterInput.disabled = false;
    els.filterInput.value = "";
    render();
  } catch (err) {
    setStatus(err.message);
  } finally {
    els.loadBtn.disabled = false;
  }
}

/** Run an async mapper over items with at most `limit` in flight at once. */
async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await mapper(items[current]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

function initFromUrlOrStorage() {
  const params = new URLSearchParams(window.location.search);
  const urlOwner = params.get("owner");
  const urlType = params.get("type");

  let storedOwner = null;
  let storedType = null;
  try {
    storedOwner = localStorage.getItem("repoIndex.owner");
    storedType = localStorage.getItem("repoIndex.ownerType");
  } catch (err) {
    // Ignore -- storage may be unavailable.
  }

  const owner = urlOwner || storedOwner;
  const ownerType = urlType || storedType;

  if (owner) els.ownerInput.value = owner;
  if (ownerType === "orgs" || ownerType === "users") els.ownerType.value = ownerType;

  if (owner) {
    els.form.requestSubmit();
  }
}

els.form.addEventListener("submit", loadRepos);
els.sortSelect.addEventListener("change", render);
els.filterInput.addEventListener("input", render);

initFromUrlOrStorage();
