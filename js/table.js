/* TableKit — column dropdown sort/filter
 *
 * Usage:
 *   TableKit.init(tableElement)
 *   TableKit.initAll()   // targets all <table class="tablekit">
 *
 * Options (data attributes on <table>):
 *   data-tk-sort="false"    // disable sorting
 *   data-tk-filter="false"  // disable checklist filter in dropdown
 */

const TableKit = (() => {

  function init(table) {
    if (table._tk) return;
    table._tk = true;

    const sortEnabled   = table.dataset.tkSort   !== 'false';
    const filterEnabled = table.dataset.tkFilter  !== 'false';

    const thead = table.tHead;
    if (!thead) return;

    const headerRow = thead.rows[0];
    const cols = headerRow.cells.length;

    // Wrap table
    if (!table.parentElement.classList.contains('tk-wrap')) {
      const wrap = document.createElement('div');
      wrap.className = 'tk-wrap';
      table.parentNode.insertBefore(wrap, table);
      wrap.appendChild(table);
    }

    // Empty message
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'tk-empty-msg';
    emptyMsg.textContent = 'No matching rows.';
    table.parentElement.appendChild(emptyMsg);

    let sortCol = null;
    let sortDir = null;

    // checkedValues[col] = Set of values that are checked (visible); null = all visible
    const checkedValues = Array(cols).fill(null);

    const dropdowns = [];

    // Build each header cell
    for (let i = 0; i < cols; i++) {
      const th = headerRow.cells[i];
      const label = th.textContent.trim();
      th.textContent = '';

      const inner = document.createElement('div');
      inner.className = 'tk-th-inner';

      const labelSpan = document.createElement('span');
      labelSpan.className = 'tk-th-label';
      labelSpan.textContent = label;
      inner.appendChild(labelSpan);

      const btn = document.createElement('button');
      btn.className = 'tk-drop-btn';
      btn.setAttribute('aria-label', `Options for ${label}`);
      btn.textContent = '▼';
      inner.appendChild(btn);

      // Dropdown panel
      const panel = document.createElement('div');
      panel.className = 'tk-dropdown';

      let ascBtn = null, descBtn = null;

      if (sortEnabled) {
        ascBtn  = makeBtn('▲  Sort A → Z', 'tk-sort-btn', () => setSort(i, 'asc',  ascBtn, descBtn, inner));
        descBtn = makeBtn('▼  Sort Z → A', 'tk-sort-btn', () => setSort(i, 'desc', ascBtn, descBtn, inner));
        panel.appendChild(ascBtn);
        panel.appendChild(descBtn);
      }

      let checklistWrap = null;
      if (filterEnabled) {
        if (sortEnabled) {
          const div = document.createElement('div');
          div.className = 'tk-dropdown-divider';
          panel.appendChild(div);
        }
        checklistWrap = document.createElement('div');
        checklistWrap.className = 'tk-checklist-wrap';
        panel.appendChild(checklistWrap);
      }

      dropdowns.push({ ascBtn, descBtn, inner, checklistWrap, col: i });

      th.appendChild(inner);
      th.appendChild(panel);
      th.style.position = 'relative';

      // Toggle dropdown — rebuild checklist each time so it reflects current row state
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = panel.classList.contains('open');
        closeAll();
        if (!isOpen) {
          if (checklistWrap) buildChecklist(i, checklistWrap, inner);
          const rect = btn.getBoundingClientRect();
          panel.style.top  = (rect.bottom + 4) + 'px';
          panel.style.left = rect.left + 'px';
          panel.classList.add('open');
        }
      });

      panel.addEventListener('click', e => e.stopPropagation());
    }

    document.addEventListener('click', closeAll);

    function closeAll() {
      thead.querySelectorAll('.tk-dropdown.open').forEach(p => p.classList.remove('open'));
    }

    function makeBtn(text, cls, onClick) {
      const b = document.createElement('button');
      b.className = cls;
      b.textContent = text;
      b.addEventListener('click', () => { onClick(); closeAll(); });
      return b;
    }

    function getRows() {
      const rows = [];
      for (const tbody of table.tBodies)
        for (const row of tbody.rows) rows.push(row);
      return rows;
    }

    function cellText(row, col) {
      return row.cells[col] ? row.cells[col].textContent.trim() : '';
    }

    function buildChecklist(col, wrap, inner) {
      wrap.innerHTML = '';

      const allRows = getRows();
      const uniqueValues = [...new Set(allRows.map(r => cellText(r, col)))].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
      );

      const currentChecked = checkedValues[col]; // null = all visible

      // "Select All" item
      const allCb = makeCheckItem('(Select All)', currentChecked === null, true);
      allCb.addEventListener('change', () => {
        checkedValues[col] = allCb.checked ? null : new Set();
        inner.dataset.filtered = checkedValues[col] !== null ? 'true' : 'false';
        applyFilter();
        buildChecklist(col, wrap, inner);
      });
      wrap.appendChild(allCb.parentElement);

      // Per-value items
      uniqueValues.forEach(val => {
        const isChecked = currentChecked === null || currentChecked.has(val);
        const cb = makeCheckItem(val || '(blank)', isChecked, false);
        cb.addEventListener('change', () => {
          if (checkedValues[col] === null) checkedValues[col] = new Set(uniqueValues);
          if (cb.checked) checkedValues[col].add(val);
          else            checkedValues[col].delete(val);
          if (checkedValues[col].size === uniqueValues.length) checkedValues[col] = null;
          inner.dataset.filtered = checkedValues[col] !== null ? 'true' : 'false';
          applyFilter();
          const allCbEl = wrap.querySelector('.tk-checklist-all input');
          if (allCbEl) allCbEl.checked = checkedValues[col] === null;
        });
        wrap.appendChild(cb.parentElement);
      });
    }

    // Returns the <input> checkbox; its .parentElement is the full <label> row
    function makeCheckItem(text, checked, isAll) {
      const label = document.createElement('label');
      label.className = 'tk-checklist-item' + (isAll ? ' tk-checklist-all' : '');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = checked;
      const span = document.createElement('span');
      span.textContent = text;
      label.appendChild(cb);
      label.appendChild(span);
      return cb;
    }

    function setSort(col, dir, ascBtn, descBtn, inner) {
      dropdowns.forEach(d => {
        if (d.inner) delete d.inner.dataset.sort;
        if (d.ascBtn) d.ascBtn.classList.remove('active');
        if (d.descBtn) d.descBtn.classList.remove('active');
      });
      if (sortCol === col && sortDir === dir) {
        sortCol = null;
        sortDir = null;
      } else {
        sortCol = col;
        sortDir = dir;
        inner.dataset.sort = dir;
        (dir === 'asc' ? ascBtn : descBtn).classList.add('active');
      }
      applySort();
    }

    function applySort() {
      if (sortCol === null) return applyFilter();
      const rows = getRows();
      rows.sort((a, b) => {
        const av = cellText(a, sortCol);
        const bv = cellText(b, sortCol);
        const an = parseFloat(av.replace(/[^0-9.-]/g, ''));
        const bn = parseFloat(bv.replace(/[^0-9.-]/g, ''));
        let cmp = (!isNaN(an) && !isNaN(bn))
          ? an - bn
          : av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
        return sortDir === 'asc' ? cmp : -cmp;
      });
      rows.forEach(row => row.parentElement.appendChild(row));
      applyFilter();
    }

    function applyFilter() {
      const rows = getRows();
      let visible = 0;
      rows.forEach(row => {
        const match = checkedValues.every((checked, col) => {
          if (checked === null) return true;
          return checked.has(cellText(row, col));
        });
        row.dataset.tkHidden = match ? 'false' : 'true';
        if (match) visible++;
      });
      emptyMsg.classList.toggle('visible', visible === 0);
    }
  }

  function initAll() {
    document.querySelectorAll('table.tablekit').forEach(init);
  }

  return { init, initAll };
})();
