/* PageToolbar — top action bar for tabular pages
 *
 * Usage:
 *   PageToolbar.init(options)
 *
 * Options:
 *   title         {string}   Page title shown centered. Default: document.title
 *   logo          {string}   Path to logo image file. Optional.
 *   logoText      {string}   Text to show beside/instead of logo image. Optional.
 *   tableSelector {string}   CSS selector for the table to export. Default: 'table.tablekit'
 *   emailSubject  {string}   Subject line for mailto. Default: page title
 *   dataUrl       {string}   URL that returns JSON rows for in-place table refresh.
 *                            Response format: array of objects  [{ col: val, ... }, ...]
 *                            Column keys must match <th> text. Optional.
 *   dataTransform {function} Optional fn(responseJson) → array of row objects, for
 *                            when the API wraps the rows (e.g. { data: [...] }).
 *   onRefresh     {function} Custom refresh callback. Overrides dataUrl if both provided.
 */

const PageToolbar = (() => {

  const ICONS = {
    print:   `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="1" width="10" height="6" rx="1"/><rect x="1" y="6" width="14" height="7" rx="1"/><rect x="4" y="10" width="8" height="5" rx="0.5" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8.5" r="0.75" fill="currentColor" stroke="none"/></svg>`,
    export:  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg"><path d="M8 1v9M5 7l3 3 3-3"/><path d="M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2"/></svg>`,
    import:  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg"><path d="M8 10V1M5 4l3-3 3 3"/><path d="M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2"/></svg>`,
    email:   `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="3" width="14" height="10" rx="1"/><path d="M1 4l7 5 7-5"/></svg>`,
    clear:   `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg"><path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 9h8l1-9" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 10l3-3M11 10L8 7" stroke-linecap="round"/></svg>`,
    refresh: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg"><path d="M13.5 2.5A7 7 0 102 8" stroke-linecap="round"/><path d="M2 4V8H6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    close:   `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" xmlns="http://www.w3.org/2000/svg"><path d="M3 3l10 10M13 3L3 13" stroke-linecap="round"/></svg>`,
  };

  function init(options = {}) {
    const title         = options.title         || document.title;
    const logo          = options.logo          || null;
    const logoText      = options.logoText      || null;
    const tableSelector = options.tableSelector || 'table.tablekit';
    const emailSubject  = options.emailSubject  || title;
    const dataUrl       = options.dataUrl       || null;
    const dataTransform = options.dataTransform || null;
    const onRefresh     = options.onRefresh     || null;

    // Find or create toolbar container
    let container = document.getElementById('page-toolbar');
    if (!container) {
      container = document.createElement('div');
      container.id = 'page-toolbar';
      document.body.insertBefore(container, document.body.firstChild);
    }
    container.innerHTML = '';
    container.style.display = '';
    container.className = 'tk-toolbar';

    // --- Left: Logo ---
    const logoEl = document.createElement('div');
    logoEl.className = 'tk-toolbar-logo';
    if (logo) {
      const img = document.createElement('img');
      img.src = logo;
      img.alt = logoText || 'Logo';
      logoEl.appendChild(img);
    }
    if (logoText) {
      const span = document.createElement('span');
      span.className = 'tk-toolbar-logo-text';
      span.textContent = logoText;
      logoEl.appendChild(span);
    }
    container.appendChild(logoEl);

    // --- Center: Title ---
    const titleEl = document.createElement('div');
    titleEl.className = 'tk-toolbar-title';
    titleEl.textContent = title;
    container.appendChild(titleEl);

    // --- Right: Actions ---
    const actions = document.createElement('div');
    actions.className = 'tk-toolbar-actions';

    actions.appendChild(makeBtn('Print',   ICONS.print,   '',             () => doPrint(tableSelector, title, logo, logoText)));
    actions.appendChild(makeBtn('Export',  ICONS.export,  '',             () => doExport(tableSelector, title)));
    actions.appendChild(makeBtn('Import',  ICONS.import,  '',             () => doImport(tableSelector)));
    actions.appendChild(makeBtn('Email',   ICONS.email,   '',             () => doEmail(emailSubject)));
    actions.appendChild(makeBtn('Clear Filters', ICONS.clear, '',         () => doClearFilters(tableSelector)));
    const refreshBtn = makeBtn('Refresh', ICONS.refresh, '', () => doRefresh(tableSelector, dataUrl, dataTransform, onRefresh));
    refreshBtn.dataset.action = 'refresh';
    actions.appendChild(refreshBtn);
    actions.appendChild(makeBtn('Close',   ICONS.close,   'tk-btn-close', doClose));

    container.appendChild(actions);
  }

  function makeBtn(label, iconSvg, extraClass, onClick) {
    const btn = document.createElement('button');
    btn.className = 'tk-btn' + (extraClass ? ' ' + extraClass : '');
    btn.innerHTML = iconSvg + label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  // --- Actions ---

  function doPrint(tableSelector, title, logoSrc, logoText) {
    const table = document.querySelector(tableSelector);
    if (!table) { alert('No table found to print.'); return; }

    // Clone only visible rows
    const clone = table.cloneNode(false); // shallow — no children yet
    const thead = table.tHead;
    if (thead) clone.appendChild(thead.cloneNode(true));
    for (const tbody of table.tBodies) {
      const tbodyClone = document.createElement('tbody');
      for (const row of tbody.rows) {
        if (row.dataset.tkHidden !== 'true') tbodyClone.appendChild(row.cloneNode(true));
      }
      clone.appendChild(tbodyClone);
    }

    // Strip TableKit UI elements (dropdown buttons, filter inputs) from clone
    clone.querySelectorAll('.tk-drop-btn, .tk-dropdown').forEach(el => el.remove());
    clone.querySelectorAll('.tk-th-inner').forEach(inner => {
      const label = inner.querySelector('.tk-th-label');
      const th = inner.parentElement;
      th.textContent = label ? label.textContent.trim() : inner.textContent.trim();
    });

    const logoHTML = logoSrc
      ? `<img src="${logoSrc}" style="height:40px;vertical-align:middle;margin-right:8px;">`
      : '';
    const logoNameHTML = logoText
      ? `<span style="font-size:1.1rem;font-weight:700;vertical-align:middle;">${logoText}</span>`
      : '';

    const win = window.open('', '_blank', 'width=900,height=700');
    win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 24px 32px; color: #111; }
    .print-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; border-bottom: 2px solid #d0d7de; padding-bottom: 10px; }
    .print-logo { display: flex; align-items: center; }
    .print-title { font-size: 1.2rem; font-weight: 600; }
    .print-date { font-size: 0.8rem; color: #666; }
    table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
    th { background: #f0f4f8; font-weight: 600; text-align: left; padding: 7px 10px; border-bottom: 2px solid #c0cad4; }
    td { padding: 6px 10px; border-bottom: 1px solid #e0e0e0; text-align: left; }
    tr:nth-child(even) td { background: #f8fafc; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
  <div class="print-header">
    <div class="print-logo">${logoHTML}${logoNameHTML}</div>
    <div class="print-title">${title}</div>
    <div class="print-date">Printed: ${new Date().toLocaleString()}</div>
  </div>
  ${clone.outerHTML}
  <script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); }<\/script>
</body>
</html>`);
    win.document.close();
  }

  function buildCSV(tableSelector, title) {
    const table = document.querySelector(tableSelector);
    if (!table) return null;

    const rows = [];

    const headerCells = table.querySelectorAll('thead tr:first-child th');
    const headers = Array.from(headerCells).map(th => {
      const label = th.querySelector('.tk-th-label');
      return csvEscape(label ? label.textContent.trim() : th.textContent.trim());
    });
    rows.push(headers.join(','));

    table.querySelectorAll('tbody tr').forEach(row => {
      if (row.dataset.tkHidden === 'true') return;
      const cells = Array.from(row.cells).map(td => csvEscape(td.textContent.trim()));
      rows.push(cells.join(','));
    });

    return {
      content: rows.join('\r\n'),
      filename: (title || 'export').replace(/[^a-z0-9_\-]/gi, '_') + '.csv',
    };
  }

  function doExport(tableSelector, title) {
    const csv = buildCSV(tableSelector, title);
    if (!csv) { alert('No table found to export.'); return; }
    triggerDownload(csv.content, csv.filename);
  }

  function doImport(tableSelector) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const lines = e.target.result.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
        if (lines.length < 2) { alert('CSV must have a header row and at least one data row.'); return; }

        const headers = parseCSVRow(lines[0]);
        const table = document.querySelector(tableSelector);
        if (!table) { alert('No table found to import into.'); return; }

        // Validate headers match existing columns
        const thHeaders = Array.from(table.querySelectorAll('thead tr:first-child th')).map(th => {
          const label = th.querySelector('.tk-th-label');
          return (label ? label.textContent : th.textContent).trim();
        });
        const mismatch = headers.some((h, i) => h !== thHeaders[i]);
        if (mismatch || headers.length !== thHeaders.length) {
          if (!confirm(`CSV columns don't match table headers.\nCSV: ${headers.join(', ')}\nTable: ${thHeaders.join(', ')}\n\nImport anyway?`)) return;
        }

        const tbody = table.tBodies[0] || table.createTBody();
        tbody.innerHTML = '';
        for (let i = 1; i < lines.length; i++) {
          const vals = parseCSVRow(lines[i]);
          const tr = document.createElement('tr');
          vals.forEach(val => {
            const td = document.createElement('td');
            td.textContent = val;
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        }

        // Re-initialise TableKit if available
        if (typeof TableKit !== 'undefined') {
          table._tk = false;
          TableKit.init(table);
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  function parseCSVRow(line) {
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        cells.push(cur); cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur);
    return cells;
  }

  function triggerDownload(content, filename) {
    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function doEmail(emailSubject) {
    const subject = encodeURIComponent(emailSubject);
    const body = encodeURIComponent(location.href);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  function csvEscape(val) {
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return '"' + val.replace(/"/g, '""') + '"';
    }
    return val;
  }

  function doClearFilters(tableSelector) {
    const table = document.querySelector(tableSelector);
    if (!table) return;

    // Clear all TableKit filter inputs and checkbox state
    table.querySelectorAll('.tk-dropdown input[type="search"], .tk-dropdown input[type="checkbox"]').forEach(input => {
      if (input.type === 'checkbox') input.checked = true;
      else input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Show all rows directly as a safety net
    table.querySelectorAll('tbody tr').forEach(row => {
      row.dataset.tkHidden = 'false';
    });

    // Clear any sort indicators
    table.querySelectorAll('thead tr:first-child th .tk-th-inner').forEach(inner => {
      delete inner.dataset.sort;
    });
    table.querySelectorAll('.tk-sort-btn.active').forEach(btn => btn.classList.remove('active'));

    // Hide empty message if visible
    const emptyMsg = table.parentElement.querySelector('.tk-empty-msg');
    if (emptyMsg) emptyMsg.classList.remove('visible');

    // Clear active filter indicators
    table.querySelectorAll('.tk-th-inner[data-filtered]').forEach(inner => {
      delete inner.dataset.filtered;
    });
  }

  async function doRefresh(tableSelector, dataUrl, dataTransform, onRefresh) {
    const btn = document.querySelector('.tk-toolbar .tk-btn[data-action="refresh"]');

    // Custom callback takes priority
    if (onRefresh) {
      onRefresh();
      flashRefreshed(btn);
      return;
    }

    if (!dataUrl) {
      flashRefreshed(btn);
      return;
    }

    const table = document.querySelector(tableSelector);
    if (!table) { console.warn('PageToolbar: table not found:', tableSelector); return; }

    if (btn) btn.disabled = true;

    try {
      const res = await fetch(dataUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let rows = await res.json();
      if (dataTransform) rows = dataTransform(rows);

      const headers = Array.from(table.querySelectorAll('thead tr:first-child th')).map(th => {
        const label = th.querySelector('.tk-th-label');
        return (label ? label.textContent : th.textContent).trim();
      });

      const tbody = table.tBodies[0] || table.createTBody();
      tbody.innerHTML = '';
      rows.forEach(rowData => {
        const tr = document.createElement('tr');
        headers.forEach(col => {
          const td = document.createElement('td');
          td.textContent = rowData[col] ?? '';
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });

      if (typeof TableKit !== 'undefined') {
        table._tk = false;
        TableKit.init(table);
      }

      flashRefreshed(btn);
    } catch (err) {
      console.error('PageToolbar refresh failed:', err);
      alert('Refresh failed: ' + err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function flashRefreshed(btn) {
    if (!btn) return;
    const original = btn.innerHTML;
    btn.innerHTML = ICONS.refresh + 'Refreshed';
    btn.style.color = '#2a7a2a';
    btn.style.borderColor = '#a8d5a8';
    setTimeout(() => {
      btn.innerHTML = original;
      btn.style.color = '';
      btn.style.borderColor = '';
    }, 1500);
  }

  function doClose() {
    if (document.referrer) {
      history.back();
    } else {
      window.close();
    }
  }

  return { init };
})();
