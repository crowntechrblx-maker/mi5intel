// ── Toast notification system ─────────────────────────────────
window.toast = (function() {
  var container = document.getElementById('toast-container');

  function show(msg, type, duration) {
    if (!container) return;
    type = type || 'info';
    duration = duration === undefined ? 3500 : duration;

    var el = document.createElement('div');
    el.className = 'toast toast--' + type;
    el.setAttribute('role', 'alert');
    el.innerHTML =
      '<span class="toast__msg">' + msg + '</span>' +
      '<button class="toast__close" aria-label="Dismiss">&times;</button>';

    container.appendChild(el);

    el.querySelector('.toast__close').addEventListener('click', function() { dismiss(el); });
    if (duration > 0) setTimeout(function() { dismiss(el); }, duration);
    return el;
  }

  function dismiss(el) {
    el.classList.add('toast--out');
    setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 320);
  }

  return { success: function(m,d){ return show(m,'success',d); },
           error:   function(m,d){ return show(m,'error',d); },
           info:    function(m,d){ return show(m,'info',d); } };
})();

// ── Convert existing banners to toasts ────────────────────────
(function() {
  var mapping = [
    { sel: '.govuk-notification-banner--success, .alert-success', type: 'success' },
    { sel: '.govuk-notification-banner--error,   .alert-error',   type: 'error'   },
    { sel: '.govuk-notification-banner--info,    .alert-info',    type: 'info'    },
  ];
  mapping.forEach(function(m) {
    document.querySelectorAll(m.sel).forEach(function(el) {
      var content = el.querySelector('.govuk-notification-banner__content, p');
      var text = content ? content.textContent.trim() : el.textContent.trim();
      if (text) toast[m.type](text, m.type === 'error' ? 6000 : 4000);
      el.remove();
    });
  });
})();

// ── Clickable table rows ──────────────────────────────────────
document.querySelectorAll('.entity-tr[data-href]').forEach(function(row) {
  row.addEventListener('click', function(e) {
    if (e.target.closest('a, button, form')) return;
    window.location.href = row.dataset.href;
  });
});

// ── Collapsible panels ────────────────────────────────────────
document.querySelectorAll('.panel-toggle').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var panelId = btn.dataset.panel;
    var panel = panelId ? document.getElementById(panelId) : btn.closest('.panel-collapsible');
    if (!panel) return;
    var body = panel.querySelector('.panel-collapsible__body');
    var chevron = btn.querySelector('.panel-chevron');
    var isCollapsed = panel.classList.toggle('panel-collapsible--collapsed');
    btn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
    if (body) {
      if (isCollapsed) {
        body.style.height = body.scrollHeight + 'px';
        requestAnimationFrame(function() { body.style.height = '0'; body.style.overflow = 'hidden'; });
        setTimeout(function() { body.style.display = 'none'; body.style.height = ''; body.style.overflow = ''; }, 260);
      } else {
        body.style.display = '';
        var h = body.scrollHeight;
        body.style.height = '0'; body.style.overflow = 'hidden';
        requestAnimationFrame(function() { body.style.transition = 'height 0.25s ease'; body.style.height = h + 'px'; });
        setTimeout(function() { body.style.height = ''; body.style.overflow = ''; body.style.transition = ''; }, 270);
      }
    }
    if (chevron) chevron.style.transform = isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
  });
});
document.querySelectorAll('.panel-collapsible--collapsed .panel-collapsible__body').forEach(function(b) { b.style.display = 'none'; });
document.querySelectorAll('.panel-collapsible--collapsed .panel-chevron').forEach(function(c) { c.style.transform = 'rotate(-90deg)'; });

// ── Collapsible report sections ───────────────────────────────
document.querySelectorAll('.report-section-toggle').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var section = btn.closest('.panel');
    var body = section && section.querySelector('.report-section-body');
    var chevron = btn.querySelector('.report-section-chevron');
    if (!body) return;
    var collapsed = section.classList.toggle('report-section--collapsed');
    if (collapsed) {
      body.style.height = body.scrollHeight + 'px';
      requestAnimationFrame(function() { body.style.height = '0'; });
      setTimeout(function() { body.style.display = 'none'; body.style.height = ''; }, 230);
    } else {
      body.style.display = '';
      var h = body.scrollHeight;
      body.style.height = '0';
      requestAnimationFrame(function() { body.style.height = h + 'px'; });
      setTimeout(function() { body.style.height = ''; }, 230);
    }
  });
});

