import { UserProfile } from "@/services/AuthService";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export interface LogAuditoriaMaster {
  id?: string;
  admin_id: string;
  admin_nome: string;
  data_hora?: string;
  ip_origem?: string;
  acao: string;
  usuario_afetado_id: string;
  usuario_afetado_nome?: string;
  escola?: string;
  detalhes?: string;
  resultado?: string;
}

export interface MasterUserFilters {
  search?: string;
  escola?: string;
  cidade?: string;
  status?: string;
  perfil?: string;
  cargo?: string;
}

export interface UserFilters extends MasterUserFilters {}

const DEFAULT_USERS_STORE: UserProfile[] = [
  {
    id: "usr-admin-1",
    nome_completo: "Administrador EduHorários",
    nome_usuario: "admin",
    email: "admin@eduhorarios.com.br",
    telefone: "(31) 99887-6655",
    escola_nome: "Escola Modelo EduHorários",
    cidade: "Belo Horizonte",
    estado: "MG",
    perfil: "SUPER_ADMIN",
    cargo: "admin",
    status: "ativo",
    observacoes: "Administrador geral da plataforma EduHorários",
    is_super_admin: true,
    ultimo_acesso: new Date().toISOString(),
    criado_em: new Date().toISOString(),
  },
];

let inMemoryUsers: UserProfile[] = [...DEFAULT_USERS_STORE];
let inMemoryLogs: LogAuditoriaMaster[] = [];

export class UsuariosRepository {
  /**
   * Listar perfis de usuários (preparado para Supabase na Fase 2)
   */
  async listarPerfisMaster(
    page: number = 1,
    limit: number = 15,
    filters: MasterUserFilters = {}
  ) {
    let usersList = [...inMemoryUsers];

    if (isSupabaseConfigured && supabase) {
      try {
        const { data: pData, error: pError } = await supabase.from("perfis_usuarios").select("*");
        if (!pError && pData && pData.length > 0) {
          usersList = pData as UserProfile[];
        } else {
          const { data, error } = await supabase.from("usuarios").select("*");
          if (!error && data && data.length > 0) {
            usersList = data as UserProfile[];
          }
        }
      } catch (err) {
        console.warn("Erro ao listar perfis no Supabase:", err);
      }
    }

    let filtered = [...usersList];

    if (filters.search) {
      const q = filters.search.toLowerCase();
      filtered = filtered.filter(
        (u) =>
          u.nome_completo?.toLowerCase().includes(q) ||
          u.email?.toLowerCase().includes(q) ||
          u.escola_nome?.toLowerCase().includes(q) ||
          u.cidade?.toLowerCase().includes(q)
      );
    }
    if (filters.escola && filters.escola !== "todas") {
      filtered = filtered.filter((u) => u.escola_nome === filters.escola);
    }
    if (filters.cidade && filters.cidade !== "todas") {
      filtered = filtered.filter((u) => u.cidade === filters.cidade);
    }
    if (filters.status && filters.status !== "todos") {
      filtered = filtered.filter((u) => u.status === filters.status);
    }

    filtered.sort((a, b) => {
      const dateA = a.criado_em ? new Date(a.criado_em).getTime() : 0;
      const dateB = b.criado_em ? new Date(b.criado_em).getTime() : 0;
      return dateB - dateA;
    });

    const total = filtered.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const data = filtered.slice((page - 1) * limit, page * limit);

    return {
      data,
      total,
      page,
      limit,
      totalPages,
      allRecords: filtered,
    };
  }

  async listarPerfis(page: number = 1, limit: number = 10, filters: MasterUserFilters = {}) {
    return this.listarPerfisMaster(page, limit, filters);
  }

