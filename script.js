// ===== Time & duration parsing =====

function parseTimeToMinutes(str) {
  if (!str) return null;
  const trimmed = str.trim();
  const parts = trimmed.split(":");
  if (parts.length !== 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || m < 0 || m >= 60) return null;
  return h * 60 + m;
}

function parseHoursToMinutes(str) {
  if (!str) return 0;
  const trimmed = str.trim();
  if (!trimmed) return 0;

  if (trimmed.includes(":")) {
    const parts = trimmed.split(":");
    if (parts.length !== 2) return null;
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    if (h < 0 || m < 0 || m >= 60) return null;
    return h * 60 + m;
  }

  const h = Number(trimmed);
  if (!Number.isFinite(h) || h < 0) return null;
  return h * 60;
}

function parseBreakToMinutes(str) {
  if (!str) return 0;
  const trimmed = str.trim();
  if (!trimmed) return 0;

  if (trimmed.includes(":")) {
    return parseHoursToMinutes(trimmed);
  }

  const m = Number(trimmed);
  if (!Number.isFinite(m) || m < 0) return null;
  return m;
}

function formatMinutesAsHM(totalMinutes) {
  const sign = totalMinutes < 0 ? "-" : "";
  const mins = Math.abs(totalMinutes);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${sign}${h}h ${m}m`;
}

// ===== DOM references =====

const tbody = document.getElementById("timesheet-body");
const addRowBtn = document.getElementById("add-row-btn");
const clearRowsBtn = document.getElementById("clear-rows-btn");
const recalcBtn = document.getElementById("recalculate-btn");
const uploadDocxInput = document.getElementById("upload-docx-input");
const downloadCsvBtn = document.getElementById("download-csv-btn");

const overallTotalsEl = document.getElementById("overall-totals");
const weeklyTotalsEl = document.getElementById("weekly-totals");
const issuesOutputEl = document.getElementById("issues-output");
const errorBannerEl = document.getElementById("error-banner");

// ===== Table row management =====

function createRow() {
  const rowIndex = tbody.children.length + 1;
  const tr = document.createElement("tr");

  const cols = [
    { key: "index", type: "label" },
    { key: "date", type: "input" },
    { key: "day", type: "input" },
    { key: "week", type: "input" },
    { key: "start", type: "input" },
    { key: "finish", type: "input" },
    { key: "break", type: "input" },
    { key: "basic", type: "input" },
    { key: "ot15", type: "input" },
    { key: "ot20", type: "input" },
    { key: "notes", type: "input" }
  ];

  cols.forEach((col) => {
    const td = document.createElement("td");
    if (col.type === "label") {
      td.textContent = rowIndex;
      td.classList.add("row-index");
    } else {
      const input = document.createElement("input");
      input.type = "text";
      input.dataset.field = col.key;
      td.appendChild(input);
    }
    tr.appendChild(td);
  });

  tbody.appendChild(tr);
}

function renumberRows() {
  Array.from(tbody.children).forEach((tr, i) => {
    const labelCell = tr.querySelector("td.row-index");
    if (labelCell) labelCell.textContent = i + 1;
  });
}

function getRowsFromTable() {
  const rows = [];
  Array.from(tbody.children).forEach((tr, idx) => {
    const row = { index: idx + 1 };
    const inputs = tr.querySelectorAll("input[type='text']");
    inputs.forEach((input) => {
      const field = input.dataset.field;
      row[field] = input.value || "";
    });
    rows.push(row);
  });
  return rows;
}

function setTableFromRows(rows) {
  tbody.innerHTML = "";
  rows.forEach(() => createRow());
  Array.from(tbody.children).forEach((tr, idx) => {
    const row = rows[idx];
    const inputs = tr.querySelectorAll("input[type='text']");
    inputs.forEach((input) => {
      const field = input.dataset.field;
      if (field && row[field] !== undefined) {
        input.value = row[field];
      }
    });
  });
  renumberRows();
}

// ===== Recalculation & validation =====

function recalculate() {
  const rows = getRowsFromTable();
  if (!rows.length) {
    overallTotalsEl.textContent = "No rows in timesheet.";
    weeklyTotalsEl.textContent = "No rows in timesheet.";
    issuesOutputEl.textContent = "No issues detected (no data).";
    issuesOutputEl.classList.remove("error");
    issuesOutputEl.classList.add("ok");
    return;
  }

  let totalBasic = 0;
  let totalOT15 = 0;
  let totalOT20 = 0;
  let issues = [];
  const weeklyTotals = new Map();

  rows.forEach((row) => {
    const startMin = parseTimeToMinutes(row.start);
    const finishMin = parseTimeToMinutes(row.finish);
    const breakMin = parseBreakToMinutes(row.break);

    const basicMin = parseHoursToMinutes(row.basic);
    const ot15Min = parseHoursToMinutes(row.ot15);
    const ot20Min = parseHoursToMinutes(row.ot20);

    const rowLabel = `Row ${row.index}${row.date ? ` (${row.date})` : ""}`;

    if (breakMin === null) {
      issues.push(`${rowLabel}: Lunch value "${row.break}" is invalid.`);
    }
    if (basicMin === null) {
      issues.push(`${rowLabel}: Basic hours "${row.basic}" is invalid.`);
    }
    if (ot15Min === null) {
      issues.push(`${rowLabel}: OT 1.5 hours "${row.ot15}" is invalid.`);
    }
    if (ot20Min === null) {
      issues.push(`${rowLabel}: OT 2.0 hours "${row.ot20}" is invalid.`);
    }

    let workedMin = null;
    if (startMin != null && finishMin != null && breakMin != null) {
      workedMin = finishMin - startMin - breakMin;
      if (workedMin < 0) {
        issues.push(
          `${rowLabel}: Finish time is before start time after lunch.`
        );
      } else {
        const sumEntered =
          (basicMin || 0) + (ot15Min || 0) + (ot20Min || 0);
        const diff = Math.abs(sumEntered - workedMin);
        if (diff > 1) {
          issues.push(
            `${rowLabel}: Worked = ${formatMinutesAsHM(
              workedMin
            )}, but Basic + OT = ${formatMinutesAsHM(
              sumEntered
            )} (difference ${formatMinutesAsHM(diff)}).`
          );
        }
      }
    }

    if (Number.isFinite(basicMin)) totalBasic += basicMin || 0;
    if (Number.isFinite(ot15Min)) totalOT15 += ot15Min || 0;
    if (Number.isFinite(ot20Min)) totalOT20 += ot20Min || 0;

    const weekKey =
      row.week && row.week.trim() ? row.week.trim() : "Unspecified";
    if (!weeklyTotals.has(weekKey)) {
      weeklyTotals.set(weekKey, { basic: 0, ot15: 0, ot20: 0 });
    }
    const wk = weeklyTotals.get(weekKey);
    if (Number.isFinite(basicMin)) wk.basic += basicMin || 0;
    if (Number.isFinite(ot15Min)) wk.ot15 += ot15Min || 0;
    if (Number.isFinite(ot20Min)) wk.ot20 += ot20Min || 0;
  });

  // Apply weekly rule: reach 40h basic before any overtime counts.
  // We shift OT minutes into Basic up to 40h. Preference: deduct from OT1.5 first, then OT2.0.
  const adjustedWeeklyTotals = new Map();
  weeklyTotals.forEach((t, weekKey) => {
    const targetBasic = 40 * 60; // 40 hours in minutes
    let basic = t.basic;
    let ot15 = t.ot15;
    let ot20 = t.ot20;
    if (basic < targetBasic) {
      const needed = targetBasic - basic;
      const availableOT = ot15 + ot20;
      const shift = Math.min(needed, availableOT);
      // subtract from OT1.5 first
      const from15 = Math.min(shift, ot15);
      ot15 -= from15;
      let remaining = shift - from15;
      const from20 = Math.min(remaining, ot20);
      ot20 -= from20;
      basic += (from15 + from20);
    }
    adjustedWeeklyTotals.set(weekKey, { basic, ot15, ot20 });
  });

  // Recompute overall totals from adjusted weekly totals
  totalBasic = 0;
  totalOT15 = 0;
  totalOT20 = 0;
  adjustedWeeklyTotals.forEach((t) => {
    totalBasic += t.basic;
    totalOT15 += t.ot15;
    totalOT20 += t.ot20;
  });

  const grandTotal = totalBasic + totalOT15 + totalOT20;
  overallTotalsEl.textContent =
    `Basic:   ${formatMinutesAsHM(totalBasic)}\n` +
    `OT 1.5:  ${formatMinutesAsHM(totalOT15)}\n` +
    `OT 2.0:  ${formatMinutesAsHM(totalOT20)}\n` +
    `-------------------------\n` +
    `TOTAL:   ${formatMinutesAsHM(grandTotal)}`;

  const weeklyLines = [];
  Array.from(adjustedWeeklyTotals.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([weekKey, t]) => {
      const weekTotal = t.basic + t.ot15 + t.ot20;
      weeklyLines.push(
        `${weekKey}\n` +
          `  Basic:  ${formatMinutesAsHM(t.basic)}\n` +
          `  OT 1.5: ${formatMinutesAsHM(t.ot15)}\n` +
          `  OT 2.0: ${formatMinutesAsHM(t.ot20)}\n` +
          `  Total:  ${formatMinutesAsHM(weekTotal)}\n`
      );
    });

  weeklyTotalsEl.textContent =
    weeklyLines.length ? weeklyLines.join("\n") : "No weekly data.";

  if (!issues.length) {
    issuesOutputEl.textContent = "No issues detected.";
    issuesOutputEl.classList.remove("error");
    issuesOutputEl.classList.add("ok");
  } else {
    issuesOutputEl.textContent = issues.join("\n");
    issuesOutputEl.classList.remove("ok");
    issuesOutputEl.classList.add("error");
  }
}

// ===== CSV export =====

function rowsToCsv(rows) {
  const header = [
    "Date",
    "Day",
    "Week",
    "Start",
    "Finish",
    "Lunch",
    "BasicHours",
    "OT1_5Hours",
    "OT2_0Hours",
    "Notes"
  ];
  const lines = [header.join(",")];

  rows.forEach((row) => {
    const values = [
      row.date || "",
      row.day || "",
      row.week || "",
      row.start || "",
      row.finish || "",
      row.break || "",
      row.basic || "",
      row.ot15 || "",
      row.ot20 || "",
      row.notes || ""
    ];
    const escaped = values.map((v) => {
      const needsQuotes = /[",\n]/.test(v);
      if (needsQuotes) {
        return `"${v.replace(/"/g, '""')}"`;
      }
      return v;
    });
    lines.push(escaped.join(","));
  });

  return lines.join("\n");
}

