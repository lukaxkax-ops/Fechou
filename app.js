// =====================================================================
// Banco de Dados em Nuvem - Upstash Redis REST API
// CORS nativo comprovado no browser, dados via body JSON, sem limite de URL.
// UUID fixo: db3fb69b-a116-41c2-bcb7-29760478a473
// Para renovar/recriar: POST https://upstash.com/start-redis com Idempotency-Key: db3fb69b-a116-41c2-bcb7-29760478a473
// Para tornar permanente: https://upstash.com/start-redis/console/db3fb69b-a116-41c2-bcb7-29760478a473
// =====================================================================
const UPSTASH_URL = "https://mint-rabbit-136967.upstash.io";
const UPSTASH_TOKEN = "gQAAAAAAAhcHAQIgcDEzYzgyMWQxOGQ1NGI0MGFlOGUwZmVlNDAyM2VjOGE0Ng";

// Chave Pix do Administrador Mestre para Recebimento de Créditos (Configurável)
const PIX_KEY = "70df014b-dec7-412a-9920-743e2687e3fb";

// Executa um comando Redis via REST API com CORS nativo
async function redisCmd(...args) {
  const res = await fetch(UPSTASH_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(args)
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Erro no servidor Upstash (${res.status}): ${errText}`);
  }
  const data = await res.json();
  return data.result;
}

// Lê a lista de usuários da nuvem
async function dbGetUsers() {
  const raw = await redisCmd("GET", "fechou:users");
  if (raw === null || raw === undefined) return [];
  return JSON.parse(raw);
}

// Salva a lista de usuários na nuvem
async function dbSetUsers(users) {
  const result = await redisCmd("SET", "fechou:users", JSON.stringify(users));
  if (result !== "OK") {
    throw new Error("Erro ao salvar usuários: resposta inválida do servidor.");
  }
  return true;
}

// Lê os fechamentos de um usuário específico da nuvem
async function dbGetClosings(username) {
  const raw = await redisCmd("GET", `fechou:closings:${username}`);
  if (raw === null || raw === undefined) return [];
  return JSON.parse(raw);
}

// Salva os fechamentos de um usuário específico na nuvem
async function dbSetClosings(username, closings) {
  const result = await redisCmd("SET", `fechou:closings:${username}`, JSON.stringify(closings));
  if (result !== "OK") {
    throw new Error("Erro ao salvar fechamentos: resposta inválida do servidor.");
  }
  return true;
}

// Lê os fechamentos bancários de um usuário específico da nuvem
async function dbGetBankClosings(username) {
  const raw = await redisCmd("GET", `fechou:bank_closings:${username}`);
  if (raw === null || raw === undefined) return [];
  return JSON.parse(raw);
}

// Salva os fechamentos bancários de um usuário específico na nuvem
async function dbSetBankClosings(username, closings) {
  const result = await redisCmd("SET", `fechou:bank_closings:${username}`, JSON.stringify(closings));
  if (result !== "OK") {
    throw new Error("Erro ao salvar fechamentos bancários: resposta inválida do servidor.");
  }
  return true;
}

// Verifica se o modo de manutenção está ativo na nuvem
async function dbGetMaintenanceMode() {
  try {
    const raw = await redisCmd("GET", "fechou:maintenance_mode");
    return raw === "true";
  } catch (e) {
    console.warn("Erro ao ler modo manutenção do Upstash:", e);
    return false;
  }
}

// Ativa/desativa o modo de manutenção na nuvem
async function dbSetMaintenanceMode(status) {
  try {
    const result = await redisCmd("SET", "fechou:maintenance_mode", status ? "true" : "false");
    return result === "OK";
  } catch (e) {
    console.error("Erro ao gravar modo manutenção no Upstash:", e);
    return false;
  }
}

// Checa assincronamente e desconecta se estiver em manutenção
async function checkMaintenanceStatus() {
  try {
    const isMaintenance = await dbGetMaintenanceMode();
    if (isMaintenance && currentUser && currentUser !== "mestre") {
      alert("⚠️ O sistema entrou em modo de manutenção para atualizações. Você foi desconectado pelo administrador.");
      logoutUser(true); // Desconexão forçada sem popup de confirmação extra
    }
  } catch (e) {
    console.warn("Falha na checagem de manutenção periódica:", e);
  }
}

let closingsData = [];
let bankClosingsData = [];
let currentUser = null;
let isAuditMode = false;
let auditedUser = null;
let isLicenseExpired = false;
let deferredPrompt = null;

// Categorias de despesas em português para exibição
const EXPENSE_CATEGORIES = {
  vales: "Vales de Funcionários",
  carne: "Carne",
  alimentos: "Alimentos em Geral",
  limpeza: "Limpeza",
  outros: "Outros"
};

// Canais de Receitas para rotulagem
const REVENUE_CHANNELS = {
  ifood: { 
    label: "iFood", 
    color: "#ea1d2c",
    logo: `<svg viewBox="0 0 100 100" style="width: 14px; height: 14px; display: inline-block; vertical-align: middle; margin-right: 6px;"><circle cx="50" cy="50" r="48" fill="#ea1d2c" /><path d="M25 55 Q50 85 75 55 Q50 70 25 55 Z" fill="#ffffff" /><circle cx="35" cy="45" r="5" fill="#ffffff" /><circle cx="65" cy="45" r="5" fill="#ffffff" /></svg>`
  },
  99: { 
    label: "99 Food", 
    color: "#facc15",
    logo: `<svg viewBox="0 0 100 100" style="width: 14px; height: 14px; display: inline-block; vertical-align: middle; margin-right: 6px;"><circle cx="50" cy="50" r="48" fill="#facc15" /><text x="50" y="66" font-family="'Outfit', sans-serif" font-weight="900" font-size="44" fill="#1e1e1e" text-anchor="middle">99</text></svg>`
  },
  keeta: { 
    label: "Keeta", 
    color: "#f43f5e",
    logo: `<svg viewBox="0 0 100 100" style="width: 14px; height: 14px; display: inline-block; vertical-align: middle; margin-right: 6px;"><circle cx="50" cy="50" r="48" fill="#f43f5e" /><path d="M20 50 C28 45, 38 42, 48 42 C58 42, 68 32, 78 30 C72 38, 62 46, 52 48 C42 50, 32 55, 24 62 L20 50 Z" fill="#ffffff" /><path d="M68 32 C78 32, 82 35, 84 38 C80 38, 74 36, 68 32 Z" fill="#ffffff" /><path d="M26 58 C20 66, 16 70, 12 72 C16 68, 22 62, 26 58 Z" fill="#ffffff" /></svg>`
  },
  pix: { 
    label: "Pix", 
    color: "#06b6d4",
    logo: `<svg viewBox="0 0 100 100" style="width: 14px; height: 14px; display: inline-block; vertical-align: middle; margin-right: 6px;"><path d="M50 15 L85 50 L50 85 L15 50 Z" fill="none" stroke="#06b6d4" stroke-width="10" /><path d="M50 30 L70 50 L50 70 L30 50 Z" fill="#06b6d4" /></svg>`
  },
  credit: { 
    label: "Cartão Crédito", 
    color: "#8b5cf6",
    logo: `<svg viewBox="0 0 100 100" style="width: 14px; height: 14px; display: inline-block; vertical-align: middle; margin-right: 6px;"><rect x="10" y="20" width="80" height="60" rx="10" fill="#8b5cf6" /><rect x="10" y="35" width="80" height="15" fill="#1e1e1e" /><rect x="20" y="60" width="15" height="10" fill="#ffffff" /></svg>`
  },
  debit: { 
    label: "Cartão Débito", 
    color: "#3b82f6",
    logo: `<svg viewBox="0 0 100 100" style="width: 14px; height: 14px; display: inline-block; vertical-align: middle; margin-right: 6px;"><rect x="10" y="20" width="80" height="60" rx="10" fill="#3b82f6" /><rect x="10" y="35" width="80" height="15" fill="#1e1e1e" /><rect x="20" y="60" width="15" height="10" fill="#ffffff" /></svg>`
  },
  vr: { 
    label: "VR (Vale Refeição)", 
    color: "#f97316",
    logo: `<svg viewBox="0 0 100 100" style="width: 14px; height: 14px; display: inline-block; vertical-align: middle; margin-right: 6px;"><rect x="10" y="20" width="80" height="60" rx="8" fill="#f97316" /><circle cx="10" cy="50" r="10" fill="#f97316" opacity="0.3" /><circle cx="90" cy="50" r="10" fill="#f97316" opacity="0.3" /><text x="50" y="58" font-family="sans-serif" font-weight="bold" font-size="24" fill="#ffffff" text-anchor="middle">VR</text></svg>`
  },
  cash: { 
    label: "Dinheiro Físico", 
    color: "#10b981",
    logo: `<svg viewBox="0 0 100 100" style="width: 14px; height: 14px; display: inline-block; vertical-align: middle; margin-right: 6px;"><rect x="10" y="25" width="80" height="50" rx="6" fill="#10b981" /><circle cx="50" cy="50" r="16" fill="none" stroke="#ffffff" stroke-width="6" /><circle cx="50" cy="50" r="8" fill="#ffffff" /></svg>`
  }
};

// Inicialização da Aplicação
document.addEventListener("DOMContentLoaded", () => {
  // Registro do Service Worker do PWA
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js")
      .then(reg => {
        console.log("Service Worker registrado com sucesso no escopo:", reg.scope);
        // Detecta atualizações e recarrega a página para aplicar os arquivos novos instantaneamente
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              console.log("Nova versão do Fechou! instalada. Recarregando...");
              window.location.reload();
            }
          });
        });
      })
      .catch(err => console.warn("Falha ao registrar Service Worker:", err));
  }

  // Inicializa o relógio dinâmico no topo (independente de estar logado)
  updateClock();
  setInterval(updateClock, 1000);

  // Aplica o tema salvo (padrão claro se não definido)
  const savedTheme = localStorage.getItem("gastrofecho_theme");
  if (savedTheme === "dark") {
    document.body.classList.add("dark-theme");
    const toggleBtn = document.getElementById("theme-toggle-btn");
    if (toggleBtn) {
      toggleBtn.innerHTML = `<i data-lucide="sun"></i>`;
    }
  }

  // Verifica Autenticação
  checkAuth();

  // Injeta a chave Pix centralizada dinamicamente
  const pixInput = document.getElementById("pix-key-input");
  if (pixInput) pixInput.value = PIX_KEY;
  const pixInputTab = document.getElementById("pix-key-input-tab");
  if (pixInputTab) pixInputTab.value = PIX_KEY;

  // Checagem periódica do modo de manutenção na nuvem (a cada 15 segundos)
  setInterval(() => {
    const loggedUser = sessionStorage.getItem("gastrofecho_logged_user");
    if (loggedUser && loggedUser !== "mestre") {
      checkMaintenanceStatus();
    }
  }, 15000);
  
  // Lógica de Instalação Nativa PWA
  const installBtn = document.getElementById("btn-pwa-install");
  if (installBtn) {
    installBtn.addEventListener("click", async () => {
      if (!deferredPrompt) return;
      // Dispara o prompt nativo do navegador
      deferredPrompt.prompt();
      // Aguarda a escolha do usuário
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`Escolha do usuário para a instalação do PWA: ${outcome}`);
      deferredPrompt = null;
      installBtn.style.display = "none";
    });
  }

  // Renderiza ícones do Lucide
  lucide.createIcons();
});

// Verifica se o usuário está logado e se a licença está ativa
async function checkAuth() {
  const loggedUser = sessionStorage.getItem("gastrofecho_logged_user");
  const authOverlay = document.getElementById("auth-overlay");
  const paymentOverlay = document.getElementById("payment-overlay");
  const profileBadge = document.getElementById("user-profile-badge");
  const logoutBtn = document.getElementById("logout-btn");
  const mainGrid = document.querySelector(".main-grid");
  const masterGrid = document.getElementById("master-grid");
  const auditBanner = document.getElementById("master-audit-banner");

  if (!paymentOverlay) return; // Carregamento da página

  if (loggedUser) {
    currentUser = loggedUser;
    
    // Se for operador comum, checa a assinatura assincronamente na nuvem
    if (currentUser !== "mestre") {
      const hasAccess = await verifyUserSubscription(currentUser);
      const expiredBanner = document.getElementById("license-expired-banner");
      let isLockedOut = false;

      if (!hasAccess) {
        // Licença expirada!
        isLicenseExpired = true;
        if (expiredBanner) expiredBanner.style.display = "flex";

        // Checa se expirou há mais de 7 dias para efetuar bloqueio total (lockout)
        try {
          const users = await dbGetUsers();
          const user = users.find(u => u.username.toLowerCase() === currentUser.toLowerCase());
          if (user && !user.isVip) {
            const now = new Date();
            let expDate = null;
            if (user.creditsUntil) expDate = new Date(user.creditsUntil);
            
            let trialDate = null;
            if (user.trialUntil) {
              trialDate = new Date(user.trialUntil);
            } else if (user.createdAt) {
              trialDate = new Date(new Date(user.createdAt).getTime() + 7 * 24 * 60 * 60 * 1000);
            }

            if (trialDate && (!expDate || trialDate > expDate)) {
              expDate = trialDate;
            }

            if (expDate) {
              const gracePeriodEnd = new Date(expDate.getTime() + 7 * 24 * 60 * 60 * 1000);
              if (now > gracePeriodEnd) {
                isLockedOut = true;
              }
            } else {
              isLockedOut = true;
            }
          }
        } catch (err) {
          console.warn("Erro ao checar prazo de tolerância de visualização:", err);
        }
      } else {
        isLicenseExpired = false;
        if (expiredBanner) expiredBanner.style.display = "none";
      }
      
      disableOperatorInputs(isLicenseExpired);
      
      // Checagem assíncrona adicional de manutenção
      checkMaintenanceStatus();

      if (isLockedOut) {
        // Bloqueio total por expiração maior que 7 dias!
        paymentOverlay.style.display = "flex";
        paymentOverlay.style.opacity = "1";
        
        authOverlay.style.opacity = "0";
        setTimeout(() => authOverlay.style.display = "none", 500);
        
        profileBadge.style.display = "inline-flex";
        document.getElementById("user-display-name").textContent = localStorage.getItem(`gastrofecho_store_name_${currentUser}`) || currentUser;
        logoutBtn.style.display = "inline-flex";
        mainGrid.style.display = "none";
        masterGrid.style.display = "none";
        return;
      }
    } else {
      isLicenseExpired = false;
      const expiredBanner = document.getElementById("license-expired-banner");
      if (expiredBanner) expiredBanner.style.display = "none";
      disableOperatorInputs(false);
    }

    // Acesso Liberado
    paymentOverlay.style.display = "none";
    paymentOverlay.style.opacity = "0";

    authOverlay.style.opacity = "0";
    setTimeout(() => authOverlay.style.display = "none", 500);
    
    profileBadge.style.display = "inline-flex";
    let displayName = "GastroFecho";
    const subtitleEl = document.getElementById("header-store-subtitle");
    const sidebarTitleEl = document.getElementById("sidebar-store-title");
    if (currentUser === "mestre") {
      displayName = "Administrador Mestre";
      if (subtitleEl) subtitleEl.textContent = "Painel Administrativo Mestre";
      if (sidebarTitleEl) sidebarTitleEl.textContent = "Fechou! Mestre";
    } else {
      const savedStoreName = localStorage.getItem(`gastrofecho_store_name_${currentUser}`);
      displayName = savedStoreName || currentUser;
      if (subtitleEl) {
        subtitleEl.textContent = savedStoreName || `Operador: ${currentUser}`;
      }
      if (sidebarTitleEl) {
        sidebarTitleEl.textContent = savedStoreName || currentUser;
      }
    }
    document.getElementById("user-display-name").textContent = displayName;
    logoutBtn.style.display = "inline-flex";
    
    // Controle de visibilidade das abas de contato
    const navContactConfig = document.getElementById("nav-contact-config");
    const navUserContact = document.getElementById("nav-user-contact");

    if (currentUser === "mestre") {
      // Exibe Painel Mestre
      mainGrid.style.display = "none";
      auditBanner.style.display = "none";
      masterGrid.style.display = "block";
      // Mestre vê "Configurações de Contato", NÃO vê "Contato"
      if (navContactConfig) navContactConfig.style.display = "";
      if (navUserContact) navUserContact.style.display = "none";
      loadMasterPanel();
    } else {
      // Exibe Interface Operador
      mainGrid.style.display = "grid";
      masterGrid.style.display = "none";
      auditBanner.style.display = isAuditMode ? "flex" : "none";
      // Operador vê "Contato", NÃO vê "Configurações de Contato"
      if (navContactConfig) navContactConfig.style.display = "none";
      if (navUserContact) navUserContact.style.display = "";
      initApp();
    }
  } else {
    currentUser = null;
    paymentOverlay.style.display = "none";
    paymentOverlay.style.opacity = "0";

    const subtitleEl = document.getElementById("header-store-subtitle");
    if (subtitleEl) subtitleEl.textContent = "Acesse sua conta";

    const sidebarTitleEl = document.getElementById("sidebar-store-title");
    if (sidebarTitleEl) sidebarTitleEl.textContent = "Fechou!";

    authOverlay.style.display = "flex";
    setTimeout(() => authOverlay.style.opacity = "1", 50);
    profileBadge.style.display = "none";
    logoutBtn.style.display = "none";
    mainGrid.style.display = "none";
    masterGrid.style.display = "none";
    auditBanner.style.display = "none";
  }
}

// Inicializa os dados específicos do usuário logado
function initApp() {
  // Ajusta a data padrão para o dia atual local
  const today = new Date().toISOString().split('T')[0];
  document.getElementById("closing-date").value = today;

  // Carrega o nome da loja padrão do usuário logado do LocalStorage
  const savedStoreName = localStorage.getItem(`gastrofecho_store_name_${currentUser}`);
  document.getElementById("store-name").value = savedStoreName || "";

  // Carrega o nome do responsável padrão do usuário logado do LocalStorage
  const savedOperatorName = localStorage.getItem(`gastrofecho_operator_name_${currentUser}`);
  document.getElementById("operator-name").value = savedOperatorName || "";

  // Carrega os dados salvos do usuário
  loadDataFromStorage();

  // Limpa e Inicializa a primeira linha de vale e despesa para encorajar a entrada
  document.getElementById("vales-list-container").innerHTML = "";
  document.getElementById("expense-list-container").innerHTML = "";
  addValeRow();
  addGeneralExpenseRow();

  // Inicialização do Formulário Bancário
  const bankClosingDate = document.getElementById("bank-closing-date");
  if (bankClosingDate) {
    bankClosingDate.value = today;
  }
  const bankOperatorName = document.getElementById("bank-operator-name");
  if (bankOperatorName) {
    bankOperatorName.value = savedOperatorName || "";
  }

  const bankInflows = document.getElementById("bank-inflows-container");
  const bankOutflows = document.getElementById("bank-outflows-container");
  if (bankInflows && bankOutflows) {
    bankInflows.innerHTML = "";
    bankOutflows.innerHTML = "";
    addBankInflowRow();
    addBankOutflowRow();
  }

  // Renderiza o Dashboard com dados vazios (ou histórico geral se houver)
  updateGlobalDashboard();
  
  // Renderiza tabelas se necessário
  const historyContainer = document.getElementById("today-history-container");
  if (historyContainer && historyContainer.style.display !== "none") {
    loadHistoryTable();
  }

  const bankPanel = document.getElementById("panel-bank");
  if (bankPanel && bankPanel.style.display !== "none") {
    loadBankHistoryTable();
  }
  
  loadUserContactInfo();
  
  lucide.createIcons();
}

// Alterna abas na tela de Login/Cadastro/Recuperação
function switchAuthTab(tab) {
  const tabLogin = document.getElementById("tab-login");
  const tabRegister = document.getElementById("tab-register");
  const formLogin = document.getElementById("login-form");
  const formRegister = document.getElementById("register-form");
  const formForgot = document.getElementById("forgot-password-form");

  if (tab === "login") {
    tabLogin.style.display = "block";
    tabRegister.style.display = "block";
    tabLogin.classList.add("active");
    tabRegister.classList.remove("active");
    formLogin.style.display = "block";
    formRegister.style.display = "none";
    formForgot.style.display = "none";
  } else if (tab === "register") {
    tabLogin.style.display = "block";
    tabRegister.style.display = "block";
    tabLogin.classList.remove("active");
    tabRegister.classList.add("active");
    formLogin.style.display = "none";
    formRegister.style.display = "block";
    formForgot.style.display = "none";
  } else if (tab === "forgot") {
    tabLogin.style.display = "none";
    tabRegister.style.display = "none";
    formLogin.style.display = "none";
    formRegister.style.display = "none";
    formForgot.style.display = "block";
  }
}

// Abre formulário de esqueci minha senha
function showForgotPasswordForm() {
  switchAuthTab("forgot");
}

// Registrar Novo Usuário na KV Store Cloud (KVdb.io)
async function registerUser(event) {
  event.preventDefault();
  const storeInput = document.getElementById("register-store").value.trim();
  const emailInput = document.getElementById("register-email").value.trim().toLowerCase();
  const usernameInput = document.getElementById("register-username").value.trim().toLowerCase(); // Telefone (Normalizado em minúsculas)
  const passwordInput = document.getElementById("register-password").value;
  const confirmPasswordInput = document.getElementById("register-confirm-password").value;
  const adminPasswordInput = document.getElementById("register-admin-password").value.trim();

  if (!storeInput || !emailInput || !usernameInput || !passwordInput || !confirmPasswordInput || !adminPasswordInput) {
    alert("Por favor, preencha todos os campos.");
    return;
  }

  if (passwordInput !== confirmPasswordInput) {
    alert("As senhas digitadas não coincidem. Por favor, verifique.");
    return;
  }

  try {
    // Bloqueia registros se o modo de manutenção estiver ativo
    const isMaintenance = await dbGetMaintenanceMode();
    if (isMaintenance) {
      alert("⚠️ O sistema está temporariamente em modo de manutenção. O cadastro de novos operadores está bloqueado no momento.");
      return;
    }
    // 1. Validar e-mail do mestre
    if (emailInput === "lucas_simoes_araujo@hotmail.com" || emailInput === "lucas_simoes_araujo_g@hotmail.com") {
      alert("Este e-mail é reservado exclusivamente para o Administrador Mestre.");
      return;
    }

    // Exibe um feedback visual de carregamento
    const registerBtn = event.target.querySelector("button[type='submit']");
    const originalBtnText = registerBtn.innerHTML;
    registerBtn.disabled = true;
    registerBtn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Criando conta...`;
    lucide.createIcons();

    // 2. Busca lista de usuários na nuvem
    const users = await dbGetUsers();

    // 3. Validar telefone/username único
    const phoneExists = users.some(u => u.username.toLowerCase() === usernameInput);
    if (phoneExists) {
      alert("Este número de telefone (usuário de acesso) já está cadastrado. Por favor, utilize outro.");
      registerBtn.disabled = false;
      registerBtn.innerHTML = originalBtnText;
      lucide.createIcons();
      return;
    }

    // 4. Validar e-mail único
    const emailExists = users.some(u => u.email && u.email.toLowerCase() === emailInput);
    if (emailExists) {
      alert("Este e-mail já está cadastrado por outro usuário. Por favor, utilize outro.");
      registerBtn.disabled = false;
      registerBtn.innerHTML = originalBtnText;
      lucide.createIcons();
      return;
    }

    // 5. Validar nome da loja único
    const storeExists = users.some(u => u.storeName && u.storeName.trim().toLowerCase() === storeInput.toLowerCase());
    if (storeExists) {
      alert("Este nome de loja já está cadastrado. Por favor, insira um nome diferente para sua loja.");
      registerBtn.disabled = false;
      registerBtn.innerHTML = originalBtnText;
      lucide.createIcons();
      return;
    }

    // 6. Insere e salva na nuvem
    const now = new Date();
    const newUser = {
      username: usernameInput,
      password: passwordInput,
      adminPassword: adminPasswordInput,
      storeName: storeInput,
      email: emailInput,
      createdAt: now.toISOString(),
      trialUntil: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      creditsUntil: "",
      isVip: false
    };
    
    users.push(newUser);
    await dbSetUsers(users);

    // Salva o nome padrão da loja localmente como fallback rápido
    localStorage.setItem(`gastrofecho_store_name_${usernameInput}`, storeInput);

    // Loga automaticamente
    sessionStorage.setItem("gastrofecho_logged_user", usernameInput);
    document.getElementById("register-form").reset();
    
    registerBtn.disabled = false;
    registerBtn.innerHTML = originalBtnText;
    
    checkAuth();
    alert("Conta criada com sucesso! Seja bem-vindo ao Fechou!");
  } catch (error) {
    console.error("Erro ao registrar usuário no KVdb:", error);
    alert("Ocorreu um erro ao criar sua conta. Por favor, verifique sua conexão e tente novamente.");
    const registerBtn = event.target.querySelector("button[type='submit']");
    registerBtn.disabled = false;
    registerBtn.innerHTML = `Criar Conta`;
    lucide.createIcons();
  }
}

