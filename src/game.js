// src/game.js
"use strict";

import { supabase } from './supabase';
import { ensureCadastro, getLocalPlayer, showCadastroModal } from './ui/cadastroModal';

// ================== BASE/ASSETS (GitHub Pages friendly) ==================
const BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) ? import.meta.env.BASE_URL : '/';
const joinBase = (p) => {
  if (!p) return '';
  const s = String(p);
  if (/^(https?:|data:|blob:)/i.test(s)) return s;
  return BASE + s.replace(/^\//, '');
};

// ================== CONSTANTES ==================
const KEY = 'flappy:config';
const SUPABASE_SCORES_TABLE = 'scores';
const SUPABASE_CONFIG_TABLE = 'flappy_config';
const CONFIG_SLUG = localStorage.getItem('flappy:configSlug') || 'default';

// Mundo lógico base (360×640) e alvo visual (1080×1920)
const BASE_W = 360, BASE_H = 640;
const TARGET_W = 1080, TARGET_H = 1920;

// assets padrão (devem existir em public/assets/img/)
const DEFAULT_ASSETS = {
  birdFrames: [
    'assets/img/flappybird1.png',
    'assets/img/flappybird2.png',
    'assets/img/flappybird3.png',
  ],
  topPipe: 'assets/img/toppipe.png',
  bottomPipe: 'assets/img/bottompipe.png',
  bg: '' // ex: 'assets/img/bg-2160x1920.jpg'
};

// ================== CONFIG ==================
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
    console.warn('[Supabase] config exception:', e);
    return null;
  }
}

// config padrão (pensado para BASE_W×BASE_H)
const DEFAULT_CONFIG = {
  board: { width: BASE_W, height: BASE_H, background: '#70c5ce' },
  assets: { ...DEFAULT_ASSETS, sfx: { flap: '', score: '', hit: '' } },
  // Parallax do BG: por padrão 0.5 da velocidade dos canos; se quiser fixa, use fixedPxPerSec > 0
  bg: {
    parallaxFactor: 0.5,
    fixedPxPerSec: 0
  },
  bird: {
    width: 34, height: 24,
    startXPercent: 12.5, startYPercent: 50,
    flapForce: 6, maxFallSpeed: 12, hitboxPadding: 2,
    // Autosize (opcional): % da altura do canvas. Se respectSizePercent = true, sempre usa.
    sizePercentOfHeight: 0,
    respectSizePercent: false,
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
    // minHorizontalSpacingPx: 520 // opcional; senão calculo é automático
  },
  difficulty: {
    rampEnabled: false, speedPerScore: 0.05, minGapPercent: 18, gapStepPerScore: 0.2,
    timeRampEnabled: true, timeStartDelayMs: 0,
    timeSpeedPerSec: 0.03, timeMaxExtraSpeed: 5, timeGapStepPerSec: 0.02
  },
  spawn: { intervalMs: 1500 },
  scoring: { pointsPerPipe: 0.5 },
  ui: {
    font: '45px sans-serif', scoreColor: '#ffffff',
    gameOverText: 'GAME OVER', gameOverFont: '45px sans-serif', gameOverColor: '#ffffff'
  },
  controls: {
    jump: ['Space', 'ArrowUp', 'KeyX'],
    minFlapIntervalMs: 120,
    allowHoldToFlap: false
  },
  gameplay: { restartOnJump: false, gracePeriodMs: 100, pauseKey: 'KeyP' }
};

// ================== ESTADO ==================
let cfg = structuredClone(DEFAULT_CONFIG);
let canvas, ctx;
let topPipeImg = null, bottomPipeImg = null, bgImg = null;
let birdImgs = [], SFX = {};

let bird, velocityY = 0, pipeArray = [];
let isGameOver = false, score = 0;
let allowedJumpKeys = new Set(), spawnTimerId = null;
let birdTiltDeg = 0, flapAnimStart = 0, flapAnimEnd = 0;
let gameStarted = false, graceUntilTs = 0, paused = false, lastTs = 0;
let activeTimeMs = 0, timeRampStartTs = 0, lastFlapTs = -1;
let uiLocked = false;

let runId = null, runStartISO = null, runStartPerf = 0;
let startOverlay = null, scoresOverlay = null, goOverlay = null;

