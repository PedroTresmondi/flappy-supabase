// src/config.js — Mock login (master/client) + RBAC + Supabase I/O + Prizes + Painéis de Ranking
import { supabase } from './supabase.js';

const SUPABASE_CONFIG_TABLE = 'flappy_config';
const SUPABASE_SCORES_TABLE = 'scores';

const SLUG_KEY = 'flappy:configSlug';
const DEFAULT_SLUG = 'default';

// Usuários mockados
const MOCK_CREDENTIALS = {
  master: { email: 'master@local', password: '123456' },
  client: { email: 'client@local', password: '123456' },
};

let state = {};
let role = 'client'; // 'master' | 'client'
let lastScoresCache = [];

// ---------------------- Difficulty Presets (cliente) --------------------------
const DIFFICULTY_PRESETS = {
  // “demora mais pra aumentar”
  easy: {
    rampEnabled: false,          // foca na progressão por tempo
    minGapPercent: 22,
    gapStepPerScore: 0.0,
    timeRampEnabled: true,
    timeStartDelayMs: 0,
    timeSpeedPerSec: 0.015,
    timeMaxExtraSpeed: 3,
    timeGapStepPerSec: 0.005,
    stepEveryMs: 3500,
    stepAddPxPerFrame: 0.15,
    stepMaxExtraPxPerFrame: 3,
  },

  // “linearidade normal”
  medium: {
    rampEnabled: false,
    minGapPercent: 20,
    gapStepPerScore: 0.0,
    timeRampEnabled: true,
    timeStartDelayMs: 0,
    timeSpeedPerSec: 0.03,
    timeMaxExtraSpeed: 5,
    timeGapStepPerSec: 0.02,
    stepEveryMs: 2000,
    stepAddPxPerFrame: 0.30,
    stepMaxExtraPxPerFrame: 6,
  },

  // “aumenta com mais frequência”
  hard: {
    rampEnabled: false,
    minGapPercent: 18,
    gapStepPerScore: 0.0,
    timeRampEnabled: true,
    timeStartDelayMs: 0,
    timeSpeedPerSec: 0.06,
    timeMaxExtraSpeed: 8,
    timeGapStepPerSec: 0.035,
    stepEveryMs: 1200,
    stepAddPxPerFrame: 0.45,
    stepMaxExtraPxPerFrame: 9,
  },
};

const PRESET_KEYS = Object.keys(DIFFICULTY_PRESETS);

function nearlyEqual(a, b, eps = 1e-9) {
  if (a === b) return true;
  if (typeof a !== 'number' || typeof b !== 'number') return false;
  return Math.abs(a - b) <= eps;
}

// tenta detectar qual preset bate com o objeto de difficulty atual
function detectPresetFromState(diff) {
  if (!diff) return 'custom';
  for (const name of PRESET_KEYS) {
    const preset = DIFFICULTY_PRESETS[name];
    let ok = true;
    for (const k of Object.keys(preset)) {
      const pv = preset[k];
      const dv = diff[k];
      ok = (typeof pv === 'number') ? nearlyEqual(Number(dv), Number(pv)) : (dv === pv);
      if (!ok) break;
    }
    if (ok) return name;
  }
  return 'custom';
}

// aplica um preset “por cima” do state.difficulty, mantendo o resto intacto
function applyDifficultyPreset(name) {
  const preset = DIFFICULTY_PRESETS[name];
  if (!preset) return;
  state.difficulty = { ...(state.difficulty || {}), ...preset };
  fillForm(state);   // rehidrata inputs
  updatePreview();
  flash(`Preset "${name}" aplicado ✔`);
}

// ------------------------------ DOM helpers -----------------------------------
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function flash(msg, error = false) {
  const el = $('#status'); if (!el) return;
  el.innerHTML = `<span class="${error ? 'err' : 'ok'}">${msg}</span>`;
  setTimeout(() => (el.textContent = ''), 2500);
}
function updatePreview() {
  const pre = $('#jsonPreview'); if (!pre) return;
  pre.textContent = JSON.stringify(state, null, 2);
}
function getSlug() { return localStorage.getItem(SLUG_KEY) || DEFAULT_SLUG; }
function setSlug(slug) { localStorage.setItem(SLUG_KEY, slug || DEFAULT_SLUG); }

