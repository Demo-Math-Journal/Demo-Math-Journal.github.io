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

  function isPaneOpen() {
    return !pdfPane.classList.contains('d-none');
  }

  function openPane() {
    main.classList.remove('container');
    main.classList.add('container-fluid');
    indexPane.classList.add('col-lg-5');
    pdfPane.classList.remove('d-none');
    pdfPane.classList.add('col-lg-7');
  }

  function closePane() {
    main.classList.remove('container-fluid');
    main.classList.add('container');
    indexPane.classList.remove('col-lg-5');
    pdfPane.classList.add('d-none');
    pdfPane.classList.remove('col-lg-7');
    requestToken++; // cancel any in-flight fetch/render for the pane we just closed
    pagesEl.innerHTML = '';
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
      openPdf(btn.getAttribute('data-pdf-url'), btn.getAttribute('data-pdf-title'));
      return;
    }
    if (e.target.closest('a, button, input, label')) return;
    if (isPaneOpen()) closePane();
  });

  if (closeButton) closeButton.addEventListener('click', closePane);
})();
