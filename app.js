// ============================================================
// QRONOS 2.0 · Eficiencia Inteligente · app.js
// Full application logic — serverless architecture
// ============================================================

'use strict';

// ── Configuration ────────────────────────────────────────────
const CONFIG = {
  apiBase: '/api',
  localStorageKey: 'qronos_cache_v2',
  offlineQueueKey: 'qronos_offline_queue',
  defaultDays: 30,
};

const PLANTS = {
  'Caldos':       { grupo: 'Azteca',  meta: 73, color: '#4fc3f7', colorDark: '#0288d1' },
  'Liquidos':     { grupo: 'Azteca',  meta: 75, color: '#29b6f6', colorDark: '#0277bd' },
  'Promociones':  { grupo: 'Azteca',  meta: 81, color: '#00b0ff', colorDark: '#0091ea' },
  "Krones Pet":   { grupo: "RTD's",   meta: 64, color: '#ce93d8', colorDark: '#8e24aa' },
  "Krones Lata":  { grupo: "RTD's",   meta: 71, color: '#ba68c8', colorDark: '#7b1fa2' },
  'SIDEL':        { grupo: "RTD's",   meta: 61, color: '#ab47bc', colorDark: '#6a1b9a' },
};

const GRUPOS = {
  'Azteca': { color: '#00b4ff', badge: 'azteca' },
  "RTD's":  { color: '#ce93d8', badge: 'rtds'   },
};

// ── State ────────────────────────────────────────────────────
const State = {
  records: [],
  isLoading: false,
  activeTab: 'dashboard',
  currentEditId: null,
  chatHistory: [],
  isListening: false,
  syncing: false,
  chartWeekly: null,
  onlineStatus: navigator.onLine,
};

// ── DOM Helpers ──────────────────────────────────────────────
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  });
  children.forEach((c) => c && e.append(typeof c === 'string' ? c : c));
  return e;
}

// ── Utilities ─────────────────────────────────────────────────
function calcAvg(records) {
  // CRITICAL: Exclude 0% (stopped days) from averages
  const valid = records.filter((r) => r.eficiencia > 0);
  if (!valid.length) return null;
  return valid.reduce((a, r) => a + r.eficiencia, 0) / valid.length;
}

function effColor(eff, meta) {
  if (eff === 0) return 'var(--stopped)';
  const pct = eff / meta;
  if (pct >= 1)    return 'var(--success)';
  if (pct >= 0.92) return 'var(--warning)';
  return 'var(--danger)';
}

function effClass(eff, meta) {
  if (eff === 0) return 'neutral';
  const pct = eff / meta;
  if (pct >= 1)    return 'good';
  if (pct >= 0.92) return 'warn';
  return 'bad';
}