function setRole(newRole) {
  role = (newRole === 'master') ? 'master' : 'client';
  document.documentElement.setAttribute('data-role', role);
  applyRoleGating();
  const who = $('#whoami');
  if (who) who.textContent = `${role === 'master' ? 'Master' : 'Client'} (mock)`;
}
function applyRoleGating() {
  const isClient = role !== 'master';
  // desabilita tudo…
  $$('#appView input, #appView select, #appView textarea, #appView button').forEach(el => {
    el.disabled = isClient;
    el.classList.toggle('client-readonly', isClient);
  });

  // …e reabilita Difficulty e Prizes para o cliente
  $$('fieldset[data-scope="difficulty"] input, fieldset[data-scope="difficulty"] select, fieldset[data-scope="difficulty"] textarea, fieldset[data-scope="difficulty"] button, fieldset[data-scope="prizes"] input, fieldset[data-scope="prizes"] button').forEach(el => {
    el.disabled = false;
    el.classList.remove('client-readonly');
  });

  // botões principais sempre ativos
  const loadBtn = $('#loadSupabase');
  const saveBtn = $('#saveSupabase');
  if (loadBtn) loadBtn.disabled = false;
  if (saveBtn) saveBtn.disabled = false;

  // slug: client não altera
  const slugInput = $('#cfgSlug');
  if (slugInput) slugInput.disabled = isClient;
}

function showAuth() {
  $('#authView').style.display = 'block';
  $('#appView').style.display = 'none';
  $('#btnLogout').style.display = 'none';
}
function showApp() {
  $('#authView').style.display = 'none';
  $('#appView').style.display = '';
  $('#btnLogout').style.display = '';
  applyRoleGating();
}

