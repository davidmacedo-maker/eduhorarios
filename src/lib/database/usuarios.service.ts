import { supabase, isSupabaseConfigured } from "../supabase";

export interface UserProfileData {
  id: string;
  user_id?: string;
  auth_user_id?: string;
  escola_id?: string;
  nome_completo: string;
  nome?: string;
  nome_usuario?: string;
  login?: string;
  email?: string;
  telefone?: string;
  escola_nome?: string;
  escola_codigo?: string;
  cidade?: string;
  estado?: string;
  cargo?: string;
  perfil?: string;
  role?: string;
  status?: string;
  observacoes?: string;
  is_super_admin?: boolean;
  ultimo_acesso?: string;
  criado_em?: string;
  atualizado_em?: string;
  created_at?: string;
  updated_at?: string;
  foto_url?: string;
}

/**
 * Usuários e Perfis Database Service
 * Persistência conectada ao Supabase PostgreSQL com isolamento RLS.
 */
export class UsuariosDatabaseService {
  /**
   * Buscar perfil do usuário atual
   */
  async getPerfilAtual(): Promise<UserProfileData | null> {
    if (!isSupabaseConfigured || !supabase) {
      return null;
    }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return null;

      const { data, error } = await supabase
        .from("perfis_usuarios")
        .select("*")
        .or(`user_id.eq.${session.user.id},auth_user_id.eq.${session.user.id},id.eq.${session.user.id}`)
        .maybeSingle();

      if (!error && data) return data as UserProfileData;

      // Fallback para usuarios
      const { data: uData } = await supabase
        .from("usuarios")
        .select("*")
        .or(`auth_user_id.eq.${session.user.id},id.eq.${session.user.id}`)
        .maybeSingle();

      if (uData) return uData as UserProfileData;
    } catch (err) {
      console.warn("Erro ao buscar perfil atual no banco:", err);
    }
    return null;
  }

  /**
   * Listar usuários (Master / Painel Administrativo)
   */
  async listar(filters: Record<string, any> = {}): Promise<UserProfileData[]> {
    if (!isSupabaseConfigured || !supabase) {
      return [];
    }
    try {
      let query = supabase.from("perfis_usuarios").select("*");

      if (filters.status && filters.status !== "todos") {
        query = query.eq("status", filters.status);
      }
      if (filters.role) {
        query = query.eq("role", filters.role);
      }
      if (filters.escola_id) {
        query = query.eq("escola_id", filters.escola_id);
      }

      const { data, error } = await query;
      if (!error && data && data.length > 0) {
        return data as UserProfileData[];
      }

      // Fallback para usuarios
      const { data: uData } = await supabase.from("usuarios").select("*");
      if (uData && uData.length > 0) {
        return uData as UserProfileData[];
      }
    } catch (err) {
      console.warn("Erro ao listar perfis no banco:", err);
    }
    return [];
  }

  /**
   * Salvar ou atualizar perfil
   */
  async salvar(perfil: Partial<UserProfileData>): Promise<UserProfileData | null> {
    if (!isSupabaseConfigured || !supabase || !perfil.id) return (perfil as UserProfileData) || null;

    try {
      const payload = {
        ...perfil,
        atualizado_em: new Date().toISOString(),
      };

      await supabase.from("perfis_usuarios").upsert(payload);
      await supabase.from("usuarios").upsert(payload);
      return payload as UserProfileData;
    } catch (err) {
      console.error("Erro ao salvar perfil no Supabase:", err);
      return (perfil as UserProfileData) || null;
    }
  }

  /**
   * Excluir usuário
   */
  async excluir(id: string): Promise<boolean> {
    if (!isSupabaseConfigured || !supabase) return true;
    try {
      await supabase.from("perfis_usuarios").delete().eq("id", id);
      await supabase.from("usuarios").delete().eq("id", id);
      return true;
    } catch (err) {
      console.error("Erro ao excluir usuário no Supabase:", err);
      return false;
    }
  }
}

export const usuariosDbService = new UsuariosDatabaseService();

