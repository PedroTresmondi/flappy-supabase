import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

const PORT = process.env.PORT || 8787;
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve('./data');

const SCORES_FILE = path.join(DATA_DIR, 'scores.jsonl'); // um score por linha
const CONFIG_DIR  = path.join(DATA_DIR, 'config');        // 1 arquivo por slug

// ============ util: FS inic. e locks simples ============
async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  // garante arquivo de scores
  try { await fs.access(SCORES_FILE); }
  catch { await fs.writeFile(SCORES_FILE, '', 'utf8'); }
}

let lock = Promise.resolve();
function withLock(task) {
  lock = lock.then(task, task);
  return lock;
}

// escrita atômica: escreve em .tmp e renomeia
async function atomicWrite(file, content) {
  const tmp = file + '.tmp_' + Date.now();
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, file);
}

// carrega todos os scores em memória (parse do JSONL)
// para nosso volume/local, ok. Se crescer, dá pra paginar/stream.
async function readAllScores() {
  try {
    const txt = await fs.readFile(SCORES_FILE, 'utf8');
    if (!txt) return [];
    const lines = txt.split(/\r?\n/).filter(Boolean);
    const rows = [];
    for (const ln of lines) {
      try { rows.push(JSON.parse(ln)); } catch {}
    }
    return rows;
  } catch {
    return [];
  }
}

// ============ endpoints ============
app.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// POST /scores  => grava 1 score (append JSONL)
app.post('/scores', async (req, res) => {
  const b = req.body || {};

  // validação mínima & normalização
  const row = {
    run_id: String(b.run_id || ''),
    player_name: String(b.player_name || 'Anônimo').slice(0, 80),
    score: Number.isFinite(+b.score) ? +b.score : 0,
    played_at: b.played_at ? String(b.played_at) : new Date().toISOString(),
    prize_group: b.prize_group != null ? String(b.prize_group) : null,
    meta: typeof b.meta === 'object' && b.meta ? b.meta : {}
  };

  if (!row.run_id) {
    // se não vier, gera 1 (mantém compatibilidade)
    row.run_id = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  try {
    await withLock(async () => {
      const line = JSON.stringify(row) + os.EOL;
      await fs.appendFile(SCORES_FILE, line, 'utf8');
    });
    res.status(201).json({ ok: true });
  } catch (e) {
    console.error('[POST /scores] erro:', e);
    res.status(500).json({ ok: false, error: 'write_failed' });
  }
});

// GET /scores/top10 => top 10 por score (desc)
app.get('/scores/top10', async (req, res) => {
  try {
    const rows = await readAllScores();
    rows.sort((a, b) => (b.score || 0) - (a.score || 0));
    const top = rows.slice(0, 10).map(r => ({
      player_name: r.player_name ?? 'Anônimo',
      score: r.score ?? 0,
      played_at: r.played_at ?? null
    }));
    res.json(top);
  } catch (e) {
    console.error('[GET /scores/top10] erro:', e);
    res.status(500).json({ ok: false, error: 'read_failed' });
  }
});

// GET /scores/rank?score=123 => devolve { position }
app.get('/scores/rank', async (req, res) => {
  const s = Number(req.query.score);
  const score = Number.isFinite(s) ? s : 0;
  try {
    const rows = await readAllScores();
    const greater = rows.reduce((acc, r) => acc + ((r.score || 0) > score ? 1 : 0), 0);
    res.json({ position: greater + 1 });
  } catch (e) {
    console.error('[GET /scores/rank] erro:', e);
    res.status(500).json({ ok: false, error: 'read_failed' });
  }
});

// GET /config/:slug => { data: {...} } (compatível com supabase .select('data'))
app.get('/config/:slug', async (req, res) => {
  const slug = String(req.params.slug || 'default');
  const file = path.join(CONFIG_DIR, `${slug}.json`);
  try {
    const txt = await fs.readFile(file, 'utf8');
    const json = JSON.parse(txt);
    res.json({ data: json.data ?? {} });
  } catch {
    // se não existir, devolve vazio
    res.json({ data: {} });
  }
});

// POST /config/:slug  body: { data: {...} }
app.post('/config/:slug', async (req, res) => {
  const slug = String(req.params.slug || 'default');
  const file = path.join(CONFIG_DIR, `${slug}.json`);
  const body = req.body || {};
  const data = body.data && typeof body.data === 'object' ? body.data : {};

  const payload = { slug, data, updatedAt: new Date().toISOString() };

  try {
    await withLock(() => atomicWrite(file, JSON.stringify(payload, null, 2)));
    res.json({ ok: true });
  } catch (e) {
    console.error('[POST /config/:slug] erro:', e);
    res.status(500).json({ ok: false, error: 'write_failed' });
  }
});

// start
await ensureDirs();
app.listen(PORT, () => {
  console.log(`[planb-api] rodando em http://localhost:${PORT}`);
});
