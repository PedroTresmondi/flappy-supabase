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
  bg: 'assets/img/bg_2160x1920.png'
};

// UI do overlay inicial
const UI_ASSETS = {
  title: joinBase('assets/img/logo_title.png'),     // opcional
  heroBird: joinBase('assets/img/bird_hero.png'),   // pássaro “hero” no start
  hand: joinBase('assets/img/handClick.png'),
  play: joinBase('assets/img/play.png'),
  ranking: joinBase('assets/img/ranking.png'),
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

const DEFAULT_CONFIG = {
  board: { width: BASE_W, height: BASE_H, background: '#70c5ce' },
  assets: { ...DEFAULT_ASSETS, sfx: { flap: '', score: '', hit: '' } },
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
  controls: { jump: ['Space', 'ArrowUp', 'KeyX'], minFlapIntervalMs: 120, allowHoldToFlap: false },
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
let startOverlay = null, scoresOverlay = null, rankOverlay = null;

// loops
let rafId = 0, running = false;

// BG scroll
let bgScrollX = 0;

// loop leve do BG para telas
let rafBgId = 0, bgLooping = false, lastBgOnlyTs = 0;

// ================== BOOT ==================
export async function boot() {
  cfg = await loadConfigSanitized();
  cfg = forceBoardToTarget(cfg, TARGET_W, TARGET_H);
  cfg = applyUniformScale(cfg, BASE_W, BASE_H);

  setupCanvas();
  await loadAssets();
  setupControls();

  ensureStartOverlay();
  ensureScoresOverlay();
  ensureRankOverlay(); // novo modal de Game Over / Ranking

  showStartOverlay();
  startBgLoop();
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
  // entra no cadastro antes da partida (sem sobreposição dos botões)
  hideStartOverlay();
  hideScoresOverlay();
  hideRankOverlay();

  await withUiLock(ensureCadastro());

  stopBgLoop();
  resetRunState();
  stopSpawning();
  stopGameLoop();

  running = true;
  // Spawner começa no primeiro flap
  rafId = requestAnimationFrame(tick);
}

export function gameOver() {
  if (isGameOver) return;
  isGameOver = true;

  try { SFX.hit?.play(); } catch { }
  stopSpawning();
  stopGameLoop();

  startBgLoop();
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

  try {
    const res = await fetch(joinBase('/flappy-config.json'), { cache: 'no-store' });
    if (res.ok) merged = deepMerge(merged, await res.json() || {});
  } catch { }

  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const { assets: _ignore, ...rest } = JSON.parse(raw) || {};
      merged = deepMerge(merged, rest || {});
    }
  } catch { }

  try {
    const remote = await fetchRemoteConfigFromSupabase();
    if (remote) merged = deepMerge(merged, remote);
  } catch (e) {
    console.warn('[config] falha Supabase:', e);
  }

  merged.assets = sanitizeAssets(merged.assets);
  return merged;
}

function sanitizeAssets(a) {
  const out = { ...DEFAULT_ASSETS };
  const frames = Array.isArray(a?.birdFrames) ? a.birdFrames : [];
  const cleaned = frames.map(normalizeAssetPath).filter(Boolean);
  out.birdFrames = cleaned.length ? unique(cleaned) : DEFAULT_ASSETS.birdFrames;
  out.topPipe = normalizeAssetPath(a?.topPipe) || DEFAULT_ASSETS.topPipe;
  out.bottomPipe = normalizeAssetPath(a?.bottomPipe) || DEFAULT_ASSETS.bottomPipe;
  out.bg = normalizeAssetPath(a?.bg) || DEFAULT_ASSETS.bg || '';
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
  ctx.imageSmoothingEnabled = false;
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

    birdImgs = [];
    frames.forEach(src => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = done;
      im.onerror = () => { console.warn('[assets] falhou frame:', src); done(); };
      im.src = src;
      birdImgs.push(im);
    });

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
      done();
    }

    ['flap', 'score', 'hit'].forEach(k => {
      const url = cfg.assets?.sfx?.[k];
      if (url) { const a = new Audio(url); a.preload = 'auto'; SFX[k] = a; }
    });
  });
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

  cfg.bird.width = targetW;
  cfg.bird.height = targetH;

  if (bird) { bird.width = targetW; bird.height = targetH; }
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
    if (e.code === 'F9') { try { localStorage.removeItem(KEY); } catch { } location.reload(); return; }
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

  if (isGameOver) return;

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

