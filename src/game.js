// src/game.js
"use strict";

import { supabase } from "./supabase";
import { showCadastroModal, getLocalPlayer } from "./ui/cadastroModal";

// ================== CONSTANTES ==================
const KEY = "flappy:config";
const SUPABASE_SCORES_TABLE = "scores";

// assets padrão (devem existir em public/assets/img/)
const DEFAULT_ASSETS = {
  birdFrames: [
    "/assets/img/flappybird1.png",
    "/assets/img/flappybird2.png",
    "/assets/img/flappybird3.png",
  ],
  topPipe: "/assets/img/toppipe.png",
  bottomPipe: "/assets/img/bottompipe.png",
};

// config padrão
const DEFAULT_CONFIG = {
  board: { width: 360, height: 640, background: "#70c5ce" },
  assets: { ...DEFAULT_ASSETS, sfx: { flap: "", score: "", hit: "" } },
  bird: {
    width: 34,
    height: 24,
    startXPercent: 12.5,
    startYPercent: 50,
    flapForce: 6,
    maxFallSpeed: 12,
    hitboxPadding: 2,
    tilt: {
      enabled: true,
      upDeg: -25,
      downDeg: 70,
      responsiveness: 0.15,
      velForMaxUp: 6,
      velForMaxDown: 12,
      snapOnFlap: true,
      minDeg: -45,
      maxDeg: 90,
    },
    flapAnim: { enabled: true, durationMs: 1000, fps: 12 },
  },
  physics: { gravity: 0.4 },
  pipes: {
    width: 64,
    height: 512,
    scrollSpeed: 2,
    gapPercent: 25,
    randomBasePercent: 25,
    randomRangePercent: 50,
    autoStretchToEdges: false,
    edgeOverflowPx: 0,
  },
  difficulty: {
    rampEnabled: false,
    speedPerScore: 0.05,
    minGapPercent: 18,
    gapStepPerScore: 0.2,
    timeRampEnabled: true,
    timeStartDelayMs: 0,
    timeSpeedPerSec: 0.03,
    timeMaxExtraSpeed: 5,
    timeGapStepPerSec: 0.02,
  },
  spawn: { intervalMs: 1500 },
  scoring: { pointsPerPipe: 0.5 },
  ui: {
    font: "45px sans-serif",
    scoreColor: "#ffffff",
    gameOverText: "GAME OVER",
    gameOverFont: "45px sans-serif",
    gameOverColor: "#ffffff",
  },
  controls: {
    jump: ["Space", "ArrowUp", "KeyX"],
    minFlapIntervalMs: 120,
    allowHoldToFlap: false,
  },
  gameplay: { restartOnJump: true, gracePeriodMs: 3000, pauseKey: "KeyP" },
};

// ================== ESTADO ==================
let cfg = structuredClone(DEFAULT_CONFIG);
let canvas, ctx;
let topPipeImg = null,
  bottomPipeImg = null;
let birdImgs = [],
  SFX = {};

let bird,
  velocityY = 0,
  pipeArray = [];
let gameOver = false,
  gameOverHandled = false,
  score = 0;
let allowedJumpKeys = new Set(),
  spawnTimerId = null;
let birdTiltDeg = 0,
  flapAnimStart = 0,
  flapAnimEnd = 0;
let gameStarted = false,
  graceUntilTs = 0,
  paused = false,
  lastTs = 0;
let activeTimeMs = 0,
  timeRampStartTs = 0,
  lastFlapTs = -1;
let uiLocked = false;

let runId = null,
  runStartISO = null,
  runStartPerf = 0;

// telas / overlays
let screen = "start"; // 'start' | 'game' | 'scores'
let startOverlay = null;
let scoresOverlay = null;
let lastFinalScore = null;

// ================== BOOT (export) ==================
export async function boot() {
  cfg = await loadConfigSanitized();
  setupCanvas();
  await loadAssets();
  setupControls();

  // Cria START e SCORES de uma vez
  ensureStartOverlay();

  showStartOverlay();
  requestAnimationFrame(update);
}

