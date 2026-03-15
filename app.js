// --- Config ---

const CONFIG_SHEET_ID = '1V5jV8JJCa1xIS0cz2atRZOHz1eI_Z9tDfTDWyEX438g';

function sheetUrl(sheetId, tab) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${tab}`;
}

let people = [];
let activePerson = null;
let currentRange = 'all';

// --- Chart.js global defaults ---

Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
Chart.defaults.font.size = 11;
Chart.defaults.color = '#555';
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.pointStyleWidth = 7;
Chart.defaults.plugins.legend.labels.boxHeight = 7;
Chart.defaults.plugins.tooltip.backgroundColor = '#18191c';
Chart.defaults.plugins.tooltip.borderColor = '#2a2b2e';
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.padding = 10;
Chart.defaults.plugins.tooltip.titleColor = '#dcdcdc';
Chart.defaults.plugins.tooltip.bodyColor = '#888';
Chart.defaults.plugins.tooltip.titleFont = { size: 11, weight: '500' };
Chart.defaults.plugins.tooltip.bodyFont = { size: 11 };
Chart.defaults.plugins.tooltip.displayColors = true;
Chart.defaults.plugins.tooltip.colorDecorators = false;

// --- Palette ---

const C = {
  bg:      '#0a0a0a',
  surface: '#111214',
  grid:    '#1c1d20',
  tick:    '#444',
  muted:   '#555',
  red:     '#e94560',
  blue:    '#4a9eff',
  green:   '#3ecf8e',
  yellow:  '#f5c842',
};

// --- Gradient helper ---

function gradient(canvas, hex, opacityTop = 0.18, opacityBot = 0) {
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, canvas.offsetHeight || 240);
  g.addColorStop(0, hex + Math.round(opacityTop * 255).toString(16).padStart(2, '0'));
  g.addColorStop(1, hex + Math.round(opacityBot * 255).toString(16).padStart(2, '0'));
  return g;
}

// --- Shared scale config ---

function scales(overrides = {}) {
  return {
    x: {
      ticks: { color: C.tick, maxTicksLimit: window.innerWidth < 500 ? 5 : 8, font: { size: 10 } },
      grid: { color: C.grid },
      border: { color: 'transparent' },
    },
    y: {
      ticks: { color: C.tick, font: { size: 10 } },
      grid: { color: C.grid },
      border: { color: 'transparent' },
    },
    ...overrides,
  };
}

function baseOpts(overrides = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 400, easing: 'easeOutQuart' },
    plugins: {
      legend: {
        labels: { color: C.muted, font: { size: 10 }, padding: 14 },
        ...(overrides.legend || {}),
      },
      ...(overrides.plugins || {}),
    },
    scales: scales(overrides.scales || {}),
    layout: { padding: { top: 4, right: 4 } },
  };
}

// --- CSV ---

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 1) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
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
  } catch { return []; }
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

// --- Charts ---

const charts = {};

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

function rollingAverage(values, w) {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - w + 1), i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

function empty(canvasId) {
  const canvas = document.getElementById(canvasId);
  canvas.parentElement.innerHTML = '<div class="no-data">—</div>';
}

// --- Milestones ---

const MILESTONES = [
  { pct: 5,   emoji: '🌱', label: '5%',   desc: 'first steps' },
  { pct: 10,  emoji: '🔥', label: '10%',  desc: 'blood sugar improving' },
  { pct: 25,  emoji: '💪', label: '25%',  desc: 'a quarter done' },
  { pct: 50,  emoji: '⚡', label: '50%',  desc: 'halfway' },
  { pct: 75,  emoji: '🎯', label: '75%',  desc: 'nearly there' },
  { pct: 100, emoji: '🏆', label: 'goal', desc: 'done!' },
];

const MOTIVATION = [
  { min: 0,   max: 5,   msg: (kg) => `${kg.toFixed(1)} kg down. Every day adds up — keep logging.` },
  { min: 5,   max: 10,  msg: () => `🌱 5% done. Momentum is building.` },
  { min: 10,  max: 25,  msg: () => `🔥 10% down. Your insulin sensitivity is already improving.` },
  { min: 25,  max: 50,  msg: () => `💪 A quarter of the way there. You're doing this.` },
  { min: 50,  max: 75,  msg: () => `⚡ Halfway. This is remarkable.` },
  { min: 75,  max: 100, msg: () => `🎯 Three quarters done. The finish line is in sight.` },
  { min: 100, max: Infinity, msg: () => `🏆 Goal weight reached. Incredible work.` },
];