// ---------------------------- Supabase I/O ------------------------------------
async function loadFromSupabase(slug) {
  const { data, error } = await supabase
    .from(SUPABASE_CONFIG_TABLE)
    .select('data')
    .eq('slug', String(slug || DEFAULT_SLUG))
    .maybeSingle();
  if (error) throw error;
  return data?.data || null;
}
async function saveToSupabase(slug, cfg) {
  const payload = {
    slug: String(slug || DEFAULT_SLUG),
    data: cfg || {},
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from(SUPABASE_CONFIG_TABLE)
    .upsert(payload, { onConflict: 'slug' })
    .select('slug, updated_at');
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

// client salva Difficulty + Prizes (apenas campos editáveis)
async function saveClientEditable(slug, patch) {
  const remote = await loadFromSupabase(slug) || {};
  const merged = {
    ...remote,
    difficulty: { ...(remote.difficulty || {}), ...((patch && patch.difficulty) || {}) },
    prizes: Array.isArray(patch?.prizes) ? patch.prizes : (remote.prizes || []),
  };
  return saveToSupabase(slug, merged);
}

// --------------------------- Scores (painel) ----------------------------------
async function loadScores() {
  const list = $('#scoresList');
  if (list) list.innerHTML = `<div class="hint">Carregando…</div>`;
  const groupBox = $('#scoresByGroup');
  if (groupBox) groupBox.innerHTML = `<div class="hint">Carregando…</div>`;

  try {
    const { data, error } = await supabase
      .from(SUPABASE_SCORES_TABLE)
      .select('player_name, score, played_at, prize_group') // inclui prize_group salvo
      .order('score', { ascending: false })
      .limit(200);
    if (error) throw error;

    lastScoresCache = Array.isArray(data) ? data : [];
    renderScoresOverall(lastScoresCache);
    renderScoresByGroups(lastScoresCache);
  } catch (e) {
    if (list) list.innerHTML = `<div class="hint" style="color:#fca5a5">Falha ao carregar scores</div>`;
    if (groupBox) groupBox.innerHTML = `<div class="hint" style="color:#fca5a5">Falha ao carregar grupos</div>`;
  }
}

// --------------------------- Prizes / Groups ----------------------------------
function ensurePrizeArray() {
  if (!Array.isArray(state.prizes)) {
    state.prizes = [
      { min: 1, max: 10, name: 'Grupo A' },
      { min: 10, max: 15, name: 'Grupo B' },
      { min: 15, max: 25, name: 'Grupo C' },
    ];
  }
}
function normalizePrizes(prizes) {
  if (!Array.isArray(prizes)) return [];
  const clean = prizes
    .map(g => ({
      min: Number(g?.min ?? 0),
      max: Number(g?.max ?? 0),
      name: String(g?.name ?? '').trim() || 'Grupo',
    }))
    .filter(g => Number.isFinite(g.min) && Number.isFinite(g.max) && g.max >= g.min);

  clean.sort((a, b) => (a.min - b.min) || (a.max - b.max));
  return clean;
}
// [min, max) e o último grupo é [min, max] (inclusivo no max)
function _inRange(score, g, isLast) {
  return isLast ? (score >= g.min && score <= g.max) : (score >= g.min && score < g.max);
}
function whichPrizeName(score, prizes) {
  const arr = normalizePrizes(prizes);
  for (let i = 0; i < arr.length; i++) {
    if (_inRange(score, arr[i], i === arr.length - 1)) return arr[i].name;
  }
  return null;
}

function renderPrizeGroups() {
  ensurePrizeArray();
  const wrap = $('#prizeGroups');
  if (!wrap) return;
  wrap.innerHTML = '';

  state.prizes.forEach((g, idx) => {
    const row = document.createElement('div');
    row.className = 'prizeRow';
    row.dataset.idx = String(idx);
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.style.alignItems = 'center';

    row.innerHTML = `
      <span class="hint">#${idx + 1}</span>
      <input type="number" class="input-min"  placeholder="min" step="1"  style="width:90px"  value="${g.min ?? ''}">
      <span class="hint">até</span>
      <input type="number" class="input-max"  placeholder="max" step="1"  style="width:90px"  value="${g.max ?? ''}">
      <input type="text"   class="input-name" placeholder="Nome do grupo"   style="min-width:180px" value="${g.name ?? ''}">
      <button class="btn btnDel" type="button">Remover</button>
      <button class="btn btnUp"  type="button" title="Subir">▲</button>
      <button class="btn btnDn"  type="button" title="Descer">▼</button>
    `;

    // listeners
    row.querySelector('.input-min').addEventListener('input', e => {
      const v = e.target.value === '' ? null : Number(e.target.value);
      state.prizes[idx].min = v;
      updatePreview();
      if (lastScoresCache?.length) { renderScoresByGroups(lastScoresCache); }
    });
    row.querySelector('.input-max').addEventListener('input', e => {
      const v = e.target.value === '' ? null : Number(e.target.value);
      state.prizes[idx].max = v;
      updatePreview();
      if (lastScoresCache?.length) { renderScoresByGroups(lastScoresCache); }
    });
    row.querySelector('.input-name').addEventListener('input', e => {
      state.prizes[idx].name = String(e.target.value || '');
      updatePreview();
      if (lastScoresCache?.length) { renderScoresByGroups(lastScoresCache); }
    });
    row.querySelector('.btnDel').addEventListener('click', () => {
      state.prizes.splice(idx, 1);
      renderPrizeGroups(); updatePreview();
      if (lastScoresCache?.length) { renderScoresByGroups(lastScoresCache); }
    });
    row.querySelector('.btnUp').addEventListener('click', () => {
      if (idx <= 0) return;
      const [it] = state.prizes.splice(idx, 1);
      state.prizes.splice(idx - 1, 0, it);
      renderPrizeGroups(); updatePreview();
      if (lastScoresCache?.length) { renderScoresByGroups(lastScoresCache); }
    });
    row.querySelector('.btnDn').addEventListener('click', () => {
      if (idx >= state.prizes.length - 1) return;
      const [it] = state.prizes.splice(idx, 1);
      state.prizes.splice(idx + 1, 0, it);
      renderPrizeGroups(); updatePreview();
      if (lastScoresCache?.length) { renderScoresByGroups(lastScoresCache); }
    });

    wrap.appendChild(row);
  });

  // botão "Adicionar"
  const addBtn = $('#btnAddPrize');
  if (addBtn && !addBtn.dataset.bound) {
    addBtn.dataset.bound = '1';
    addBtn.addEventListener('click', () => {
      ensurePrizeArray();
      state.prizes.push({ min: 0, max: 1, name: 'Novo grupo' });
      renderPrizeGroups(); updatePreview();
      if (lastScoresCache?.length) { renderScoresByGroups(lastScoresCache); }
    });
  }
}

// --------------------------- form/state binding --------------------------------
function getDeep(obj, path) { return path.reduce((o, k) => (o ? o[k] : undefined), obj); }
function setDeep(obj, path, value) {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
    cur = cur[k];
  }
  cur[path[path.length - 1]] = value;
}
function deleteDeep(obj, path) {
  const stack = []; let cur = obj;
  for (let i = 0; i < path.length - 1; i++) { const k = path[i]; if (!cur || typeof cur !== 'object') return; stack.push([cur, k]); cur = cur[k]; }
  if (cur && typeof cur === 'object') delete cur[path[path.length - 1]];
  for (let i = stack.length - 1; i >= 0; i--) {
    const [parent, key] = stack[i]; const child = parent[key];
    if (child && typeof child === 'object' && !Object.keys(child).length) delete parent[key];
  }
}
function fillForm(cfg) {
  for (const input of $$('input')) {
    if (!input.id) continue;
    const path = input.id.split('.');
    const value = getDeep(cfg, path);

    if (input.id === 'controls.jump') {
      input.value = Array.isArray(value) ? value.join(', ') : '';
      continue;
    }
    if (input.type === 'checkbox') { input.checked = Boolean(value); continue; }
    if (input.type === 'range') { if (value != null) input.value = String(value); continue; }
    if (input.type === 'number') {
      if (value != null && value !== '') { input.value = String(value); continue; }
      input.value = '';
      continue;
    }
    input.value = (value ?? '');
  }

  // prizes
  ensurePrizeArray();
  renderPrizeGroups();
  updatePreview();

  // seleciona o preset que mais se aproxima do que está no state
  const presetSel = $('#difficultyPreset');
  if (presetSel) {
    const which = detectPresetFromState(cfg?.difficulty || {});
    presetSel.value = which;
  }
}
function onInputChange(e) {
  const input = e.target;
  if (!input.id) return;
  const path = input.id.split('.');
  let value;

  if (input.id === 'controls.jump') {
    const arr = input.value.split(/[,;\n]/g).map(s => s.trim()).filter(Boolean);
    if (!arr.length) { deleteDeep(state, path); updatePreview(); return; }
    value = arr;
  } else if (input.type === 'checkbox') {
    value = input.checked;
  } else if (input.type === 'number' || input.type === 'range') {
    if (input.value === '') { deleteDeep(state, path); updatePreview(); return; }
    value = Number(input.value);
  } else {
    if (input.value === '') { deleteDeep(state, path); updatePreview(); return; }
    value = input.value;
  }

  setDeep(state, path, value);
  updatePreview();

  if (path[0] === 'difficulty' || path[0] === 'prizes') {
    // qualquer edição manual de difficulty sinaliza “custom”
    if (path[0] === 'difficulty') {
      const presetSel = $('#difficultyPreset');
      if (presetSel) presetSel.value = 'custom';
    }
    if (lastScoresCache?.length) {
      renderScoresByGroups(lastScoresCache);
    }
  }
}
function attachInputListeners() {
  for (const input of $$('input')) {
    if (!input.id || input.dataset.bound === '1') continue;
    input.dataset.bound = '1';
    input.addEventListener('input', onInputChange);
    if (input.type === 'checkbox' || input.type === 'range') {
      input.addEventListener('change', onInputChange);
    }
  }
}

function wireDifficultyPresetControls() {
  const sel = $('#difficultyPreset');
  const btn = $('#applyPreset');

  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      const name = (sel?.value || 'custom');
      if (name === 'custom') {
        flash('Escolha Fácil, Médio ou Difícil para aplicar.', true);
        return;
      }
      applyDifficultyPreset(name);
    });
  }
}

