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
const submitTimesheetBtn = document.getElementById("submit-timesheet-btn");
const employeeNameInput = document.getElementById("employee-name");
const rangeStartInput = document.getElementById("range-start");
const rangeEndInput = document.getElementById("range-end");
const manualTools = document.getElementById("manual-tools");
const uploadTools = document.getElementById("upload-tools");
const modeRadioNodes = document.querySelectorAll("input[name='entry-mode']");

const overallTotalsEl = document.getElementById("overall-totals");
const weeklyTotalsEl = document.getElementById("weekly-totals");
const issuesOutputEl = document.getElementById("issues-output");
const errorBannerEl = document.getElementById("error-banner");

// ===== Table row management =====

function createRow(dateStr = "", dayStr = "", weekStr = "") {
  const rowIndex = tbody.children.length + 1;
  const tr = document.createElement("tr");

  const cols = [
    { key: "index", type: "label" },
    { key: "date", type: "input", readonly: true, value: dateStr },
    { key: "day", type: "input", readonly: true, value: dayStr },
    { key: "week", type: "input", readonly: true, value: weekStr },
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
    td.dataset.field = col.key; // attach field name to td for error highlighting
    if (col.type === "label") {
      td.textContent = rowIndex;
      td.classList.add("row-index");
    } else {
      const input = document.createElement("input");
      input.type = "text";
      input.dataset.field = col.key;
      if (col.readonly) {
        input.readOnly = true;
        input.style.background = "#EFF9E8";
        input.style.cursor = "default";
      }
      if (col.value !== undefined) {
        input.value = col.value;
      }
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
  clearInlineErrors(); // remove previous error highlighting

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
  const weeklyTotals = new Map();

  rows.forEach((row) => {
    const startMin = parseTimeToMinutes(row.start);
    const finishMin = parseTimeToMinutes(row.finish);
    const breakMin = parseBreakToMinutes(row.break);

    const basicMin = parseHoursToMinutes(row.basic);
    const ot15Min = parseHoursToMinutes(row.ot15);
    const ot20Min = parseHoursToMinutes(row.ot20);

    if (breakMin === null && row.break) {
      highlightCellError(row.index, "break", `Invalid lunch value: "${row.break}"`);
    }
    if (basicMin === null && row.basic) {
      highlightCellError(row.index, "basic", `Invalid basic hours: "${row.basic}"`);
    }
    if (ot15Min === null && row.ot15) {
      highlightCellError(row.index, "ot15", `Invalid OT 1.5: "${row.ot15}"`);
    }
    if (ot20Min === null && row.ot20) {
      highlightCellError(row.index, "ot20", `Invalid OT 2.0: "${row.ot20}"`);
    }

    let workedMin = null;
    if (startMin != null && finishMin != null && breakMin != null) {
      workedMin = finishMin - startMin - breakMin;
      if (workedMin < 0) {
        highlightCellError(row.index, "finish", "Finish time is before start time (after lunch)");
      } else {
        const sumEntered =
          (basicMin || 0) + (ot15Min || 0) + (ot20Min || 0);
        const diff = Math.abs(sumEntered - workedMin);
        if (diff > 1) {
          highlightCellError(
            row.index,
            "basic",
            `Worked = ${formatMinutesAsHM(workedMin)}, but Basic + OT = ${formatMinutesAsHM(sumEntered)} (diff ${formatMinutesAsHM(diff)})`
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

  issuesOutputEl.textContent = "See inline highlights in the table above.";
  issuesOutputEl.classList.remove("error");
  issuesOutputEl.classList.add("ok");
}

// ===== Inline error highlighting =====
function clearInlineErrors() {
  Array.from(tbody.querySelectorAll("td.cell-error")).forEach((td) => {
    td.classList.remove("cell-error");
    td.removeAttribute("title");
  });
}

function highlightCellError(rowIndex, fieldKey, message) {
  const tr = tbody.children[rowIndex - 1];
  if (!tr) return;
  const td = Array.from(tr.children).find((cell) => cell.dataset.field === fieldKey);
  if (td) {
    td.classList.add("cell-error");
    td.setAttribute("title", message);
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

// ===== FormSubmit integration =====
// Build a form dynamically and POST to formsubmit.co including CSV, name, date range.
function submitTimesheet() {
  const name = employeeNameInput.value.trim();
  const startDate = rangeStartInput.value;
  const endDate = rangeEndInput.value;
  if (!name) {
    showBannerError("Please enter your name before submitting.");
    return;
  }
  if (!startDate || !endDate) {
    showBannerError("Please select a start and end date range.");
    return;
  }
  const rows = getRowsFromTable();
  if (!rows.length) {
    showBannerError("No timesheet rows to submit.");
    return;
  }
  const csv = rowsToCsv(rows);
  const subject = `${name} timesheet ${startDate} to ${endDate}`;

  // Clear previous banner
  hideBanner();

  const form = document.createElement("form");
  form.action = "https://formsubmit.co/acc.gmtelect@outlook.com";
  form.method = "POST";
  form.style.display = "none";

  const field = (name, value) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  };

  field("_subject", subject);
  field("employee_name", name);
  field("date_range", `${startDate} to ${endDate}`);
  field("timesheet_csv", csv);
  field("_captcha", "false");
  field("_template", "table");

  document.body.appendChild(form);
  form.submit();
  setTimeout(() => {
    document.body.removeChild(form);
  }, 2000);
}

function showBannerError(msg) {
  if (errorBannerEl) {
    errorBannerEl.textContent = msg;
    errorBannerEl.classList.remove("hidden");
  } else {
    alert(msg);
  }
}
function hideBanner() {
  if (errorBannerEl) {
    errorBannerEl.textContent = "";
    errorBannerEl.classList.add("hidden");
  }
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

  // Accept wider header keyword set for robustness.
  const headerKeywords = ["date", "work", "start", "finish", "lunch", "basic", "o/t", "1.5", "2.0"];

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

  // Build header index map for dynamic column detection
  const headerCells = Array.from(bestTable.querySelectorAll("tr")[0].cells).map((c) => c.textContent.trim().toLowerCase());
  const findIdx = (...needles) => {
    return headerCells.findIndex((h) => needles.some((n) => h.includes(n)));
  };
  const idxMap = {
    date: findIdx("date"),
    worksite: findIdx("work", "address", "site"),
    start: findIdx("start"),
    finish: findIdx("finish"),
    lunch: findIdx("lunch", "break"),
    basic: findIdx("basic"),
    ot15: findIdx("1.5", "1.5"),
    ot20: findIdx("2.0", "2.0"),
  };
  const rows = [];
  const trs = bestTable.querySelectorAll("tr");

  for (let i = 1; i < trs.length; i++) {
    const tds = trs[i].cells;
    if (!tds.length) continue;
    const text = (idx) => (idx >= 0 && idx < tds.length ? tds[idx].textContent.trim() : "");

    // Prefer header-based indices; fallback to positional mapping if missing
    const date = text(idxMap.date >= 0 ? idxMap.date : 0);
    const worksite = text(idxMap.worksite >= 0 ? idxMap.worksite : 1);
    const start = text(idxMap.start >= 0 ? idxMap.start : 2);
    const finish = text(idxMap.finish >= 0 ? idxMap.finish : 3);
    const lunch = text(idxMap.lunch >= 0 ? idxMap.lunch : 4);
    const basic = text(idxMap.basic >= 0 ? idxMap.basic : 5);
    const ot15 = text(idxMap.ot15 >= 0 ? idxMap.ot15 : 6);
    const ot20 = text(idxMap.ot20 >= 0 ? idxMap.ot20 : 7);

    const hasAnyTime = !!start || !!finish || !!basic || !!ot15 || !!ot20;
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
      notes: worksite,
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

// Mode toggle: manual vs upload
modeRadioNodes.forEach((radio) => {
  radio.addEventListener("change", () => {
    const mode = document.querySelector("input[name='entry-mode']:checked").value;
    if (mode === "manual") {
      manualTools.classList.remove("hidden");
      uploadTools.classList.add("hidden");
    } else {
      manualTools.classList.add("hidden");
      uploadTools.classList.remove("hidden");
    }
  });
});

submitTimesheetBtn.addEventListener("click", submitTimesheet);

// ===== Auto-fill date/day/week from date range =====
function generateRowsFromDateRange() {
  const start = rangeStartInput.value;
  const end = rangeEndInput.value;
  if (!start || !end) return;

  const startDate = new Date(start);
  const endDate = new Date(end);
  if (startDate > endDate) {
    showBannerError("Start date must be before or equal to end date.");
    return;
  }

  tbody.innerHTML = ""; // clear existing rows

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MS_PER_DAY = 86400000;
  const firstMonday = new Date(startDate);
  // Roll back to the previous Monday (or stay if already Monday)
  const dayOfWeek = firstMonday.getDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  firstMonday.setDate(firstMonday.getDate() - daysToMonday);

  let currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    const weekNumber = Math.floor((currentDate - firstMonday) / MS_PER_DAY / 7) + 1;
    const dd = String(currentDate.getDate()).padStart(2, "0");
    const mm = String(currentDate.getMonth() + 1).padStart(2, "0");
    const yyyy = currentDate.getFullYear();
    const dateStr = `${dd}/${mm}/${yyyy}`;
    const dayStr = dayNames[currentDate.getDay()];
    createRow(dateStr, dayStr, String(weekNumber));
    currentDate.setDate(currentDate.getDate() + 1);
  }
  renumberRows();
  hideBanner();
}

rangeStartInput.addEventListener("change", generateRowsFromDateRange);
rangeEndInput.addEventListener("change", generateRowsFromDateRange);

// Initialise with a few empty rows (if no dates set)
if (!rangeStartInput.value && !rangeEndInput.value) {
  for (let i = 0; i < 5; i++) {
    createRow();
  }
  renumberRows();
}
