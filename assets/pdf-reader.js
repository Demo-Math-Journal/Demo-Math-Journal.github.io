// Progressive enhancement: adds a right-hand PDF reading pane. Clicking a
// repo's "Read the PDF" button loads that repo's PDF and narrows the index
// to make room for it.
//
// Pages are rendered with pdf.js onto plain <canvas> elements rather than
// handed to the browser's native PDF viewer (e.g. via an <iframe src="...">
// pointed at a blob: URL). Chromium's native viewer runs as an internal
// plugin process that the browser refuses to attach DevTools to for the
// whole tab while it's showing — canvases are ordinary DOM content, so
// DevTools keeps working normally.
//
// Clicking anywhere on the index — outside a link, button, or the search
// input — closes the pane and restores the full-width view.
//
// The open PDF is mirrored in the URL as ?read=<repo name>, so a shared
// link reopens the same view once assets/index.js has rendered the rows.
import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.3.289/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.3.289/pdf.worker.min.mjs';

(function () {
  'use strict';

  var main = document.getElementById('main-content');
  var indexPane = document.getElementById('index-pane');
  var repoList = document.getElementById('repo-list');
  var pdfPane = document.getElementById('pdf-pane');
  var pagesEl = document.getElementById('pdf-pages');
  var pdfTitle = document.getElementById('pdf-pane-title');
  var pdfStatus = document.getElementById('pdf-pane-status');
  var closeButton = document.getElementById('pdf-pane-close');

  if (!main || !indexPane || !repoList || !pdfPane || !pagesEl) return;

  var requestToken = 0;
  var selectedCard = null;

  function isPaneOpen() {
    return !pdfPane.classList.contains('d-none');
  }

  function selectCard(card) {
    if (selectedCard === card) return;
    if (selectedCard) selectedCard.classList.remove('is-reading');
    selectedCard = card;
    if (selectedCard) selectedCard.classList.add('is-reading');
  }

  // Opening and closing the pane reflow the whole page (one column to two
  // and back), so where the browser supports it, `update` runs as a view
  // transition: the PDF pane slides in or out, `card` (the row being read)
  // glides to its new spot, and everything else cross-fades (see the
  // ::view-transition rules in assets/style.css). With `swap` (moving from
  // one open PDF to another), the pane is swapped in place instead of
  // sliding. Without support, or under reduced motion, `update` just runs.
  function withTransition(card, update, swap = false) {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || reduceMotion) {
      update();
      return;
    }
    if (card) card.style.viewTransitionName = 'reading-card';
    document.documentElement.classList.toggle('pdf-swap', swap);
    document.startViewTransition(update).finished.finally(() => {
      if (card) card.style.viewTransitionName = '';
      document.documentElement.classList.remove('pdf-swap');
    });
  }

  function openPane() {
    main.classList.remove('container');
    main.classList.add('container-fluid');
    indexPane.classList.add('col-lg-5');
    pdfPane.classList.remove('d-none');
    pdfPane.classList.add('col-lg-7');
  }

  // Closes the pane, keeping the row that was being read in view.
  function closePane() {
    const card = selectedCard;
    withTransition(card, () => {
      applyClosePane();
      card?.scrollIntoView({ block: 'center', behavior: 'instant' });
    });
    setReadParam(null);
  }

  const READ_PARAM = 'read';

  // Sets or clears ?read= without adding a history entry, keeping any
  // other params and the hash.
  function setReadParam(repoName) {
    const url = new URL(window.location.href);
    if (repoName) url.searchParams.set(READ_PARAM, repoName);
    else url.searchParams.delete(READ_PARAM);
    history.replaceState(history.state, '', url);
  }

  // Opens the PDF of the repo row `card` and brings the row to the top of
  // the viewport, in the narrowed pane-open layout. `animate: false` skips
  // the view transition.
  function openCardPdf(card, { animate = true } = {}) {
    const btn = card?.querySelector('.read-pdf-btn');
    if (!btn) return;
    const update = () => {
      selectCard(card);
      openPdf(btn.getAttribute('data-pdf-url'), btn.getAttribute('data-pdf-title'));
      card.scrollIntoView({ block: 'start', behavior: 'instant' });
    };
    if (animate) withTransition(card, update, isPaneOpen());
    else update();
    setReadParam(card.dataset.repoName);
  }

  // Reopens the view a shared ?read= link points to: expands that repo's
  // row and opens its PDF. Drops the param if no such repo has a PDF. Not
  // animated: on a first, uncached visit the transition would run while
  // fonts and images are still arriving, so the page would look broken
  // until it settled.
  function openFromUrl() {
    const repoName = new URL(window.location.href).searchParams.get(READ_PARAM);
    if (!repoName) return;
    const card = repoList.querySelector(`.repo-card[data-repo-name="${CSS.escape(repoName)}"]`);
    if (!card?.querySelector('.read-pdf-btn')) {
      setReadParam(null);
      return;
    }
    card.querySelector('.repo-toggle[aria-expanded="false"]')?.click();
    openCardPdf(card, { animate: false });
  }

  function applyClosePane() {
    main.classList.remove('container-fluid');
    main.classList.add('container');
    indexPane.classList.remove('col-lg-5');
    pdfPane.classList.add('d-none');
    pdfPane.classList.remove('col-lg-7');
    requestToken++; // cancel any in-flight fetch/render for the pane we just closed
    pagesEl.innerHTML = '';
    selectCard(null);
  }

  function setStatus(text) {
    if (!pdfStatus) return;
    pdfStatus.textContent = text || '';
    pdfStatus.classList.toggle('d-none', !text);
  }

  // Renders each page of `pdf` into its own <canvas>, scaled to fit the
  // pane's current width, at the display's native pixel density.
  function renderPages(pdf, token) {
    var dpr = window.devicePixelRatio || 1;
    var targetWidth = pagesEl.clientWidth || 600;
    var pageNum = 1;

    function renderNextPage() {
      if (token !== requestToken || pageNum > pdf.numPages) return;
      return pdf.getPage(pageNum).then(function (page) {
        if (token !== requestToken) return;

        var unscaledViewport = page.getViewport({ scale: 1 });
        var scale = targetWidth / unscaledViewport.width;
        var viewport = page.getViewport({ scale: scale });

        var canvas = document.createElement('canvas');
        canvas.className = 'pdf-page';
        canvas.width = viewport.width * dpr;
        canvas.height = viewport.height * dpr;
        canvas.style.width = viewport.width + 'px';
        canvas.style.height = viewport.height + 'px';
        pagesEl.appendChild(canvas);

        return page
          .render({
            canvasContext: canvas.getContext('2d'),
            viewport: viewport,
            transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
          })
          .promise.then(function () {
            pageNum++;
            return renderNextPage();
          });
      });
    }

    return renderNextPage();
  }

  function openPdf(url, title) {
    var token = ++requestToken;
    openPane();
    if (pdfTitle) pdfTitle.textContent = title || 'Reading PDF';
    pagesEl.innerHTML = '';
    setStatus('Loading…');

    fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.arrayBuffer();
      })
      .then(function (buffer) {
        if (token !== requestToken) return;
        return pdfjsLib.getDocument({ data: buffer }).promise;
      })
      .then(function (pdf) {
        if (!pdf || token !== requestToken) return;
        return renderPages(pdf, token);
      })
      .then(function () {
        if (token !== requestToken) return;
        setStatus(null);
      })
      .catch(function (err) {
        if (token !== requestToken) return;
        setStatus('Could not load this PDF (' + err.message + ').');
      });
  }

  repoList.addEventListener('click', function (e) {
    var btn = e.target.closest('.read-pdf-btn');
    if (btn) {
      openCardPdf(btn.closest('.repo-card'));
      return;
    }
    if (e.target.closest('a, button, input, label')) return;
    if (isPaneOpen()) closePane();
  });

  if (closeButton) closeButton.addEventListener('click', () => closePane());

  // The rows usually render after this module runs, but handle either order.
  if (repoList.querySelector('.repo-card[data-repo-name]')) openFromUrl();
  else document.addEventListener('repos:rendered', openFromUrl, { once: true });
})();
