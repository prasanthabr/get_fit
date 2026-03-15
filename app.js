// --- Config ---

const CONFIG_SHEET_ID = '1V5jV8JJCa1xIS0cz2atRZOHz1eI_Z9tDfTDWyEX438g'; // ← replace with your master config sheet ID

function sheetUrl(sheetId, tab) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${tab}`;
}

let people = [];
let activePerson = null;
let currentRange = 'all';

// --- CSV ---

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 1) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === ',' && !inQuotes) { values.push(current.trim()); current = ''; }
      else { current += ch; }
    }
    values.push(current.trim());
    const obj = {};
    headers.forEach((h, i) => { obj[h] = values[i] || ''; });
    return obj;
  });
}

async function loadCSV(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    return parseCSV(await res.text());
  } catch (e) {
    return [];
  }
}

// --- Filtering ---

function filterByRange(data, dateField, range) {
  if (range === 'all') return data;
  const days = { '7d': 7, '30d': 30, '90d': 90 }[range] || 9999;
  const cutoff = new Date(Date.now() - days * 86400000);
  return data.filter(d => new Date(d[dateField]) >= cutoff);
}

// --- Master config ---

async function loadMasterConfig() {
  const rows = await loadCSV(sheetUrl(CONFIG_SHEET_ID, 'cfg'));
  return rows.map(r => ({
    key:   r.key,
    label: r.label,
    sid:   r.sid,
    gw:    parseFloat(r.gw),
    gwc:   parseFloat(r.gwc),
    gp:    parseFloat(r.gp),
  }));
}

// --- Person switcher ---

function renderPersonSwitcher(people) {
  const div = document.getElementById('person-switcher');
  div.innerHTML = people.map((p, i) =>
    `<button data-key="${p.key}" class="${i === 0 ? 'active' : ''}">${p.label}</button>`
  ).join('');
  div.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      div.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activePerson = btn.dataset.key;
      loadAll();
    });
  });
}

// --- Chart helpers ---

const charts = {};

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

function rollingAverage(values, window) {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

const GRID   = '#1e1e1e';
const TICK   = '#555';
const MUTED  = '#666';
const RED    = '#e94560';
const BLUE   = '#4a9eff';
const GREEN  = '#4caf82';
const YELLOW = '#f0c040';

function baseOptions(extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    plugins: {
      legend: { labels: { color: MUTED, font: { size: 11 }, boxWidth: 12 } },
      ...(extra.plugins || {}),
    },
    scales: {
      x: { ticks: { color: TICK, maxTicksLimit: 10, font: { size: 10 } }, grid: { color: GRID } },
      y: { ticks: { color: TICK, font: { size: 10 } }, grid: { color: GRID } },
      ...(extra.scales || {}),
    },
  };
}

// --- Stats ---

function renderStats(weightData, person) {
  const container = document.getElementById('stats');
  if (!weightData.length) { container.innerHTML = ''; return; }

  const sorted  = [...weightData].sort((a, b) => a.date.localeCompare(b.date));
  const start   = parseFloat(sorted[0].wt);
  const current = parseFloat(sorted[sorted.length - 1].wt);
  const lost    = start - current;
  const toGo    = current - person.gw;
  const pct     = Math.max(0, (start - current) / (start - person.gw) * 100);

  let eta = '—';
  if (sorted.length >= 3 && lost > 0) {
    const daysSoFar = (new Date(sorted[sorted.length - 1].date) - new Date(sorted[0].date)) / 86400000;
    if (daysSoFar > 0) {
      const daysLeft = toGo / (lost / daysSoFar);
      eta = new Date(Date.now() + daysLeft * 86400000)
        .toLocaleDateString('en-NZ', { month: 'short', year: 'numeric' });
    }
  }

  container.innerHTML = `
    <div class="stat-card"><div class="value highlight">${current.toFixed(1)}</div><div class="label">now</div></div>
    <div class="stat-card"><div class="value">${lost >= 0 ? '-' : '+'}${Math.abs(lost).toFixed(1)}</div><div class="label">Δ</div></div>
    <div class="stat-card"><div class="value">${toGo.toFixed(1)}</div><div class="label">left</div></div>
    <div class="stat-card"><div class="value">${pct.toFixed(0)}%</div><div class="label">done</div></div>
    <div class="stat-card"><div class="value">${eta}</div><div class="label">eta</div></div>
  `;
}

// --- Weight ---

function renderWeightChart(data, person) {
  const canvas = document.getElementById('weightChart');
  destroyChart('weight');
  if (!data.length) { canvas.parentElement.innerHTML = '<div class="no-data">—</div>'; return; }

  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const labels = sorted.map(d => d.date);
  const values = sorted.map(d => parseFloat(d.wt));

  charts.weight = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'daily',  data: values, borderColor: RED,  backgroundColor: 'rgba(233,69,96,0.08)', borderWidth: 1.5, pointRadius: 2, tension: 0.1 },
        { label: '7d avg', data: rollingAverage(values, 7), borderColor: BLUE, borderWidth: 2, pointRadius: 0, tension: 0.3 },
        { label: 'target', data: values.map(() => person.gw), borderColor: '#333', borderWidth: 1, borderDash: [4, 4], pointRadius: 0 },
      ],
    },
    options: baseOptions(),
  });
}

// --- Waist ---

function renderWaistChart(data, person) {
  const canvas = document.getElementById('waistChart');
  destroyChart('waist');
  const rows = data.filter(d => d.wc && d.wc !== '').sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) { canvas.parentElement.innerHTML = '<div class="no-data">—</div>'; return; }

  const labels = rows.map(d => d.date);
  const values = rows.map(d => parseFloat(d.wc));

  charts.waist = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'wc',     data: values, borderColor: YELLOW, backgroundColor: 'rgba(240,192,64,0.08)', borderWidth: 2, pointRadius: 3, tension: 0.2 },
        { label: 'target', data: values.map(() => person.gwc), borderColor: '#333', borderWidth: 1, borderDash: [4, 4], pointRadius: 0 },
      ],
    },
    options: baseOptions(),
  });
}

// --- Protein ---

function renderProteinChart(data, person) {
  const canvas = document.getElementById('proteinChart');
  destroyChart('protein');
  if (!data.length) { canvas.parentElement.innerHTML = '<div class="no-data">—</div>'; return; }

  const byDate = {};
  data.forEach(row => {
    if (!byDate[row.date]) byDate[row.date] = 0;
    byDate[row.date] += parseFloat(row.pr) || 0;
  });

  const dates  = Object.keys(byDate).sort();
  const values = dates.map(d => byDate[d]);

  charts.protein = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: dates,
      datasets: [
        { label: 'p', data: values, backgroundColor: values.map(v => v >= person.gp ? 'rgba(74,158,255,0.7)' : 'rgba(233,69,96,0.5)'), borderRadius: 3 },
        { label: 'target', data: values.map(() => person.gp), type: 'line', borderColor: BLUE, borderWidth: 1.5, borderDash: [4, 4], pointRadius: 0 },
      ],
    },
    options: baseOptions({ scales: { y: { ticks: { color: TICK }, grid: { color: GRID }, beginAtZero: true } } }),
  });
}

// --- Water ---

function renderWaterChart(data) {
  const canvas = document.getElementById('waterChart');
  destroyChart('water');
  if (!data.length) { canvas.parentElement.innerHTML = '<div class="no-data">—</div>'; return; }

  const byDate = {};
  data.forEach(row => {
    if (!byDate[row.date]) byDate[row.date] = 0;
    byDate[row.date] += parseFloat(row.h2o) || 0;
  });

  const dates  = Object.keys(byDate).sort();
  const values = dates.map(d => byDate[d]);
  const target = 2500;

  charts.water = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: dates,
      datasets: [
        { label: 'h2o', data: values, backgroundColor: values.map(v => v >= target ? 'rgba(76,175,130,0.7)' : 'rgba(233,69,96,0.5)'), borderRadius: 3 },
        { label: 'target', data: values.map(() => target), type: 'line', borderColor: GREEN, borderWidth: 1.5, borderDash: [4, 4], pointRadius: 0 },
      ],
    },
    options: baseOptions({ scales: { y: { ticks: { color: TICK }, grid: { color: GRID }, beginAtZero: true } } }),
  });
}

// --- BP ---

function renderBPChart(data) {
  const canvas = document.getElementById('bpChart');
  destroyChart('bp');
  const rows = data.filter(d => d.sys && d.sys !== '').sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) { canvas.parentElement.innerHTML = '<div class="no-data">—</div>'; return; }

  const labels = rows.map(d => d.date);
  const sys    = rows.map(d => parseFloat(d.sys));
  const dia    = rows.map(d => parseFloat(d.dia));

  charts.bp = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'sys', data: sys, borderColor: RED,    backgroundColor: 'rgba(233,69,96,0.08)',  borderWidth: 2, pointRadius: 3, tension: 0.2 },
        { label: 'dia', data: dia, borderColor: YELLOW, backgroundColor: 'rgba(240,192,64,0.08)', borderWidth: 2, pointRadius: 3, tension: 0.2 },
        { label: 'sys ok', data: sys.map(() => 120), borderColor: 'rgba(233,69,96,0.25)',  borderWidth: 1, borderDash: [4, 4], pointRadius: 0 },
        { label: 'dia ok', data: dia.map(() => 80),  borderColor: 'rgba(240,192,64,0.25)', borderWidth: 1, borderDash: [4, 4], pointRadius: 0 },
      ],
    },
    options: baseOptions(),
  });
}

// --- Cholesterol ---

function renderCholesterolChart(data) {
  const canvas = document.getElementById('cholChart');
  destroyChart('chol');
  const rows = data.filter(d => d.hdl && d.hdl !== '').sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) { canvas.parentElement.innerHTML = '<div class="no-data">—</div>'; return; }

  const labels = rows.map(d => d.date);
  const hdl    = rows.map(d => parseFloat(d.hdl));
  const ldl    = rows.map(d => parseFloat(d.ldl));

  charts.chol = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'hdl', data: hdl, borderColor: GREEN, backgroundColor: 'rgba(76,175,130,0.08)', borderWidth: 2, pointRadius: 3, tension: 0.2 },
        { label: 'ldl', data: ldl, borderColor: RED,   backgroundColor: 'rgba(233,69,96,0.08)',  borderWidth: 2, pointRadius: 3, tension: 0.2 },
        { label: 'hdl target', data: hdl.map(() => 1.0), borderColor: 'rgba(76,175,130,0.3)',  borderWidth: 1, borderDash: [4, 4], pointRadius: 0 },
        { label: 'ldl target', data: ldl.map(() => 2.6), borderColor: 'rgba(233,69,96,0.3)', borderWidth: 1, borderDash: [4, 4], pointRadius: 0 },
      ],
    },
    options: baseOptions(),
  });
}

// --- Gout ---

function renderGoutChart(data) {
  const canvas = document.getElementById('goutChart');
  destroyChart('gout');
  const rows = [...data].sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) { canvas.parentElement.innerHTML = '<div class="no-data">—</div>'; return; }

  const labels   = rows.map(d => d.date);
  const severity = rows.map(d => parseFloat(d.severity) || 0);

  charts.gout = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'severity',
        data: severity,
        backgroundColor: severity.map(v => v >= 7 ? 'rgba(233,69,96,0.85)' : v >= 4 ? 'rgba(240,192,64,0.75)' : 'rgba(74,158,255,0.65)'),
        borderRadius: 3,
      }],
    },
    options: baseOptions({ scales: { y: { ticks: { color: TICK, stepSize: 1 }, grid: { color: GRID }, beginAtZero: true, max: 10 } } }),
  });
}

// --- Exercise ---

function renderExerciseChart(data) {
  const canvas = document.getElementById('exerciseChart');
  destroyChart('exercise');
  if (!data.length) { canvas.parentElement.innerHTML = '<div class="no-data">—</div>'; return; }

  const byWeek = {};
  data.forEach(row => {
    const d    = new Date(row.date);
    const day  = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const key  = new Date(new Date(row.date).setDate(diff)).toISOString().slice(0, 10);
    if (!byWeek[key]) byWeek[key] = { ss: 0, other: 0 };
    if (row.type && row.type.toLowerCase().includes('s&s')) byWeek[key].ss++;
    else if (row.type && row.type.toLowerCase() !== 'rest') byWeek[key].other++;
  });

  const weeks  = Object.keys(byWeek).sort();
  const labels = weeks.map(w => new Date(w).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' }));

  charts.exercise = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'a1', data: weeks.map(w => byWeek[w].ss),    backgroundColor: 'rgba(233,69,96,0.7)',  borderRadius: 3 },
        { label: 'a2', data: weeks.map(w => byWeek[w].other), backgroundColor: 'rgba(74,158,255,0.6)', borderRadius: 3 },
      ],
    },
    options: baseOptions({
      scales: {
        x: { stacked: true, ticks: { color: TICK }, grid: { color: GRID } },
        y: { stacked: true, ticks: { color: TICK, stepSize: 1 }, grid: { color: GRID }, beginAtZero: true },
      },
    }),
  });
}

// --- Load ---

async function loadAll() {
  const person = people.find(p => p.key === activePerson);

  const [wRaw, fRaw, xRaw, vRaw, gRaw] = await Promise.all([
    loadCSV(sheetUrl(person.sid, 'w')),
    loadCSV(sheetUrl(person.sid, 'f')),
    loadCSV(sheetUrl(person.sid, 'x')),
    loadCSV(sheetUrl(person.sid, 'v')),
    loadCSV(sheetUrl(person.sid, 'g')),
  ]);

  const w = filterByRange(wRaw, 'date', currentRange);
  const f = filterByRange(fRaw, 'date', currentRange);
  const x = filterByRange(xRaw, 'date', currentRange);
  const v = filterByRange(vRaw, 'date', currentRange);
  const g = filterByRange(gRaw, 'date', currentRange);

  renderStats(wRaw, person);
  renderWeightChart(w, person);
  renderWaistChart(w, person);
  renderProteinChart(f, person);
  renderWaterChart(f);
  renderBPChart(v);
  renderCholesterolChart(v);
  renderGoutChart(g);
  renderExerciseChart(x);
}

// --- Init ---

function bindFilters() {
  document.querySelectorAll('.filters button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filters button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRange = btn.dataset.range;
      loadAll();
    });
  });
}

async function init() {
  people = await loadMasterConfig();
  if (!people.length) {
    document.getElementById('app').innerHTML = '<p class="no-data">config not found</p>';
    return;
  }
  activePerson = people[0].key;
  renderPersonSwitcher(people);
  bindFilters();
  loadAll();
}

document.addEventListener('DOMContentLoaded', init);