function calcStreak(weightData) {
  if (!weightData.length) return 0;
  const dates = [...new Set(weightData.map(d => d.date))].sort().reverse();
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let expected = today;

  for (const ds of dates) {
    const d = new Date(ds);
    d.setHours(0, 0, 0, 0);
    const diff = Math.round((expected - d) / 86400000);
    if (diff <= 1) {
      streak++;
      expected = new Date(d);
      expected.setDate(expected.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function renderMilestones(pct) {
  const strip = document.getElementById('milestones');
  let nextFound = false;

  strip.innerHTML = MILESTONES.map(m => {
    const earned = pct >= m.pct;
    const isNext = !earned && !nextFound;
    if (isNext) nextFound = true;
    const cls = earned ? 'earned' : isNext ? 'next' : 'locked';
    return `
      <div class="milestone ${cls}">
        <span class="ms-emoji">${m.emoji}</span>
        <span class="ms-label">${m.label}</span>
        <span class="ms-sub">${earned ? '✓' : isNext ? '← next' : m.desc}</span>
      </div>`;
  }).join('');
}

// --- Stats ---

function renderStats(weightData, person) {
  const container    = document.getElementById('stats');
  const progressFill = document.getElementById('progress-fill');
  const motivEl      = document.getElementById('motivation');

  if (!weightData.length) {
    container.innerHTML = '';
    motivEl.textContent = '';
    progressFill.style.width = '0%';
    renderMilestones(0);
    return;
  }

  const sorted  = [...weightData].sort((a, b) => a.date.localeCompare(b.date));
  const start   = parseFloat(sorted[0].wt);
  const current = parseFloat(sorted[sorted.length - 1].wt);
  const lost    = start - current;
  const toGo    = current - person.gw;
  const pct     = Math.max(0, Math.min(100, (start - current) / (start - person.gw) * 100));
  const streak  = calcStreak(weightData);

  let eta = '—';
  if (sorted.length >= 3 && lost > 0) {
    const span = (new Date(sorted[sorted.length - 1].date) - new Date(sorted[0].date)) / 86400000;
    if (span > 0) {
      const daysLeft = toGo / (lost / span);
      eta = new Date(Date.now() + daysLeft * 86400000)
        .toLocaleDateString('en-NZ', { month: 'short', year: 'numeric' });
    }
  }

  const deltaClass = lost > 0 ? 'accent-green' : lost < 0 ? 'accent-red' : '';
  const deltaSign  = lost > 0 ? '↓' : lost < 0 ? '↑' : '';
  const streakEmoji = streak >= 7 ? '🔥' : streak >= 3 ? '✨' : '📅';

  container.innerHTML = `
    <div class="stat-card accent-red">
      <div class="value highlight">${current.toFixed(1)}</div>
      <div class="label">now</div>
    </div>
    <div class="stat-card ${deltaClass}">
      <div class="value">${deltaSign}&thinsp;${Math.abs(lost).toFixed(1)}</div>
      <div class="label">lost</div>
    </div>
    <div class="stat-card">
      <div class="value">${toGo.toFixed(1)}</div>
      <div class="label">to go</div>
    </div>
    <div class="stat-card accent-blue">
      <div class="value">${pct.toFixed(0)}%</div>
      <div class="label">done</div>
    </div>
    <div class="stat-card">
      <div class="value">${eta}</div>
      <div class="label">eta</div>
    </div>
    <div class="stat-card accent-yellow">
      <div class="value">${streakEmoji} ${streak}</div>
      <div class="label">streak</div>
    </div>
  `;

  progressFill.style.width = `${pct}%`;
  renderMilestones(pct);

  const motivLine = MOTIVATION.find(m => pct >= m.min && pct < m.max);
  motivEl.textContent = motivLine ? motivLine.msg(lost) : '';
}

// --- Weight ---

function renderWeightChart(data, person) {
  const canvas = document.getElementById('weightChart');
  destroyChart('weight');
  if (!data.length) { empty('weightChart'); return; }

  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const labels = sorted.map(d => d.date);
  const values = sorted.map(d => parseFloat(d.wt));
  const avg7   = rollingAverage(values, 7);

  charts.weight = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'daily',
          data: values,
          borderColor: C.red,
          backgroundColor: gradient(canvas, C.red, 0.12),
          fill: true,
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.2,
        },
        {
          label: '7d avg',
          data: avg7,
          borderColor: C.blue,
          backgroundColor: 'transparent',
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.3,
        },
        {
          label: 'target',
          data: values.map(() => person.gw),
          borderColor: C.grid,
          borderWidth: 1,
          borderDash: [4, 5],
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: baseOpts(),
  });
}

// --- Waist ---

function renderWaistChart(data, person) {
  const canvas = document.getElementById('waistChart');
  destroyChart('waist');
  const rows = data.filter(d => d.wc && d.wc !== '').sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) { empty('waistChart'); return; }

  const labels = rows.map(d => d.date);
  const values = rows.map(d => parseFloat(d.wc));

  charts.waist = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'wc',
          data: values,
          borderColor: C.yellow,
          backgroundColor: gradient(canvas, C.yellow, 0.1),
          fill: true,
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          pointBackgroundColor: C.yellow,
          tension: 0.2,
        },
        {
          label: 'target',
          data: values.map(() => person.gwc),
          borderColor: C.grid,
          borderWidth: 1,
          borderDash: [4, 5],
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: baseOpts(),
  });
}

