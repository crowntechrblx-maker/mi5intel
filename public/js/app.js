// ── Clickable table rows ──────────────────────────────────────
document.querySelectorAll('.entity-tr[data-href]').forEach(function(row) {
  row.addEventListener('click', function(e) {
    if (e.target.closest('a, button, form')) return;
    window.location.href = row.dataset.href;
  });
});

// ── Auto-dismiss success / info banners ───────────────────────
document.querySelectorAll('.alert-success, .alert-info, .govuk-notification-banner--success').forEach(function(el) {
  setTimeout(function() {
    el.style.transition = 'opacity 0.4s';
    el.style.opacity = '0';
    setTimeout(function() { el.remove(); }, 400);
  }, 5000);
});

// ── Collapsible panels ────────────────────────────────────────
document.querySelectorAll('.panel-toggle').forEach(function(btn) {
  btn.addEventListener('click', function() {
    const panelId = btn.dataset.panel;
    const panel = panelId ? document.getElementById(panelId) : btn.closest('.panel-collapsible');
    if (!panel) return;

    const body = panel.querySelector('.panel-collapsible__body');
    const chevron = btn.querySelector('.panel-chevron');
    const isCollapsed = panel.classList.toggle('panel-collapsible--collapsed');

    btn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');

    if (body) {
      if (isCollapsed) {
        // Animate collapse
        body.style.height = body.scrollHeight + 'px';
        requestAnimationFrame(function() {
          body.style.height = '0';
          body.style.overflow = 'hidden';
        });
        setTimeout(function() { body.style.display = 'none'; body.style.height = ''; body.style.overflow = ''; }, 260);
      } else {
        // Animate expand
        body.style.display = '';
        const h = body.scrollHeight;
        body.style.height = '0';
        body.style.overflow = 'hidden';
        requestAnimationFrame(function() {
          body.style.transition = 'height 0.25s ease';
          body.style.height = h + 'px';
        });
        setTimeout(function() { body.style.height = ''; body.style.overflow = ''; body.style.transition = ''; }, 270);
      }
    }

    if (chevron) {
      chevron.style.transform = isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
    }
  });
});

// Apply initial collapsed state (panels with class panel-collapsible--collapsed on load)
document.querySelectorAll('.panel-collapsible--collapsed .panel-collapsible__body').forEach(function(body) {
  body.style.display = 'none';
});
document.querySelectorAll('.panel-collapsible--collapsed .panel-chevron').forEach(function(chevron) {
  chevron.style.transform = 'rotate(-90deg)';
});
