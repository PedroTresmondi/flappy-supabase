
"use strict";

/* =====================================================================================
   VISÃO GERAL DO FLUXO
   1) boot()        -> instala fonte, carrega config, prepara canvas/assets/controles, cria overlays e mostra tela inicial.
   2) startGame()   -> valida cadastro, reseta estado, para BG passivo e inicia o loop tick().
   3) tick()        -> desenha BG, HUD, pássaro, move/colide canos, aplica física e trata morte.
   4) startDeathSequence() -> congela BG/canos, faz flash+freeze, pássaro cai; ao sair da tela: gameOver().
   5) gameOver()    -> encerra loop, salva score e busca ranking em paralelo, abre overlay de rank imediatamente.
   6) finalizeAndReset()   -> limpa estado e volta para tela inicial com BG passivo.

   ANOTAÇÕES
   - Dimensões alvo: 1080×1920 (o jogo escala uniformemente a partir de 360×640).
   - Controles padrão: Space/ArrowUp/KeyX e toque/pointer.
   ===================================================================================== */

/* ============================= IMPORTS ============================================= */
import { supabase } from './supabase';
import { ensureCadastro, getLocalPlayer } from './ui/cadastroModal';
import { installPixellari, waitPixellari, applyPixellariToCfg } from './ui/fontLoader';

/* ============================= BASE & PATHS ======================================== */
// Compatível com GitHub Pages: prefixa assets com BASE
const BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL)
  ? import.meta.env.BASE_URL
  : '/';
const joinBase = (p) => {
  if (!p) return '';
  const s = String(p);
  if (/^(https?:|data:|blob:)/i.test(s)) return s;
  return BASE + s.replace(/^\//, '');
};

/* ============================= CONSTANTES EDITÁVEIS ================================= */
// Storage/local config
const KEY = 'flappy:config';
const CONFIG_SLUG = localStorage.getItem('flappy:configSlug') || 'default';

// Supabase
const SUPABASE_SCORES_TABLE = 'scores';
const SUPABASE_CONFIG_TABLE = 'flappy_config';

// Mundo base (lógico) e alvo visual (render)
const BASE_W = 360, BASE_H = 640;
const TARGET_W = 1080, TARGET_H = 1920;

// Assets padrão (devem existir em public/assets/img/)
const DEFAULT_SFX = {
  flap: 'assets/sounds/sfx_wing.wav',
  score: 'assets/sounds/sfx_point.wav',
  hit: 'assets/sounds/sfx_hit.wav',
};

const DEFAULT_ASSETS = {
  birdFrames: [
    'assets/img/flappybird1.png',
    'assets/img/flappybird2.png',
    'assets/img/flappybird3.png',
  ],
  topPipe: 'assets/img/toppipe.png',
  bottomPipe: 'assets/img/bottompipe.png',
  bg: 'assets/img/bg_2160x1920.png'
};

// UI estática
const UI_ASSETS = {
  title: joinBase('assets/img/logo.png'),
  heroBird: joinBase('assets/img/flappybird.png'),
  hand: joinBase('assets/img/handClick.png'),
  play: joinBase('assets/img/play.png'),
  ranking: joinBase('assets/img/ranking.png'),
};

/* ============================= CONFIG PADRÃO ======================================== */
const DEFAULT_CONFIG = {
  board: { width: BASE_W, height: BASE_H, background: '#70c5ce' },

  assets: { ...DEFAULT_ASSETS, sfx: { flap: '', score: '', hit: '' } },
  sfx: { flap: DEFAULT_SFX.flap, score: DEFAULT_SFX.score, hit: DEFAULT_SFX.hit },
  bg: { parallaxFactor: 0.5, fixedPxPerSec: 0 },

  bird: {
    width: 34, height: 24,
    startXPercent: 12.5, startYPercent: 50,
    flapForce: 6, maxFallSpeed: 12, hitboxPadding: 2,
    sizePercentOfHeight: 0, respectSizePercent: false,
    tilt: {
      enabled: true, upDeg: -25, downDeg: 70, responsiveness: 0.15,
      velForMaxUp: 6, velForMaxDown: 12, snapOnFlap: true, minDeg: -45, maxDeg: 90
    },
    flapAnim: { enabled: true, durationMs: 1000, fps: 12 }
  },

  physics: { gravity: 0.4 },

  pipes: {
    width: 64, height: 512, scrollSpeed: 2, gapPercent: 25,
    randomBasePercent: 25, randomRangePercent: 50,
    autoStretchToEdges: false, edgeOverflowPx: 0,
    // opcional: minHorizontalSpacingPx (se ausente, usa cálculo dinâmico)
  },

  difficulty: {
    // por score
    rampEnabled: false,
    speedPerScore: 0.05,
    minGapPercent: 18,
    gapStepPerScore: 0.2,

    // por tempo
    timeRampEnabled: true,
    timeStartDelayMs: 0,
    timeSpeedPerSec: 0.03,
    timeMaxExtraSpeed: 5,
    timeGapStepPerSec: 0.02,

    // degrau incremental (em px/frame) a cada X ms (somado ao scroll base)
    stepEveryMs: 2000,
    stepAddPxPerFrame: 0.30,
    stepMaxExtraPxPerFrame: 6,
  },

  prizes: [
    { min: 1, max: 10, name: 'Grupo A' },
    { min: 10, max: 15, name: 'Grupo B' },
    { min: 15, max: 25, name: 'Grupo C' },
  ],

  spawn: { intervalMs: 1500 }, // mantido por compat.; spawner usa spacing dinâmico
  scoring: { pointsPerPipe: 0.5 },

  ui: {
    font: '45px sans-serif',
    scoreColor: '#ffffff',
    gameOverText: 'GAME OVER',
    gameOverFont: '45px sans-serif',
    gameOverColor: '#ffffff'
  },

  controls: {
    jump: ['Space', 'ArrowUp', 'KeyX'],
    minFlapIntervalMs: 120,
    allowHoldToFlap: false
  },

  gameplay: {
    restartOnJump: false,
    gracePeriodMs: 0,
    pauseKey: 'KeyP'
  },

  // Colisão pixel-perfect
  collision: {
    birdPixelPerfect: true,
    alphaThreshold: 10,
    pipeAlphaThreshold: 10,
    pipeFallbackInsetPx: 6,
    debug: false
  },

  // Efeitos de morte
  death: {
    flashMs: 140,
    freezeMs: 1000,
    fallGravityScale: 1,
    flashColor: '#ffffff'
  }
};

/* ============================= ESTADO GLOBAL ======================================== */
let cfg = structuredClone(DEFAULT_CONFIG);

let canvas, ctx;
let topPipeImg = null, bottomPipeImg = null, bgImg = null;
let birdImgs = [], SFX = {};

let pipeMaskTop = null, pipeMaskBottom = null;     // máscaras para colisão
let collCanvas = null, collCtx = null;             // canvas offscreen p/ colisão

let bird, velocityY = 0, pipeArray = [];
let isGameOver = false, score = 0;

let allowedJumpKeys = new Set(), spawnTimerId = null;
let birdTiltDeg = 0, flapAnimStart = 0, flapAnimEnd = 0;

let gameStarted = false, graceUntilTs = 0, paused = false, lastTs = 0;
let activeTimeMs = 0, timeRampStartTs = 0, lastFlapTs = -1;

let uiLocked = false;

let runId = null, runStartISO = null, runStartPerf = 0;

let startOverlay = null, scoresOverlay = null, rankOverlay = null;

let rafId = 0, running = false;                     // loop principal
let rafBgId = 0, bgLooping = false, lastBgOnlyTs = 0; // loop leve do BG (telas)
let bgScrollX = 0, bgFrozen = false;                // BG e congelamento na morte

let dying = false;
let death = { active: false, hitTs: 0, flashEnd: 0, freezeUntil: 0, holdY: 0, holdTilt: 0 };

let saveOnce = false; // evita salvar duas vezes a mesma run
let savePromise = null;

/* ============================= BOOT / STARTUP ======================================= */
export async function boot() {
  // 1) fonte para DOM + canvas
  installPixellari();
  await waitPixellari();

  // 2) configs: local/file/remote -> escala p/ alvo -> fonte no HUD
  cfg = await loadConfigSanitized();
  cfg = forceBoardToTarget(cfg, TARGET_W, TARGET_H);
  cfg = applyUniformScale(cfg, BASE_W, BASE_H);
  cfg = applyPixellariToCfg(cfg);

  // 3) preparo de runtime
  setupCanvas();
  await loadAssets();
  setupControls();
  disableRightClickGlobally();
  // 4) overlays (start, top10, rank)
  ensureStartOverlay();
  ensureScoresOverlay();
  ensureRankOverlay();
  ensureScoreHud();

  // 5) tela inicial + BG passivo
  showStartOverlay();
  startBgLoop();
}

/* ============================= CICLO DE VIDA/EXECUÇÃO =============================== */
function resetRunState() {
  pipeArray = [];
  isGameOver = false;
  score = 0;

  runId = (crypto?.randomUUID?.() || ('run-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)));
  runStartISO = new Date().toISOString();
  runStartPerf = performance.now();

  const startX = (cfg.board.width * cfg.bird.startXPercent) / 100;
  const startY = (cfg.board.height * cfg.bird.startYPercent) / 100;
  bird = { x: startX, y: startY, width: cfg.bird.width, height: cfg.bird.height };

  velocityY = 0; birdTiltDeg = 0; flapAnimStart = 0; flapAnimEnd = 0;
  gameStarted = false; graceUntilTs = 0; paused = false; lastTs = 0;
  activeTimeMs = 0; timeRampStartTs = 0; lastFlapTs = -1;

  bgScrollX = 0; bgFrozen = false;

  dying = false; death.active = false;

  // libera salvamento nesta nova run
  saveOnce = false; savePromise = null;
}

export async function startGame() {
  hideStartOverlay(); hideScoresOverlay(); hideRankOverlay();
  await withUiLock(ensureCadastro());

  stopBgLoop();          // sai do BG passivo
  resetRunState();
  stopSpawning();        // garante sem timers antigos
  stopGameLoop();

  running = true;
  showScoreHud(true);
  rafId = requestAnimationFrame(tick);
}

export function gameOver() {
  if (isGameOver) return;
  isGameOver = true;

  try { SFX.hit?.play(); } catch { }
  stopSpawning();
  stopGameLoop();

  // Mantém BG parado no Game Over
  handleGameOverSave().catch(() => { /* silencioso */ });
}

function stopGameLoop() { running = false; if (rafId) cancelAnimationFrame(rafId); rafId = 0; }
function stopSpawning() { if (spawnTimerId) clearTimeout(spawnTimerId); spawnTimerId = null; }

/* ============================= CONFIG / CARREGAMENTO ================================= */
async function fetchRemoteConfigFromSupabase(slug = CONFIG_SLUG) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from(SUPABASE_CONFIG_TABLE)
      .select('data')
      .eq('slug', String(slug || 'default'))
      .maybeSingle();
    if (error) { console.warn('[Supabase] config erro:', error); return null; }
    return data?.data || null;
  } catch (e) {
    console.warn('[Supabase] config exception:', e); return null;
  }
}

async function loadConfigSanitized() {
  let merged = structuredClone(DEFAULT_CONFIG);

  // arquivo de config (sem cache)
  try {
    const res = await fetch(joinBase('/flappy-config.json'), { cache: 'no-store' });
    if (res.ok) merged = deepMerge(merged, await res.json() || {});
  } catch { }

  // localStorage (ignora assets para evitar CORS/caminhos ruins)
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const { assets: _ignore, ...rest } = JSON.parse(raw) || {};
      merged = deepMerge(merged, rest || {});
    }
  } catch { }

  // remoto (Supabase)
  try {
    const remote = await fetchRemoteConfigFromSupabase();
    if (remote) merged = deepMerge(merged, remote);
  } catch (e) {
    console.warn('[config] falha Supabase:', e);
  }

  merged.assets = sanitizeAssets(merged.assets);
  if (!Array.isArray(merged.prizes)) merged.prizes = [];

  return merged;
}