// loop
let rafId = 0;
let running = false;

// BG scroll
let bgScrollX = 0; // em pixels no canvas (após escala)

// ================== BOOT ==================
export async function boot() {
  cfg = await loadConfigSanitized();            // merge + sanitize (Supabase prioridade)
  cfg = forceBoardToTarget(cfg, TARGET_W, TARGET_H);
  cfg = applyUniformScale(cfg, BASE_W, BASE_H);

  setupCanvas();
  await loadAssets();
  setupControls();

  ensureStartOverlay();
  ensureScoresOverlay();
  ensureGameOverOverlay();

  showStartOverlay(); // espera o clique "Começar", que chama startGame()
}

// ================== CICLO DE VIDA ==================
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

  bgScrollX = 0;
}

export async function startGame() {
  // cadastro antes de toda partida
  await withUiLock(ensureCadastro());

  hideStartOverlay();
  hideScoresOverlay();
  hideGameOverOverlay();

  resetRunState();
  stopSpawning();      // sanidade
  stopGameLoop();      // sanidade

  running = true;
  scheduleNextSpawn(true);
  rafId = requestAnimationFrame(tick);
}

export function gameOver(reason = '') {
  if (isGameOver) return;
  isGameOver = true;

  try { SFX.hit?.play(); } catch { }
  stopSpawning();
  stopGameLoop();

  // salva e mostra overlay
  handleGameOverSave().catch(() => { });
}

function stopGameLoop() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

function stopSpawning() {
  if (spawnTimerId) clearTimeout(spawnTimerId);
  spawnTimerId = null;
}

// ================== CONFIG / SANITIZAÇÃO ==================
async function loadConfigSanitized() {
  let merged = structuredClone(DEFAULT_CONFIG);

  // 1) arquivo opcional
  try {
    const res = await fetch(joinBase('/flappy-config.json'), { cache: 'no-store' });
    if (res.ok) merged = deepMerge(merged, await res.json() || {});
  } catch { }

  // 2) LocalStorage (fallback)
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const { assets: _ignore, ...rest } = JSON.parse(raw) || {};
      merged = deepMerge(merged, rest || {});
    }
  } catch { }

  // 3) Supabase (prioridade)
  try {
    const remote = await fetchRemoteConfigFromSupabase();
    if (remote) merged = deepMerge(merged, remote);
  } catch (e) {
    console.warn('[config] falha Supabase:', e);
  }

  merged.assets = sanitizeAssets(merged.assets);
  console.log('[CFG]', { bird: merged.bird, board: merged.board, bg: merged.assets.bg, bgCfg: merged.bg });
  return merged;
}

