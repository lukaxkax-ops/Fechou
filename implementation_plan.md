# Plano de Implementação - Configurações de Contato e Pagamento

## Objetivo
Adicionar uma nova aba **"Configurações de Contato"** no painel de acesso mestre para editar telefone, e‑mail e chave Pix de pagamento. Também criar uma aba **"Contato"** no painel de usuário que exibe o e‑mail de contato e o WhatsApp (telefone) configurado no mestre.

## User Review Required
[!IMPORTANT] Revise o layout proposto e confirme os campos a serem persistidos. Caso deseje outro estilo ou nomes, informe.

## Open Questions
[!QUESTION] Deseja que esses dados sejam armazenados em `localStorage` ou em um backend (ex.: Upstash)?
[!QUESTION] Qual estilo visual prefere para os novos cards (ex.: glassmorphism, cores do tema atual)?

## Proposed Changes
---
### Frontend (HTML)
- **[MODIFY] index.html**
  - Inserir nova `li.nav-item` em sidebar após "Assinatura & Licença" para a aba "Configurações de Contato" (ícone `mail` ou `settings`).
  - Criar seção `#panel-contact-config` no conteúdo principal com um formulário contendo:
    - Input `#master-email` (e‑mail)
    - Input `#master-phone` (telefone, formatado)
    - Input `#master-pix-key` (chave Pix)
    - Botão "Salvar" que chama `saveMasterContactSettings()`.
  - Inserir nova `li.nav-item` em sidebar (ou submenu) para a aba "Contato" do usuário (ícone `message-circle`).
  - Criar seção `#panel-user-contact` que exibe apenas:
    - `<p id="user-contact-email"></p>`
    - `<p id="user-contact-whatsapp"></p>` (telefone formatado).
---
### JavaScript (app.js)
- **[MODIFY] app.js**
  - Implementar funções:
    - `loadMasterContactSettings()` → Busca dados de `localStorage` (ou API) e preenche os inputs.
    - `saveMasterContactSettings()` → Valida e persiste dados, atualiza UI e dispara `refreshUserContact()`.
    - `refreshUserContact()` → Atualiza os campos da aba usuário a partir dos valores armazenados.
  - Atualizar `switchTab` para reconhecer os novos `data-target` (`panel-contact-config`, `panel-user-contact`).
  - Garantir que ao iniciar a aplicação (`DOMContentLoaded`) as funções de carregamento sejam chamadas.
---
### CSS (style.css)
- **[MODIFY] style.css**
  - Definir estilos premium para a nova seção (`section-card` já existente) com efeito glassmorphism e transição suave.
  - Ajustar cores dos ícones para combinar com o tema atual.
---
### Persistência
- Por enquanto usar `localStorage` com chaves:
  - `masterContact.email`
  - `masterContact.phone`
  - `masterContact.pixKey`
- Futuramente, se houver backend, substituir com chamadas `fetch`.
---
## Verification Plan
### Automated Tests
- Nenhum teste unitário automatizado, mas validar manualmente:
  1. Acessar a aba mestre "Configurações de Contato".
  2. Preencher os campos, salvar e observar `localStorage` atualizada.
  3. Navegar para a aba usuário "Contato" e confirmar que os dados aparecem corretamente.
  4. Reiniciar a página e confirmar persistência.
### Manual Verification
- Verificar responsividade em desktop e mobile.
- Checar contraste e legibilidade do novo layout.
- Testar cópia da chave Pix (reutilizar lógica existente).
