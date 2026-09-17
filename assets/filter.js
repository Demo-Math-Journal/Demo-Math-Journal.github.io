// Progressive enhancement: index.html's content is fully usable with
// JavaScript disabled (every repo card is already in the markup). This
// script just adds a live client-side filter on top of it.
(function () {
  'use strict';

  var input = document.getElementById('repo-search');
  var status = document.getElementById('repo-search-status');
  var noResults = document.getElementById('no-results');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.repo-card'));

  if (!input || !cards.length) return;

  function applyFilter() {
    var query = input.value.trim().toLowerCase();
    var visibleCount = 0;

    cards.forEach(function (card) {
      var haystack = card.getAttribute('data-repo-search') || '';
      var matches = query === '' || haystack.indexOf(query) !== -1;
      card.classList.toggle('d-none', !matches);
      if (matches) visibleCount++;
    });

    if (status) {
      status.textContent = 'Showing ' + visibleCount + ' of ' + cards.length + ' repositories.';
    }
    if (noResults) {
      noResults.classList.toggle('d-none', visibleCount !== 0);
    }
  }

  input.addEventListener('input', applyFilter);
})();