function effBarColor(eff, meta) {
  if (eff === 0) return 'var(--stopped)';
  const pct = eff / meta;
  if (pct >= 1)    return 'linear-gradient(90deg,#00e676,#00c853)';
  if (pct >= 0.92) return 'linear-gradient(90deg,#ffab40,#ff8f00)';
  return 'linear-gradient(90deg,#ff5252,#c62828)';
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateShort(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function getLatestRecord(records, planta) {
  const recs = records.filter((r) => r.planta === planta).sort((a, b) => b.fecha.localeCompare(a.fecha));
  return recs[0] || null;
}

function getYesterdayISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ── Toast Notifications ───────────────────────────────────────
function showToast(msg, type = 'info', duration = 3000) {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ── Skeleton Loader ───────────────────────────────────────────
function showSkeleton(containerId) {
  const container = $(`#${containerId}`);
  if (!container) return;
  container.innerHTML = `
    <div class="kpi-grid">
      ${Array(4).fill('<div class="skeleton skeleton-kpi"></div>').join('')}
    </div>
    <div class="skeleton skeleton-chart" style="margin-bottom:20px"></div>
    <div class="plants-grid">
      ${Array(6).fill('<div class="skeleton skeleton-card"></div>').join('')}
    </div>`;
}

// ── Status Dot ────────────────────────────────────────────────
function updateStatusDot(status) {
  const dot = $('#status-dot');
  if (!dot) return;
  dot.className = `status-dot ${status}`;
}

// ── Local Storage Cache ───────────────────────────────────────
function saveCache(data) {
  try { localStorage.setItem(CONFIG.localStorageKey, JSON.stringify({ ts: Date.now(), data })); }
  catch (e) { console.warn('[QRONOS] Cache write failed', e); }
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CONFIG.localStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Cache valid for 5 min
    if (Date.now() - parsed.ts < 300_000) return parsed.data;
  } catch (e) { /* ignore */ }
  return null;
}

// Offline queue for saving records when network is down
function addToOfflineQueue(record) {
  const q = JSON.parse(localStorage.getItem(CONFIG.offlineQueueKey) || '[]');
  q.push({ ...record, _queued: Date.now() });
  localStorage.setItem(CONFIG.offlineQueueKey, JSON.stringify(q));
}

async function flushOfflineQueue() {
  const q = JSON.parse(localStorage.getItem(CONFIG.offlineQueueKey) || '[]');
  if (!q.length) return;
  for (const record of q) {
    try {
      await apiSaveRecord(record);
    } catch { return; } // stop if still offline
  }
  localStorage.removeItem(CONFIG.offlineQueueKey);
  showToast(`✅ ${q.length} registro(s) offline sincronizados`, 'success');
}

// ── API Layer ─────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const res = await fetch(`${CONFIG.apiBase}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({ error: 'Respuesta inválida del servidor' }));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

async function apiLoadRecords(desde, hasta) {
  return apiFetch(`/records?desde=${desde}&hasta=${hasta}&limit=500`);
}

async function apiSaveRecord(record) {
  return apiFetch('/records', { method: 'POST', body: JSON.stringify(record) });
}

async function apiDeleteRecord(id) {
  return apiFetch(`/records?id=${id}`, { method: 'DELETE' });
}

async function apiAnalyze(pregunta, historial = []) {
  return apiFetch('/analizar', {
    method: 'POST',
    body: JSON.stringify({ pregunta, records: State.records, historial }),
  });
}

// ── Data Loading ──────────────────────────────────────────────
async function loadData(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = loadCache();
    if (cached && cached.length > 0) {
      State.records = cached;
      renderAll();
      return;
    }
  }

  updateStatusDot('syncing');
  State.syncing = true;

  try {
    if (!navigator.onLine) {
      const cached = loadCache();
      if (cached) {
        State.records = cached;
        showToast('📶 Sin conexión — mostrando datos en caché', 'info');
        renderAll();
        return;
      }
      throw new Error('Sin conexión y sin caché disponible');
    }

    const desde = daysAgoISO(CONFIG.defaultDays);
    const hasta = todayISO();
    const result = await apiLoadRecords(desde, hasta);
    State.records = result.data || [];
    saveCache(State.records);
    renderAll();
    updateStatusDot('');
    await flushOfflineQueue();
  } catch (err) {
    console.error('[QRONOS loadData]', err);
    showToast(`⚠️ Error al cargar datos: ${err.message}`, 'error', 4000);
    updateStatusDot('offline');
    const cached = loadCache();
    if (cached) {
      State.records = cached;
      renderAll();
    }
  } finally {
    State.syncing = false;
  }
}

// ── Render All ────────────────────────────────────────────────
function renderAll() {
  renderDashboard();
  renderPlants();
  renderAfectaciones();
}

// ── Dashboard ─────────────────────────────────────────────────
function renderDashboard() {
  renderKPIs();
  renderWeeklyChart();
  renderGroupSummaries();
}

function renderKPIs() {
  const container = $('#kpi-grid');
  if (!container) return;

  const today = todayISO();
  const weekAgo = daysAgoISO(7);
  const weekRecords = State.records.filter((r) => r.fecha >= weekAgo);
  const todayRecords = State.records.filter((r) => r.fecha === today);

  // Global average (excluding 0%)
  const globalAvg = calcAvg(weekRecords);
  const globalMeta = weekRecords.length
    ? weekRecords.reduce((a, r) => a + r.meta, 0) / weekRecords.length
    : 75;

  // Best and worst plant (by avg this week, excluding stopped)
  const plantAvgs = Object.keys(PLANTS).map((p) => {
    const recs = weekRecords.filter((r) => r.planta === p);
    const avg = calcAvg(recs);
    const meta = PLANTS[p].meta;
    return { planta: p, avg, meta, gap: avg !== null ? avg - meta : null };
  }).filter((x) => x.avg !== null);

  const bestPlant  = plantAvgs.sort((a, b) => b.gap - a.gap)[0];
  const worstPlant = [...plantAvgs].sort((a, b) => a.gap - b.gap)[0];

  // Trend: compare last 7 days vs prior 7 days
  const prior7 = State.records.filter((r) => r.fecha >= daysAgoISO(14) && r.fecha < weekAgo);
  const prior7Avg = calcAvg(prior7);
  const trend = globalAvg !== null && prior7Avg !== null ? globalAvg - prior7Avg : null;

  container.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Eficiencia Global</div>
      <div class="kpi-value ${globalAvg !== null ? effClass(globalAvg, globalMeta) : 'neutral'}">
        ${globalAvg !== null ? globalAvg.toFixed(1) + '%' : '—'}
      </div>
      <div class="kpi-sub">Promedio 7 días (excl. paros)</div>
      ${trend !== null ? `<div class="kpi-trend ${trend >= 0 ? 'up' : 'down'}">${trend >= 0 ? '▲' : '▼'} ${Math.abs(trend).toFixed(1)}% vs semana anterior</div>` : ''}
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Mejor Planta</div>
      <div class="kpi-value good">${bestPlant ? bestPlant.avg.toFixed(1) + '%' : '—'}</div>
      <div class="kpi-sub">${bestPlant ? bestPlant.planta : 'Sin datos'}</div>
      ${bestPlant ? `<div class="kpi-trend up">+${Math.abs(bestPlant.gap).toFixed(1)}% vs meta</div>` : ''}
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Peor Planta</div>
      <div class="kpi-value ${worstPlant && worstPlant.gap < 0 ? 'bad' : 'warn'}">${worstPlant ? worstPlant.avg.toFixed(1) + '%' : '—'}</div>
      <div class="kpi-sub">${worstPlant ? worstPlant.planta : 'Sin datos'}</div>
      ${worstPlant ? `<div class="kpi-trend ${worstPlant.gap >= 0 ? 'up' : 'down'}">${worstPlant.gap >= 0 ? '+' : ''}${worstPlant.gap.toFixed(1)}% vs meta</div>` : ''}
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Registros Hoy</div>
      <div class="kpi-value neutral">${todayRecords.length}<span style="font-size:1rem;font-weight:400">/${Object.keys(PLANTS).length}</span></div>
      <div class="kpi-sub">Plantas registradas</div>
      ${todayRecords.length === 0 ? '<div class="kpi-trend down">Sin registros hoy</div>' : ''}
    </div>`;
}

// ── Weekly Trend Chart ────────────────────────────────────────
function renderWeeklyChart() {
  const canvas = $('#chart-weekly');
  if (!canvas) return;

  if (State.chartWeekly) {
    State.chartWeekly.destroy();
    State.chartWeekly = null;
  }

  // Last 14 days
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(daysAgoISO(i));

  const datasets = Object.entries(PLANTS).map(([name, cfg]) => {
    const data = days.map((d) => {
      const rec = State.records.find((r) => r.planta === name && r.fecha === d);
      if (!rec) return null;
      // 0% = stopped day → show as null (gap in line) with special marker
      return rec.eficiencia === 0 ? null : rec.eficiencia;
    });

    return {
      label: name,
      data,
      borderColor: cfg.color,
      backgroundColor: cfg.color + '18',
      fill: false,
      tension: 0.4,
      borderWidth: 2,
      pointRadius: data.map((v, i) => {
        const rec = State.records.find((r) => r.planta === name && r.fecha === days[i]);
        return rec && rec.eficiencia === 0 ? 5 : (v !== null ? 4 : 0);
      }),
      pointBackgroundColor: data.map((v, i) => {
        const rec = State.records.find((r) => r.planta === name && r.fecha === days[i]);
        return rec && rec.eficiencia === 0 ? '#546e7a' : cfg.color;
      }),
      pointBorderColor: 'transparent',
      spanGaps: false,
    };
  });

  // Add meta lines (dashed)
  const metaDatasets = Object.entries(PLANTS).map(([name, cfg]) => ({
    label: `Meta ${name}`,
    data: days.map(() => cfg.meta),
    borderColor: cfg.color + '50',
    borderDash: [5, 5],
    borderWidth: 1,
    pointRadius: 0,
    fill: false,
    tension: 0,
  }));

  State.chartWeekly = new Chart(canvas, {
    type: 'line',
    data: { labels: days.map(fmtDateShort), datasets: [...datasets, ...metaDatasets] },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: '#8fabc7', font: { size: 10, family: 'system-ui' },
            filter: (item) => !item.text.startsWith('Meta '),
            boxWidth: 12, padding: 12,
          },
        },
        tooltip: {
          backgroundColor: 'rgba(8,13,32,0.95)',
          borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
          titleColor: '#f0f4ff', bodyColor: '#8fabc7',
          padding: 12, cornerRadius: 10,
          filter: (item) => !item.dataset.label.startsWith('Meta '),
          callbacks: {
            label: (ctx) => {
              if (ctx.parsed.y === null) {
                const day = days[ctx.dataIndex];
                const rec = State.records.find((r) => r.planta === ctx.dataset.label && r.fecha === day);
                return rec && rec.eficiencia === 0
                  ? ` ${ctx.dataset.label}: ⛔ Día sin producción`
                  : ` ${ctx.dataset.label}: Sin dato`;
              }
              return ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#4a6280', font: { size: 10 } },
        },
        y: {
          min: 40, max: 105,
          grid: { color: 'rgba(255,255,255,0.06)' },
          ticks: {
            color: '#4a6280', font: { size: 10 },
            callback: (v) => v + '%',
          },
        },
      },
    },
  });
}

function renderGroupSummaries() {
  const container = $('#groups-grid');
  if (!container) return;

  const weekAgo = daysAgoISO(7);
  const weekRecords = State.records.filter((r) => r.fecha >= weekAgo);

  container.innerHTML = Object.entries(GRUPOS).map(([grupo, gcfg]) => {
    const plantasDelGrupo = Object.entries(PLANTS).filter(([, cfg]) => cfg.grupo === grupo);
    const rows = plantasDelGrupo.map(([name, cfg]) => {
      const recs = weekRecords.filter((r) => r.planta === name);
      const avg = calcAvg(recs);
      const stoppedDays = recs.filter((r) => r.eficiencia === 0).length;
      const color = avg !== null ? effColor(avg, cfg.meta) : 'var(--text-muted)';
      return `
        <div class="group-plant-row">
          <span class="group-plant-name">${name}</span>
          <div style="display:flex;align-items:center;gap:10px">
            ${stoppedDays > 0 ? `<span style="font-size:0.65rem;color:var(--stopped)">⛔ ${stoppedDays}d paro</span>` : ''}
            <span class="group-plant-val" style="color:${color}">
              ${avg !== null ? avg.toFixed(1) + '%' : '—'} <span style="color:var(--text-muted);font-size:0.68rem">/ ${cfg.meta}%</span>
            </span>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="group-card">
        <div class="group-title">
          <span style="color:${gcfg.color}">●</span> ${grupo}
        </div>
        ${rows}
      </div>`;
  }).join('');
}

// ── Plant Cards ───────────────────────────────────────────────
function renderPlants() {
  const container = $('#plants-grid');
  if (!container) return;

  container.innerHTML = Object.entries(PLANTS).map(([name, cfg]) => {
    const latest = getLatestRecord(State.records, name);
    const eff = latest ? latest.eficiencia : null;
    const isStopped = eff === 0;
    const displayEff = isStopped ? 0 : eff;
    const barPct = eff !== null && !isStopped ? Math.min(100, (eff / cfg.meta) * 100) : 0;
    const color = eff !== null ? effColor(eff, cfg.meta) : 'var(--text-muted)';
    const barGrad = eff !== null ? effBarColor(eff, cfg.meta) : 'var(--stopped)';
    const grupo = cfg.grupo.replace("'", '').replace(' ', '').toLowerCase();

    return `
      <div class="plant-card ${isStopped ? 'stopped' : ''}">
        <div class="plant-card-header">
          <div>
            <div class="plant-name">${name}</div>
            <div class="update-badge">${latest ? 'Actualizado: ' + fmtDate(latest.fecha) : 'Sin registros'}</div>
          </div>
          <span class="plant-group ${grupo.startsWith('rtd') ? 'rtds' : 'azteca'}">${cfg.grupo}</span>
        </div>
        <div class="plant-efficiency" style="color:${color}">
          ${isStopped ? '⛔' : (eff !== null ? eff.toFixed(1) + '%' : '—')}
        </div>
        ${isStopped
          ? '<div class="plant-meta" style="color:var(--stopped)">Día sin producción</div>'
          : `<div class="plant-meta">Meta: ${cfg.meta}% ${eff !== null ? '| Brecha: ' + (eff - cfg.meta).toFixed(1) + '%' : ''}</div>`
        }
        <div class="efficiency-bar-wrap">
          <div class="efficiency-bar-fill" style="width:${barPct}%;background:${isStopped ? 'var(--stopped)' : barGrad}"></div>
        </div>
        <div class="plant-footer">
          <div class="plant-afectacion">${latest?.afectaciones ? '⚠ ' + latest.afectaciones : 'Sin afectaciones'}</div>
          <button class="btn-edit" onclick="openEditModal('${name}')">✏ Editar</button>
        </div>
      </div>`;
  }).join('');
}

// ── Afectaciones Panel ────────────────────────────────────────
function renderAfectaciones() {
  const container = $('#afect-container');
  if (!container) return;

  const yesterday = getYesterdayISO();
  const today = todayISO();

  // Get records with afectaciones from last 3 days
  const recent = State.records
    .filter((r) => r.fecha >= daysAgoISO(3) && (r.afectaciones || r.eficiencia === 0))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));

  if (!recent.length) {
    container.innerHTML = `<div class="card" style="text-align:center;padding:32px;color:var(--text-muted)">
      <div style="font-size:2rem;margin-bottom:8px">✅</div>
      <div>Sin afectaciones registradas en los últimos 3 días</div>
    </div>`;
    return;
  }

  const cards = recent.map((r) => {
    const isStopped = r.eficiencia === 0;
    const badgeClass = isStopped ? 'critical' : (r.eficiencia < r.meta * 0.92 ? 'warning' : 'info');
    const badgeText  = isStopped ? 'PARO' : (r.eficiencia < r.meta ? 'BAJO META' : 'INFORMACIÓN');
    const isToday = r.fecha === today;
    const isYesterday = r.fecha === yesterday;
    const dateLabel = isToday ? 'Hoy' : (isYesterday ? 'Ayer' : fmtDate(r.fecha));

    return `
      <div class="afect-card">
        <div class="afect-card-header">
          <div>
            <div class="afect-plant">${r.planta}</div>
            <div class="afect-date">${dateLabel} · ${r.eficiencia.toFixed(1)}% (Meta: ${r.meta}%)</div>
          </div>
          <span class="afect-badge ${badgeClass}">${badgeText}</span>
        </div>
        ${isStopped
          ? '<p class="afect-text">🛑 Planta detenida — Día sin producción registrado.</p>'
          : r.afectaciones
            ? `<p class="afect-text">${r.afectaciones}</p>`
            : '<p class="afect-text text-muted">Sin descripción de afectaciones.</p>'
        }
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="section-header">
      <span class="section-title">Afectaciones Principales (Últimos 3 días)</span>
      <span class="text-xs text-muted">${recent.length} registro(s)</span>
    </div>
    <div class="afect-grid">${cards}</div>
    <div class="ref-note-box">
      <span class="ref-note-icon">📋</span>
      <span>Para un análisis más detallado, consulte el <strong>archivo Qronos de Escritorio</strong>.</span>
    </div>`;
}

// ── Edit Modal ────────────────────────────────────────────────
window.openEditModal = function (plantaName, existingId = null) {
  const latest = existingId
    ? State.records.find((r) => r.id === existingId)
    : getLatestRecord(State.records, plantaName);

  const cfg = PLANTS[plantaName] || PLANTS[Object.keys(PLANTS)[0]];

  $('#modal-planta').value    = plantaName || '';
  $('#modal-fecha').value     = (latest?.fecha) || todayISO();
  $('#modal-eficiencia').value = latest?.eficiencia ?? '';
  $('#modal-meta').value      = latest?.meta ?? cfg.meta;
  $('#modal-afectaciones').value = latest?.afectaciones || '';
  $('#modal-title').textContent = plantaName ? `Editar — ${plantaName}` : 'Nuevo Registro';

  State.currentEditId = latest?.id || null;
  openModal('modal-record');
};

window.openNewModal = function () {
  State.currentEditId = null;
  $('#modal-planta').value = Object.keys(PLANTS)[0];
  $('#modal-fecha').value  = todayISO();
  $('#modal-eficiencia').value = '';
  $('#modal-meta').value = PLANTS[Object.keys(PLANTS)[0]].meta;
  $('#modal-afectaciones').value = '';
  $('#modal-title').textContent = 'Nuevo Registro';
  openModal('modal-record');
};

function openModal(id) {
  $(`#${id}`).classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  $(`#${id}`).classList.remove('open');
  document.body.style.overflow = '';
}

async function handleSaveRecord(e) {
  e.preventDefault();
  const planta      = $('#modal-planta').value.trim();
  const fecha       = $('#modal-fecha').value;
  const eficiencia  = parseFloat($('#modal-eficiencia').value);
  const meta        = parseFloat($('#modal-meta').value) || PLANTS[planta]?.meta;
  const afectaciones = $('#modal-afectaciones').value.trim();

  if (!planta || !fecha || isNaN(eficiencia)) {
    showToast('⚠️ Completa todos los campos requeridos', 'error');
    return;
  }
  if (eficiencia < 0 || eficiencia > 100) {
    showToast('⚠️ Eficiencia debe estar entre 0% y 100%', 'error');
    return;
  }

  const record = { planta, fecha, eficiencia, meta, afectaciones };
  if (State.currentEditId) record.id = State.currentEditId;

  const btn = $('#btn-save-record');
  btn.disabled = true;
  btn.textContent = 'Guardando…';

  try {
    if (!navigator.onLine) {
      addToOfflineQueue(record);
      // Update cache locally
      const idx = State.records.findIndex((r) => r.planta === planta && r.fecha === fecha);
      const merged = { ...record, id: State.currentEditId || `offline_${Date.now()}`, updated_at: new Date().toISOString() };
      if (idx >= 0) State.records[idx] = merged;
      else State.records.unshift(merged);
      saveCache(State.records);
      showToast('📶 Guardado offline — se sincronizará al reconectarse', 'info', 4000);
    } else {
      const result = await apiSaveRecord(record);
      const saved = Array.isArray(result.data) ? result.data[0] : result.data;
      const idx = State.records.findIndex((r) => r.planta === planta && r.fecha === fecha);
      if (idx >= 0) State.records[idx] = saved;
      else State.records.unshift(saved);
      saveCache(State.records);
      showToast('✅ Registro guardado correctamente', 'success');
    }
    closeModal('modal-record');
    renderAll();
  } catch (err) {
    console.error('[QRONOS save]', err);
    showToast(`❌ Error al guardar: ${err.message}`, 'error', 4000);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar Registro';
  }
}

// Auto-fill meta when planta changes
function onPlantaChange(e) {
  const meta = PLANTS[e.target.value]?.meta;
  if (meta) $('#modal-meta').value = meta;
}

// ── Chat Panel ────────────────────────────────────────────────
async function sendChatMessage(msg) {
  if (!msg.trim()) return;

  const messages = $('#chat-messages');
  if (!messages) return;

  // Add user message
  appendChatMsg('user', msg);
  $('#chat-input-field').value = '';
  State.chatHistory.push({ role: 'user', content: msg });

  // Typing indicator
  const typingEl = el('div', { class: 'chat-msg ai', id: 'chat-typing' }, 
    el('div', { class: 'chat-avatar ai' }, '⚡'),
    el('div', { class: 'chat-bubble' },
      el('div', { class: 'chat-typing' },
        el('span'), el('span'), el('span')
      )
    )
  );
  messages.appendChild(typingEl);
  messages.scrollTop = messages.scrollHeight;

  try {
    const result = await apiAnalyze(msg, State.chatHistory);
    typingEl.remove();
    const respuesta = result.respuesta || 'Sin respuesta del servidor.';
    appendChatMsg('ai', respuesta);
    State.chatHistory.push({ role: 'assistant', content: respuesta });
    if (State.chatHistory.length > 20) State.chatHistory = State.chatHistory.slice(-20);
    speak(respuesta.slice(0, 300));
  } catch (err) {
    typingEl.remove();
    const errMsg = `⚠️ ${err.message || 'Error al conectar con la IA. Verifica tu conexión.'}`;
    appendChatMsg('ai', errMsg);
  }
}

function appendChatMsg(role, content) {
  const messages = $('#chat-messages');
  if (!messages) return;
  const isAI = role === 'ai' || role === 'assistant';
  const msgEl = el('div', { class: `chat-msg ${isAI ? 'ai' : 'user'}` },
    el('div', { class: `chat-avatar ${isAI ? 'ai' : 'user'}` }, isAI ? '⚡' : '👤'),
    el('div', { class: 'chat-bubble' }, content)
  );
  messages.appendChild(msgEl);
  messages.scrollTop = messages.scrollHeight;
}

// ── Voice Commands ────────────────────────────────────────────
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

function initVoice() {
  if (!SpeechRecognition) {
    $('#btn-voice')?.classList.add('hidden');
    return;
  }
  recognition = new SpeechRecognition();
  recognition.lang = 'es-MX';
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript.toLowerCase().trim();
    handleVoiceCommand(transcript);
  };
  recognition.onerror = (event) => {
    if (event.error !== 'no-speech') showToast(`🎤 Error de voz: ${event.error}`, 'error');
    stopListening();
  };
  recognition.onend = () => stopListening();
}