// ------------------------------ ações UI --------------------------------------
async function onLoadSupabase() {
  try {
    const remote = await loadFromSupabase(getSlug());
    if (remote) {
      state = remote;
      fillForm(state);
      flash(`Config carregada (${getSlug()}) ✔`);
    } else {
      state = {};
      fillForm(state);
      flash('Nenhum registro para este slug — salve para criar.', true);
    }
  } catch (e) {
    console.error('[Supabase] select error:', e);
    flash('Falha ao carregar do Supabase', true);
  }
}
async function onSaveSupabase() {
  try {
    let row;
    if (role === 'master') {
      row = await saveToSupabase(getSlug(), state);
    } else {
      // cliente salva apenas campos editáveis
      const patch = {
        difficulty: state?.difficulty || {},
        prizes: Array.isArray(state?.prizes) ? state.prizes : [],
      };
      row = await saveClientEditable(getSlug(), patch);
    }
    flash(`Config salva (${row?.slug || getSlug()}) ✔`);
  } catch (e) {
    console.error('[Supabase] upsert error:', e);
    flash(`Falha ao salvar: ${e?.message || e}`, true);
  }
}

function wireHeader() {
  const slugInput = $('#cfgSlug');
  if (slugInput) {
    slugInput.value = getSlug();
    slugInput.addEventListener('change', e => setSlug(String(e.target.value || '').trim() || DEFAULT_SLUG));
  }
  $('#loadSupabase')?.addEventListener('click', onLoadSupabase);
  $('#saveSupabase')?.addEventListener('click', onSaveSupabase);
  $('#btnLogout')?.addEventListener('click', () => {
    setRole('client');
    const who = $('#whoami');
    if (who) who.textContent = 'Deslogado';
    showAuth();
  });
}

