import { supabase, isSupabaseConfigured } from "../supabase";
import type { Alocacao, RegistroPonto } from "@/types";

export class AlocacoesDatabaseService {
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
      console.warn("Erro ao obter contexto de autenticação para Alocações:", err);
      return { userId: null, escolaId: null, isSuperAdmin: false };
    }
  }

  /**
   * Listar alocações da grade da escola atual
   */
  async listar(userId?: string): Promise<Alocacao[]> {
    if (!isSupabaseConfigured || !supabase) {
      return [];
    }

    try {
      const authCtx = await this.getAuthContext();
      let query = supabase
        .from("alocacoes")
        .select("*")
        .order("created_at", { ascending: true });

      if (authCtx.escolaId && !authCtx.isSuperAdmin) {
        query = query.eq("escola_id", authCtx.escolaId);
      } else if (userId && userId !== "local" && !authCtx.isSuperAdmin) {
        query = query.eq("user_id", userId);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Erro ao listar alocações no Supabase:", error);
        throw error;
      }

      if (!data) return [];

      return data.map((row: any) => ({
        id: row.id,
        turmaId: row.turma_id,
        disciplinaId: row.disciplina_id,
        professorId: row.professor_id,
        diaSemana: row.dia_semana,
        horario: Number(row.horario || 0),
        isLocked: Boolean(row.is_locked),
      }));
    } catch (err) {
      console.error("Falha ao carregar alocações do Supabase:", err);
      return [];
    }
  }

  /**
   * Carregar alocações por escola específica
   */
  async carregarPorEscola(escolaId?: string, userId?: string): Promise<Alocacao[]> {
    if (!isSupabaseConfigured || !supabase) {
      return [];
    }

    try {
      let query = supabase.from("alocacoes").select("*").order("created_at", { ascending: true });

      if (escolaId) {
        query = query.eq("escola_id", escolaId);
      } else {
        return this.listar(userId);
      }

      const { data, error } = await query;
      if (error) throw error;
      if (!data) return [];

      return data.map((row: any) => ({
        id: row.id,
        turmaId: row.turma_id,
        disciplinaId: row.disciplina_id,
        professorId: row.professor_id,
        diaSemana: row.dia_semana,
        horario: Number(row.horario || 0),
        isLocked: Boolean(row.is_locked),
      }));
    } catch (err) {
      console.error("Falha ao carregar alocações por escola:", err);
      return [];
    }
  }

  /**
   * Criar uma nova alocação
   */
  async criar(alocacao: Alocacao, userId?: string): Promise<Alocacao | null> {
    if (!isSupabaseConfigured || !supabase) return alocacao;

    try {
      const authCtx = await this.getAuthContext();
      const payload: any = {
        id: alocacao.id,
        escola_id: authCtx.escolaId || undefined,
        user_id: authCtx.userId || userId || undefined,
        turma_id: alocacao.turmaId,
        disciplina_id: alocacao.disciplinaId,
        professor_id: alocacao.professorId,
        dia_semana: alocacao.diaSemana,
        horario: Number(alocacao.horario || 0),
        is_locked: Boolean(alocacao.isLocked),
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from("alocacoes")
        .insert(payload)
        .select()
        .single();

      if (error) {
        console.error("Erro ao criar alocação no Supabase:", error);
        throw error;
      }

      return {
        id: data.id,
        turmaId: data.turma_id,
        disciplinaId: data.disciplina_id,
        professorId: data.professor_id,
        diaSemana: data.dia_semana,
        horario: Number(data.horario || 0),
        isLocked: Boolean(data.is_locked),
      };
    } catch (err) {
      console.error("Falha ao criar alocação:", err);
      return null;
    }
  }

  /**
   * Atualizar uma alocação existente
   */
  async atualizar(alocacao: Alocacao, userId?: string): Promise<boolean> {
    if (!isSupabaseConfigured || !supabase) return true;

    try {
      const authCtx = await this.getAuthContext();
      const payload: any = {
        turma_id: alocacao.turmaId,
        disciplina_id: alocacao.disciplinaId,
        professor_id: alocacao.professorId,
        dia_semana: alocacao.diaSemana,
        horario: Number(alocacao.horario || 0),
        is_locked: Boolean(alocacao.isLocked),
        updated_at: new Date().toISOString(),
      };

      if (authCtx.escolaId) payload.escola_id = authCtx.escolaId;
      if (authCtx.userId || userId) payload.user_id = authCtx.userId || userId;

      const { error } = await supabase
        .from("alocacoes")
        .update(payload)
        .eq("id", alocacao.id);

      if (error) {
        console.error("Erro ao atualizar alocação no Supabase:", error);
        throw error;
      }

      return true;
    } catch (err) {
      console.error("Falha ao atualizar alocação:", err);
      return false;
    }
  }

  /**
   * Salvar ou atualizar lote de alocações da grade
   */
  async salvarLote(alocacoes: Alocacao[], userId?: string): Promise<boolean> {
    if (!isSupabaseConfigured || !supabase) return true;

    try {
      if (!alocacoes || alocacoes.length === 0) {
        return true;
      }

      const authCtx = await this.getAuthContext();

      // Deduplica alocações por ID para evitar conflito no upsert
      const mapById = new Map<string, Alocacao>();
      alocacoes.forEach((a) => {
        if (a && a.id) {
          mapById.set(a.id, a);
        }
      });
      const uniqueAlocs = Array.from(mapById.values());

      const payloads = uniqueAlocs.map((a) => ({
        id: a.id,
        escola_id: authCtx.escolaId || undefined,
        user_id: authCtx.userId || userId || undefined,
        turma_id: a.turmaId,
        disciplina_id: a.disciplinaId,
        professor_id: a.professorId,
        dia_semana: a.diaSemana,
        horario: Number(a.horario || 0),
        is_locked: Boolean(a.isLocked),
        updated_at: new Date().toISOString(),
      }));

      // Inserir/atualizar em blocos de 100 para alta confiabilidade
      const chunkSize = 100;
      for (let i = 0; i < payloads.length; i += chunkSize) {
        const chunk = payloads.slice(i, i + chunkSize);
        const { error } = await supabase
          .from("alocacoes")
          .upsert(chunk, { onConflict: "id" });

        if (error) {
          console.error("Erro ao salvar lote de alocações no Supabase:", error);
          throw error;
        }
      }

      return true;
    } catch (err) {
      console.error("Falha ao salvar lote de alocações:", err);
      return false;
    }
  }

  /**
   * Substituir completamente as alocações da grade da escola
   */
  async substituirGrade(alocacoes: Alocacao[], userId?: string): Promise<boolean> {
    if (!isSupabaseConfigured || !supabase) return true;

    try {
      const authCtx = await this.getAuthContext();

      // 1. Limpar alocações anteriores da escola do usuário autenticado
      let delQuery = supabase.from("alocacoes").delete();
      if (authCtx.escolaId && !authCtx.isSuperAdmin) {
        delQuery = delQuery.eq("escola_id", authCtx.escolaId);
      } else {
        delQuery = delQuery.neq("id", "00000000-0000-0000-0000-000000000000");
      }

      const { error: delError } = await delQuery;
      if (delError) {
        console.warn("Aviso ao limpar alocações anteriores:", delError);
      }

      // 2. Inserir as novas alocações se houver
      if (alocacoes && alocacoes.length > 0) {
        return await this.salvarLote(alocacoes, userId);
      }

      return true;
    } catch (err) {
      console.error("Falha ao substituir grade de alocações:", err);
      return false;
    }
  }

  /**
   * Excluir uma alocação por ID
   */
  async excluir(id: string): Promise<boolean> {
    if (!isSupabaseConfigured || !supabase) return true;

    try {
      const { error } = await supabase
        .from("alocacoes")
        .delete()
        .eq("id", id);

      if (error) {
        console.error("Erro ao excluir alocação no Supabase:", error);
        throw error;
      }

      return true;
    } catch (err) {
      console.error("Falha ao excluir alocação:", err);
      return false;
    }
  }

  /**
   * Listar registros de ponto
   */
  async listarRegistrosPonto(userId?: string): Promise<RegistroPonto[]> {
    if (!isSupabaseConfigured || !supabase) return [];

    try {
      const authCtx = await this.getAuthContext();
      let query = supabase
        .from("livro_ponto")
        .select("*")
        .order("data", { ascending: false });

      if (authCtx.escolaId && !authCtx.isSuperAdmin) {
        query = query.eq("escola_id", authCtx.escolaId);
      } else if (userId && userId !== "local" && !authCtx.isSuperAdmin) {
        query = query.eq("user_id", userId);
      }

      const { data, error } = await query;

      if (error || !data) return [];

      return data.map((row: any) => ({
        id: row.id,
        alocacaoId: row.alocacao_id,
        data: row.data,
        presente: Boolean(row.presente),
        observacao: row.observacao || undefined,
        valor: row.valor || undefined,
      }));
    } catch (err) {
      console.error("Falha ao carregar livro ponto:", err);
      return [];
    }
  }

  /**
   * Upsert registros de ponto
   */
  async upsertRegistrosPonto(registros: RegistroPonto[], userId?: string): Promise<boolean> {
    if (!isSupabaseConfigured || !supabase) return true;

    try {
      if (!registros || registros.length === 0) return true;

      const authCtx = await this.getAuthContext();
      const payloads = registros.map((r) => ({
        id: r.id,
        escola_id: authCtx.escolaId || undefined,
        user_id: authCtx.userId || userId || undefined,
        alocacao_id: r.alocacaoId,
        data: r.data,
        presente: Boolean(r.presente),
        observacao: r.observacao || null,
        valor: r.valor || null,
      }));

      const { error } = await supabase
        .from("livro_ponto")
        .upsert(payloads, { onConflict: "id" });

      if (error) {
        console.error("Erro ao salvar registros de ponto no Supabase:", error);
        throw error;
      }

      return true;
    } catch (err) {
      console.error("Falha ao salvar registros de ponto:", err);
      return false;
    }
  }

  /**
   * Excluir registros de ponto por filtro
   */
  async excluirRegistrosPonto(params: { ids?: string[]; alocacao_ids?: string[]; datas?: string[] }, _userId?: string): Promise<boolean> {
    if (!isSupabaseConfigured || !supabase) return true;

    try {
      let query = supabase.from("livro_ponto").delete();

      if (params.ids && params.ids.length > 0) {
        query = query.in("id", params.ids);
      } else if (params.alocacao_ids && params.alocacao_ids.length > 0) {
        query = query.in("alocacao_id", params.alocacao_ids);
      } else if (params.datas && params.datas.length > 0) {
        query = query.in("data", params.datas);
      } else {
        return true;
      }

      const { error } = await query;

      if (error) {
        console.error("Erro ao excluir registros de ponto no Supabase:", error);
        throw error;
      }

      return true;
    } catch (err) {
      console.error("Falha ao excluir registros de ponto:", err);
      return false;
    }
  }
}

export const alocacoesDbService = new AlocacoesDatabaseService();
