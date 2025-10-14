// src/ui/cadastroModal.js
// ✅ Cadastro local-only: valida, salva no localStorage e fecha o modal.
//    O servidor só é usado no fim de jogo (insert na tabela scores).

const LS = {
  nome: 'player:nome',
  email: 'player:email',
  telefone: 'player:telefone',
};

export function getLocalPlayer() {
  return {
    nome: (localStorage.getItem(LS.nome) || '').trim(),
    email: (localStorage.getItem(LS.email) || '').trim(),
    telefone: (localStorage.getItem(LS.telefone) || '').trim(),
  };
}

export function setLocalPlayer(p) {
  localStorage.setItem(LS.nome, p.nome || '');
  localStorage.setItem(LS.email, p.email || '');
  localStorage.setItem(LS.telefone, p.telefone || '');
}

function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').toLowerCase());
}
function isPhone(s) {
  return /^[0-9()+\-\s]{8,20}$/.test(String(s || '').trim());
}

export async function ensureCadastro() {
  const p0 = getLocalPlayer();
  if (p0.nome && isEmail(p0.email) && isPhone(p0.telefone)) {
    // já está válido localmente
    return;
  }
  await showCadastroModal();
}

export function showCadastroModal() {
  ensureCadastroOverlay();

  const el = document.getElementById('cadOverlay');
  const form = document.getElementById('cadForm');
  const nome = document.getElementById('cadNome');
  const email = document.getElementById('cadEmail');
  const tel = document.getElementById('cadTel');
  const err = document.getElementById('cadErr');
  const btn = document.getElementById('cadSalvar');

  // pré-preenche
  const p0 = getLocalPlayer();
  nome.value = p0.nome;
  email.value = p0.email;
  tel.value = p0.telefone;

  el.classList.add('show');

  return new Promise((resolve) => {
    const submit = async (ev) => {
      ev?.preventDefault();
      err.textContent = '';
      btn.disabled = true;

      const p = { nome: nome.value.trim(), email: email.value.trim(), telefone: tel.value.trim() };
      if (!p.nome || !isEmail(p.email) || !isPhone(p.telefone)) {
        err.textContent = 'Preencha nome, email válido e telefone.';
        btn.disabled = false;
        return;
      }

      try {
        // ✅ só salva local e fecha
        setLocalPlayer(p);
        el.classList.remove('show');
        resolve();
      } catch (e) {
        console.warn('[cadastro] erro local:', e);
        err.textContent = 'Não foi possível salvar. Tente novamente.';
        btn.disabled = false;
      }
    };

    form.onsubmit = submit;
    btn.onclick = submit;
  });
}

function ensureCadastroOverlay() {
  if (document.getElementById('cadStyles')) return;

  const st = document.createElement('style');
  st.id = 'cadStyles';
  st.textContent = `
  #cadOverlay{position:fixed;inset:0;display:none;place-items:center;z-index:1000}
  #cadOverlay.show{display:grid}
  #cadOverlay .backdrop{position:absolute;inset:0;background:rgba(0,0,0,.55);backdrop-filter: blur(2px)}
  #cadOverlay .card{position:relative;background:#0f172a;border:1px solid #1f2937;border-radius:16px;padding:16px;min-width:320px;max-width:92vw;color:#e5e7eb;box-shadow:0 10px 30px #0009}
  #cadOverlay .title{font:600 20px/1.2 system-ui;margin:0 0 8px}
  #cadOverlay .row{display:flex;flex-direction:column;gap:10px;margin:10px 0}
  #cadOverlay label{font:12px/1.2 system-ui;color:#94a3b8}
  #cadOverlay input{width:100%;padding:10px;border-radius:10px;border:1px solid #334155;background:#111827;color:#e5e7eb}
  #cadOverlay .btn{appearance:none;border:1px solid #334155;background:#111827;color:#e5e7eb;padding:10px 14px;border-radius:10px;cursor:pointer;font-size:14px}
  #cadOverlay .btn:hover{background:#1f2937}
  #cadOverlay .err{color:#fca5a5;font:12px system-ui;min-height:16px}
  `;
  document.head.appendChild(st);

  const overlay = document.createElement('div');
  overlay.id = 'cadOverlay';
  overlay.innerHTML = `
    <div class="backdrop"></div>
    <form class="card" id="cadForm">
      <h3 class="title">Cadastro</h3>
      <div class="row">
        <div>
          <label for="cadNome">Nome</label>
          <input id="cadNome" type="text" autocomplete="name" placeholder="Seu nome">
        </div>
        <div>
          <label for="cadEmail">Email</label>
          <input id="cadEmail" type="email" autocomplete="email" placeholder="voce@exemplo.com">
        </div>
        <div>
          <label for="cadTel">Telefone</label>
          <input id="cadTel" type="tel" autocomplete="tel" placeholder="(11) 99999-9999">
        </div>
        <div id="cadErr" class="err"></div>
        <button id="cadSalvar" class="btn" type="submit">Salvar e jogar</button>
      </div>
    </form>
  `;
  document.body.appendChild(overlay);
}
