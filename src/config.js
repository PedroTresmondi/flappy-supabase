// config.js — 100% Supabase (lê no boot e salva no Supabase)
import { supabase } from './supabase.js';

const SUPABASE_CONFIG_TABLE = 'flappy_config';
const SLUG_KEY = 'flappy:configSlug';
const DEFAULT_SLUG = 'default';

let state = {}; // sem defaults — o que existir no Supabase é o que vale

// ------------------------------ helpers DOM -----------------------------------
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function flash(msg, error = false) {
    const el = $('#status');
    if (!el) return;
    el.innerHTML = `<span class="${error ? 'err' : 'ok'}">${msg}</span>`;
    setTimeout(() => (el.textContent = ''), 2500);
}

function updatePreview() {
    const pre = $('#jsonPreview');
    if (!pre) return;
    pre.textContent = JSON.stringify(state, null, 2);
}

function syncRangeOutputs() {
    document.querySelectorAll('input[type="range"]').forEach((inp) => {
        const out = document.querySelector(`output[for="${inp.id}"]`);
        if (out) out.textContent = inp.value;
    });
}

function hideLocalButtons() {
    ['saveLocal', 'loadLocal', 'resetDefaults'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
}

// ------------------------------ slug helpers ----------------------------------
function getSlug() {
    return localStorage.getItem(SLUG_KEY) || DEFAULT_SLUG;
}
function setSlug(slug) {
    localStorage.setItem(SLUG_KEY, slug || DEFAULT_SLUG);
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

    const { data, error, status } = await supabase
        .from(SUPABASE_CONFIG_TABLE)
        .upsert(payload, { onConflict: 'slug' })
        .select('slug, updated_at'); // evita .single() por edge-cases

    if (error) {
        console.group('[Supabase] upsert error');
        console.log('status:', status);
        console.log('payload:', payload);
        console.error(error);
        console.groupEnd();
        throw error;
    }

    return Array.isArray(data) ? data[0] : data;
}

// --------------------------- form/state binding --------------------------------
function getDeep(obj, path) {
    return path.reduce((o, k) => (o ? o[k] : undefined), obj);
}

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
    const stack = [];
    let cur = obj;
    for (let i = 0; i < path.length - 1; i++) {
        const k = path[i];
        if (!cur || typeof cur !== 'object') return; // nada a fazer
        stack.push([cur, k]);
        cur = cur[k];
    }
    if (cur && typeof cur === 'object') delete cur[path[path.length - 1]];

    // prune objetos vazios de trás pra frente
    for (let i = stack.length - 1; i >= 0; i--) {
        const [parent, key] = stack[i];
        const child = parent[key];
        if (child && typeof child === 'object' && !Object.keys(child).length) {
            delete parent[key];
        }
    }
}

function fillForm(cfg) {
    for (const input of $$('input')) {
        if (!input.id) continue;
        const path = input.id.split('.');

        const value = getDeep(cfg, path);

        if (input.id === 'assets.birdFrames' || input.id === 'controls.jump') {
            input.value = Array.isArray(value) ? value.join(', ') : '';
            continue;
        }

        if (input.type === 'checkbox') {
            input.checked = Boolean(value);
            continue;
        }

        if (input.type === 'range') {
            if (value != null) input.value = String(value);
            continue;
        }

        // number/text
        input.value = value ?? '';
    }
}