function startListening() {
  if (!recognition) return;
  State.isListening = true;
  const btn = $('#btn-voice');
  btn?.classList.add('listening');
  $('#voice-status')?.classList.add('show');
  recognition.start();
  showToast('🎤 Escuchando… Di "Qronos, resumen"', 'info', 3000);
}

function stopListening() {
  State.isListening = false;
  $('#btn-voice')?.classList.remove('listening');
  $('#voice-status')?.classList.remove('show');
  try { recognition?.stop(); } catch {}
}

function toggleVoice() {
  if (State.isListening) stopListening();
  else startListening();
}

function handleVoiceCommand(cmd) {
  console.log('[QRONOS Voice]', cmd);

  // Wakeword (optional — always process commands)
  const clean = cmd.replace(/^(qronos[,\s]*)/i, '').trim();

  if (/resumen|eficiencias|dashboard/.test(clean)) {
    switchTab('dashboard');
    const weekAgo = daysAgoISO(7);
    const weekRecs = State.records.filter((r) => r.fecha >= weekAgo);
    const avg = calcAvg(weekRecs);
    speak(avg !== null
      ? `Resumen de eficiencias. Promedio global de la última semana: ${avg.toFixed(1)} por ciento.`
      : 'No hay datos de eficiencias disponibles esta semana.');

  } else if (/mejor planta/.test(clean)) {
    const weekRecs = State.records.filter((r) => r.fecha >= daysAgoISO(7));
    const best = getBestWorstPlant(weekRecs, 'best');
    speak(best ? `La mejor planta es ${best.planta} con ${best.avg.toFixed(1)} por ciento.` : 'Sin datos suficientes.');

  } else if (/peor planta/.test(clean)) {
    const weekRecs = State.records.filter((r) => r.fecha >= daysAgoISO(7));
    const worst = getBestWorstPlant(weekRecs, 'worst');
    speak(worst ? `La peor planta es ${worst.planta} con ${worst.avg.toFixed(1)} por ciento.` : 'Sin datos suficientes.');

  } else if (/detener|para|stop|silencio/.test(clean)) {
    window.speechSynthesis.cancel();
    showToast('🔇 Voz detenida', 'info');

  } else if (/plantas/.test(clean)) {
    switchTab('plantas');
    speak('Mostrando detalles de todas las plantas.');

  } else if (/afectaciones/.test(clean)) {
    switchTab('afectaciones');
    speak('Mostrando panel de afectaciones.');

  } else if (clean.length > 3) {
    // Send to AI chat
    switchTab('chat');
    sendChatMessage(clean);

  } else {
    speak('No entendí el comando. Intenta: resumen de eficiencias, mejor planta, o peor planta.');
  }
}