function sanitizeAssets(a) {
  const out = { ...DEFAULT_ASSETS };
  const frames = Array.isArray(a?.birdFrames) ? a.birdFrames : [];
  const cleaned = frames.map(normalizeAssetPath).filter(Boolean);
  out.birdFrames = cleaned.length ? unique(cleaned) : DEFAULT_ASSETS.birdFrames;
  out.topPipe = normalizeAssetPath(a?.topPipe) || DEFAULT_ASSETS.topPipe;
  out.bottomPipe = normalizeAssetPath(a?.bottomPipe) || DEFAULT_ASSETS.bottomPipe;
  out.bg = normalizeAssetPath(a?.bg) || '';
  out.sfx = a?.sfx || { flap: '', score: '', hit: '' };
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

// ================== ESCALA PARA 1080×1920 ==================
function forceBoardToTarget(cfgIn, w, h) {
  const cfg = structuredClone(cfgIn);
  cfg.board = cfg.board || {};
  cfg.board.width = w;
  cfg.board.height = h;
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

// ================== CANVAS / ASSETS ==================
function setupCanvas() {
  canvas = document.getElementById('board') || Object.assign(document.createElement('canvas'), { id: 'board' });
  if (!canvas.isConnected) document.body.appendChild(canvas);

  document.documentElement.style.height = '100%';
  Object.assign(document.body.style, {
    margin: '0', height: '100%', display: 'grid', placeItems: 'center',
    background: cfg.board.background || '#000'
  });

  canvas.width = cfg.board.width;
  canvas.height = cfg.board.height;

  const vw = Math.max(1, window.innerWidth || canvas.width);
  const vh = Math.max(1, window.innerHeight || canvas.height);
  const scale = Math.min(vw / canvas.width, vh / canvas.height);
  canvas.style.width = Math.round(canvas.width * scale) + 'px';
  canvas.style.height = Math.round(canvas.height * scale) + 'px';

  ctx = canvas.getContext('2d', { alpha: false });
}

function loadAssets() {
  return new Promise((resolve) => {
    const frames = cfg.assets.birdFrames || [];
    let toLoad = frames.length + 3; // +2 pipes +1 bg
    const done = () => {
      if (--toLoad === 0) {
        birdImgs = birdImgs.filter(okImg);
        applyDynamicBirdAutosize();
        resolve();
      }
    };

    // Bird frames
    birdImgs = [];
    frames.forEach(src => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = done;
      im.onerror = () => { console.warn('[assets] falhou frame:', src); done(); };
      im.src = src;
      birdImgs.push(im);
    });

    // Pipes
    topPipeImg = new Image();
    topPipeImg.crossOrigin = "anonymous";
    topPipeImg.onload = done;
    topPipeImg.onerror = () => { console.warn('[assets] topPipe falhou:', cfg.assets.topPipe); topPipeImg = null; done(); };
    topPipeImg.src = cfg.assets.topPipe;

    bottomPipeImg = new Image();
    bottomPipeImg.crossOrigin = "anonymous";
    bottomPipeImg.onload = done;
    bottomPipeImg.onerror = () => { console.warn('[assets] bottomPipe falhou:', cfg.assets.bottomPipe); bottomPipeImg = null; done(); };
    bottomPipeImg.src = cfg.assets.bottomPipe;

    // Background (2160×1920) — opcional
    bgImg = null;
    const bgUrl = cfg.assets.bg;
    if (bgUrl) {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = done;
      im.onerror = () => { console.warn('[assets] bg falhou:', bgUrl); done(); };
      im.src = bgUrl;
      bgImg = im;
    } else {
      // Se não tiver BG, “consome” um slot do contador
      done();
    }

    // SFX
    ['flap', 'score', 'hit'].forEach(k => {
      const url = cfg.assets?.sfx?.[k];
      if (url) { const a = new Audio(url); a.preload = 'auto'; SFX[k] = a; }
    });
  });
}

// Redimensiona o pássaro usando % da altura do canvas (se configurado).
function applyDynamicBirdAutosize() {
  const percent = Number(cfg.bird?.sizePercentOfHeight || 0);
  const usePercent = !!cfg.bird?.respectSizePercent && percent > 0;

  const MIN_AUTO_PERCENT = 6;
  let finalPercent = 0;

  if (usePercent) {
    finalPercent = percent;
  } else {
    const tooSmall = (cfg.bird.height || 0) < canvas.height * 0.04; // <4% da altura
    if (tooSmall) finalPercent = Math.max(MIN_AUTO_PERCENT, percent || 0);
  }

  if (finalPercent <= 0) return;

  let ratio = 34 / 24;
  const ok = birdImgs.find(im => im && im.complete && im.naturalWidth > 0);
  if (ok && ok.naturalHeight > 0) ratio = ok.naturalWidth / ok.naturalHeight;

  const targetH = Math.round(canvas.height * (finalPercent / 100));
  const targetW = Math.max(1, Math.round(targetH * ratio));

  cfg.bird.width = targetW;
  cfg.bird.height = targetH;

  if (bird) { bird.width = targetW; bird.height = targetH; }

  console.log('[auto-bird]', { finalPercent, targetW, targetH });
}

// ================== CONTROLES ==================
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
    // F9: limpa config antiga e recarrega
    if (e.code === 'F9') {
      try { localStorage.removeItem(KEY); } catch { }
      location.reload();
      return;
    }

    if (isTypingTarget(e)) return;
    if (uiLocked) return;

    preventScrollForGameKeys(e);

    if (e.code === (cfg.gameplay.pauseKey || 'KeyP')) { if (!e.repeat) paused = !paused; return; }
    if (!cfg.controls.allowHoldToFlap && e.repeat) return;

    onJumpKey(e);
  }, { capture: true });

  window.addEventListener('pointerdown', (e) => {
    if (isTypingTarget(e)) return;
    if (uiLocked) return;
    onJumpKey({ code: cfg.controls.jump?.[0] || 'Space', repeat: false });
  }, { capture: true });

  window.addEventListener('blur', () => { paused = true; });
  window.addEventListener('focus', () => { paused = false; });
}