function sanitizeAssets(a) {
  const out = { ...DEFAULT_ASSETS };

  // frames / sprites
  const frames = Array.isArray(a?.birdFrames) ? a.birdFrames : [];
  const cleaned = frames.map(normalizeAssetPath).filter(Boolean);
  out.birdFrames = cleaned.length ? unique(cleaned) : DEFAULT_ASSETS.birdFrames;
  out.topPipe = normalizeAssetPath(a?.topPipe) || DEFAULT_ASSETS.topPipe;
  out.bottomPipe = normalizeAssetPath(a?.bottomPipe) || DEFAULT_ASSETS.bottomPipe;
  out.bg = normalizeAssetPath(a?.bg) || DEFAULT_ASSETS.bg || '';

  // sons (normaliza + aplica defaults)
  const aSfx = a?.sfx || {};
  out.sfx = {
    flap: normalizeAssetPath(aSfx.flap) || normalizeAssetPath(DEFAULT_SFX.flap),
    score: normalizeAssetPath(aSfx.score) || normalizeAssetPath(DEFAULT_SFX.score),
    hit: normalizeAssetPath(aSfx.hit) || normalizeAssetPath(DEFAULT_SFX.hit),
  };

  return out;
}


function normalizeAssetPath(p) {
  if (!p) return '';
  const s = String(p).trim();
  if (/^(blob:|data:)/i.test(s)) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('./assets/')) return joinBase('/' + s.slice(2));
  if (s.startsWith('assets/')) return joinBase('/' + s);
  if (s.startsWith('/')) return joinBase(s);
  return '';
}
function deepMerge(a, b) {
  const out = Array.isArray(a) ? [...a] : { ...a };
  Object.keys(b || {}).forEach(k => {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) out[k] = deepMerge(a?.[k] || {}, b[k]);
    else out[k] = b[k];
  });
  return out;
}
const unique = (arr) => [...new Set(arr)];

/* ============================= ESCALA 1080×1920 ===================================== */
function forceBoardToTarget(cfgIn, w, h) {
  const cfg = structuredClone(cfgIn);
  cfg.board = cfg.board || {};
  cfg.board.width = w; cfg.board.height = h;
  return cfg;
}
function applyUniformScale(cfgIn, baseW, baseH) {
  const cfg = structuredClone(cfgIn);
  const worldW = Number(cfg.board?.width || baseW);
  const worldH = Number(cfg.board?.height || baseH);
  const sx = worldW / baseW, sy = worldH / baseH;
  const S = Math.min(sx, sy);
  if (!(S > 0) || Math.abs(S - 1) < 1e-6) return cfg;

  const mulI = (v) => Math.round(Number(v || 0) * S);
  const mulF = (v) => Number(v || 0) * S;

  cfg.bird.width = mulI(cfg.bird.width);
  cfg.bird.height = mulI(cfg.bird.height);
  cfg.bird.hitboxPadding = mulI(cfg.bird.hitboxPadding);

  cfg.pipes.width = mulI(cfg.pipes.width);
  cfg.pipes.height = mulI(cfg.pipes.height);
  cfg.pipes.edgeOverflowPx = mulI(cfg.pipes.edgeOverflowPx);

  cfg.bird.flapForce = mulF(cfg.bird.flapForce);
  cfg.bird.maxFallSpeed = mulF(cfg.bird.maxFallSpeed);
  cfg.physics.gravity = mulF(cfg.physics.gravity);
  cfg.pipes.scrollSpeed = mulF(cfg.pipes.scrollSpeed);

  const baseInt = Math.max(50, Number(cfg.spawn.intervalMs || 1500));
  cfg.spawn.intervalMs = Math.max(50, Math.round(baseInt / S));

  cfg.ui.font = scaleFontSpec(cfg.ui.font, S);
  cfg.ui.gameOverFont = scaleFontSpec(cfg.ui.gameOverFont, S);
  cfg._scale = S;
  return cfg;
}
function scaleFontSpec(spec, S) {
  if (typeof spec !== 'string' || !S || !isFinite(S)) return spec;
  return spec.replace(/(\d+(\.\d+)?)px/ig, (_, n) => `${Math.round(parseFloat(n) * S)}px`);
}

/* ============================= CANVAS / LAYOUT FULLSCREEN =========================== */
function setupCanvas() {
  canvas = document.getElementById('board') || Object.assign(document.createElement('canvas'), { id: 'board' });
  if (!canvas.isConnected) document.body.appendChild(canvas);

  canvas.width = cfg.board.width;   // 1080
  canvas.height = cfg.board.height; // 1920

  Object.assign(document.documentElement.style, { height: '100%' });
  Object.assign(document.body.style, {
    margin: '0',
    background: cfg.board.background || '#000',
    overflow: 'hidden'
  });

  Object.assign(canvas.style, {
    position: 'fixed',
    left: '0px',
    top: '0px',
    imageRendering: 'pixelated',
  });

  ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;

  layoutCanvasCover();
  window.addEventListener('resize', layoutCanvasCover);
}
function layoutCanvasCover() {
  const vw = Math.max(1, window.innerWidth);
  const vh = Math.max(1, window.innerHeight);

  const scale = Math.max(vw / canvas.width, vh / canvas.height);
  const cssW = Math.round(canvas.width * scale);
  const cssH = Math.round(canvas.height * scale);

  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.style.left = Math.round((vw - cssW) / 2) + 'px';
  canvas.style.top = Math.round((vh - cssH) / 2) + 'px';
}

/* ============================= ASSETS & MÁSCARAS ==================================== */

class SoundPool {
  constructor(src, size = 4) {
    this.src = src || '';
    this.pool = [];
    this.idx = 0;
    this.enabled = !!this.src;
    if (this.enabled) {
      for (let i = 0; i < size; i++) {
        const a = new Audio(this.src);
        a.preload = 'auto';
        a.crossOrigin = 'anonymous';
        this.pool.push(a);
      }
    }
  }
  play() {
    if (!this.enabled || !this.pool.length) return;
    const a = this.pool[this.idx];
    this.idx = (this.idx + 1) % this.pool.length;
    try {
      // reinicia para cliques rápidos
      a.currentTime = 0;
      a.play().catch(() => { });
    } catch { }
  }
}


