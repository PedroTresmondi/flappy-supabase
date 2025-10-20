// src/config.js — Mock login (master/client) + RBAC + Supabase I/O
"use strict";

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
    $$(
        'fieldset[data-scope="difficulty"] input,' +
        'fieldset[data-scope="difficulty"] select,' +
        'fieldset[data-scope="difficulty"] textarea,' +
        'fieldset[data-scope="difficulty"] button,' +
        'fieldset[data-scope="prizes"] input,' +
        'fieldset[data-scope="prizes"] button'
    ).forEach(el => {
        el.disabled = false;
        el.classList.remove('client-readonly');
    });

    // botões principais sempre ativos
    $('#loadSupabase').disabled = false;
    $('#saveSupabase').disabled = false;

    // slug: client não altera
    const slugInput = $('#cfgSlug');
    if (slugInput) slugInput.disabled = isClient;
}

// --------------------------- Prizes (UI + helpers) -----------------------------
function ensurePrizeArray() {
    if (!Array.isArray(state.prizes)) {
        state.prizes = [
            { min: 1, max: 10, name: 'Grupo A' },
            { min: 10, max: 15, name: 'Grupo B' },
            { min: 15, max: 25, name: 'Grupo C' },
        ];
    }
}
function normalizePrizes(arr) {
    if (!Array.isArray(arr)) return [];
    // limpa valores, garante números e ordena por min crescente
    const clean = arr
        .map(g => ({
            min: (g.min ?? 0) * 1,
            max: (g.max ?? 0) * 1,
            name: String(g.name ?? '').trim() || 'Grupo'
        }))
        .filter(g => Number.isFinite(g.min) && Number.isFinite(g.max) && g.max >= g.min);
    clean.sort((a, b) => (a.min - b.min) || (a.max - b.max));
    return clean;
}
function inRange(score, g, isLast) {
    // regra: [min, max) e para o último grupo considerar max inclusivo
    if (isLast) return score >= g.min && score <= g.max;
    return score >= g.min && score < g.max;
}
function whichPrizeName(score, prizes) {
    const arr = normalizePrizes(prizes);
    if (!arr.length) return null;
    for (let i = 0; i < arr.length; i++) {
        if (inRange(score, arr[i], i === arr.length - 1)) return arr[i].name;
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
        Object.assign(row.style, { display: 'flex', gap: '8px', alignItems: 'center' });

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
        });
        row.querySelector('.input-max').addEventListener('input', e => {
            const v = e.target.value === '' ? null : Number(e.target.value);
            state.prizes[idx].max = v;
            updatePreview();
        });
        row.querySelector('.input-name').addEventListener('input', e => {
            state.prizes[idx].name = String(e.target.value || '');
            updatePreview();
        });
        row.querySelector('.btnDel').addEventListener('click', () => {
            state.prizes.splice(idx, 1);
            renderPrizeGroups(); updatePreview();
        });
        row.querySelector('.btnUp').addEventListener('click', () => {
            if (idx <= 0) return;
            const [it] = state.prizes.splice(idx, 1);
            state.prizes.splice(idx - 1, 0, it);
            renderPrizeGroups(); updatePreview();
        });
        row.querySelector('.btnDn').addEventListener('click', () => {
            if (idx >= state.prizes.length - 1) return;
            const [it] = state.prizes.splice(idx, 1);
            state.prizes.splice(idx + 1, 0, it);
            renderPrizeGroups(); updatePreview();
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
        });
    }
}

// ------------------------------ Auth Views ------------------------------------
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

// client salva SÓ difficulty (compat)
async function saveDifficultyOnly(slug, diffPartial) {
    const remote = await loadFromSupabase(slug) || {};
    const merged = { ...remote, difficulty: { ...(remote.difficulty || {}), ...(diffPartial || {}) } };
    return saveToSupabase(slug, merged);
}