// --- Protein ---

function renderProteinChart(data, person) {
  const canvas = document.getElementById('proteinChart');
  destroyChart('protein');
  if (!data.length) { empty('proteinChart'); return; }

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
        {
          label: 'protein',
          data: values,
          backgroundColor: values.map(v => v >= person.gp
            ? 'rgba(74,158,255,0.65)'
            : 'rgba(233,69,96,0.5)'),
          borderRadius: 3,
          borderSkipped: false,
        },
        {
          label: 'target',
          data: values.map(() => person.gp),
          type: 'line',
          borderColor: C.blue,
          borderWidth: 1.5,
          borderDash: [4, 5],
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: baseOpts({ scales: { y: { beginAtZero: true } } }),
  });
}

// --- Water ---

function renderWaterChart(data) {
  const canvas = document.getElementById('waterChart');
  destroyChart('water');
  if (!data.length) { empty('waterChart'); return; }

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
        {
          label: 'water',
          data: values,
          backgroundColor: values.map(v => v >= target
            ? 'rgba(62,207,142,0.65)'
            : 'rgba(233,69,96,0.5)'),
          borderRadius: 3,
          borderSkipped: false,
        },
        {
          label: 'target',
          data: values.map(() => target),
          type: 'line',
          borderColor: C.green,
          borderWidth: 1.5,
          borderDash: [4, 5],
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: baseOpts({ scales: { y: { beginAtZero: true } } }),
  });
}

// --- BP ---

function renderBPChart(data) {
  const canvas = document.getElementById('bpChart');
  destroyChart('bp');
  const rows = data.filter(d => d.sys && d.sys !== '').sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) { empty('bpChart'); return; }

  const labels = rows.map(d => d.date);
  const sys    = rows.map(d => parseFloat(d.sys));
  const dia    = rows.map(d => parseFloat(d.dia));

  charts.bp = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'sys',
          data: sys,
          borderColor: C.red,
          backgroundColor: gradient(canvas, C.red, 0.08),
          fill: true,
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          pointBackgroundColor: C.red,
          tension: 0.3,
        },
        {
          label: 'dia',
          data: dia,
          borderColor: C.yellow,
          backgroundColor: gradient(canvas, C.yellow, 0.06),
          fill: true,
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          pointBackgroundColor: C.yellow,
          tension: 0.3,
        },
        {
          label: '120',
          data: sys.map(() => 120),
          borderColor: 'rgba(233,69,96,0.2)',
          borderWidth: 1,
          borderDash: [3, 5],
          pointRadius: 0,
          fill: false,
        },
        {
          label: '80',
          data: dia.map(() => 80),
          borderColor: 'rgba(245,200,66,0.2)',
          borderWidth: 1,
          borderDash: [3, 5],
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: baseOpts(),
  });
}