function getBestWorstPlant(records, type) {
  const plantAvgs = Object.keys(PLANTS).map((p) => {
    const recs = records.filter((r) => r.planta === p);
    const avg = calcAvg(recs);
    return avg !== null ? { planta: p, avg, meta: PLANTS[p].meta } : null;
  }).filter(Boolean);

  if (!plantAvgs.length) return null;
  return type === 'best'
    ? plantAvgs.sort((a, b) => (b.avg / b.meta) - (a.avg / a.meta))[0]
    : plantAvgs.sort((a, b) => (a.avg / a.meta) - (b.avg / b.meta))[0];
}

function speak(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'es-MX';
  utter.rate = 1.05;
  utter.pitch = 1;
  window.speechSynthesis.speak(utter);
}

// ── Tab Navigation ────────────────────────────────────────────
function switchTab(tabId) {
  State.activeTab = tabId;
  $$('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  $$('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${tabId}`);
  });
}

// ── Online/Offline Handling ───────────────────────────────────
function setupNetworkHandlers() {
  window.addEventListener('online', () => {
    State.onlineStatus = true;
    updateStatusDot('');
    showToast('✅ Conexión restablecida — sincronizando…', 'success');
    loadData(true);
  });
  window.addEventListener('offline', () => {
    State.onlineStatus = false;
    updateStatusDot('offline');
    showToast('📶 Sin conexión — trabajando en modo offline', 'info', 4000);
  });
}

// ── Service Worker ────────────────────────────────────────────
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').then((reg) => {
      console.log('[QRONOS SW] Registered', reg.scope);
      reg.addEventListener('updatefound', () => {
        showToast('🔄 Nueva versión disponible — recarga para actualizar', 'info', 8000);
      });
    }).catch((err) => console.warn('[QRONOS SW] Registration failed:', err));

    navigator.serviceWorker.addEventListener('message', (evt) => {
      if (evt.data?.type === 'SYNC_REQUESTED') loadData(true);
    });
  }
}

// ── Event Bindings ────────────────────────────────────────────
function bindEvents() {
  // Tab switching
  $$('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Voice toggle
  $('#btn-voice')?.addEventListener('click', toggleVoice);

  // Sync button
  $('#btn-sync')?.addEventListener('click', () => {
    if (State.syncing) return;
    localStorage.removeItem(CONFIG.localStorageKey);
    loadData(true);
    showToast('🔄 Sincronizando datos…', 'info');
  });

  // Add record
  $('#btn-add')?.addEventListener('click', openNewModal);

  // Modal close buttons
  $$('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
  });

  // Close modal on overlay click
  $$('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  // Save record form
  $('#form-record')?.addEventListener('submit', handleSaveRecord);

  // Planta select auto-fills meta
  $('#modal-planta')?.addEventListener('change', onPlantaChange);

  // Chat send button
  $('#btn-chat-send')?.addEventListener('click', () => {
    const val = $('#chat-input-field')?.value;
    if (val?.trim()) sendChatMessage(val);
  });

  // Chat Enter key
  $('#chat-input-field')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const val = e.target.value;
      if (val.trim()) sendChatMessage(val);
    }
  });

  // Quick chat actions
  $$('.quick-action').forEach((btn) => {
    btn.addEventListener('click', () => sendChatMessage(btn.dataset.msg));
  });

  // PWA Install prompt
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = $('#btn-install');
    if (installBtn) installBtn.classList.remove('hidden');
  });
  $('#btn-install')?.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') showToast('✅ QRONOS instalado correctamente', 'success');
      deferredPrompt = null;
      $('#btn-install')?.classList.add('hidden');
    }
  });
}

// ── Initial Chat Message ──────────────────────────────────────
function initChat() {
  appendChatMsg('ai',
    '¡Bienvenido a QRONOS 2.0! Soy tu Director de Operaciones virtual.\n\n' +
    'Puedo analizar eficiencias, identificar cuellos de botella y darte recomendaciones accionables.\n\n' +
    '¿En qué planta quieres enfocarte hoy?'
  );
}

// ── App Initialization ────────────────────────────────────────
async function init() {
  // Hide splash after minimum display time
  const splashMinTime = new Promise((r) => setTimeout(r, 1200));

  registerServiceWorker();
  bindEvents();
  setupNetworkHandlers();
  initVoice();
  initChat();

  // Start loading data
  const loadPromise = loadData(false);

  // Wait for both minimum splash time and initial data
  await Promise.all([splashMinTime, loadPromise]);

  // Hide splash
  $('#splash').classList.add('hidden');

  console.log('[QRONOS 2.0] Initialized ✅');
}

// Run on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
