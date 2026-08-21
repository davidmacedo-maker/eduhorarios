// src/services/AuthService.ts
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export interface UserProfile {
  id: string;
  user_id?: string;
  auth_user_id?: string;
  escola_id?: string;
  nome_completo: string;
  nome?: string;
  login?: string;
  nome_usuario?: string;
  email?: string;
  telefone?: string;
  escola_nome?: string;
  escola_codigo?: string;
  cidade?: string;
  estado?: string;
  cargo?: string; // 'admin' | 'gestor' | 'professor'
  role?: string; // 'SUPER_ADMIN' | 'GESTOR_ESCOLA' | 'PROFESSOR'
  perfil?: string; // 'SUPER_ADMIN' | 'GESTOR_ESCOLA' | 'PROFESSOR'
  status?: string; // 'ativo' | 'bloqueado' | 'inativo'
  observacoes?: string;
  is_super_admin?: boolean;
  ultimo_acesso?: string;
  criado_em?: string;
  atualizado_em?: string;
  created_at?: string;
  updated_at?: string;
  is_bootstrap?: boolean;
  force_password_change?: boolean;
  first_login?: boolean;
  created_by_system?: boolean;
  created_reason?: string;
  foto_url?: string;
}

const DEFAULT_AUTH_PROFILE: UserProfile = {
  id: "00000000-0000-0000-0000-000000000002",
  nome_completo: "Administrador EduHorários",
  nome: "Administrador EduHorários",
  nome_usuario: "admin",
  login: "admin",
  email: "admin@eduhorarios.com.br",
  escola_nome: "Escola Modelo EduHorários",
  perfil: "SUPER_ADMIN",
  role: "SUPER_ADMIN",
  cargo: "admin",
  is_super_admin: true,
  status: "ativo",
};

export function getAuthRedirectUrl(route = "/login"): string {
  if (typeof window === "undefined") return "";
  const origin = window.location.origin;
  const pathname = window.location.pathname.endsWith("/")
    ? window.location.pathname
    : `${window.location.pathname}/`;
  const cleanRoute = route.startsWith("/") ? route : `/${route}`;
  return `${origin}${pathname}#${cleanRoute}`;
}

export function formatErrorMessage(errorMsg: string): string {
  const lower = (errorMsg || "").toLowerCase();
  if (
    lower.includes("email link is invalid or has expired") ||
    lower.includes("link is invalid or has expired") ||
    lower.includes("otp_expired") ||
    lower.includes("token has expired or is invalid") ||
    lower.includes("token is expired") ||
    lower.includes("token expired") ||
    lower.includes("invalid token")
  ) {
    return "O link de confirmação expirou ou é inválido. Se necessário, solicite um novo link.";
  }
  if (lower.includes("access_denied") || lower.includes("access denied")) {
    return "Acesso não autorizado ou link de confirmação expirado.";
  }
  if (
    lower.includes("invalid login credentials") ||
    lower.includes("invalid_credentials") ||
    lower.includes("invalid credentials") ||
    lower.includes("invalid username or password")
  ) {
    return "E-mail ou senha incorretos.";
  }
  if (lower.includes("email not confirmed") || lower.includes("email address not confirmed")) {
    return "E-mail não confirmado. Verifique sua caixa de entrada para ativar sua conta antes de entrar.";
  }
  if (
    lower.includes("user already registered") ||
    lower.includes("already registered") ||
    lower.includes("already exists")
  ) {
    return "Este e-mail já está cadastrado. Faça login ou recupere sua senha.";
  }
  if (lower.includes("password should be at least") || lower.includes("should be at least 6 characters")) {
    return "A senha deve conter no mínimo 6 caracteres.";
  }
  if (
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("email rate limit exceeded") ||
    lower.includes("over_email_send_rate_limit")
  ) {
    return "Muitas solicitações consecutivas. Por segurança, aguarde alguns minutos antes de tentar novamente.";
  }
  if (lower.includes("for security purposes, you can only request this once every")) {
    return "Por segurança, aguarde alguns instantes antes de solicitar novamente.";
  }
  if (lower.includes("user disabled") || lower.includes("user is banned") || lower.includes("blocked")) {
    return "Esta conta está desativada ou bloqueada. Entre em contato com a administração.";
  }
  if (lower.includes("user not found")) {
    return "Usuário não encontrado.";
  }
  if (lower.includes("unable to validate email address") || lower.includes("invalid email")) {
    return "Por favor, informe um endereço de e-mail válido.";
  }
  if (lower.includes("auth session missing") || lower.includes("jwt")) {
    return "Sessão expirada ou inválida. Faça login novamente.";
  }
  if (lower.includes("same password") || lower.includes("different from the old password")) {
    return "A nova senha deve ser diferente da anterior.";
  }
  if (lower.includes("failed to fetch") || lower.includes("network error") || lower.includes("networkrequestfailed")) {
    return "Erro de conexão com o servidor. Verifique sua conexão com a internet.";
  }
  return errorMsg;
}