// --- Cholesterol ---

function renderCholesterolChart(data) {
  const canvas = document.getElementById('cholChart');
  destroyChart('chol');
  const rows = data.filter(d => d.hdl && d.hdl !== '').sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) { empty('cholChart'); return; }

  const labels = rows.map(d => d.date);
  const hdl    = rows.map(d => parseFloat(d.hdl));
  const ldl    = rows.map(d => parseFloat(d.ldl));

  charts.chol = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'hdl',
          data: hdl,
          borderColor: C.green,
          backgroundColor: gradient(canvas, C.green, 0.1),
          fill: true,
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          pointBackgroundColor: C.green,
          tension: 0.3,
        },
        {
          label: 'ldl',
          data: ldl,
          borderColor: C.red,
          backgroundColor: gradient(canvas, C.red, 0.08),
          fill: true,
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          pointBackgroundColor: C.red,
          tension: 0.3,
        },
        {
          label: 'hdl ok',
          data: hdl.map(() => 1.0),
          borderColor: 'rgba(62,207,142,0.2)',
          borderWidth: 1,
          borderDash: [3, 5],
          pointRadius: 0,
          fill: false,
        },
        {
          label: 'ldl ok',
          data: ldl.map(() => 2.6),
          borderColor: 'rgba(233,69,96,0.2)',
          borderWidth: 1,
          borderDash: [3, 5],
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: baseOpts(),
  });
}

// --- Gout ---

function renderGoutChart(data) {
  const canvas = document.getElementById('goutChart');
  destroyChart('gout');
  const rows = [...data].sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) { empty('goutChart'); return; }

  const labels   = rows.map(d => d.date);
  const severity = rows.map(d => parseFloat(d.severity) || 0);

  charts.gout = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'severity',
        data: severity,
        backgroundColor: severity.map(v =>
          v >= 7 ? 'rgba(233,69,96,0.85)' :
          v >= 4 ? 'rgba(245,200,66,0.75)' :
                   'rgba(74,158,255,0.6)'),
        borderRadius: 3,
        borderSkipped: false,
      }],
    },
    options: baseOpts({
      scales: {
        y: { beginAtZero: true, max: 10, ticks: { stepSize: 2 } },
      },
    }),
  });
}

// --- Exercise ---

function renderExerciseChart(data) {
  const canvas = document.getElementById('exerciseChart');
  destroyChart('exercise');
  if (!data.length) { empty('exerciseChart'); return; }

  const byWeek = {};
  data.forEach(row => {
    const d   = new Date(row.date);
    const day = d.getDay();
    const key = new Date(new Date(row.date).setDate(d.getDate() - day + (day === 0 ? -6 : 1)))
      .toISOString().slice(0, 10);
    if (!byWeek[key]) byWeek[key] = { ss: 0, other: 0 };
    if (row.type?.toLowerCase().includes('s&s')) byWeek[key].ss++;
    else if (row.type && row.type.toLowerCase() !== 'rest') byWeek[key].other++;
  });

  const weeks  = Object.keys(byWeek).sort();
  const labels = weeks.map(w =>
    new Date(w).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' }));

  charts.exercise = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 's&s',
          data: weeks.map(w => byWeek[w].ss),
          backgroundColor: 'rgba(233,69,96,0.75)',
          borderRadius: 3,
          borderSkipped: false,
        },
        {
          label: 'other',
          data: weeks.map(w => byWeek[w].other),
          backgroundColor: 'rgba(74,158,255,0.65)',
          borderRadius: 3,
          borderSkipped: false,
        },
      ],
    },
    options: baseOpts({
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } },
      },
    }),
  });
}

// --- Load ---

function setLoading(on) {
  document.getElementById('loading').classList.toggle('visible', on);
}

async function loadAll() {
  const person = people.find(p => p.key === activePerson);
  setLoading(true);

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

  setLoading(false);
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
    document.getElementById('app').innerHTML = '<p class="no-data">—</p>';
    return;
  }
  activePerson = people[0].key;
  renderPersonSwitcher(people);
  bindFilters();
  loadAll();
}

document.addEventListener('DOMContentLoaded', init);
