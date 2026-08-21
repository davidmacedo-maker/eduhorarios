import { supabase, isSupabaseConfigured } from "../supabase";
import type { Disciplina } from "@/types";

export interface DisciplinaFiltros {
  termo?: string;
  escolaId?: string;
  turno?: string;
}

export class DisciplinasDatabaseService {
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
      console.warn("Erro ao obter contexto de autenticação para Disciplinas:", err);
      return { userId: null, escolaId: null, isSuperAdmin: false };
    }
  }

  /**
   * Listar todas as disciplinas
   */
  async listar(filtros?: DisciplinaFiltros | string): Promise<Disciplina[]> {
    if (!isSupabaseConfigured || !supabase) {
      return [];
    }

    try {
      const authCtx = await this.getAuthContext();
      let query = supabase
        .from("disciplinas")
        .select("*")
        .order("nome", { ascending: true });

      const filterObj = typeof filtros === "string" ? { escolaId: filtros } : filtros;
      const targetEscolaId = filterObj?.escolaId || authCtx.escolaId;

      if (targetEscolaId) {
        query = query.eq("escola_id", targetEscolaId);
      }

      if (filterObj?.termo) {
        const t = filterObj.termo.trim();
        query = query.or(`nome.ilike.%${t}%,abreviacao.ilike.%${t}%`);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Erro ao listar disciplinas no Supabase:", error);
        throw error;
      }

      if (!data) return [];

      return data.map((row: any) => ({
        id: row.id,
        nome: row.nome || "",
        abreviacao: row.abreviacao || "",
        codigo: row.codigo || undefined,
        cor: row.cor || "#3b82f6",
        cargaHorariaSemanal: Number(row.carga_horaria_semanal || 0),
        maximoAulasPorDia: row.maximo_aulas_por_dia !== null && row.maximo_aulas_por_dia !== undefined ? Number(row.maximo_aulas_por_dia) : undefined,
        quantidadeAulas: row.quantidade_aulas !== undefined && row.quantidade_aulas !== null ? Number(row.quantidade_aulas) : undefined,
        turno: row.turno || undefined,
        observacoes: row.observacoes || undefined,
      }));
    } catch (err) {
      console.error("Falha ao carregar disciplinas do Supabase:", err);
      return [];
    }
  }

  /**
   * Buscar disciplina por ID
   */
  async buscarPorId(id: string): Promise<Disciplina | null> {
    if (!isSupabaseConfigured || !supabase || !id) return null;

    try {
      const authCtx = await this.getAuthContext();
      let query = supabase
        .from("disciplinas")
        .select("*")
        .eq("id", id);

      if (authCtx.escolaId && !authCtx.isSuperAdmin) {
        query = query.eq("escola_id", authCtx.escolaId);
      }

      const { data, error } = await query.maybeSingle();

      if (error || !data) return null;

      return {
        id: data.id,
        nome: data.nome || "",
        abreviacao: data.abreviacao || "",
        cor: data.cor || "#3b82f6",
        cargaHorariaSemanal: Number(data.carga_horaria_semanal || 0),
        maximoAulasPorDia: data.maximo_aulas_por_dia !== null && data.maximo_aulas_por_dia !== undefined ? Number(data.maximo_aulas_por_dia) : undefined,
      };
    } catch (err) {
      console.error("Erro ao buscar disciplina:", err);
      return null;
    }
  }

  /**
   * Salvar ou atualizar disciplina individual
   */
  async salvar(disciplina: Disciplina, customEscolaId?: string): Promise<Disciplina | null> {
    if (!isSupabaseConfigured || !supabase) return disciplina;

    try {
      const authCtx = await this.getAuthContext();
      const targetEscolaId = authCtx.isSuperAdmin && customEscolaId 
        ? customEscolaId 
        : (authCtx.escolaId || customEscolaId || "00000000-0000-0000-0000-000000000001");

      const payload: any = {
        id: disciplina.id,
        escola_id: targetEscolaId,
        user_id: authCtx.userId || undefined,
        nome: disciplina.nome,
        abreviacao: disciplina.abreviacao,
        cor: disciplina.cor || "#3b82f6",
        carga_horaria_semanal: disciplina.cargaHorariaSemanal || 0,
        maximo_aulas_por_dia: disciplina.maximoAulasPorDia !== undefined ? disciplina.maximoAulasPorDia : null,
        ativo: true,
        atualizado_em: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from("disciplinas")
        .upsert(payload, { onConflict: "id" })
        .select()
        .maybeSingle();

      if (error) {
        console.error("Erro ao salvar disciplina no Supabase:", error);
        throw error;
      }

      return data ? disciplina : null;
    } catch (err) {
      console.error("Erro ao persistir disciplina no Supabase:", err);
      throw err;
    }
  }

  /**
   * Salvar lote de disciplinas
   */
  async salvarLote(disciplinas: Disciplina[], customEscolaId?: string): Promise<boolean> {
    if (!isSupabaseConfigured || !supabase) return true;

    try {
      if (!disciplinas || disciplinas.length === 0) return true;

      const authCtx = await this.getAuthContext();
      const targetEscolaId = authCtx.isSuperAdmin && customEscolaId 
        ? customEscolaId 
        : (authCtx.escolaId || customEscolaId || "00000000-0000-0000-0000-000000000001");

      const payloads = disciplinas.map((d) => ({
        id: d.id,
        escola_id: targetEscolaId,
        user_id: authCtx.userId || undefined,
        nome: d.nome,
        abreviacao: d.abreviacao,
        cor: d.cor || "#3b82f6",
        carga_horaria_semanal: d.cargaHorariaSemanal || 0,
        maximo_aulas_por_dia: d.maximoAulasPorDia !== undefined ? d.maximoAulasPorDia : null,
        ativo: true,
        atualizado_em: new Date().toISOString(),
      }));

      const { error } = await supabase
        .from("disciplinas")
        .upsert(payloads, { onConflict: "id" });

      if (error) {
        console.error("Erro ao salvar lote de disciplinas no Supabase:", error);
        throw error;
      }

      return true;
    } catch (err) {
      console.error("Falha ao salvar lote de disciplinas:", err);
      return false;
    }
  }

  /**
   * Excluir disciplina por ID de forma segura
   */
  async excluir(id: string): Promise<boolean> {
    if (!isSupabaseConfigured || !supabase || !id) return true;

    try {
      const authCtx = await this.getAuthContext();

      // Limpar alocações dependentes da disciplina
      try {
        await supabase
          .from("alocacoes")
          .delete()
          .eq("disciplina_id", id);
      } catch (allocErr) {
        console.warn("Aviso ao limpar alocações da disciplina:", allocErr);
      }

      // Limpar matriz curricular dependente da disciplina
      try {
        await supabase
          .from("matriz_curricular")
          .delete()
          .eq("disciplina_id", id);
      } catch (matErr) {
        console.warn("Aviso ao limpar matriz curricular da disciplina:", matErr);
      }

      let query = supabase
        .from("disciplinas")
        .delete()
        .eq("id", id);

      if (authCtx.escolaId && !authCtx.isSuperAdmin) {
        query = query.eq("escola_id", authCtx.escolaId);
      }

      const { error } = await query;

      if (error) {
        console.error("Erro ao excluir disciplina no Supabase:", error);
        throw error;
      }

      return true;
    } catch (err) {
      console.error("Falha ao excluir disciplina no Supabase:", err);
      return false;
    }
  }
}

export const disciplinasDbService = new DisciplinasDatabaseService();

