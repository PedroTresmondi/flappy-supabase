// src/config.js — Mock login (master/client) + RBAC + Supabase I/O
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
    $$('#appView input, #appView select, #appView textarea').forEach(el => {
        el.disabled = isClient;
        el.classList.toggle('client-readonly', isClient);
    });
    // …e reabilita Difficulty
    $$('fieldset[data-scope="difficulty"] input, fieldset[data-scope="difficulty"] select, fieldset[data-scope="difficulty"] textarea').forEach(el => {
        el.disabled = false;
        el.classList.remove('client-readonly');
    });
    // botões sempre ativos
    $('#loadSupabase').disabled = false;
    $('#saveSupabase').disabled = false;
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
// client salva SÓ difficulty
async function saveDifficultyOnly(slug, diffPartial) {
    const remote = await loadFromSupabase(slug) || {};
    const merged = { ...remote, difficulty: { ...(remote.difficulty || {}), ...(diffPartial || {}) } };
    return saveToSupabase(slug, merged);
}

// --------------------------- Scores (painel) ----------------------------------
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
        if (!list) return;
        list.innerHTML = (data && data.length)
            ? data.map((r, i) => `
         <div class="scoreItem">
           <div class="rank">#${i + 1}</div>
           <div>
            <div>${r.player_name || 'Anônimo'}</div>
            ${r.played_at ? `<div class="hint">${new Date(r.played_at).toLocaleString()}</div>` : ''}
           </div>
           <div class="pts">${r.score ?? 0}</div>
         </div>`).join('')
            : `<div class="hint">Sem scores ainda.</div>`;
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
        fillForm(state); updatePreview();
        flash(`Config carregada (${getSlug()}) ✔`);
    } else {
        state = {};
        fillForm(state); updatePreview();
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
            const diff = state?.difficulty || {};
            row = await saveDifficultyOnly(getSlug(), diff);
        }
        flash(`Config salva (${row?.slug || getSlug()}) ✔`);
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
      await loadScores();
      flash('Login ok ✔');
  });
}

// ----------------------------------- boot -------------------------------------
window.addEventListener('DOMContentLoaded', async () => {
    // start como client (somente Difficulty visível)
    setRole('client');
    showAuth();

    wireHeader();
    wireAuthView();
    attachInputListeners();
});
