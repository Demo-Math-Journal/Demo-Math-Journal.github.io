// Renders the repository index from data/repos.json, which the nightly
// workflow rebuilds (see scripts/build-index.mjs and SETUP.md), and adds a
// live filter on top. Cards are built as DOM nodes with textContent, never
// innerHTML, so README text can't inject markup. The one exception is the
// author bio modal, whose markdown is rendered by marked and sanitized by
// DOMPurify before it's inserted.
//
// The PDF pane (assets/pdf-reader.js) listens for clicks on #repo-list, so
// it works with these cards without any coordination.
(function () {
  'use strict';

  var DATA_URL = 'data/repos.json';
  // Hand-edited per-issue settings, e.g. { issues: { "2026": { image: "…" } } }.
  var ISSUES_URL = 'data/issues.json';
  var ISSUE_PREFIX = 'issue-';
  var SECTION_PREFIX = 'section-';

  var repoList = document.getElementById('repo-list');
  var input = document.getElementById('repo-search');
  var status = document.getElementById('repo-search-status');
  var noResults = document.getElementById('no-results');
  var siteTitle = document.getElementById('site-title');
  var siteDescription = document.getElementById('site-description');
  var builtAtEl = document.getElementById('built-at');
  var bioModal = document.getElementById('bio-modal');
  var bioTitle = document.getElementById('bio-modal-title');
  var bioBody = document.getElementById('bio-modal-body');
  var bioImageCol = document.getElementById('bio-modal-image-col');
  var bioImage = document.getElementById('bio-modal-image');
  var bioRequestToken = 0;

  if (!repoList) return;

  var cards = [];
  var issueSettings = {};
  var sectionSettings = {};

  // Small element helper: el('a', { href: '…', className: '…' }, [children]).
  function el(tag, props, children) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (key) {
      if (key === 'dataset') {
        Object.assign(node.dataset, props.dataset);
      } else if (key in node) {
        node[key] = props[key];
      } else {
        node.setAttribute(key, props[key]);
      }
    });
    (children || []).forEach(function (child) {
      if (child == null) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function avatarSrc(url) {
    try {
      var u = new URL(url);
      u.searchParams.set('s', '48');
      return u.toString();
    } catch (e) {
      return url;
    }
  }

  function renderContributors(repo) {
    var line = el('p', { className: 'card-text small mb-0' }, [
      el('span', { className: 'fw-semibold' }, ['Author(s):']),
      ' ',
    ]);

    if (!repo.contributors || repo.contributors.length === 0) {
      line.appendChild(
        el('span', { className: 'text-body-secondary' }, [
          repo.contributorsOverflow ? 'too many to list' : 'none listed',
        ])
      );
      return line;
    }

    repo.contributors.forEach(function (c, i) {
      if (i > 0) line.appendChild(document.createTextNode(', '));
      var link = el('a', { href: c.htmlUrl, className: 'd-inline-flex align-items-center gap-1 text-decoration-none' }, [
          c.avatarUrl
            ? el('img', {
                src: avatarSrc(c.avatarUrl),
                width: 20,
                height: 20,
                className: 'rounded-circle',
                alt: '',
                loading: 'lazy',
              })
            : null,
          el('span', {}, [c.name || '@' + c.login]),
        ]);
      // With a bio/ directory, the link opens the bio modal instead of the
      // GitHub profile (which stays as the href for middle-click etc.).
      if (repo.bio && bioModal) {
        link.setAttribute('aria-haspopup', 'dialog');
        link.addEventListener('click', function (e) {
          e.preventDefault();
          openBio(c.name || '@' + c.login, repo.bio);
        });
      }
      line.appendChild(link);
    });
    if (repo.contributorsOverflow) {
      line.appendChild(document.createTextNode(', '));
      line.appendChild(el('span', { className: 'text-body-secondary' }, ['and more']));
    }
    return line;
  }

  // ---------------------------------------------------------------------
  // Author bio modal: the author's name as the h1, the repo's bio/*.md
  // rendered on the left, and the bio/ image on the right.
  // ---------------------------------------------------------------------

  function setBioMessage(text) {
    bioBody.replaceChildren(el('p', { className: 'text-body-secondary' }, [text]));
  }

  function openBio(name, bio) {
    var token = ++bioRequestToken;
    bioTitle.textContent = name;
    bioImageCol.classList.toggle('d-none', !bio.imageUrl);
    bioBody.classList.toggle('col-md-8', !!bio.imageUrl);
    if (bio.imageUrl) {
      bioImage.src = bio.imageUrl;
      bioImage.alt = 'Photo of ' + name;
    } else {
      bioImage.removeAttribute('src');
    }
    setBioMessage(bio.markdownUrl ? 'Loading bio…' : 'No bio available.');
    if (!bioModal.open) bioModal.showModal();
    if (!bio.markdownUrl) return;

    fetch(bio.markdownUrl, { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (markdown) {
        if (token !== bioRequestToken) return;
        if (!markdown.trim()) {
          setBioMessage('No bio available.');
          return;
        }
        if (!window.marked || !window.DOMPurify) throw new Error('markdown renderer not loaded');
        bioBody.innerHTML = window.DOMPurify.sanitize(window.marked.parse(markdown));
        var mj = window.MathJax;
        if (mj && mj.typesetPromise) {
          mj.typesetPromise([bioBody]).catch(function (err) { console.warn('MathJax typeset failed:', err); });
        }
      })
      .catch(function (err) {
        if (token !== bioRequestToken) return;
        setBioMessage('Could not load this bio (' + err.message + ').');
      });
  }

  if (bioModal) {
    document.getElementById('bio-modal-close').addEventListener('click', function () {
      bioModal.close();
    });
    // A click on the dialog element itself (not its contents) is a click on
    // the backdrop.
    bioModal.addEventListener('click', function (e) {
      if (e.target === bioModal) bioModal.close();
    });
  }

  function renderCard(repo, headingLevel) {
    var title = el('h' + headingLevel, { className: 'h5 card-title' }, [repo.displayTitle + ' ']);
    if (repo.isArchived) title.appendChild(el('span', { className: 'badge text-bg-secondary' }, ['Archived']));
    if (repo.isFork) title.appendChild(el('span', { className: 'badge text-bg-secondary' }, ['Fork']));

    var summary = repo.summary
      ? el('p', { className: 'card-text flex-grow-1' }, [repo.summary])
      : el('p', { className: 'card-text flex-grow-1' }, [
          el('span', { className: 'text-body-secondary' }, ['No description available.']),
        ]);

    var actions = el('div', { className: 'mt-2 d-flex flex-wrap gap-2' }, [
      el('a', {
        href: repo.htmlUrl,
        className: 'btn btn-sm btn-outline-secondary',
        target: '_blank',
        rel: 'noopener noreferrer',
      }, ['View on GitHub']),
      repo.pdfUrl
        ? el('button', {
            type: 'button',
            className: 'btn btn-sm btn-outline-primary read-pdf-btn',
            'data-pdf-url': repo.pdfUrl,
            'data-pdf-title': repo.displayTitle,
          }, ['Read the PDF'])
        : null,
    ]);

    var card = el('div', { className: 'col-12 repo-card' }, [
      el('article', { className: 'card h-100' }, [
        el('div', { className: 'card-body d-flex flex-column' }, [
          title,
          summary,
          renderContributors(repo),
          actions,
        ]),
      ]),
    ]);
    card.dataset.repoSearch = [
      repo.displayTitle,
      repo.name,
      repo.description || '',
      issueLabel(topicSuffix(repo, ISSUE_PREFIX)),
      sectionLabel(topicSuffix(repo, SECTION_PREFIX)),
    ].join(' ').toLowerCase();
    return card;
  }

  // ---------------------------------------------------------------------
  // Grouping: repos are grouped by their first `issue-*` topic, then within
  // each issue by their first `section-*` topic. Repos missing either topic
  // fall into an "Other" group at that level.
  // ---------------------------------------------------------------------

  // Returns what follows `prefix` in the repo's first topic starting with
  // it (e.g. "3" for "issue-3"), or null if it has no such topic.
  function topicSuffix(repo, prefix) {
    var topics = Array.isArray(repo.topics) ? repo.topics : [];
    for (var i = 0; i < topics.length; i++) {
      var t = String(topics[i]).toLowerCase();
      if (t.indexOf(prefix) === 0 && t.length > prefix.length) return t.slice(prefix.length);
    }
    return null;
  }

  function humanizeSlug(slug) {
    return slug
      .split('-')
      .filter(Boolean)
      .map(function (word) { return word.charAt(0).toUpperCase() + word.slice(1); })
      .join(' ');
  }

  function issueLabel(key) {
    return key == null ? 'Other repositories' : 'Issue ' + humanizeSlug(key);
  }

  function sectionLabel(key) {
    return key == null ? 'Other' : humanizeSlug(key);
  }

  // Numeric-aware compare, so "issue-10" sorts after "issue-9". Null keys
  // (the "Other" groups) always sort last.
  function compareKeys(a, b, descending) {
    if (a === b) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    var cmp = a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    return descending ? -cmp : cmp;
  }

  // Returns [{ key, sections: [{ key, repos }] }], newest issue first and
  // sections alphabetical. Repos keep their order from repos.json.
  function groupRepos(repos) {
    var issues = new Map();
    repos.forEach(function (repo) {
      var issueKey = topicSuffix(repo, ISSUE_PREFIX);
      var sectionKey = topicSuffix(repo, SECTION_PREFIX);
      if (!issues.has(issueKey)) issues.set(issueKey, new Map());
      var sections = issues.get(issueKey);
      if (!sections.has(sectionKey)) sections.set(sectionKey, []);
      sections.get(sectionKey).push(repo);
    });

    return Array.from(issues.keys())
      .sort(function (a, b) { return compareKeys(a, b, true); })
      .map(function (issueKey) {
        var sections = issues.get(issueKey);
        return {
          key: issueKey,
          sections: Array.from(sections.keys())
            .sort(function (a, b) { return compareKeys(a, b, false); })
            .map(function (sectionKey) { return { key: sectionKey, repos: sections.get(sectionKey) }; }),
        };
      });
  }

  // Black or white, whichever has more contrast against the "#rrggbb"
  // background (WCAG relative luminance).
  function readableTextColor(hex) {
    var lum = [1, 3, 5]
      .map(function (i) {
        var c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      })
      .reduce(function (sum, c, i) { return sum + c * [0.2126, 0.7152, 0.0722][i]; }, 0);
    return (lum + 0.05) / 0.05 > 1.05 / (lum + 0.05) ? '#000' : '#fff';
  }

  function slugId(prefix, key) {
    return prefix + (key == null ? 'other' : key.replace(/[^a-z0-9-]/g, '-'));
  }

  // Renders one issue group. An issue whose repos all lack a section topic
  // gets no section headings, so its cards sit directly under the issue.
  // If data/issues.json gives the issue an image, it sits to the right of
  // the cards.
  function renderIssue(issue) {
    var issueId = slugId('issue-', issue.key);
    var showSections = !(issue.sections.length === 1 && issue.sections[0].key == null);
    var settings = (issue.key != null && issueSettings[issue.key]) || {};

    var content = el('div', { className: 'col-12' });
    var group = el('section', { className: 'col-12 repo-group issue-group', 'aria-labelledby': issueId }, [
      el('h2', { className: 'h4 issue-heading', id: issueId }, [issueLabel(issue.key)]),
      el('div', { className: 'row g-4' }, [
        content,
        settings.image
          ? el('div', { className: 'col-12 col-md-4 issue-image-col' }, [
              el('img', { src: settings.image, className: 'issue-image', alt: '', loading: 'lazy' }),
            ])
          : null,
      ]),
    ]);
    if (settings.image) content.classList.add('col-md-8');

    issue.sections.forEach(function (section) {
      var list = el('div', { className: 'row g-4' }, section.repos.map(function (repo) {
        var card = renderCard(repo, showSections ? 4 : 3);
        cards.push(card);
        return card;
      }));

      if (!showSections) {
        content.appendChild(list);
        return;
      }
      var sectionId = issueId + '--' + slugId('section-', section.key);
      var heading = el('h3', { className: 'h6 section-heading', id: sectionId }, [sectionLabel(section.key)]);
      var color = section.key != null && sectionSettings[section.key] && sectionSettings[section.key].color;
      if (color && /^#[0-9a-f]{6}$/i.test(color)) {
        heading.classList.add('section-heading--colored');
        heading.style.backgroundColor = color;
        heading.style.color = readableTextColor(color);
      }
      content.appendChild(
        el('section', { className: 'repo-group section-group', 'aria-labelledby': sectionId }, [heading, list])
      );
    });
    return group;
  }

  function applyFilter() {
    var query = input ? input.value.trim().toLowerCase() : '';
    var visibleCount = 0;

    cards.forEach(function (card) {
      var matches = query === '' || card.dataset.repoSearch.indexOf(query) !== -1;
      card.classList.toggle('d-none', !matches);
      if (matches) visibleCount++;
    });

    // Hide any issue or section whose cards are all filtered out.
    repoList.querySelectorAll('.repo-group').forEach(function (group) {
      group.classList.toggle('d-none', !group.querySelector('.repo-card:not(.d-none)'));
    });

    if (status) {
      status.textContent = 'Showing ' + visibleCount + ' of ' + cards.length + ' repositories.';
    }
    if (noResults) {
      noResults.classList.toggle('d-none', visibleCount !== 0 || cards.length === 0);
    }
  }

  // MathJax loads with `defer`, so it may or may not be ready yet. If it
  // isn't, its own startup typeset will pick up the cards; if it is, typeset
  // them explicitly.
  function typesetMath() {
    var mj = window.MathJax;
    if (mj && mj.startup && mj.startup.promise) {
      mj.startup.promise
        .then(function () { return window.MathJax.typesetPromise([repoList]); })
        .catch(function (err) { console.warn('MathJax typeset failed:', err); });
    }
  }

  function renderSite(data) {
    if (data.title) {
      if (siteTitle) siteTitle.textContent = data.title;
      document.title = data.title + ' — Repository Index';
    }
    if (siteDescription) {
      siteDescription.textContent = data.description || '';
      siteDescription.classList.toggle('d-none', !data.description);
    }
    if (builtAtEl && data.builtAt) {
      builtAtEl.dateTime = data.builtAt;
      builtAtEl.textContent = new Date(data.builtAt).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    }

    var repos = Array.isArray(data.repos) ? data.repos : [];
    cards = [];
    repoList.replaceChildren.apply(repoList, groupRepos(repos).map(renderIssue));

    if (repos.length === 0 && status) {
      status.textContent = 'No repositories found.';
    } else {
      applyFilter();
    }
    if (input) input.disabled = false;
    typesetMath();
  }

  // `no-cache` revalidates with the server each visit, so a fresh nightly
  // build shows up immediately instead of waiting out the browser cache.
  // issues.json is optional: if it's missing or broken, the index still
  // renders, just without issue images.
  var issuesLoaded = fetch(ISSUES_URL, { cache: 'no-cache' })
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) {
      issueSettings = (data && data.issues) || {};
      sectionSettings = (data && data.sections) || {};
    })
    .catch(function (err) {
      console.warn('Could not load ' + ISSUES_URL + ':', err);
    });

  fetch(DATA_URL, { cache: 'no-cache' })
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) {
      return issuesLoaded.then(function () { renderSite(data); });
    })
    .catch(function (err) {
      console.error('Could not load ' + DATA_URL + ':', err);
      if (status) status.textContent = 'Could not load the repository list (' + err.message + ').';
      if (builtAtEl) builtAtEl.textContent = 'unknown';
    });

  if (input) input.addEventListener('input', applyFilter);
})();
