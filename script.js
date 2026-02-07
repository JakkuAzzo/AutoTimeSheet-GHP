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
    if (h < 0 || m < 0) return null;
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
const downloadCsvBtn = document.getElementById("download-csv-btn");
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
const prevWeekBtn = document.getElementById("prev-week-btn");
const nextWeekBtn = document.getElementById("next-week-btn");
const weekIndicator = document.getElementById("week-indicator");

// Auth elements
const authModal = document.getElementById("auth-modal");
const authForm = document.getElementById("auth-form");
const authTitle = document.getElementById("auth-title");
const authUsername = document.getElementById("auth-username");
const authEmail = document.getElementById("auth-email");
const authFullname = document.getElementById("auth-fullname");
const authPassword = document.getElementById("auth-password");
const authError = document.getElementById("auth-error");
const authSubmitBtn = document.getElementById("auth-submit-btn");
const authToggleBtn = document.getElementById("auth-toggle-btn");
const emailGroup = document.getElementById("email-group");
const fullnameGroup = document.getElementById("fullname-group");
const userInfo = document.getElementById("user-info");
const usernameDisplay = document.getElementById("username-display");
const logoutBtn = document.getElementById("logout-btn");

// ===== Auth state =====
let currentUser = null;
let isLoginMode = true;

// ===== Week navigation state =====
let allWeekRows = []; // Array of arrays: [[week1Rows], [week2Rows], ...]
let currentWeekIndex = 0;
let autoSaveTimer = null;
let recalcTimer = null;

// ===== Auto-save to localStorage =====
function autoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    try {
      if (allWeekRows.length > 0 && currentWeekIndex >= 0 && currentWeekIndex < allWeekRows.length) {
        allWeekRows[currentWeekIndex] = getRowsFromTable();
      }
      const saveData = {
        allWeekRows,
        currentWeekIndex,
        name: employeeNameInput.value,
        startDate: rangeStartInput.value,
        endDate: rangeEndInput.value,
        timestamp: new Date().toISOString()
      };
      localStorage.setItem('timesheet_autosave', JSON.stringify(saveData));
    } catch (error) {
      console.error('Auto-save failed:', error);
    }
  }, 1000);
}

function loadAutoSave() {
  try {
    const saved = localStorage.getItem('timesheet_autosave');
    if (saved) {
      const data = JSON.parse(saved);
      allWeekRows = data.allWeekRows || [];
      currentWeekIndex = data.currentWeekIndex || 0;
      if (data.name) employeeNameInput.value = data.name;
      if (data.startDate) rangeStartInput.value = data.startDate;
      if (data.endDate) rangeEndInput.value = data.endDate;
      if (allWeekRows.length > 0) {
        displayCurrentWeek();
      }
    }
  } catch (error) {
    console.error('Load auto-save failed:', error);
  }
}

function clearAutoSave() {
  localStorage.removeItem('timesheet_autosave');
}

// ===== Table row management =====

// Helper: calculate worked hours from start, finish, and lunch
function calculateWorkedHours(startTime, finishTime, lunchMinutes) {
  const startMin = parseTimeToMinutes(startTime);
  const finishMin = parseTimeToMinutes(finishTime);
  const breakMin = parseBreakToMinutes(lunchMinutes);
  
  if (startMin === null || finishMin === null || breakMin === null) {
    return null;
  }
  
  let workedMin;
  // Support overnight shifts
  if (finishMin < startMin) {
    // Overnight: add 24 hours (1440 minutes) to finish time
    workedMin = (finishMin + 1440) - startMin - breakMin;
  } else {
    workedMin = finishMin - startMin - breakMin;
  }
  
  return workedMin >= 0 ? workedMin : null;
}