// ================== CONFIG / SANITIZAÇÃO ==================
async function loadConfigSanitized() {
  let merged = structuredClone(DEFAULT_CONFIG);

  // flappy-config.json (opcional)
  try {
    const res = await fetch("/flappy-config.json", { cache: "no-store" });
    if (res.ok) {
      const fileCfg = await res.json();
      merged = deepMerge(merged, fileCfg || {});
    }
  } catch {}

  // localStorage (sem assets para evitar blob:)
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const localCfg = JSON.parse(raw);
      const { assets: _ignoredAssets, ...rest } = localCfg || {};
      merged = deepMerge(merged, rest || {});
    }
  } catch {}

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

  out.sfx = a?.sfx || { flap: "", score: "", hit: "" };
  return out;
}

function normalizeAssetPath(p) {
  if (!p) return "";
  const s = String(p).trim();
  if (/^(blob:|data:)/i.test(s)) return ""; // nunca blob/data
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("./assets/")) return s.slice(1); // -> /assets/...
  if (s.startsWith("assets/")) return `/${s}`;
  if (s.startsWith("/")) return s;
  return "";
}

function deepMerge(a, b) {
  const out = Array.isArray(a) ? [...a] : { ...a };
  Object.keys(b || {}).forEach((k) => {
    if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k])) {
      out[k] = deepMerge(a?.[k] || {}, b[k]);
    } else {
      out[k] = b[k];
    }
  });
  return out;
}
const unique = (arr) => [...new Set(arr)];

// ================== CANVAS / ASSETS ==================
function setupCanvas() {
  canvas =
    document.getElementById("board") ||
    Object.assign(document.createElement("canvas"), { id: "board" });
  if (!canvas.isConnected) document.body.appendChild(canvas);
  canvas.width = cfg.board.width;
  canvas.height = cfg.board.height;
  ctx = canvas.getContext("2d");
}

function loadAssets() {
  return new Promise((resolve) => {
    const frames = cfg.assets.birdFrames || [];
    let toLoad = frames.length + 2;
    const done = () => {
      if (--toLoad === 0) {
        birdImgs = birdImgs.filter(okImg);
        resolve();
      }
    };

    birdImgs = [];
    frames.forEach((src) => {
      const im = new Image();
      im.onload = done;
      im.onerror = () => {
        console.warn("[assets] falhou frame:", src);
        done();
      };
      im.src = src;
      birdImgs.push(im);
    });

    topPipeImg = new Image();
    topPipeImg.onload = done;
    topPipeImg.onerror = () => {
      console.warn("[assets] topPipe falhou:", cfg.assets.topPipe);
      topPipeImg = null;
      done();
    };
    topPipeImg.src = cfg.assets.topPipe;

    bottomPipeImg = new Image();
    bottomPipeImg.onload = done;
    bottomPipeImg.onerror = () => {
      console.warn("[assets] bottomPipe falhou:", cfg.assets.bottomPipe);
      bottomPipeImg = null;
      done();
    };
    bottomPipeImg.src = cfg.assets.bottomPipe;

    ["flap", "score", "hit"].forEach((k) => {
      const url = cfg.assets?.sfx?.[k];
      if (url) {
        const a = new Audio(url);
        a.preload = "auto";
        SFX[k] = a;
      }
    });
  });
}

// ================== CONTROLES ==================
function setupControls() {
  allowedJumpKeys = new Set(cfg.controls.jump);

  document.addEventListener("keydown", (e) => {
    // F9: limpa config antiga e recarrega
    if (e.code === "F9") {
      try {
        localStorage.removeItem(KEY);
      } catch {}
      location.reload();
      return;
    }

    if (uiLocked) {
      if (e.code !== (cfg.gameplay.pauseKey || "KeyP")) e.preventDefault();
      return;
    }
    if (e.code === (cfg.gameplay.pauseKey || "KeyP")) {
      if (!e.repeat) paused = !paused;
      return;
    }
    if (!cfg.controls.allowHoldToFlap && e.repeat) return;
    onJumpKey(e);
  });

  window.addEventListener("pointerdown", () => {
    if (uiLocked) return;
    onJumpKey({ code: cfg.controls.jump?.[0] || "Space", repeat: false });
  });

  window.addEventListener("blur", () => {
    paused = true;
  });
  window.addEventListener("focus", () => {
    paused = false;
  });
}

