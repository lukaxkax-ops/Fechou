# Plano de Implementação - Atualizações do Painel Mestre e Operador Comum

Este plano foi estendido com as especificações solicitadas para o **Acesso do Operador Comum**, oferecendo segurança operacional contra fraudes, melhoria de usabilidade e correções na integração com o WhatsApp.

---

## Proposed Changes

### Componente 1: Painel Mestre (Administração)

#### [MODIFY] [index.html](file:///C:/Users/Lucão/.gemini/antigravity/scratch/fechamento-lanchonete/index.html)
- **Filtro de Busca de Operadores:**
  - Adicionar um input de busca moderna na aba "Operadores & Acessos" (`#panel-master-users`) com o ID `master-users-search` e o evento `oninput="filterMasterUsers()"`.
- **Preço Editável de Mensalidade:**
  - Adicionar o input do valor da mensalidade (`#master-subscription-amount-grid`) na aba de "Configurações de Contato".

#### [MODIFY] [app.js](file:///C:/Users/Lucão/.gemini/antigravity/scratch/fechamento-lanchonete/app.js)
- **Lógica do Filtro (`filterMasterUsers`):**
  - Ocultar ou exibir os elementos `tr` da tabela de operadores comparando a query de busca com os metadados de Loja, Usuário (Telefone), E-mail e Status da Licença.
- **Gravação e Leitura no Upstash (`subscriptionAmount`):**
  - Integrar a propriedade `subscriptionAmount` no payload de `master_contact_settings`. Padrão: `49.90` se ausente na nuvem.

---

### Componente 2: Operador Comum - Usabilidade & Responsividade

#### [MODIFY] [index.html](file:///C:/Users/Lucão/.gemini/antigravity/scratch/fechamento-lanchonete/index.html)
- **Remoção de Categorias em Despesas:**
  - Não há alterações necessárias no HTML estático do formulário de despesas, pois as linhas de despesa são criadas dinamicamente via JS.
- **IDs de Valores Dinâmicos (Mensalidade):**
  - Mapear IDs em `license-expired-banner-text`, `tab-subscription-amount` e `overlay-subscription-amount` para receber o valor configurado dinamicamente pelo admin.

#### [MODIFY] [app.js](file:///C:/Users/Lucão/.gemini/antigravity/scratch/fechamento-lanchonete/app.js)
- **Otimização do Campo de Descrição das Despesas (`addGeneralExpenseRow`):**
  - Remover por completo a coluna `<select class="form-control expense-cat">` da fileira gerada.
  - Ajustar as propriedades de serialização em `saveClosing()` e `saveEditClosing()` para usar `.expense-cat` se existir ou aplicar `"outros"` como fallback automático de categoria.
- **Ajuste de Alinhamento de Vales (`addValeRow`):**
  - Remover o atributo `style="grid-column: span 2;"` da coluna de nome em `addValeRow` para alinhar com o novo layout de 3 colunas simétricas.

#### [MODIFY] [style.css](file:///C:/Users/Lucão/.gemini/antigravity/scratch/fechamento-lanchonete/style.css)
- **Redimensionamento Grid (Despesas & Vales):**
  - Alterar `.expense-row` no desktop para: `grid-template-columns: 1fr 120px 42px;` (removendo a coluna de 130px da categoria).
  - Atualizar o layout mobile (media query `@media (max-width: 850px)`) para empilhar o input de descrição na linha 1 (largura total) e colocar o valor e ações lado a lado na linha 2.

---

### Componente 3: Operador Comum - Segurança & Bloqueios

#### [MODIFY] [app.js](file:///C:/Users/Lucão/.gemini/antigravity/scratch/fechamento-lanchonete/app.js)
- **Bloqueio de Lançamentos em Datas Futuras:**
  - Adicionar validação estrita baseada em data local nos métodos `saveClosing`, `saveEditClosing`, `saveBankClosing` e `saveEditBankClosing` que rejeita submissões cuja data seja superior ao dia de hoje.
  - Adicionar a propriedade `max` correspondente ao dia de hoje nos inputs de data na rotina `initApp()` e nos modais de edição.
- **Bloqueio de Duplicidade / Sobrescrita com Senha Admin:**
  - Atualizar `saveClosing()` (Caixa Físico) e `saveBankClosing()` (Banco) para que detectem duplicidade de data e turno e exijam a **Senha Administrativa** do operador antes de permitir a substituição de registros já salvos.

---

### Componente 4: Correção WhatsApp & Logo Oficial

#### [MODIFY] [app.js](file:///C:/Users/Lucão/.gemini/antigravity/scratch/fechamento-lanchonete/app.js)
- **Filtro contra Strings de Imagem Gigantes (Base64):**
  - Atualizar `getFormattedWhatsAppText()` para verificar se o valor da propriedade `photo` começa com `"data:image"`. Se sim (indica fallback local), omitir a string Base64 do texto para evitar estouros de URL (erro 414 URI Too Large) e enviar o rótulo `(📑 Nota: Anexo Local)`. Se for link curto da nuvem (`https://`), anexar normalmente.
- **Migração de API WhatsApp:**
  - Substituir todos os endpoints obsoletos `https://api.whatsapp.com/send?text=` por `https://wa.me/?text=` para evitar bloqueios de redirecionamento ou ad-blockers.
- **Botão com Logo do WhatsApp (SVG):**
  - Substituir o ícone Lucide `message-square` nos botões de compartilhamento por um belo vetor inline SVG oficial do WhatsApp na listagem do histórico e nos cabeçalhos e modais.

#### [MODIFY] [index.html](file:///C:/Users/Lucão/.gemini/antigravity/scratch/fechamento-lanchonete/index.html)
- **Vetor Oficial do WhatsApp (HTML):**
  - Substituir `<i data-lucide="message-square"></i>` por um elemento inline SVG com o logo oficial do WhatsApp nos botões de detalhes do caixa, assinatura mestre e tela preta de pagamento.

---

## Verification Plan

### Manual Verification
1. **Filtro de Lojas e Acessos:** Confirmar que a busca mestre filtra dinamicamente todos os operadores.
2. **Mensalidade Flexível:** Ajustar a mensalidade no mestre e verificar o reflexo imediato no operador comum (banner, modais de leitura e QR Code Pix de checkout).
3. **Despesas de Caixa:** Confirmar que o dropdown de categorias sumiu, a descrição ficou muito maior no desktop/mobile, e vales continuam simétricos.
4. **Proteção contra Duplicidade:** Tentar cadastrar um caixa ou banco na mesma data e turno. O app deve solicitar a senha administrativa e barrar se estiver errada.
5. **Bloqueio de Datas Futuras:** Tentar forçar o salvamento para amanhã. O sistema deve emitir um alerta e negar a inserção.
6. **WhatsApp sem Erros:** Enviar um fechamento com comprovante local (Base64) e outro com comprovante cloud (ImgBB). Ambos devem abrir instantaneamente no WhatsApp sem erros de URL gigante. O ícone de compartilhamento agora ostenta o logo oficial do WhatsApp!
