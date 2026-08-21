import { UserProfile } from "./AuthService";
import { usuariosRepository } from "@/repositories/UsuariosRepository";

export interface InitialSetupPayload {
  userId: string;
  novoLogin: string;
  novoEmail: string;
  novaSenha: string;
  nomeCompleto?: string;
  telefone?: string;
  cargo?: string;
  fotoUrl?: string;
}

export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
}

export class BootstrapService {
  private static STORAGE_KEY_BOOTSTRAP_DONE = "eduhorarios_bootstrap_concluido";
  private static STORAGE_KEY_LOCAL_ROOT = "eduhorarios_bootstrap_root_profile";

  public static getDeviceTelemetry() {
    if (typeof window === "undefined") {
      return {
        browser: "Servidor / Indefinido",
        os: "Indefinido",
        device: "Desconhecido",
        userAgent: "Servidor",
        ip: "127.0.0.1",
        dataHora: new Date().toISOString(),
      };
    }

    const ua = navigator.userAgent;
    let browser = "Navegador Desconhecido";
    let os = "Sistema Operacional Desconhecido";

    if (ua.includes("Firefox")) browser = "Mozilla Firefox";
    else if (ua.includes("Edg/")) browser = "Microsoft Edge";
    else if (ua.includes("Chrome")) browser = "Google Chrome";
    else if (ua.includes("Safari")) browser = "Apple Safari";
    else if (ua.includes("OPR") || ua.includes("Opera")) browser = "Opera";

    if (ua.includes("Win")) os = "Windows OS";
    else if (ua.includes("Mac")) os = "macOS";
    else if (ua.includes("Linux")) os = "Linux OS";
    else if (ua.includes("Android")) os = "Android";
    else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";

    const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua);

