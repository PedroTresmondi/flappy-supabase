# Flappy — Alternar rápido entre **Supabase** e **PlanB API**

Este jogo permite trocar o backend (placares/config) entre **Supabase** e uma **API alternativa (PlanB)** apenas alterando chaves no `localStorage`. **Não é preciso mexer no código.**  
O modo padrão é **AUTO**: tenta Supabase e, se falhar, faz **fallback** para a PlanB API.

---

## 🔁 Como alternar (via Console do navegador)

Abra as **DevTools** (F12) → **Console** e execute **um** dos blocos abaixo.

### Usar **Supabase** sempre
```js
localStorage.setItem('flappy:backend','supabase'); 
location.reload();
```

### Usar **PlanB API** sempre
```js
localStorage.setItem('flappy:backend','planb');
localStorage.setItem('flappy:planbApi','http://localhost:8787'); // ajuste se hospedado
location.reload();
```

### Modo **AUTO** (padrão)
Tenta Supabase; se falhar (erro/timeout), cai para a PlanB API.
```js
localStorage.setItem('flappy:backend','auto'); 
location.reload();
```

### Limpar/voltar ao padrão
```js
localStorage.removeItem('flappy:backend');
localStorage.removeItem('flappy:planbApi');
location.reload();
```

---

## 🧭 O que cada modo faz

- **`supabase`** → usa **apenas** o Supabase.  
- **`planb`** → usa **apenas** a PlanB API (URL em `flappy:planbApi`).  
- **`auto`** *(recomendado)* → tenta Supabase; se der erro/timeout, usa PlanB.

Verifique o modo atual:
```js
localStorage.getItem('flappy:backend');   // 'supabase' | 'planb' | 'auto' | null
localStorage.getItem('flappy:planbApi');  // URL atual da PlanB API (se setada)
```

---

## 🧩 Endpoints esperados da **PlanB API**

Se você for rodar sua própria API compatível, estes são os endpoints que o jogo usa:

- **POST** `/scores` — salva score  
  **Body:**
  ```json
  {
    "run_id": "uuid-ou-string",
    "player_name": "Nome do jogador",
    "score": 12.5,
    "played_at": "2025-10-22T12:34:56.000Z",
    "prize_group": "Grupo A",
    "meta": { "startedAt": "...", "durationMs": 1234, "activeTimeMs": 1200, "board": { "w":1080,"h":1920 }, "version": 1 }
  }
  ```

- **GET** `/scores/rank?score=NN` — retorna posição global  
  **Resposta:**
  ```json
  { "position": 7 }
  ```

- **GET** `/scores/top10` — retorna top 10  
  **Resposta:**
  ```json
  [
    { "player_name": "Alice", "score": 25, "played_at": "2025-10-22T12:00:00Z" },
    { "player_name": "Bob",   "score": 20, "played_at": "2025-10-22T11:00:00Z" }
  ]
  ```

- **GET** `/config/:slug` — retorna config remota  
  **Resposta:**
  ```json
  { "data": { /* objeto de configuração do jogo */ } }
  ```

> **Importante:** se o jogo estiver em **HTTPS**, sirva a PlanB API também em **HTTPS** (evita *mixed content*).  
> **CORS:** habilite `Access-Control-Allow-Origin` (use `*` ou o domínio do jogo).

---

## 💡 Dicas rápidas

- **Fixar PlanB em produção:**
  ```js
  localStorage.setItem('flappy:backend','planb');
  localStorage.setItem('flappy:planbApi','https://sua-api.exemplo.com');
  location.reload();
  ```
- **Troca rápida durante testes:** altere a chave e recarregue a página.

---

## 🛠️ Troubleshooting

- **CORS bloqueado** → Configure `Access-Control-Allow-Origin` na API (use `*` ou o domínio do jogo).  
- **Mixed content** → Use **HTTPS** tanto no jogo quanto na API.  
- **PlanB local não responde** → Confira a URL/porta em `flappy:planbApi` e se o servidor está rodando.  

---

## 📄 Licença

Este projeto segue a licença do repositório. Caso não exista, defina a licença de sua preferência (por exemplo, MIT).