// Efetuar Login usando KV Store Cloud (KVdb.io)
async function loginUser(event) {
  event.preventDefault();
  const usernameInput = document.getElementById("login-username").value.trim().toLowerCase();
  const passwordInput = document.getElementById("login-password").value;

  // Intercepta Acesso Mestre com as credenciais solicitadas (com e sem o sufixo _g)
  if (usernameInput === "lucas_simoes_araujo@hotmail.com" || usernameInput === "lucas_simoes_araujo_g@hotmail.com") {
    if (passwordInput === "Tr!color633") {
      sessionStorage.setItem("gastrofecho_logged_user", "mestre");
      document.getElementById("login-form").reset();
      checkAuth();
      return;
    } else {
      alert("Senha incorreta.");
      return;
    }
  }

  try {
    // Bloqueia login de operadores se o modo de manutenção estiver ativo
    const isMaintenance = await dbGetMaintenanceMode();
    if (isMaintenance) {
      alert("⚠️ O sistema está em manutenção programada e temporariamente indisponível para operadores.");
      return;
    }
    // Feedback visual de carregamento
    const loginBtn = event.target.querySelector("button[type='submit']");
    const originalBtnText = loginBtn.innerHTML;
    loginBtn.disabled = true;
    loginBtn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Entrando...`;
    lucide.createIcons();

    // 1. Busca lista de usuários na nuvem
    const users = await dbGetUsers();

    // 2. Verificar se o usuário existe (Busca case-insensitive tolerante)
    const userData = users.find(u => u.username.toLowerCase() === usernameInput);
    if (!userData) {
      alert("Usuário inexistente.");
      loginBtn.disabled = false;
      loginBtn.innerHTML = originalBtnText;
      lucide.createIcons();
      return;
    }

    // 3. Verificar se a senha está correta
    if (userData.password !== passwordInput) {
      alert("Senha incorreta.");
      loginBtn.disabled = false;
      loginBtn.innerHTML = originalBtnText;
      lucide.createIcons();
      return;
    }

    // Sincroniza nome da loja localmente caso não exista ou tenha mudado
    if (userData.storeName) {
      localStorage.setItem(`gastrofecho_store_name_${usernameInput}`, userData.storeName);
    }

    // Define sessão logada (sempre normalizada em minúsculas)
    sessionStorage.setItem("gastrofecho_logged_user", usernameInput);
    document.getElementById("login-form").reset();
    
    loginBtn.disabled = false;
    loginBtn.innerHTML = originalBtnText;

    checkAuth();
  } catch (error) {
    console.error("Erro ao realizar login no KVdb:", error);
    alert("Erro de conexão ao validar usuário. Verifique sua conexão com a internet.");
    const loginBtn = event.target.querySelector("button[type='submit']");
    loginBtn.disabled = false;
    loginBtn.innerHTML = `Entrar no App`;
    lucide.createIcons();
  }
}

// Solicitar Recuperação de Senha via Upstash para o Administrador Mestre
async function requestPasswordRecovery(event) {
  event.preventDefault();
  const usernameInput = document.getElementById("recovery-username").value.trim().toLowerCase();
  const emailInput = document.getElementById("recovery-email").value.trim().toLowerCase();

  if (!usernameInput || !emailInput) {
    alert("Por favor, preencha todos os campos.");
    return;
  }

  const submitBtn = event.target.querySelector("button[type='submit']");
  const originalBtnText = submitBtn.innerHTML;

  try {
    // Feedback visual
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Verificando dados...`;
    lucide.createIcons();

    // 1. Busca os usuários para validar se telefone e e-mail batem
    const users = await dbGetUsers();
    const user = users.find(u => u.username.toLowerCase() === usernameInput && u.email && u.email.toLowerCase() === emailInput);
    if (!user) {
      alert("Operador não encontrado. Por favor, verifique se o telefone e o e-mail informados estão corretos.");
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnText;
      lucide.createIcons();
      return;
    }

    // 2. Se bateu, adiciona a solicitação na nuvem
    const rawRequests = await redisCmd("GET", "fechou:recovery_requests");
    const requests = rawRequests ? JSON.parse(rawRequests) : [];

    // Evita duplicatas pendentes
    const exists = requests.some(r => r.username.toLowerCase() === usernameInput);
    if (!exists) {
      requests.push({
        username: usernameInput,
        storeName: user.storeName || "",
        email: emailInput,
        createdAt: new Date().toISOString()
      });
      await redisCmd("SET", "fechou:recovery_requests", JSON.stringify(requests));
    }

    // 3. Dispara e-mail de alerta para o Administrador Mestre via FormSubmit API (silencioso e grátis)
    try {
      fetch("https://formsubmit.co/ajax/lucas_simoes_araujo@hotmail.com", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          _subject: `🔑 Fechou! - Solicitação de Senha [${user.storeName || usernameInput}]`,
          "Nome da Loja": user.storeName || "Não informada",
          "Operador (Telefone)": usernameInput,
          "E-mail do Operador": emailInput,
          "Data do Pedido": new Date().toLocaleString('pt-BR'),
          "Mensagem": `O operador ${user.storeName || usernameInput} (${usernameInput}) solicitou a recuperação de suas credenciais de acesso no Fechou!. Acesse o Painel Mestre para visualizar e enviar as credenciais via WhatsApp.`,
          _template: "table"
        })
      });
    } catch (e) {
      console.warn("Erro ao disparar e-mail de aviso administrativo:", e);
    }

    alert("Solicitação enviada com sucesso! O Administrador Mestre foi notificado e entrará em contato para passar a senha.");
    
    // Reseta form e volta para login
    document.getElementById("forgot-password-form").reset();
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalBtnText;
    switchAuthTab('login');
  } catch (error) {
    console.error("Erro ao solicitar recuperação no KVdb:", error);
    alert("Erro de conexão ao enviar solicitação. Verifique sua conexão com a internet.");
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalBtnText;
    lucide.createIcons();
  }
}

// Alternar visibilidade da senha no formulário de login
function toggleLoginPassword() {
  const passwordInput = document.getElementById("login-password");
  const toggleBtn = document.getElementById("toggle-login-password-btn");
  
  if (passwordInput.type === "password") {
    passwordInput.type = "text";
    toggleBtn.innerHTML = `<i data-lucide="eye-off" style="width: 16px; height: 16px;"></i>`;
  } else {
    passwordInput.type = "password";
    toggleBtn.innerHTML = `<i data-lucide="eye" style="width: 16px; height: 16px;"></i>`;
  }
  
  // Recarrega o ícone Lucide
  lucide.createIcons();
}

// Encerrar Sessão (Logout)
function logoutUser(force = false) {
  try {
    if (!force) {
      const confirmLogout = confirm("Deseja realmente encerrar sua sessão no Fechou!?");
      if (!confirmLogout) return;
    }

    // Se estiver em modo auditoria, sai do modo antes de deslogar
    if (isAuditMode) {
      exitAuditMode();
    }

    sessionStorage.removeItem("gastrofecho_logged_user");
    currentUser = null;
    
    // Limpa dados temporários na tela
    try {
      resetForm();
      try {
        resetBankForm();
      } catch (errBank) {
        console.warn("Erro ao resetar form bancário no logout:", errBank);
      }
    } catch (e) {
      console.warn("Erro ao limpar formulário no logout:", e);
    }
    
    // Redireciona para login
    checkAuth();
  } catch (err) {
    console.error("Erro crítico no logout:", err);
    // Failsafe absoluto: garante que remove a sessão e recarrega
    sessionStorage.removeItem("gastrofecho_logged_user");
    window.location.reload();
  }
}

// Relógio do Cabeçalho
function updateClock() {
  const now = new Date();
  const options = { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit' 
  };
  document.getElementById("current-time").textContent = now.toLocaleDateString('pt-BR', options);
}

// Manipulação do LocalStorage
// Migração de dados locais (LocalStorage) para a Cloud KVdb.io (Sincronização Híbrida)
async function migrateLocalDataToCloud() {
  if (!currentUser || currentUser === "mestre") return;
  const stored = localStorage.getItem(`gastrofecho_closings_${currentUser}`);
  if (stored) {
    try {
      const localClosings = JSON.parse(stored);
      if (Array.isArray(localClosings) && localClosings.length > 0) {
        console.log(`[Migrador] Detectados ${localClosings.length} fechamentos locais. Migrando para o KVdb...`);
        
        // Carrega fechamentos existentes da nuvem se houverem
        const cloudClosings = await dbGetClosings(currentUser);
        
        // Mescla evitando duplicados
        localClosings.forEach(localDay => {
          const exists = cloudClosings.some(c => c.date === localDay.date);
          if (!exists) {
            cloudClosings.push({
              userId: currentUser,
              date: localDay.date,
              storeName: localDay.storeName || "",
              operatorName: localDay.operatorName || "",
              revenues: localDay.revenues || {},
              expenses: localDay.expenses || [],
              notes: localDay.notes || "",
              createdAt: new Date().toISOString()
            });
          }
        });
        
        await dbSetClosings(currentUser, cloudClosings);
        console.log("[Migrador] Migração concluída com sucesso!");
      }
    } catch (e) {
      console.error("[Migrador] Erro ao migrar dados locais:", e);
    } finally {
      // Limpa os dados locais para evitar duplicidade ou re-migração futura
      localStorage.removeItem(`gastrofecho_closings_${currentUser}`);
    }
  }
}

// Manipulação do KVdb.io para carregar dados
async function loadDataFromStorage() {
  if (!currentUser) return;
  
  // Se for mestre, a lógica de auditoria cuidará de puxar todos os dados sob demanda
  if (currentUser === "mestre") return;

  try {
    // 1. Executa migração se houver dados antigos locais
    await migrateLocalDataToCloud();

    // Exibe Shimmer / Loader premium no histórico e dashboards
    const tbody = document.getElementById("history-table-body");
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 30px; color: var(--text-secondary);"><i data-lucide="loader-2" class="spin" style="width: 24px; height: 24px; margin-right: 8px; vertical-align: middle;"></i> Sincronizando com a nuvem...</td></tr>`;
      lucide.createIcons();
    }

    // 2. Busca dados de Fechamento da nuvem
    closingsData = await dbGetClosings(currentUser);

    // Compatibilidade retroativa: garante que todos os fechamentos têm a propriedade shift
    closingsData.forEach(c => {
      if (!c.shift) {
        c.shift = "dia";
      }
    });

    // Ordena por data decrescente
    closingsData.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Busca dados de Fechamento Bancário da nuvem
    try {
      bankClosingsData = await dbGetBankClosings(currentUser);
      bankClosingsData.forEach(c => {
        if (!c.shift) {
          c.shift = "dia";
        }
      });
      bankClosingsData.sort((a, b) => new Date(b.date) - new Date(a.date));
    } catch (e) {
      console.warn("Erro ao carregar fechamentos bancários:", e);
      bankClosingsData = [];
    }

    // 3. Atualiza Dashboards globais e tabelas com os novos dados
    updateGlobalDashboard();
    
    const historyContainer = document.getElementById("today-history-container");
    if (historyContainer && historyContainer.style.display !== "none") {
      loadHistoryTable();
    }

    const bankPanel = document.getElementById("panel-bank");
    if (bankPanel && bankPanel.style.display !== "none") {
      loadBankHistoryTable();
    }
    
    // Atualiza fechamento mensal se estiver ativo
    const monthlyPanel = document.getElementById("panel-monthly");
    if (monthlyPanel && monthlyPanel.style.display !== "none") {
      loadMonthlyClosingReport();
    }
  } catch (error) {
    console.error("Erro ao carregar dados do KVdb:", error);
  }
}

// Grava um único fechamento no Firebase Firestore
async function saveDataToStorage(singleClosing = null, originalShift = null) {
  if (!currentUser || currentUser === "mestre") return;

  try {
    if (singleClosing) {
      // 1. Carrega todos os fechamentos atuais deste usuário
      const closings = await dbGetClosings(currentUser);
      
      const updatedClosing = {
        userId: currentUser,
        date: singleClosing.date,
        shift: singleClosing.shift || "dia",
        storeName: singleClosing.storeName,
        operatorName: singleClosing.operatorName,
        revenues: singleClosing.revenues,
        expenses: singleClosing.expenses,
        notes: singleClosing.notes,
        updatedAt: new Date().toISOString()
      };

      // Usa originalShift se passado (por ex. ao editar/mudar turno) ou o próprio turno do registro
      const searchShift = originalShift || singleClosing.shift || "dia";

      // 2. Insere ou substitui na lista
      const existsIndex = closings.findIndex(c => c.date === singleClosing.date && (c.shift || "dia") === searchShift);
      if (existsIndex !== -1) {
        closings[existsIndex] = updatedClosing;
      } else {
        closings.push(updatedClosing);
      }

      // 3. Salva a lista de volta na nuvem
      await dbSetClosings(currentUser, closings);

      // Adiciona na memória RAM da página para resposta imediata
      const ramIndex = closingsData.findIndex(c => c.date === singleClosing.date && (c.shift || "dia") === searchShift);
      if (ramIndex !== -1) {
        closingsData[ramIndex] = updatedClosing;
      } else {
        closingsData.push(updatedClosing);
      }
    } else {
      // Gravação completa da RAM
      await dbSetClosings(currentUser, closingsData);
    }

    // Ordena por data decrescente
    closingsData.sort((a, b) => new Date(b.date) - new Date(a.date));
  } catch (error) {
    console.error("Erro ao gravar dados no KVdb:", error);
    alert("Houve um erro ao sincronizar com o banco de dados em nuvem. Os dados podem não ter sido salvos globalmente.");
  }
}

// Salvar nome da loja no KVdb e LocalStorage
async function saveStoreNameLocal() {
  if (!currentUser || currentUser === "mestre") return;
  const value = document.getElementById("store-name").value.trim();
  
  // Salva no localStorage como cache rápido
  localStorage.setItem(`gastrofecho_store_name_${currentUser}`, value);
  
  // Atualiza o crachá superior em tempo real
  document.getElementById("user-display-name").textContent = value || currentUser;
  const subtitleEl = document.getElementById("header-store-subtitle");
  if (subtitleEl) {
    subtitleEl.textContent = value || `Operador: ${currentUser}`;
  }
  const sidebarTitleEl = document.getElementById("sidebar-store-title");
  if (sidebarTitleEl) {
    sidebarTitleEl.textContent = value || currentUser;
  }

  try {
    // Atualiza no documento do usuário na nuvem
    const users = await dbGetUsers();
    const user = users.find(u => u.username === currentUser);
    if (user) {
      user.storeName = value;
      await dbSetUsers(users);
    }
  } catch (e) {
    console.warn("Erro ao sincronizar nome da loja na nuvem:", e);
  }
}

// Salvar nome do responsável no LocalStorage e KVdb
async function saveOperatorNameLocal() {
  if (!currentUser || currentUser === "mestre") return;
  const value = document.getElementById("operator-name").value.trim();
  
  // Salva no localStorage como cache rápido
  localStorage.setItem(`gastrofecho_operator_name_${currentUser}`, value);

  try {
    // Atualiza no documento do usuário na nuvem
    const users = await dbGetUsers();
    const user = users.find(u => u.username === currentUser);
    if (user) {
      user.operatorName = value;
      await dbSetUsers(users);
    }
  } catch (e) {
    console.warn("Erro ao sincronizar nome do responsável na nuvem:", e);
  }
}

// Alternar Abas (Tabs) de Navegação
function switchTab(clickedTab) {
  // Fecha o menu lateral no mobile se estiver aberto
  closeSidebarMenu();

  // Remove classe active de todos os itens de menu
  document.querySelectorAll(".nav-item").forEach(item => {
    item.classList.remove("active");
  });
  
  // Adiciona class active no clicado
  clickedTab.classList.add("active");

  // Suporte de rolagem para navegação móvel em pills (mantém o item ativo centralizado)
  try {
    clickedTab.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  } catch (err) {
    // Fallback silencioso caso não suportado
  }
  
  // Oculta todas as abas
  document.querySelectorAll(".tab-panel").forEach(panel => {
    panel.style.display = "none";
    panel.classList.remove("active");
  });
  
  // Exibe o painel de destino
  const targetId = clickedTab.getAttribute("data-target");
  const targetPanel = document.getElementById(targetId);
  targetPanel.style.display = "block";
  setTimeout(() => targetPanel.classList.add("active"), 50);

  // Ações adicionais ao abrir cada aba
  if (targetId === "panel-monthly") {
    initMonthlyClosingDates();
  } else if (targetId === "panel-today") {
    updateLiveDashboard();
    loadHistoryTable();
  } else if (targetId === "panel-bank") {
    loadBankHistoryTable();
  } else if (targetId === "panel-subscription") {
    updateSubscriptionTabUI();
  }
  
  lucide.createIcons();
}

// Formatação Monetária Acessível
function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value);
}

// --- CONTROLE DE DESPESAS DINÂMICAS ---
function addValeRow(employeeName = "", value = "", containerId = "vales-list-container") {
  const container = document.getElementById(containerId);
  const rowId = `vale-row-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const row = document.createElement("div");
  row.className = "expense-row";
  row.id = rowId;

  // Alinha perfeitamente com o construtor de despesas gerais usando as mesmas 5 colunas do grid
  row.innerHTML = `
    <div class="input-container">
      <label style="font-size: 11px;">Nome do Funcionário</label>
      <input type="text" class="form-control vale-desc" placeholder="Ex: João (Adiantamento)" value="${employeeName}" required>
    </div>
    <div class="input-container">
      <label style="font-size: 11px;">Valor do Vale</label>
      <div class="input-wrapper">
        <span class="input-prefix" style="left: 8px;">R$</span>
        <input type="number" step="0.01" min="0.01" class="form-control vale-val form-control-prefix" style="padding-left: 28px;" placeholder="0,00" value="${value}" oninput="updateLiveDashboard()" required>
      </div>
    </div>
    <div class="input-container desktop-only-spacer" style="grid-column: span 2;">
      <!-- Espaçador para alinhamento estético perfeito no desktop -->
    </div>
    <button type="button" class="btn-icon-danger" onclick="removeExpenseRow('${rowId}')" title="Excluir vale" style="margin-bottom: 0; align-self: flex-end; height: 42px;">
      <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
    </button>
  `;

  container.appendChild(row);
  lucide.createIcons();
  disableOperatorInputs(isLicenseExpired);
}

function addGeneralExpenseRow(description = "", value = "", category = "alimentos", containerId = "expense-list-container", photo = "") {
  const container = document.getElementById(containerId);
  const rowId = `expense-row-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const row = document.createElement("div");
  row.className = "expense-row";
  row.id = rowId;
  if (photo) {
    row.dataset.photo = photo;
  }

  // Categorias: Carne, Alimentos em Geral, Limpeza, Outros
  row.innerHTML = `
    <div class="input-container">
      <label style="font-size: 11px;">Descrição da Despesa</label>
      <input type="text" class="form-control expense-desc" placeholder="Ex: Pão de Hambúrguer" value="${description}" required>
    </div>
    <div class="input-container">
      <label style="font-size: 11px;">Valor (R$)</label>
      <div class="input-wrapper">
        <span class="input-prefix" style="left: 8px;">R$</span>
        <input type="number" step="0.01" min="0.01" class="form-control expense-val form-control-prefix" style="padding-left: 28px;" placeholder="0,00" value="${value}" oninput="updateLiveDashboard()" required>
      </div>
    </div>
    <div class="input-container">
      <label style="font-size: 11px;">Categoria</label>
      <select class="form-control expense-cat">
        <option value="carne" ${category === 'carne' ? 'selected' : ''}>Carne</option>
        <option value="alimentos" ${category === 'alimentos' ? 'selected' : ''}>Alimentos em Geral</option>
        <option value="limpeza" ${category === 'limpeza' ? 'selected' : ''}>Limpeza</option>
        <option value="outros" ${category === 'outros' ? 'selected' : ''}>Outros</option>
      </select>
    </div>
    <div class="input-container" style="display: flex; align-items: flex-end; justify-content: center; height: 100%;">
      <button type="button" class="btn-expense-photo" onclick="triggerExpensePhotoUpload('${rowId}')" title="Anexar Foto da Nota" style="width: 42px; height: 42px; padding: 0; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-md); border: 1px solid var(--border-glass); background: rgba(255, 255, 255, 0.05); color: var(--text-main); cursor: pointer; transition: var(--transition-smooth); margin-bottom: 0;">
        <i data-lucide="camera" style="width: 16px; height: 16px;"></i>
      </button>
      <input type="file" id="file-${rowId}" accept="image/*" style="display: none;" onchange="handleExpensePhoto(this, '${rowId}')">
    </div>
    <button type="button" class="btn-icon-danger" onclick="removeExpenseRow('${rowId}')" title="Excluir despesa" style="margin-bottom: 0; align-self: flex-end; height: 42px;">
      <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
    </button>
  `;

  container.appendChild(row);
  if (photo) {
    updateExpenseRowPhotoUI(rowId, photo);
  }
  lucide.createIcons();
  disableOperatorInputs(isLicenseExpired);
}

// Mantém suporte para chamadas legadas
function addExpenseRow(description = "", value = "", category = "alimentos", containerId = "expense-list-container") {
  if (category === "vales") {
    // Redireciona para o setor correto se for um vale
    const correctContainer = containerId === "edit-expense-list-container" ? "edit-vales-list-container" : "vales-list-container";
    addValeRow(description, value, correctContainer);
  } else {
    addGeneralExpenseRow(description, value, category, containerId);
  }
}

// Compressão, Upload e Preview de Imagens de Despesas
function triggerExpensePhotoUpload(rowId) {
  const row = document.getElementById(rowId);
  if (!row) return;

  if (row.dataset.photo) {
    previewExpensePhoto(rowId);
  } else {
    const fileInput = document.getElementById(`file-${rowId}`);
    if (fileInput) fileInput.click();
  }
}

