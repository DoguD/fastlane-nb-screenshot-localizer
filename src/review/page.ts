export function renderPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Screenshot Review</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0e1014;
    --panel: #1a1d24;
    --panel-2: #232730;
    --border: #2c313c;
    --text: #e6e8ee;
    --muted: #8a92a3;
    --accent: #5a9cff;
    --danger: #ff6b6b;
    --ok: #4ec27a;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  header { position: sticky; top: 0; z-index: 5; background: var(--panel); border-bottom: 1px solid var(--border); padding: 12px 20px; display: flex; align-items: center; justify-content: space-between; }
  header h1 { margin: 0; font-size: 16px; font-weight: 600; }
  header .stats { color: var(--muted); font-size: 13px; }
  main { max-width: 1400px; margin: 0 auto; padding: 20px; }
  .row { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; margin-bottom: 18px; padding: 16px; transition: opacity 0.2s, padding 0.2s; }
  .row.reviewed { opacity: 0.45; }
  .row.collapsed { padding: 10px 16px; cursor: pointer; }
  .row.collapsed .pair, .row.collapsed .actions { display: none; }
  .row.collapsed .row-head { margin-bottom: 0; }
  .row.collapsed .row-title::after { content: ' — kept (click to expand)'; color: var(--muted); font-style: italic; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  .row-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; gap: 12px; }
  .row-title { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  .row-title .locale { color: var(--accent); font-weight: 600; }
  .row-title .filename { color: var(--muted); }
  .chip { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
  .chip.modified { background: #2b3b58; color: #b6cdf3; }
  .chip.added    { background: #1f4632; color: #a5e0ba; }
  .chip.deleted  { background: #4a2229; color: #f3b6bd; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .cell { background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; align-items: stretch; min-height: 240px; }
  .cell .label { padding: 6px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); border-bottom: 1px solid var(--border); }
  .cell .imgwrap { flex: 1; display: flex; align-items: center; justify-content: center; padding: 12px; min-height: 200px; }
  .cell img { max-width: 100%; max-height: 70vh; object-fit: contain; display: block; }
  .cell .placeholder { color: var(--muted); font-style: italic; padding: 40px; text-align: center; }
  .actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 14px; }
  button { font: inherit; cursor: pointer; padding: 8px 16px; border-radius: 6px; border: 1px solid var(--border); background: var(--panel-2); color: var(--text); transition: background 0.15s; }
  button:hover:not(:disabled) { background: #2d323d; }
  button:disabled { cursor: default; opacity: 0.5; }
  button.revert { border-color: #5a2c33; color: #ffb4bb; }
  button.revert:hover:not(:disabled) { background: #3a1f25; }
  button.keep { border-color: #2c4a37; color: #b3e6c4; }
  button.keep:hover:not(:disabled) { background: #1f3a2a; }
  footer { position: sticky; bottom: 0; background: var(--panel); border-top: 1px solid var(--border); padding: 12px 20px; display: flex; justify-content: flex-end; }
  footer button.done { padding: 10px 20px; border-color: var(--accent); color: var(--accent); font-weight: 600; }
  footer button.done:hover:not(:disabled) { background: rgba(90, 156, 255, 0.12); }
  .empty, .error { padding: 60px 20px; text-align: center; color: var(--muted); }
  .error { color: var(--danger); }
</style>
</head>
<body>
<header>
  <h1>Screenshot Review</h1>
  <div class="stats" id="stats"></div>
</header>
<main id="main"><div class="empty">Loading…</div></main>
<footer><button class="done" id="done">All done</button></footer>
<script>
(async () => {
  const main = document.getElementById('main');
  const statsEl = document.getElementById('stats');
  const doneBtn = document.getElementById('done');

  let changes;
  try {
    const r = await fetch('/api/changes');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    changes = await r.json();
  } catch (e) {
    main.innerHTML = '<div class="error">Failed to load changes: ' + escapeHtml(e.message) + '</div>';
    return;
  }

  if (!changes.length) {
    main.innerHTML = '<div class="empty">No changes to review.</div>';
    return;
  }

  const total = changes.length;
  let reviewed = 0;
  function updateStats() {
    statsEl.textContent = reviewed + ' / ' + total + ' reviewed';
  }
  updateStats();

  main.innerHTML = '';
  for (const change of changes) {
    main.appendChild(renderRow(change));
  }

  function renderRow(change) {
    const row = document.createElement('section');
    row.className = 'row';
    row.dataset.path = change.path;

    const head = document.createElement('div');
    head.className = 'row-head';
    head.innerHTML =
      '<div class="row-title"><span class="locale">' + escapeHtml(change.locale) + '</span>' +
      '<span class="filename"> / ' + escapeHtml(change.filename) + '</span></div>' +
      '<span class="chip ' + change.status + '">' + change.status + '</span>';
    row.appendChild(head);

    const pair = document.createElement('div');
    pair.className = 'pair';
    pair.appendChild(renderCell('Before (HEAD)', change.status === 'added'
      ? null
      : '/before?path=' + encodeURIComponent(change.path)));
    pair.appendChild(renderCell('After (working tree)', change.status === 'deleted'
      ? null
      : '/after?path=' + encodeURIComponent(change.path)));
    row.appendChild(pair);

    const actions = document.createElement('div');
    actions.className = 'actions';
    const revertBtn = document.createElement('button');
    revertBtn.className = 'revert';
    revertBtn.textContent = change.status === 'added' ? 'Delete (revert)' : 'Revert';
    const keepBtn = document.createElement('button');
    keepBtn.className = 'keep';
    keepBtn.textContent = 'Keep';
    actions.appendChild(revertBtn);
    actions.appendChild(keepBtn);
    row.appendChild(actions);

    revertBtn.addEventListener('click', async () => {
      revertBtn.disabled = true;
      keepBtn.disabled = true;
      try {
        const r = await fetch('/api/revert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: change.path }),
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        revertBtn.textContent = 'Reverted';
        markReviewed(row);
      } catch (e) {
        revertBtn.textContent = 'Failed';
        revertBtn.disabled = false;
        keepBtn.disabled = false;
        alert('Revert failed: ' + e.message);
      }
    });

    keepBtn.addEventListener('click', () => {
      revertBtn.disabled = true;
      keepBtn.disabled = true;
      keepBtn.textContent = 'Kept';
      markReviewed(row);
      row.classList.add('collapsed');
    });

    row.addEventListener('click', (ev) => {
      if (!row.classList.contains('collapsed')) return;
      // Don't trigger when clicking buttons inside (they're hidden anyway, but be safe)
      if (ev.target instanceof HTMLElement && ev.target.closest('button')) return;
      row.classList.remove('collapsed');
      row.classList.remove('reviewed');
      revertBtn.disabled = false;
      keepBtn.disabled = false;
      keepBtn.textContent = 'Keep';
      reviewed = Math.max(0, reviewed - 1);
      updateStats();
    });

    return row;
  }

  function renderCell(label, src) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    const lab = document.createElement('div');
    lab.className = 'label';
    lab.textContent = label;
    cell.appendChild(lab);
    const wrap = document.createElement('div');
    wrap.className = 'imgwrap';
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      img.alt = label;
      wrap.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'placeholder';
      ph.textContent = label.startsWith('Before') ? '(new file — no previous version)' : '(file deleted)';
      wrap.appendChild(ph);
    }
    cell.appendChild(wrap);
    return cell;
  }

  function markReviewed(row) {
    if (!row.classList.contains('reviewed')) {
      row.classList.add('reviewed');
      reviewed++;
      updateStats();
    }
  }

  doneBtn.addEventListener('click', async () => {
    doneBtn.disabled = true;
    doneBtn.textContent = 'Closing…';
    try {
      await fetch('/api/done', { method: 'POST' });
    } catch (e) {
      // server is shutting down — expected
    }
    document.body.innerHTML = '<div class="empty">Review complete. You can close this tab.</div>';
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      c === '&' ? '&amp;' :
      c === '<' ? '&lt;' :
      c === '>' ? '&gt;' :
      c === '"' ? '&quot;' : '&#39;');
  }
})();
</script>
</body>
</html>`;
}