function onInputChange(e) {
    const input = e.target;
    const path = input.id.split('.');
    let value;

    if (input.id === 'assets.birdFrames' || input.id === 'controls.jump') {
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
    if (input.type === 'range') {
        const out = document.querySelector(`output[for="${input.id}"]`);
        if (out) out.textContent = String(value);
    }
    updatePreview();
}

function attachInputListeners() {
    for (const input of $$('input')) {
        if (!input.id) continue;
        if (input.dataset.bound === '1') continue;
        input.dataset.bound = '1';
        input.addEventListener('input', onInputChange);
        if (input.type === 'checkbox' || input.type === 'range') {
            input.addEventListener('change', onInputChange);
        }
    }
}

// ------------------------------ ações UI --------------------------------------
function injectSupabaseControls() {
    const actions = document.querySelector('header .actions') || $('.actions') || document.body;

    if (!document.getElementById('cfgSlug')) {
        const slugInput = document.createElement('input');
        slugInput.id = 'cfgSlug';
        slugInput.type = 'text';
        slugInput.placeholder = 'slug (ex: default)';
        slugInput.value = getSlug();
        Object.assign(slugInput.style, {
            width: '160px', padding: '8px 12px', border: '1px solid var(--btnb)',
            background: 'var(--btn)', color: 'var(--ink)', borderRadius: '10px'
        });
        slugInput.title = 'Slug usado na tabela flappy_config';
        actions.appendChild(slugInput);
        slugInput.addEventListener('change', (e) => setSlug(String(e.target.value || '').trim() || DEFAULT_SLUG));
    }

    if (!document.getElementById('saveSupabase')) {
        const btn = document.createElement('button');
        btn.id = 'saveSupabase';
        btn.className = 'btn';
        btn.textContent = 'Salvar no Supabase';
        btn.addEventListener('click', onSaveSupabase);
        actions.appendChild(btn);
    }

    if (!document.getElementById('loadSupabase')) {
        const btn = document.createElement('button');
        btn.id = 'loadSupabase';
        btn.className = 'btn';
        btn.textContent = 'Carregar do Supabase';
        btn.addEventListener('click', onLoadSupabase);
        actions.appendChild(btn);
    }
}

async function onLoadSupabase() {
    try {
        const remote = await loadFromSupabase(getSlug());
        if (remote) {
            state = remote;
            fillForm(state);
            syncRangeOutputs();
            updatePreview();
            flash(`Config carregada do Supabase (${getSlug()}) ✔`);
        } else {
            state = {};
            fillForm(state);
            syncRangeOutputs();
            updatePreview();
            flash('Nenhum registro para este slug — preencha e salve para criar.', true);
        }
    } catch (e) {
        console.error('[Supabase] select error:', e);
        flash('Falha ao carregar do Supabase', true);
    }
}

async function onSaveSupabase() {
    try {
        const row = await saveToSupabase(getSlug(), state);
        flash(`Config salva no Supabase (${row?.slug || getSlug()}) ✔`);
    } catch (e) {
        console.error('[Supabase] upsert error:', e);
        const msg = e?.message || String(e);
        flash(`Falha ao salvar no Supabase: ${msg}`, true);
    }
}

// Opcional: export/import/copy já presentes no seu HTML
function wireOptionalActions() {
    $('#exportJson')?.addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'flappy-config.json';
        a.click();
        URL.revokeObjectURL(a.href);
        flash('Arquivo exportado');
    });

    $('#importFile')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            const obj = JSON.parse(text);
            state = obj && typeof obj === 'object' ? obj : {};
            fillForm(state);
            syncRangeOutputs();
            updatePreview();
            flash('JSON importado (clique "Salvar no Supabase" para persistir)');
        } catch {
            flash('Falha ao importar JSON', true);
        } finally {
            e.target.value = '';
        }
    });

    $('#copyJson')?.addEventListener('click', () => {
        const text = JSON.stringify(state, null, 2);
        navigator.clipboard.writeText(text).then(
            () => flash('JSON copiado'),
            () => flash('Não foi possível copiar', true)
        );
    });
}

// ----------------------------------- boot -------------------------------------
window.addEventListener('DOMContentLoaded', async () => {
    hideLocalButtons();       // some botões de storage local/defaults
    injectSupabaseControls(); // slug + salvar/carregar Supabase
    wireOptionalActions();

    // 1) Carrega do Supabase (fonte de verdade)
    try {
        const remote = await loadFromSupabase(getSlug());
        if (remote) {
            state = remote;
            flash(`Config carregada do Supabase (${getSlug()}) ✔`);
        } else {
            state = {};
            flash('Nenhum registro encontrado — preencha e salve para criar.');
        }
    } catch (e) {
        console.error(e);
        state = {};
        flash('Falha ao ler do Supabase (ver console).', true);
    }

    // 2) Renderiza e liga listeners
    fillForm(state);
    syncRangeOutputs();
    updatePreview();
    attachInputListeners();
});