// client salva difficulty **e** prizes (novo)
async function saveDifficultyAndPrizesOnly(slug, diffPartial, prizesArr) {
    const remote = await loadFromSupabase(slug) || {};
    const merged = {
        ...remote,
        difficulty: { ...(remote.difficulty || {}), ...(diffPartial || {}) },
        prizes: Array.isArray(prizesArr) ? prizesArr : [],
    };
    return saveToSupabase(slug, merged);
}

// --------------------------- Scores (painel) ----------------------------------
function renderScoresView(rows) {
    const host = $('#scoresList');
    if (!host) return;

    const prizes = normalizePrizes(state.prizes || []);
    const isGrouped = prizes.length > 0;

    // mapeia por grupo
    const groups = prizes.map((g, i) => ({
        label: `${g.name} (${g.min}–${i === prizes.length - 1 ? g.max : g.max - 1})`,
        min: g.min, max: g.max, isLast: i === prizes.length - 1, items: []
    }));

    const ungrouped = []; // scores fora de faixa (caso ranges não cubram tudo)

    // distribui
    rows.forEach(r => {
        const s = Number(r.score || 0);
        let placed = false;
        for (const g of groups) {
            if (inRange(s, g, g.isLast)) { g.items.push(r); placed = true; break; }
        }
        if (!placed) ungrouped.push(r);
    });

    // ordena cada grupo desc
    groups.forEach(g => g.items.sort((a, b) => (b.score || 0) - (a.score || 0)));
    const overall = rows.slice().sort((a, b) => (b.score || 0) - (a.score || 0));

    // HTML
    let html = '';

    if (isGrouped) {
        html += `<h3 style="margin:12px 0 6px">Ranking por grupo</h3>`;
        groups.forEach(g => {
            html += `
        <div class="groupBlock" style="margin:8px 0 12px">
          <div class="hint" style="margin:2px 0 8px">${g.label}</div>
          ${g.items.length
                    ? g.items.map((r, i) => `
              <div class="scoreItem">
                <div class="rank">#${i + 1}</div>
                <div>
                  <div>${r.player_name || 'Anônimo'}</div>
                  ${r.played_at ? `<div class="hint">${new Date(r.played_at).toLocaleString()}</div>` : ''}
                </div>
                <div class="pts">${r.score ?? 0}</div>
              </div>
            `).join('')
                    : `<div class="hint">Sem jogadores neste grupo.</div>`
                }
        </div>
      `;
        });

        if (ungrouped.length) {
            ungrouped.sort((a, b) => (b.score || 0) - (a.score || 0));
            html += `
        <div class="groupBlock" style="margin:8px 0 12px">
          <div class="hint" style="margin:2px 0 8px">Fora de faixa</div>
          ${ungrouped.map((r, i) => `
            <div class="scoreItem">
              <div class="rank">#${i + 1}</div>
              <div>
                <div>${r.player_name || 'Anônimo'}</div>
                ${r.played_at ? `<div class="hint">${new Date(r.played_at).toLocaleString()}</div>` : ''}
              </div>
              <div class="pts">${r.score ?? 0}</div>
            </div>
          `).join('')}
        </div>
      `;
        }
    }

    // geral
    html += `<h3 style="margin:14px 0 6px">Ranking geral</h3>`;
    html += overall.length
        ? overall.map((r, i) => `
        <div class="scoreItem">
          <div class="rank">#${i + 1}</div>
          <div>
            <div>${r.player_name || 'Anônimo'}</div>
            ${r.played_at ? `<div class="hint">${new Date(r.played_at).toLocaleString()}</div>` : ''}
            ${isGrouped ? (() => {
                const n = whichPrizeName(Number(r.score || 0), prizes);
                return n ? `<div class="hint">Grupo: ${n}</div>` : '';
            })() : ''
            }
          </div>
          <div class="pts">${r.score ?? 0}</div>
        </div>
      `).join('')
        : `<div class="hint">Sem scores ainda.</div>`;

    host.innerHTML = html;
}

