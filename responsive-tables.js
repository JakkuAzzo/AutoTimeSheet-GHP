(function () {
  "use strict";
  var tableSequence = 0;

  function labelTable(table) {
    if (!(table instanceof HTMLTableElement) || table.matches(".estimate-paper-table")) return;
    table.classList.add("responsive-data-table");
    var headerRow = table.tHead && table.tHead.rows.length ? table.tHead.rows[table.tHead.rows.length - 1] : table.rows[0];
    if (!headerRow) return;
    var labels = Array.from(headerRow.cells).map(function (cell) { return cell.textContent.trim().replace(/\s+/g, " "); });
    var tableId = table.dataset.responsiveTableId || "responsive-table-" + (++tableSequence);
    table.dataset.responsiveTableId = tableId;
    Array.from(headerRow.cells).forEach(function (cell, index) {
      if (!cell.id) cell.id = tableId + "-column-" + index;
      cell.scope = "col";
    });
    Array.from(table.tBodies).forEach(function (body) {
      Array.from(body.rows).forEach(function (row) {
        Array.from(row.cells).forEach(function (cell, index) {
          if (cell.colSpan > 1 || cell.hasAttribute("data-label")) return;
          var label = labels[index];
          if (!label) return;
          cell.dataset.label = label;
          if (headerRow.cells[index]) cell.setAttribute("headers", headerRow.cells[index].id);
        });
      });
    });
  }

  function labelTables(root) {
    if (root instanceof HTMLTableElement) labelTable(root);
    if (root.querySelectorAll) root.querySelectorAll("table").forEach(labelTable);
  }

  labelTables(document);
  new MutationObserver(function (changes) {
    changes.forEach(function (change) {
      change.addedNodes.forEach(function (node) {
        if (node.nodeType === Node.ELEMENT_NODE) labelTables(node);
      });
      var parentTable = change.target instanceof HTMLTableElement ? change.target : change.target.closest && change.target.closest("table");
      if (parentTable) labelTable(parentTable);
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
}());