function downloadCsv() {
  const rows = getRowsFromTable();
  if (!rows.length) {
    alert("No rows to export.");
    return;
  }
  const csv = rowsToCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "timesheet.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ===== DOCX parsing via Mammoth =====

function extractWeekLabelFromHtml(html) {
  const weekNumMatch = html.match(/Week Number:\s*([^<\r\n]+)/i);
  const weekBeginMatch = html.match(/Week Beginning:\s*([^<\r\n]+)/i);

  if (weekNumMatch && weekBeginMatch) {
    return `Week ${weekNumMatch[1].trim()} – ${weekBeginMatch[1].trim()}`;
  }
  if (weekNumMatch) {
    return `Week ${weekNumMatch[1].trim()}`;
  }
  if (weekBeginMatch) {
    return `Week of ${weekBeginMatch[1].trim()}`;
  }
  return "Unspecified";
}

function extractRowsFromDocxHtml(html) {
  const container = document.createElement("div");
  container.innerHTML = html;

  const tables = container.querySelectorAll("table");
  if (!tables.length) return [];

  const headerKeywords = ["date", "work", "start", "finish", "lunch"];

  let bestTable = null;
  let bestScore = 0;

  tables.forEach((tbl) => {
    const firstRow = tbl.querySelector("tr");
    if (!firstRow) return;
    const headers = Array.from(firstRow.cells).map((td) =>
      td.textContent.toLowerCase()
    );
    let score = 0;
    headerKeywords.forEach((kw) => {
      if (headers.some((h) => h.includes(kw))) score++;
    });
    if (score > bestScore) {
      bestScore = score;
      bestTable = tbl;
    }
  });

  if (!bestTable || bestScore === 0) return [];

  const weekLabel = extractWeekLabelFromHtml(html);
  const rows = [];
  const trs = bestTable.querySelectorAll("tr");

  for (let i = 1; i < trs.length; i++) {
    const tds = trs[i].cells;
    if (!tds.length) continue;

    // Simple guard: if there is no START/FINISH cell, skip.
    if (tds.length < 6) continue;

    const text = (idx) =>
      idx >= 0 && idx < tds.length ? tds[idx].textContent.trim() : "";

    const date = text(0);
    const worksite = text(1);
    const start = text(2);
    const finish = text(3);
    const lunch = text(4);
    const basic = text(5);
    const ot15 = text(6) || "";
    const ot20 = text(7) || "";

    // Skip header/blank rows
    const hasAnyTime =
      !!start || !!finish || !!basic || !!ot15 || !!ot20;
    if (!hasAnyTime) continue;

    rows.push({
      date,
      day: "",
      week: weekLabel,
      start,
      finish,
      break: lunch,
      basic,
      ot15,
      ot20,
      notes: worksite
    });
  }

  return rows;
}

function handleDocxFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const arrayBuffer = e.target.result;
    mammoth
      .convertToHtml({ arrayBuffer })
      .then((result) => {
        // clear any previous error
        if (errorBannerEl) {
          errorBannerEl.textContent = "";
          errorBannerEl.classList.add("hidden");
        }
        const html = result.value;
        const rows = extractRowsFromDocxHtml(html);
        if (!rows.length) {
          if (errorBannerEl) {
            errorBannerEl.textContent =
              "Could not find a timesheet table in that Word document. Make sure it's the standard GMT weekly timesheet template.";
            errorBannerEl.classList.remove("hidden");
          } else {
            alert(
              "Could not find a timesheet table in that Word document. Make sure it's the standard GMT weekly timesheet template."
            );
          }
          return;
        }
        setTableFromRows(rows);
        recalculate();
      })
      .catch((err) => {
        console.error(err);
        if (errorBannerEl) {
          errorBannerEl.textContent =
            "There was a problem reading that .docx file in the browser.";
          errorBannerEl.classList.remove("hidden");
        } else {
          alert(
            "There was a problem reading that .docx file in the browser."
          );
        }
      });
  };
  reader.readAsArrayBuffer(file);
}

// ===== Event wiring =====

addRowBtn.addEventListener("click", () => {
  createRow();
  renumberRows();
});

clearRowsBtn.addEventListener("click", () => {
  if (
    tbody.children.length &&
    !confirm("Clear all rows from the timesheet?")
  ) {
    return;
  }
  tbody.innerHTML = "";
});

recalcBtn.addEventListener("click", recalculate);

downloadCsvBtn.addEventListener("click", downloadCsv);

uploadDocxInput.addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const lower = file.name.toLowerCase();
  if (!lower.endsWith(".docx")) {
    alert("Please upload a Word .docx file (GMT weekly timesheet).");
    return;
  }
  handleDocxFile(file);
});

// Initialise with a few empty rows
for (let i = 0; i < 5; i++) {
  createRow();
}
renumberRows();