function createRow(dateStr = "", dayStr = "", weekStr = "") {
  const rowIndex = tbody.children.length + 1;
  const tr = document.createElement("tr");

  const cols = [
    { key: "index", type: "label" },
    { key: "date", type: "text", readonly: true, value: dateStr },
    { key: "day", type: "text", readonly: true, value: dayStr },
    { key: "week", type: "text", readonly: true, value: weekStr },
    { key: "start", type: "time" },
    { key: "finish", type: "time" },
    { key: "break", type: "text", placeholder: "30 or 0:30" },
    { key: "notes", type: "text" }
  ];

  cols.forEach((col) => {
    const td = document.createElement("td");
    td.dataset.field = col.key;
    
    if (col.type === "label") {
      td.textContent = rowIndex;
      td.classList.add("row-index");
    } else if (col.type === "time") {
      const input = document.createElement("input");
      input.type = "time";
      input.dataset.field = col.key;
      input.addEventListener('input', () => {
        autoSave();
        debouncedRecalc();
      });
      td.appendChild(input);
    } else {
      const input = document.createElement("input");
      input.type = "text";
      input.dataset.field = col.key;
      if (col.placeholder) input.placeholder = col.placeholder;
      if (col.readonly) {
        input.readOnly = true;
        input.style.background = "#EFF9E8";
        input.style.cursor = "default";
      } else {
        input.addEventListener('input', () => {
          autoSave();
          if (col.key === 'break') debouncedRecalc();
        });
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
    
    const cells = tr.querySelectorAll("td[data-field]");
    cells.forEach((td) => {
      const field = td.dataset.field;
      const input = td.querySelector("input");
      if (input) {
        row[field] = input.value || "";
      }
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
    
    const cells = tr.querySelectorAll("td[data-field]");
    cells.forEach((td) => {
      const field = td.dataset.field;
      if (field && row[field] !== undefined) {
        const value = row[field];
        const input = td.querySelector("input");
        if (input) {
          input.value = value;
        }
      }
    });
  });
  renumberRows();
}

// ===== Debounced recalculation =====
function debouncedRecalc() {
  clearTimeout(recalcTimer);
  recalcTimer = setTimeout(() => {
    recalculate();
  }, 500);
}

// ===== Week navigation functions =====

function organizeRowsByWeek() {
  const allRows = getRowsFromTable();
  const weekMap = new Map();
  
  allRows.forEach(row => {
    const weekKey = row.week && row.week.trim() ? row.week.trim() : "Unspecified";
    if (!weekMap.has(weekKey)) {
      weekMap.set(weekKey, []);
    }
    weekMap.get(weekKey).push(row);
  });
  
  // Convert to array of arrays, sorted by week key
  allWeekRows = Array.from(weekMap.entries())
    .sort((a, b) => {
      // Try to parse as numbers first
      const numA = parseInt(a[0]);
      const numB = parseInt(b[0]);
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      return a[0].localeCompare(b[0]);
    })
    .map(([weekKey, rows]) => rows);
  
  return allWeekRows.length;
}

function displayCurrentWeek() {
  if (allWeekRows.length === 0) {
    tbody.innerHTML = "";
    updateWeekIndicator();
    return;
  }
  
  currentWeekIndex = Math.max(0, Math.min(currentWeekIndex, allWeekRows.length - 1));
  const weekRows = allWeekRows[currentWeekIndex];
  
  tbody.innerHTML = "";
  weekRows.forEach(() => createRow());
  
  Array.from(tbody.children).forEach((tr, idx) => {
    const row = weekRows[idx];
    const cells = tr.querySelectorAll("td[data-field]");
    cells.forEach((td) => {
      const field = td.dataset.field;
      if (field && row[field] !== undefined) {
        const value = row[field];
        const input = td.querySelector("input");
        if (input) {
          input.value = value;
        }
      }
    });
  });
  
  renumberRows();
  updateWeekIndicator();
}

function updateWeekIndicator() {
  if (allWeekRows.length === 0) {
    weekIndicator.textContent = "No weeks";
    prevWeekBtn.disabled = true;
    nextWeekBtn.disabled = true;
  } else {
    weekIndicator.textContent = `Week ${currentWeekIndex + 1} of ${allWeekRows.length}`;
    prevWeekBtn.disabled = currentWeekIndex === 0;
    nextWeekBtn.disabled = currentWeekIndex >= allWeekRows.length - 1;
  }
}

function switchToWeek(direction) {
  // Save current week data before switching
  if (allWeekRows.length > 0 && currentWeekIndex >= 0 && currentWeekIndex < allWeekRows.length) {
    allWeekRows[currentWeekIndex] = getRowsFromTable();
  }
  
  currentWeekIndex += direction;
  displayCurrentWeek();
}

// ===== Recalculation & validation =====

function recalculate() {
  clearInlineErrors();

  if (allWeekRows.length > 0 && currentWeekIndex >= 0 && currentWeekIndex < allWeekRows.length) {
    allWeekRows[currentWeekIndex] = getRowsFromTable();
  }
  
  const rows = allWeekRows.flat();
  
  if (!rows.length) {
    overallTotalsEl.textContent = "No rows in timesheet.";
    weeklyTotalsEl.textContent = "No rows in timesheet.";
    issuesOutputEl.textContent = "No issues detected (no data).";
    issuesOutputEl.classList.remove("error");
    issuesOutputEl.classList.add("ok");
    return;
  }

  let hasErrors = false;
  const weeklyTotals = new Map();

  // Calculate worked hours for each row
  rows.forEach((row) => {
    const workedMin = calculateWorkedHours(row.start, row.finish, row.break);
    
    if (!row.start && !row.finish) {
      // Empty row, skip
      return;
    }
    
    if (!row.start || !row.finish) {
      highlightCellError(row.index, row.start ? "finish" : "start", "Both start and finish times required");
      hasErrors = true;
      return;
    }
    
    if (workedMin === null) {
      highlightCellError(row.index, "finish", "Invalid time values");
      hasErrors = true;
      return;
    }
    
    if (workedMin < 0) {
      highlightCellError(row.index, "finish", "Worked time cannot be negative");
      hasErrors = true;
      return;
    }

    const weekKey = row.week && row.week.trim() ? row.week.trim() : "Unspecified";
    if (!weeklyTotals.has(weekKey)) {
      weeklyTotals.set(weekKey, { totalMin: 0, rows: [] });
    }
    weeklyTotals.get(weekKey).totalMin += workedMin;
    weeklyTotals.get(weekKey).rows.push({ ...row, workedMin });
  });

  // Apply 40h basic rule per week, then calculate OT
  const adjustedWeeklyTotals = new Map();
  weeklyTotals.forEach((weekData, weekKey) => {
    const targetBasic = 40 * 60; // 40 hours
    let basic = Math.min(weekData.totalMin, targetBasic);
    let remaining = weekData.totalMin - basic;
    
    // OT 1.5 for hours 40-50 (600 minutes)
    let ot15 = Math.min(remaining, 10 * 60);
    remaining -= ot15;
    
    // OT 2.0 for hours 50+
    let ot20 = remaining;
    
    adjustedWeeklyTotals.set(weekKey, { basic, ot15, ot20, total: weekData.totalMin });
  });

  // Overall totals
  let totalBasic = 0;
  let totalOT15 = 0;
  let totalOT20 = 0;
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
    .sort((a, b) => {
      const numA = parseInt(a[0]);
      const numB = parseInt(b[0]);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a[0].localeCompare(b[0]);
    })
    .forEach(([weekKey, t]) => {
      weeklyLines.push(
        `${weekKey}\n` +
          `  Basic:  ${formatMinutesAsHM(t.basic)}\n` +
          `  OT 1.5: ${formatMinutesAsHM(t.ot15)}\n` +
          `  OT 2.0: ${formatMinutesAsHM(t.ot20)}\n` +
          `  Total:  ${formatMinutesAsHM(t.total)}\n`
      );
    });

  weeklyTotalsEl.textContent =
    weeklyLines.length ? weeklyLines.join("\n") : "No weekly data.";

  if (hasErrors) {
    issuesOutputEl.textContent = "⚠️ Errors detected. See highlighted cells above.";
    issuesOutputEl.classList.add("error");
    issuesOutputEl.classList.remove("ok");
  } else {
    issuesOutputEl.textContent = "✓ No issues detected. Ready to submit.";
    issuesOutputEl.classList.remove("error");
    issuesOutputEl.classList.add("ok");
  }
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
    "WorkedHours",
    "Notes"
  ];
  const lines = [header.join(",")];

  rows.forEach((row) => {
    // Calculate worked hours for display
    const workedMin = calculateWorkedHours(row.start, row.finish, row.break);
    const workedHours = workedMin !== null ? formatMinutesAsHM(workedMin) : "N/A";
    
    const values = [
      row.date || "",
      row.day || "",
      row.week || "",
      row.start || "",
      row.finish || "",
      row.break || "",
      workedHours,
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
async function submitTimesheet() {
  if (!currentUser) {
    showBannerError("Please log in before submitting.");
    return;
  }
  
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
  
  if (allWeekRows.length > 0 && currentWeekIndex >= 0 && currentWeekIndex < allWeekRows.length) {
    allWeekRows[currentWeekIndex] = getRowsFromTable();
  }
  
  const rows = allWeekRows.flat();
  if (!rows.length) {
    showBannerError("No timesheet rows to submit.");
    return;
  }
  
  const csv = rowsToCsv(rows);
  
  hideBanner();
  
  try {
    const response = await fetch('/api/timesheets/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        employeeName: name,
        startDate,
        endDate,
        timesheetCsv: csv
      })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      alert(`Timesheet submitted successfully! ID: ${data.timesheetId}`);
      clearAutoSave();
    } else {
      showBannerError(data.error || 'Submission failed');
    }
  } catch (error) {
    console.error('Submission error:', error);
    showBannerError('Network error. Please try again.');
  }
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

    const hasAnyTime = !!start || !!finish;
    if (!hasAnyTime) continue;

    rows.push({
      date,
      day: "",
      week: weekLabel,
      start,
      finish,
      break: lunch,
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
        
        // Organize rows by week
        const weekMap = new Map();
        rows.forEach(row => {
          const weekKey = row.week && row.week.trim() ? row.week.trim() : "1";
          if (!weekMap.has(weekKey)) {
            weekMap.set(weekKey, []);
          }
          weekMap.get(weekKey).push(row);
        });
        
        allWeekRows = Array.from(weekMap.entries())
          .sort((a, b) => {
            const numA = parseInt(a[0]);
            const numB = parseInt(b[0]);
            if (!isNaN(numA) && !isNaN(numB)) {
              return numA - numB;
            }
            return a[0].localeCompare(b[0]);
          })
          .map(([weekKey, rows]) => rows);
        
        currentWeekIndex = 0;
        displayCurrentWeek();
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
  // If no weeks exist, create the first week
  if (allWeekRows.length === 0) {
    allWeekRows = [[]];
    currentWeekIndex = 0;
  }
  
  createRow();
  renumberRows();
  updateWeekIndicator();
});

clearRowsBtn.addEventListener("click", () => {
  if (
    allWeekRows.flat().length &&
    !confirm("Clear all rows from all weeks?")
  ) {
    return;
  }
  tbody.innerHTML = "";
  allWeekRows = [];
  currentWeekIndex = 0;
  updateWeekIndicator();
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

// Week navigation buttons
prevWeekBtn.addEventListener("click", () => switchToWeek(-1));
nextWeekBtn.addEventListener("click", () => switchToWeek(1));

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

  // Generate all rows first
  const allRows = [];
  let currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    const weekNumber = Math.floor((currentDate - firstMonday) / MS_PER_DAY / 7) + 1;
    const dd = String(currentDate.getDate()).padStart(2, "0");
    const mm = String(currentDate.getMonth() + 1).padStart(2, "0");
    const yyyy = currentDate.getFullYear();
    const dateStr = `${dd}/${mm}/${yyyy}`;
    const dayStr = dayNames[currentDate.getDay()];
    
    allRows.push({
      date: dateStr,
      day: dayStr,
      week: String(weekNumber),
      start: "",
      finish: "",
      break: "0:00",
      notes: ""
    });
    
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  // Organize into weeks
  const weekMap = new Map();
  allRows.forEach(row => {
    const weekKey = row.week;
    if (!weekMap.has(weekKey)) {
      weekMap.set(weekKey, []);
    }
    weekMap.get(weekKey).push(row);
  });
  
  allWeekRows = Array.from(weekMap.entries())
    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
    .map(([weekKey, rows]) => rows);
  
  currentWeekIndex = 0;
  displayCurrentWeek();
  hideBanner();
}

rangeStartInput.addEventListener("change", generateRowsFromDateRange);
rangeEndInput.addEventListener("change", generateRowsFromDateRange);

// Initialise with a few empty rows (if no dates set)
if (!rangeStartInput.value && !rangeEndInput.value) {
  const initialRows = [];
  for (let i = 0; i < 5; i++) {
    initialRows.push({
      date: "", day: "", week: "1",
      start: "", finish: "", break: "0:00", notes: ""
    });
  }
  allWeekRows = [initialRows];
  currentWeekIndex = 0;
  displayCurrentWeek();
}

// ===== Authentication Functions =====

async function checkAuthStatus() {
  try {
    const response = await fetch('/api/auth/status', {
      credentials: 'include'
    });
    const data = await response.json();
    
    if (data.authenticated) {
      currentUser = data.user;
      showAuthenticatedState();
    } else {
      showUnauthenticatedState();
    }
  } catch (error) {
    console.error('Auth check failed:', error);
    showUnauthenticatedState();
  }
}

function showAuthenticatedState() {
  authModal.classList.add('hidden');
  userInfo.style.display = 'flex';
  usernameDisplay.textContent = `Welcome, ${currentUser.username}`;
  if (currentUser.fullName) {
    employeeNameInput.value = currentUser.fullName;
  }
  // Update admin UI
  updateAuthUI(currentUser);
  // Show/hide sections based on role
  const mainSections = document.querySelectorAll('.app-main .card');
  if (currentUser.role === 'admin') {
    // Hide all timesheet sections for admin users
    mainSections.forEach(section => section.style.display = 'none');
  } else {
    // Show all sections for regular users
    mainSections.forEach(section => section.style.display = 'block');
  }
}

function showUnauthenticatedState() {
  authModal.classList.remove('hidden');
  userInfo.style.display = 'none';
  currentUser = null;
}

function toggleAuthMode() {
  isLoginMode = !isLoginMode;
  if (isLoginMode) {
    authTitle.textContent = 'Login';
    authSubmitBtn.textContent = 'Login';
    authToggleBtn.textContent = 'Need an account? Register';
    emailGroup.style.display = 'none';
    fullnameGroup.style.display = 'none';
    authEmail.required = false;
  } else {
    authTitle.textContent = 'Register';
    authSubmitBtn.textContent = 'Register';
    authToggleBtn.textContent = 'Already have an account? Login';
    emailGroup.style.display = 'block';
    fullnameGroup.style.display = 'block';
    authEmail.required = true;
  }
  authError.textContent = '';
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  authError.textContent = '';
  
  const username = authUsername.value.trim();
  const password = authPassword.value;
  
  if (!username || !password) {
    authError.textContent = 'Please fill in all required fields';
    return;
  }
  
  try {
    const endpoint = isLoginMode ? '/api/login' : '/api/register';
    const body = isLoginMode 
      ? { username, password }
      : { 
          username, 
          email: authEmail.value.trim(), 
          password, 
          fullName: authFullname.value.trim() 
        };
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body)
    });
    
    const data = await response.json();
    
    if (response.ok) {
      currentUser = data.user;
      showAuthenticatedState();
      authForm.reset();
    } else {
      authError.textContent = data.error || 'Authentication failed';
    }
  } catch (error) {
    console.error('Auth error:', error);
    authError.textContent = 'Network error. Please try again.';
  }
}

async function handleLogout() {
  try {
    await fetch('/api/logout', {
      method: 'POST',
      credentials: 'include'
    });
    showUnauthenticatedState();
    authForm.reset();
  } catch (error) {
    console.error('Logout error:', error);
  }
}

// ===== CSV Download =====

function downloadCSV() {
  if (allWeekRows.length > 0 && currentWeekIndex >= 0 && currentWeekIndex < allWeekRows.length) {
    allWeekRows[currentWeekIndex] = getRowsFromTable();
  }
  
  const rows = allWeekRows.flat();
  if (!rows.length) {
    showBannerError("No timesheet rows to download.");
    return;
  }
  
  const csv = rowsToCsv(rows);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const name = employeeNameInput.value.trim() || 'timesheet';
  const start = rangeStartInput.value || 'no-date';
  const end = rangeEndInput.value || 'no-date';
  a.download = `${name}_${start}_to_${end}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ===== Auth Event Listeners =====
authForm.addEventListener('submit', handleAuthSubmit);
authToggleBtn.addEventListener('click', toggleAuthMode);
logoutBtn.addEventListener('click', handleLogout);

// ===== Download CSV Event Listener =====
downloadCsvBtn.addEventListener('click', downloadCSV);

// ===== Check auth on page load =====
checkAuthStatus();

// ===== Load auto-save on page load =====
loadAutoSave();

// ===== Auto-save on input changes =====
employeeNameInput.addEventListener('input', autoSave);
rangeStartInput.addEventListener('change', autoSave);
rangeEndInput.addEventListener('change', autoSave);
// ===== ADMIN FUNCTIONS =====

let currentAdminUser = null;

const adminPanel = document.getElementById('admin-panel');
const adminToggleBtn = document.getElementById('admin-toggle-btn');
const adminCloseBtn = document.getElementById('admin-close-btn');
const adminTabs = document.querySelectorAll('.admin-tab-btn');
const createUserBtn = document.getElementById('create-user-btn');
const userForm = document.getElementById('user-form');
const userFormContainer = document.getElementById('user-form-container');
const userCancelBtn = document.getElementById('user-cancel-btn');

// Toggle admin panel visibility
function toggleAdminPanel() {
  adminPanel.classList.toggle('hidden');
  if (!adminPanel.classList.contains('hidden')) {
    loadAdminDashboard();
  }
}

// Close admin panel
adminCloseBtn.addEventListener('click', () => {
  adminPanel.classList.add('hidden');
});

// Admin tab switching
adminTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;
    
    // Remove active class from all tabs and contents
    adminTabs.forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.admin-tab-content').forEach(content => {
      content.classList.add('hidden');
      content.classList.remove('active');
    });
    
    // Add active class to clicked tab and corresponding content
    tab.classList.add('active');
    const tabContent = document.getElementById(`${tabName}-tab`);
    if (tabContent) {
      tabContent.classList.remove('hidden');
      tabContent.classList.add('active');
    }
    
    // Load data for specific tab
    if (tabName === 'users') {
      loadAdminUsers();
    } else if (tabName === 'timesheets') {
      loadAdminTimesheets();
    }
  });
});

// Load admin dashboard
async function loadAdminDashboard() {
  try {
    const response = await fetch('/api/admin/stats');
    if (!response.ok) throw new Error('Failed to load stats');
    
    const data = await response.json();
    const { stats, recentTimesheets } = data;
    
    // Update stats
    document.getElementById('stat-total-users').textContent = stats.totalUsers;
    document.getElementById('stat-total-timesheets').textContent = stats.totalTimesheets;
    document.getElementById('stat-submitted-30').textContent = stats.submittedLast30Days;
    
    // Update recent timesheets table
    const tbody = document.getElementById('recent-timesheets-body');
    tbody.innerHTML = '';
    
    if (recentTimesheets.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4">No recent timesheets</td></tr>';
    } else {
      recentTimesheets.forEach(ts => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${ts.employee_name || 'N/A'}</td>
          <td>${ts.start_date || ''} to ${ts.end_date || ''}</td>
          <td>${new Date(ts.submitted_at).toLocaleDateString()}</td>
          <td>${ts.username}</td>
        `;
        tbody.appendChild(row);
      });
    }
  } catch (error) {
    console.error('Error loading dashboard:', error);
    // Only show error in admin panel, not in main validation section
    if (currentUser && currentUser.role === 'admin') {
      alert('Failed to load admin dashboard: ' + error.message);
    }
  }
}