async function loadAssets() {
  // --- helpers locais -------------------------------------------
  function loadImageSafe(src) {
    return new Promise((resolve) => {
      if (!src) return resolve(null);
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => resolve(im);
      im.onerror = () => {
        console.warn('[assets] falhou img:', src);
        resolve(null);
      };
      im.src = src;
    });
  }

  class WebAudioEngine {
    constructor() {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx({ latencyHint: 'interactive' });
      this.buffers = {};
      this._unlock = this._unlock.bind(this);
    }
    async load(name, url) {
      if (!url) return;
      try {
        const res = await fetch(url, { cache: 'force-cache' });
        const ab = await res.arrayBuffer();
        this.buffers[name] = await new Promise((ok, err) =>
          this.ctx.decodeAudioData(ab, ok, err)
        );
      } catch (e) {
        console.warn('[audio] falhou ao carregar:', name, url, e);
      }
    }
    async loadAll(map) {
      await Promise.all(
        Object.entries(map).map(([k, u]) => this.load(k, u))
      );
    }
    unlockOnFirstGesture() {
      window.addEventListener('pointerdown', this._unlock, true);
      window.addEventListener('keydown', this._unlock, true);
    }
    _unlock() {
      try { this.ctx.resume(); } catch { }
      window.removeEventListener('pointerdown', this._unlock, true);
      window.removeEventListener('keydown', this._unlock, true);
    }
    play(name, { volume = 1, rate = 1 } = {}) {
      const buf = this.buffers[name];
      if (!buf) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;

      const gain = this.ctx.createGain();
      gain.gain.value = volume;

      src.connect(gain).connect(this.ctx.destination);
      try { src.start(this.ctx.currentTime); } catch { }
    }
  }
  // ---------------------------------------------------------------

  // 1) Carrega frames do pássaro (mantém ordem; filtra inválidas)
  const frameUrls = Array.isArray(cfg.assets.birdFrames) ? cfg.assets.birdFrames : [];
  const framePromises = frameUrls.map((src) => loadImageSafe(src));
  const loadedFrames = await Promise.all(framePromises);
  birdImgs = loadedFrames.filter(okImg);
  applyDynamicBirdAutosize();

  // 2) Carrega canos e gera máscaras
  topPipeImg = await loadImageSafe(cfg.assets.topPipe);
  if (!topPipeImg) console.warn('[assets] topPipe falhou:', cfg.assets.topPipe);
  else {
    try { pipeMaskTop = buildPipeMask(topPipeImg); } catch (e) { console.warn('mask top err:', e); }
  }

  bottomPipeImg = await loadImageSafe(cfg.assets.bottomPipe);
  if (!bottomPipeImg) console.warn('[assets] bottomPipe falhou:', cfg.assets.bottomPipe);
  else {
    try { pipeMaskBottom = buildPipeMask(bottomPipeImg); } catch (e) { console.warn('mask bottom err:', e); }
  }

  // 3) BG
  bgImg = await loadImageSafe(cfg.assets.bg);
  if (!bgImg) console.warn('[assets] bg falhou:', cfg.assets.bg);

  // 4) SFX — tenta Web Audio (latência baixa); fallback para SoundPool
  try {
    const hasWebAudio = !!(window.AudioContext || window.webkitAudioContext);
    const sfxMap = {
      flap: cfg.assets?.sfx?.flap || '',
      score: cfg.assets?.sfx?.score || '',
      hit: cfg.assets?.sfx?.hit || '',
    };

    if (hasWebAudio && (sfxMap.flap || sfxMap.score || sfxMap.hit)) {
      const engine = new WebAudioEngine();
      await engine.loadAll(sfxMap);
      // desbloqueia no 1º gesto do usuário (necessário em iOS/Android)
      engine.unlockOnFirstGesture();

      // mantém a API atual: SFX.xxx?.play()
      SFX = {
        flap: sfxMap.flap ? { play: () => engine.play('flap') } : null,
        score: sfxMap.score ? { play: () => engine.play('score') } : null,
        hit: sfxMap.hit ? { play: () => engine.play('hit') } : null,
      };
    } else {
      // fallback para HTMLAudio em pool
      SFX = {
        flap: sfxMap.flap ? new SoundPool(sfxMap.flap, 6) : null,
        score: sfxMap.score ? new SoundPool(sfxMap.score, 4) : null,
        hit: sfxMap.hit ? new SoundPool(sfxMap.hit, 3) : null,
      };
    }
  } catch (e) {
    console.warn('[audio] erro, usando fallback:', e);
    const aSfx = cfg.assets?.sfx || {};
    SFX = {
      flap: aSfx.flap ? new SoundPool(aSfx.flap, 6) : null,
      score: aSfx.score ? new SoundPool(aSfx.score, 4) : null,
      hit: aSfx.hit ? new SoundPool(aSfx.hit, 3) : null,
    };
  }
}


function applyDynamicBirdAutosize() {
  const percent = Number(cfg.bird?.sizePercentOfHeight || 0);
  const usePercent = !!cfg.bird?.respectSizePercent && percent > 0;

  const MIN_AUTO_PERCENT = 6;
  let finalPercent = 0;

  if (usePercent) finalPercent = percent;
  else {
    const tooSmall = (cfg.bird.height || 0) < canvas.height * 0.04;
    if (tooSmall) finalPercent = Math.max(MIN_AUTO_PERCENT, percent || 0);
  }

  if (finalPercent <= 0) return;

  let ratio = 34 / 24;
  const ok = birdImgs.find(im => im && im.complete && im.naturalWidth > 0);
  if (ok && ok.naturalHeight > 0) ratio = ok.naturalWidth / ok.naturalHeight;

  const targetH = Math.round(canvas.height * (finalPercent / 100));
  const targetW = Math.max(1, Math.round(targetH * ratio));

  cfg.bird.width = targetW; cfg.bird.height = targetH;
  if (bird) { bird.width = targetW; bird.height = targetH; }
}

function buildPipeMask(img) {
  const w = Math.max(1, cfg.pipes.width | 0);
  const h = Math.max(1, cfg.pipes.height | 0);

  const buf = (typeof OffscreenCanvas !== 'undefined')
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });

  const bctx = buf.getContext('2d', { alpha: true, willReadFrequently: true });
  bctx.imageSmoothingEnabled = false;
  bctx.clearRect(0, 0, w, h);
  bctx.drawImage(img, 0, 0, w, h);

  const imgData = bctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  const t = Math.max(0, cfg.collision?.pipeAlphaThreshold ?? 10);
  const mask = new Uint8Array(w * h);

  for (let i = 0, j = 0; j < mask.length; j++, i += 4) {
    mask[j] = data[i + 3] > t ? 1 : 0;
  }
  return { mask, w, h };
}

/* ============================= CONTROLES ============================================ */
function isTypingTarget(ev) {
  const el = ev?.target;
  if (!(el instanceof Element)) return false;
  if (el.closest('input, textarea, select')) return true;
  if (el.closest('[contenteditable=""], [contenteditable="true"]')) return true;
  return false;
}
function preventScrollForGameKeys(e) {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
}
function setupControls() {
  allowedJumpKeys = new Set(cfg.controls.jump);

  document.addEventListener('keydown', (e) => {
    if (e.code === 'F9') { try { localStorage.removeItem(KEY); } catch { } location.reload(); return; }
    if (isTypingTarget(e) || uiLocked) return;

    preventScrollForGameKeys(e);

    if (e.code === (cfg.gameplay.pauseKey || 'KeyP')) { if (!e.repeat) paused = !paused; return; }
    if (!cfg.controls.allowHoldToFlap && e.repeat) return;

    onJumpKey(e);
  }, { capture: true });

  window.addEventListener('pointerdown', (e) => {
    // não interfere em inputs/menus
    if (isTypingTarget(e)) return;
    if (uiLocked) return;

    if (e.pointerType === 'mouse' && (e.button === 0 || e.buttons === 1)) {
      return;
    }

    // Touch/pen (ou outros botões de mouse, se quiser manter) viram um "jump"
    onJumpKey({ code: cfg.controls.jump?.[0] || 'Space', repeat: false });
  }, { capture: true });

  window.addEventListener('blur', () => { paused = true; });
  window.addEventListener('focus', () => { paused = false; });
}

function onJumpKey(e) {
  if (!running || !allowedJumpKeys.has(e.code) || paused || dying) return;
  if (isGameOver) return;

  const now = performance.now();
  const minInt = Math.max(0, cfg.controls.minFlapIntervalMs || 0);
  if (lastFlapTs >= 0 && now - lastFlapTs < minInt) return;
  lastFlapTs = now;

  if (!gameStarted) {
    gameStarted = true;
    graceUntilTs = performance.now() + Math.max(0, cfg.gameplay.gracePeriodMs || 0);
    const delay = Math.max(0, cfg.difficulty?.timeStartDelayMs ?? 0);
    timeRampStartTs = graceUntilTs + delay;

    if (!spawnTimerId) scheduleNextSpawn(true);
  }

  velocityY = -Math.abs(cfg.bird.flapForce);
  try { SFX.flap?.play(); } catch { }
  navigator.vibrate?.(10);

  const t = cfg.bird.tilt;
  if (t?.enabled && t?.snapOnFlap) {
    birdTiltDeg = clamp(t.upDeg, t.minDeg ?? -360, t.maxDeg ?? 360);
  }

  const fa = cfg.bird.flapAnim;
  if (fa?.enabled && birdImgs.length > 1) {
    flapAnimStart = performance.now();
    flapAnimEnd = flapAnimStart + Math.max(0, fa.durationMs ?? 1000);
  }
}