function handleExpensePhoto(input, rowId) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      // Compactação em Canvas no client-side para evitar estourar o limite da nuvem
      const canvas = document.createElement("canvas");
      let width = img.width;
      let height = img.height;
      const MAX_SIZE = 800; // Limite de 800px para manter altíssima nitidez e peso baixíssimo (30KB)

      if (width > height) {
        if (width > MAX_SIZE) {
          height = Math.round((height * MAX_SIZE) / width);
          width = MAX_SIZE;
        }
      } else {
        if (height > MAX_SIZE) {
          width = Math.round((width * MAX_SIZE) / height);
          height = MAX_SIZE;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      // Converte para jpeg compactado (qualidade 0.7)
      const compressedDataUrl = canvas.toDataURL("image/jpeg", 0.7);

      const row = document.getElementById(rowId);
      if (row) {
        row.dataset.photo = compressedDataUrl;
        updateExpenseRowPhotoUI(rowId, compressedDataUrl);
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function updateExpenseRowPhotoUI(rowId, dataUrl) {
  const row = document.getElementById(rowId);
  if (!row) return;

  const btn = row.querySelector(".btn-expense-photo");
  if (!btn) return;

  if (dataUrl) {
    btn.innerHTML = `<img src="${dataUrl}" style="width: 100%; height: 100%; object-fit: cover; border-radius: var(--radius-sm); border: 1px solid var(--border-glass);">`;
    btn.title = "Visualizar / Alterar Foto da Nota";
    row.dataset.photo = dataUrl;
  } else {
    btn.innerHTML = `<i data-lucide="camera" style="width: 16px; height: 16px;"></i>`;
    btn.title = "Anexar Foto da Nota";
    row.removeAttribute("data-photo");
    lucide.createIcons();
  }
}

function previewExpensePhoto(rowId) {
  const row = document.getElementById(rowId);
  if (!row || !row.dataset.photo) return;

  let previewModal = document.getElementById("modal-photo-preview");
  if (!previewModal) {
    previewModal = document.createElement("div");
    previewModal.id = "modal-photo-preview";
    previewModal.className = "modal-overlay";
    previewModal.style.zIndex = "999999";
    previewModal.innerHTML = `
      <div class="modal-box" style="max-width: 600px; padding: 20px;">
        <div class="modal-header">
          <h3>Comprovante da Despesa</h3>
          <span class="modal-close" onclick="closeModal('modal-photo-preview')">&times;</span>
        </div>
        <div class="modal-body" style="display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 10px 0;">
          <img id="photo-preview-img" style="max-width: 100%; max-height: 70vh; border-radius: var(--radius-md); box-shadow: var(--shadow-premium);">
          <div style="display: flex; gap: 8px; width: 100%;">
            <button class="btn btn-secondary" onclick="closeModal('modal-photo-preview')" style="flex: 1;">Fechar</button>
            <button class="btn btn-danger" id="btn-delete-photo-preview" style="flex: 1;">Remover Foto</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(previewModal);
  }

  const img = previewModal.querySelector("#photo-preview-img");
  img.src = row.dataset.photo;

  const deleteBtn = previewModal.querySelector("#btn-delete-photo-preview");
  deleteBtn.onclick = function() {
    updateExpenseRowPhotoUI(rowId, "");
    closeModal("modal-photo-preview");
  };

  openModal("modal-photo-preview");
}

function previewDirectPhoto(dataUrl) {
  let previewModal = document.getElementById("modal-photo-direct-preview");
  if (!previewModal) {
    previewModal = document.createElement("div");
    previewModal.id = "modal-photo-direct-preview";
    previewModal.className = "modal-overlay";
    previewModal.style.zIndex = "999999";
    previewModal.innerHTML = `
      <div class="modal-box" style="max-width: 600px; padding: 20px;">
        <div class="modal-header">
          <h3>Comprovante da Despesa</h3>
          <span class="modal-close" onclick="closeModal('modal-photo-direct-preview')">&times;</span>
        </div>
        <div class="modal-body" style="display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 10px 0;">
          <img id="photo-direct-preview-img" style="max-width: 100%; max-height: 70vh; border-radius: var(--radius-md); box-shadow: var(--shadow-premium);">
          <button class="btn btn-secondary" onclick="closeModal('modal-photo-direct-preview')" style="width: 100%;">Fechar</button>
        </div>
      </div>
    `;
    document.body.appendChild(previewModal);
  }
  previewModal.querySelector("#photo-direct-preview-img").src = dataUrl;
  openModal("modal-photo-direct-preview");
}

function removeExpenseRow(rowId) {
  const row = document.getElementById(rowId);
  if (row) {
    row.classList.add("removing");
    setTimeout(() => {
      row.remove();
      updateLiveDashboard();
    }, 200);
  }
}

// --- ATUALIZAÇÃO REATIVA DO DASHBOARD DIÁRIO ---
function updateLiveDashboard() {
  // Coleta receitas
  const ifood = parseFloat(document.getElementById("rec-ifood").value) || 0;
  const r99 = parseFloat(document.getElementById("rec-99").value) || 0;
  const keeta = parseFloat(document.getElementById("rec-keeta").value) || 0;
  const pix = parseFloat(document.getElementById("rec-pix").value) || 0;
  const credit = parseFloat(document.getElementById("rec-credit").value) || 0;
  const debit = parseFloat(document.getElementById("rec-debit").value) || 0;
  const vr = parseFloat(document.getElementById("rec-vr").value) || 0;
  const cash = parseFloat(document.getElementById("rec-cash").value) || 0;

  const totalRevenue = ifood + r99 + keeta + pix + credit + debit + vr + cash;

  // Coleta despesas do builder
  let totalExpenses = 0;
  
  // 1. Vales
  const valeRows = document.querySelectorAll("#vales-list-container .expense-row");
  valeRows.forEach(row => {
    const valInput = row.querySelector(".vale-val");
    if (valInput) {
      totalExpenses += parseFloat(valInput.value) || 0;
    }
  });

  // 2. Despesas Gerais
  const expenseRows = document.querySelectorAll("#expense-list-container .expense-row");
  expenseRows.forEach(row => {
    const valInput = row.querySelector(".expense-val");
    if (valInput) {
      totalExpenses += parseFloat(valInput.value) || 0;
    }
  });

  const netProfit = totalRevenue - totalExpenses;

  // Atualiza os painéis do topo em tempo real
  document.getElementById("kpi-total-revenue").textContent = formatCurrency(totalRevenue);
  document.getElementById("kpi-total-expenses").textContent = formatCurrency(totalExpenses);
  document.getElementById("kpi-net-profit").textContent = formatCurrency(netProfit);

  // Status visual da Receita
  const revDesc = document.getElementById("kpi-revenue-desc");
  if (totalRevenue > 0) {
    revDesc.textContent = "Digitando faturamento...";
  } else {
    revDesc.textContent = "Sem lançamentos";
  }

  // Status visual de Despesas
  const expDesc = document.getElementById("kpi-expense-desc");
  const totalItems = valeRows.length + expenseRows.length;
  if (totalExpenses > 0) {
    expDesc.textContent = `${totalItems} item(ns) inserido(s)`;
  } else {
    expDesc.textContent = "Sem saídas";
  }

  // Status visual do Saldo Líquido
  const profitStatus = document.getElementById("kpi-profit-status");
  const profitDesc = document.getElementById("kpi-profit-desc");
  const profitCard = document.querySelector(".kpi-profit");

  profitStatus.className = "kpi-status";
  
  if (netProfit > 0) {
    profitStatus.classList.add("status-positive");
    profitStatus.innerHTML = `<i data-lucide="trending-up" style="width:12px;height:12px"></i> <span>Lucro Diário</span>`;
    profitDesc.textContent = "Saldo positivo";
  } else if (netProfit < 0) {
    profitStatus.classList.add("status-negative");
    profitStatus.innerHTML = `<i data-lucide="trending-down" style="width:12px;height:12px"></i> <span>Prejuízo Diário</span>`;
    profitDesc.textContent = "Caixa em déficit";
  } else {
    profitStatus.classList.add("status-neutral");
    profitStatus.innerHTML = `<i data-lucide="minus" style="width:12px;height:12px"></i> <span>Equilibrado</span>`;
    profitDesc.textContent = "Neutro";
  }

  lucide.createIcons();
}

// Painel global (quando carrega a página e mostra dados históricos agregados se formulário estiver vazio)
function updateGlobalDashboard() {
  if (closingsData.length === 0) {
    // Zera tudo
    document.getElementById("kpi-total-revenue").textContent = formatCurrency(0);
    document.getElementById("kpi-total-expenses").textContent = formatCurrency(0);
    document.getElementById("kpi-net-profit").textContent = formatCurrency(0);
    document.getElementById("kpi-revenue-desc").textContent = "Sem dados salvos";
    document.getElementById("kpi-expense-desc").textContent = "Sem dados salvos";
    document.getElementById("kpi-profit-desc").textContent = "Sem dados salvos";
    return;
  }

  // Se houver dados salvos, exibe o resumo histórico do mês/geral nos KPIs iniciais para motivar o usuário
  let sumRevenue = 0;
  let sumExpense = 0;

  closingsData.forEach(day => {
    let rev = 0;
    Object.keys(day.revenues).forEach(k => rev += day.revenues[k]);
    let exp = 0;
    day.expenses.forEach(e => exp += e.value);

    sumRevenue += rev;
    sumExpense += exp;
  });

  const net = sumRevenue - sumExpense;

  document.getElementById("kpi-total-revenue").textContent = formatCurrency(sumRevenue);
  document.getElementById("kpi-total-expenses").textContent = formatCurrency(sumExpense);
  document.getElementById("kpi-net-profit").textContent = formatCurrency(net);

  document.getElementById("kpi-revenue-desc").textContent = `Total de ${closingsData.length} dias fechados`;
  document.getElementById("kpi-expense-desc").textContent = "Soma histórica";
  
  const profitStatus = document.getElementById("kpi-profit-status");
  const profitDesc = document.getElementById("kpi-profit-desc");

  profitStatus.className = "kpi-status";
  if (net > 0) {
    profitStatus.classList.add("status-positive");
    profitStatus.innerHTML = `<i data-lucide="trending-up" style="width:12px;height:12px"></i> <span>Superávit Geral</span>`;
    profitDesc.textContent = "Acumulado positivo";
  } else if (net < 0) {
    profitStatus.classList.add("status-negative");
    profitStatus.innerHTML = `<i data-lucide="trending-down" style="width:12px;height:12px"></i> <span>Déficit Geral</span>`;
    profitDesc.textContent = "Acumulado negativo";
  } else {
    profitStatus.classList.add("status-neutral");
    profitDesc.textContent = "Sem saldo líquido";
  }
  lucide.createIcons();
}

// --- SALVAR FECHAMENTO DO DIA ---
async function saveClosing(event) {
  event.preventDefault();

  // Verifica se a licença expirou
  if (isLicenseExpired && currentUser !== "mestre") {
    alert("⚠️ Licença Expirada: Seu aplicativo está em Modo Leitura. Para liberar a gravação de fechamentos, realize o pagamento de R$ 49,90 na aba 'Assinatura & Licença'.");
    return;
  }

  // Verifica modo de manutenção antes de salvar
  if (currentUser !== "mestre") {
    const isMaintenance = await dbGetMaintenanceMode();
    if (isMaintenance) {
      alert("⚠️ O sistema está em manutenção programada. Não é possível realizar lançamentos no momento.");
      logoutUser();
      return;
    }
  }

  const dateInput = document.getElementById("closing-date").value;
  if (!dateInput) {
    alert("Por favor, selecione uma data válida.");
    return;
  }

  const shiftInput = document.getElementById("closing-shift").value;

  // Verifica se já existe um fechamento para esta data E turno
  const dateExists = closingsData.findIndex(c => c.date === dateInput && (c.shift || "dia") === shiftInput);
  if (dateExists !== -1) {
    const shiftLabel = shiftInput === "dia" ? "Dia" : "Noite";
    const confirmOverwrite = confirm(`Já existe um fechamento salvo para o dia ${formatDate(dateInput)} no turno ${shiftLabel}. Deseja substituir os dados existentes?`);
    if (!confirmOverwrite) return;
  }

  // Feedback de salvamento no botão
  const saveBtn = event.target.querySelector("button[type='submit']");
  const originalText = saveBtn.innerHTML;
  saveBtn.disabled = true;
  saveBtn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Gravando na nuvem...`;
  lucide.createIcons();

  // Coleta Receitas
  const revenues = {
    ifood: parseFloat(document.getElementById("rec-ifood").value) || 0,
    99: parseFloat(document.getElementById("rec-99").value) || 0,
    keeta: parseFloat(document.getElementById("rec-keeta").value) || 0,
    pix: parseFloat(document.getElementById("rec-pix").value) || 0,
    credit: parseFloat(document.getElementById("rec-credit").value) || 0,
    debit: parseFloat(document.getElementById("rec-debit").value) || 0,
    vr: parseFloat(document.getElementById("rec-vr").value) || 0,
    cash: parseFloat(document.getElementById("rec-cash").value) || 0
  };

  // Coleta Despesas (Vales e Gerais juntas)
  const expenses = [];

  // 1. Coleta Vales de Funcionários
  const valeRows = document.querySelectorAll("#vales-list-container .expense-row");
  valeRows.forEach(row => {
    const employeeName = row.querySelector(".vale-desc").value.trim();
    const val = parseFloat(row.querySelector(".vale-val").value) || 0;

    if (employeeName && val > 0) {
      expenses.push({
        description: employeeName,
        value: val,
        category: "vales"
      });
    }
  });

  // 2. Coleta Despesas Gerais
  const expenseRows = document.querySelectorAll("#expense-list-container .expense-row");
  expenseRows.forEach(row => {
    const desc = row.querySelector(".expense-desc").value.trim();
    const val = parseFloat(row.querySelector(".expense-val").value) || 0;
    const cat = row.querySelector(".expense-cat").value;

    if (desc && val > 0) {
      expenses.push({
        description: desc,
        value: val,
        category: cat,
        photo: row.dataset.photo || ""
      });
    }
  });

  const storeNameInput = document.getElementById("store-name").value.trim();
  const operatorNameInput = document.getElementById("operator-name").value.trim();
  const notes = document.getElementById("closing-notes").value.trim();

  const newClosing = {
    date: dateInput,
    shift: shiftInput,
    storeName: storeNameInput,
    operatorName: operatorNameInput,
    revenues: revenues,
    expenses: expenses,
    notes: notes
  };

  // Grava de forma assíncrona no Upstash/RAM
  await saveDataToStorage(newClosing);
  
  // Pergunta se deseja enviar pelo WhatsApp antes de abrir
  const confirmWhatsApp = confirm("Deseja enviar o relatório de fechamento de caixa via WhatsApp?");
  if (confirmWhatsApp) {
    const waText = getFormattedWhatsAppText(newClosing);
    const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(waText)}`;
    window.open(waUrl, '_blank');
  }
  
  // Restaura o estado do botão
  saveBtn.disabled = false;
  saveBtn.innerHTML = originalText;

  // Limpa o formulário e abre o painel de detalhes do dia salvo na tela
  resetForm();
  updateGlobalDashboard();
  switchTodaySubTab('history');
  viewDetails(newClosing.date, newClosing.shift);
}

// Resetar o Formulário
function resetForm() {
  const currentStoreName = document.getElementById("store-name").value;
  const currentOperatorName = document.getElementById("operator-name").value;
  document.getElementById("closing-form").reset();
  
  // Mantém o nome da loja e responsável
  document.getElementById("store-name").value = currentStoreName;
  document.getElementById("operator-name").value = currentOperatorName;
  
  // Mantém a data de hoje por padrão
  const today = new Date().toISOString().split('T')[0];
  document.getElementById("closing-date").value = today;

  // Limpa as despesas gerais e cria uma em branco
  const container = document.getElementById("expense-list-container");
  container.innerHTML = "";
  addGeneralExpenseRow();

  // Limpa os vales de funcionários e cria um em branco
  const valesContainer = document.getElementById("vales-list-container");
  valesContainer.innerHTML = "";
  addValeRow();

  // Atualiza painel do formulário zerado
  updateLiveDashboard();
  disableOperatorInputs(isLicenseExpired);
}

// --- HISTÓRICO DE FECHAMENTOS (TABELA & FILTROS) ---
function formatDate(dateStr) {
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

function clearFilters() {
  document.getElementById("filter-start-date").value = "";
  document.getElementById("filter-end-date").value = "";
  document.getElementById("filter-search").value = "";
  loadHistoryTable();
}

function loadHistoryTable() {
  const startDate = document.getElementById("filter-start-date").value;
  const endDate = document.getElementById("filter-end-date").value;
  const search = document.getElementById("filter-search").value.toLowerCase();

  const filtered = closingsData.filter(day => {
    // Filtro de data inicial
    if (startDate && day.date < startDate) return false;
    // Filtro de data final
    if (endDate && day.date > endDate) return false;
    // Filtro de busca de texto nas observações e despesas
    if (search) {
      const matchNotes = day.notes.toLowerCase().includes(search);
      const matchExpense = day.expenses.some(e => e.description.toLowerCase().includes(search));
      if (!matchNotes && !matchExpense) return false;
    }
    return true;
  });

  const tbody = document.getElementById("history-table-body");
  const emptyState = document.getElementById("history-empty-state");
  const table = document.getElementById("history-table");
  const counter = document.getElementById("history-counter");

  tbody.innerHTML = "";
  counter.textContent = `${filtered.length} Fechamento(s)`;

  if (filtered.length === 0) {
    table.style.display = "none";
    emptyState.style.display = "block";
    return;
  }

  table.style.display = "table";
  emptyState.style.display = "none";

  filtered.forEach(day => {
    let revTotal = 0;
    Object.keys(day.revenues).forEach(k => revTotal += day.revenues[k]);
    
    let expTotal = 0;
    day.expenses.forEach(e => expTotal += e.value);

    const net = revTotal - expTotal;
    const netClass = net >= 0 ? "text-revenue bold" : "text-expense bold";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="bold">
        ${formatDate(day.date)}
        <span class="badge ${day.shift === 'noite' ? 'badge-expense' : 'badge-revenue'}" style="font-size: 10px; padding: 2px 6px; margin-left: 6px; vertical-align: middle;">
          ${day.shift === 'noite' ? '🌙 Noite' : '☀️ Dia'}
        </span>
      </td>
      <td class="text-revenue">${formatCurrency(revTotal)}</td>
      <td class="text-expense">${formatCurrency(expTotal)}</td>
      <td class="${netClass}">${formatCurrency(net)}</td>
      <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary);" title="${day.notes}">
        ${day.notes || '<span style="color: var(--text-muted); font-style: italic;">Sem observações</span>'}
      </td>
      <td class="table-actions">
        <button class="btn btn-secondary btn-sm" onclick="viewDetails('${day.date}', '${day.shift || 'dia'}')" title="Visualizar Completo">
          <i data-lucide="eye" style="width: 14px; height: 14px;"></i>
        </button>
        <button class="btn btn-success btn-sm" onclick="shareWhatsAppDirect('${day.date}', '${day.shift || 'dia'}')" title="Enviar via WhatsApp" style="background: rgba(37, 211, 102, 0.12); color: #25d366; border-color: rgba(37, 211, 102, 0.2);">
          <i data-lucide="message-square" style="width: 14px; height: 14px;"></i>
        </button>
        <button class="btn btn-success btn-sm" onclick="editClosing('${day.date}', '${day.shift || 'dia'}')" title="Editar Lançamento">
          <i data-lucide="edit-3" style="width: 14px; height: 14px;"></i>
        </button>
        <button class="btn btn-danger btn-sm" onclick="deleteClosing('${day.date}', '${day.shift || 'dia'}')" title="Excluir Lançamento">
          <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  lucide.createIcons();
  disableOperatorInputs(isLicenseExpired);
}

// Detalhes Completos (Modal de Visualização)
let currentViewDate = "";
let currentViewShift = "";
function viewDetails(dateStr, shiftStr = "dia") {
  const day = closingsData.find(c => c.date === dateStr && (c.shift || "dia") === shiftStr);
  if (!day) return;

  currentViewDate = dateStr;
  currentViewShift = shiftStr;
  
  const shiftLabel = shiftStr === "noite" ? "🌙 Noite" : "☀️ Dia";
  document.getElementById("modal-details-title").textContent = `Detalhamento de Caixa — ${formatDate(day.date)} [${shiftLabel}]`;

  let revTotal = 0;
  Object.keys(day.revenues).forEach(k => revTotal += day.revenues[k]);
  
  let expTotal = 0;
  day.expenses.forEach(e => expTotal += e.value);
  
  const net = revTotal - expTotal;
  const netBadge = net >= 0 ? "badge-revenue" : "badge-expense";

  let revenuesHtml = "";
  Object.keys(day.revenues).forEach(k => {
    if (day.revenues[k] > 0) {
      const channel = REVENUE_CHANNELS[k];
      const logoHtml = channel?.logo || "";
      revenuesHtml += `
        <li class="detail-item" style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
          <span style="display: flex; align-items: center; gap: 4px;">
            ${logoHtml}
            ${channel?.label || k}:
          </span>
          <span class="text-revenue">${formatCurrency(day.revenues[k])}</span>
        </li>
      `;
    }
  });
  if (!revenuesHtml) revenuesHtml = `<li style="font-style: italic; color: var(--text-muted); font-size:13px">Nenhuma receita registrada</li>`;

  let expensesHtml = "";
  day.expenses.forEach((e, idx) => {
    let photoIconHtml = "";
    if (e.photo) {
      photoIconHtml = `
        <button type="button" class="btn btn-secondary btn-xs" onclick="previewDirectPhoto('${e.photo.replace(/'/g, "\\'")}')" style="height: 24px; padding: 0 8px; margin-left: 6px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px; border-color: var(--border-glass);" title="Visualizar Nota Fiscal">
          <i data-lucide="image" style="width: 12px; height: 12px; color: var(--primary);"></i> Ver Nota
        </button>
      `;
    }
    expensesHtml += `
      <li class="detail-item" style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
        <span style="display: flex; align-items: center; flex-wrap: wrap; gap: 4px;">
          <span>${e.description} <small style="color:var(--text-muted)">(${EXPENSE_CATEGORIES[e.category] || e.category})</small></span>
          ${photoIconHtml}
        </span>
        <span class="text-expense">${formatCurrency(e.value)}</span>
      </li>
    `;
  });
  if (!expensesHtml) expensesHtml = `<li style="font-style: italic; color: var(--text-muted); font-size:13px">Nenhuma despesa registrada</li>`;

  const body = document.getElementById("modal-details-body");
  body.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-glass); border-radius: var(--radius-md); padding: 16px;">
      <div>
        <p style="font-size: 11px; text-transform: uppercase; color: var(--text-secondary);">Loja: ${day.storeName || 'Não informada'} | Responsável: ${day.operatorName || 'Não informado'} | Turno: ${shiftLabel}</p>
        <p style="font-size: 11px; text-transform: uppercase; color: var(--text-secondary); margin-top: 4px;">Saldo Final Líquido</p>
        <h2 style="font-family: var(--font-title); font-size: 26px; font-weight: 800; color: #fff;">${formatCurrency(net)}</h2>
      </div>
      <span class="badge ${netBadge}" style="padding: 6px 12px; font-size:12px">${net >= 0 ? 'Surplus de Caixa' : 'Déficit de Caixa'}</span>
    </div>

    <div class="detail-grid">
      <div class="detail-section">
        <h4><i data-lucide="arrow-up-right" class="text-revenue" style="width:16px;height:16px;vertical-align:middle;margin-right:6px"></i> Entradas / Receitas</h4>
        <ul class="detail-list">
          ${revenuesHtml}
          <li class="detail-item" style="border-top: 1px solid var(--border-glass); padding-top: 8px; margin-top: 8px; font-weight: 700;">
            <span>Total Receitado:</span>
            <span class="text-revenue">${formatCurrency(revTotal)}</span>
          </li>
        </ul>
      </div>

      <div class="detail-section">
        <h4><i data-lucide="arrow-down-left" class="text-expense" style="width:16px;height:16px;vertical-align:middle;margin-right:6px"></i> Saídas / Despesas</h4>
        <ul class="detail-list">
          ${expensesHtml}
          <li class="detail-item" style="border-top: 1px solid var(--border-glass); padding-top: 8px; margin-top: 8px; font-weight: 700;">
            <span>Total Despendido:</span>
            <span class="text-expense">${formatCurrency(expTotal)}</span>
          </li>
        </ul>
      </div>
    </div>

    <div class="detail-section" style="margin-top: 20px;">
      <h4><i data-lucide="file-text" style="width:16px;height:16px;vertical-align:middle;margin-right:6px"></i> Observações</h4>
      <p style="font-size: 13px; color: var(--text-secondary); line-height: 1.5; white-space: pre-line;">
        ${day.notes || '<span style="color: var(--text-muted); font-style: italic;">Nenhuma observação registrada para este dia.</span>'}
      </p>
    </div>
  `;

  openModal("modal-details");
  lucide.createIcons();
}

function printDetails() {
  window.print();
}

// Excluir Fechamento na nuvem (Upstash)
async function deleteClosing(dateStr, shiftStr = "dia") {
  // Verifica se a licença expirou
  if (isLicenseExpired && currentUser !== "mestre") {
    alert("⚠️ Licença Expirada: Seu aplicativo está em Modo Leitura. Para liberar a exclusão de fechamentos, realize o pagamento de R$ 49,90 na aba 'Assinatura & Licença'.");
    return;
  }

  const shiftLabel = shiftStr === "noite" ? "Noite" : "Dia";
  const inputPass = prompt(`Digite a Senha Administrativa para autorizar a EXCLUSÃO do fechamento do dia ${formatDate(dateStr)} (${shiftLabel}):`);
  if (inputPass === null) return; // cancelou

  try {
    // 1. Busca lista de usuários para validar a senha administrativa do usuário ativo
    const users = await dbGetUsers();
    const user = users.find(u => u.username.toLowerCase() === currentUser.toLowerCase());
    if (!user) {
      alert("Erro ao validar permissões do usuário.");
      return;
    }
    
    const expectedPass = user.adminPassword || "";
    if (inputPass !== expectedPass) {
      alert("Senha Administrativa Incorreta! Acesso negado.");
      return;
    }

    const confirmDelete = confirm(`Tem certeza que deseja apagar permanentemente o fechamento do dia ${formatDate(dateStr)} (${shiftLabel})?`);
    if (!confirmDelete) return;

    // Filtra localmente na memória e salva na nuvem
    const updatedClosings = closingsData.filter(c => !(c.date === dateStr && (c.shift || "dia") === shiftStr));
    await dbSetClosings(currentUser, updatedClosings);

    closingsData = updatedClosings;
    loadHistoryTable();
    updateGlobalDashboard();
    alert("Lançamento apagado com sucesso.");
  } catch (error) {
    console.error("Erro ao excluir fechamento na nuvem:", error);
    alert("Ocorreu um erro ao excluir o lançamento do banco de dados em nuvem. Verifique sua conexão.");
  }
}

// --- EDITAR FECHAMENTO ---
async function editClosing(dateStr, shiftStr = "dia") {
  const day = closingsData.find(c => c.date === dateStr && (c.shift || "dia") === shiftStr);
  if (!day) return;

  const shiftLabel = shiftStr === "noite" ? "Noite" : "Dia";
  const inputPass = prompt(`Digite a Senha Administrativa para autorizar a EDIÇÃO do fechamento do dia ${formatDate(dateStr)} (${shiftLabel}):`);
  if (inputPass === null) return; // cancelou

  try {
    // 1. Busca lista de usuários para validar a senha administrativa do usuário ativo
    const users = await dbGetUsers();
    const user = users.find(u => u.username.toLowerCase() === currentUser.toLowerCase());
    if (!user) {
      alert("Erro ao validar permissões do usuário.");
      return;
    }
    
    const expectedPass = user.adminPassword || "";
    if (inputPass !== expectedPass) {
      alert("Senha Administrativa Incorreta! Acesso negado.");
      return;
    }
  } catch (error) {
    console.error("Erro ao validar senha administrativa:", error);
    alert("Falha de conexão ao validar permissões. Tente novamente.");
    return;
  }

  document.getElementById("edit-original-date").value = day.date;
  document.getElementById("edit-original-shift").value = day.shift || "dia";
  document.getElementById("edit-closing-shift").value = day.shift || "dia";
  document.getElementById("edit-store-name").value = day.storeName || "";
  document.getElementById("edit-operator-name").value = day.operatorName || "";
  document.getElementById("edit-closing-notes").value = day.notes || "";

  // Constrói o formulário de edição semelhante ao original
  const editContainer = document.getElementById("modal-edit-form-content");
  
  let revenuesFormHtml = `
    <div>
      <h3 class="sub-section-title">
        <i data-lucide="coins" class="text-revenue"></i> Receitas (${formatDate(day.date)})
      </h3>
      <div class="revenue-group">
  `;

  Object.keys(REVENUE_CHANNELS).forEach(k => {
    const channel = REVENUE_CHANNELS[k];
    const val = day.revenues[k] || 0;
    const logoHtml = channel.logo || "";
    revenuesFormHtml += `
      <div class="input-container">
        <label for="edit-rec-${k}" style="display: flex; align-items: center; gap: 4px;">
          ${logoHtml}
          ${channel.label}
        </label>
        <div class="input-wrapper">
          <span class="input-prefix">R$</span>
          <input type="number" step="0.01" min="0" id="edit-rec-${k}" class="form-control form-control-prefix" placeholder="0,00" value="${val > 0 ? val : ''}">
        </div>
      </div>
    `;
  });

  revenuesFormHtml += `
      </div>
    </div>
  `;

  // Despesas e Vales separados no modal
  let expensesFormHtml = `
    <div>
      <!-- Vales no Modal -->
      <div style="margin-bottom: 20px; border-bottom: 1px dashed var(--border-glass); padding-bottom: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <h3 class="sub-section-title" style="margin-bottom: 0;">
            <i data-lucide="users" style="color: var(--secondary)"></i> Vales de Funcionários
          </h3>
          <button type="button" class="btn btn-secondary btn-sm" onclick="addValeRow('','','edit-vales-list-container')">
            <i data-lucide="plus"></i> Adicionar Vale
          </button>
        </div>
        <div class="expense-builder" id="edit-vales-list-container">
          <!-- Inserido dinamicamente -->
        </div>
      </div>

      <!-- Despesas Gerais no Modal -->
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <h3 class="sub-section-title" style="margin-bottom: 0;">
            <i data-lucide="trending-down" class="text-expense"></i> Despesas Gerais
          </h3>
          <button type="button" class="btn btn-secondary btn-sm" onclick="addGeneralExpenseRow('','','alimentos','edit-expense-list-container')">
            <i data-lucide="plus"></i> Adicionar Despesa
          </button>
        </div>
        <div class="expense-builder" id="edit-expense-list-container">
          <!-- Inserido dinamicamente -->
        </div>
      </div>
    </div>
  `;

  editContainer.innerHTML = revenuesFormHtml + expensesFormHtml;

  // Renderiza despesas e vales salvos
  const editExpenseContainer = document.getElementById("edit-expense-list-container");
  const editValesContainer = document.getElementById("edit-vales-list-container");

  editExpenseContainer.innerHTML = "";
  editValesContainer.innerHTML = "";

  let hasVales = false;
  let hasExpenses = false;

  if (day.expenses.length > 0) {
    day.expenses.forEach(e => {
      if (e.category === "vales") {
        addValeRow(e.description, e.value, "edit-vales-list-container");
        hasVales = true;
      } else {
        addGeneralExpenseRow(e.description, e.value, e.category, "edit-expense-list-container", e.photo || "");
        hasExpenses = true;
      }
    });
  }

  // Preenche pelo menos um vazio se não houver registros
  if (!hasVales) {
    addValeRow("", "", "edit-vales-list-container");
  }
  if (!hasExpenses) {
    addGeneralExpenseRow("", "", "alimentos", "edit-expense-list-container");
  }

  openModal("modal-edit");
  lucide.createIcons();
}

async function saveEditClosing(event) {
  event.preventDefault();

  // Verifica se a licença expirou
  if (isLicenseExpired && currentUser !== "mestre") {
    alert("⚠️ Licença Expirada: Seu aplicativo está em Modo Leitura. Para liberar a edição de fechamentos, realize o pagamento de R$ 49,90 na aba 'Assinatura & Licença'.");
    return;
  }

  const originalDate = document.getElementById("edit-original-date").value;
  const originalShift = document.getElementById("edit-original-shift").value;
  const targetShift = document.getElementById("edit-closing-shift").value;

  const index = closingsData.findIndex(c => c.date === originalDate && (c.shift || "dia") === originalShift);
  if (index === -1) return;

  // Se o operador mudou o turno, verifica se já existe outro fechamento cadastrado para esse novo turno no mesmo dia
  if (targetShift !== originalShift) {
    const shiftExists = closingsData.some(c => c.date === originalDate && (c.shift || "dia") === targetShift);
    if (shiftExists) {
      const targetShiftLabel = targetShift === "noite" ? "Noite" : "Dia";
      alert(`Já existe um fechamento cadastrado para o dia ${formatDate(originalDate)} no turno ${targetShiftLabel}. Não é possível alterar.`);
      return;
    }
  }

  // Feedback visual de salvamento no modal
  const saveBtn = event.target.querySelector("button[type='submit']");
  const originalText = saveBtn.innerHTML;
  saveBtn.disabled = true;
  saveBtn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Atualizando...`;
  lucide.createIcons();

  // Coleta Receitas
  const revenues = {};
  Object.keys(REVENUE_CHANNELS).forEach(k => {
    revenues[k] = parseFloat(document.getElementById(`edit-rec-${k}`).value) || 0;
  });

  // Coleta Despesas do modal de Edição (Vales e Gerais)
  const expenses = [];

  // 1. Vales
  const valeRows = document.querySelectorAll("#edit-vales-list-container .expense-row");
  valeRows.forEach(row => {
    const employeeName = row.querySelector(".vale-desc").value.trim();
    const val = parseFloat(row.querySelector(".vale-val").value) || 0;

    if (employeeName && val > 0) {
      expenses.push({
        description: employeeName,
        value: val,
        category: "vales"
      });
    }
  });

  // 2. Despesas Gerais
  const expenseRows = document.querySelectorAll("#edit-expense-list-container .expense-row");
  expenseRows.forEach(row => {
    const desc = row.querySelector(".expense-desc").value.trim();
    const val = parseFloat(row.querySelector(".expense-val").value) || 0;
    const cat = row.querySelector(".expense-cat").value;

    if (desc && val > 0) {
      expenses.push({
        description: desc,
        value: val,
        category: cat,
        photo: row.dataset.photo || ""
      });
    }
  });

  const storeName = document.getElementById("edit-store-name").value.trim();
  const operatorName = document.getElementById("edit-operator-name").value.trim();
  const notes = document.getElementById("edit-closing-notes").value.trim();

  // Monta objeto de fechamento atualizado
  const updatedClosing = {
    date: originalDate,
    shift: targetShift,
    storeName: storeName,
    operatorName: operatorName,
    revenues: revenues,
    expenses: expenses,
    notes: notes
  };

  // Salva no banco de dados Upstash/RAM passando o originalShift para a correta substituição
  await saveDataToStorage(updatedClosing, originalShift);
  
  // Restaura botão e fecha modal
  saveBtn.disabled = false;
  saveBtn.innerHTML = originalText;
  
  closeModal("modal-edit");
  loadHistoryTable();
  updateGlobalDashboard();
  alert("Alterações salvas com sucesso!");
}

// --- SISTEMA DE MODAIS ---
function openModal(id) {
  document.getElementById(id).classList.add("active");
}

function closeModal(id) {
  document.getElementById(id).classList.remove("active");
}

// --- EXPORTAR E IMPORTAR BACKUPS ---
function exportData() {
  if (closingsData.length === 0) {
    alert("Não há dados registrados para exportar.");
    return;
  }

  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(closingsData, null, 2));
  const downloadAnchor = document.createElement('a');
  
  const today = new Date().toISOString().split('T')[0];
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `gastrofecho-backup-${today}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const parsed = JSON.parse(e.target.result);
      
      // Validação básica do formato
      if (Array.isArray(parsed) && (parsed.length === 0 || (parsed[0].date && parsed[0].revenues))) {
        const confirmMerge = confirm(`Identificamos ${parsed.length} fechamentos no arquivo. Deseja substituir os fechamentos atuais por este arquivo de backup?`);
        if (confirmMerge) {
          closingsData = parsed;
          saveDataToStorage();
          loadHistoryTable();
          updateGlobalDashboard();
          alert("Backup importado com sucesso!");
        }
      } else {
        alert("Formato de arquivo inválido. Por favor, utilize um arquivo gerado pela exportação do GastroFecho.");
      }
    } catch (err) {
      alert("Erro ao ler o arquivo. Certifique-se de que é um arquivo JSON de backup válido.");
      console.error(err);
    }
  };
  reader.readAsText(file);
  // Limpa o input file para permitir selecionar o mesmo arquivo novamente se necessário
  event.target.value = "";
}

// --- DADOS FICTÍCIOS DE DEMONSTRAÇÃO ---
function generateDemoData() {
  // Verifica se a licença expirou
  if (isLicenseExpired && currentUser !== "mestre") {
    alert("⚠️ Licença Expirada: Seu aplicativo está em Modo Leitura. Para liberar a geração de demonstrações, realize o pagamento de R$ 49,90 na aba 'Assinatura & Licença'.");
    return;
  }

  const confirmDemo = confirm("Deseja inserir dados fictícios de demonstração de uma lanchonete ativa dos últimos 7 dias para testar todas as funcionalidades do app?");
  if (!confirmDemo) return;

  const demoClosings = [];
  const today = new Date();
  
  // Lista de produtos fictícios e vales
  const dummyExpensesList = [
    { desc: "Compra Hortifruti", cat: "compras", min: 50, max: 120 },
    { desc: "Compra Carnes e Pães", cat: "compras", min: 200, max: 500 },
    { desc: "Gás de Cozinha", cat: "contas", min: 140, max: 140 },
    { desc: "Adiantamento Caixa João", cat: "vales", min: 50, max: 100 },
    { desc: "Vale Maria (Limpeza)", cat: "vales", min: 80, max: 80 },
    { desc: "Conta de Energia Elétrica", cat: "contas", min: 380, max: 380 },
    { desc: "Sacolas Plásticas e Copos", cat: "outros", min: 30, max: 70 },
  ];

  for (let i = 6; i >= 0; i--) {
    const targetDate = new Date();
    targetDate.setDate(today.getDate() - i);
    const dateStr = targetDate.toISOString().split('T')[0];

    // Variabilidade do movimento comercial dependendo do dia da semana (fim de semana vende mais)
    const isWeekend = targetDate.getDay() === 0 || targetDate.getDay() === 5 || targetDate.getDay() === 6;
    const factor = isWeekend ? 1.7 : 1.0;

    // Receitas simuladas
    const revenues = {
      ifood: Math.round((200 + Math.random() * 400) * factor * 100) / 100,
      99: Math.round((50 + Math.random() * 120) * factor * 100) / 100,
      keeta: Math.round((30 + Math.random() * 80) * factor * 100) / 100,
      pix: Math.round((150 + Math.random() * 300) * factor * 100) / 100,
      credit: Math.round((120 + Math.random() * 250) * factor * 100) / 100,
      debit: Math.round((80 + Math.random() * 150) * factor * 100) / 100,
      vr: Math.round((40 + Math.random() * 90) * factor * 100) / 100,
      cash: Math.round((50 + Math.random() * 150) * factor * 100) / 100
    };

    // Despesas aleatórias simuladas
    const expenses = [];
    const numExpenses = 2 + Math.floor(Math.random() * 3);
    const shuffledDummy = [...dummyExpensesList].sort(() => 0.5 - Math.random());
    
    for (let j = 0; j < numExpenses; j++) {
      const item = shuffledDummy[j];
      const val = Math.round((item.min + Math.random() * (item.max - item.min)) * 100) / 100;
      expenses.push({
        description: item.desc,
        value: val,
        category: item.cat
      });
    }

    const dayNotes = isWeekend 
      ? "Grande movimento por conta do fim de semana. Equipe focada e entrega rápida." 
      : "Movimento padrão de dia de semana. Ajustado estoque no final da noite.";

    demoClosings.push({
      date: dateStr,
      revenues: revenues,
      expenses: expenses,
      notes: dayNotes
    });
  }

  closingsData = demoClosings;
  saveDataToStorage();
  
  // Atualiza painéis e muda para o Histórico
  updateGlobalDashboard();
  loadHistoryTable();
  
  const todayNavItem = document.querySelector('[data-target="panel-today"]');
  switchTab(todayNavItem);
  switchTodaySubTab('history');

  alert("Dados de demonstração gerados! Explore o Histórico na sub-aba de Fechamento de Caixa.");
}

// --- LIMPEZA DE BANCO DE DADOS ---
async function resetAllData() {
  // Verifica se a licença expirou
  if (isLicenseExpired && currentUser !== "mestre") {
    alert("⚠️ Licença Expirada: Seu aplicativo está em Modo Leitura. Para liberar a limpeza de dados, realize o pagamento de R$ 49,90 na aba 'Assinatura & Licença'.");
    return;
  }

  const confirmWipe = confirm("ATENÇÃO: Isso irá deletar permanentemente TODOS os lançamentos registrados. Você tem certeza disso?");
  if (!confirmWipe) return;

  const doubleConfirm = confirm("Deseja realmente prosseguir? Os dados serão perdidos.");
  if (!doubleConfirm) return;

  if (!currentUser) return;
  
  try {
    // Limpa caixa
    localStorage.removeItem(`gastrofecho_closings_${currentUser}`);
    localStorage.removeItem(`gastrofecho_store_name_${currentUser}`);
    localStorage.removeItem(`gastrofecho_operator_name_${currentUser}`);
    closingsData = [];
    
    // Limpa banco de dados bancário
    await dbSetBankClosings(currentUser, []);
    bankClosingsData = [];
    
    // Reseta estado e formulários
    updateGlobalDashboard();
    loadHistoryTable();
    resetForm();
    try {
      resetBankForm();
    } catch(e) {
      console.warn("Erro ao resetar form bancário:", e);
    }

    // Muda de volta para o lançamento diário
    const todayNavItem = document.querySelector('[data-target="panel-today"]');
    switchTab(todayNavItem);

    alert("Todos os lançamentos e fechamentos bancários foram excluídos permanentemente.");
  } catch (error) {
    console.error("Erro ao limpar dados:", error);
    alert("Falha de conexão ao limpar dados da nuvem.");
  }
}

// --- GERAR TEXTO FORMATADO PARA O WHATSAPP ---
function getFormattedWhatsAppText(day) {
  let revTotal = 0;
  Object.keys(day.revenues).forEach(k => revTotal += day.revenues[k]);
  
  let valesTotal = 0;
  let expensesTotal = 0;
  
  day.expenses.forEach(e => {
    if (e.category === "vales") {
      valesTotal += e.value;
    } else {
      expensesTotal += e.value;
    }
  });
  
  const net = revTotal - (expensesTotal + valesTotal);
  const statusStr = net >= 0 ? "🟢 Lucro" : "🔴 Déficit";
  const shiftLabel = (day.shift || "dia") === "noite" ? "🌙 Noite" : "☀️ Dia";

  // Monta texto formatado do WhatsApp
  let text = `🏪 *FECHOU! - FECHAMENTO DE CAIXA*\n`;
  
  // Busca o nome da loja associado ao cadastro do operador no LocalStorage
  const activeStoreName = localStorage.getItem(`gastrofecho_store_name_${currentUser}`) || day.storeName || "Não informada";

  text += `🏪 *Loja:* ${activeStoreName}\n`;
  text += `👤 *Responsável:* ${day.operatorName || "Não informado"}\n`;
  text += `📅 *Data:* ${formatDate(day.date)} (${shiftLabel})\n\n`;

  text += `💰 *SOMA DAS RECEITAS: ${formatCurrency(revTotal)}*\n`;
  let hasRevenues = false;
  Object.keys(day.revenues).forEach(k => {
    if (day.revenues[k] > 0) {
      const label = REVENUE_CHANNELS[k]?.label || k;
      text += `  • ${label}: ${formatCurrency(day.revenues[k])}\n`;
      hasRevenues = true;
    }
  });
  if (!hasRevenues) text += `  • Nenhuma receita registrada.\n`;
  text += `\n`;

  text += `💸 *SOMA DAS DESPESAS GERAIS: ${formatCurrency(expensesTotal)}*\n`;
  let hasExpenses = false;
  day.expenses.forEach(e => {
    if (e.category !== "vales") {
      text += `  • ${e.description}: ${formatCurrency(e.value)}\n`;
      hasExpenses = true;
    }
  });
  if (!hasExpenses) text += `  • Nenhuma despesa geral registrada.\n`;
  text += `\n`;

  text += `👥 *SOMA DE TODOS OS VALES: ${formatCurrency(valesTotal)}*\n`;
  let hasVales = false;
  day.expenses.forEach(e => {
    if (e.category === "vales") {
      text += `  • ${e.description}: ${formatCurrency(e.value)}\n`;
      hasVales = true;
    }
  });
  if (!hasVales) text += `  • Nenhum vale registrado.\n`;
  text += `\n`;

  text += `⚖️ *SALDO LÍQUIDO FINAL: ${formatCurrency(net)}* (${statusStr})\n\n`;

  if (day.notes) {
    text += `📝 *Observações:* \n_${day.notes}_\n`;
  }
  
  return text;
}

// --- EXPORTAR RELATÓRIO FORMATADO PARA WHATSAPP ---
function shareWhatsApp() {
  const day = closingsData.find(c => c.date === currentViewDate && (c.shift || "dia") === currentViewShift);
  if (!day) {
    alert("Nenhum fechamento selecionado para compartilhar.");
    return;
  }

  const text = getFormattedWhatsAppText(day);
  const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
  window.open(waUrl, '_blank');
}

// Enviar fechamento antigo diretamente do histórico via WhatsApp
function shareWhatsAppDirect(dateStr, shiftStr = "dia") {
  const day = closingsData.find(c => c.date === dateStr && (c.shift || "dia") === shiftStr);
  if (!day) {
    alert("Nenhum fechamento encontrado para compartilhar.");
    return;
  }

  const text = getFormattedWhatsAppText(day);
  const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
  window.open(waUrl, '_blank');
}

// --- SISTEMA DE ALTERNÂNCIA DE TEMA (CLARO/ESCURO) ---
function toggleTheme() {
  const isDark = document.body.classList.toggle("dark-theme");
  const toggleBtn = document.getElementById("theme-toggle-btn");
  
  if (isDark) {
    localStorage.setItem("gastrofecho_theme", "dark");
    if (toggleBtn) {
      toggleBtn.innerHTML = `<i data-lucide="sun"></i>`;
    }
  } else {
    localStorage.setItem("gastrofecho_theme", "light");
    if (toggleBtn) {
      toggleBtn.innerHTML = `<i data-lucide="moon"></i>`;
    }
  }
  
  // Recarrega os ícones Lucide
  lucide.createIcons();
  
  // Atualiza o fechamento mensal caso o painel correspondente esteja aberto
  const monthlyPanel = document.getElementById("panel-monthly");
  if (monthlyPanel && monthlyPanel.style.display !== "none") {
    loadMonthlyClosingReport();
  }
}

// --- FUNÇÕES DO PAINEL DO ACESSO MESTRE ---

// Carregar Dados e KPIs Administrativos do KVdb.io
async function loadMasterPanel() {
  // Inicializa a sub-aba de operadores
  switchMasterSubTab('users');
  loadUserContactInfo();

  const tbody = document.getElementById("master-users-body");
  tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 25px; color: var(--text-secondary);"><i data-lucide="loader-2" class="spin" style="width: 20px; height: 20px; margin-right: 8px; vertical-align: middle;"></i> Carregando operadores da nuvem...</td></tr>`;
  lucide.createIcons();

  try {
    // 1. Carrega a UI de controle de manutenção
    updateMaintenanceUI();

    // 2. Busca todos os usuários da nuvem
    const users = await dbGetUsers();

    // 2. Busca solicitações de recuperação de senha
    let recoveryRequests = [];
    try {
      const rawRequests = await redisCmd("GET", "fechou:recovery_requests");
      recoveryRequests = rawRequests ? JSON.parse(rawRequests) : [];
    } catch (e) {
      console.warn("Erro ao buscar solicitações de recuperação:", e);
    }

    // Atualiza o KPI de Recuperação e Status
    const recoveryKpi = document.getElementById("master-kpi-recovery");
    if (recoveryKpi) {
      recoveryKpi.textContent = recoveryRequests.length;
    }
    const recoveryStatus = document.getElementById("master-kpi-recovery-status");
    if (recoveryStatus) {
      recoveryStatus.className = "kpi-status";
      if (recoveryRequests.length > 0) {
        recoveryStatus.classList.add("status-negative");
        recoveryStatus.innerHTML = `<i data-lucide="bell" class="spin" style="width:12px;height:12px"></i> <span>Ações Pendentes</span>`;
      } else {
        recoveryStatus.classList.add("status-neutral");
        recoveryStatus.innerHTML = `<span>Nenhuma solicitação</span>`;
      }
    }

    // Renderiza o card e a tabela de solicitações pendentes
    const recoveryCard = document.getElementById("master-recovery-requests-card");
    const recoveryTbody = document.getElementById("master-recovery-requests-body");
    
    if (recoveryRequests.length > 0) {
      recoveryCard.style.display = "block";
      recoveryTbody.innerHTML = "";
      
      recoveryRequests.forEach(req => {
        const matchedUser = users.find(u => u.username.toLowerCase() === req.username.toLowerCase());
        const password = matchedUser ? matchedUser.password : "--";
        const adminPassword = matchedUser ? (matchedUser.adminPassword || "Não configurada") : "--";
        
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td class="bold">${req.storeName || "Sem Nome de Loja"}</td>
          <td class="bold">${req.username}</td>
          <td style="color: var(--text-secondary); font-size: 13px;">${req.email}</td>
          <td style="color: var(--text-muted); font-size: 12px;">${new Date(req.createdAt).toLocaleDateString('pt-BR')} ${new Date(req.createdAt).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}</td>
          <td class="table-actions" style="justify-content: center; gap: 8px;">
            <button type="button" class="btn btn-success btn-sm" onclick="sendRecoveryWhatsApp('${req.username}', '${password}', '${adminPassword}')" title="Enviar senhas via WhatsApp">
              <i data-lucide="message-square" style="width: 13px; height: 13px;"></i> WhatsApp
            </button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="dismissRecoveryRequest('${req.username}')" title="Descartar solicitação">
              <i data-lucide="check" style="width: 13px; height: 13px;"></i> Concluir
            </button>
          </td>
        `;
        recoveryTbody.appendChild(tr);
      });
    } else {
      recoveryCard.style.display = "none";
    }

    tbody.innerHTML = "";
    
    // Atualiza KPIs
    document.getElementById("master-kpi-users").textContent = users.length;
    
    let totalClosingsAll = 0;
    let totalBankClosingsAll = 0;
    
    if (users.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; font-style: italic; color: var(--text-muted); padding: 20px;">Nenhum operador cadastrado ainda.</td></tr>`;
      document.getElementById("master-kpi-closings").textContent = 0;
      return;
    }

    // Carrega a contagem de caixas de cada um de forma paralela rápida!
    const usersWithCounts = await Promise.all(users.map(async (user) => {
      let uClosings = [];
      let uBankClosings = [];
      try {
        uClosings = await dbGetClosings(user.username);
      } catch (errC) { console.error(errC); }
      try {
        uBankClosings = await dbGetBankClosings(user.username);
      } catch (errB) { console.error(errB); }
      
      totalClosingsAll += uClosings.length;
      totalBankClosingsAll += uBankClosings.length;
      return { user, count: uClosings.length, bankCount: uBankClosings.length };
    }));

    document.getElementById("master-kpi-closings").textContent = totalClosingsAll + totalBankClosingsAll;

    usersWithCounts.forEach(({ user, count, bankCount }) => {
      // Inicializar campos ausentes para compatibilidade retroativa
      if (user.isVip === undefined) user.isVip = false;
      if (user.creditsUntil === undefined) user.creditsUntil = "";
      if (!user.trialUntil && user.createdAt) {
        user.trialUntil = new Date(new Date(user.createdAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
      } else if (!user.trialUntil) {
        user.trialUntil = new Date(new Date(user.createdAt || Date.now()).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
      }

      let licenseHtml = "";
      const now = new Date();
      if (user.isVip) {
        licenseHtml = `<span class="badge" style="background: rgba(124, 58, 237, 0.12); color: var(--secondary); border: 1px solid rgba(124, 58, 237, 0.2); font-weight:700;">⭐ Vitalício (VIP)</span>`;
      } else if (user.creditsUntil && new Date(user.creditsUntil) >= now) {
        const dStr = new Date(user.creditsUntil).toLocaleDateString('pt-BR');
        licenseHtml = `<span class="badge" style="background: rgba(16, 185, 129, 0.12); color: var(--color-revenue); border: 1px solid rgba(16, 185, 129, 0.2); font-weight:700;">✅ Ativo (Até ${dStr})</span>`;
      } else if (user.trialUntil && new Date(user.trialUntil) >= now) {
        const dStr = new Date(user.trialUntil).toLocaleDateString('pt-BR');
        licenseHtml = `<span class="badge" style="background: rgba(59, 130, 246, 0.12); color: var(--primary); border: 1px solid rgba(59, 130, 246, 0.2); font-weight:700;">⏳ Teste (Até ${dStr})</span>`;
      } else {
        licenseHtml = `<span class="badge" style="background: rgba(244, 63, 94, 0.12); color: var(--color-expense); border: 1px solid rgba(244, 63, 94, 0.2); font-weight:700;">❌ Expirado</span>`;
      }

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="bold">${user.storeName || '<span style="color: var(--text-muted); font-style: italic;">Não informada</span>'}</td>
        <td class="bold">${user.username}</td>
        <td style="color: var(--text-secondary); font-size: 13px;">${user.email || '--'}</td>
        <td>
          <span class="user-pass-hidden" id="pass-hidden-${user.username}">••••••••</span>
          <span class="user-pass-visible" id="pass-visible-${user.username}" style="display: none; font-family: monospace; font-weight: 600;">${user.password}</span>
          <button class="btn-icon-secondary" onclick="toggleAdminPassVisibility('${user.username}')" style="display: inline-flex; vertical-align: middle; margin-left: 8px; border: none; background: none; cursor: pointer; color: var(--text-secondary);" title="Ver Senha">
            <i data-lucide="eye" style="width: 14px; height: 14px;"></i>
          </button>
        </td>
        <td>
          <span class="user-admin-pass-hidden" id="admin-pass-hidden-${user.username}">••••••••</span>
          <span class="user-admin-pass-visible" id="admin-pass-visible-${user.username}" style="display: none; font-family: monospace; font-weight: 600;">${user.adminPassword || '--'}</span>
          <button class="btn-icon-secondary" onclick="toggleAdminPassAdminVisibility('${user.username}')" style="display: inline-flex; vertical-align: middle; margin-left: 8px; border: none; background: none; cursor: pointer; color: var(--text-secondary);" title="Ver Senha Admin">
            <i data-lucide="eye" style="width: 14px; height: 14px;"></i>
          </button>
        </td>
        <td style="text-align: center;" class="bold text-revenue">${count} Caixas / ${bankCount} Bancos</td>
        <td style="text-align: center;">${licenseHtml}</td>
        <td class="table-actions" style="justify-content: center; gap: 4px;">
          <button type="button" class="btn btn-success btn-sm" onclick="adminInspectUser('${user.username}')" title="Inspecionar e Auditar Caixa">
            <i data-lucide="eye" style="width: 13px; height: 13px;"></i> Ver Caixas
          </button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="adminManageAccess('${user.username}')" title="Gerenciar Licença e Acesso" style="background: rgba(124, 58, 237, 0.12); color: var(--secondary); border-color: rgba(124, 58, 237, 0.2);">
            <i data-lucide="credit-card" style="width: 13px; height: 13px;"></i> Licenciar
          </button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="adminResetPasswordPrompt('${user.username}')" title="Redefinir Senha">
            <i data-lucide="key" style="width: 13px; height: 13px;"></i> Redefinir
          </button>
          <button type="button" class="btn btn-danger btn-sm" onclick="adminDeleteUser('${user.username}')" title="Excluir Conta e Caixas">
            <i data-lucide="trash-2" style="width: 13px; height: 13px;"></i> Excluir
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
    
    lucide.createIcons();
  } catch (error) {
    console.error("Erro ao carregar painel mestre do KVdb:", error);
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--color-expense); padding: 20px; font-weight: 600;">Falha ao carregar operadores do servidor.</td></tr>`;
  }
}

// Alternar visibilidade da senha na tabela
function toggleAdminPassVisibility(username) {
  const hidden = document.getElementById(`pass-hidden-${username}`);
  const visible = document.getElementById(`pass-visible-${username}`);
  
  if (hidden.style.display !== "none") {
    hidden.style.display = "none";
    visible.style.display = "inline";
  } else {
    hidden.style.display = "inline";
    visible.style.display = "none";
  }
}

// Alternar visibilidade da senha administrativa na tabela
function toggleAdminPassAdminVisibility(username) {
  const hidden = document.getElementById(`admin-pass-hidden-${username}`);
  const visible = document.getElementById(`admin-pass-visible-${username}`);
  
  if (hidden.style.display !== "none") {
    hidden.style.display = "none";
    visible.style.display = "inline";
  } else {
    hidden.style.display = "inline";
    visible.style.display = "none";
  }
}

// Excluir conta de operador e seus fechamentos salvos no KVdb
async function adminDeleteUser(username) {
  const normalizedUsername = username.toLowerCase();
  const confirmWipe = confirm(`ATENÇÃO: Você irá excluir a conta do operador "${username}" e TODOS os seus fechamentos salvos na nuvem de forma permanente. Confirma essa exclusão?`);
  if (!confirmWipe) return;

  const doubleConfirm = prompt(`Digite SIM para confirmar a exclusão permanente dos dados do usuário: ${username}`);
  if (!doubleConfirm || doubleConfirm.toUpperCase() !== "SIM") return;

  try {
    // 1. Remove o usuário da base de dados na nuvem
    const users = await dbGetUsers();
    const filteredUsers = users.filter(u => u.username.toLowerCase() !== normalizedUsername);
    await dbSetUsers(filteredUsers);

    // 2. Remove os fechamentos limpando o blob do usuário
    await dbSetClosings(normalizedUsername, []);

    // Limpa possíveis chaves locais cacheada
    localStorage.removeItem(`gastrofecho_store_name_${normalizedUsername}`);
    localStorage.removeItem(`gastrofecho_operator_name_${normalizedUsername}`);

    alert(`Operador "${username}" e todas as suas informações foram completamente removidos da nuvem.`);
    loadMasterPanel();
  } catch (error) {
    console.error("Erro ao excluir usuário no KVdb:", error);
    alert("Ocorreu um erro ao excluir o operador do banco de dados em nuvem.");
  }
}

// Redefinir Senha do Operador no KVdb (Senha de Acesso ou Senha Administrativa)
async function adminResetPasswordPrompt(username) {
  const normalizedUsername = username.toLowerCase();
  
  const choice = prompt(`Escolha o que deseja redefinir para o operador "${username}":\nDigite 1 para Senha de Acesso\nDigite 2 para Senha Administrativa (Editar/Excluir Caixas)`);
  if (choice === null) return; // cancelou

  const option = choice.trim();
  if (option !== "1" && option !== "2") {
    alert("Opção inválida. Digite 1 ou 2.");
    return;
  }

  const targetLabel = option === "1" ? "Senha de Acesso" : "Senha Administrativa";
  const newPass = prompt(`Digite a nova ${targetLabel} para o operador "${username}":`);
  if (newPass === null) return; // cancelou

  const trimmed = newPass.trim();
  if (trimmed.length === 0) {
    alert("A senha não pode ser vazia.");
    return;
  }

  try {
    const users = await dbGetUsers();
    const user = users.find(u => u.username.toLowerCase() === normalizedUsername);
    if (user) {
      if (option === "1") {
        user.password = trimmed;
      } else {
        user.adminPassword = trimmed;
      }
      await dbSetUsers(users);
      alert(`${targetLabel} do operador "${username}" redefinida com sucesso!`);
      loadMasterPanel();
    } else {
      alert("Usuário não encontrado.");
    }
  } catch (error) {
    console.error(`Erro ao redefinir ${targetLabel} na nuvem:`, error);
    alert(`Erro ao salvar a nova ${targetLabel} na nuvem.`);
  }
}

// Criar Novo Operador pelo Painel Administrativo no KVdb
async function adminCreateUser(event) {
  event.preventDefault();
  const storeInput = document.getElementById("master-new-store").value.trim();
  const emailInput = document.getElementById("master-new-email").value.trim().toLowerCase();
  const usernameInput = document.getElementById("master-new-username").value.trim().toLowerCase(); // Normalizado em minúsculas
  const passwordInput = document.getElementById("master-new-password").value;
  const adminPasswordInput = document.getElementById("master-new-admin-password").value.trim();

  if (!storeInput || !emailInput || !usernameInput || !passwordInput || !adminPasswordInput) {
    alert("Por favor, preencha todos os campos.");
    return;
  }

  try {
    // Feedback visual
    const createBtn = event.target.querySelector("button[type='submit']");
    const originalText = createBtn.innerHTML;
    createBtn.disabled = true;
    createBtn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Criando conta...`;
    lucide.createIcons();

    // 1. Validar e-mail do mestre
    if (emailInput === "lucas_simoes_araujo@hotmail.com" || emailInput === "lucas_simoes_araujo_g@hotmail.com") {
      alert("Este e-mail é reservado exclusivamente para o Administrador Mestre.");
      createBtn.disabled = false;
      createBtn.innerHTML = originalText;
      lucide.createIcons();
      return;
    }

    // 2. Busca lista de usuários na nuvem
    const users = await dbGetUsers();

    // 3. Validar telefone/username único
    const phoneExists = users.some(u => u.username.toLowerCase() === usernameInput);
    if (phoneExists) {
      alert("Este número de telefone (usuário de acesso) já está cadastrado.");
      createBtn.disabled = false;
      createBtn.innerHTML = originalText;
      lucide.createIcons();
      return;
    }

    // 4. Validar e-mail único
    const emailExists = users.some(u => u.email && u.email.toLowerCase() === emailInput);
    if (emailExists) {
      alert("Este e-mail já está cadastrado por outro usuário.");
      createBtn.disabled = false;
      createBtn.innerHTML = originalText;
      lucide.createIcons();
      return;
    }

    // 5. Validar nome da loja único
    const storeExists = users.some(u => u.storeName && u.storeName.trim().toLowerCase() === storeInput.toLowerCase());
    if (storeExists) {
      alert("Este nome de loja já está cadastrado.");
      createBtn.disabled = false;
      createBtn.innerHTML = originalText;
      lucide.createIcons();
      return;
    }

    // 6. Cria e salva novo usuário
    const newUser = {
      username: usernameInput,
      password: passwordInput,
      adminPassword: adminPasswordInput,
      storeName: storeInput,
      email: emailInput,
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    await dbSetUsers(users);

    // Inicializa o nome da loja padrão deste usuário localmente
    localStorage.setItem(`gastrofecho_store_name_${usernameInput}`, storeInput);

    document.getElementById("master-create-user-form").reset();
    createBtn.disabled = false;
    createBtn.innerHTML = originalText;

    alert(`Operador "${usernameInput}" cadastrado com sucesso!`);
    loadMasterPanel();
  } catch (error) {
    console.error("Erro ao criar operador no KVdb:", error);
    alert("Houve um erro ao salvar o novo operador no servidor de nuvem.");
    const createBtn = event.target.querySelector("button[type='submit']");
    createBtn.disabled = false;
    createBtn.innerHTML = `Cadastrar Operador`;
    lucide.createIcons();
  }
}

// --- MODO DE AUDITORIA MESTRE ---

// Iniciar inspeção nos fechamentos de um operador no KVdb
async function adminInspectUser(username) {
  const normalizedUsername = username.toLowerCase();
  isAuditMode = true;
  auditedUser = normalizedUsername;

  // Carrega as credenciais da auditoria
  currentUser = normalizedUsername;

  try {
    // Busca informações da loja
    const users = await dbGetUsers();
    const user = users.find(u => u.username.toLowerCase() === normalizedUsername);
    if (user) {
      document.getElementById("user-display-name").textContent = user.storeName || username;
    } else {
      document.getElementById("user-display-name").textContent = username;
    }
  } catch(e) {
    document.getElementById("user-display-name").textContent = username;
  }

  // Exibe interface padrão em modo leitura/gravação temporária
  document.getElementById("master-grid").style.display = "none";
  document.getElementById("master-audit-banner").style.display = "flex";
  document.getElementById("audited-username-label").textContent = username;
  document.querySelector(".main-grid").style.display = "grid";

  // Inicializa o app com a sessão do operador sob inspeção
  initApp();
}

// Sair do modo auditoria e retornar ao painel mestre
function exitAuditMode() {
  isAuditMode = false;
  auditedUser = null;

  // Retorna a sessão ao Administrador
  currentUser = "mestre";

  // Retorna o crachá da aba superior ao título do Administrador Mestre
  document.getElementById("user-display-name").textContent = "Administrador Mestre";

  // Exibe novamente o Painel Mestre
  document.getElementById("master-audit-banner").style.display = "none";
  document.querySelector(".main-grid").style.display = "none";
  document.getElementById("master-grid").style.display = "block";

  loadMasterPanel();
}

// --- WHATSAPP & CONTROLE DE RECUPERAÇÃO DE SENHAS ---

// Envia a credencial recuperada para o operador via WhatsApp
function sendRecoveryWhatsApp(username, password, adminPassword) {
  const text = `🏪 *FECHOU! - RECUPERAÇÃO DE ACESSO*\n\n` +
    `Olá! Recebemos sua solicitação de recuperação de senhas para o operador de acesso *${username}*.\n\n` +
    `🔐 *Senha de Acesso:* \`${password}\`\n` +
    `🛡️ *Senha Administrativa:* \`${adminPassword}\`\n\n` +
    `Você já pode fazer login utilizando seu telefone e a senha de acesso acima. Guarde sua senha administrativa com segurança!`;
  
  const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
  window.open(waUrl, '_blank');
}

// Arquiva/exclui a solicitação resolvida da nuvem no Upstash
async function dismissRecoveryRequest(username) {
  try {
    const confirmDismiss = confirm(`Deseja marcar como resolvida e descartar a solicitação de ${username}?`);
    if (!confirmDismiss) return;

    const rawRequests = await redisCmd("GET", "fechou:recovery_requests");
    const requests = rawRequests ? JSON.parse(rawRequests) : [];
    
    const updated = requests.filter(r => r.username.toLowerCase() !== username.toLowerCase());
    await redisCmd("SET", "fechou:recovery_requests", JSON.stringify(updated));
    
    alert("Solicitação arquivada com sucesso.");
    loadMasterPanel();
  } catch (error) {
    console.error("Erro ao descartar solicitação:", error);
    alert("Erro de conexão ao remover solicitação.");
  }
}

// =====================================================================
// FECHAMENTO BANCÁRIO DIÁRIO - MÓDULO E LOGICA BANCÁRIA
// =====================================================================

const BANK_INFLOW_CATEGORIES = {
  pix: "Pix",
  transferencia: "Transferência",
  deposito: "Depósito",
  outros: "Outros"
};

const BANK_OUTFLOW_CATEGORIES = {
  fornecedores: "Fornecedores",
  salarios: "Salários",
  impostos: "Impostos",
  tarifas: "Tarifas",
  outros: "Outros"
};

// Grava fechamentos bancários no Upstash
async function saveBankDataToStorage(singleClosing = null, originalShift = null) {
  if (!currentUser || currentUser === "mestre") return;

  try {
    if (singleClosing) {
      const closings = await dbGetBankClosings(currentUser);
      
      const updatedClosing = {
        userId: currentUser,
        date: singleClosing.date,
        shift: singleClosing.shift || "dia",
        storeName: singleClosing.storeName,
        operatorName: singleClosing.operatorName,
        inflows: singleClosing.inflows || [],
        outflows: singleClosing.outflows || [],
        notes: singleClosing.notes,
        updatedAt: new Date().toISOString()
      };

      const searchShift = originalShift || singleClosing.shift || "dia";

      const existsIndex = closings.findIndex(c => c.date === singleClosing.date && (c.shift || "dia") === searchShift);
      if (existsIndex !== -1) {
        closings[existsIndex] = updatedClosing;
      } else {
        closings.push(updatedClosing);
      }

      await dbSetBankClosings(currentUser, closings);

      const ramIndex = bankClosingsData.findIndex(c => c.date === singleClosing.date && (c.shift || "dia") === searchShift);
      if (ramIndex !== -1) {
        bankClosingsData[ramIndex] = updatedClosing;
      } else {
        bankClosingsData.push(updatedClosing);
      }
    } else {
      await dbSetBankClosings(currentUser, bankClosingsData);
    }

    bankClosingsData.sort((a, b) => new Date(b.date) - new Date(a.date));
  } catch (error) {
    console.error("Erro ao gravar dados bancários no Upstash:", error);
    alert("Houve um erro ao sincronizar o fechamento bancário com o banco de dados.");
  }
}

// Sub-abas de Fechamento Bancário
function switchBankSubTab(tab) {
  const formTabBtn = document.getElementById("subtab-bank-form");
  const historyTabBtn = document.getElementById("subtab-bank-history");
  const formContainer = document.getElementById("bank-form-container");
  const historyContainer = document.getElementById("bank-history-container");

  if (!formTabBtn || !historyTabBtn || !formContainer || !historyContainer) return;

  if (tab === 'form') {
    formTabBtn.className = "btn btn-primary btn-sm";
    historyTabBtn.className = "btn btn-secondary btn-sm";
    formContainer.style.display = "block";
    historyContainer.style.display = "none";
  } else {
    formTabBtn.className = "btn btn-secondary btn-sm";
    historyTabBtn.className = "btn btn-primary btn-sm";
    formContainer.style.display = "none";
    historyContainer.style.display = "block";
    loadBankHistoryTable();
  }
  lucide.createIcons();
  disableOperatorInputs(isLicenseExpired);
}

// Sub-abas de Fechamento de Caixa
function switchTodaySubTab(tab) {
  const formTabBtn = document.getElementById("subtab-today-form");
  const historyTabBtn = document.getElementById("subtab-today-history");
  const formContainer = document.getElementById("today-form-container");
  const historyContainer = document.getElementById("today-history-container");

  if (!formTabBtn || !historyTabBtn || !formContainer || !historyContainer) return;

  if (tab === 'form') {
    formTabBtn.className = "btn btn-primary btn-sm";
    historyTabBtn.className = "btn btn-secondary btn-sm";
    formContainer.style.display = "block";
    historyContainer.style.display = "none";
  } else {
    formTabBtn.className = "btn btn-secondary btn-sm";
    historyTabBtn.className = "btn btn-primary btn-sm";
    formContainer.style.display = "none";
    historyContainer.style.display = "block";
    loadHistoryTable();
  }
  lucide.createIcons();
  disableOperatorInputs(isLicenseExpired);
}

// Builders dinâmicos de Entradas Bancárias
function addBankInflowRow(description = "", value = "", category = "pix", containerId = "bank-inflows-container") {
  const container = document.getElementById(containerId);
  if (!container) return;
  const rowId = `bank-inflow-row-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const row = document.createElement("div");
  row.className = "expense-row";
  row.id = rowId;

  row.innerHTML = `
    <div class="input-container">
      <label style="font-size: 11px;">Descrição</label>
      <input type="text" class="form-control bank-inflow-desc" placeholder="Ex: Recebimento Pix" value="${description}" required>
    </div>
    <div class="input-container">
      <label style="font-size: 11px;">Valor (R$)</label>
      <div class="input-wrapper">
        <span class="input-prefix" style="left: 8px;">R$</span>
        <input type="number" step="0.01" min="0.01" class="form-control bank-inflow-val form-control-prefix" style="padding-left: 28px;" placeholder="0,00" value="${value}" required>
      </div>
    </div>
    <div class="input-container">
      <label style="font-size: 11px;">Categoria</label>
      <select class="form-control bank-inflow-cat">
        <option value="pix" ${category === 'pix' ? 'selected' : ''}>Pix</option>
        <option value="transferencia" ${category === 'transferencia' ? 'selected' : ''}>Transferência</option>
        <option value="deposito" ${category === 'deposito' ? 'selected' : ''}>Depósito</option>
        <option value="outros" ${category === 'outros' ? 'selected' : ''}>Outros</option>
      </select>
    </div>
    <button type="button" class="btn-icon-danger" onclick="removeBankRow('${rowId}')" title="Excluir entrada" style="margin-top: 18px;">
      <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
    </button>
  `;

  container.appendChild(row);
  lucide.createIcons();
  disableOperatorInputs(isLicenseExpired);
}

// Builders dinâmicos de Saídas Bancárias
function addBankOutflowRow(description = "", value = "", category = "fornecedores", containerId = "bank-outflows-container") {
  const container = document.getElementById(containerId);
  if (!container) return;
  const rowId = `bank-outflow-row-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const row = document.createElement("div");
  row.className = "expense-row";
  row.id = rowId;

  row.innerHTML = `
    <div class="input-container">
      <label style="font-size: 11px;">Descrição</label>
      <input type="text" class="form-control bank-outflow-desc" placeholder="Ex: Pagamento Fornecedor" value="${description}" required>
    </div>
    <div class="input-container">
      <label style="font-size: 11px;">Valor (R$)</label>
      <div class="input-wrapper">
        <span class="input-prefix" style="left: 8px;">R$</span>
        <input type="number" step="0.01" min="0.01" class="form-control bank-outflow-val form-control-prefix" style="padding-left: 28px;" placeholder="0,00" value="${value}" required>
      </div>
    </div>
    <div class="input-container">
      <label style="font-size: 11px;">Categoria</label>
      <select class="form-control bank-outflow-cat">
        <option value="fornecedores" ${category === 'fornecedores' ? 'selected' : ''}>Fornecedores</option>
        <option value="salarios" ${category === 'salarios' ? 'selected' : ''}>Salários</option>
        <option value="impostos" ${category === 'impostos' ? 'selected' : ''}>Impostos</option>
        <option value="tarifas" ${category === 'tarifas' ? 'selected' : ''}>Tarifas</option>
        <option value="outros" ${category === 'outros' ? 'selected' : ''}>Outros</option>
      </select>
    </div>
    <button type="button" class="btn-icon-danger" onclick="removeBankRow('${rowId}')" title="Excluir saída" style="margin-top: 18px;">
      <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
    </button>
  `;

  container.appendChild(row);
  lucide.createIcons();
  disableOperatorInputs(isLicenseExpired);
}

function removeBankRow(rowId) {
  const row = document.getElementById(rowId);
  if (row) {
    row.classList.add("removing");
    setTimeout(() => {
      row.remove();
    }, 200);
  }
}

// Builders para formulário de Edição Bancária
function addEditBankInflowRow() {
  addBankInflowRow("", "", "pix", "edit-bank-inflows-container");
}

function addEditBankOutflowRow() {
  addBankOutflowRow("", "", "fornecedores", "edit-bank-outflows-container");
}

// Salvar Fechamento Bancário Diário
async function saveBankClosing(event) {
  event.preventDefault();

  // Verifica se a licença expirou
  if (isLicenseExpired && currentUser !== "mestre") {
    alert("⚠️ Licença Expirada: Seu aplicativo está em Modo Leitura. Para liberar a gravação de fechamentos, realize o pagamento de R$ 49,90 na aba 'Assinatura & Licença'.");
    return;
  }

  // Verifica modo de manutenção antes de salvar
  if (currentUser !== "mestre") {
    const isMaintenance = await dbGetMaintenanceMode();
    if (isMaintenance) {
      alert("⚠️ O sistema está em manutenção programada. Não é possível realizar lançamentos bancários no momento.");
      logoutUser();
      return;
    }
  }

  const dateInput = document.getElementById("bank-closing-date").value;
  if (!dateInput) {
    alert("Por favor, selecione uma data válida.");
    return;
  }

  const shiftInput = document.getElementById("bank-closing-shift").value;

  const existsIndex = bankClosingsData.findIndex(c => c.date === dateInput && (c.shift || "dia") === shiftInput);
  if (existsIndex !== -1) {
    const shiftLabel = shiftInput === "dia" ? "Dia" : "Noite";
    const confirmOverwrite = confirm(`Já existe um fechamento bancário cadastrado para o dia ${formatDate(dateInput)} no turno ${shiftLabel}. Deseja substituir os dados existentes?`);
    if (!confirmOverwrite) return;
  }

  const saveBtn = event.target.querySelector("button[type='submit']");
  const originalText = saveBtn.innerHTML;
  saveBtn.disabled = true;
  saveBtn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Gravando na nuvem...`;
  lucide.createIcons();

  const inflows = [];
  const inflowRows = document.querySelectorAll("#bank-inflows-container .expense-row");
  inflowRows.forEach(row => {
    const desc = row.querySelector(".bank-inflow-desc").value.trim();
    const val = parseFloat(row.querySelector(".bank-inflow-val").value) || 0;
    const cat = row.querySelector(".bank-inflow-cat").value;

    if (desc && val > 0) {
      inflows.push({ description: desc, value: val, category: cat });
    }
  });

  const outflows = [];
  const outflowRows = document.querySelectorAll("#bank-outflows-container .expense-row");
  outflowRows.forEach(row => {
    const desc = row.querySelector(".bank-outflow-desc").value.trim();
    const val = parseFloat(row.querySelector(".bank-outflow-val").value) || 0;
    const cat = row.querySelector(".bank-outflow-cat").value;

    if (desc && val > 0) {
      outflows.push({ description: desc, value: val, category: cat });
    }
  });

  const activeStoreName = localStorage.getItem(`gastrofecho_store_name_${currentUser}`) || "";
  const operatorNameInput = document.getElementById("bank-operator-name").value.trim();
  const notes = document.getElementById("bank-closing-notes").value.trim();

  const newBankClosing = {
    date: dateInput,
    shift: shiftInput,
    storeName: activeStoreName,
    operatorName: operatorNameInput,
    inflows: inflows,
    outflows: outflows,
    notes: notes
  };

  await saveBankDataToStorage(newBankClosing);

  // Pergunta se deseja enviar pelo WhatsApp antes de abrir
  const confirmWhatsApp = confirm("Deseja enviar o relatório de fechamento bancário via WhatsApp?");
  if (confirmWhatsApp) {
    const waText = getFormattedBankWhatsAppText(newBankClosing);
    const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(waText)}`;
    window.open(waUrl, '_blank');
  }

  saveBtn.disabled = false;
  saveBtn.innerHTML = originalText;

  resetBankForm();
  switchBankSubTab('history');
  viewBankDetails(newBankClosing.date, newBankClosing.shift);
}

// Resetar o Formulário Bancário
function resetBankForm() {
  const currentOperatorName = document.getElementById("bank-operator-name")?.value || "";
  
  const form = document.getElementById("bank-closing-form");
  if (form) form.reset();
  
  const today = new Date().toISOString().split('T')[0];
  const dateInput = document.getElementById("bank-closing-date");
  if (dateInput) dateInput.value = today;

  const operatorInput = document.getElementById("bank-operator-name");
  if (operatorInput) operatorInput.value = currentOperatorName;

  const inflowsContainer = document.getElementById("bank-inflows-container");
  const outflowsContainer = document.getElementById("bank-outflows-container");
  
  if (inflowsContainer) inflowsContainer.innerHTML = "";
  if (outflowsContainer) outflowsContainer.innerHTML = "";

  addBankInflowRow();
  addBankOutflowRow();
  disableOperatorInputs(isLicenseExpired);
}

// Renderizar Histórico Bancário
function loadBankHistoryTable() {
  const tbody = document.getElementById("bank-history-body");
  const emptyCards = document.getElementById("bank-history-mobile-cards");
  const table = document.getElementById("bank-history-table");

  if (!tbody) return;

  tbody.innerHTML = "";
  if (emptyCards) emptyCards.innerHTML = "";

  if (bankClosingsData.length === 0) {
    if (table) table.style.display = "none";
    if (emptyCards) {
      emptyCards.style.display = "block";
      emptyCards.innerHTML = `<div style="text-align: center; padding: 30px; color: var(--text-secondary); font-style: italic;">Nenhum fechamento bancário registrado ainda.</div>`;
    }
    return;
  }

  if (table) table.style.display = "table";
  if (emptyCards) emptyCards.style.display = "none";

  bankClosingsData.forEach(day => {
    let totalInflows = 0;
    day.inflows.forEach(i => totalInflows += i.value);

    let totalOutflows = 0;
    day.outflows.forEach(o => totalOutflows += o.value);

    const net = totalInflows - totalOutflows;
    const netClass = net >= 0 ? "text-revenue bold" : "text-expense bold";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="bold">
        ${formatDate(day.date)}
        <span class="badge ${day.shift === 'noite' ? 'badge-expense' : 'badge-revenue'}" style="font-size: 10px; padding: 2px 6px; margin-left: 6px; vertical-align: middle;">
          ${day.shift === 'noite' ? '🌙 Noite' : '☀️ Dia'}
        </span>
      </td>
      <td class="text-revenue" style="text-align: right;">${formatCurrency(totalInflows)}</td>
      <td class="text-expense" style="text-align: right;">${formatCurrency(totalOutflows)}</td>
      <td class="${netClass}" style="text-align: right;">${formatCurrency(net)}</td>
      <td style="color: var(--text-secondary); font-size: 13px;">${day.operatorName || '--'}</td>
      <td class="table-actions" style="justify-content: center;">
        <button class="btn btn-secondary btn-sm" onclick="viewBankDetails('${day.date}', '${day.shift || 'dia'}')" title="Visualizar Completo">
          <i data-lucide="eye" style="width: 14px; height: 14px;"></i>
        </button>
        <button class="btn btn-success btn-sm" onclick="shareBankWhatsAppDirect('${day.date}', '${day.shift || 'dia'}')" title="Enviar via WhatsApp" style="background: rgba(37, 211, 102, 0.12); color: #25d366; border-color: rgba(37, 211, 102, 0.2);">
          <i data-lucide="message-square" style="width: 14px; height: 14px;"></i>
        </button>
        <button class="btn btn-success btn-sm" onclick="editBankClosing('${day.date}', '${day.shift || 'dia'}')" title="Editar Lançamento">
          <i data-lucide="edit-3" style="width: 14px; height: 14px;"></i>
        </button>
        <button class="btn btn-danger btn-sm" onclick="deleteBankClosing('${day.date}', '${day.shift || 'dia'}')" title="Excluir Lançamento">
          <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);

    if (emptyCards) {
      const card = document.createElement("div");
      card.className = "mobile-card";
      card.style.cssText = "background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-glass); border-radius: var(--radius-md); padding: 16px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 8px;";
      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <strong style="color: #fff;">${formatDate(day.date)}</strong>
          <span class="badge ${day.shift === 'noite' ? 'badge-expense' : 'badge-revenue'}">${day.shift === 'noite' ? '🌙 Noite' : '☀️ Dia'}</span>
        </div>
        <div style="font-size: 13px; color: var(--text-secondary);">Operador: ${day.operatorName}</div>
        <div style="display: flex; justify-content: space-between; font-size: 13px;">
          <span class="text-revenue">Entradas: ${formatCurrency(totalInflows)}</span>
          <span class="text-expense">Saídas: ${formatCurrency(totalOutflows)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 14px; border-top: 1px solid var(--border-glass); padding-top: 6px; font-weight: 700;">
          <span>Saldo Líquido:</span>
          <span class="${netClass}">${formatCurrency(net)}</span>
        </div>
        <div style="display: flex; gap: 8px; margin-top: 8px; justify-content: flex-end;">
          <button class="btn btn-secondary btn-sm" onclick="viewBankDetails('${day.date}', '${day.shift || 'dia'}')"><i data-lucide="eye" style="width:12px;height:12px"></i></button>
          <button class="btn btn-success btn-sm" onclick="shareBankWhatsAppDirect('${day.date}', '${day.shift || 'dia'}')" style="background: rgba(37, 211, 102, 0.12); color: #25d366; border-color: rgba(37, 211, 102, 0.2);"><i data-lucide="message-square" style="width:12px;height:12px"></i></button>
          <button class="btn btn-success btn-sm" onclick="editBankClosing('${day.date}', '${day.shift || 'dia'}')"><i data-lucide="edit-3" style="width:12px;height:12px"></i></button>
          <button class="btn btn-danger btn-sm" onclick="deleteBankClosing('${day.date}', '${day.shift || 'dia'}')"><i data-lucide="trash-2" style="width:12px;height:12px"></i></button>
        </div>
      `;
      emptyCards.appendChild(card);
    }
  });

  const handleResize = () => {
    if (window.innerWidth <= 768) {
      if (table) table.style.display = "none";
      if (emptyCards && bankClosingsData.length > 0) emptyCards.style.display = "block";
    } else {
      if (table && bankClosingsData.length > 0) table.style.display = "table";
      if (emptyCards) emptyCards.style.display = "none";
    }
  };
  window.addEventListener('resize', handleResize);
  handleResize();

  lucide.createIcons();
  disableOperatorInputs(isLicenseExpired);
}

// WhatsApp Report Text Generator for Bank Closing
function getFormattedBankWhatsAppText(day) {
  let totalInflows = 0;
  day.inflows.forEach(i => totalInflows += i.value);

  let totalOutflows = 0;
  day.outflows.forEach(o => totalOutflows += o.value);

  const net = totalInflows - totalOutflows;
  const statusStr = net >= 0 ? "🟢 Saldo Positivo" : "🔴 Saldo Negativo";
  const shiftLabel = (day.shift || "dia") === "noite" ? "🌙 Noite" : "☀️ Dia";

  const activeStoreName = localStorage.getItem(`gastrofecho_store_name_${currentUser}`) || day.storeName || "Não informada";

  let text = `🏪 *FECHOU! - FECHAMENTO BANCÁRIO DIÁRIO*\n`;
  text += `🏪 *Loja:* ${activeStoreName}\n`;
  text += `👤 *Responsável:* ${day.operatorName || "Não informado"}\n`;
  text += `📅 *Data:* ${formatDate(day.date)} (${shiftLabel})\n\n`;

  text += `📥 *SOMA DAS ENTRADAS: ${formatCurrency(totalInflows)}*\n`;
  if (day.inflows.length > 0) {
    day.inflows.forEach(i => {
      text += `  • ${i.description} (${BANK_INFLOW_CATEGORIES[i.category] || i.category}): ${formatCurrency(i.value)}\n`;
    });
  } else {
    text += `  • Nenhuma entrada registrada.\n`;
  }
  text += `\n`;

  text += `📤 *SOMA DAS SAÍDAS: ${formatCurrency(totalOutflows)}*\n`;
  if (day.outflows.length > 0) {
    day.outflows.forEach(o => {
      text += `  • ${o.description} (${BANK_OUTFLOW_CATEGORIES[o.category] || o.category}): ${formatCurrency(o.value)}\n`;
    });
  } else {
    text += `  • Nenhuma saída registrada.\n`;
  }
  text += `\n`;

  text += `⚖️ *SALDO LÍQUIDO FINAL: ${formatCurrency(net)}* (${statusStr})\n\n`;

  if (day.notes) {
    text += `📝 *Observações:* \n_${day.notes}_\n`;
  }
  
  return text;
}

// WhatsApp Shares para Fechamento Bancário
let currentViewBankDate = "";
let currentViewBankShift = "";

function shareBankWhatsApp() {
  const day = bankClosingsData.find(c => c.date === currentViewBankDate && (c.shift || "dia") === currentViewBankShift);
  if (!day) return;
  const text = getFormattedBankWhatsAppText(day);
  const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
  window.open(waUrl, '_blank');
}

function shareBankWhatsAppDirect(dateStr, shiftStr = "dia") {
  const day = bankClosingsData.find(c => c.date === dateStr && (c.shift || "dia") === shiftStr);
  if (!day) return;
  const text = getFormattedBankWhatsAppText(day);
  const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
  window.open(waUrl, '_blank');
}

// Modal de Detalhes de Fechamento Bancário
function viewBankDetails(dateStr, shiftStr = "dia") {
  const day = bankClosingsData.find(c => c.date === dateStr && (c.shift || "dia") === shiftStr);
  if (!day) return;

  currentViewBankDate = dateStr;
  currentViewBankShift = shiftStr;

  const shiftLabel = shiftStr === "noite" ? "🌙 Noite" : "☀️ Dia";
  document.getElementById("modal-bank-details-title").textContent = `Detalhamento Bancário — ${formatDate(day.date)} [${shiftLabel}]`;

  let totalInflows = 0;
  day.inflows.forEach(i => totalInflows += i.value);

  let totalOutflows = 0;
  day.outflows.forEach(o => totalOutflows += o.value);

  const net = totalInflows - totalOutflows;
  const netBadge = net >= 0 ? "badge-revenue" : "badge-expense";

  let inflowsHtml = "";
  day.inflows.forEach(i => {
    inflowsHtml += `
      <li class="detail-item" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-glass); padding: 8px 0;">
        <span>${i.description} <small style="color:var(--text-muted)">(${BANK_INFLOW_CATEGORIES[i.category] || i.category})</small>:</span>
        <span class="text-revenue bold">${formatCurrency(i.value)}</span>
      </li>
    `;
  });
  if (!inflowsHtml) inflowsHtml = `<li style="font-style: italic; color: var(--text-muted); font-size:13px">Nenhuma entrada registrada</li>`;

  let outflowsHtml = "";
  day.outflows.forEach(o => {
    outflowsHtml += `
      <li class="detail-item" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-glass); padding: 8px 0;">
        <span>${o.description} <small style="color:var(--text-muted)">(${BANK_OUTFLOW_CATEGORIES[o.category] || o.category})</small>:</span>
        <span class="text-expense bold">${formatCurrency(o.value)}</span>
      </li>
    `;
  });
  if (!outflowsHtml) outflowsHtml = `<li style="font-style: italic; color: var(--text-muted); font-size:13px">Nenhuma saída registrada</li>`;

  const body = document.getElementById("modal-bank-details-body");
  body.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-glass); border-radius: var(--radius-md); padding: 16px;">
      <div>
        <p style="font-size: 11px; text-transform: uppercase; color: var(--text-secondary);">Loja: ${day.storeName || 'Não informada'} | Responsável: ${day.operatorName || 'Não informado'} | Turno: ${shiftLabel}</p>
        <p style="font-size: 11px; text-transform: uppercase; color: var(--text-secondary); margin-top: 4px;">Saldo Líquido Bancário</p>
        <h2 style="font-family: var(--font-title); font-size: 26px; font-weight: 800; color: #fff;">${formatCurrency(net)}</h2>
      </div>
      <span class="badge ${netBadge}" style="padding: 6px 12px; font-size:12px">${net >= 0 ? 'Surplus Bancário' : 'Déficit Bancário'}</span>
    </div>

    <div class="detail-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px;">
      <div class="detail-section">
        <h4 style="margin-bottom:12px; font-size: 14px; font-weight:700; color: var(--color-revenue);"><i data-lucide="arrow-up-right" style="width:16px;height:16px;vertical-align:middle;margin-right:6px"></i> Entradas Bancárias</h4>
        <ul class="detail-list" style="list-style: none; padding: 0;">
          ${inflowsHtml}
          <li class="detail-item" style="border-top: 1px solid var(--border-glass); padding-top: 8px; margin-top: 8px; font-weight: 700; display: flex; justify-content: space-between;">
            <span>Total Entradas:</span>
            <span class="text-revenue">${formatCurrency(totalInflows)}</span>
          </li>
        </ul>
      </div>

      <div class="detail-section">
        <h4 style="margin-bottom:12px; font-size: 14px; font-weight:700; color: var(--color-expense);"><i data-lucide="arrow-down-left" style="width:16px;height:16px;vertical-align:middle;margin-right:6px"></i> Saídas Bancárias</h4>
        <ul class="detail-list" style="list-style: none; padding: 0;">
          ${outflowsHtml}
          <li class="detail-item" style="border-top: 1px solid var(--border-glass); padding-top: 8px; margin-top: 8px; font-weight: 700; display: flex; justify-content: space-between;">
            <span>Total Saídas:</span>
            <span class="text-expense">${formatCurrency(totalOutflows)}</span>
          </li>
        </ul>
      </div>
    </div>

    <div class="detail-section" style="margin-top: 20px;">
      <h4 style="margin-bottom:8px; font-size: 14px; font-weight:700;"><i data-lucide="file-text" style="width:16px;height:16px;vertical-align:middle;margin-right:6px"></i> Observações Bancárias</h4>
      <p style="font-size: 13px; color: var(--text-secondary); line-height: 1.5; white-space: pre-line;">
        ${day.notes || '<span style="color: var(--text-muted); font-style: italic;">Nenhuma observação registrada para este dia.</span>'}
      </p>
    </div>
  `;

  openModal("modal-bank-details");
  lucide.createIcons();
}

// Excluir Fechamento Bancário Diário
async function deleteBankClosing(dateStr, shiftStr = "dia") {
  // Verifica se a licença expirou
  if (isLicenseExpired && currentUser !== "mestre") {
    alert("⚠️ Licença Expirada: Seu aplicativo está em Modo Leitura. Para liberar a exclusão de fechamentos bancários, realize o pagamento de R$ 49,90 na aba 'Assinatura & Licença'.");
    return;
  }

  const shiftLabel = shiftStr === "noite" ? "Noite" : "Dia";
  const inputPass = prompt(`Digite a Senha Administrativa para autorizar a EXCLUSÃO do fechamento bancário do dia ${formatDate(dateStr)} (${shiftLabel}):`);
  if (inputPass === null) return;

  try {
    const users = await dbGetUsers();
    const user = users.find(u => u.username.toLowerCase() === currentUser.toLowerCase());
    if (!user) {
      alert("Erro ao validar permissões do usuário.");
      return;
    }

    const expectedPass = user.adminPassword || "";
    if (inputPass !== expectedPass) {
      alert("Senha Administrativa Incorreta! Acesso negado.");
      return;
    }

    const confirmDelete = confirm(`Tem certeza que deseja apagar permanentemente o fechamento bancário do dia ${formatDate(dateStr)} (${shiftLabel})?`);
    if (!confirmDelete) return;

    const updatedClosings = bankClosingsData.filter(c => !(c.date === dateStr && (c.shift || "dia") === shiftStr));
    await dbSetBankClosings(currentUser, updatedClosings);

    bankClosingsData = updatedClosings;
    loadBankHistoryTable();
    alert("Fechamento bancário apagado com sucesso.");
  } catch (error) {
    console.error("Erro ao excluir fechamento bancário na nuvem:", error);
    alert("Ocorreu um erro ao excluir o lançamento bancário. Verifique sua conexão.");
  }
}

// Editar Fechamento Bancário Diário
async function editBankClosing(dateStr, shiftStr = "dia") {
  const day = bankClosingsData.find(c => c.date === dateStr && (c.shift || "dia") === shiftStr);
  if (!day) return;

  const shiftLabel = shiftStr === "noite" ? "Noite" : "Dia";
  const inputPass = prompt(`Digite a Senha Administrativa para autorizar a EDIÇÃO do fechamento bancário do dia ${formatDate(dateStr)} (${shiftLabel}):`);
  if (inputPass === null) return;

  try {
    const users = await dbGetUsers();
    const user = users.find(u => u.username.toLowerCase() === currentUser.toLowerCase());
    if (!user) {
      alert("Erro ao validar permissões do usuário.");
      return;
    }

    const expectedPass = user.adminPassword || "";
    if (inputPass !== expectedPass) {
      alert("Senha Administrativa Incorreta! Acesso negado.");
      return;
    }
  } catch (error) {
    console.error("Erro ao validar senha administrativa:", error);
    alert("Falha de conexão ao validar permissões.");
    return;
  }

  document.getElementById("edit-bank-original-date").value = day.date;
  document.getElementById("edit-bank-original-shift").value = day.shift || "dia";
  document.getElementById("edit-bank-closing-shift").value = day.shift || "dia";
  document.getElementById("edit-bank-operator-name").value = day.operatorName || "";
  document.getElementById("edit-bank-closing-notes").value = day.notes || "";

  const editInflowsContainer = document.getElementById("edit-bank-inflows-container");
  const editOutflowsContainer = document.getElementById("edit-bank-outflows-container");

  if (editInflowsContainer) editInflowsContainer.innerHTML = "";
  if (editOutflowsContainer) editOutflowsContainer.innerHTML = "";

  let hasInflows = false;
  if (day.inflows && day.inflows.length > 0) {
    day.inflows.forEach(i => {
      addBankInflowRow(i.description, i.value, i.category, "edit-bank-inflows-container");
      hasInflows = true;
    });
  }
  if (!hasInflows) {
    addBankInflowRow("", "", "pix", "edit-bank-inflows-container");
  }

  let hasOutflows = false;
  if (day.outflows && day.outflows.length > 0) {
    day.outflows.forEach(o => {
      addBankOutflowRow(o.description, o.value, o.category, "edit-bank-outflows-container");
      hasOutflows = true;
    });
  }
  if (!hasOutflows) {
    addBankOutflowRow("", "", "fornecedores", "edit-bank-outflows-container");
  }

  openModal("modal-bank-edit");
  lucide.createIcons();
}

async function saveEditBankClosing(event) {
  event.preventDefault();

  // Verifica se a licença expirou
  if (isLicenseExpired && currentUser !== "mestre") {
    alert("⚠️ Licença Expirada: Seu aplicativo está em Modo Leitura. Para liberar a edição de fechamentos bancários, realize o pagamento de R$ 49,90 na aba 'Assinatura & Licença'.");
    return;
  }

  const originalDate = document.getElementById("edit-bank-original-date").value;
  const originalShift = document.getElementById("edit-bank-original-shift").value;
  const targetShift = document.getElementById("edit-bank-closing-shift").value;

  const index = bankClosingsData.findIndex(c => c.date === originalDate && (c.shift || "dia") === originalShift);
  if (index === -1) return;

  if (targetShift !== originalShift) {
    const shiftExists = bankClosingsData.some(c => c.date === originalDate && (c.shift || "dia") === targetShift);
    if (shiftExists) {
      const targetShiftLabel = targetShift === "noite" ? "Noite" : "Dia";
      alert(`Já existe um fechamento bancário cadastrado para o dia ${formatDate(originalDate)} no turno ${targetShiftLabel}. Não é possível alterar.`);
      return;
    }
  }

  const saveBtn = event.target.querySelector("button[type='submit']");
  const originalText = saveBtn.innerHTML;
  saveBtn.disabled = true;
  saveBtn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Atualizando...`;
  lucide.createIcons();

  const inflows = [];
  const inflowRows = document.querySelectorAll("#edit-bank-inflows-container .expense-row");
  inflowRows.forEach(row => {
    const desc = row.querySelector(".bank-inflow-desc").value.trim();
    const val = parseFloat(row.querySelector(".bank-inflow-val").value) || 0;
    const cat = row.querySelector(".bank-inflow-cat").value;

    if (desc && val > 0) {
      inflows.push({ description: desc, value: val, category: cat });
    }
  });

  const outflows = [];
  const outflowRows = document.querySelectorAll("#edit-bank-outflows-container .expense-row");
  outflowRows.forEach(row => {
    const desc = row.querySelector(".bank-outflow-desc").value.trim();
    const val = parseFloat(row.querySelector(".bank-outflow-val").value) || 0;
    const cat = row.querySelector(".bank-outflow-cat").value;

    if (desc && val > 0) {
      outflows.push({ description: desc, value: val, category: cat });
    }
  });

  const activeStoreName = localStorage.getItem(`gastrofecho_store_name_${currentUser}`) || "";
  const operatorName = document.getElementById("edit-bank-operator-name").value.trim();
  const notes = document.getElementById("edit-bank-closing-notes").value.trim();

  const updatedClosing = {
    date: originalDate,
    shift: targetShift,
    storeName: activeStoreName,
    operatorName: operatorName,
    inflows: inflows,
    outflows: outflows,
    notes: notes
  };

  await saveBankDataToStorage(updatedClosing, originalShift);

  saveBtn.disabled = false;
  saveBtn.innerHTML = originalText;

  closeModal("modal-bank-edit");
  loadBankHistoryTable();
  alert("Alterações bancárias salvas com sucesso!");
}

// =====================================================================
// FECHAMENTO MENSAL / CONSOLIDADO PERIÓDICO
// =====================================================================

// Inicializar Datas Padrão do Fechamento Periódico (1º dia do mês até hoje)
function initMonthlyClosingDates() {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  
  const firstDay = new Date(y, m, 1).toISOString().split('T')[0];
  const lastDay = today.toISOString().split('T')[0];
  
  const startInput = document.getElementById("monthly-start-date");
  const endInput = document.getElementById("monthly-end-date");
  
  if (startInput) startInput.value = firstDay;
  if (endInput) endInput.value = lastDay;
  
  // Oculta container de resultados até gerar
  const reportContainer = document.getElementById("monthly-report-container");
  const emptyState = document.getElementById("monthly-empty-state");
  if (reportContainer) reportContainer.style.display = "none";
  if (emptyState) emptyState.style.display = "block";
}

// Processar e Gerar o Fechamento Consolidado do Período
function loadMonthlyClosingReport() {
  const startInput = document.getElementById("monthly-start-date").value;
  const endInput = document.getElementById("monthly-end-date").value;

  if (!startInput || !endInput) {
    alert("Por favor, insira as datas de início e fim.");
    return;
  }
  if (startInput > endInput) {
    alert("A data inicial não pode ser posterior à data final.");
    return;
  }

  // Filtragem de dados por data
  const filteredCash = closingsData.filter(day => day.date >= startInput && day.date <= endInput);
  const filteredBank = bankClosingsData.filter(day => day.date >= startInput && day.date <= endInput);

  // 1. Somatório do Caixa Físico
  let totalCashRevenue = 0;
  let cashRevenueByChannel = {};
  Object.keys(REVENUE_CHANNELS).forEach(k => cashRevenueByChannel[k] = 0);

  let totalGeneralExpenses = 0;
  let totalVales = 0;
  let expensesByCategory = {
    carne: 0,
    alimentos: 0,
    limpeza: 0,
    outros: 0,
    vales: 0
  };
  let valesByEmployee = {};

  filteredCash.forEach(day => {
    // Soma receitas
    Object.keys(day.revenues).forEach(k => {
      const val = day.revenues[k] || 0;
      totalCashRevenue += val;
      if (cashRevenueByChannel[k] !== undefined) {
        cashRevenueByChannel[k] += val;
      }
    });

    // Soma despesas
    day.expenses.forEach(e => {
      const val = e.value || 0;
      if (e.category === "vales") {
        totalVales += val;
        expensesByCategory.vales += val;

        // Agregar por funcionário
        const empName = e.description.trim();
        if (empName) {
          const key = empName.toLowerCase();
          if (!valesByEmployee[key]) {
            valesByEmployee[key] = {
              name: empName,
              total: 0,
              items: []
            };
          }
          valesByEmployee[key].total += val;
          valesByEmployee[key].items.push({
            date: day.date,
            shift: day.shift || "dia",
            description: e.description,
            value: val
          });
        }
      } else {
        totalGeneralExpenses += val;
        if (expensesByCategory[e.category] !== undefined) {
          expensesByCategory[e.category] += val;
        } else {
          expensesByCategory.outros += val;
        }
      }
    });
  });

  const cashNetProfit = totalCashRevenue - (totalGeneralExpenses + totalVales);

  // 2. Somatório do Banco Diário
  let totalBankInflows = 0;
  let bankInflowsByCategory = {
    pix: 0,
    transferencia: 0,
    deposito: 0,
    outros: 0
  };

  let totalBankOutflows = 0;
  let bankOutflowsByCategory = {
    fornecedores: 0,
    salarios: 0,
    impostos: 0,
    tarifas: 0,
    outros: 0
  };

  filteredBank.forEach(day => {
    // Entradas Bancárias
    day.inflows.forEach(i => {
      const val = i.value || 0;
      totalBankInflows += val;
      if (bankInflowsByCategory[i.category] !== undefined) {
        bankInflowsByCategory[i.category] += val;
      } else {
        bankInflowsByCategory.outros += val;
      }
    });

    // Saídas Bancárias
    day.outflows.forEach(o => {
      const val = o.value || 0;
      totalBankOutflows += val;
      if (bankOutflowsByCategory[o.category] !== undefined) {
        bankOutflowsByCategory[o.category] += val;
      } else {
        bankOutflowsByCategory.outros += val;
      }
    });
  });

  const bankNetProfit = totalBankInflows - totalBankOutflows;
  const globalConsolidatedBalance = cashNetProfit + bankNetProfit;

  // 3. Atualizar elementos visuais
  document.getElementById("monthly-kpi-cash-net").textContent = formatCurrency(cashNetProfit);
  document.getElementById("monthly-kpi-bank-net").textContent = formatCurrency(bankNetProfit);
  
  const consolidatedKpi = document.getElementById("monthly-kpi-consolidated");
  consolidatedKpi.textContent = formatCurrency(globalConsolidatedBalance);

  // Cores de status reativos
  const cashStatus = document.getElementById("monthly-kpi-cash-status");
  cashStatus.className = "kpi-status " + (cashNetProfit >= 0 ? "status-positive" : "status-negative");
  cashStatus.innerHTML = cashNetProfit >= 0 ? `<span>Lucro Caixa</span>` : `<span>Déficit Caixa</span>`;

  const bankStatus = document.getElementById("monthly-kpi-bank-status");
  bankStatus.className = "kpi-status " + (bankNetProfit >= 0 ? "status-positive" : "status-negative");
  bankStatus.innerHTML = bankNetProfit >= 0 ? `<span>Surplus Banco</span>` : `<span>Déficit Banco</span>`;

  const consolidatedStatus = document.getElementById("monthly-kpi-consolidated-status");
  consolidatedStatus.className = "kpi-status " + (globalConsolidatedBalance >= 0 ? "status-positive" : "status-negative");
  consolidatedStatus.innerHTML = globalConsolidatedBalance >= 0 ? `<span>Resultado Positivo</span>` : `<span>Resultado Negativo</span>`;

  // Renderizar detalhamento das Entradas (Esquerda)
  const inflowsList = document.getElementById("monthly-inflows-list");
  let inflowsHtml = "";

  inflowsHtml += `<h4 style="font-size: 12px; font-weight: 700; color: var(--text-secondary); margin-bottom: 8px;">Faturamento de Caixa:</h4>`;
  let hasRevenues = false;
  Object.keys(cashRevenueByChannel).forEach(k => {
    const val = cashRevenueByChannel[k];
    if (val > 0) {
      const channelLabel = REVENUE_CHANNELS[k]?.label || k;
      inflowsHtml += `
        <div style="display: flex; justify-content: space-between; font-size: 13px; padding: 6px 0; border-bottom: 1px dashed var(--border-glass);">
          <span>${channelLabel}:</span>
          <span class="text-revenue bold">${formatCurrency(val)}</span>
        </div>
      `;
      hasRevenues = true;
    }
  });
  if (!hasRevenues) {
    inflowsHtml += `<div style="font-size: 12px; color: var(--text-muted); font-style: italic; margin-bottom: 12px;">Sem receitas registradas no período.</div>`;
  } else {
    inflowsHtml += `
      <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: 700; padding: 8px 0 14px 0; border-bottom: 1px solid var(--border-glass);">
        <span>Subtotal Caixa Físico:</span>
        <span class="text-revenue">${formatCurrency(totalCashRevenue)}</span>
      </div>
    `;
  }

  inflowsHtml += `<h4 style="font-size: 12px; font-weight: 700; color: var(--text-secondary); margin: 16px 0 8px 0;">Entradas Bancárias:</h4>`;
  let hasBankInflows = false;
  Object.keys(bankInflowsByCategory).forEach(k => {
    const val = bankInflowsByCategory[k];
    if (val > 0) {
      const catLabel = BANK_INFLOW_CATEGORIES[k] || k;
      inflowsHtml += `
        <div style="display: flex; justify-content: space-between; font-size: 13px; padding: 6px 0; border-bottom: 1px dashed var(--border-glass);">
          <span>${catLabel}:</span>
          <span class="text-revenue bold">${formatCurrency(val)}</span>
        </div>
      `;
      hasBankInflows = true;
    }
  });
  if (!hasBankInflows) {
    inflowsHtml += `<div style="font-size: 12px; color: var(--text-muted); font-style: italic; margin-bottom: 12px;">Sem entradas em banco registradas.</div>`;
  } else {
    inflowsHtml += `
      <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: 700; padding: 8px 0 0 0;">
        <span>Subtotal Entradas Banco:</span>
        <span class="text-revenue">${formatCurrency(totalBankInflows)}</span>
      </div>
    `;
  }
  inflowsList.innerHTML = inflowsHtml;

  // Renderizar detalhamento das Saídas (Direita)
  const outflowsList = document.getElementById("monthly-outflows-list");
  let outflowsHtml = "";

  outflowsHtml += `<h4 style="font-size: 12px; font-weight: 700; color: var(--text-secondary); margin-bottom: 8px;">Saídas e Vales de Caixa:</h4>`;
  let hasExpenses = false;
  Object.keys(expensesByCategory).forEach(k => {
    const val = expensesByCategory[k];
    if (val > 0) {
      const catLabel = k === 'vales' ? 'Vales de Funcionários' : (EXPENSE_CATEGORIES[k] || k);
      outflowsHtml += `
        <div style="display: flex; justify-content: space-between; font-size: 13px; padding: 6px 0; border-bottom: 1px dashed var(--border-glass);">
          <span>${catLabel}:</span>
          <span class="text-expense bold">${formatCurrency(val)}</span>
        </div>
      `;
      hasExpenses = true;
    }
  });
  if (!hasExpenses) {
    outflowsHtml += `<div style="font-size: 12px; color: var(--text-muted); font-style: italic; margin-bottom: 12px;">Sem saídas de caixa registradas.</div>`;
  } else {
    outflowsHtml += `
      <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: 700; padding: 8px 0 14px 0; border-bottom: 1px solid var(--border-glass);">
        <span>Subtotal Despesas Caixa:</span>
        <span class="text-expense">${formatCurrency(totalGeneralExpenses + totalVales)}</span>
      </div>
    `;
  }

  outflowsHtml += `<h4 style="font-size: 12px; font-weight: 700; color: var(--text-secondary); margin: 16px 0 8px 0;">Saídas Bancárias:</h4>`;
  let hasBankOutflows = false;
  Object.keys(bankOutflowsByCategory).forEach(k => {
    const val = bankOutflowsByCategory[k];
    if (val > 0) {
      const catLabel = BANK_OUTFLOW_CATEGORIES[k] || k;
      outflowsHtml += `
        <div style="display: flex; justify-content: space-between; font-size: 13px; padding: 6px 0; border-bottom: 1px dashed var(--border-glass);">
          <span>${catLabel}:</span>
          <span class="text-expense bold">${formatCurrency(val)}</span>
        </div>
      `;
      hasBankOutflows = true;
    }
  });
  if (!hasBankOutflows) {
    outflowsHtml += `<div style="font-size: 12px; color: var(--text-muted); font-style: italic; margin-bottom: 12px;">Sem saídas em banco registradas.</div>`;
  } else {
    outflowsHtml += `
      <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: 700; padding: 8px 0 0 0;">
        <span>Subtotal Saídas Banco:</span>
        <span class="text-expense">${formatCurrency(totalBankOutflows)}</span>
      </div>
    `;
  }
  outflowsList.innerHTML = outflowsHtml;

  // Ordena os itens de vales de cada funcionário por data
  Object.keys(valesByEmployee).forEach(key => {
    valesByEmployee[key].items.sort((a, b) => new Date(a.date) - new Date(b.date));
  });

  // Guardar na janela global
  window.currentPeriodValesData = valesByEmployee;

  // Renderizar a tabela consolidada de vales por funcionário
  const valesBody = document.getElementById("monthly-vales-body");
  const valesTable = document.getElementById("monthly-vales-table");
  const valesEmpty = document.getElementById("monthly-vales-empty-state");

  if (valesBody && valesTable && valesEmpty) {
    valesBody.innerHTML = "";
    const employeeKeys = Object.keys(valesByEmployee).sort((a, b) => valesByEmployee[b].total - valesByEmployee[a].total);

    if (employeeKeys.length === 0) {
      valesTable.style.display = "none";
      valesEmpty.style.display = "block";
    } else {
      valesTable.style.display = "table";
      valesEmpty.style.display = "none";

      employeeKeys.forEach(key => {
        const emp = valesByEmployee[key];
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td class="bold text-main" style="padding: 12px 8px;">${emp.name}</td>
          <td style="text-align: right; padding: 12px 8px;">${emp.items.length} ${emp.items.length === 1 ? 'vale' : 'vales'}</td>
          <td class="text-expense bold" style="text-align: right; padding: 12px 8px;">${formatCurrency(emp.total)}</td>
          <td class="table-actions" style="text-align: center; justify-content: center; gap: 8px; padding: 6px 8px;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="viewEmployeeValesDetails('${key}')" title="Ver Detalhamento" style="height: 28px; font-size: 11px;">
              <i data-lucide="eye" style="width: 12px; height: 12px; vertical-align: middle;"></i> Ver Detalhes
            </button>
            <button type="button" class="btn btn-success btn-sm" onclick="shareEmployeeValesWhatsAppDirect('${key}')" title="Enviar Relatório via WhatsApp" style="background: rgba(37, 211, 102, 0.12); color: #25d366; border-color: rgba(37, 211, 102, 0.2); height: 28px; font-size: 11px;">
              <i data-lucide="message-square" style="width: 12px; height: 12px; vertical-align: middle;"></i> WhatsApp
            </button>
          </td>
        `;
        valesBody.appendChild(tr);
      });
    }
  }

  // Exibir o container de resultados
  document.getElementById("monthly-report-container").style.display = "block";
  document.getElementById("monthly-empty-state").style.display = "none";
  
  lucide.createIcons();
  disableOperatorInputs(isLicenseExpired);
}

// Compartilhar Relatório Periódico Consolidado via WhatsApp
function shareMonthlyReportWhatsApp() {
  const startInput = document.getElementById("monthly-start-date").value;
  const endInput = document.getElementById("monthly-end-date").value;

  if (!startInput || !endInput) return;

  const filteredCash = closingsData.filter(day => day.date >= startInput && day.date <= endInput);
  const filteredBank = bankClosingsData.filter(day => day.date >= startInput && day.date <= endInput);

  let totalCashRevenue = 0;
  let cashRevenueByChannel = {};
  Object.keys(REVENUE_CHANNELS).forEach(k => cashRevenueByChannel[k] = 0);

  let totalGeneralExpenses = 0;
  let totalVales = 0;
  let expensesByCategory = { carne: 0, alimentos: 0, limpeza: 0, outros: 0, vales: 0 };

  filteredCash.forEach(day => {
    Object.keys(day.revenues).forEach(k => {
      const val = day.revenues[k] || 0;
      totalCashRevenue += val;
      if (cashRevenueByChannel[k] !== undefined) cashRevenueByChannel[k] += val;
    });

    day.expenses.forEach(e => {
      const val = e.value || 0;
      if (e.category === "vales") {
        totalVales += val;
        expensesByCategory.vales += val;
      } else {
        totalGeneralExpenses += val;
        if (expensesByCategory[e.category] !== undefined) expensesByCategory[e.category] += val;
        else expensesByCategory.outros += val;
      }
    });
  });

  const cashNetProfit = totalCashRevenue - (totalGeneralExpenses + totalVales);

  let totalBankInflows = 0;
  let bankInflowsByCategory = { pix: 0, transferencia: 0, deposito: 0, outros: 0 };
  let totalBankOutflows = 0;
  let bankOutflowsByCategory = { fornecedores: 0, salarios: 0, impostos: 0, tarifas: 0, outros: 0 };

  filteredBank.forEach(day => {
    day.inflows.forEach(i => {
      const val = i.value || 0;
      totalBankInflows += val;
      if (bankInflowsByCategory[i.category] !== undefined) bankInflowsByCategory[i.category] += val;
      else bankInflowsByCategory.outros += val;
    });

    day.outflows.forEach(o => {
      const val = o.value || 0;
      totalBankOutflows += val;
      if (bankOutflowsByCategory[o.category] !== undefined) bankOutflowsByCategory[o.category] += val;
      else bankOutflowsByCategory.outros += val;
    });
  });

  const bankNetProfit = totalBankInflows - totalBankOutflows;
  const globalConsolidatedBalance = cashNetProfit + bankNetProfit;
  const activeStoreName = localStorage.getItem(`gastrofecho_store_name_${currentUser}`) || "Não informada";
  const notes = document.getElementById("monthly-report-notes").value.trim();

  // Construção do relatório formatado
  let text = `🏪 *FECHOU! - RELATÓRIO CONSOLIDADO PERIÓDICO*\n`;
  text += `🏪 *Loja:* ${activeStoreName}\n`;
  text += `📅 *Período:* ${formatDate(startInput)} até ${formatDate(endInput)}\n\n`;

  text += `⚖️ *BALANÇO CONSOLIDADO: ${formatCurrency(globalConsolidatedBalance)}*\n`;
  text += `  • Saldo Caixa Físico: ${formatCurrency(cashNetProfit)}\n`;
  text += `  • Saldo Banco Diário: ${formatCurrency(bankNetProfit)}\n\n`;

  text += `💵 *RESUMO DE CAIXA FÍSICO*\n`;
  text += `💰 *Faturamento Total:* ${formatCurrency(totalCashRevenue)}\n`;
  Object.keys(cashRevenueByChannel).forEach(k => {
    const val = cashRevenueByChannel[k];
    if (val > 0) text += `  • ${REVENUE_CHANNELS[k]?.label || k}: ${formatCurrency(val)}\n`;
  });
  text += `💸 *Total Despesas Caixa:* ${formatCurrency(totalGeneralExpenses + totalVales)}\n`;
  Object.keys(expensesByCategory).forEach(k => {
    const val = expensesByCategory[k];
    if (val > 0) {
      const label = k === 'vales' ? 'Vales' : (EXPENSE_CATEGORIES[k] || k);
      text += `  • ${label}: ${formatCurrency(val)}\n`;
    }
  });
  text += `\n`;

  text += `🏦 *RESUMO BANCÁRIO*\n`;
  text += `📥 *Total Entradas Banco:* ${formatCurrency(totalBankInflows)}\n`;
  Object.keys(bankInflowsByCategory).forEach(k => {
    const val = bankInflowsByCategory[k];
    if (val > 0) text += `  • Entradas ${BANK_INFLOW_CATEGORIES[k] || k}: ${formatCurrency(val)}\n`;
  });
  text += `📤 *Total Saídas Banco:* ${formatCurrency(totalBankOutflows)}\n`;
  Object.keys(bankOutflowsByCategory).forEach(k => {
    const val = bankOutflowsByCategory[k];
    if (val > 0) text += `  • Saídas ${BANK_OUTFLOW_CATEGORIES[k] || k}: ${formatCurrency(val)}\n`;
  });
  text += `\n`;

  if (notes) {
    text += `📝 *Observações do Período:* \n_${notes}_\n`;
  }

  const confirmWhatsApp = confirm("Deseja enviar o fechamento periódico consolidado via WhatsApp?");
  if (confirmWhatsApp) {
    const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(waUrl, '_blank');
  }
}

// --- VISUALIZAÇÃO E ENVIO DE VALES POR PERÍODO ---
let activeEmployeeKey = "";

function viewEmployeeValesDetails(employeeKey) {
  activeEmployeeKey = employeeKey;
  const emp = window.currentPeriodValesData ? window.currentPeriodValesData[employeeKey] : null;
  if (!emp) return;

  const startInput = document.getElementById("monthly-start-date").value;
  const endInput = document.getElementById("monthly-end-date").value;
  
  document.getElementById("modal-vales-details-title").textContent = `Detalhamento de Vales — ${emp.name}`;
  document.getElementById("modal-vales-details-period").textContent = `${formatDate(startInput)} até ${formatDate(endInput)}`;
  document.getElementById("modal-vales-details-total").textContent = formatCurrency(emp.total);

  const tbody = document.getElementById("modal-vales-details-body");
  tbody.innerHTML = "";

  emp.items.forEach(item => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="padding: 10px 8px;">${formatDate(item.date)}</td>
      <td style="padding: 10px 8px;">
        <span class="badge ${item.shift === 'noite' ? 'badge-expense' : 'badge-revenue'}" style="font-size: 10px; padding: 2px 6px;">
          ${item.shift === 'noite' ? '🌙 Noite' : '☀️ Dia'}
        </span>
      </td>
      <td style="padding: 10px 8px; color: var(--text-secondary);">${item.description}</td>
      <td class="text-expense bold" style="text-align: right; padding: 10px 8px;">${formatCurrency(item.value)}</td>
    `;
    tbody.appendChild(tr);
  });

  openModal("modal-vales-details");
  lucide.createIcons();
}

function getFormattedEmployeeValesText(emp, startDate, endDate) {
  const shopName = document.getElementById("user-display-name")?.textContent || "Nossa Loja";
  let text = `📋 *EXTRATO DE VALES - ${shopName.toUpperCase()}*\n`;
  text += `👤 *Funcionário:* ${emp.name}\n`;
  text += `📅 *Período:* ${formatDate(startDate)} a ${formatDate(endDate)}\n`;
  text += `-------------------------------------------\n\n`;

  emp.items.forEach(item => {
    const dateStr = formatDate(item.date);
    const shiftLabel = item.shift === "noite" ? "🌙 Noite" : "☀️ Dia";
    text += `📅 *${dateStr}* (${shiftLabel})\n`;
    text += `   💰 *Valor:* ${formatCurrency(item.value)}\n\n`;
  });

  text += `-------------------------------------------\n`;
  text += `💰 *TOTAL ACUMULADO:* ${formatCurrency(emp.total)}\n\n`;
  text += `_Por favor, verifique se está de acordo._`;
  return text;
}

function shareEmployeeValesWhatsAppDirect(employeeKey) {
  const emp = window.currentPeriodValesData ? window.currentPeriodValesData[employeeKey] : null;
  if (!emp) return;

  const startInput = document.getElementById("monthly-start-date").value;
  const endInput = document.getElementById("monthly-end-date").value;

  const confirmShare = confirm(`Deseja enviar o extrato de vales do funcionário ${emp.name} via WhatsApp?`);
  if (!confirmShare) return;

  const text = getFormattedEmployeeValesText(emp, startInput, endInput);
  const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
  window.open(waUrl, '_blank');
}

function shareEmployeeValesWhatsApp() {
  if (!activeEmployeeKey) return;
  shareEmployeeValesWhatsAppDirect(activeEmployeeKey);
}

// --- CONTROLE DE MANUTENÇÃO (ACESSO MESTRE) ---
async function updateMaintenanceUI() {
  const toggleBtn = document.getElementById("btn-toggle-maintenance");
  const statusBadge = document.getElementById("maintenance-status-badge");

  if (!toggleBtn || !statusBadge) return;

  try {
    const isMaintenance = await dbGetMaintenanceMode();
    if (isMaintenance) {
      // Manutenção Ativa
      toggleBtn.className = "btn btn-danger";
      toggleBtn.innerHTML = `<i data-lucide="shield-alert"></i> Desativar Manutenção`;
      statusBadge.className = "badge badge-expense";
      statusBadge.textContent = "MANUTENÇÃO ATIVA";
      statusBadge.style.background = "rgba(244, 63, 94, 0.15)";
      statusBadge.style.color = "var(--color-expense)";
      statusBadge.style.border = "1px solid rgba(244, 63, 94, 0.3)";
    } else {
      // Sistema Ativo
      toggleBtn.className = "btn btn-success";
      toggleBtn.innerHTML = `<i data-lucide="shield-check"></i> Ativar Manutenção`;
      statusBadge.className = "badge badge-revenue";
      statusBadge.textContent = "SISTEMA ATIVO (ONLINE)";
      statusBadge.style.background = "rgba(16, 185, 129, 0.15)";
      statusBadge.style.color = "var(--color-revenue)";
      statusBadge.style.border = "1px solid rgba(16, 185, 129, 0.3)";
    }
  } catch (e) {
    console.warn("Erro ao carregar UI de manutenção:", e);
    toggleBtn.innerHTML = `<i data-lucide="alert-triangle"></i> Erro de Conexão`;
    statusBadge.textContent = "ERRO CONEXÃO";
  }
  lucide.createIcons();
}

async function toggleMaintenanceMode() {
  const toggleBtn = document.getElementById("btn-toggle-maintenance");
  if (!toggleBtn) return;

  const originalHtml = toggleBtn.innerHTML;
  toggleBtn.disabled = true;
  toggleBtn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Processando...`;
  lucide.createIcons();

  try {
    const isMaintenance = await dbGetMaintenanceMode();
    const nextState = !isMaintenance;

    const confirmAction = confirm(
      nextState
        ? "⚠️ ATENÇÃO: Deseja realmente ATIVAR o Modo de Manutenção?\n\nIsso irá desconectar imediatamente TODOS os operadores que estiverem usando o sistema neste exato momento."
        : "Deseja DESATIVAR o Modo de Manutenção?\n\nOs operadores poderão voltar a logar e realizar fechamentos normalmente."
    );

    if (confirmAction) {
      const success = await dbSetMaintenanceMode(nextState);
      if (success) {
        alert(nextState ? "Modo de Manutenção ATIVADO com sucesso!" : "Modo de Manutenção DESATIVADO!");
      } else {
        alert("Ocorreu um erro ao tentar alterar o estado do Modo de Manutenção.");
      }
    }
  } catch (e) {
    console.error(e);
    alert("Falha de conexão com a nuvem.");
  } finally {
    toggleBtn.disabled = false;
    await updateMaintenanceUI();
  }
}

// =====================================================================
// MONETIZAÇÃO E SISTEMA DE CRÉDITOS / LICENCIAMENTO (PIX & WHATSAPP)
// =====================================================================

// Verifica se o operador comum tem licença de acesso ativa (offline-resilient)
async function verifyUserSubscription(username) {
  if (!username) return false;
  const normalized = username.toLowerCase();
  
  // Acesso Mestre (Master) é isento e sempre liberado
  if (normalized === "mestre" || normalized === "lucas_simoes_araujo@hotmail.com" || normalized === "lucas_simoes_araujo_g@hotmail.com") {
    return true;
  }

  try {
    const users = await dbGetUsers();
    const user = users.find(u => u.username.toLowerCase() === normalized);
    if (!user) return false;

    // 1. Se for VIP (Acesso Vitalício / Modo VIP)
    if (user.isVip) return true;

    const now = new Date();

    // 2. Se tiver créditos ativos (assinatura paga de 30 dias)
    if (user.creditsUntil) {
      const creditsDate = new Date(user.creditsUntil);
      if (creditsDate >= now) return true;
    }

    // 3. Se tiver período de teste de 7 dias grátis ativo
    let trialUntil = user.trialUntil;
    // Retrocompatibilidade: se trialUntil não estiver cadastrado, calcula a partir de createdAt
    if (!trialUntil && user.createdAt) {
      trialUntil = new Date(new Date(user.createdAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    } else if (!trialUntil) {
      trialUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    }

    if (trialUntil) {
      const trialDate = new Date(trialUntil);
      if (trialDate >= now) return true;
    }

    // Período expirado, sem VIP e sem créditos ativos
    return false;
  } catch (error) {
    console.warn("Erro ao verificar assinatura na nuvem, permitindo acesso offline por resiliência:", error);
    // Offline resilience: não impede o lojista de trabalhar no caixa dele se o Upstash falhar
    return true;
  }
}

// Copia a Chave Pix (E-mail do administrador) com feedback visual premium
function copyPixKey() {
  const pixKeyInput = document.getElementById("pix-key-input");
  if (!pixKeyInput) return;

  pixKeyInput.select();
  pixKeyInput.setSelectionRange(0, 99999); // Suporte para mobile

  try {
    navigator.clipboard.writeText(pixKeyInput.value);
  } catch (err) {
    // Método de fallback para navegadores antigos ou sem suporte a clipboard API
    const tempInput = document.createElement("input");
    tempInput.value = pixKeyInput.value;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand("copy");
    document.body.removeChild(tempInput);
  }

  // Feedback Visual Reativo
  const feedback = document.getElementById("pix-copy-feedback");
  if (feedback) {
    feedback.style.display = "inline-block";
    setTimeout(() => {
      feedback.style.display = "none";
    }, 3000);
  }
}

// Envia o comprovante de pagamento Pix para o WhatsApp do Master Admin (Lucas)
function sendPixReceiptWhatsApp() {
  const activeUser = sessionStorage.getItem("gastrofecho_logged_user") || currentUser || "";
  const activeStoreName = localStorage.getItem(`gastrofecho_store_name_${activeUser}`) || "Minha Loja";

  const text = `🏪 *FECHOU! - COMPROVANTE DE CRÉDITOS*\n\n` +
    `Olá Lucas! Acabo de efetuar o pagamento Pix para a aquisição/renovação de créditos no *Fechou!*.\n\n` +
    `🏪 *Loja:* ${activeStoreName}\n` +
    `👤 *Usuário (Telefone):* ${activeUser}\n\n` +
    `Estou enviando o comprovante do Pix em anexo. Aguardo a liberação da licença do meu app!`;

  const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
  window.open(waUrl, '_blank');
}

// Gerenciamento de Licenças e Acesso via Painel do Administrador Mestre
async function adminManageAccess(username) {
  const normalized = username.toLowerCase();
  
  try {
    const users = await dbGetUsers();
    const userIndex = users.findIndex(u => u.username.toLowerCase() === normalized);
    if (userIndex === -1) {
      alert("Operador não encontrado.");
      return;
    }
    const user = users[userIndex];

    // Inicializar propriedades se ausentes no cadastro legado
    if (user.isVip === undefined) user.isVip = false;
    if (user.creditsUntil === undefined) user.creditsUntil = "";
    if (!user.trialUntil && user.createdAt) {
      user.trialUntil = new Date(new Date(user.createdAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    } else if (!user.trialUntil) {
      user.trialUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    }

    const now = new Date();
    let statusText = "";
    if (user.isVip) {
      statusText = "⭐ Vitalício (VIP)";
    } else if (user.creditsUntil && new Date(user.creditsUntil) >= now) {
      statusText = `✅ Ativo (Créditos até ${new Date(user.creditsUntil).toLocaleDateString('pt-BR')})`;
    } else if (user.trialUntil && new Date(user.trialUntil) >= now) {
      statusText = `⏳ Teste Ativo (Até ${new Date(user.trialUntil).toLocaleDateString('pt-BR')})`;
    } else {
      statusText = "❌ Acesso Expirado";
    }

    const choice = prompt(
      `SISTEMA DE MONETIZAÇÃO E CRÉDITOS — FECHOU!\n` +
      `-----------------------------------------------\n` +
      `Operador: ${user.storeName || username} (${username})\n` +
      `Licença Atual: ${statusText}\n\n` +
      `Selecione uma opção de gerenciamento:\n` +
      `Digite [ 1 ] para Adicionar +30 dias de créditos pagos\n` +
      `Digite [ 2 ] para Alternar Modo VIP (Vitalício)\n` +
      `Digite [ 3 ] para Conceder novo Teste Grátis de 7 dias\n` +
      `Digite [ 4 ] para Bloquear Acesso imediatamente (Zerar licença)\n\n` +
      `Deixe em branco ou clique em Cancelar para sair.`
    );

    if (choice === null || choice.trim() === "") return;

    const option = choice.trim();
    const today = new Date();

    if (option === "1") {
      // 1. Adicionar 30 dias de créditos
      let currentCredits = user.creditsUntil ? new Date(user.creditsUntil) : today;
      if (currentCredits < today) currentCredits = today; // se já venceu, começa de hoje
      
      const newCreditsDate = new Date(currentCredits.getTime() + 30 * 24 * 60 * 60 * 1000);
      user.creditsUntil = newCreditsDate.toISOString();
      user.isVip = false; // créditos pagos anulam o status VIP vitalício
      alert(`Sucesso! Foram creditados +30 dias de acesso para ${user.storeName}.\nNova validade: ${newCreditsDate.toLocaleDateString('pt-BR')}`);
    } 
    else if (option === "2") {
      // 2. Alternar modo VIP
      user.isVip = !user.isVip;
      alert(`Sucesso! Modo VIP ${user.isVip ? "ATIVADO" : "DESATIVADO"} para ${user.storeName}.`);
    } 
    else if (option === "3") {
      // 3. Conceder 7 dias grátis
      const newTrialDate = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
      user.trialUntil = newTrialDate.toISOString();
      user.creditsUntil = ""; // reseta créditos pagos para rodar no período de testes
      user.isVip = false;
      alert(`Sucesso! Novo período de teste grátis de 7 dias concedido até ${newTrialDate.toLocaleDateString('pt-BR')}.`);
    } 
    else if (option === "4") {
      // 4. Bloquear imediatamente
      user.creditsUntil = "";
      user.trialUntil = today.toISOString(); // encerra o teste imediatamente
      user.isVip = false;
      alert(`Acesso do operador ${user.storeName} foi bloqueado imediatamente!`);
    } 
    else {
      alert("Opção inválida. Nenhuma alteração foi realizada.");
      return;
    }

    // Atualizar no banco de dados
    await dbSetUsers(users);
    
    // Atualizar tabela do Painel Mestre
    loadMasterPanel();

  } catch (error) {
    console.error("Erro ao gerenciar acesso do operador:", error);
    alert("Falha de conexão com a nuvem ao tentar salvar alterações de licenciamento.");
  }
}

// Alterna abas/sub-abas dentro do Painel do Acesso Mestre (Administração)
function switchMasterSubTab(tab) {
  const usersTabBtn = document.getElementById("subtab-master-users");
  const registerTabBtn = document.getElementById("subtab-master-register");
  const contactTabBtn = document.getElementById("subtab-master-contact");
  const usersContainer = document.getElementById("master-users-container");
  const registerContainer = document.getElementById("master-register-container");
  const contactContainer = document.getElementById("master-contact-container");

  if (!usersTabBtn || !registerTabBtn || !usersContainer || !registerContainer) return;

  // Reset all tabs to secondary
  usersTabBtn.className = "btn btn-secondary btn-sm";
  registerTabBtn.className = "btn btn-secondary btn-sm";
  if (contactTabBtn) contactTabBtn.className = "btn btn-secondary btn-sm";

  // Hide all containers
  usersContainer.style.display = "none";
  registerContainer.style.display = "none";
  if (contactContainer) contactContainer.style.display = "none";

  // Activate selected tab
  if (tab === 'users') {
    usersTabBtn.className = "btn btn-primary btn-sm";
    usersContainer.style.display = "block";
  } else if (tab === 'register') {
    registerTabBtn.className = "btn btn-primary btn-sm";
    registerContainer.style.display = "block";
  } else if (tab === 'contact') {
    if (contactTabBtn) contactTabBtn.className = "btn btn-primary btn-sm";
    if (contactContainer) contactContainer.style.display = "block";
    loadMasterContactSettingsGrid();
  }
  lucide.createIcons();
}

// Atualiza dinamicamente as informações e status de assinatura na aba do operador
async function updateSubscriptionTabUI() {
  const badge = document.getElementById("sub-status-badge");
  const details = document.getElementById("sub-status-details");
  const iconWrapper = document.getElementById("sub-status-icon-wrapper");
  const icon = document.getElementById("sub-status-icon");

  if (!badge || !details || !iconWrapper || !icon) return;

  try {
    const users = await dbGetUsers();
    const user = users.find(u => u.username.toLowerCase() === currentUser.toLowerCase());
    if (!user) {
      details.textContent = "Erro ao localizar dados do operador.";
      return;
    }

    // Inicializar propriedades se ausentes
    if (user.isVip === undefined) user.isVip = false;
    if (user.creditsUntil === undefined) user.creditsUntil = "";
    if (!user.trialUntil && user.createdAt) {
      user.trialUntil = new Date(new Date(user.createdAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    } else if (!user.trialUntil) {
      user.trialUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    }

    const now = new Date();
    
    if (user.isVip) {
      badge.className = "badge";
      badge.style.background = "rgba(124, 58, 237, 0.15)";
      badge.style.color = "var(--secondary)";
      badge.style.border = "1px solid rgba(124, 58, 237, 0.3)";
      badge.textContent = "⭐ Vitalício (VIP)";

      details.textContent = "Sua loja possui acesso vitalício e ilimitado a todas as ferramentas.";
      
      iconWrapper.style.background = "rgba(124, 58, 237, 0.12)";
      iconWrapper.style.color = "var(--secondary)";
      icon.setAttribute("data-lucide", "star");
    } 
    else if (user.creditsUntil && new Date(user.creditsUntil) >= now) {
      const creditsDate = new Date(user.creditsUntil);
      const diffTime = Math.abs(creditsDate - now);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      badge.className = "badge badge-revenue";
      badge.style.background = "rgba(16, 185, 129, 0.15)";
      badge.style.color = "var(--color-revenue)";
      badge.style.border = "1px solid rgba(16, 185, 129, 0.3)";
      badge.textContent = "✅ Assinatura Ativa";

      details.innerHTML = `Seus créditos de acesso são válidos por mais <strong>${diffDays} dias</strong> (até ${creditsDate.toLocaleDateString('pt-BR')}).`;

      iconWrapper.style.background = "rgba(16, 185, 129, 0.12)";
      iconWrapper.style.color = "var(--color-revenue)";
      icon.setAttribute("data-lucide", "shield-check");
    } 
    else if (user.trialUntil && new Date(user.trialUntil) >= now) {
      const trialDate = new Date(user.trialUntil);
      const diffTime = Math.abs(trialDate - now);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      badge.className = "badge badge-revenue";
      badge.style.background = "rgba(59, 130, 246, 0.15)";
      badge.style.color = "var(--primary)";
      badge.style.border = "1px solid rgba(59, 130, 246, 0.3)";
      badge.textContent = "⏳ Teste Grátis";

      details.innerHTML = `Seu período de teste grátis é válido por mais <strong>${diffDays} dias</strong> (até ${trialDate.toLocaleDateString('pt-BR')}).`;

      iconWrapper.style.background = "rgba(59, 130, 246, 0.12)";
      iconWrapper.style.color = "var(--primary)";
      icon.setAttribute("data-lucide", "clock");
    } 
    else {
      badge.className = "badge badge-expense";
      badge.style.background = "rgba(244, 63, 94, 0.15)";
      badge.style.color = "var(--color-expense)";
      badge.style.border = "1px solid rgba(244, 63, 94, 0.3)";
      badge.textContent = "❌ Acesso Expirado";

      details.innerHTML = "Sua licença expirou. Faça o pagamento Pix de <strong>R$ 49,90</strong> para liberar todas as funções.";

      iconWrapper.style.background = "rgba(244, 63, 94, 0.12)";
      iconWrapper.style.color = "var(--color-expense)";
      icon.setAttribute("data-lucide", "shield-alert");
    }
  } catch (e) {
    console.warn("Erro ao carregar UI de assinatura:", e);
    details.textContent = "Erro de conexão ao carregar informações de assinatura.";
  }
  lucide.createIcons();
}

// Redireciona o lojista para a aba de pagamentos ao clicar no banner
function goToSubscriptionTab() {
  const subNavItem = document.querySelector('[data-target="panel-subscription"]');
  if (subNavItem) switchTab(subNavItem);
}

// Copia a Chave Pix da aba do operador
function copyPixKeyTab() {
  const pixKeyInput = document.getElementById("pix-key-input-tab");
  if (!pixKeyInput) return;

  pixKeyInput.select();
  pixKeyInput.setSelectionRange(0, 99999);

  try {
    navigator.clipboard.writeText(pixKeyInput.value);
  } catch (err) {
    const tempInput = document.createElement("input");
    tempInput.value = pixKeyInput.value;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand("copy");
    document.body.removeChild(tempInput);
  }

  const feedback = document.getElementById("pix-copy-feedback-tab");
  if (feedback) {
    feedback.style.display = "inline-block";
    setTimeout(() => {
      feedback.style.display = "none";
    }, 3000);
  }
}

// Desabilita/Habilita de forma reativa e cirúrgica todos os campos do operador
function disableOperatorInputs(shouldDisable) {
  // Seleciona todos os formulários e containers de caixas e bancos
  const formElements = document.querySelectorAll(
    "#closing-form input, #closing-form select, #closing-form textarea, #closing-form button, " +
    "#bank-closing-form input, #bank-closing-form select, #bank-closing-form textarea, #bank-closing-form button, " +
    "#edit-closing-form input, #edit-closing-form select, #edit-closing-form textarea, #edit-closing-form button, " +
    "#edit-bank-closing-form input, #edit-bank-closing-form select, #edit-bank-closing-form textarea, #edit-bank-closing-form button, " +
    "#monthly-report-notes, " +
    "button[onclick='generateDemoData()'], button[onclick='resetAllData()']"
  );

  formElements.forEach(el => {
    // Não desabilita botões de fechar modais
    if (el.classList.contains("modal-close") || el.getAttribute("onclick")?.includes("closeModal")) {
      return;
    }
    el.disabled = shouldDisable;
  });

  // Desabilitar botões de adicionar despesas, vales e linhas bancárias
  const actionButtons = document.querySelectorAll(
    "button[onclick^='addValeRow'], button[onclick^='addGeneralExpenseRow'], " +
    "button[onclick^='addBankInflowRow'], button[onclick^='addBankOutflowRow'], " +
    "button[onclick^='removeExpenseRow'], button[onclick^='removeBankRow']"
  );
  actionButtons.forEach(btn => {
    btn.disabled = shouldDisable;
    if (shouldDisable) {
      btn.style.opacity = "0.5";
      btn.style.pointerEvents = "none";
    } else {
      btn.style.opacity = "1";
      btn.style.pointerEvents = "auto";
    }
  });

  // Desabilitar botões de editar/excluir no histórico (mas manter Visualizar, PDF e WhatsApp)
  const historyButtons = document.querySelectorAll(
    "#history-table button, #bank-history-table button, #bank-history-mobile-cards button, #history-mobile-cards button"
  );
  historyButtons.forEach(btn => {
    const clickAttr = btn.getAttribute("onclick") || "";
    if (clickAttr.includes("viewDetails") || clickAttr.includes("viewBankDetails") || clickAttr.includes("share") || clickAttr.includes("print")) {
      return;
    }
    btn.disabled = shouldDisable;
    if (shouldDisable) {
      btn.style.opacity = "0.5";
      btn.style.pointerEvents = "none";
    } else {
      btn.style.opacity = "1";
      btn.style.pointerEvents = "auto";
    }
  });
}

// --- EVENTOS DE CICLO DE VIDA DO PWA ---
window.addEventListener("beforeinstallprompt", (e) => {
  // Previne a barra/banner padrão do navegador de aparecer automaticamente
  e.preventDefault();
  // Armazena o evento para que possamos acioná-lo através do botão personalizado
  deferredPrompt = e;
  
  // Mostra o botão de instalação nativo
  const installBtn = document.getElementById("btn-pwa-install");
  if (installBtn) {
    installBtn.style.display = "inline-flex";
  }
});

window.addEventListener("appinstalled", () => {
  console.log("Fechou! instalado com sucesso na tela de início do lojista.");
  deferredPrompt = null;
  
  const installBtn = document.getElementById("btn-pwa-install");
  if (installBtn) {
    installBtn.style.display = "none";
  }
  
  alert("Aplicativo instalado com sucesso na sua tela de início!");
});

// =============================================
// CONFIGURAÇÕES DE CONTATO DO MESTRE
// =============================================

// Salva as configurações de contato do mestre (e-mail, WhatsApp, chave Pix)
async function saveMasterContactSettings(e) {
  e.preventDefault();

  // Tenta pegar dos campos do master-grid primeiro, depois do formulário antigo
  const emailEl = document.getElementById("master-email-grid") || document.getElementById("master-email");
  const phoneEl = document.getElementById("master-phone-grid") || document.getElementById("master-phone");
  const pixEl = document.getElementById("master-pix-key-grid") || document.getElementById("master-pix-key");

  const email = emailEl ? emailEl.value.trim() : "";
  const phone = phoneEl ? phoneEl.value.trim() : "";
  const pixKey = pixEl ? pixEl.value.trim() : "";

  if (!email || !phone || !pixKey) {
    alert("Preencha todos os campos antes de salvar.");
    return;
  }

  const contactData = { email, phone, pixKey, updatedAt: new Date().toISOString() };

  try {
    await fetch(UPSTASH_URL, {
      method: "POST",
      headers: { "Authorization": "Bearer " + UPSTASH_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify(["SET", "master_contact_settings", JSON.stringify(contactData)])
    });
    alert("Configurações de contato salvas com sucesso!");
  } catch (err) {
    console.error("Erro ao salvar configurações de contato:", err);
    alert("Erro ao salvar. Tente novamente.");
  }
}

// Carrega as configurações de contato do mestre nos campos do master-grid
async function loadMasterContactSettingsGrid() {
  try {
    const res = await fetch(UPSTASH_URL, {
      method: "POST",
      headers: { "Authorization": "Bearer " + UPSTASH_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify(["GET", "master_contact_settings"])
    });
    const data = await res.json();

    if (data.result) {
      const contact = JSON.parse(data.result);
      const emailEl = document.getElementById("master-email-grid");
      const phoneEl = document.getElementById("master-phone-grid");
      const pixEl = document.getElementById("master-pix-key-grid");

      if (emailEl) emailEl.value = contact.email || "";
      if (phoneEl) phoneEl.value = contact.phone || "";
      if (pixEl) pixEl.value = contact.pixKey || "";
    }
  } catch (err) {
    console.warn("Erro ao carregar configurações de contato:", err);
  }
}

// Carrega as informações de contato do mestre para exibição na aba de Contato do operador
async function loadUserContactInfo() {
  let pixKey = "lucas_simoes_araujo@hotmail.com";
  try {
    const res = await fetch(UPSTASH_URL, {
      method: "POST",
      headers: { "Authorization": "Bearer " + UPSTASH_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify(["GET", "master_contact_settings"])
    });
    const data = await res.json();

    const emailSpan = document.getElementById("user-contact-email");
    const whatsappSpan = document.getElementById("user-contact-whatsapp");

    if (data.result) {
      const contact = JSON.parse(data.result);
      pixKey = contact.pixKey || "lucas_simoes_araujo@hotmail.com";
      
      if (emailSpan) emailSpan.textContent = contact.email || "Não configurado";
      if (whatsappSpan) {
        const phoneNumber = (contact.phone || "").replace(/\D/g, "");
        if (phoneNumber) {
          whatsappSpan.innerHTML = '<a href="https://wa.me/55' + phoneNumber + '" target="_blank" style="color: var(--color-revenue); text-decoration: underline;">' + contact.phone + '</a>';
        } else {
          whatsappSpan.textContent = "Não configurado";
        }
      }
    } else {
      if (emailSpan) emailSpan.textContent = "Não configurado";
      if (whatsappSpan) whatsappSpan.textContent = "Não configurado";
    }
  } catch (err) {
    console.warn("Erro ao carregar informações de contato:", err);
    const emailSpan = document.getElementById("user-contact-email");
    const whatsappSpan = document.getElementById("user-contact-whatsapp");
    if (emailSpan) emailSpan.textContent = "Erro ao carregar";
    if (whatsappSpan) whatsappSpan.textContent = "Erro ao carregar";
  }
  
  // Atualiza os dados de pagamento Pix dinamicamente
  updatePixPaymentDetails(pixKey);
}

// Gera o Pix Payload (EMV) e atualiza o QR Code e o input de Copia e Cola
function updatePixPaymentDetails(pixKey) {
  if (!pixKey) pixKey = "lucas_simoes_araujo@hotmail.com";
  
  // Gera o payload Pix Copia e Cola oficial para R$ 49,90
  const pixPayload = generatePixPayload(pixKey, 49.90, "FECHOU APP", "SAO PAULO");

  // Exibe a chave original em formato legível embaixo dos inputs
  const rawKeyTabVal = document.getElementById("pix-key-raw-tab-val");
  const rawKeyOverlayVal = document.getElementById("pix-key-raw-overlay-val");
  if (rawKeyTabVal) rawKeyTabVal.textContent = pixKey;
  if (rawKeyOverlayVal) rawKeyOverlayVal.textContent = pixKey;

  // Atualiza os inputs de "Copia e Cola" nas telas
  const pixKeyInputTab = document.getElementById("pix-key-input-tab");
  const pixKeyInput = document.getElementById("pix-key-input");

  if (pixKeyInputTab) pixKeyInputTab.value = pixPayload;
  if (pixKeyInput) pixKeyInput.value = pixPayload;

  // Atualiza a imagem do QR Code
  const pixQrImg = document.getElementById("pix-qr-img");
  if (pixQrImg) {
    // Usando a API gratuita de alta qualidade do QR Server com o payload do Pix
    pixQrImg.src = "https://api.qrserver.com/v1/create-qr-code/?size=220x220&color=0f172a&margin=10&data=" + encodeURIComponent(pixPayload);
  }
}

// Gerador de Payload Pix Estático (Padrão EMV do Banco Central do Brasil)
function generatePixPayload(key, amount, merchantName, merchantCity) {
  // Merchant Account Info
  const accountInfo = 
    "0014br.gov.bcb.pix" + 
    "01" + String(key.length).padStart(2, '0') + key;
  
  const payloadFormat = "000201";
  const merchantCategory = "52040000";
  const transactionCurrency = "5303986";
  const countryCode = "5802BR";
  
  const formattedName = merchantName.substring(0, 25).toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const formattedCity = merchantCity.substring(0, 15).toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  const merchantNameField = "59" + String(formattedName.length).padStart(2, '0') + formattedName;
  const merchantCityField = "60" + String(formattedCity.length).padStart(2, '0') + formattedCity;
  
  const transactionAmountField = amount ? ("54" + String(amount.toFixed(2).length).padStart(2, '0') + amount.toFixed(2)) : "";
  const merchantAccountField = "26" + String(accountInfo.length).padStart(2, '0') + accountInfo;
  
  const additionalData = "62070503***"; // Sem transação ID específica
  
  let payload = 
    payloadFormat + 
    merchantAccountField + 
    merchantCategory + 
    transactionCurrency + 
    transactionAmountField + 
    countryCode + 
    merchantNameField + 
    merchantCityField + 
    additionalData + 
    "6304";
  
  // Calcula o CRC16 CCITT
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i++) {
    let x = ((crc >> 8) ^ payload.charCodeAt(i)) & 0xFF;
    x ^= x >> 4;
    crc = ((crc << 8) ^ (x << 12) ^ (x << 5) ^ (x << 0)) & 0xFFFF;
  }
  const crcString = crc.toString(16).toUpperCase().padStart(4, '0');
  return payload + crcString;
}

// =============================================
// CONTROLE DO MENU LATERAL GAVETA (SIDEBAR DRAWER)
// =============================================

// Abre o menu lateral retrátil no mobile
function openSidebarMenu() {
  const sidebar = document.getElementById("app-sidebar");
  const overlay = document.getElementById("sidebar-overlay");
  if (sidebar && overlay) {
    sidebar.classList.add("active");
    overlay.classList.add("active");
    document.body.style.overflow = "hidden"; // Impede rolagem da página por baixo
  }
}

// Fecha o menu lateral retrátil no mobile
function closeSidebarMenu() {
  const sidebar = document.getElementById("app-sidebar");
  const overlay = document.getElementById("sidebar-overlay");
  if (sidebar && overlay) {
    sidebar.classList.remove("active");
    overlay.classList.remove("active");
    document.body.style.overflow = ""; // Restaura rolagem
  }
}

// GESTOS DE TOQUE E DESLIZAMENTO (SWIPE GESTURES) PARA VERSÃO MOBILE
let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let touchEndY = 0;

document.addEventListener('touchstart', e => {
  touchStartX = e.changedTouches[0].screenX;
  touchStartY = e.changedTouches[0].screenY;
}, { passive: true });

document.addEventListener('touchend', e => {
  touchEndX = e.changedTouches[0].screenX;
  touchEndY = e.changedTouches[0].screenY;
  handleSwipeGesture();
}, { passive: true });

function handleSwipeGesture() {
  const sidebar = document.getElementById("app-sidebar");
  const isMobile = window.innerWidth <= 1024;
  
  if (!sidebar || !isMobile) return;
  
  const deltaX = touchEndX - touchStartX;
  const deltaY = touchEndY - touchStartY;
  
  // Garante que o swipe seja essencialmente horizontal (evita disparar ao rolar verticalmente)
  if (Math.abs(deltaY) > Math.abs(deltaX) * 1.5) return;
  
  // 1. Puxar da borda esquerda (X < 40px) para a direita para ABRIR o menu
  if (deltaX > 60 && touchStartX < 40 && !sidebar.classList.contains("active")) {
    openSidebarMenu();
  }
  // 2. Deslizar da direita para a esquerda em qualquer lugar para FECHAR o menu se estiver ativo
  else if (deltaX < -60 && sidebar.classList.contains("active")) {
    closeSidebarMenu();
  }
}