function checkMockCredentials(email, password) {
  if (email === MOCK_CREDENTIALS.master.email && password === MOCK_CREDENTIALS.master.password) return 'master';
  if (email === MOCK_CREDENTIALS.client.email && password === MOCK_CREDENTIALS.client.password) return 'client';
  return null;
}
function wireAuthView() {
  $('#doSignIn')?.addEventListener('click', async () => {
    const email = ($('#authEmail')?.value || '').trim();
    const password = $('#authPass')?.value || '';
    const r = checkMockCredentials(email, password);
    if (!r) {
      const msg = $('#authMsg'); if (msg) msg.textContent = 'Credenciais inválidas.';
      return;
    }
    const msg = $('#authMsg'); if (msg) msg.textContent = '';
    setRole(r);
    const who = $('#whoami'); if (who) who.textContent = `${email} (${r})`;
    showApp();
    await onLoadSupabase();
    await loadScores();
    flash('Login ok ✔');
  });
}

// --------------------------- Render dos painéis --------------------------------
function renderScoresOverall(rows) {
  const list = $('#scoresList');
  if (!list) return;
  if (!rows || !rows.length) {
    list.innerHTML = `<div class="hint">Sem scores ainda.</div>`;
    return;
  }
  list.innerHTML = rows.map((r, i) => `
    <div class="scoreItem">
      <div class="rank">#${i + 1}</div>
      <div>
        <div>${escapeHtml(r.player_name || 'Anônimo')}</div>
        ${r.played_at ? `<div class="hint">${new Date(r.played_at).toLocaleString()}</div>` : ''}
        ${r.prize_group ? `<div class="hint">Grupo: ${escapeHtml(r.prize_group)}</div>` : ''}
      </div>
      <div class="pts">${r.score ?? 0}</div>
    </div>
  `).join('');
}

function renderScoresByGroups(rows) {
  // destino preferencial
  let box = $('#scoresByGroup');
  const usingFallback = !box;
  if (!box) {
    // se não houver #scoresByGroup, injeta uma seção no topo do #scoresList (sem quebrar CSS)
    const list = $('#scoresList');
    if (!list) return;
    box = document.createElement('div');
    box.id = 'scoresByGroup';
    list.parentNode.insertBefore(box, list);
  }

  const prizes = normalizePrizes(state.prizes || []);
  if (!rows?.length) {
    box.innerHTML = `<div class="hint">Sem scores ainda.</div>`;
    return;
  }

  // monta grupos: usa prize_group salvo se existir; caso contrário, calcula pelo range atual
  const groups = new Map(); // name -> array rows
  const nameFor = (r) => r.prize_group || whichPrizeName(Number(r.score || 0), prizes) || 'Sem grupo';
  rows.forEach(r => {
    const name = nameFor(r);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(r);
  });

  // ordena grupos pela ordem em prizes, depois alfabético
  const orderMap = new Map(prizes.map((g, i) => [g.name, i]));
  const sortedGroupNames = Array.from(groups.keys()).sort((a, b) => {
    const ia = orderMap.has(a) ? orderMap.get(a) : 9999;
    const ib = orderMap.has(b) ? orderMap.get(b) : 9999;
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b);
  });

  const html = sortedGroupNames.map(gname => {
    const arr = groups.get(gname).slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const items = arr.map((r, i) => `
      <div class="scoreItem">
        <div class="rank">#${i + 1}</div>
        <div>
          <div>${escapeHtml(r.player_name || 'Anônimo')}</div>
          ${r.played_at ? `<div class="hint">${new Date(r.played_at).toLocaleString()}</div>` : ''}
        </div>
        <div class="pts">${r.score ?? 0}</div>
      </div>
    `).join('');
    return `
      <div style="margin:10px 0 4px; font-weight:700">${escapeHtml(gname)}</div>
      <div>${items || `<div class="hint">Sem jogadores.</div>`}</div>
    `;
  }).join('');

  box.innerHTML = `
    <h2 style="margin:8px 0 6px">Ranking por Grupo</h2>
    ${html || `<div class="hint">Sem grupos configurados.</div>`}
    ${usingFallback ? `<hr style="border:none;border-top:1px dashed var(--line);margin:8px 0 12px">` : ''}
  `;
}

// ------------------------------ utils -----------------------------------------
function escapeHtml(s) {
  return String(s).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
}

// ----------------------------------- boot -------------------------------------
window.addEventListener('DOMContentLoaded', async () => {
  // start como client (somente Difficulty/Prizes editáveis)
  setRole('client');
  showAuth();

  wireHeader();
  wireAuthView();
  attachInputListeners();
  wireDifficultyPresetControls();
});