/* ============================= MORTE / FX =========================================== */
function startDeathSequence() {
  if (dying || isGameOver) return;
  dying = true;
  death.active = true;
  death.hitTs = performance.now();
  death.flashEnd = death.hitTs + Math.max(0, cfg.death?.flashMs ?? 140);
  death.freezeUntil = death.hitTs + Math.max(0, cfg.death?.freezeMs ?? 1000);
  death.holdY = clamp(bird.y, 0, canvas.height - bird.height);
  death.holdTilt = birdTiltDeg;
  velocityY = 0;

  stopSpawning();  // não gera novos canos
  bgFrozen = true; // congela BG
  try { SFX.hit?.play(); } catch { }
}
function drawDeathFlash(nowTs) {
  if (!death.active) return;
  const end = death.flashEnd || 0;
  if (nowTs >= end) return;
  const t = clamp(1 - ((nowTs - death.hitTs) / (end - death.hitTs)), 0, 1);
  ctx.save();
  ctx.globalAlpha = t;
  ctx.fillStyle = cfg.death?.flashColor || '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

/* ============================= LOOP PRINCIPAL ======================================= */
function tick(ts) {
  if (!running) return;

  rafId = requestAnimationFrame(tick);

  if (!lastTs) lastTs = ts || performance.now();
  const nowTs = ts || performance.now();
  const dt = Math.min(50, nowTs - lastTs);
  lastTs = nowTs;

  drawBackground(dt);
  const t = dt / 16.667;

  if (gameStarted && !paused && !isGameOver && nowTs >= timeRampStartTs && !dying) activeTimeMs += dt;

  drawHUD();

  if (!gameStarted) { if (bird) drawBirdWithTilt(); return; }
  if (paused) {
    ctx.fillStyle = '#00000055'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff'; ctx.font = '28px sans-serif'; ctx.fillText('PAUSADO', 5, 90);
    return;
  }
  if (isGameOver) return;

  // === sequência de morte (BG+canos congelados) ===
  if (dying) {
    for (let i = 0; i < pipeArray.length; i++) {
      const p = pipeArray[i];
      tryDrawImage(p.img, p.x, p.y, p.width, p.height);
    }

    if (nowTs < death.freezeUntil) {
      bird.y = death.holdY;
      birdTiltDeg = death.holdTilt;
    } else {
      const g = (cfg.physics.gravity || 0.4) * (cfg.death?.fallGravityScale ?? 1);
      velocityY += g * t;
      if (velocityY > cfg.bird.maxFallSpeed) velocityY = cfg.bird.maxFallSpeed;
      bird.y += velocityY * t;
      updateBirdTilt(t);
    }

    drawBirdWithTilt();
    drawDeathFlash(nowTs);

    if (bird.y > canvas.height + Math.max(16, bird.height)) {
      gameOver();
      return;
    }
    return;
  }

  // === jogo normal ===
  const inGrace = performance.now() < graceUntilTs;
  if (inGrace) { velocityY += cfg.physics.gravity * t; if (velocityY > 0) velocityY = 0; }
  else { velocityY += cfg.physics.gravity * t; if (velocityY > cfg.bird.maxFallSpeed) velocityY = cfg.bird.maxFallSpeed; }
  bird.y = Math.max(bird.y + velocityY * t, 0);

  updateBirdTilt(t);
  drawBirdWithTilt();

  // chão -> morte
  if (!dying && bird.y > canvas.height) { startDeathSequence(); }

  // canos
  const scroll = currentScrollSpeed();
  for (let i = 0; i < pipeArray.length; i++) {
    const p = pipeArray[i];
    p.x += scroll * t;
    tryDrawImage(p.img, p.x, p.y, p.width, p.height);

    if (!dying && !p.passed && bird.x > p.x + p.width) {
      score += cfg.scoring.pointsPerPipe;
      p.passed = true;
      try { SFX.score?.play(); } catch { }
    }

    if (!dying && collidesPipePixelPerfect(bird, p)) { startDeathSequence(); }
  }
  while (pipeArray.length > 0 && pipeArray[0].x < -cfg.pipes.width) pipeArray.shift();
}

/* ============================= BACKGROUND SCROLL ==================================== */
function startBgLoop() {
  if (bgLooping) return;
  bgLooping = true;
  lastBgOnlyTs = 0;
  rafBgId = requestAnimationFrame(bgTick);
}
function stopBgLoop() {
  bgLooping = false;
  if (rafBgId) cancelAnimationFrame(rafBgId);
  rafBgId = 0;
}
function bgTick(ts) {
  if (!bgLooping) return;
  rafBgId = requestAnimationFrame(bgTick);

  if (!lastBgOnlyTs) lastBgOnlyTs = ts || performance.now();
  const now = ts || performance.now();
  const dt = Math.min(50, now - lastBgOnlyTs);
  lastBgOnlyTs = now;

  drawBackground(dt);
}
function drawBackground(dtMs) {
  if (!okImg(bgImg)) {
    ctx.fillStyle = cfg.board.background || '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const pxPerSecPipes = currentScrollSpeedAbsPerSec();
  const fixed = Number(cfg.bg?.fixedPxPerSec || 0);
  const factor = Number(cfg.bg?.parallaxFactor ?? 0.5);
  const bgPxPerSec = fixed > 0 ? fixed : (pxPerSecPipes * factor);

  if (!bgFrozen) {
    const delta = Math.max(0, dtMs) / 1000;
    bgScrollX = (bgScrollX + bgPxPerSec * delta) || 0;
  }

  const imgW = bgImg.naturalWidth, imgH = bgImg.naturalHeight;
  const scale = canvas.height / imgH;
  const drawW = Math.ceil(imgW * scale);
  const drawH = canvas.height;

  let x = -Math.floor(bgScrollX % drawW);
  ctx.drawImage(bgImg, 0, 0, imgW, imgH, x, 0, drawW, drawH);
  ctx.drawImage(bgImg, 0, 0, imgW, imgH, x + drawW, 0, drawW, drawH);
}

/* ============================= SPAWNER DE CANOS ===================================== */
function startSpawning() { stopSpawning(); scheduleNextSpawn(true); }

function currentScrollSpeedAbsPerSec() {
  let base = Math.abs(cfg.pipes.scrollSpeed);

  base += extraSpeedStepPxPerFrame(); // degraus por tempo

  if (cfg.difficulty?.rampEnabled) {
    const scoreExtra = (cfg.difficulty.speedPerScore || 0) * score;
    base += scoreExtra;
  }
  if (cfg.difficulty?.timeRampEnabled) {
    const sec = activeTimeMs / 1000;
    const timeExtra = Math.min(
      cfg.difficulty.timeMaxExtraSpeed ?? Infinity,
      (cfg.difficulty.timeSpeedPerSec || 0) * sec
    );
    base += timeExtra;
  }
  return base * 60; // px/seg
}
function currentScrollSpeed() {
  let base = Math.abs(cfg.pipes.scrollSpeed);
  base += extraSpeedStepPxPerFrame();

  if (cfg.difficulty?.rampEnabled) base += (cfg.difficulty.speedPerScore || 0) * score;
  if (cfg.difficulty?.timeRampEnabled) {
    const sec = activeTimeMs / 1000;
    const timeExtra = Math.min(cfg.difficulty.timeMaxExtraSpeed ?? Infinity, (cfg.difficulty.timeSpeedPerSec || 0) * sec);
    base += timeExtra;
  }
  return -base; // move para a esquerda
}
function scheduleNextSpawn(spawnNow = false) {
  if (spawnNow) placePipes();

  const pxPerSec = Math.max(1, currentScrollSpeedAbsPerSec());
  const desiredSpacingPx = (cfg.pipes.minHorizontalSpacingPx ?? Math.max(canvas.width * 0.48, cfg.pipes.width * 2.2));
  const ms = Math.max(120, Math.round((desiredSpacingPx / pxPerSec) * 1000));

  spawnTimerId = setTimeout(() => {
    if (!running || isGameOver) return;
    scheduleNextSpawn(true);
  }, ms);
}

/* ============================= HUD / PÁSSARO / TILT ================================= */
function updateBirdTilt(tFactor) {
  const tcfg = cfg.bird.tilt;
  if (!tcfg?.enabled) { birdTiltDeg = 0; return; }
  const vUpRef = -Math.abs(tcfg.velForMaxUp ?? cfg.bird.flapForce);
  const vDownRef = Math.abs(tcfg.velForMaxDown ?? cfg.bird.maxFallSpeed);
  const targetDeg = mapRangeClamped(velocityY, vUpRef, vDownRef, tcfg.upDeg, tcfg.downDeg);
  const alpha = 1 - Math.pow(1 - clamp(tcfg.responsiveness ?? 0.15, 0, 1), tFactor);
  birdTiltDeg = clamp(lerp(birdTiltDeg, targetDeg, alpha), tcfg.minDeg ?? -360, tcfg.maxDeg ?? 360);
}
function drawBirdWithTilt() {
  if (!bird) return;

  const cx = bird.x + bird.width / 2;
  const cy = bird.y + bird.height / 2;
  const now = performance.now();

  let frameIdx = 0;
  if (now < flapAnimEnd && birdImgs.length > 1 && (cfg.bird.flapAnim?.fps ?? 0) > 0) {
    const fps = cfg.bird.flapAnim.fps;
    frameIdx = Math.floor(((now - flapAnimStart) / 1000) * fps) % birdImgs.length;
  }

  let img = birdImgs[frameIdx];
  if (!okImg(img)) img = birdImgs.find(okImg) || null;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(deg2rad(birdTiltDeg));
  if (img) ctx.drawImage(img, -bird.width / 2, -bird.height / 2, bird.width, bird.height);
  else { ctx.fillStyle = '#fbbf24'; ctx.fillRect(-bird.width / 2, -bird.height / 2, bird.width, bird.height); }
  ctx.restore();
}
function drawHUD() {
  ensureScoreHud();

  if (!scoreHudVisible) showScoreHud(true);

  const txt = String(score);
  if (txt !== lastScoreText) {
    scoreHudEl.textContent = txt;
    lastScoreText = txt;
  }
}


/* ============================= CANOS / COLISÃO ====================================== */
function placePipes() {
  if (!running || isGameOver || paused || !gameStarted) return;

  const baseGap = cfg.pipes.gapPercent;
  const minGap = cfg.difficulty?.minGapPercent ?? baseGap;
  const stepPerScore = cfg.difficulty?.gapStepPerScore ?? 0;

  let gapPercent = cfg.difficulty?.rampEnabled ? (baseGap - score * stepPerScore) : baseGap;
  if (cfg.difficulty?.timeRampEnabled) gapPercent -= (cfg.difficulty.timeGapStepPerSec || 0) * (activeTimeMs / 1000);
  gapPercent = Math.max(minGap, gapPercent);

  const gap = (canvas.height * gapPercent) / 100;

  const w0 = cfg.pipes.width;
  let h0 = cfg.pipes.height;

  const usable = Math.max(0, canvas.height - gap);
  const baseOff = clamp((cfg.pipes.randomBasePercent ?? 0), 0, 100) / 100 * usable;
  const rangeOff = clamp((cfg.pipes.randomRangePercent ?? 100), 0, 100) / 100 * usable;

  const margin = Math.max(0, cfg.pipes.edgeOverflowPx || 0);
  let center = (gap / 2) + baseOff + Math.random() * rangeOff;
  center = clamp(center, (gap / 2) - margin, canvas.height - (gap / 2) + margin);

  if (cfg.pipes?.autoStretchToEdges) {
    const needTop = center - gap / 2 + margin;
    const needBot = canvas.height - (center + gap / 2) + margin;
    h0 = Math.max(h0, Math.ceil(needTop), Math.ceil(needBot));
  }

  const topY = center - gap / 2 - h0;
  const botY = center + gap / 2;

  pipeArray.push(
    { img: topPipeImg, x: canvas.width, y: topY, width: w0, height: h0, passed: false },
    { img: bottomPipeImg, x: canvas.width, y: botY, width: w0, height: h0, passed: false },
  );
}

// caixas com padding reduzido do pássaro
function birdRectPadded(a) {
  const pad = Math.max(0, cfg.bird.hitboxPadding || 0);
  return { x: a.x + pad, y: a.y + pad, width: a.width - pad * 2, height: a.height - pad * 2 };
}
function collidesAABB(a, b) {
  const r = birdRectPadded(a);
  return r.x < b.x + b.width && r.x + r.width > b.x && r.y < b.y + b.height && r.y + r.height > b.y;
}
function collidesInsetAABB(a, b, insetPx = 0) {
  const i = Math.max(0, insetPx | 0);
  const r = birdRectPadded(a);
  const bx1 = b.x + i, by1 = b.y + i, bx2 = b.x + b.width - i, by2 = b.y + b.height - i;
  return r.x < bx2 && r.x + r.width > bx1 && r.y < by2 && r.y + r.height > by1;
}

function getCurrentBirdImage() {
  const now = performance.now();
  let frameIdx = 0;
  if (now < flapAnimEnd && birdImgs.length > 1 && (cfg.bird.flapAnim?.fps ?? 0) > 0) {
    const fps = cfg.bird.flapAnim.fps;
    frameIdx = Math.floor(((now - flapAnimStart) / 1000) * fps) % birdImgs.length;
  }
  let img = birdImgs[frameIdx];
  if (!okImg(img)) img = birdImgs.find(okImg) || null;
  return img;
}

// Canvas offscreen para colisão
function ensureCollCanvas(w, h) {
  const W = Math.max(1, w | 0), H = Math.max(1, h | 0);
  if (!collCanvas) {
    collCanvas = (typeof OffscreenCanvas !== 'undefined')
      ? new OffscreenCanvas(W, H)
      : Object.assign(document.createElement('canvas'), { width: W, height: H });
    collCtx = collCanvas.getContext('2d', { alpha: true, willReadFrequently: true });
    collCtx.imageSmoothingEnabled = false;
  }
  if (collCanvas.width !== W || collCanvas.height !== H) {
    collCanvas.width = W; collCanvas.height = H;
  }
  return collCtx;
}

// Pixel-perfect pássaro(rotacionado) vs máscara do cano
function collideBirdRotatedWithPipeMask(birdRect, angleDeg, pipe, m) {
  if (!collidesAABB(birdRect, pipe)) return false;

  const r = birdRectPadded(birdRect);
  const ox1 = Math.max(r.x, pipe.x) | 0;
  const oy1 = Math.max(r.y, pipe.y) | 0;
  const ox2 = Math.min(r.x + r.width, pipe.x + pipe.width) | 0;
  const oy2 = Math.min(r.y + r.height, pipe.y + pipe.height) | 0;
  const ow = (ox2 - ox1) | 0, oh = (oy2 - oy1) | 0;
  if (ow <= 0 || oh <= 0) return false;

  if (!m || !m.mask) {
    return collidesInsetAABB(birdRect, pipe, cfg.collision?.pipeFallbackInsetPx ?? 6);
  }

  const img = getCurrentBirdImage();
  if (!img) return collidesInsetAABB(birdRect, pipe, cfg.collision?.pipeFallbackInsetPx ?? 6);

  const bctx = ensureCollCanvas(ow, oh);
  bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.clearRect(0, 0, ow, oh);

  bctx.translate(-ox1, -oy1);
  const cx = birdRect.x + birdRect.width / 2;
  const cy = birdRect.y + birdRect.height / 2;
  bctx.translate(cx, cy);
  bctx.rotate(deg2rad(angleDeg));
  bctx.drawImage(img, -birdRect.width / 2, -birdRect.height / 2, birdRect.width, birdRect.height);

  const data = bctx.getImageData(0, 0, ow, oh).data;
  const ath = Math.max(0, cfg.collision?.alphaThreshold ?? 10);

  const mw = m.w, mh = m.h, MASK = m.mask;
  const sx = mw / pipe.width;
  const sy = mh / pipe.height;

  for (let y = 0; y < oh; y++) {
    const row = y * ow * 4;
    const my = ((oy1 + y) - pipe.y) * sy;
    if (my < 0 || my >= mh) continue;
    const imy = my | 0;
    const mrow = imy * mw;

    for (let x = 0; x < ow; x++) {
      const a = data[row + x * 4 + 3];
      if (a <= ath) continue;

      const mx = ((ox1 + x) - pipe.x) * sx;
      if (mx < 0 || mx >= mw) continue;

      if (MASK[mrow + (mx | 0)]) return true;
    }
  }
  return false;
}

function collidesPipePixelPerfect(birdRect, pipe) {
  if (cfg.collision?.birdPixelPerfect) {
    const m = (pipe.img === topPipeImg) ? pipeMaskTop
      : (pipe.img === bottomPipeImg) ? pipeMaskBottom
        : null;
    return collideBirdRotatedWithPipeMask(birdRect, birdTiltDeg, pipe, m);
  }

  if (!collidesAABB(birdRect, pipe)) return false;
  const m = (pipe.img === topPipeImg) ? pipeMaskTop
    : (pipe.img === bottomPipeImg) ? pipeMaskBottom
      : null;
  if (!m || !m.mask) return collidesInsetAABB(birdRect, pipe, cfg.collision?.pipeFallbackInsetPx ?? 6);

  const r = birdRectPadded(birdRect);
  const ox1 = Math.max(r.x, pipe.x) | 0;
  const oy1 = Math.max(r.y, pipe.y) | 0;
  const ox2 = Math.min(r.x + r.width, pipe.x + pipe.width) | 0;
  const oy2 = Math.min(r.y + r.height, pipe.y + pipe.height) | 0;
  if (ox2 <= ox1 || oy2 <= oy1) return false;

  const mw = m.w, mh = m.h, MASK = m.mask;
  const sx = mw / pipe.width;
  const sy = mh / pipe.height;
  for (let wy = oy1; wy < oy2; wy++) {
    const imy = ((wy - pipe.y) * sy) | 0;
    if (imy < 0 || imy >= mh) continue;
    const mrow = imy * mw;
    for (let wx = ox1; wx < ox2; wx++) {
      const imx = ((wx - pipe.x) * sx) | 0;
      if (imx < 0 || imx >= mw) continue;
      if (MASK[mrow + imx]) return true;
    }
  }
  return false;
}

/* ============================= OVERLAY: START ======================================= */
function ensureStartOverlay() {
  if (document.getElementById('startStyles')) return;

  const st = document.createElement('style');
  st.id = 'startStyles';
  st.textContent = `
    #startOverlay{position:fixed;inset:0;display:none;z-index:999;pointer-events:none}
    #startOverlay.show{display:block}
    #startOverlay .wrap{position:absolute;inset:0}
    #startOverlay img{image-rendering:pixelated;image-rendering:crisp-edges;user-select:none;-webkit-user-drag:none}
    #startOverlay .logo{
      position:absolute;left:0;right:0;top:min(9vh,140px);
      width:min(64vw,680px);margin:0 auto;display:block;pointer-events:none;
      filter: drop-shadow(0 2px 0 rgba(0,0,0,.15));
    }
    #startOverlay .hero{
      position:absolute;left:50%;top:44%;
      width:min(80vw,700px);transform:translate(-50%,-50%);
      animation:hero-bob 1.8s ease-in-out infinite;
      pointer-events:none;filter: drop-shadow(0 4px 0 rgba(0,0,0,.15));
    }
    #startOverlay .hand{
      position:absolute;left:60%;top:50%;
      width:min(50vw,150px);transform-origin:10% 10%;
      animation:hand-tap 1.15s ease-in-out infinite;pointer-events:none;
      filter: drop-shadow(0 2px 0 rgba(0,0,0,.15));
    }
    #startOverlay .buttons{
      position:absolute;left:0;right:0;bottom:20vh;
      display:flex;justify-content:center;gap:35px;
    }
    #startOverlay .btn{pointer-events:auto;display:inline-block;transition:transform .08s ease}
    #startOverlay .btn img{display:block;height:min(180px,11vh)}
    #startOverlay .btn:hover{transform:translateY(-2px)}
    #startOverlay .btn:active{transform:translateY(2px)}
@keyframes hero-bob{
  0%,100% { transform: translate(-50%,-50%); }
  25%     { transform: translate(-50%,-52%); }
  75%     { transform: translate(-50%,-48%); }
}
    @keyframes hand-tap{0%,100%{transform:translate(0,0) scale(1)}40%{transform:translate(12px,12px) scale(.92)}60%{transform:translate(0,0) scale(1)}}


#startOverlay .secret-corner{
    position:absolute;
    left:0; top:0;
    width:min(12vw, 80px);
    height:min(12vw, 80px);
    pointer-events:auto;      /* precisa, pq #startOverlay tem pointer-events:none */
    background:transparent;   /* deixe transparente; troque por rgba(255,0,0,.15) p/ debugar */
    touch-action:none;        /* evita gestos padrão em mobile */
  }

  `;
  document.head.appendChild(st);

  startOverlay = document.createElement('div');
  startOverlay.id = 'startOverlay';
  startOverlay.innerHTML = `
    <div class="wrap">
      ${UI_ASSETS.title ? `<img class="logo" src="${UI_ASSETS.title}" alt="logo">` : ''}
      ${UI_ASSETS.heroBird ? `<img class="hero" src="${UI_ASSETS.heroBird}" alt="bird">` : ''}
      ${UI_ASSETS.hand ? `<img class="hand" src="${UI_ASSETS.hand}" alt="tap">` : ''}
      <div class="buttons">
        <a id="btnStart"  class="btn" aria-label="Jogar"><img src="${UI_ASSETS.play}" alt="Play"></a>
        <a id="btnScores" class="btn" aria-label="Ranking"><img src="${UI_ASSETS.ranking}" alt="Ranking"></a>
      </div>
    </div>
  `;

  // Hotspot secreto: 5 toques no canto superior esquerdo abre /config.html
  const secret = document.createElement('div');
  secret.className = 'secret-corner';
  secret.setAttribute('aria-hidden', 'true');
  startOverlay.appendChild(secret);

  const TAP_COUNT_REQUIRED = 5;     // quantos toques
  const TAP_WINDOW_MS = 2500;       // janela máxima para completar a sequência (ms)

  let tapCount = 0;
  let firstTapTs = 0;
  let resetTimer = null;

  function resetTaps() {
    tapCount = 0;
    firstTapTs = 0;
    if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
  }

  function goToConfig() {
    resetTaps();
    // usa joinBase para respeitar o base path (GitHub Pages)
    location.assign(joinBase('config.html'));
  }

  secret.addEventListener('pointerdown', (e) => {
    // só funciona quando a tela de start está visível
    if (!startOverlay.classList.contains('show')) return;

    e.preventDefault();

    const now = performance.now();

    // reinicia a contagem se estourar a janela
    if (tapCount === 0 || (now - firstTapTs) > TAP_WINDOW_MS) {
      tapCount = 1;
      firstTapTs = now;
    } else {
      tapCount++;
    }

    // agenda/reset o timer de expiração da sequência
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(resetTaps, TAP_WINDOW_MS);

    if (tapCount >= TAP_COUNT_REQUIRED) {
      goToConfig();
    }
  }, { passive: false });

  // Em qualquer “cancelamento” provável, zera a sequência
  ['pointercancel', 'lostpointercapture', 'mouseleave', 'mouseout', 'blur']
    .forEach(evt => secret.addEventListener(evt, resetTaps));

  document.body.appendChild(startOverlay);

  document.getElementById('btnStart')?.addEventListener('click', (e) => { e.preventDefault(); startGame(); });
  document.getElementById('btnScores')?.addEventListener('click', (e) => { e.preventDefault(); showScoresOverlay(); });
}
function showStartOverlay() {
  startOverlay?.classList.add('show');
  uiLocked = true;
  startBgLoop();
  showScoreHud(false);

  const hero = startOverlay?.querySelector('.hero');
  if (hero) {
    hero.style.animation = 'none';
    hero.offsetHeight; // reflow para reiniciar animação
    hero.style.animation = '';
  }
}
function hideStartOverlay() { startOverlay?.classList.remove('show'); uiLocked = false; }



/* ============================= OVERLAY: TOP 10 ====================================== */
function ensureScoresOverlay() {
  if (document.getElementById('scoresStyles')) return;

  const st = document.createElement('style');
  st.id = 'scoresStyles';
  st.textContent = `
  #scoresOverlay{position:fixed;inset:0;display:none;z-index:1000;pointer-events:auto}
  #scoresOverlay.show{display:block}
  #scoresOverlay .wrap{
    position:absolute; inset:0;
    display:grid; grid-template-rows: auto auto 1fr;
    justify-items:center; align-content:start;
    padding-top:min(4vh, 24px);
  }
  #scoresOverlay .logo{
    width:min(68vw, 420px);
    image-rendering:pixelated; image-rendering:crisp-edges;
    filter:drop-shadow(0 2px 0 rgba(0,0,0,.20));
    user-select:none; -webkit-user-drag:none;
  }
  #scoresOverlay .title{
    width: 100%;
    max-width: min(88vw, 520px);
    margin-top: min(10vh, 300px);
    margin-bottom: 8px;
    font-weight: 900;
    color: #fff;
    font-size: clamp(22px, 5vh, 64px);
    text-shadow: -2px -2px 0 #0a0a0a, 2px -2px 0 #0a0a0a, -2px 2px 0 #0a0a0a, 2px 2px 0 #0a0a0a, 0 2px 0 #0a0a0a;
    user-select: none;
    padding-left: calc((100% - min(85vw, 964px)) / 2);
  }
  #scoresOverlay .list{
 width: 100%;
    max-width: min(91vw, 563px);
    height: 100%;
    overflow: auto;
    padding: 4px 8px 24px 8px;
  }
  #scoresOverlay .item{
    display:grid; grid-template-columns: 48px 1fr auto; align-items:center;
    gap:10px; padding:8px 2px;
  }
  #scoresOverlay .item + .item{ border-top:1px dashed rgba(255,255,255,.18) }
  #scoresOverlay .bird{
    width:42px; height:auto; image-rendering:pixelated;
    filter:drop-shadow(0 1px 0 rgba(0,0,0,.25));
    user-select:none; -webkit-user-drag:none;
  }
  #scoresOverlay .name{
    color:#ffffff; font-weight:600; letter-spacing:.4px;
    font-size:clamp(14px, 2.4vh, 18px);
    text-shadow:
      -1px -1px 0 #0a0a0a, 1px -1px 0 #0a0a0a,
      -1px  1px 0 #0a0a0a, 1px  1px 0 #0a0a0a;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  }
  #scoresOverlay .pts{
    color:#ffffff; font-weight:900;
    font-size:clamp(16px, 3.6vh, 36px);
    text-shadow:
      -1px -1px 0 #0a0a0a, 1px -1px 0 #0a0a0a,
      -1px  1px 0 #0a0a0a, 1px  1px 0 #0a0a0a;
  }
  #scoresOverlay .hint{
    position:absolute; left:0; right:0; bottom:2vh; text-align:center;
    color:#ffffffcc; font-size:clamp(12px, 2vh, 14px);
    text-shadow:-1px -1px 0 #0a0a0a,1px -1px 0 #0a0a0a,-1px 1px 0 #0a0a0a,1px 1px 0 #0a0a0a;
    user-select:none; cursor:pointer; padding:10px 0;
  }
  #scoresOverlay .hint:active{ transform:translateY(1px) }
`;
  document.head.appendChild(st);

  scoresOverlay = document.createElement('div');
  scoresOverlay.id = 'scoresOverlay';
  scoresOverlay.innerHTML = `
    <div class="wrap" id="scoresWrap">
      ${UI_ASSETS.title ? `<img class="logo" src="${UI_ASSETS.title}" alt="logo">` : `<div style="height:56px"></div>`}
      <div class="title">Ranking TOP 10</div>
      <div id="scoresList" class="list"></div>
      <div class="hint">Toque para voltar</div>
    </div>
  `;
  document.body.appendChild(scoresOverlay);

  scoresOverlay.addEventListener('click', () => { hideScoresOverlay(); showStartOverlay(); });
  const wrap = scoresOverlay.querySelector('#scoresWrap');
  wrap.addEventListener('click', (e) => e.stopPropagation());

  const hint = scoresOverlay.querySelector('.hint');
  hint?.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    hideScoresOverlay(); showStartOverlay();
  });
}