// ── Bulk select ───────────────────────────────────────────────
(function() {
  var checkboxes  = document.querySelectorAll('.bulk-check');
  var selectAll   = document.querySelector('.bulk-check-all');
  var bulkBar     = document.getElementById('bulk-bar');
  var bulkCount   = document.getElementById('bulk-count');
  var bulkForm    = document.getElementById('bulk-form');
  var actionInput = document.getElementById('bulk-action-input');
  var valueInput  = document.getElementById('bulk-value-input');
  var clearBtn    = document.getElementById('bulk-clear-btn');
  if (!bulkBar) return;

  function getChecked() { return Array.from(document.querySelectorAll('.bulk-check:checked')); }
  function update() {
    var checked = getChecked();
    var n = checked.length;
    bulkBar.classList.toggle('bulk-bar--active', n > 0);
    if (bulkCount) bulkCount.textContent = n + ' selected';
    if (selectAll) {
      selectAll.indeterminate = n > 0 && n < checkboxes.length;
      selectAll.checked = n > 0 && n === checkboxes.length;
    }
  }
  checkboxes.forEach(function(cb) { cb.addEventListener('change', update); cb.addEventListener('click', function(e) { e.stopPropagation(); }); });
  if (selectAll) selectAll.addEventListener('change', function() { checkboxes.forEach(function(cb) { cb.checked = selectAll.checked; }); update(); });
  if (clearBtn) clearBtn.addEventListener('click', function() { checkboxes.forEach(function(cb) { cb.checked = false; }); if (selectAll) { selectAll.checked = false; selectAll.indeterminate = false; } update(); });

  document.querySelectorAll('.bulk-action-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      var action = btn.dataset.action;
      var checked = getChecked();
      if (!checked.length) return;
      bulkForm.querySelectorAll('input[name="ids"]').forEach(function(el) { el.remove(); });
      checked.forEach(function(cb) { var inp = document.createElement('input'); inp.type = 'hidden'; inp.name = 'ids'; inp.value = cb.value; bulkForm.appendChild(inp); });
      actionInput.value = action; valueInput.value = '';
      if (action === 'severity') { var sel = document.getElementById('bulk-severity-select'); if (!sel || !sel.value) return; valueInput.value = sel.value; }
      else if (action === 'status') { var sel2 = document.getElementById('bulk-status-select'); if (!sel2 || !sel2.value) return; valueInput.value = sel2.value; }
      else if (action === 'tag') { var tagInp = document.getElementById('bulk-tag-input'); if (!tagInp || !tagInp.value.trim()) return; valueInput.value = tagInp.value.trim().toUpperCase(); }
      else if (action === 'delete') { if (!confirm(checked.length + ' entit' + (checked.length === 1 ? 'y' : 'ies') + ' will be permanently deleted. This cannot be undone.')) return; }
      bulkForm.submit();
    });
  });
})();

// ── Stat card count-up animation ─────────────────────────────
(function() {
  document.querySelectorAll('[data-count]').forEach(function(el) {
    var target = parseInt(el.dataset.count, 10);
    if (isNaN(target) || target === 0) return;
    var start = 0;
    var duration = Math.min(800, target * 40);
    var startTime = null;
    function step(ts) {
      if (!startTime) startTime = ts;
      var progress = Math.min((ts - startTime) / duration, 1);
      var ease = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.floor(ease * target);
      if (progress < 1) requestAnimationFrame(step);
      else el.textContent = target;
    }
    requestAnimationFrame(step);
  });
})();

// ── Live table filter ─────────────────────────────────────────
(function() {
  var input = document.getElementById('table-filter');
  if (!input) return;
  var rows = document.querySelectorAll('.registry-table tbody tr:not(.skeleton-row)');
  input.addEventListener('input', function() {
    var q = input.value.trim().toLowerCase();
    var count = 0;
    rows.forEach(function(row) {
      var text = row.textContent.toLowerCase();
      var match = !q || text.includes(q);
      row.style.display = match ? '' : 'none';
      if (match) count++;
    });
    var counter = document.getElementById('filter-count');
    if (counter) counter.textContent = q ? count + ' matching' : '';
  });
})();