  /**
   * Criar novo usuário
   */
  async criarUsuarioMaster(novoUsuario: Omit<UserProfile, "id"> & { senhaTemporaria?: string }): Promise<UserProfile> {
    const id = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : "usr-" + Date.now() + "-" + Math.random().toString(36).substring(2, 8);

    const userPayload: UserProfile = {
      id,
      nome_completo: novoUsuario.nome_completo,
      nome_usuario: novoUsuario.email?.split("@")[0] || "usuario",
      email: novoUsuario.email,
      telefone: novoUsuario.telefone || "",
      escola_nome: novoUsuario.escola_nome || "",
      cidade: novoUsuario.cidade || "",
      estado: novoUsuario.estado || "MG",
      perfil: novoUsuario.perfil || "GESTOR_ESCOLA",
      cargo: novoUsuario.perfil === "SUPER_ADMIN" ? "admin" : "gestor",
      status: novoUsuario.status || "ativo",
      observacoes: novoUsuario.observacoes || "",
      criado_em: new Date().toISOString(),
      ultimo_acesso: undefined,
    };

    inMemoryUsers.push(userPayload);

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from("perfis_usuarios").upsert(userPayload);
      } catch {}
      try {
        await supabase.from("usuarios").upsert(userPayload);
      } catch {}
    }

    return userPayload;
  }

  /**
   * Atualizar perfil do usuário
   */
  async atualizarPerfilMaster(id: string, updates: Partial<UserProfile>): Promise<UserProfile | null> {
    const index = inMemoryUsers.findIndex((u) => u.id === id);
    if (index !== -1) {
      inMemoryUsers[index] = { ...inMemoryUsers[index], ...updates, atualizado_em: new Date().toISOString() };
    }

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from("perfis_usuarios").update(updates).eq("id", id);
      } catch {}
      try {
        await supabase.from("usuarios").update(updates).eq("id", id);
      } catch {}
    }

    return { id, ...updates } as UserProfile;
  }

  async redefinirSenhaEUsuarioMaster(
    id: string,
    payload: {
      nome_usuario?: string;
      email?: string;
      nome_completo?: string;
      nova_senha?: string;
      escola_nome?: string;
      perfil?: string;
      status?: string;
      observacoes?: string;
      telefone?: string;
      cidade?: string;
      estado?: string;
    }
  ): Promise<UserProfile | null> {
    const updates: Partial<UserProfile> = {
      ...(payload.nome_usuario ? { nome_usuario: payload.nome_usuario } : {}),
      ...(payload.email ? { email: payload.email } : {}),
      ...(payload.nome_completo ? { nome_completo: payload.nome_completo } : {}),
      ...(payload.escola_nome !== undefined ? { escola_nome: payload.escola_nome } : {}),
      ...(payload.perfil ? { perfil: payload.perfil, role: payload.perfil, cargo: payload.perfil === "SUPER_ADMIN" ? "admin" : "gestor", is_super_admin: payload.perfil === "SUPER_ADMIN" } : {}),
      ...(payload.status ? { status: payload.status } : {}),
      ...(payload.observacoes !== undefined ? { observacoes: payload.observacoes } : {}),
      ...(payload.telefone !== undefined ? { telefone: payload.telefone } : {}),
      ...(payload.cidade !== undefined ? { cidade: payload.cidade } : {}),
      ...(payload.estado !== undefined ? { estado: payload.estado } : {}),
      atualizado_em: new Date().toISOString(),
    };

    return this.atualizarPerfilMaster(id, updates);
  }

  async atualizarPerfil(id: string, updates: Partial<UserProfile>) {
    return this.atualizarPerfilMaster(id, updates);
  }

  async excluirUsuarioMaster(id: string): Promise<boolean> {
    // Proteger conta master de exclusão acidental
    const userToDel = inMemoryUsers.find((u) => u.id === id);
    if (userToDel && (userToDel.is_super_admin || userToDel.perfil === "SUPER_ADMIN" || userToDel.email === "admin@eduhorarios.com.br")) {
      console.warn("Tentativa de excluir usuário MASTER bloqueada por segurança.");
      return false;
    }

    inMemoryUsers = inMemoryUsers.filter((u) => u.id !== id);
    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from("perfis_usuarios").delete().eq("id", id);
      } catch {}
      try {
        await supabase.from("usuarios").delete().eq("id", id);
      } catch {}
    }
    return true;
  }

  async excluirUsuario(id: string) {
    return this.excluirUsuarioMaster(id);
  }

  async registrarAuditoriaMaster(log: LogAuditoriaMaster): Promise<boolean> {
    const entry: LogAuditoriaMaster = {
      id: "log-" + Date.now(),
      data_hora: new Date().toISOString(),
      ...log,
    };
    inMemoryLogs.unshift(entry);
    if (isSupabaseConfigured && supabase) {
      await supabase.from("logs_auditoria").insert(entry);
    }
    return true;
  }

  async listarLogsAuditoriaMaster(limit: number = 30): Promise<LogAuditoriaMaster[]> {
    if (isSupabaseConfigured && supabase) {
      const { data } = await supabase.from("logs_auditoria").select("*").order("data_hora", { ascending: false }).limit(limit);
      if (data) return data as LogAuditoriaMaster[];
    }
    return inMemoryLogs.slice(0, limit);
  }

  async registrarLogAuditoria(log: any) {
    return this.registrarAuditoriaMaster({
      admin_id: log.admin_id || "admin",
      admin_nome: log.admin_nome || "Admin",
      acao: log.acao || "ACAO",
      usuario_afetado_id: log.usuario_afetado_id || "usuario",
      detalhes: log.detalhes || "",
    });
  }
}

export const usuariosRepository = new UsuariosRepository();