async function showScoresOverlay() {
  hideStartOverlay();
  ensureScoresOverlay();
  scoresOverlay?.classList.add('show');
  uiLocked = true;
  startBgLoop();
  showScoreHud(false);

  const list = document.getElementById('scoresList');
  if (!list) return;
  list.innerHTML = `<div class="name" style="opacity:.8;padding:10px 0">Carregando…</div>`;

  try {
    const rows = await fetchTop10FromSupabase();
    renderTop10ListTo(list, rows);
  } catch (e) {
    console.warn('[Top10] erro ao buscar:', e);
    list.innerHTML = `<div class="name" style="opacity:.85;padding:12px 2px">Sem scores no servidor ainda.</div>`;
  }
}
function hideScoresOverlay() { scoresOverlay?.classList.remove('show'); uiLocked = false; }

function renderTop10ListTo(listEl, rows) {
  if (!listEl) return;
  const birdIcon = UI_ASSETS.heroBird || (cfg.assets.birdFrames?.[0] || '');
  if (!rows?.length) {
    listEl.innerHTML = `<div class="name" style="opacity:.85;padding:12px 2px">Sem scores no servidor ainda.</div>`;
    return;
  }
  listEl.innerHTML = rows.map((r) => `
    <div class="item">
      ${birdIcon ? `<img class="bird" src="${birdIcon}" alt="">` : `<div></div>`}
      <div class="name">${(r.player_name || 'Anônimo').replace(/[<>&]/g, s => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[s]))}</div>
      <div class="pts">${r.score ?? 0}</div>
    </div>
  `).join('');
}