function onJumpKey(e) {
  if (screen !== "game") return;
  if (!allowedJumpKeys.has(e.code)) return;
  if (paused) return;

  const now = performance.now();
  const minInt = Math.max(0, cfg.controls.minFlapIntervalMs || 0);
  if (lastFlapTs >= 0 && now - lastFlapTs < minInt) return;
  lastFlapTs = now;

  if (gameOver) return; // ao fim de jogo, esperamos a navegação via overlays

  if (!gameStarted) {
    gameStarted = true;
    graceUntilTs = performance.now() + Math.max(0, cfg.gameplay.gracePeriodMs || 0);
    const delay = Math.max(0, cfg.difficulty?.timeStartDelayMs ?? 0);
    timeRampStartTs = graceUntilTs + delay;
    startSpawning();
  }

  velocityY = -Math.abs(cfg.bird.flapForce);
  try {
    SFX.flap?.play();
  } catch {}
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

// ================== VIDA DO JOGO ==================
function startNewRun() {
  pipeArray = [];
  gameOver = false;
  gameOverHandled = false;
  score = 0;

  runId =
    crypto?.randomUUID?.() ||
    "run-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  runStartISO = new Date().toISOString();
  runStartPerf = performance.now();

  const startX = (cfg.board.width * cfg.bird.startXPercent) / 100;
  const startY = (cfg.board.height * cfg.bird.startYPercent) / 100;
  bird = { x: startX, y: startY, width: cfg.bird.width, height: cfg.bird.height };

  velocityY = 0;
  birdTiltDeg = 0;
  flapAnimStart = 0;
  flapAnimEnd = 0;

  gameStarted = false;
  graceUntilTs = 0;
  paused = false;
  lastTs = 0;

  activeTimeMs = 0;
  timeRampStartTs = 0;

  lastFlapTs = -1;

  if (spawnTimerId) {
    clearInterval(spawnTimerId);
    spawnTimerId = null;
  }
}

function startSpawning() {
  if (spawnTimerId) clearInterval(spawnTimerId);
  spawnTimerId = setInterval(placePipes, cfg.spawn.intervalMs);
}

// ================== LOOP ==================
function update(ts) {
  requestAnimationFrame(update);

  if (!lastTs) lastTs = ts || performance.now();
  const nowTs = ts || performance.now();
  const dt = Math.min(50, nowTs - lastTs);
  lastTs = nowTs;
  const t = dt / 16.667;

  // fundo
  ctx.fillStyle = cfg.board.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (screen !== "game") {
    // desenha título leve no fundo
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = "#000";
    ctx.font = "bold 56px system-ui, sans-serif";
    ctx.fillText("FLAPPY", 30, 120);
    ctx.restore();
    return;
  }

  if (gameStarted && !paused && !gameOver && nowTs >= timeRampStartTs) activeTimeMs += dt;

  drawHUD();

  if (!gameStarted) {
    drawBirdWithTilt();
    return;
  }
  if (paused) {
    ctx.fillStyle = "#00000055";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fff";
    ctx.font = "28px sans-serif";
    ctx.fillText("PAUSADO", 5, 90);
    return;
  }
  if (gameOver) return;

  const inGrace = performance.now() < graceUntilTs;
  if (inGrace) {
    velocityY += cfg.physics.gravity * t;
    if (velocityY > 0) velocityY = 0;
  } else {
    velocityY += cfg.physics.gravity * t;
    if (velocityY > cfg.bird.maxFallSpeed) velocityY = cfg.bird.maxFallSpeed;
  }
  bird.y = Math.max(bird.y + velocityY * t, 0);

  updateBirdTilt(t);
  drawBirdWithTilt();

  if (bird.y > canvas.height) triggerGameOver();

  const scroll = currentScrollSpeed();
  for (let i = 0; i < pipeArray.length; i++) {
    const p = pipeArray[i];
    p.x += scroll * t;
    tryDrawImage(p.img, p.x, p.y, p.width, p.height);

    if (!p.passed && bird.x > p.x + p.width) {
      score += cfg.scoring.pointsPerPipe;
      p.passed = true;
      try {
        SFX.score?.play();
      } catch {}
    }
    if (collides(bird, p)) triggerGameOver();
  }
  while (pipeArray.length > 0 && pipeArray[0].x < -cfg.pipes.width) pipeArray.shift();
}

function triggerGameOver() {
  if (gameOver) return;
  gameOver = true;
  try {
    SFX.hit?.play();
  } catch {}
  if (!gameOverHandled) {
    gameOverHandled = true;
    handleGameOverSave().catch(() => {});
  }
}

// ================== HUD / TILT ==================
function currentScrollSpeed() {
  const base = Math.abs(cfg.pipes.scrollSpeed);
  const scoreExtra = cfg.difficulty?.rampEnabled
    ? (cfg.difficulty.speedPerScore || 0) * score
    : 0;
  const sec = activeTimeMs / 1000;
  const timeExtra = cfg.difficulty?.timeRampEnabled
    ? Math.min(
        cfg.difficulty.timeMaxExtraSpeed ?? Infinity,
        (cfg.difficulty.timeSpeedPerSec || 0) * sec
      )
    : 0;
  return -(base + scoreExtra + timeExtra);
}

function updateBirdTilt(tFactor) {
  const tcfg = cfg.bird.tilt;
  if (!tcfg?.enabled) {
    birdTiltDeg = 0;
    return;
  }
  const vUpRef = -Math.abs(tcfg.velForMaxUp ?? cfg.bird.flapForce);
  const vDownRef = Math.abs(tcfg.velForMaxDown ?? cfg.bird.maxFallSpeed);
  const targetDeg = mapRangeClamped(velocityY, vUpRef, vDownRef, tcfg.upDeg, tcfg.downDeg);
  const alpha = 1 - Math.pow(1 - clamp(tcfg.responsiveness ?? 0.15, 0, 1), tFactor);
  birdTiltDeg = clamp(lerp(birdTiltDeg, targetDeg, alpha), tcfg.minDeg ?? -360, tcfg.maxDeg ?? 360);
}

function drawBirdWithTilt() {
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
  else {
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(-bird.width / 2, -bird.height / 2, bird.width, bird.height);
  }

  ctx.restore();
}

function drawHUD() {
  ctx.fillStyle = cfg.ui.scoreColor;
  ctx.font = cfg.ui.font;
  ctx.fillText(score, 5, 45);
}

// ================== PIPES / COLISÃO ==================
function placePipes() {
  if (gameOver || paused) return;

  const baseGap = cfg.pipes.gapPercent;
  const scoreStep = cfg.difficulty?.gapStepPerScore ?? 0;
  const minGap = cfg.difficulty?.minGapPercent ?? baseGap;
  let gapPercent = cfg.difficulty?.rampEnabled ? baseGap - score * scoreStep : baseGap;
  if (cfg.difficulty?.timeRampEnabled)
    gapPercent -= (cfg.difficulty.timeGapStepPerSec || 0) * (activeTimeMs / 1000);
  gapPercent = Math.max(minGap, gapPercent);
  const gap = (canvas.height * gapPercent) / 100;

  const w0 = cfg.pipes.width;
  let h0 = cfg.pipes.height;
  if (cfg.pipes?.autoStretchToEdges) {
    const needed = Math.ceil(
      (canvas.height - gap) / 2 + (cfg.pipes.edgeOverflowPx ?? 0)
    );
    if (h0 < needed) h0 = needed;
  }

  const base = (cfg.pipes.randomBasePercent / 100) * h0;
  const range = (cfg.pipes.randomRangePercent / 100) * h0;
  let topY = -base - Math.random() * range;
  let botY = topY + h0 + gap;

  const bottomBottom = botY + h0;
  if (bottomBottom < canvas.height) {
    const d = canvas.height - bottomBottom;
    topY += d;
    botY += d;
  }
  if (topY > 0) {
    const d = topY;
    topY -= d;
    botY -= d;
  }

  pipeArray.push(
    { img: topPipeImg, x: canvas.width, y: topY, width: w0, height: h0, passed: false },
    { img: bottomPipeImg, x: canvas.width, y: botY, width: w0, height: h0, passed: false }
  );
}

function collides(a, b) {
  const pad = Math.max(0, cfg.bird.hitboxPadding || 0);
  const ax = a.x + pad,
    ay = a.y + pad;
  const aw = a.width - pad * 2,
    ah = a.height - pad * 2;
  return ax < b.x + b.width && ax + aw > b.x && ay < b.y + b.height && ay + ah > b.y;
}

// ================== SUPABASE ==================
async function salvarScoreNoSupabase(pontos) {
  if (!supabase) return;

  const player = getLocalPlayer();
  const payload = {
    run_id: String(runId),
    player_name: player.nome || "Anônimo",
    email: player.email || "anon@demo.com",
    telefone: player.telefone || "",
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
    .select("player_name, score, played_at")
    .order("score", { ascending: false })
    .limit(10);
  if (error) {
    console.warn("[Supabase] top10 erro:", error);
    return [];
  }
  return data || [];
}

// ================== OVERLAYS: START & SCORES ==================
function ensureStartOverlay() {
  if (document.getElementById("startStyles")) return;

  const st = document.createElement("style");
  st.id = "startStyles";
  st.textContent = `
  .overlay{position:fixed;inset:0;display:none;place-items:center;z-index:999}
  .overlay.show{display:grid}
  .overlay .backdrop{position:absolute;inset:0;background:rgba(0,0,0,.55);backdrop-filter: blur(2px)}
  .overlay .card{position:relative;background:#0f172a;border:1px solid #1f2937;border-radius:16px;padding:18px;min-width:320px;max-width:92vw;color:#e5e7eb;box-shadow:0 10px 30px #0009}
  .title{font:700 24px/1.2 system-ui;margin:0 0 12px}
  .subtitle{font:400 12px/1.4 system-ui;color:#94a3b8;margin:2px 0 12px}
  .row{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
  .btn{appearance:none;border:1px solid #334155;background:#111827;color:#e5e7eb;padding:10px 14px;border-radius:10px;cursor:pointer;font-size:14px}
  .btn:hover{background:#1f2937}
  .list{max-height:320px;overflow:auto;margin-top:6px;border-top:1px solid #1f2937;padding-top:6px}
  .item{display:grid;grid-template-columns: 36px 1fr auto;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px dashed #1f2937}
  .muted{color:#94a3b8;font-size:12px}
  .rank{opacity:.85}
  .pts{font-weight:700}
  `;
  document.head.appendChild(st);

  // START
  startOverlay = document.createElement("div");
  startOverlay.id = "startOverlay";
  startOverlay.className = "overlay";
  startOverlay.innerHTML = `
    <div class="backdrop"></div>
    <div class="card">
      <h3 class="title">Flappy</h3>
      <div class="subtitle">Use espaço, seta ↑ ou X para pular. F9 limpa config local.</div>
      <div class="row">
        <button id="btnStartPlay" class="btn">Começar</button>
        <button id="btnStartScores" class="btn">Scores</button>
      </div>
    </div>
  `;
  document.body.appendChild(startOverlay);

  // SCORES
  scoresOverlay = document.createElement("div");
  scoresOverlay.id = "scoresOverlay";
  scoresOverlay.className = "overlay";
  scoresOverlay.innerHTML = `
    <div class="backdrop"></div>
    <div class="card">
      <h3 class="title">Ranking (Top 10)</h3>
      <div class="subtitle" id="scoresYourScore"></div>
      <div id="scoresList" class="list"></div>
      <div class="row" style="margin-top:12px">
        <button id="btnScoresPlayAgain" class="btn">Jogar novamente</button>
        <button id="btnScoresBack" class="btn">Voltar</button>
      </div>
    </div>
  `;
  document.body.appendChild(scoresOverlay);

  // handlers
  document.getElementById("btnStartPlay")?.addEventListener("click", async () => {
    await startNewGame(); // <- sempre abre cadastro
  });
  document.getElementById("btnStartScores")?.addEventListener("click", async () => {
    await showScoresOverlay(); // sem score pessoal
  });

  document.getElementById("btnScoresBack")?.addEventListener("click", () => {
    hideScoresOverlay();
    showStartOverlay();
  });
  document
    .getElementById("btnScoresPlayAgain")
    ?.addEventListener("click", async () => {
      hideScoresOverlay();
      await startNewGame(); // <- sempre abre cadastro
    });
}

function showStartOverlay() {
  uiLocked = true;
  screen = "start";
  startOverlay?.classList.add("show");
}
function hideStartOverlay() {
  startOverlay?.classList.remove("show");
  // uiLocked = false é liberado quando realmente entramos no jogo
}

async function showScoresOverlay() {
  uiLocked = true;
  screen = "scores";
  const myEl = document.getElementById("scoresYourScore");
  myEl.textContent =
    typeof lastFinalScore === "number"
      ? `Seu score: ${lastFinalScore}`
      : "Veja as melhores pontuações:";

  const rows = await fetchTop10FromSupabase();
  renderTop10List(rows);

  scoresOverlay?.classList.add("show");
}
function hideScoresOverlay() {
  scoresOverlay?.classList.remove("show");
  lastFinalScore = null;
}

// render lista
function renderTop10List(rows) {
  const list = document.getElementById("scoresList");
  if (!list) return;
  if (!rows || rows.length === 0) {
    list.innerHTML = `<div class="muted">Sem scores no servidor ainda.</div>`;
    return;
  }
  list.innerHTML = rows
    .map(
      (r, i) => `
    <div class="item">
      <div class="rank">#${i + 1}</div>
      <div>
        <div>${r.player_name || "Anônimo"}</div>
        ${
          r.played_at
            ? `<div class="muted" style="font-size:12px">${new Date(
                r.played_at
              ).toLocaleString()}</div>`
            : ""
        }
      </div>
      <div class="pts">${r.score ?? 0}</div>
    </div>`
    )
    .join("");
}

// ================== FLUXO: COMEÇAR JOGO (sempre com cadastro) ==================
async function startNewGame() {
  // força cadastro no início de TODO JOGO:
  await showCadastroModal();

  // inicia a run
  startNewRun();
  hideStartOverlay();
  hideScoresOverlay();
  screen = "game";
  uiLocked = false;
}

// ================== PERSISTÊNCIA FIM DE JOGO ==================
async function handleGameOverSave() {
  try {
    await salvarScoreNoSupabase(score);
  } catch (e) {
    console.warn("[Supabase] falha ao salvar:", e);
  } finally {
    lastFinalScore = score;
    await showScoresOverlay(); // jogo -> ranking
    // o usuário volta para START pelo botão "Voltar", cumprindo: ranking -> start
  }
}

// ================== HELPERS ==================
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function deg2rad(d) {
  return (d * Math.PI) / 180;
}
function mapRangeClamped(v, inMin, inMax, outMin, outMax) {
  if (inMax === inMin) return outMin;
  const t = clamp((v - inMin) / (inMax - inMin), 0, 1);
  return outMin + t * (outMax - outMin);
}
function okImg(im) {
  return !!(im && im.complete && im.naturalWidth > 0);
}
function tryDrawImage(im, x, y, w, h) {
  if (okImg(im)) ctx.drawImage(im, x, y, w, h);
  else {
    ctx.save();
    ctx.fillStyle = "#2dd4bf33";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#ef4444";
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }
}