async function loadScores() {
    const list = $('#scoresList');
    if (list) list.innerHTML = `<div class="hint">Carregando…</div>`;
    try {
        const { data, error } = await supabase
            .from(SUPABASE_SCORES_TABLE)
            .select('player_name, score, played_at')
            .order('score', { ascending: false })
            .limit(50);
        if (error) throw error;
        renderScoresView(Array.isArray(data) ? data : []);
    } catch (e) {
        if (list) list.innerHTML = `<div class="hint" style="color:#fca5a5">Falha ao carregar scores</div>`;
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
      input.value = (value ?? '');
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

// ------------------------------ ações UI --------------------------------------
async function onLoadSupabase() {
    try {
        const remote = await loadFromSupabase(getSlug());
        if (remote) {
            state = remote;
            ensurePrizeArray(); // garante estrutura antes de render
        fillForm(state); updatePreview();
            renderPrizeGroups();
        flash(`Config carregada (${getSlug()}) ✔`);
    } else {
        state = {};
            ensurePrizeArray();
        fillForm(state); updatePreview();
            renderPrizeGroups();
        flash('Nenhum registro para este slug — salve para criar.', true);
    }
        await loadScores();
  } catch (e) {
      console.error('[Supabase] select error:', e);
      flash('Falha ao carregar do Supabase', true);
  }
}
async function onSaveSupabase() {
    try {
        let row;
        if (role === 'master') {
            row = await saveToSupabase(getSlug(), state); // salva tudo (inclui prizes)
        } else {
            // client: salva apenas Difficulty + Prizes
            const diff = state?.difficulty || {};
            const prizes = Array.isArray(state?.prizes) ? state.prizes : [];
            row = await saveDifficultyAndPrizesOnly(getSlug(), diff, prizes);
        }
        flash(`Config salva (${row?.slug || getSlug()}) ✔`);
        await loadScores(); // recarrega painel com possíveis grupos alterados
    } catch (e) {
        console.error('[Supabase] upsert error:', e);
      flash(`Falha ao salvar: ${e?.message || e}`, true);
  }
}

function wireHeader() {
    const slugInput = $('#cfgSlug');
    slugInput.value = getSlug();
    slugInput.addEventListener('change', e => setSlug(String(e.target.value || '').trim() || DEFAULT_SLUG));
    $('#loadSupabase').addEventListener('click', onLoadSupabase);
    $('#saveSupabase').addEventListener('click', onSaveSupabase);
    $('#btnLogout').addEventListener('click', () => {
        setRole('client');
        $('#whoami').textContent = 'Deslogado';
        showAuth();
    });
}

function checkMockCredentials(email, password) {
    if (email === MOCK_CREDENTIALS.master.email && password === MOCK_CREDENTIALS.master.password) return 'master';
    if (email === MOCK_CREDENTIALS.client.email && password === MOCK_CREDENTIALS.client.password) return 'client';
    return null;
}
function wireAuthView() {
    $('#doSignIn').addEventListener('click', async () => {
        const email = ($('#authEmail').value || '').trim();
        const password = $('#authPass').value || '';
        const r = checkMockCredentials(email, password);
        if (!r) {
            $('#authMsg').textContent = 'Credenciais inválidas.';
            return;
        }
        $('#authMsg').textContent = '';
        setRole(r);
        $('#whoami').textContent = `${email} (${r})`;
        showApp();
        await onLoadSupabase();
      flash('Login ok ✔');
  });
}

// ----------------------------------- boot -------------------------------------
window.addEventListener('DOMContentLoaded', async () => {
    // start como client (somente Difficulty/Prizes editáveis)
    setRole('client');
    showAuth();

    wireHeader();
    wireAuthView();
    attachInputListeners();

    // UI de prêmios aparece mesmo antes de carregar (com defaults),
    // e será atualizada quando o load do Supabase chegar.
    ensurePrizeArray();
    renderPrizeGroups();
});