/* ============================= OVERLAY: RANK (GAME OVER) ============================ */
function ensureRankOverlay() {
  if (document.getElementById('rankStyles')) return;

  const panelBgUrl = joinBase('assets/img/modalBG.png');

  const st = document.createElement('style');
  st.id = 'rankStyles';
  st.textContent = `
    #rankOverlay{position:fixed;inset:0;display:none;z-index:1100;cursor:pointer}
    #rankOverlay.show{display:block}
    #rankOverlay .wrap{position:absolute;inset:0;display:grid;place-items:start center;pointer-events:auto}
    #rankOverlay .prize{
      margin-top:2px; font-size:clamp(16px,3.2vh,24px); color:#222;
      text-shadow:-2px -2px 0 #fff, 2px -2px 0 #fff, -2px 2px 0 #fff, 2px 2px 0 #fff;
      font-weight:800; letter-spacing:1px;
    }
    #rankOverlay .title{
      margin-top:4vh;color:#ffffff; font-weight:900; letter-spacing:1px;
      font-size:clamp(26px,5.5vh,44px);
      text-shadow:-2px -2px 0 #0b0b0b, 2px -2px 0 #0b0b0b, -2px 2px 0 #0b0b0b, 2px 2px 0 #0b0b0b, 0 2px 0 #0b0b0b;
      user-select:none;
    }
    #rankOverlay .panel{
      position:relative; margin-top:3vh; width:min(88vw, 620px);
      aspect-ratio: 5 / 3; background-image:url('${panelBgUrl}');
      background-repeat:no-repeat; background-position:center; background-size:contain;
      image-rendering:pixelated; display:flex; align-items:center; justify-content:center;
      padding: clamp(18px, 3vh, 28px) clamp(22px, 4vh, 40px);
    }
    #rankOverlay .panel-inner{ display:flex; align-items:center; gap:min(4vw,24px); }
    #rankOverlay .panel .bird{ width:min(18vw,120px); image-rendering:pixelated; filter:drop-shadow(0 2px 0 #0003) }
    #rankOverlay .score{
      font-weight:900; color:#ffffff; background:#111; padding:2px 12px; border-radius:10px; display:inline-block;
      font-size:clamp(64px,10vh,120px); line-height:1;
      text-shadow:-6px -6px 0 #000, 6px -6px 0 #000, -6px  6px 0 #000, 6px  6px 0 #000, 0 4px 0 #000;
    }
    #rankOverlay .ranking{
      margin-top:8px; font-size:clamp(18px,3.5vh,26px); color:#222;
      text-shadow:-2px -2px 0 #fff, 2px -2px 0 #fff, -2px  2px 0 #fff, 2px  2px 0 #fff;
      font-weight:800; letter-spacing:1px;
    }
    #rankOverlay .finalizar{
      margin-top:5vh; color:#ffffff; font-size:clamp(18px,3.5vh,28px); font-weight:700;
      text-shadow:-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000,2px 2px 0 #000;
      user-select:none;
    }
    #rankOverlay .hand{
      position:absolute; bottom:6vh; width:min(20vw,120px); image-rendering:pixelated;
      animation:hand-tap 1.15s ease-in-out infinite; transform-origin:10% 10%;
      filter:drop-shadow(0 2px 0 #0003);
    }
    @keyframes hand-tap{0%,100%{transform:translate(0,0) scale(1)}40%{transform:translate(12px,12px) scale(.92)}60%{transform:translate(0,0) scale(1)}}
  `;
  document.head.appendChild(st);

  rankOverlay = document.createElement('div');
  rankOverlay.id = 'rankOverlay';
  rankOverlay.innerHTML = `
    <div class="wrap" id="rankWrap">
      <div class="title">Game Over</div>
      <div class="panel">
        <div class="panel-inner">
          ${UI_ASSETS.heroBird ? `<img class="bird" src="${UI_ASSETS.heroBird}" alt="bird">` : ''}
          <div>
            <div id="rankScore" class="score">0</div>
            <div id="rankPos" class="ranking">Ranking --</div>
            <div id="rankPrize" class="prize"></div>
          </div>
        </div>
      </div>
      <div class="finalizar">Finalizar</div>
      ${UI_ASSETS.hand ? `<img class="hand" src="${UI_ASSETS.hand}" alt="tap">` : ''}
    </div>
  `;
  document.body.appendChild(rankOverlay);

  rankOverlay.addEventListener('click', finalizeAndReset);
  const panel = rankOverlay.querySelector('.panel');
  panel?.addEventListener('click', (e) => e.stopPropagation());
}
function showRankOverlay(finalScore, rankPos) {
  const sc = document.getElementById('rankScore');
  const rp = document.getElementById('rankPos');
  const pr = document.getElementById('rankPrize');
  if (sc) sc.textContent = String(finalScore | 0);
  if (rp) rp.textContent = `Ranking ${rankPos != null ? String(rankPos).padStart(2, '0') : '--'}`;

  const prize = getPrizeForScore(finalScore);
  if (pr) pr.textContent = prize ? (prize.name || 'Prêmio') : '';

  rankOverlay?.classList.add('show');
  uiLocked = true;
  showScoreHud(false);
}
function hideRankOverlay() { rankOverlay?.classList.remove('show'); uiLocked = false; }

