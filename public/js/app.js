// Make table rows clickable
document.querySelectorAll('.entity-tr[data-href]').forEach(function(row) {
  row.addEventListener('click', function(e) {
    if (e.target.closest('a, button, form')) return;
    window.location.href = row.dataset.href;
  });
});

// Auto-dismiss alerts after 5 seconds
document.querySelectorAll('.alert-success, .alert-info').forEach(function(el) {
  setTimeout(function() {
    el.style.transition = 'opacity 0.4s';
    el.style.opacity = '0';
    setTimeout(function() { el.remove(); }, 400);
  }, 5000);
});
