// src/ui/cadastroModal.js
"use strict";

const STORAGE_KEY = "flappy:player";

let overlay, inputName, errEl, ctaWrap;
// teclado
let kbFloat, kbRoot, repeatTimer = 0;
// termos
let termsOverlay, termsChk, termsOpenLink;

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
  botoes: joinBase("assets/img/botoes.png"),
  toque: joinBase("assets/img/toque.png"),
  hand: joinBase("assets/img/handClick.png"),
  heroBird: joinBase("assets/img/flappybird.png"),
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

  /* Bloco do formulário */
  #cadOverlay .form{
    display:grid; justify-items:center; align-content:start;
    gap:18px; padding-top:min(10vh,120px);
  }

  /* Título/label */
  #cadOverlay .label{
    color:#fff; font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
    font-weight:700; letter-spacing:.5px; font-size:clamp(18px, 3.4vh, 28px);
    text-shadow:0 2px 0 #0003;
    margin-bottom:-8px;
  }

  /* Input tipo "linha" */
  #cadOverlay .line-input{
    width:min(86vw, 640px);
    border:none; outline:none; background:transparent; color:#fff;
    font-size:clamp(16px, 2.8vh, 24px); text-align:center;
    padding:8px 10px 12px; border-bottom:4px solid #fff9;
    caret-color:#fff;
  }
  #cadOverlay .line-input::placeholder{ color:#ffffffcc }
  #cadOverlay .line{ width:min(86vw,640px); height:0; border-bottom:4px solid #ffffff33; margin-top:-12px }

  /* Checkbox "linha" (visual custom) */
  #cadOverlay .termsRow{
    width:min(86vw, 640px); display:flex; justify-content:center; gap:10px; align-items:center;
    user-select:none;
  }
  #cadOverlay .termsRow .fakebox{
    width:22px; height:22px; border:3px solid #fff9; border-radius:6px;
    box-shadow:0 2px 0 #0003 inset; display:inline-flex; align-items:center; justify-content:center;
    background:transparent;
  }
  #cadOverlay .termsRow .fakebox.on{ background:#22c55e; border-color:#16a34a }
  #cadOverlay .termsRow .txt{
    color:#fff; font-weight:700; letter-spacing:.3px;
    font-size:clamp(14px,2.4vh,20px); text-shadow:0 1px 0 #0004; cursor:pointer;
  }
  #cadOverlay .termsRow .link{
    color:#c7d2fe; text-decoration:underline; cursor:pointer;
  }

  /* CTA (setas) */
  #cadOverlay .cta {
    position:relative; display:flex; justify-content:center; align-items:flex-end;
    padding-bottom:11vh;
  }
  #cadOverlay .cta .botoes{
    position:absolute; left:50%; transform:translateX(-50%);
    bottom:14vh; width:min(70vw, 520px);
    image-rendering:pixelated; filter:drop-shadow(0 2px 0 #0003); z-index:1;
  }
  #cadOverlay .cta .toque { position:absolute; bottom:14vh; width:min(26vw,180px); image-rendering:pixelated; filter:drop-shadow(0 2px 0 #0003); z-index:1; }
  #cadOverlay .cta .toque.left { left:6vw; transform:scaleX(-1) }
  #cadOverlay .cta .toque.right{ right:6vw }
  #cadOverlay .cta .hero{
    position:absolute; left:50%; transform:translateX(-50%);
    bottom:14vh; width:min(26vw,200px); image-rendering:pixelated;
    filter:drop-shadow(0 4px 0 #0003); animation:cad-hero-bob 1.8s ease-in-out infinite; z-index:2;
  }
  #cadOverlay .cta .hand{
    position:absolute; left:50%; transform:translateX(-50%);
    bottom:8vh; width:min(15vw,130px); image-rendering:pixelated;
    animation:cad-hand-tap 1.15s ease-in-out infinite; transform-origin:10% 10%;
    filter:drop-shadow(0 2px 0 #0003); z-index:3;
  }
  #cadOverlay .cta.disabled{ opacity:.5; pointer-events:none }

  #cadOverlay .err{ text-align:center; color:#ffd2d2; font:600 clamp(12px, 2vh, 16px)/1.2 system-ui; min-height:18px; margin-top:4px; text-shadow:0 1px 0 #0006 }

  @keyframes cad-hero-bob { 0%,100%{ transform:translateX(-50%) translateY(-8px) } 50%{ transform:translateX(-50%) translateY(4px) } }
  @keyframes cad-hand-tap { 0%,100%{ transform:translateX(-50%) translate(0,0) scale(1)} 40%{ transform:translateX(-50%) translate(12px,12px) scale(.92)} 60%{ transform:translateX(-50%) translate(0,0) scale(1)} }

  /* -------- teclado virtual flutuante -------- */
  #vkFloat{
    position:fixed; left:50%; top:55%; transform:translate(-50%, -50%);
    width:min(94vw, 700px);
    z-index:1201;
    background:rgba(11,11,15,.82); border:2px solid #222; border-radius:16px;
    box-shadow:0 10px 34px rgba(0,0,0,.45), inset 0 0 0 4px #111;
    padding:10px 10px 12px 10px;
    display:none;
  }
  #vkFloat.show{ display:block; }
  #vkDrag{ position:absolute; left:0; right:0; top:0; height:14px; cursor:grab; }
  .vk-row{ display:flex; gap:8px; justify-content:center; margin:6px 0; }
  .vk-key{
    display:inline-flex; align-items:center; justify-content:center;
    min-width: clamp(32px, 7vw, 64px);
    height: clamp(38px, 7vh, 52px);
    padding: 0 8px; border-radius:12px; background:#1b1b29; color:#fff;
    font-weight:800; font-size:clamp(14px, 2.8vh, 20px);
    box-shadow: 0 4px 0 #0d0d18, 0 8px 0 #06060e; border:1px solid #2b2b3d;
    touch-action: manipulation;
  }
  .vk-key:active{ transform: translateY(1px); }
  .vk-wide{ min-width: clamp(70px, 15vw, 140px); }
  .vk-space{ min-width: clamp(120px, 36vw, 300px); }
  .vk-danger{ background:#7f1d1d; box-shadow: 0 4px 0 #3f0e0e, 0 8px 0 #250808; border-color:#a11; }

  /* -------- overlay de termos -------- */
  #cadTerms{ position:fixed; inset:0; background:rgba(0,0,0,.55); display:none; z-index:1300; }
  #cadTerms.show{ display:block; }
  #cadTerms .panel{
    position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
    width:min(94vw, 760px); max-height:min(76vh, 760px);
    background:#0e1424; border:2px solid #1f2a44; border-radius:16px;
    box-shadow:0 12px 30px rgba(0,0,0,.55), inset 0 0 0 4px #0a1020;
    display:grid; grid-template-rows:auto 1fr auto;
  }
  #cadTerms .title{
    padding:12px 16px; color:#fff; font-weight:800; letter-spacing:.4px; text-shadow:0 1px 0 #0006;
    border-bottom:1px solid #1f2a44;
  }
  #cadTerms .body{
    padding:12px 14px; overflow:auto; color:#e5e7eb; font-size:14px; line-height:1.5;
  }
  #cadTerms .footer{
    display:flex; justify-content:center; gap:10px; padding:10px 14px; border-top:1px solid #1f2a44;
  }
  #cadTerms .btn{
    appearance:none; border:1px solid #334155; background:#111827; color:#fff;
    padding:8px 12px; border-radius:10px; font-weight:700;
  }
  #cadTerms .btn:hover{ background:#1f2937 }
  #cadTerms .btn.primary{ background:#22c55e; border-color:#16a34a; color:#06210f; }
  #cadTerms .btn.primary:hover{ background:#16a34a }

  @media (max-height:740px){
    #cadOverlay .form{ padding-top:7vh }
    #cadOverlay .cta{ padding-bottom:8vh }
    #cadOverlay .cta .botoes{ bottom:11vh }
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

  // blocos das setas (não alteramos o "OK")
  const arrows = ASSETS.botoes
    ? `<img class="botoes" src="${ASSETS.botoes}" alt="Toque">`
    : `
       <img class="toque left"  src="${ASSETS.toque}" alt="Toque">
       <img class="toque right" src="${ASSETS.toque}" alt="Toque">
      `;

  overlay.innerHTML = `
    <div class="wrap">
      <div></div>

      <div class="form">
        <div class="label">Nome</div>
        <input id="cadName" class="line-input" type="text" placeholder="Seu nome" maxlength="40" autocomplete="off" />
        <div class="line"></div>

        <!-- Checkbox estilo linha -->
        <div class="termsRow" id="cadTermsRow">
          <div class="fakebox" id="cadTermsBox" aria-hidden="true"></div>
          <div class="txt">
            Li e aceito os <span class="link" id="cadOpenTerms">termos</span>
          </div>
        </div>

        <div id="cadErr" class="err"></div>
      </div>

      <div class="cta" id="cadCta" aria-label="Confirmar nome e começar">
        ${arrows}
        ${ASSETS.heroBird ? `<img class="hero" src="${ASSETS.heroBird}" alt="bird">` : ""}
        ${ASSETS.hand ? `<img class="hand" src="${ASSETS.hand}" alt="tap">` : ""}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // teclado flutuante
  kbFloat = document.createElement("div");
  kbFloat.id = "vkFloat";
  kbFloat.innerHTML = `<div id="vkDrag"></div><div id="vkRoot"></div>`;
  document.body.appendChild(kbFloat);
  kbRoot = kbFloat.querySelector("#vkRoot");
  buildKeyboard(kbRoot);
  makeDraggable(kbFloat, kbFloat.querySelector("#vkDrag"));

  // overlay de termos
  termsOverlay = document.createElement("div");
  termsOverlay.id = "cadTerms";
  termsOverlay.innerHTML = `
    <div class="panel" role="dialog" aria-modal="true">
      <div class="title">Termos de Uso</div>
      <div class="body" id="cadTermsBody">
        <p>Exemplo de termos. Você pode substituir por conteúdo real (HTML) carregado do seu projeto.</p>
        <p>• Usamos seu nome apenas para ranking local/online.</p>
        <p>• Ao prosseguir você concorda com a coleta do score e horário da partida.</p>
        <p>• Sem dados sensíveis (e-mail/telefone) são armazenados.</p>
      </div>
      <div class="footer">
        <button class="btn" id="cadTermsCancel">Fechar</button>
        <button class="btn primary" id="cadTermsAccept">Aceitar</button>
      </div>
    </div>
  `;
  document.body.appendChild(termsOverlay);

  // refs
  inputName = overlay.querySelector("#cadName");
  errEl = overlay.querySelector("#cadErr");
  ctaWrap = overlay.querySelector("#cadCta");
  termsChk = overlay.querySelector("#cadTermsBox");
  termsOpenLink = overlay.querySelector("#cadOpenTerms");

  // esconder imagens que 404
  overlay.querySelectorAll("img").forEach((im) => {
    im.addEventListener("error", () => (im.style.display = "none"));
  });

  // bloquear teclado nativo (usar virtual)
  inputName.setAttribute("readonly", "true");
  inputName.addEventListener("focus", () => inputName.blur());

  // interações
  inputName.addEventListener("input", updateEnabledState);
  ctaWrap.addEventListener("click", () => trySave());
  window.addEventListener("keydown", (e) => { if (e.key === "Enter" && overlay?.classList.contains("show")) trySave(); });

  // termo: abrir ao clicar em qualquer parte da linha
  overlay.querySelector("#cadTermsRow").addEventListener("click", (e) => {
    e.preventDefault();
    openTermsOverlay();
  });
  termsOpenLink.addEventListener("click", (e) => { e.preventDefault(); openTermsOverlay(); });

  // termos: ações
  termsOverlay.querySelector("#cadTermsCancel").addEventListener("click", () => closeTermsOverlay(false));
  termsOverlay.querySelector("#cadTermsAccept").addEventListener("click", () => closeTermsOverlay(true));
  termsOverlay.addEventListener("click", (e) => {
    if (e.target === termsOverlay) closeTermsOverlay(true); // toque fora => aceitar
  });

  updateEnabledState();
}

function setTermsChecked(on) {
  termsChk.classList.toggle("on", !!on);
}
function isTermsChecked() {
  return termsChk.classList.contains("on");
}

function openTermsOverlay() {
  termsOverlay.classList.add("show");
}
function closeTermsOverlay(accept) {
  termsOverlay.classList.remove("show");
  if (accept) setTermsChecked(true);
  updateEnabledState();
}

function updateEnabledState() {
  const okName = validName(inputName.value);
  const okTerms = isTermsChecked();
  const ok = okName && okTerms;
  ctaWrap.classList.toggle("disabled", !ok);
  if (ok) errEl.textContent = "";
  else if (!okTerms) errEl.textContent = ""; // não mostra erro até tentar salvar
}

function showOverlay() {
  ensureDom();
  const cur = getLocalPlayer();
  inputName.value = cur.nome || "";
  setTermsChecked(!!cur.acceptedTerms); // mantém aceitação se já existia
  updateEnabledState();
  overlay.classList.add("show");
  kbFloat.classList.add("show");
}

function hideOverlay() {
  overlay?.classList.remove("show");
  kbFloat?.classList.remove("show");
}

// ---------------- validação/salvar ----------------
function validName(name) {
  const n = (name || "").trim();
  return n.length >= 2 && n.length <= 40;
}
function validate() {
  if (!validName(inputName.value)) return "Digite pelo menos 2 letras.";
  if (!isTermsChecked()) return "É necessário aceitar os termos para continuar.";
  return "";
}

function trySave() {
  const msg = validate();
  if (msg) { errEl.textContent = msg; return; }

  // Salva nome + aceite de termos
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ nome: inputName.value.trim(), acceptedTerms: true })
    );
  } catch { }

  errEl.textContent = "";
  hideOverlay();
  _resolver?.(); // resolve ensureCadastro/showCadastroModal
}

// ---------------- teclado virtual ----------------
function buildKeyboard(root) {
  root.innerHTML = "";
  /*   const ROW0 = [..."1234567890"]; */
  const ROW1 = [..."QWERTYUIOP"];
  const ROW2 = [..."ASDFGHJKL"];
  const ROW3 = [..."ZXCVBNMÇ"];

  /*   root.appendChild(makeRow(ROW0));*/
  root.appendChild(makeRow(ROW1));
  root.appendChild(makeRow(ROW2));
  root.appendChild(makeRow([
    ...ROW3,
    { type: "backspace", label: "⌫", cls: "vk-danger" },
  ]));
  root.appendChild(makeRow([
    { type: "space", label: "Espaço", cls: "vk-space" },
    { type: "clear", label: "Limpar", cls: "vk-wide vk-danger" },
  ]));
}
function makeRow(items) {
  const row = document.createElement("div");
  row.className = "vk-row";
  items.forEach((it) => {
    if (typeof it === "string") row.appendChild(makeKey(it, "char"));
    else row.appendChild(makeKey(it.label, it.type, it.cls));
  });
  return row;
}
function makeKey(label, type = "char", extraCls = "") {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `vk-key ${extraCls || ""}`;
  b.textContent = label;

  if (type === "char") {
    b.addEventListener("pointerdown", () => insertText(label));
  } else if (type === "space") {
    b.addEventListener("pointerdown", () => insertText(" "));
  } else if (type === "backspace") {
    const del = () => backspaceOnce();
    b.addEventListener("pointerdown", () => {
      del();
      clearInterval(repeatTimer);
      repeatTimer = setInterval(del, 80);
    });
    const stop = () => { clearInterval(repeatTimer); repeatTimer = 0; };
    b.addEventListener("pointerup", stop);
    b.addEventListener("pointercancel", stop);
    b.addEventListener("pointerleave", stop);
  } else if (type === "clear") {
    b.addEventListener("pointerdown", () => { inputName.value = ""; updateEnabledState(); });
  } else if (type === "ok") {
    b.addEventListener("pointerdown", trySave);
  }
  return b;
}
function insertText(t) {
  const max = Number(inputName.getAttribute("maxlength") || 40);
  if ((inputName.value || "").length >= max) return;
  inputName.value += t;
  updateEnabledState();
}
function backspaceOnce() {
  const v = inputName.value || "";
  inputName.value = v.slice(0, Math.max(0, v.length - 1));
  updateEnabledState();
}
function makeDraggable(box, handle) {
  if (!box || !handle) return;
  let dragging = false, sx = 0, sy = 0, left = 0, top = 0;

  const onDown = (e) => {
    dragging = true;
    handle.style.cursor = "grabbing";
    sx = e.clientX; sy = e.clientY;
    const r = box.getBoundingClientRect();
    left = r.left; top = r.top;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };
  const onMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    box.style.left = `${left + dx}px`;
    box.style.top = `${top + dy}px`;
    box.style.transform = "translate(0,0)";
  };
  const onUp = () => {
    dragging = false;
    handle.style.cursor = "grab";
    window.removeEventListener("pointermove", onMove);
  };

  handle.addEventListener("pointerdown", onDown);
}

// ---------------- API pública ----------------
let _resolver = null;

export async function ensureCadastro() {
  const hasName = !!(getLocalPlayer().nome);
  if (hasName) return;
  showOverlay();
  await new Promise((res) => { _resolver = res; });
  _resolver = null;
}
export async function showCadastroModal() {
  showOverlay();
  await new Promise((res) => { _resolver = res; });
  _resolver = null;
}
export function getLocalPlayer() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    if (obj && typeof obj === "object") {
      return {
        nome: String(obj.nome || "").trim(),
        acceptedTerms: !!obj.acceptedTerms,
      };
    }
  } catch { }
  return { nome: "", acceptedTerms: false };
}