function onJumpKey(e) {
  if (!running) return;
  if (!allowedJumpKeys.has(e.code)) return;
  if (paused) return;

  const now = performance.now();
  const minInt = Math.max(0, cfg.controls.minFlapIntervalMs || 0);
  if (lastFlapTs >= 0 && now - lastFlapTs < minInt) return;
  lastFlapTs = now;

  if (isGameOver) {
    if (cfg.gameplay.restartOnJump) startGame();
    return;
  }

  if (!gameStarted) {
    gameStarted = true;
    graceUntilTs = performance.now() + Math.max(0, cfg.gameplay.gracePeriodMs || 0);
    const delay = Math.max(0, cfg.difficulty?.timeStartDelayMs ?? 0);
    timeRampStartTs = graceUntilTs + delay;
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

// ================== LOOP ==================
function tick(ts) {
  if (!running) return;

  rafId = requestAnimationFrame(tick);

  if (!lastTs) lastTs = ts || performance.now();
  const nowTs = ts || performance.now();
  const dt = Math.min(50, nowTs - lastTs);
  lastTs = nowTs;

  // Fundo (BG) antes de tudo (ou cor sólida se não houver BG)
  drawBackground(dt);

  const t = dt / 16.667;

  if (gameStarted && !paused && !isGameOver && nowTs >= timeRampStartTs) activeTimeMs += dt;

  drawHUD();

  if (!gameStarted) { if (bird) drawBirdWithTilt(); return; }
  if (paused) {
    ctx.fillStyle = '#00000055'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff'; ctx.font = '28px sans-serif'; ctx.fillText('PAUSADO', 5, 90);
    return;
  }
  if (isGameOver) return;

  const inGrace = performance.now() < graceUntilTs;
  if (inGrace) { velocityY += cfg.physics.gravity * t; if (velocityY > 0) velocityY = 0; }
  else { velocityY += cfg.physics.gravity * t; if (velocityY > cfg.bird.maxFallSpeed) velocityY = cfg.bird.maxFallSpeed; }
  bird.y = Math.max(bird.y + velocityY * t, 0);

  updateBirdTilt(t);
  drawBirdWithTilt();

  if (bird.y > canvas.height) { gameOver('fell'); return; }

  const scroll = currentScrollSpeed();
  for (let i = 0; i < pipeArray.length; i++) {
    const p = pipeArray[i];
    p.x += scroll * t;
    tryDrawImage(p.img, p.x, p.y, p.width, p.height);

    if (!p.passed && bird.x > p.x + p.width) { score += cfg.scoring.pointsPerPipe; p.passed = true; try { SFX.score?.play(); } catch { } }
    if (collides(bird, p)) { gameOver('hit'); return; }
  }
  while (pipeArray.length > 0 && pipeArray[0].x < -cfg.pipes.width) pipeArray.shift();
}

// ================== BACKGROUND SCROLL ==================
function drawBackground(dtMs) {
  if (!okImg(bgImg)) {
    // Fallback: preenche com a cor do board
    ctx.fillStyle = cfg.board.background || '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }

  // Calcula velocidade do BG
  const pxPerSecPipes = currentScrollSpeedAbsPerSec(); // velocidade absoluta dos canos
  const fixed = Number(cfg.bg?.fixedPxPerSec || 0);
  const factor = Number(cfg.bg?.parallaxFactor ?? 0.5);
  const bgPxPerSec = fixed > 0 ? fixed : (pxPerSecPipes * factor);

  // Atualiza offset (move da direita para a esquerda → incrementa scroll e desenha para a esquerda)
  const delta = Math.max(0, dtMs) / 1000;
  bgScrollX = (bgScrollX + bgPxPerSec * delta) || 0;

  // Desenha “telhas” do BG: imagem 2160×1920 → escala para altura do canvas
  const imgW = bgImg.naturalWidth, imgH = bgImg.naturalHeight;
  const scale = canvas.height / imgH;
  const drawW = Math.ceil(imgW * scale);
  const drawH = canvas.height;

  // Posição inicial (negativa) e wrap
  let x = -Math.floor(bgScrollX % drawW);

  // Desenha 2 cópias para cobrir o canvas
  ctx.drawImage(bgImg, 0, 0, imgW, imgH, x, 0, drawW, drawH);
  ctx.drawImage(bgImg, 0, 0, imgW, imgH, x + drawW, 0, drawW, drawH);
}

// ================== SPAWNER ==================
function startSpawning() {
  stopSpawning();
  scheduleNextSpawn(true);
}

function currentScrollSpeedAbsPerSec() {
  const base = Math.abs(cfg.pipes.scrollSpeed);
  const scoreExtra = cfg.difficulty?.rampEnabled ? (cfg.difficulty.speedPerScore || 0) * score : 0;
  const sec = activeTimeMs / 1000;
  const timeExtra = cfg.difficulty?.timeRampEnabled
    ? Math.min(cfg.difficulty.timeMaxExtraSpeed ?? Infinity, (cfg.difficulty.timeSpeedPerSec || 0) * sec)
    : 0;
  const pxPerFrame = base + scoreExtra + timeExtra;
  return pxPerFrame * 60;
}

function scheduleNextSpawn(spawnNow = false) {
  if (spawnNow) placePipes();

  const pxPerSec = Math.max(1, currentScrollSpeedAbsPerSec());
  const desiredSpacingPx =
    (cfg.pipes.minHorizontalSpacingPx ?? Math.max(canvas.width * 0.48, cfg.pipes.width * 2.2));

  const ms = Math.max(120, Math.round((desiredSpacingPx / pxPerSec) * 1000));
  spawnTimerId = setTimeout(() => {
    if (!running || isGameOver) return;
    scheduleNextSpawn(true);
  }, ms);
}

// ================== HUD / TILT ==================
function currentScrollSpeed() {
  const base = Math.abs(cfg.pipes.scrollSpeed);
  const scoreExtra = cfg.difficulty?.rampEnabled ? (cfg.difficulty.speedPerScore || 0) * score : 0;
  const sec = activeTimeMs / 1000;
  const timeExtra = cfg.difficulty?.timeRampEnabled
    ? Math.min(cfg.difficulty.timeMaxExtraSpeed ?? Infinity, (cfg.difficulty.timeSpeedPerSec || 0) * sec)
    : 0;
  return -(base + scoreExtra + timeExtra);
}

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
  ctx.fillStyle = cfg.ui.scoreColor;
  ctx.font = cfg.ui.font;
  ctx.fillText(score, 5, 64);
}

// ================== PIPES / COLISÃO ==================
function placePipes() {
  if (!running || isGameOver || paused) return;

  const baseGap = cfg.pipes.gapPercent;
  const scoreStep = cfg.difficulty?.gapStepPerScore ?? 0;
  const minGap = cfg.difficulty?.minGapPercent ?? baseGap;

  let gapPercent = cfg.difficulty?.rampEnabled ? (baseGap - score * scoreStep) : baseGap;
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

function collides(a, b) {
  const pad = Math.max(0, cfg.bird.hitboxPadding || 0);
  const ax = a.x + pad, ay = a.y + pad;
  const aw = a.width - pad * 2, ah = a.height - pad * 2;
  return ax < b.x + b.width && ax + aw > b.x && ay < b.y + b.height && ay + ah > b.y;
}

// ================== SUPABASE ==================
async function salvarScoreNoSupabase(pontos) {
  if (!supabase) return;

  const player = getLocalPlayer();
  const payload = {
    run_id: String(runId),
    player_name: player.nome || 'Anônimo',
    email: player.email || 'anon@demo.com',
    telefone: player.telefone || '',
    score: Number(pontos),
    win: false,
    played_at: new Date().toISOString(),
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

// ================== OVERLAYS ==================
function ensureStartOverlay() {
  if (document.getElementById('startStyles')) return;

  const st = document.createElement('style');
  st.id = 'startStyles';
  st.textContent = `
    #startOverlay{position:fixed;inset:0;display:none;place-items:center;z-index:999}
    #startOverlay.show{display:grid}
    #startOverlay .backdrop{position:absolute;inset:0;background:rgba(0,0,0,.55);backdrop-filter: blur(2px)}
    #startOverlay .card{position:relative;background:#0f172a;border:1px solid #1f2937;border-radius:16px;padding:16px;min-width:320px;max-width:92vw;color:#e5e7eb;box-shadow:0 10px 30px #0009}
    #startOverlay .title{font:600 22px/1.2 system-ui;margin:0 0 12px}
    #startOverlay .row{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}
    #startOverlay .btn{appearance:none;border:1px solid #334155;background:#111827;color:#e5e7eb;padding:10px 14px;border-radius:10px;cursor:pointer;font-size:14px}
    #startOverlay .btn:hover{background:#1f2937}
  `;
  document.head.appendChild(st);

  startOverlay = document.createElement('div');
  startOverlay.id = 'startOverlay';
  startOverlay.innerHTML = `
    <div class="backdrop"></div>
    <div class="card">
      <h3 class="title">Flappy + Supabase</h3>
      <div class="row">
        <button id="btnStart"  class="btn">Começar</button>
        <button id="btnScores" class="btn">Scores</button>
      </div>
    </div>
  `;
  document.body.appendChild(startOverlay);

  document.getElementById('btnStart')?.addEventListener('click', () => startGame());
  document.getElementById('btnScores')?.addEventListener('click', () => showScoresOverlay());
}

function showStartOverlay() {
  startOverlay?.classList.add('show');
  uiLocked = true;
}
function hideStartOverlay() {
  startOverlay?.classList.remove('show');
  uiLocked = false;
}

function ensureScoresOverlay() {
  if (document.getElementById('scoresStyles')) return;

  const st = document.createElement('style');
  st.id = 'scoresStyles';
  st.textContent = `
    #scoresOverlay{position:fixed;inset:0;display:none;place-items:center;z-index:1000}
    #scoresOverlay.show{display:grid}
    #scoresOverlay .backdrop{position:absolute;inset:0;background:rgba(0,0,0,.55);backdrop-filter: blur(2px)}
    #scoresOverlay .card{position:relative;background:#0f172a;border:1px solid #1f2937;border-radius:16px;padding:16px;min-width:320px;max-width:92vw;color:#e5e7eb;box-shadow:0 10px 30px #0009}
    #scoresOverlay .title{font:600 20px/1.2 system-ui;margin:0 0 8px}
    #scoresOverlay .list{max-height:260px;overflow:auto;margin-top:6px;border-top:1px solid #1f2937;padding-top:6px}
    #scoresOverlay .item{display:grid;grid-template-columns: 36px 1fr auto;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px dashed #1f2937}
    #scoresOverlay .muted{color:#94a3b8;font-size:12px}
    #scoresOverlay .row{display:flex;gap:8px;margin-top:10px}
    #scoresOverlay .btn{appearance:none;border:1px solid #334155;background:#111827;color:#e5e7eb;padding:8px 12px;border-radius:10px;cursor:pointer;font-size:14px}
    #scoresOverlay .btn:hover{background:#1f2937}
  `;
  document.head.appendChild(st);

  scoresOverlay = document.createElement('div');
  scoresOverlay.id = 'scoresOverlay';
  scoresOverlay.innerHTML = `
    <div class="backdrop"></div>
    <div class="card">
      <h3 class="title">Top 10</h3>
      <div id="scoresList" class="list"></div>
      <div class="row">
        <button id="btnScoresBack" class="btn">Voltar</button>
      </div>
    </div>
  `;
  document.body.appendChild(scoresOverlay);

  document.getElementById('btnScoresBack')?.addEventListener('click', () => {
    hideScoresOverlay();
    showStartOverlay();
  });
}

async function showScoresOverlay() {
  scoresOverlay?.classList.add('show');
  uiLocked = true;

  const list = document.getElementById('scoresList');
  if (list) list.innerHTML = `<div class="muted">Carregando…</div>`;

  const rows = await fetchTop10FromSupabase();
  renderTop10ListTo(list, rows);
}
function hideScoresOverlay() {
  scoresOverlay?.classList.remove('show');
  uiLocked = false;
}

function renderTop10ListTo(listEl, rows) {
  if (!listEl) return;
  listEl.innerHTML = rows?.length
    ? rows.map((r, i) => `
        <div class="item">
          <div class="rank">#${i + 1}</div>
          <div>
            <div>${r.player_name || 'Anônimo'}</div>
            ${r.played_at ? `<div class="muted" style="font-size:12px">${new Date(r.played_at).toLocaleString()}</div>` : ''}
          </div>
          <div class="pts">${r.score ?? 0}</div>
        </div>
      `).join('')
    : `<div class="muted">Sem scores no servidor ainda.</div>`;
}

function ensureGameOverOverlay() {
  if (document.getElementById('goStyles')) return;

  const st = document.createElement('style');
  st.id = 'goStyles';
  st.textContent = `
    #goOverlay{position:fixed;inset:0;display:none;place-items:center;z-index:1100}
    #goOverlay.show{display:grid}
    #goOverlay .backdrop{position:absolute;inset:0;background:rgba(0,0,0,.55);backdrop-filter: blur(2px)}
    #goOverlay .card{position:relative;background:#0f172a;border:1px solid #1f2937;border-radius:16px;padding:16px;min-width:320px;max-width:92vw;color:#e5e7eb;box-shadow:0 10px 30px #0009}
    #goOverlay .title{font:600 20px/1.2 system-ui;margin:0 0 8px}
    #goOverlay .score{font:700 36px/1.2 system-ui;margin:0 10px 10px 0;color:#86efac;display:inline-block}
    #goOverlay .row{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
    #goOverlay .btn{appearance:none;border:1px solid #334155;background:#111827;color:#e5e7eb;padding:10px 14px;border-radius:10px;cursor:pointer;font-size:14px}
    #goOverlay .btn:hover{background:#1f2937}
    #goOverlay .list{max-height:260px;overflow:auto;margin-top:6px;border-top:1px solid #1f2937;padding-top:6px}
    #goOverlay .item{display:grid;grid-template-columns:36px 1fr auto;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px dashed #1f2937}
    #goOverlay .muted{color:#94a3b8;font-size:12px}
    #goOverlay .rank{opacity:.85}
    #goOverlay .pts{font-weight:700}
  `;
  document.head.appendChild(st);

  goOverlay = document.createElement('div');
  goOverlay.id = 'goOverlay';
  goOverlay.innerHTML = `
    <div class="backdrop"></div>
    <div class="card" role="dialog" aria-modal="true" aria-labelledby="goTitle">
      <h3 id="goTitle" class="title">Game Over</h3>
      <div><span id="goScore" class="score">0</span></div>
      <div class="row">
        <button id="goReplay" class="btn">Jogar de novo</button>
        <button id="goEditProfile" class="btn">Editar cadastro</button>
        <button id="goBackStart" class="btn">Voltar ao início</button>
      </div>
      <div class="muted">Top 10 (Supabase):</div>
      <div id="goList" class="list"></div>
    </div>
  `;
  document.body.appendChild(goOverlay);

  document.getElementById('goReplay')?.addEventListener('click', () => startGame());
  document.getElementById('goEditProfile')?.addEventListener('click', async () => {
    await withUiLock(showCadastroModal());
  });
  document.getElementById('goBackStart')?.addEventListener('click', () => {
    hideGameOverOverlay();
    showStartOverlay();
  });
}

async function showGameOverOverlay(finalScore) {
  goOverlay?.classList.add('show');
  uiLocked = true;

  const scoreEl = document.getElementById('goScore');
  if (scoreEl) scoreEl.textContent = String(finalScore);

  const rows = await fetchTop10FromSupabase();
  const list = document.getElementById('goList');
  renderTop10ListTo(list, rows);
}

function hideGameOverOverlay() {
  goOverlay?.classList.remove('show');
  uiLocked = false;
}

// ================== PERSISTÊNCIA FIM DE JOGO ==================
async function handleGameOverSave() {
  try { await salvarScoreNoSupabase(score); }
  catch (e) { console.warn('[Supabase] falha ao salvar:', e); }
  finally { await showGameOverOverlay(score); }
}

// ================== HELPERS ==================
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