// ── Responsive sidebar toggle ─────────────────────────────────
(function() {
  var toggleBtn = document.getElementById('sidebar-toggle');
  var sidebar   = document.getElementById('site-sidebar');
  var overlay   = document.getElementById('sidebar-overlay');
  if (!toggleBtn || !sidebar) return;

  function open() {
    sidebar.classList.add('open');
    overlay.classList.add('visible');
    toggleBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }
  function close() {
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
    toggleBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  toggleBtn.addEventListener('click', function() {
    sidebar.classList.contains('open') ? close() : open();
  });
  overlay.addEventListener('click', close);

  // Close on nav item click (mobile)
  sidebar.querySelectorAll('.sidebar-link').forEach(function(link) {
    link.addEventListener('click', function() {
      if (window.innerWidth <= 1024) close();
    });
  });
})();

// ── Win+Shift+S screenshot detection → force logout ───────────
(function() {
  var blurTime = null;

  window.addEventListener('blur', function() {
    blurTime = Date.now();
  });

  window.addEventListener('focus', function() {
    if (!blurTime) return;
    var elapsed = Date.now() - blurTime;
    blurTime = null;

    // Snipping Tool focus-away is typically under 2 seconds
    if (elapsed > 2000) return;

    // Check clipboard for image content — Win+Shift+S copies to clipboard
    if (!navigator.clipboard || !navigator.clipboard.read) return;
    navigator.clipboard.read().then(function(items) {
      for (var i = 0; i < items.length; i++) {
        if (items[i].types.some(function(t) { return t.startsWith('image/'); })) {
          // Image in clipboard after a brief blur = screenshot detected
          var form = document.createElement('form');
          form.method = 'POST';
          form.action = '/logout?reason=screenshot';
          document.body.appendChild(form);
          form.submit();
          return;
        }
      }
    }).catch(function() {
      // Clipboard read denied — user hasn't granted permission, can't detect
    });
  });
})();

// ── Security: right-click disable ─────────────────────────────
document.addEventListener('contextmenu', function(e) { e.preventDefault(); });

// ── Security: blackout overlay + keyboard/focus protection ────
(function() {
  var overlay = document.createElement('div');
  overlay.id = 'focus-shield';
  overlay.style.cssText = [
    'display:none','position:fixed','inset:0','background:#000',
    'z-index:99999','align-items:center','justify-content:center',
    'flex-direction:column','gap:12px','cursor:default'
  ].join(';');
  overlay.innerHTML =
    '<svg width="40" height="36" viewBox="0 0 110 96" fill="none" style="opacity:.2">' +
      '<polygon points="55,3 107,93 3,93" stroke="#fff" stroke-width="2.5" fill="none" stroke-linejoin="round"/>' +
    '</svg>' +
    '<span style="color:#2a2a2a;font-family:\'Courier New\',monospace;font-size:11px;letter-spacing:4px;text-transform:uppercase">Session Obscured</span>';
  document.body.appendChild(overlay);

  function hide() { overlay.style.display = 'none'; }
  function show() { overlay.style.display = 'flex'; }
  var flashTimer = null;
  function flash() { show(); clearTimeout(flashTimer); flashTimer = setTimeout(hide, 800); }

  window.addEventListener('blur', show);
  window.addEventListener('focus', hide);
  document.addEventListener('visibilitychange', function() { document.hidden ? show() : hide(); });

  document.addEventListener('keydown', function(e) {
    var k = e.key; var ctrl = e.ctrlKey || e.metaKey; var shift = e.shiftKey;
    if (k === 'PrintScreen' || k === 'Print' || k === 'Snapshot') { e.preventDefault(); flash(); return; }
    if (ctrl && shift && (k === 's' || k === 'S')) { e.preventDefault(); flash(); return; }
    if (ctrl && shift && (k === 'p' || k === 'P')) { e.preventDefault(); flash(); return; }
    if (k === 'F12') { e.preventDefault(); flash(); return; }
    if (ctrl && shift && 'iIjJcC'.indexOf(k) !== -1) { e.preventDefault(); flash(); return; }
    if (ctrl && (k === 'u' || k === 'U')) { e.preventDefault(); return; }
    if (ctrl && !shift && (k === 's' || k === 'S')) { e.preventDefault(); return; }
  });
})();
