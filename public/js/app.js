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

// ── Bulk select ───────────────────────────────────────────────
(function() {
  var checkboxes   = document.querySelectorAll('.bulk-check');
  var selectAll    = document.querySelector('.bulk-check-all');
  var bulkBar      = document.getElementById('bulk-bar');
  var bulkCount    = document.getElementById('bulk-count');
  var bulkForm     = document.getElementById('bulk-form');
  var actionInput  = document.getElementById('bulk-action-input');
  var valueInput   = document.getElementById('bulk-value-input');
  var clearBtn     = document.getElementById('bulk-clear-btn');

  if (!bulkBar) return;

  function getChecked() {
    return Array.from(document.querySelectorAll('.bulk-check:checked'));
  }

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

  checkboxes.forEach(function(cb) {
    cb.addEventListener('change', update);
    cb.addEventListener('click', function(e) { e.stopPropagation(); });
  });

  if (selectAll) {
    selectAll.addEventListener('change', function() {
      checkboxes.forEach(function(cb) { cb.checked = selectAll.checked; });
      update();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', function() {
      checkboxes.forEach(function(cb) { cb.checked = false; });
      if (selectAll) { selectAll.checked = false; selectAll.indeterminate = false; }
      update();
    });
  }

  document.querySelectorAll('.bulk-action-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      var action = btn.dataset.action;
      var checked = getChecked();
      if (!checked.length) return;

      // Inject ids into the form
      bulkForm.querySelectorAll('input[name="ids"]').forEach(function(el) { el.remove(); });
      checked.forEach(function(cb) {
        var inp = document.createElement('input');
        inp.type = 'hidden'; inp.name = 'ids'; inp.value = cb.value;
        bulkForm.appendChild(inp);
      });

      actionInput.value = action;
      valueInput.value = '';

      if (action === 'severity') {
        var sel = document.getElementById('bulk-severity-select');
        if (!sel || !sel.value) return;
        valueInput.value = sel.value;
      } else if (action === 'status') {
        var sel2 = document.getElementById('bulk-status-select');
        if (!sel2 || !sel2.value) return;
        valueInput.value = sel2.value;
      } else if (action === 'tag') {
        var tagInp = document.getElementById('bulk-tag-input');
        if (!tagInp || !tagInp.value.trim()) return;
        valueInput.value = tagInp.value.trim().toUpperCase();
      } else if (action === 'delete') {
        if (!confirm(checked.length + ' entit' + (checked.length === 1 ? 'y' : 'ies') + ' will be permanently deleted. This cannot be undone.')) return;
      }

      bulkForm.submit();
    });
  });
})();


// ── Security: right-click disable ─────────────────────────────
document.addEventListener('contextmenu', function(e) {
  e.preventDefault();
});

// ── Security: blackout overlay + keyboard/focus protection ──────
(function() {
  var overlay = document.createElement('div');
  overlay.id = 'focus-shield';
  overlay.style.cssText = [
    'display:none',
    'position:fixed',
    'inset:0',
    'background:#000',
    'z-index:99999',
    'align-items:center',
    'justify-content:center',
    'flex-direction:column',
    'gap:12px',
    'cursor:default'
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
  function flash() {
    show();
    clearTimeout(flashTimer);
    flashTimer = setTimeout(hide, 800);
  }

  window.addEventListener('blur', show);
  window.addEventListener('focus', hide);
  document.addEventListener('visibilitychange', function() {
    document.hidden ? show() : hide();
  });

  document.addEventListener('keydown', function(e) {
    var k     = e.key;
    var ctrl  = e.ctrlKey || e.metaKey;
    var shift = e.shiftKey;

    if (k === 'PrintScreen' || k === 'Print' || k === 'Snapshot') {
      e.preventDefault(); flash(); return;
    }
    if (ctrl && shift && (k === 's' || k === 'S')) { e.preventDefault(); flash(); return; }
    if (ctrl && shift && (k === 'p' || k === 'P')) { e.preventDefault(); flash(); return; }
    if (k === 'F12') { e.preventDefault(); flash(); return; }
    if (ctrl && shift && 'iIjJcC'.indexOf(k) !== -1) { e.preventDefault(); flash(); return; }
    if (ctrl && (k === 'u' || k === 'U')) { e.preventDefault(); return; }
    if (ctrl && !shift && (k === 's' || k === 'S')) { e.preventDefault(); return; }
  });
})();