// ================== LOOP ==================
function tick(ts) {
  if (!running) return;

  rafId = requestAnimationFrame(tick);

  if (!lastTs) lastTs = ts || performance.now();
  const nowTs = ts || performance.now();
  const dt = Math.min(50, nowTs - lastTs);
  lastTs = nowTs;

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

  if (bird.y > canvas.height) { gameOver(); return; }

  const scroll = currentScrollSpeed();
  for (let i = 0; i < pipeArray.length; i++) {
    const p = pipeArray[i];
    p.x += scroll * t;
    tryDrawImage(p.img, p.x, p.y, p.width, p.height);

    if (!p.passed && bird.x > p.x + p.width) { score += cfg.scoring.pointsPerPipe; p.passed = true; try { SFX.score?.play(); } catch { } }
    if (collides(bird, p)) { gameOver(); return; }
  }
  while (pipeArray.length > 0 && pipeArray[0].x < -cfg.pipes.width) pipeArray.shift();
}

// ================== BACKGROUND SCROLL ==================
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

  const delta = Math.max(0, dtMs) / 1000;
  bgScrollX = (bgScrollX + bgPxPerSec * delta) || 0;

  const imgW = bgImg.naturalWidth, imgH = bgImg.naturalHeight;
  const scale = canvas.height / imgH;
  const drawW = Math.ceil(imgW * scale);
  const drawH = canvas.height;

  let x = -Math.floor(bgScrollX % drawW);
  ctx.drawImage(bgImg, 0, 0, imgW, imgH, x, 0, drawW, drawH);
  ctx.drawImage(bgImg, 0, 0, imgW, imgH, x + drawW, 0, drawW, drawH);
}

// ================== SPAWNER ==================
function startSpawning() { stopSpawning(); scheduleNextSpawn(true); }
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
  ctx.fillText(score, 5 | 0, 64 | 0);
}

// ================== PIPES / COLISÃO ==================
function placePipes() {
  if (!running || isGameOver || paused || !gameStarted) return;

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

// ================== SUPABASE / RANK ==================
async function salvarScoreNoSupabase(pontos) {
  if (!supabase) return;

  const player = getLocalPlayer();
  const payload = {
    run_id: String(runId),
    player_name: player.nome || 'Anônimo',
    email: 'anon@demo.com',
    telefone: '',
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

async function fetchRankForScore(finalScore) {
  if (!supabase) return null;
  // posição = (# de scores estritamente maiores) + 1
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

// ================== OVERLAY INICIAL ==================
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
      width:min(48vw,520px);transform:translate(-50%,-50%);
      animation:hero-bob 1.8s ease-in-out infinite;
      pointer-events:none;filter: drop-shadow(0 4px 0 rgba(0,0,0,.15));
    }
    #startOverlay .hand{
      position:absolute;left:64%;top:57%;
      width:min(14vw,150px);transform-origin:10% 10%;
      animation:hand-tap 1.15s ease-in-out infinite;pointer-events:none;
      filter: drop-shadow(0 2px 0 rgba(0,0,0,.15));
    }
    #startOverlay .buttons{
      position:absolute;left:0;right:0;bottom:7vh;
      display:flex;justify-content:center;gap:28px;
    }
    #startOverlay .btn{pointer-events:auto;display:inline-block;transition:transform .08s ease}
    #startOverlay .btn img{display:block;height:min(96px,11vh)}
    #startOverlay .btn:hover{transform:translateY(-2px)}
    #startOverlay .btn:active{transform:translateY(2px)}
    @keyframes hero-bob{0%,100%{transform:translate(-50%,-52%)}50%{transform:translate(-50%,-48%)}}
    @keyframes hand-tap{0%,100%{transform:translate(0,0) scale(1)}40%{transform:translate(12px,12px) scale(.92)}60%{transform:translate(0,0) scale(1)}}
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
  document.body.appendChild(startOverlay);

  document.getElementById('btnStart')?.addEventListener('click', (e) => { e.preventDefault(); startGame(); });
  document.getElementById('btnScores')?.addEventListener('click', (e) => { e.preventDefault(); showScoresOverlay(); });
}
function showStartOverlay() { startOverlay?.classList.add('show'); uiLocked = true; startBgLoop(); }
function hideStartOverlay() { startOverlay?.classList.remove('show'); uiLocked = false; }

// ================== OVERLAY TOP 10 ==================
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
      <div class="row"><button id="btnScoresBack" class="btn">Voltar</button></div>
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
  startBgLoop();

  const list = document.getElementById('scoresList');
  if (list) list.innerHTML = `<div class="muted">Carregando…</div>`;

  const rows = await fetchTop10FromSupabase();
  renderTop10ListTo(list, rows);
}
function hideScoresOverlay() { scoresOverlay?.classList.remove('show'); uiLocked = false; }
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