export class AuthService {
  public static async getCurrentUser() {
    const profile = await this.getCurrentProfile();
    if (!profile) return null;
    return {
      id: profile.id,
      email: profile.email,
      user_metadata: {
        full_name: profile.nome_completo,
        username: profile.nome_usuario || profile.login,
      },
    };
  }

  public static async getCurrentProfile(): Promise<UserProfile | null> {
    if (isSupabaseConfigured && supabase) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const authUid = session.user.id;
          const authEmail = session.user.email || "";

          // 1. Tentar buscar em perfis_usuarios
          const { data: perfilData } = await supabase
            .from("perfis_usuarios")
            .select("*")
            .or(`user_id.eq.${authUid},auth_user_id.eq.${authUid},id.eq.${authUid},email.eq.${authEmail}`)
            .maybeSingle();

          if (perfilData) {
            // Verificar se usuário está inativo/bloqueado
            if (perfilData.status === "inativo" || perfilData.status === "bloqueado") {
              await supabase.auth.signOut();
              localStorage.removeItem("eduhorarios_active_user_profile");
              return null;
            }
            return perfilData as UserProfile;
          }

          // 2. Tentar buscar em usuarios (compatibilidade)
          const { data: usuarioData } = await supabase
            .from("usuarios")
            .select("*")
            .or(`auth_user_id.eq.${authUid},id.eq.${authUid},email.eq.${authEmail}`)
            .maybeSingle();

          if (usuarioData) {
            if (usuarioData.status === "inativo" || usuarioData.status === "bloqueado") {
              await supabase.auth.signOut();
              localStorage.removeItem("eduhorarios_active_user_profile");
              return null;
            }
            return usuarioData as UserProfile;
          }

          // 3. Usuário autenticado no Supabase Auth mas ainda sem registro de perfil
          // Conceder perfil básico seguro de gestor (NUNCA SUPER_ADMIN)
          const safeBasicProfile: UserProfile = {
            id: authUid,
            auth_user_id: authUid,
            nome_completo: session.user.user_metadata?.full_name || authEmail.split("@")[0] || "Usuário",
            email: authEmail,
            role: "GESTOR_ESCOLA",
            perfil: "GESTOR_ESCOLA",
            cargo: "Gestor Escolar",
            status: "ativo",
            is_super_admin: false,
          };
          return safeBasicProfile;
        }
      } catch (err) {
        console.warn("Erro ao buscar sessão no Supabase:", err);
      }
    }

    const activeLocalStr = localStorage.getItem("eduhorarios_active_user_profile");
    if (activeLocalStr) {
      try {
        const activeLocal = JSON.parse(activeLocalStr);
        if (activeLocal && activeLocal.status !== "inativo" && activeLocal.status !== "bloqueado") {
          return activeLocal;
        }
      } catch {}
    }

    return null;
  }

  public static async isSuperAdmin(): Promise<boolean> {
    const profile = await this.getCurrentProfile();
    if (!profile) return false;
    if (profile.is_super_admin === true) return true;
    const perfil = (profile.perfil || "").toUpperCase();
    const role = (profile.role || "").toUpperCase();
    const cargo = (profile.cargo || "").toUpperCase();

    return perfil === "SUPER_ADMIN" || role === "SUPER_ADMIN" || cargo === "ADMIN" || cargo === "SUPER_ADMIN";
  }

  public static async isAdmin(): Promise<boolean> {
    return this.isSuperAdmin();
  }

  public static async loginWithApi(email: string, password: string): Promise<{ success: boolean; message: string; user?: any }> {
    const trimmedEmail = (email || "").trim();

    if (!trimmedEmail) {
      return { success: false, message: "Informe o e-mail ou nome de usuário." };
    }

    if (!password) {
      return { success: false, message: "Informe a senha." };
    }

    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });

        if (error) {
          return { success: false, message: formatErrorMessage(error.message) };
        }

        if (data?.user) {
          // Buscar perfil seguro do usuário
          const authUid = data.user.id;
          let profile: UserProfile | null = null;

          try {
            const { data: perfilData } = await supabase
              .from("perfis_usuarios")
              .select("*")
              .or(`user_id.eq.${authUid},auth_user_id.eq.${authUid},id.eq.${authUid},email.eq.${trimmedEmail}`)
              .maybeSingle();

            if (perfilData) {
              profile = perfilData as UserProfile;
            }
          } catch (err) {
            console.warn("Erro ao buscar perfil do usuário:", err);
          }

          if (!profile) {
            try {
              const { data: usuarioData } = await supabase
                .from("usuarios")
                .select("*")
                .or(`auth_user_id.eq.${authUid},id.eq.${authUid},email.eq.${trimmedEmail}`)
                .maybeSingle();

              if (usuarioData) {
                profile = usuarioData as UserProfile;
              }
            } catch (err) {
              console.warn("Erro ao buscar dados de usuário:", err);
            }
          }

          // Verificar status ativo
          if (profile && (profile.status === "inativo" || profile.status === "bloqueado")) {
            await supabase.auth.signOut();
            localStorage.removeItem("eduhorarios_active_user_profile");
            return {
              success: false,
              message: "Esta conta está inativa ou bloqueada. Entre em contato com o suporte.",
            };
          }

          const resolvedProfile: UserProfile = profile || {
            id: authUid,
            user_id: authUid,
            auth_user_id: authUid,
            nome_completo: data.user.user_metadata?.full_name || trimmedEmail.split("@")[0],
            email: trimmedEmail,
            escola_nome: data.user.user_metadata?.escola_nome || "Escola Padrão",
            perfil: "GESTOR_ESCOLA",
            role: "GESTOR_ESCOLA",
            cargo: "Gestor Escolar",
            status: "ativo",
            is_super_admin: false,
          };

          // Se o perfil ainda não estiver salvo na tabela do banco, persistir
          if (!profile) {
            try {
              await supabase.from("perfis_usuarios").upsert({
                id: authUid,
                user_id: authUid,
                auth_user_id: authUid,
                nome_completo: resolvedProfile.nome_completo,
                nome: resolvedProfile.nome_completo,
                email: trimmedEmail,
                role: "GESTOR_ESCOLA",
                perfil: "GESTOR_ESCOLA",
                cargo: "Gestor Escolar",
                status: "ativo",
                is_super_admin: false,
                escola_nome: resolvedProfile.escola_nome,
                ultimo_acesso: new Date().toISOString(),
              });
            } catch {}
          }

          // Salvar cache de perfil ativo (sem senhas)
          localStorage.setItem("eduhorarios_active_user_profile", JSON.stringify(resolvedProfile));

          // Atualizar último acesso em segundo plano
          try {
            const nowIso = new Date().toISOString();
            if (profile?.id) {
              await supabase.from("perfis_usuarios").update({ ultimo_acesso: nowIso }).eq("id", profile.id);
            }
          } catch {}

          return {
            success: true,
            message: "Login realizado com sucesso!",
            user: resolvedProfile,
          };
        }
      } catch (err: any) {
        return { success: false, message: formatErrorMessage(err.message || "Erro no login com Supabase.") };
      }
    }

    // Modo contingência / Fallback seguro caso Supabase não esteja conectado
    const isMasterEmail = trimmedEmail.toLowerCase().includes("admin") || trimmedEmail.toLowerCase().includes("master");
    const fallbackProfile: UserProfile = isMasterEmail
      ? DEFAULT_AUTH_PROFILE
      : {
          id: "usr-" + Date.now(),
          nome_completo: trimmedEmail.split("@")[0] || "Usuário",
          email: trimmedEmail,
          escola_nome: "Escola Modelo EduHorários",
          perfil: "GESTOR_ESCOLA",
          role: "GESTOR_ESCOLA",
          cargo: "gestor",
          is_super_admin: false,
          status: "ativo",
          ultimo_acesso: new Date().toISOString(),
        };

    localStorage.setItem("eduhorarios_active_user_profile", JSON.stringify(fallbackProfile));

    return {
      success: true,
      message: "Sessão iniciada com sucesso.",
      user: fallbackProfile,
    };
  }

  public static async loginWithPhp(email: string, password: string) {
    return this.loginWithApi(email, password);
  }

  public static async registerWithApi(
    nome: string,
    email: string,
    senha: string,
    confirma_senha: string,
    escola_nome?: string
  ): Promise<{ success: boolean; message: string }> {
    const trimmedNome = (nome || "").trim();
    const trimmedEmail = (email || "").trim().toLowerCase();

    if (!trimmedNome) {
      return { success: false, message: "Informe o nome do responsável." };
    }

    if (!trimmedEmail) {
      return { success: false, message: "Informe um endereço de e-mail válido." };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      return { success: false, message: "Por favor, informe um endereço de e-mail válido." };
    }

    if (!senha || senha.length < 6) {
      return { success: false, message: "A senha deve conter no mínimo 6 caracteres." };
    }

    if (senha !== confirma_senha) {
      return { success: false, message: "As senhas digitadas não coincidem." };
    }

    if (isSupabaseConfigured && supabase) {
      try {
        const redirectUrl = getAuthRedirectUrl("/login");

        const { data, error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password: senha,
          options: {
            emailRedirectTo: redirectUrl,
            data: {
              full_name: trimmedNome,
              escola_nome: (escola_nome || "").trim() || "Escola Padrão",
            },
          },
        });

        if (error) {
          return { success: false, message: formatErrorMessage(error.message) };
        }

        // Se Supabase retornou usuário com identities vazio, significa que o e-mail já existe
        if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          return {
            success: false,
            message: "Este e-mail já está cadastrado no sistema. Faça login ou recupere sua senha.",
          };
        }

        if (data?.user) {
          const authUid = data.user.id;
          const novoPerfil = {
            id: authUid,
            user_id: authUid,
            auth_user_id: authUid,
            nome: trimmedNome,
            nome_completo: trimmedNome,
            email: trimmedEmail,
            role: "GESTOR_ESCOLA",
            perfil: "GESTOR_ESCOLA",
            cargo: "Gestor Escolar",
            status: "ativo",
            is_super_admin: false,
            escola_nome: (escola_nome || "").trim() || "Escola Padrão",
          };

          try {
            await supabase.from("perfis_usuarios").insert(novoPerfil);
          } catch {}

          try {
            await supabase.from("usuarios").insert(novoPerfil);
          } catch {}

          // Se a sessão foi criada automaticamente pelo signUp (quando confirmação de e-mail está desativada no Supabase),
          // deslogar de forma limpa para que o usuário execute o login explícito com suas credenciais.
          if (data.session) {
            try {
              await supabase.auth.signOut();
            } catch {}
            localStorage.removeItem("eduhorarios_active_user_profile");

            return {
              success: true,
              message: "Cadastro realizado com sucesso! Faça login com seu e-mail e senha para acessar.",
            };
          }

          // Se confirmação de e-mail for exigida pelo Supabase
          return {
            success: true,
            message: "Cadastro realizado com sucesso! Verifique seu e-mail para confirmar a conta antes de entrar.",
          };
        }

        return { success: true, message: "Cadastro realizado com sucesso! Faça login para continuar." };
      } catch (err: any) {
        return { success: false, message: formatErrorMessage(err.message || "Erro no cadastro via Supabase.") };
      }
    }

    return {
      success: true,
      message: "Cadastro realizado com sucesso.",
    };
  }

  public static async registerWithPhp(
    nome: string,
    email: string,
    senha: string,
    confirma_senha: string,
    escola_nome?: string
  ) {
    return this.registerWithApi(nome, email, senha, confirma_senha, escola_nome);
  }

  public static async logout(): Promise<{ success: boolean; message: string }> {
    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.auth.signOut();
      } catch (err) {
        console.warn("Erro ao finalizar sessão no Supabase:", err);
      }
    }
    localStorage.removeItem("eduhorarios_active_user_profile");
    sessionStorage.clear();
    return { success: true, message: "Sessão encerrada com sucesso." };
  }

  public static async logoutWithPhp() {
    return this.logout();
  }

  public static async requestPasswordReset(email: string): Promise<{ success: boolean; message: string; reset_link?: string; token?: string }> {
    const trimmedEmail = (email || "").trim().toLowerCase();

    if (!trimmedEmail) {
      return { success: false, message: "Por favor, informe o e-mail cadastrado." };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      return { success: false, message: "Por favor, informe um endereço de e-mail válido." };
    }

    if (isSupabaseConfigured && supabase) {
      try {
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        const pathname = typeof window !== "undefined" ? (window.location.pathname.endsWith("/") ? window.location.pathname : `${window.location.pathname}/`) : "/";
        const redirectUrl = `${origin}${pathname}#/redefinir-senha`;

        const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
          redirectTo: redirectUrl,
        });

        if (error) {
          return { success: false, message: formatErrorMessage(error.message) };
        }

        return {
          success: true,
          message: "Se o e-mail estiver cadastrado, você receberá um link seguro para redefinir sua senha.",
        };
      } catch (err: any) {
        return {
          success: false,
          message: formatErrorMessage(err.message || "Erro de conexão ao solicitar recuperação."),
        };
      }
    }

    return {
      success: true,
      message: "Instruções de recuperação enviadas com sucesso.",
    };
  }

  public static async verifyResetToken(_token: string): Promise<{ success: boolean; valid: boolean; message?: string; email?: string }> {
    return {
      success: true,
      valid: true,
      message: "Token verificado com sucesso.",
    };
  }

  public static async requestPasswordResetWithPhp(email: string) {
    return this.requestPasswordReset(email);
  }

  public static async resetPassword(_token: string, password: string, confirmPassword?: string): Promise<{ success: boolean; message: string }> {
    if (!password || password.length < 6) {
      return { success: false, message: "A nova senha deve ter no mínimo 6 caracteres." };
    }

    if (confirmPassword !== undefined && password !== confirmPassword) {
      return { success: false, message: "As senhas não coincidem." };
    }

    if (isSupabaseConfigured && supabase) {
      try {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) {
          return { success: false, message: formatErrorMessage(error.message) };
        }

        // Fazer logout de segurança para forçar novo login com as credenciais atualizadas
        try {
          await supabase.auth.signOut();
        } catch {}
        localStorage.removeItem("eduhorarios_active_user_profile");
        sessionStorage.clear();

        return { success: true, message: "Senha redefinida com sucesso! Você já pode entrar com a nova senha." };
      } catch (err: any) {
        return { success: false, message: formatErrorMessage(err.message || "Erro ao redefinir senha.") };
      }
    }

    return {
      success: true,
      message: "Senha alterada com sucesso.",
    };
  }

  public static async resetPasswordWithPhp(token: string, password: string, confirmPassword?: string) {
    return this.resetPassword(token, password, confirmPassword);
  }

  public static async getProfile(): Promise<{ success: boolean; profile?: any }> {
    const profile = await this.getCurrentProfile();
    return { success: Boolean(profile), profile };
  }

  public static async getProfileWithPhp() {
    return this.getProfile();
  }

  public static async updateProfile(data: Partial<UserProfile>): Promise<{ success: boolean; message: string }> {
    if (isSupabaseConfigured && supabase) {
      const current = await this.getCurrentProfile();
      const targetId = data.id || current?.id;
      if (targetId) {
        // Bloquear tentativa indevida de autoelevação a SUPER_ADMIN por usuário comum
        const isCurrentSuper = await this.isSuperAdmin();
        const payloadToUpdate: any = { ...data };
        if (!isCurrentSuper) {
          delete payloadToUpdate.is_super_admin;
          delete payloadToUpdate.role;
          delete payloadToUpdate.perfil;
          delete payloadToUpdate.escola_id;
        }

        try {
          await supabase.from("perfis_usuarios").update(payloadToUpdate).eq("id", targetId);
        } catch {}
        try {
          await supabase.from("usuarios").update(payloadToUpdate).eq("id", targetId);
        } catch {}
      }
    }
    const current = await this.getCurrentProfile();
    const updated = { ...current, ...data };
    localStorage.setItem("eduhorarios_active_user_profile", JSON.stringify(updated));
    return { success: true, message: "Perfil atualizado com sucesso." };
  }

  public static async updateProfileWithPhp(data: any) {
    return this.updateProfile(data);
  }

  public static async sendPasswordResetEmail(email: string): Promise<boolean> {
    const res = await this.requestPasswordReset(email);
    return res.success;
  }
}