// Load users for admin panel
async function loadAdminUsers() {
  try {
    const response = await fetch('/api/admin/users');
    if (!response.ok) throw new Error('Failed to load users');
    
    const data = await response.json();
    const users = data.users;
    
    const tbody = document.getElementById('users-body');
    tbody.innerHTML = '';
    
    if (users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6">No users found</td></tr>';
    } else {
      users.forEach(user => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${user.username}</td>
          <td>${user.email || 'N/A'}</td>
          <td>${user.full_name || 'N/A'}</td>
          <td><span class="role-badge" style="background: ${user.role === 'admin' ? '#658C6E' : '#85A898'}; color: white; padding: 0.2rem 0.5rem; border-radius: 0.3rem; font-size: 0.8rem;">${user.role}</span></td>
          <td>${new Date(user.created_at).toLocaleDateString()}</td>
          <td>
            <div class="action-buttons">
              <button class="edit-btn" onclick="editUser(${user.id})">Edit</button>
              <button class="delete-btn" onclick="deleteUser(${user.id}, '${user.username}')">Delete</button>
            </div>
          </td>
        `;
        tbody.appendChild(row);
      });
    }
  } catch (error) {
    console.error('Error loading users:', error);
    // Only show error in admin panel, not in main validation section
    if (currentUser && currentUser.role === 'admin') {
      alert('Failed to load users: ' + error.message);
    }
  }
}

// Load timesheets for admin panel
async function loadAdminTimesheets() {
  try {
    const response = await fetch('/api/admin/timesheets');
    if (!response.ok) throw new Error('Failed to load timesheets');
    
    const data = await response.json();
    const timesheets = data.timesheets;
    
    const tbody = document.getElementById('all-timesheets-body');
    tbody.innerHTML = '';
    
    if (timesheets.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6">No timesheets found</td></tr>';
    } else {
      timesheets.forEach(ts => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${ts.employee_name || 'N/A'}</td>
          <td>${ts.username}</td>
          <td>${ts.start_date || ''}</td>
          <td>${ts.end_date || ''}</td>
          <td>${new Date(ts.submitted_at).toLocaleDateString()}</td>
          <td><button class="edit-btn" onclick="viewTimesheet(${ts.id})">View</button></td>
        `;
        tbody.appendChild(row);
      });
    }
  } catch (error) {
    console.error('Error loading timesheets:', error);
    // Only show error in admin panel, not in main validation section
    if (currentUser && currentUser.role === 'admin') {
      alert('Failed to load timesheets: ' + error.message);
    }
  }
}

