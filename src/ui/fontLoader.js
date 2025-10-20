// src/ui/fontLoader.js
"use strict";

// mesmo esquema do joinBase usado no projeto
const BASE =
  typeof import.meta !== "undefined" && import.meta.env?.BASE_URL
    ? import.meta.env.BASE_URL
    : "/";
const joinBase = (p) => (p ? ( /^(https?:|data:|blob:)/i.test(p) ? p : BASE + String(p).replace(/^\//, "") ) : "");

const FONT_URL = joinBase("assets/fonts/Pixellari.ttf");

/** Injeta @font-face + variável global --ui-font para todo o DOM */
export function installPixellari() {
  if (document.getElementById("pixellariStyles")) return;
  const st = document.createElement("style");
  st.id = "pixellariStyles";
  st.textContent = `
@font-face{
  font-family:"Pixellari";
  src: url("${FONT_URL}") format("truetype");
  font-weight:400;
  font-style:normal;
  font-display:swap;
}
:root{
  --ui-font: "Pixellari", system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
}
html, body, button, input, select, textarea{
  font-family: var(--ui-font);
}
`;
  document.head.appendChild(st);
}

/** Garante que o Canvas já conhece a fonte antes de desenhar texto */
export async function waitPixellari() {
  try {
    // carrega pelo menos um tamanho para registrar a família no Canvas
    await document.fonts.load('16px "Pixellari"');
  } catch {}
}

/** Ajusta o cfg do jogo para usar Pixellari no HUD (preserva o tamanho em px) */
export function applyPixellariToCfg(cfg) {
  const keepSize = (spec, fallbackPx = 45) => {
    const m = String(spec || "").match(/\b(\d+(\.\d+)?)px/i);
    const px = m ? m[1] : fallbackPx;
    return `${px}px "Pixellari", monospace`;
  };
  cfg.ui = cfg.ui || {};
  cfg.ui.font = keepSize(cfg.ui.font, 45);
  cfg.ui.gameOverFont = keepSize(cfg.ui.gameOverFont, 45);
  return cfg;
}
