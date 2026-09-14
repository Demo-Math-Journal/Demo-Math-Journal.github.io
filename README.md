# Repo Index

A single static page that lists every repository in a GitHub org or user account, built live from the GitHub REST API. No backend, no build step, no framework: point it at an org name and it renders a card per repo with a title, description, topics, top contributors, and links out to the repo (and its live site, if it has one).

## Why a README-derived title instead of the repo name

Repo names are usually kebab-case slugs (`newton-raphson-lab`). This page instead reads each repo's `README.md` through the GitHub Contents API and pulls out the first `# Heading` line as the display title, so an index entry reads "Newton-Raphson Lab" rather than "newton-raphson-lab". If a repo has no README, or no heading, it falls back to a title-cased version of the repo name.

Real-world READMEs (most popular open-source projects included) often put badges and links directly in that heading line — `# [React](url) [![build](img)](url) ...`. The title parser strips markdown images and links and decodes HTML entities before display, so badge-heavy headings still resolve to a clean title. This was caught and fixed by testing against `facebook/react`'s actual README during development, not assumed to work.

## Where "author(s)" comes from

The GitHub API has no single "author" field on a repo. This page uses each repo's top contributors (`GET /repos/{owner}/{repo}/contributors`, which GitHub already returns sorted by contribution count) and shows up to 5, each linking to their GitHub profile. A repo with no contributor data (e.g. brand new or empty) falls back to showing the repo owner instead.

## Using it

Open `index.html`, enter a GitHub org or username, and click **Load repos**. That's the whole interface — everything else (sorting, filtering, the optional token field) is there to make a large org's repo list usable, not required for a basic listing.

- **Account type**: organization vs. personal user account — the GitHub API uses different endpoints for each.
- **Sort**: by most recently updated (default), name, or star count.
- **Filter**: once repos are loaded, filters by name, description, or topic without re-fetching.
- **Personal access token (optional)**: unauthenticated requests to the GitHub API are capped at 60/hour, shared across everyone on the same network — enough to browse a small org a few times, not enough for repeated testing or a larger org. A token (no scopes needed, since this only reads public data) raises that to 5,000/hour. The token lives in memory in that browser tab only: it's sent solely to `api.github.com`, never written to `localStorage`, never logged, and obviously never committed to this repo.
- The org/username and account type are reflected in the URL (`?owner=your-org&type=orgs`), so a specific view can be bookmarked or linked directly, and are also remembered in this browser via `localStorage` as a convenience for next time.

Forked repos are excluded from the listing, on the assumption that an index like this is meant to surface original work.

## Deploying to GitHub Pages

1. Push this repo to GitHub.
2. In the repo's **Settings > Pages**, set **Source** to "Deploy from a branch," branch `main`, folder `/ (root)`.
3. Wait for the Pages build to finish, then visit the URL GitHub gives you (or link directly to `?owner=your-org` to skip the manual step).

No build step is involved — `index.html`, `css/styles.css`, and `js/app.js` are served as-is. The included `.nojekyll` file tells GitHub Pages not to run its default Jekyll processing, which isn't needed here and can otherwise interfere with files starting with an underscore.

## Structure

- `index.html` — page markup and the org/user input form
- `css/styles.css` — small additions on top of Bootstrap 5 (utility classes handle most of the layout)
- `js/app.js` — all logic: fetching repos and pagination, reading README titles, reading contributors, rendering, sorting, and filtering
- `.nojekyll` — disables GitHub Pages' Jekyll processing

## Accessibility

Built to WCAG 2.2: every form control has a visible label, the status region announces loading/error/result states to screen readers (`aria-live="polite"`), a skip link jumps past the controls to the repo list, focus outlines are preserved rather than suppressed, and every contributor avatar has descriptive alt text. Bootstrap 5.3's `text-bg-*` utility classes are used for badges so text/background contrast pairs correctly.

## Known limitations

- The GitHub REST API only returns public repos to unauthenticated/read-only requests, so private repos in an org won't appear here without a token that has access to them.
- A very large org (hundreds of repos) will make a lot of API calls (one per repo for the README, one for contributors) — request concurrency is capped at 6 in flight to stay reasonable, but a token is strongly recommended past a handful of repos to avoid the rate limit.
- Title extraction only looks at the first `# Heading` line; a README that opens with something other than a top-level heading (a badge row with no heading at all, for instance) falls back to the repo name.