// Show/hide create user form
createUserBtn.addEventListener('click', () => {
  userFormContainer.classList.toggle('hidden');
  document.getElementById('user-form-title').textContent = 'Create New User';
  userForm.reset();
  userForm.dataset.userId = '';
  document.getElementById('user-submit-btn').textContent = 'Create';
});

// Cancel user form
userCancelBtn.addEventListener('click', () => {
  userFormContainer.classList.add('hidden');
  userForm.reset();
});

// Handle user form submission
userForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const username = document.getElementById('user-username').value.trim();
  const email = document.getElementById('user-email').value.trim();
  const password = document.getElementById('user-password').value.trim();
  const fullName = document.getElementById('user-fullname').value.trim();
  const role = document.getElementById('user-role').value;
  
  if (!username || !email || !password) {
    alert('Please fill in all required fields');
    return;
  }
  
  const userId = userForm.dataset.userId;
  const method = userId ? 'PUT' : 'POST';
  const url = userId ? `/api/admin/users/${userId}` : '/api/admin/users';
  
  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password, fullName, role })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to save user');
    }
    
    userFormContainer.classList.add('hidden');
    userForm.reset();
    loadAdminUsers();
    alert('User saved successfully');
  } catch (error) {
    console.error('Error saving user:', error);
    alert(error.message || 'Failed to save user');
  }
});

