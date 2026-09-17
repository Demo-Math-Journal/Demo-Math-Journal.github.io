// Progressive enhancement: adds a right-hand PDF reading pane. Clicking a
// repo's "Read the PDF" button loads that repo's PDF into the pane and
// narrows the index to make room for it. GitHub's raw content is served
// as application/octet-stream and blocks framing (X-Frame-Options: deny),
// so the PDF is fetched as bytes and shown via a blob: URL instead of
// pointing the iframe straight at the raw GitHub URL.
//
// Clicking anywhere on the index — outside a link, button, or the search
// input — closes the pane and restores the full-width view.
(function () {
  'use strict';

  var main = document.getElementById('main-content');
  var indexPane = document.getElementById('index-pane');
  var repoList = document.getElementById('repo-list');
  var pdfPane = document.getElementById('pdf-pane');
  var pdfFrame = document.getElementById('pdf-frame');
  var pdfTitle = document.getElementById('pdf-pane-title');
  var pdfStatus = document.getElementById('pdf-pane-status');
  var closeButton = document.getElementById('pdf-pane-close');

  if (!main || !indexPane || !repoList || !pdfPane || !pdfFrame) return;

  var currentObjectUrl = null;
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
    pdfFrame.classList.add('d-none');
    pdfFrame.src = 'about:blank';
    requestToken++; // ignore any in-flight fetch for the pane we just closed
    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }
  }

  function setStatus(text) {
    if (!pdfStatus) return;
    pdfStatus.textContent = text || '';
    pdfStatus.classList.toggle('d-none', !text);
  }

  function openPdf(url, title) {
    var token = ++requestToken;
    openPane();
    if (pdfTitle) pdfTitle.textContent = title || 'Reading PDF';
    pdfFrame.classList.add('d-none');
    setStatus('Loading…');

    fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.arrayBuffer();
      })
      .then(function (buffer) {
        if (token !== requestToken) return; // superseded by a later click
        var blob = new Blob([buffer], { type: 'application/pdf' });
        if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
        currentObjectUrl = URL.createObjectURL(blob);
        pdfFrame.src = currentObjectUrl;
        pdfFrame.classList.remove('d-none');
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