/* ============================= SUPABASE / RANK ====================================== */
async function salvarScoreNoSupabase(pontos) {
  if (!supabase) return;

  const player = getLocalPlayer();
  const payload = {
    run_id: String(runId),
    player_name: player.nome || 'Anônimo',
    score: Number(pontos),
    played_at: new Date().toISOString(),
    prize_group: determinePrizeGroup(Number(pontos)) || null,
    meta: {
      startedAt: runStartISO,
      durationMs: Math.max(0, Math.round(performance.now() - runStartPerf)),
      activeTimeMs: Math.max(0, Math.round(activeTimeMs)),
      board: { w: cfg?.board?.width, h: cfg?.board?.height },
      version: 1,
    },
  };

  const { error } = await supabase.from(SUPABASE_SCORES_TABLE).insert([payload]);
  if (error) throw error;
}

async function fetchRankForScore(finalScore) {
  if (!supabase) return null;
  const { count, error } = await supabase
    .from(SUPABASE_SCORES_TABLE)
    .select('*', { count: 'exact', head: true })
    .gt('score', Number(finalScore));
  if (error) { console.warn('[Supabase] rank erro:', error); return null; }
  return (typeof count === 'number') ? (count + 1) : null;
}

async function fetchTop10FromSupabase() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from(SUPABASE_SCORES_TABLE)
    .select('player_name, score, played_at')
    .order('score', { ascending: false })
    .limit(10);
  if (error) { console.warn('[Supabase] top10 erro:', error); return []; }
  return data || [];
}