// Edit user
async function editUser(userId) {
  try {
    const response = await fetch(`/api/admin/users/${userId}`);
    if (!response.ok) throw new Error('Failed to load user');
    
    const data = await response.json();
    const user = data.user;
    
    document.getElementById('user-username').value = user.username;
    document.getElementById('user-email').value = user.email || '';
    document.getElementById('user-fullname').value = user.full_name || '';
    document.getElementById('user-role').value = user.role;
    document.getElementById('user-password').value = '';
    document.getElementById('user-password').placeholder = 'Leave blank to keep current password';
    
    document.getElementById('user-form-title').textContent = 'Edit User';
    document.getElementById('user-submit-btn').textContent = 'Update';
    userForm.dataset.userId = userId;
    userFormContainer.classList.remove('hidden');
  } catch (error) {
    console.error('Error loading user:', error);
    alert('Failed to load user details: ' + error.message);
  }
}

// Delete user
async function deleteUser(userId, username) {
  if (!confirm(`Are you sure you want to delete user "${username}"? This cannot be undone.`)) {
    return;
  }
  
  try {
    const response = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete user');
    }
    
    loadAdminUsers();
    alert('User deleted successfully');
  } catch (error) {
    console.error('Error deleting user:', error);
    alert(error.message || 'Failed to delete user');
  }
}

// View timesheet details
function viewTimesheet(timesheetId) {
  alert(`View timesheet details for ID: ${timesheetId} (feature to be implemented)`);
}

// Update auth flow to show admin panel for admin users
function updateAuthUI(user) {
  currentAdminUser = user;
  usernameDisplay.textContent = `${user.fullName || user.username}`;
  userInfo.style.display = 'flex';
  
  // Show/hide admin toggle button
  if (user.role === 'admin') {
    adminToggleBtn.style.display = 'inline-block';
    // Auto-open admin panel for admin users
    adminPanel.classList.remove('hidden');
    loadAdminDashboard();
  } else {
    adminToggleBtn.style.display = 'none';
    adminPanel.classList.add('hidden');
  }
}

// Add admin button event listener
adminToggleBtn.addEventListener('click', toggleAdminPanel);