// ================== OVERLAY RANK (GAME OVER) ==================
function ensureRankOverlay() {
  if (document.getElementById('rankStyles')) return;

  const st = document.createElement('style');
  st.id = 'rankStyles';
  st.textContent = `
    #rankOverlay{position:fixed;inset:0;display:none;z-index:1100;cursor:pointer}
    #rankOverlay.show{display:block}
    #rankOverlay .wrap{position:absolute;inset:0;display:grid;place-items:start center;pointer-events:auto}
    #rankOverlay .title{
      margin-top:4vh;color:#ffffff; font-weight:900; letter-spacing:1px;
      font-size:clamp(26px,5.5vh,44px);
      text-shadow:
        -2px -2px 0 #0b0b0b, 2px -2px 0 #0b0b0b,
        -2px  2px 0 #0b0b0b, 2px  2px 0 #0b0b0b,
        0 2px 0 #0b0b0b;
      user-select:none;
    }
    #rankOverlay .panel{
      margin-top:3vh;background:#fff7ea;border-radius:24px;padding:28px 34px;
      box-shadow:
        0 0 0 6px #221b22 inset,
        0 0 0 12px #c9b8a6 inset,
        0 10px 0 0 #221b22,
        0 18px 0 0 #8a6f5a;
      display:flex;align-items:center;gap:min(4vw,24px);
      image-rendering:pixelated;
    }
    #rankOverlay .panel .bird{ width:min(18vw,120px); filter:drop-shadow(0 2px 0 #0003) }
    #rankOverlay .score{
      font-weight:900; color:#ffffff; background:#111;
      padding:2px 12px; border-radius:10px; display:inline-block;
      font-size:clamp(64px,10vh,120px); line-height:1;
      text-shadow:
        -6px -6px 0 #000, 6px -6px 0 #000,
        -6px  6px 0 #000, 6px  6px 0 #000,
        0 4px 0 #000;
    }
    #rankOverlay .ranking{
      margin-top:8px; font-size:clamp(18px,3.5vh,26px); color:#222;
      text-shadow:
        -2px -2px 0 #fff, 2px -2px 0 #fff,
        -2px  2px 0 #fff, 2px  2px 0 #fff;
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
        ${UI_ASSETS.heroBird ? `<img class="bird" src="${UI_ASSETS.heroBird}" alt="bird">` : ''}
        <div>
          <div id="rankScore" class="score">0</div>
          <div id="rankPos" class="ranking">Ranking --</div>
        </div>
      </div>
      <div class="finalizar">Finalizar</div>
      ${UI_ASSETS.hand ? `<img class="hand" src="${UI_ASSETS.hand}" alt="tap">` : ''}
    </div>
  `;
  document.body.appendChild(rankOverlay);

  // clique em qualquer lugar finaliza
  rankOverlay.addEventListener('click', finalizeAndReset);
}
function showRankOverlay(finalScore, rankPos) {
  const sc = document.getElementById('rankScore');
  const rp = document.getElementById('rankPos');
  if (sc) sc.textContent = String(finalScore | 0);
  if (rp) rp.textContent = `Ranking ${rankPos != null ? String(rankPos).padStart(2, '0') : '--'}`;
  rankOverlay?.classList.add('show');
  uiLocked = true;
}
function hideRankOverlay() { rankOverlay?.classList.remove('show'); uiLocked = false; }

// ================== GAME OVER FLOW ==================
async function handleGameOverSave() {
  try { await salvarScoreNoSupabase(score); }
  catch (e) { console.warn('[Supabase] falha ao salvar:', e); }

  let pos = null;
  try { pos = await fetchRankForScore(score); } catch { }
  showRankOverlay(score, pos);
}

// ================== RESET/FINALIZAR ==================
function finalizeAndReset() {
  // limpa tudo
  try { localStorage.clear(); } catch { }
  try { sessionStorage.clear(); } catch { }
  try {
    if ('caches' in window) {
      caches.keys().then(keys => keys.forEach(k => caches.delete(k))).catch(() => { });
    }
  } catch { }

  // reseta estado de jogo
  stopGameLoop();
  stopSpawning();
  running = false;
  pipeArray = [];
  isGameOver = false;
  gameStarted = false;

  hideRankOverlay();
  showStartOverlay();
  startBgLoop();
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