/* ============================= GAME OVER FLOW ======================================= */
async function handleGameOverSave() {
  if (saveOnce) return savePromise;
  saveOnce = true;

  // Abre o modal imediatamente (sem aguardar rede)
  showRankOverlay(score, null); // mostra "Ranking --" até chegar a posição

  // Dispara save + rank em paralelo
  savePromise = (async () => {
    const saveP = salvarScoreNoSupabase(score)
      .catch(e => console.warn('[Supabase] falha ao salvar:', e));

    const rankP = fetchRankForScore(score)
      .catch(e => { console.warn('[Supabase] rank erro:', e); return null; });

    const [, rankRes] = await Promise.allSettled([saveP, rankP]);
    const pos = (rankRes.status === 'fulfilled') ? rankRes.value : null;

    // Atualiza a posição no painel (se ainda estiver aberto)
    const rp = document.getElementById('rankPos');
    if (rp) rp.textContent = `Ranking ${pos != null ? String(pos).padStart(2, '0') : '--'}`;

    try { sessionStorage.clear(); } catch { }
  })();

  return savePromise;
}

/* ============================= RESET / FINALIZAR ==================================== */
function finalizeAndReset() {
  try { localStorage.clear(); } catch { }
  try { sessionStorage.clear(); } catch { }
  try {
    if ('caches' in window) {
      caches.keys().then(keys => keys.forEach(k => caches.delete(k))).catch(() => { });
    }
  } catch { }

  stopGameLoop();
  stopSpawning();
  running = false;
  pipeArray = [];
  isGameOver = false;
  gameStarted = false;
  showScoreHud(false);
  hideRankOverlay();
  showStartOverlay();
  startBgLoop();
}

/* ============================= PRÊMIOS / GRUPOS ===================================== */
function getPrizeForScore(score) {
  const arr = Array.isArray(cfg.prizes) ? cfg.prizes : [];
  const s = Number(score) || 0;

  let found = arr.find(g => s >= Number(g.min ?? -Infinity) && s < Number(g.max ?? Infinity));
  if (!found && arr.length) {
    const last = arr[arr.length - 1];
    if (s >= Number(last.min ?? -Infinity) && s <= Number(last.max ?? Infinity)) {
      found = last;
    }
  }
  return found || null;
}
function extraSpeedStepPxPerFrame() {
  const stepMs = Math.max(1, cfg.difficulty?.stepEveryMs ?? 2000);
  const addStep = Number(cfg.difficulty?.stepAddPxPerFrame ?? 0.30);
  const maxExtra = Number(cfg.difficulty?.stepMaxExtraPxPerFrame ?? 6);

  const steps = Math.floor(activeTimeMs / stepMs);
  return Math.min(maxExtra, steps * addStep);
}
function determinePrizeGroup(points) {
  return groupNameForScore(Number(points) || 0, cfg.prizes);
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
function _inRange(score, g, isLast) {
  return isLast ? (score >= g.min && score <= g.max) : (score >= g.min && score < g.max);
}
function groupNameForScore(score, prizes) {
  const arr = normalizePrizes(prizes);
  for (let i = 0; i < arr.length; i++) {
    if (_inRange(score, arr[i], i === arr.length - 1)) return arr[i].name;
  }
  return null;
}

// === SCORE HUD (DOM) ===
let scoreHudEl = null;
let scoreHudVisible = false;
let lastScoreText = '';

function ensureScoreHud() {
  if (!document.getElementById('scoreHudStyles')) {
    const st = document.createElement('style');
    st.id = 'scoreHudStyles';
    st.textContent = `
      #scoreHud{
        position: fixed;
        top: 12px;           /* reposicione à vontade no seu CSS */
        left: 12px;          /* ex.: top:auto; bottom:24px; right:24px; */
        z-index: 200;        /* abaixo dos overlays (999/1000/1100) */
        pointer-events: none;
        user-select: none;
        font: var(--score-font, 45px sans-serif);
        color: var(--score-color, #ffffff);
        text-shadow:
          -1px -1px 0 #0a0a0a, 1px -1px 0 #0a0a0a,
          -1px  1px 0 #0a0a0a, 1px  1px 0 #0a0a0a;
        display: none;
      }
    `;
    document.head.appendChild(st);
  }
  if (!scoreHudEl) {
    scoreHudEl = document.createElement('div');
    scoreHudEl.id = 'scoreHud';
    scoreHudEl.setAttribute('aria-live', 'off');
    scoreHudEl.setAttribute('aria-atomic', 'true');
    document.body.appendChild(scoreHudEl);
  }
  // aplica cores e fonte vindas da cfg (você pode sobrescrever no CSS também)
  scoreHudEl.style.setProperty('--score-font', cfg?.ui?.font || '45px sans-serif');
  scoreHudEl.style.setProperty('--score-color', cfg?.ui?.scoreColor || '#ffffff');
}

function showScoreHud(show) {
  if (!scoreHudEl) return;
  scoreHudEl.style.display = show ? 'block' : 'none';
  scoreHudVisible = !!show;
}

// Bloqueia RIGHT CLICK (mouse) globalmente + menu de contexto
function disableRightClickGlobally() {
  const opts = { capture: true };

  const stop = (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    return false;
  };

  // Bloqueia botão direito já no início do evento
  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && (e.button === 2 || e.buttons === 2)) stop(e);
  };

  const onMouseDown = (e) => {
    if (e.button === 2) stop(e);
  };

  // Alguns navegadores disparam 'auxclick' para botão do meio/direito
  const onAuxClick = (e) => {
    if (e.button === 2) stop(e);
  };

  // Garante que o menu de contexto não abra (inclui ctrl+click no mac)
  const onContextMenu = (e) => stop(e);

  window.addEventListener('pointerdown', onPointerDown, opts);
  window.addEventListener('mousedown', onMouseDown, opts);
  window.addEventListener('auxclick', onAuxClick, opts);
  window.addEventListener('contextmenu', onContextMenu, opts);
}


let audioEngine = null;

class WebAudioEngine {
  constructor() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: 'interactive' });
    this.buffers = {};
    this._unlock = this._unlock.bind(this);
  }
  async load(name, url) {
    if (!url) return;
    const res = await fetch(url, { cache: 'force-cache' });   // pega do cache quando possível
    const ab = await res.arrayBuffer();
    this.buffers[name] = await new Promise((ok, err) =>
      this.ctx.decodeAudioData(ab, ok, err)
    );
  }
  async loadAll(map) {
    await Promise.all(Object.entries(map).map(([k, u]) => this.load(k, u)));
  }
  unlockOnFirstGesture() {
    window.addEventListener('pointerdown', this._unlock, true);
    window.addEventListener('keydown', this._unlock, true);
  }
  _unlock() {
    try { this.ctx.resume(); } catch { }
    window.removeEventListener('pointerdown', this._unlock, true);
    window.removeEventListener('keydown', this._unlock, true);
  }
  play(name, { volume = 1, rate = 1 } = {}) {
    const buf = this.buffers[name];
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;

    const gain = this.ctx.createGain();
    gain.gain.value = volume;

    src.connect(gain).connect(this.ctx.destination);
    try { src.start(this.ctx.currentTime); } catch { }
  }
}




/* ============================= HELPERS GERAIS ======================================= */
async function withUiLock(promiseLike) { uiLocked = true; try { await promiseLike; } finally { uiLocked = false; } }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function deg2rad(d) { return (d * Math.PI) / 180; }
function mapRangeClamped(v, inMin, inMax, outMin, outMax) {
  if (inMax === inMin) return outMin;
  const t = clamp((v - inMin) / (inMax - inMin), 0, 1);
  return outMin + t * (outMax - outMin);
}
function okImg(im) { return !!(im && im.complete && im.naturalWidth > 0); }
function tryDrawImage(im, x, y, w, h) {
  if (okImg(im)) ctx.drawImage(im, x, y, w, h);
  else { ctx.save(); ctx.fillStyle = '#2dd4bf33'; ctx.fillRect(x, y, w, h); ctx.strokeStyle = '#ef4444'; ctx.strokeRect(x, y, w, h); ctx.restore(); }
}