import { supabase, isSupabaseConfigured } from "../supabase";
import type { Professor } from "@/types";
import { normalizeProfessor } from "@/store";

export interface ProfessorFiltros {
  termo?: string;
  escolaId?: string;
  disciplinaId?: string;
  turmaId?: string;
  status?: string;
}

export class ProfessoresDatabaseService {
  /**
   * Obtém o contexto autenticado seguro (escola e usuário)
   */
  private async getAuthContext(): Promise<{ userId: string | null; escolaId: string | null; isSuperAdmin: boolean }> {
    if (!isSupabaseConfigured || !supabase) {
      return { userId: null, escolaId: null, isSuperAdmin: false };
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        // Fallback para cache de sessão ativa
        const activeLocalStr = localStorage.getItem("eduhorarios_active_user_profile");
        if (activeLocalStr) {
          const parsed = JSON.parse(activeLocalStr);
          return {
            userId: parsed.id || null,
            escolaId: parsed.escola_id || null,
            isSuperAdmin: Boolean(parsed.is_super_admin || parsed.role === "SUPER_ADMIN" || parsed.perfil === "SUPER_ADMIN"),
          };
        }
        return { userId: null, escolaId: null, isSuperAdmin: false };
      }

      const authUid = session.user.id;
      const { data: perfil } = await supabase
        .from("perfis_usuarios")
        .select("id, escola_id, is_super_admin, role, perfil")
        .or(`user_id.eq.${authUid},auth_user_id.eq.${authUid},id.eq.${authUid}`)
        .maybeSingle();

      if (perfil) {
        const isSuper = Boolean(perfil.is_super_admin || perfil.role === "SUPER_ADMIN" || perfil.perfil === "SUPER_ADMIN");
        return {
          userId: perfil.id || authUid,
          escolaId: perfil.escola_id || null,
          isSuperAdmin: isSuper,
        };
      }

      return {
        userId: authUid,
        escolaId: null,
        isSuperAdmin: false,
      };
    } catch (err) {
      console.warn("Erro ao obter contexto de autenticação para Professores:", err);
      return { userId: null, escolaId: null, isSuperAdmin: false };
    }
  }

  /**
   * Listar todos os professores vinculados à escola do usuário autenticado
   */
  async listar(filtros?: ProfessorFiltros | string): Promise<Professor[]> {
    if (!isSupabaseConfigured || !supabase) {
      return [];
    }

    try {
      const authCtx = await this.getAuthContext();
      let query = supabase
        .from("professores")
        .select("*")
        .order("nome_completo", { ascending: true });

      // Se for passado escolaId explicitamente ou via contexto (e não for Super Admin solicitando tudo)
      const filterObj = typeof filtros === "string" ? { escolaId: filtros } : filtros;
      const targetEscolaId = filterObj?.escolaId || authCtx.escolaId;

      if (targetEscolaId) {
        query = query.eq("escola_id", targetEscolaId);
      }

      if (filterObj?.termo) {
        const t = filterObj.termo.trim();
        query = query.or(`nome_completo.ilike.%${t}%,masp.ilike.%${t}%,cargo.ilike.%${t}%`);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Erro ao listar professores no Supabase:", error);
        throw error;
      }

      if (!data) return [];

      return data.map((row: any) =>
        normalizeProfessor({
          id: row.id,
          nomeCompleto: row.nome_completo,
          masp: row.masp || undefined,
          dataAdmissao: row.data_admissao || undefined,
          tipoVinculo: row.tipo_vinculo || undefined,
          cargo: row.cargo || undefined,
          disciplinas: Array.isArray(row.disciplinas) ? row.disciplinas : [],
          turmas: Array.isArray(row.turmas) ? row.turmas : [],
          disponibilidade: row.disponibilidade && typeof row.disponibilidade === "object" ? row.disponibilidade : {},
          cargaHorariaMaximaSemanal: Number(row.carga_horaria_maxima_semanal || 40),
          planejamento: Array.isArray(row.planejamento) ? row.planejamento : [],
          email: row.email || undefined,
          telefone: row.telefone || undefined,
          observacoes: row.observacoes || undefined,
          status: row.ativo === false ? "inativo" : (row.status || "ativo"),
        })
      );
    } catch (err) {
      console.error("Falha ao carregar professores do Supabase:", err);
      return [];
    }
  }

  /**
   * Buscar professor por ID
   */
  async buscarPorId(id: string): Promise<Professor | null> {
    if (!isSupabaseConfigured || !supabase || !id) return null;

    try {
      const authCtx = await this.getAuthContext();
      let query = supabase
        .from("professores")
        .select("*")
        .eq("id", id);

      if (authCtx.escolaId && !authCtx.isSuperAdmin) {
        query = query.eq("escola_id", authCtx.escolaId);
      }

      const { data, error } = await query.maybeSingle();

      if (error || !data) return null;

      return normalizeProfessor({
        id: data.id,
        nomeCompleto: data.nome_completo,
        masp: data.masp || undefined,
        dataAdmissao: data.data_admissao || undefined,
        tipoVinculo: data.tipo_vinculo || undefined,
        cargo: data.cargo || undefined,
        disciplinas: Array.isArray(data.disciplinas) ? data.disciplinas : [],
        turmas: Array.isArray(data.turmas) ? data.turmas : [],
        disponibilidade: data.disponibilidade && typeof data.disponibilidade === "object" ? data.disponibilidade : {},
        cargaHorariaMaximaSemanal: Number(data.carga_horaria_maxima_semanal || 40),
        planejamento: Array.isArray(data.planejamento) ? data.planejamento : [],
        email: data.email || undefined,
        telefone: data.telefone || undefined,
        observacoes: data.observacoes || undefined,
        status: data.ativo === false ? "inativo" : (data.status || "ativo"),
      });
    } catch (err) {
      console.error("Erro ao buscar professor:", err);
      return null;
    }
  }

  /**
   * Salvar ou atualizar professor individual
   */
  async salvar(professor: Professor, customEscolaId?: string): Promise<Professor | null> {
    if (!isSupabaseConfigured || !supabase) return professor;

    try {
      const authCtx = await this.getAuthContext();
      const normalized = normalizeProfessor(professor);

      // Escola autorizada: usuário comum não pode trocar a escola do professor
      const targetEscolaId = authCtx.isSuperAdmin && customEscolaId 
        ? customEscolaId 
        : (authCtx.escolaId || customEscolaId || "00000000-0000-0000-0000-000000000001");

      const payload: any = {
        id: normalized.id,
        escola_id: targetEscolaId,
        user_id: authCtx.userId || undefined,
        nome_completo: normalized.nomeCompleto,
        masp: normalized.masp || null,
        data_admissao: normalized.dataAdmissao || null,
        tipo_vinculo: normalized.tipoVinculo || "efetivo",
        cargo: normalized.cargo || null,
        disciplinas: normalized.disciplinas || [],
        turmas: normalized.turmas || [],
        disponibilidade: normalized.disponibilidade || {},
        carga_horaria_maxima_semanal: normalized.cargaHorariaMaximaSemanal || 40,
        planejamento: normalized.planejamento || [],
        ativo: (normalized as any).status !== "inativo",
        atualizado_em: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from("professores")
        .upsert(payload, { onConflict: "id" })
        .select()
        .maybeSingle();

      if (error) {
        console.error("Erro ao salvar professor no Supabase:", error);
        throw error;
      }

      return data ? normalized : null;
    } catch (err) {
      console.error("Erro ao persistir professor no Supabase:", err);
      throw err;
    }
  }

  /**
   * Salvar lote de professores (sincronização em massa)
   */
  async salvarLote(professores: Professor[], customEscolaId?: string): Promise<boolean> {
    if (!isSupabaseConfigured || !supabase) return true;

    try {
      if (!professores || professores.length === 0) return true;

      const authCtx = await this.getAuthContext();
      const targetEscolaId = authCtx.isSuperAdmin && customEscolaId 
        ? customEscolaId 
        : (authCtx.escolaId || customEscolaId || "00000000-0000-0000-0000-000000000001");

      const payloads = professores.map((p) => {
        const norm = normalizeProfessor(p);
        return {
          id: norm.id,
          escola_id: targetEscolaId,
          user_id: authCtx.userId || undefined,
          nome_completo: norm.nomeCompleto,
          masp: norm.masp || null,
          data_admissao: norm.dataAdmissao || null,
          tipo_vinculo: norm.tipoVinculo || "efetivo",
          cargo: norm.cargo || null,
          disciplinas: norm.disciplinas || [],
          turmas: norm.turmas || [],
          disponibilidade: norm.disponibilidade || {},
          carga_horaria_maxima_semanal: norm.cargaHorariaMaximaSemanal || 40,
          planejamento: norm.planejamento || [],
          ativo: (norm as any).status !== "inativo",
          atualizado_em: new Date().toISOString(),
        };
      });

      const { error } = await supabase
        .from("professores")
        .upsert(payloads, { onConflict: "id" });

      if (error) {
        console.error("Erro ao salvar lote de professores no Supabase:", error);
        throw error;
      }

      return true;
    } catch (err) {
      console.error("Falha ao salvar lote de professores:", err);
      return false;
    }
  }

  /**
   * Excluir professor por ID com segurança de dependências
   */
  async excluir(id: string): Promise<boolean> {
    if (!isSupabaseConfigured || !supabase || !id) return true;

    try {
      const authCtx = await this.getAuthContext();

      // Limpar alocações dependentes se necessário
      try {
        await supabase
          .from("alocacoes")
          .delete()
          .eq("professor_id", id);
      } catch (allocErr) {
        console.warn("Aviso ao limpar alocações do professor:", allocErr);
      }

      let query = supabase
        .from("professores")
        .delete()
        .eq("id", id);

      if (authCtx.escolaId && !authCtx.isSuperAdmin) {
        query = query.eq("escola_id", authCtx.escolaId);
      }

      const { error } = await query;

      if (error) {
        console.error("Erro ao excluir professor no Supabase:", error);
        throw error;
      }

      return true;
    } catch (err) {
      console.error("Falha ao excluir professor no Supabase:", err);
      return false;
    }
  }
}

export const professoresDbService = new ProfessoresDatabaseService();

