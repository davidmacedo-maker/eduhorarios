import { supabase, isSupabaseConfigured } from "../supabase";
import type { Turma, MatrizCurricular } from "@/types";

export interface TurmaFiltros {
  termo?: string;
  escolaId?: string;
  turno?: string;
  serie?: string;
}

export class TurmasDatabaseService {
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
      console.warn("Erro ao obter contexto de autenticação para Turmas:", err);
      return { userId: null, escolaId: null, isSuperAdmin: false };
    }
  }

  /**
   * Listar todas as turmas
   */
  async listar(filtros?: TurmaFiltros | string): Promise<Turma[]> {
    if (!isSupabaseConfigured || !supabase) {
      return [];
    }

    try {
      const authCtx = await this.getAuthContext();
      let query = supabase
        .from("turmas")
        .select("*")
        .order("nome", { ascending: true });

      const filterObj = typeof filtros === "string" ? { escolaId: filtros } : filtros;
      const targetEscolaId = filterObj?.escolaId || authCtx.escolaId;

      if (targetEscolaId) {
        query = query.eq("escola_id", targetEscolaId);
      }

      if (filterObj?.termo) {
        const t = filterObj.termo.trim();
        query = query.or(`nome.ilike.%${t}%,serie.ilike.%${t}%`);
      }
      if (filterObj?.turno) {
        query = query.eq("turno", filterObj.turno);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Erro ao listar turmas no Supabase:", error);
        throw error;
      }

      if (!data) return [];

      return data.map((row: any) => ({
        id: row.id,
        nome: row.nome || "",
        turno: row.turno || "manha",
        serie: row.serie || "",
        anoLetivo: Number(row.ano_letivo || new Date().getFullYear()),
        observacoes: row.observacoes || undefined,
        diasPermitidos: Array.isArray(row.dias_permitidos) ? row.dias_permitidos : ["segunda", "terca", "quarta", "quinta", "sexta"],
        estrategiaDistribuicao: row.estrategia_distribuicao || "auto",
        quantidadeAlunos: row.quantidade_alunos !== undefined && row.quantidade_alunos !== null ? Number(row.quantidade_alunos) : undefined,
        cargaHoraria: row.carga_horaria !== undefined && row.carga_horaria !== null ? Number(row.carga_horaria) : undefined,
      }));
    } catch (err) {
      console.error("Falha ao carregar turmas do Supabase:", err);
      return [];
    }
  }

  /**
   * Buscar turma por ID
   */
  async buscarPorId(id: string): Promise<Turma | null> {
    if (!isSupabaseConfigured || !supabase || !id) return null;

    try {
      const authCtx = await this.getAuthContext();
      let query = supabase
        .from("turmas")
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
        turno: data.turno || "manha",
        serie: data.serie || "",
        anoLetivo: Number(data.ano_letivo || new Date().getFullYear()),
        observacoes: data.observacoes || undefined,
        diasPermitidos: Array.isArray(data.dias_permitidos) ? data.dias_permitidos : ["segunda", "terca", "quarta", "quinta", "sexta"],
        estrategiaDistribuicao: data.estrategia_distribuicao || "auto",
      };
    } catch (err) {
      console.error("Erro ao buscar turma:", err);
      return null;
    }
  }

  /**
   * Salvar ou atualizar turma individual
   */
  async salvar(turma: Turma, customEscolaId?: string): Promise<Turma | null> {
    if (!isSupabaseConfigured || !supabase) return turma;

    try {
      const authCtx = await this.getAuthContext();
      const targetEscolaId = authCtx.isSuperAdmin && customEscolaId 
        ? customEscolaId 
        : (authCtx.escolaId || customEscolaId || "00000000-0000-0000-0000-000000000001");

      const payload: any = {
        id: turma.id,
        escola_id: targetEscolaId,
        user_id: authCtx.userId || undefined,
        nome: turma.nome,
        turno: turma.turno || "manha",
        serie: turma.serie || null,
        ano_letivo: turma.anoLetivo || new Date().getFullYear(),
        observacoes: turma.observacoes || null,
        dias_permitidos: turma.diasPermitidos || ["segunda", "terca", "quarta", "quinta", "sexta"],
        estrategia_distribuicao: turma.estrategiaDistribuicao || "auto",
        ativo: true,
        atualizado_em: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from("turmas")
        .upsert(payload, { onConflict: "id" })
        .select()
        .maybeSingle();

      if (error) {
        console.error("Erro ao salvar turma no Supabase:", error);
        throw error;
      }

      return data ? turma : null;
    } catch (err) {
      console.error("Erro ao persistir turma no Supabase:", err);
      throw err;
    }
  }

  /**
   * Salvar lote de turmas
   */
  async salvarLote(turmas: Turma[], customEscolaId?: string): Promise<boolean> {
    if (!isSupabaseConfigured || !supabase) return true;

    try {
      if (!turmas || turmas.length === 0) return true;

      const authCtx = await this.getAuthContext();
      const targetEscolaId = authCtx.isSuperAdmin && customEscolaId 
        ? customEscolaId 
        : (authCtx.escolaId || customEscolaId || "00000000-0000-0000-0000-000000000001");

      const payloads = turmas.map((t) => ({
        id: t.id,
        escola_id: targetEscolaId,
        user_id: authCtx.userId || undefined,
        nome: t.nome,
        turno: t.turno || "manha",
        serie: t.serie || null,
        ano_letivo: t.anoLetivo || new Date().getFullYear(),
        observacoes: t.observacoes || null,
        dias_permitidos: t.diasPermitidos || ["segunda", "terca", "quarta", "quinta", "sexta"],
        estrategia_distribuicao: t.estrategiaDistribuicao || "auto",
        ativo: true,
        atualizado_em: new Date().toISOString(),
      }));

      const { error } = await supabase
        .from("turmas")
        .upsert(payloads, { onConflict: "id" });

      if (error) {
        console.error("Erro ao salvar lote de turmas no Supabase:", error);
        throw error;
      }

      return true;
    } catch (err) {
      console.error("Falha ao salvar lote de turmas:", err);
      return false;
    }
  }

  /**
   * Excluir turma por ID de forma segura
   */
  async excluir(id: string): Promise<boolean> {
    if (!isSupabaseConfigured || !supabase || !id) return true;

    try {
      const authCtx = await this.getAuthContext();

      // Limpar alocações dependentes da turma antes de excluir
      try {
        await supabase
          .from("alocacoes")
          .delete()
          .eq("turma_id", id);
      } catch (allocErr) {
        console.warn("Aviso ao limpar alocações da turma:", allocErr);
      }

      // Limpar matriz curricular da turma
      try {
        await supabase
          .from("matriz_curricular")
          .delete()
          .eq("turma_id", id);
      } catch (matErr) {
        console.warn("Aviso ao limpar matriz curricular da turma:", matErr);
      }

      let query = supabase
        .from("turmas")
        .delete()
        .eq("id", id);

      if (authCtx.escolaId && !authCtx.isSuperAdmin) {
        query = query.eq("escola_id", authCtx.escolaId);
      }

      const { error } = await query;

      if (error) {
        console.error("Erro ao excluir turma no Supabase:", error);
        throw error;
      }

      return true;
    } catch (err) {
      console.error("Falha ao excluir turma no Supabase:", err);
      return false;
    }
  }

  /**
   * Listar matriz curricular das turmas
   */
  async listarMatriz(customEscolaId?: string): Promise<MatrizCurricular[]> {
    if (!isSupabaseConfigured || !supabase) return [];

    try {
      const authCtx = await this.getAuthContext();
      let query = supabase
        .from("matriz_curricular")
        .select("*");

      const targetEscolaId = authCtx.isSuperAdmin && customEscolaId 
        ? customEscolaId 
        : (authCtx.escolaId || customEscolaId);

      if (targetEscolaId) {
        query = query.eq("escola_id", targetEscolaId);
      }

      const { data, error } = await query;

      if (error || !data) return [];

      return data.map((row: any) => ({
        turmaId: row.turma_id,
        disciplinaId: row.disciplina_id,
        aulasPorSemana: Number(row.aulas_por_semana || 0),
      }));
    } catch (err) {
      console.error("Falha ao listar matriz curricular:", err);
      return [];
    }
  }

  /**
   * Salvar matriz curricular
   */
  async salvarMatriz(matriz: MatrizCurricular[], customEscolaId?: string): Promise<boolean> {
    if (!isSupabaseConfigured || !supabase) return true;

    try {
      if (!matriz || matriz.length === 0) return true;

      const authCtx = await this.getAuthContext();
      const targetEscolaId = authCtx.isSuperAdmin && customEscolaId 
        ? customEscolaId 
        : (authCtx.escolaId || customEscolaId || "00000000-0000-0000-0000-000000000001");

      const payloads = matriz.map((m) => ({
        escola_id: targetEscolaId,
        user_id: authCtx.userId || undefined,
        turma_id: m.turmaId,
        disciplina_id: m.disciplinaId,
        aulas_por_semana: Number(m.aulasPorSemana || 0),
        atualizado_em: new Date().toISOString(),
      }));

      const { error } = await supabase
        .from("matriz_curricular")
        .upsert(payloads, { onConflict: "escola_id,turma_id,disciplina_id" });

      if (error) {
        // Fallback caso a constraint seja turma_id,disciplina_id
        await supabase
          .from("matriz_curricular")
          .upsert(payloads, { onConflict: "turma_id,disciplina_id" });
      }

      return true;
    } catch (err) {
      console.error("Falha ao salvar matriz curricular:", err);
      return false;
    }
  }
}

export const turmasDbService = new TurmasDatabaseService();