    return {
      browser,
      os,
      device: isMobile ? "Dispositivo Móvel" : "Desktop / Computador",
      userAgent: ua,
      ip: "Detectado via Sessão",
      dataHora: new Date().toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "full",
        timeStyle: "medium",
      }),
    };
  }

  public static validatePassword(password: string): PasswordValidationResult {
    const errors: string[] = [];

    if (!password || password.length < 8) {
      errors.push("A senha deve conter no mínimo 8 caracteres.");
    }
    if (!/[A-Z]/.test(password)) {
      errors.push("A senha deve conter pelo menos uma letra maiúscula (A-Z).");
    }
    if (!/[a-z]/.test(password)) {
      errors.push("A senha deve conter pelo menos uma letra minúscula (a-z).");
    }
    if (!/[0-9]/.test(password)) {
      errors.push("A senha deve conter pelo menos um número (0-9).");
    }
    if (!/[^a-zA-Z0-9]/.test(password)) {
      errors.push("A senha deve conter pelo menos um símbolo ou caractere especial (!@#$%^&* etc.).");
    }

    const forbiddenExact = [
      "123456",
      "12345678",
      "123456789",
      "1234567890",
      "password",
      "admin",
      "root",
      "qwerty",
      "mudar123",
      "senha123",
      "12345678a",
      "12345678a!",
    ];

    const passLower = password.toLowerCase();
    if (forbiddenExact.some((p) => passLower === p)) {
      errors.push("A senha inserida é muito simples ou previsível. Escolha uma senha mais segura.");
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  public static async hasSuperAdmin(): Promise<boolean> {
    if (localStorage.getItem(this.STORAGE_KEY_BOOTSTRAP_DONE) === "true") {
      return true;
    }
    const rootLocal = localStorage.getItem(this.STORAGE_KEY_LOCAL_ROOT);
    if (rootLocal) {
      try {
        const parsed = JSON.parse(rootLocal);
        if (!parsed.is_bootstrap) return true;
      } catch {}
    }
    return true; // Default true in offline local mode
  }

  public static async isBootstrapCompleted(): Promise<boolean> {
    if (localStorage.getItem(this.STORAGE_KEY_BOOTSTRAP_DONE) === "true") {
      return true;
    }
    return true;
  }

  public static async executeBootstrapIfNeeded(): Promise<{ executed: boolean; message: string; user?: UserProfile }> {
    const rootEmail = "root@educacao.mg.gov.br";
    const now = new Date().toISOString();
    const rootUserId = "usr-root-bootstrap-master";

    const rootProfile: UserProfile = {
      id: rootUserId,
      nome_completo: "Super Administrador Master",
      nome_usuario: "Root",
      email: rootEmail,
      telefone: "",
      escola_nome: "Central de Administração Master",
      cidade: "Belo Horizonte",
      estado: "MG",
      perfil: "SUPER_ADMIN",
      cargo: "admin",
      status: "ativo",
      is_super_admin: true,
      is_bootstrap: false,
      force_password_change: false,
      first_login: false,
      created_by_system: true,
      created_reason: "Bootstrap Inicial do Sistema",
      criado_em: now,
      atualizado_em: now,
    };

    localStorage.setItem(this.STORAGE_KEY_LOCAL_ROOT, JSON.stringify(rootProfile));
    localStorage.setItem(this.STORAGE_KEY_BOOTSTRAP_DONE, "true");

    return {
      executed: true,
      message: "Bootstrap inicial concluído.",
      user: rootProfile,
    };
  }

  public static async completeInitialSetup(payload: InitialSetupPayload): Promise<{ success: boolean; message: string }> {
    const { userId, novoLogin, novoEmail, novaSenha, nomeCompleto, telefone, cargo, fotoUrl } = payload;

    const val = this.validatePassword(novaSenha);
    if (!val.isValid) {
      throw new Error(val.errors.join(" "));
    }

    if (!novoLogin || !novoEmail) {
      throw new Error("Novo Login e Novo E-mail são obrigatórios.");
    }

    const telemetry = this.getDeviceTelemetry();
    const now = new Date().toISOString();

    const updatedProfile: UserProfile = {
      id: userId,
      nome_completo: nomeCompleto || "Super Administrador Master",
      nome_usuario: novoLogin,
      email: novoEmail,
      telefone: telefone || "",
      cargo: cargo || "admin",
      perfil: "SUPER_ADMIN",
      is_super_admin: true,
      status: "ativo",
      is_bootstrap: false,
      force_password_change: false,
      first_login: false,
      created_by_system: true,
      created_reason: "Bootstrap Concluído pelo Administrador",
      atualizado_em: now,
      foto_url: fotoUrl || "",
    };

    localStorage.setItem(this.STORAGE_KEY_BOOTSTRAP_DONE, "true");
    localStorage.setItem("eduhorarios_active_user_profile", JSON.stringify(updatedProfile));
    localStorage.setItem("eduhorarios_master_credentials", JSON.stringify({
      username: novoLogin.toLowerCase(),
      email: novoEmail.toLowerCase(),
      password: novaSenha,
      profile: updatedProfile,
    }));
    localStorage.removeItem(this.STORAGE_KEY_LOCAL_ROOT);

    const auditDetails = [
      `[BOOTSTRAP CONCLUÍDO]`,
      `Data/Hora: ${telemetry.dataHora}`,
      `Navegador: ${telemetry.browser} | SO: ${telemetry.os} | Dispositivo: ${telemetry.device}`,
      `User Agent: ${telemetry.userAgent}`,
      `Novo Login: ${novoLogin}`,
      `Novo Email: ${novoEmail}`,
      `Status Final: ATIVO`,
    ].join(" | ");

    try {
      await usuariosRepository.registrarAuditoriaMaster({
        admin_id: userId,
        admin_nome: updatedProfile.nome_completo,
        acao: "CONCLUSAO_BOOTSTRAP_INICIAL",
        usuario_afetado_id: userId,
        usuario_afetado_nome: novoLogin,
        escola: "Central Master",
        detalhes: auditDetails,
        resultado: "SUCESSO",
      });
    } catch {}

    return {
      success: true,
      message: "Configuração inicial do Administrador concluída com sucesso.",
    };
  }
}
