// src/ui/cadastroModal.js
"use strict";

// Só guardamos o NOME
const STORAGE_KEY = "flappy:player";

let overlay, inputName, errEl, ctaWrap;

// BASE para funcionar em Vite/GitHub Pages igualmente
const BASE =
  typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.BASE_URL
    ? import.meta.env.BASE_URL
    : "/";
const joinBase = (p) => {
  if (!p) return "";
  const s = String(p);
  if (/^(https?:|data:|blob:)/i.test(s)) return s;
  return BASE + s.replace(/^\//, "");
};

const ASSETS = {
  toque: joinBase("assets/img/toque.png"),
  hand: joinBase("assets/img/handClick.png"),
  heroBird: joinBase("assets/img/bird_hero.png"), // se não existir, some sozinho
};

// ---------------- styles ----------------
function ensureStyles() {
  if (document.getElementById("cadStyles")) return;
  const st = document.createElement("style");
  st.id = "cadStyles";
  st.textContent = `
  /* Overlay transparente (sem backdrop) ocupando a tela toda */
  #cadOverlay{position:fixed;inset:0;display:none;z-index:1200;pointer-events:auto}
  #cadOverlay.show{display:block}

  /* Tudo empilhado em cima do canvas */
  #cadOverlay .wrap{position:absolute;inset:0;display:grid;grid-template-rows:auto 1fr auto}

  /* Bloco dos inputs centralizado */
  #cadOverlay .form{
    display:grid; justify-items:center; align-content:start;
    gap:18px; padding-top:min(10vh,120px);
  }

  /* Label acima da linha (estilo “pixel”) */
  #cadOverlay .label{
    color:#fff; font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
    font-weight:700; letter-spacing:.5px; font-size:clamp(18px, 3.4vh, 28px);
    text-shadow:0 2px 0 #0003;
    margin-bottom:-8px;
  }

  /* Input com fundo transparente e linha branca */
  #cadOverlay .line-input{
    width:min(86vw, 640px);
    border:none; outline:none; background:transparent; color:#fff;
    font-size:clamp(16px, 2.8vh, 24px); text-align:center;
    padding:8px 10px 12px; border-bottom:4px solid #fff9;
    caret-color:#fff;
  }
  #cadOverlay .line-input::placeholder{ color:#ffffffcc }
  #cadOverlay .line{ width:min(86vw,640px); height:0; border-bottom:4px solid #ffffff33; margin-top:-12px }

  /* Área clicável “Toque” + pássaro + mão */
  #cadOverlay .cta { position:relative; display:flex; justify-content:center; align-items:flex-end; padding-bottom:11vh; }
  #cadOverlay .cta .toque { position:absolute; bottom:14vh; width:min(26vw,180px); image-rendering:pixelated; filter:drop-shadow(0 2px 0 #0003) }
  #cadOverlay .cta .toque.left { left:6vw; transform:scaleX(-1) }
  #cadOverlay .cta .toque.right{ right:6vw }

  #cadOverlay .cta .hero{
    width:min(26vw, 200px); image-rendering:pixelated; filter:drop-shadow(0 4px 0 #0003);
    animation:hero-bob 1.8s ease-in-out infinite;
  }
  #cadOverlay .cta .hand{
    position:absolute; bottom:8vh; width:min(15vw,130px); image-rendering:pixelated;
    animation:hand-tap 1.15s ease-in-out infinite; transform-origin:10% 10%;
    filter:drop-shadow(0 2px 0 #0003);
  }
  #cadOverlay .cta.disabled{ opacity:.5; pointer-events:none }

  #cadOverlay .err{ text-align:center; color:#ffd2d2; font:600 clamp(12px, 2vh, 16px)/1.2 system-ui; min-height:18px; margin-top:4px; text-shadow:0 1px 0 #0006 }

  /* pequenas animações */
  @keyframes hero-bob { 0%,100%{ transform:translateY(-8px)} 50%{ transform:translateY(4px)} }
  @keyframes hand-tap { 0%,100%{ transform:translate(0,0) scale(1)} 40%{ transform:translate(12px,12px) scale(.92)} 60%{ transform:translate(0,0) scale(1)} }

  /* Responsivo telas baixas */
  @media (max-height:740px){
    #cadOverlay .form{ padding-top:7vh }
    #cadOverlay .cta{ padding-bottom:8vh }
    #cadOverlay .cta .toque{ bottom:11vh }
  }
  `;
  document.head.appendChild(st);
}

// ---------------- DOM ----------------
function ensureDom() {
  if (overlay) return;
  ensureStyles();

  overlay = document.createElement("div");
  overlay.id = "cadOverlay";
  overlay.innerHTML = `
    <div class="wrap">
      <div></div>

      <div class="form">
        <div class="label">Nome</div>
        <input id="cadName" class="line-input" type="text" placeholder="Seu nome" maxlength="40" autocomplete="off" />
        <div class="line"></div>
        <div id="cadErr" class="err"></div>
      </div>

      <div class="cta" id="cadCta">
        <img class="toque left"  src="${ASSETS.toque}" alt="Toque">
        ${ASSETS.heroBird ? `<img class="hero" src="${ASSETS.heroBird}" alt="bird">` : ""}
        <img class="hand" src="${ASSETS.hand}" alt="tap">
        <img class="toque right" src="${ASSETS.toque}" alt="Toque">
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  inputName = overlay.querySelector("#cadName");
  errEl = overlay.querySelector("#cadErr");
  ctaWrap = overlay.querySelector("#cadCta");

  // esconder imagens que 404
  overlay.querySelectorAll("img").forEach((im) => {
    im.addEventListener("error", () => (im.style.display = "none"));
  });

  // interações
  inputName.addEventListener("input", updateEnabledState);
  ctaWrap.addEventListener("click", () => trySave());
  inputName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") trySave();
  });

  updateEnabledState();
}

function updateEnabledState() {
  const ok = validName(inputName.value);
  ctaWrap.classList.toggle("disabled", !ok);
  if (!ok) errEl.textContent = "";
}

function showOverlay() {
  ensureDom();
  const cur = getLocalPlayer().nome || "";
  inputName.value = cur;
  updateEnabledState();
  overlay.classList.add("show");
  setTimeout(() => inputName?.focus(), 0);
}

function hideOverlay() {
  overlay?.classList.remove("show");
}

// ---------------- lógica ----------------
function validName(name) {
  const n = (name || "").trim();
  return n.length >= 2 && n.length <= 40;
}
function validate() {
  if (!validName(inputName.value)) return "Digite pelo menos 2 letras.";
  return "";
}

function trySave() {
  const msg = validate();
  if (msg) { errEl.textContent = msg; return; }

  // Salva somente o NOME
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ nome: inputName.value.trim() }));
  } catch { }

  errEl.textContent = "";
  hideOverlay();
  _resolver?.(); // resolve promise de ensureCadastro/showCadastroModal
}

// ---------------- API pública ----------------
let _resolver = null;

/** Garante que existe um nome salvo. Abre o overlay se necessário. */
export async function ensureCadastro() {
  const hasName = !!(getLocalPlayer().nome);
  if (hasName) return;
  showOverlay();
  await new Promise((res) => { _resolver = res; });
  _resolver = null;
}

/** Abre o overlay para editar manualmente (usado no Game Over). */
export async function showCadastroModal() {
  showOverlay();
  await new Promise((res) => { _resolver = res; });
  _resolver = null;
}

/** Retorna { nome } do localStorage (ou { nome: "" } se vazio). */
export function getLocalPlayer() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    if (obj && typeof obj === "object") return { nome: String(obj.nome || "").trim() };
  } catch { }
  return { nome: "" };
}
