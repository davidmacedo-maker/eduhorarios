import { supabase, isSupabaseConfigured } from "../supabase";
import type { HorarioRaw, Alocacao } from "@/types";

export interface GradeCompletaRegistro {
  id: string;
  escolaId?: string;
  userId?: string;
  versao: number;
  titulo: string;
  descricao?: string;
  alocacoes: Alocacao[];
  diagnostico?: any;
  createdAt: string;
}

export class HorariosDatabaseService {
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
      console.warn("Erro ao obter contexto de autenticação para Horários:", err);
      return { userId: null, escolaId: null, isSuperAdmin: false };
    }
  }

  /**
   * Listar registros brutos de horários importados/gerados
   */
  async listar(userId?: string): Promise<HorarioRaw[]> {
    if (!isSupabaseConfigured || !supabase) {
      return [];
    }

    try {
      const authCtx = await this.getAuthContext();
      let query = supabase
        .from("horarios_raw")
        .select("*")
        .order("created_at", { ascending: true });

      if (authCtx.escolaId && !authCtx.isSuperAdmin) {
        query = query.eq("escola_id", authCtx.escolaId);
      } else if (userId && userId !== "local" && !authCtx.isSuperAdmin) {
        query = query.eq("user_id", userId);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Erro ao listar horários no Supabase:", error);
        throw error;
      }

      if (!data) return [];

      return data.map((row: any) => ({
        id: row.id,
        turno: row.turno || "Matutino",
        turma: row.turma || "",
        disciplina: row.disciplina || "",
        professor: row.professor || "",
        dia: row.dia || "",
        aula: Number(row.aula || 0),
        horarioInicio: row.horario_inicio || undefined,
        horarioFim: row.horario_fim || undefined,
        masp: row.masp || undefined,
        cargo: row.cargo || undefined,
        importadoEm: row.importado_em || new Date().toISOString(),
      }));
    } catch (err) {
      console.error("Falha ao carregar horários do Supabase:", err);
      return [];
    }
  }

  /**
   * Buscar horário por ID
   */
  async buscarPorId(id: string): Promise<HorarioRaw | null> {
    if (!isSupabaseConfigured || !supabase) return null;

    try {
      const { data, error } = await supabase
        .from("horarios_raw")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error || !data) return null;

      return {
        id: data.id,
        turno: data.turno || "Matutino",
        turma: data.turma || "",
        disciplina: data.disciplina || "",
        professor: data.professor || "",
        dia: data.dia || "",
        aula: Number(data.aula || 0),
        horarioInicio: data.horario_inicio || undefined,
        horarioFim: data.horario_fim || undefined,
        masp: data.masp || undefined,
        cargo: data.cargo || undefined,
        importadoEm: data.importado_em || new Date().toISOString(),
      };
    } catch (err) {
      console.error("Falha ao buscar horário por ID:", err);
      return null;
    }
  }

  /**
   * Salvar um horário individual
   */
  async salvar(horario: HorarioRaw, userId?: string): Promise<boolean> {
    if (!isSupabaseConfigured || !supabase) return true;

    try {
      const authCtx = await this.getAuthContext();
      const payload = {
        id: horario.id,
        escola_id: authCtx.escolaId || undefined,
        user_id: authCtx.userId || userId || undefined,
        turno: horario.turno,
        turma: horario.turma,
        disciplina: horario.disciplina,
        professor: horario.professor,
        dia: horario.dia,
        aula: Number(horario.aula || 0),
        horario_inicio: horario.horarioInicio || null,
        horario_fim: horario.horarioFim || null,
        masp: horario.masp || null,
        cargo: horario.cargo || null,
        importado_em: horario.importadoEm || new Date().toISOString(),
      };

      const { error } = await supabase
        .from("horarios_raw")
        .upsert(payload, { onConflict: "id" });

      if (error) {
        console.error("Erro ao salvar horário no Supabase:", error);
        throw error;
      }

      return true;
    } catch (err) {
      console.error("Falha ao salvar horário:", err);
      return false;
    }
  }

  /**
   * Atualizar horário existente
   */
  async atualizar(horario: HorarioRaw, userId?: string): Promise<boolean> {
    return this.salvar(horario, userId);
  }

  /**
   * Excluir horário por ID
   */
  async excluir(id: string): Promise<boolean> {
    if (!isSupabaseConfigured || !supabase) return true;

    try {
      const { error } = await supabase
        .from("horarios_raw")
        .delete()
        .eq("id", id);

      if (error) {
        console.error("Erro ao excluir horário no Supabase:", error);
        throw error;
      }

      return true;
    } catch (err) {
      console.error("Falha ao excluir horário:", err);
      return false;
    }
  }

  /**
   * Salvar lote de horários
   */
  async salvarLote(horarios: HorarioRaw[], userId?: string): Promise<boolean> {
    if (!isSupabaseConfigured || !supabase) return true;

    try {
      if (!horarios || horarios.length === 0) return true;

      const authCtx = await this.getAuthContext();
      const payloads = horarios.map((h) => ({
        id: h.id,
        escola_id: authCtx.escolaId || undefined,
        user_id: authCtx.userId || userId || undefined,
        turno: h.turno,
        turma: h.turma,
        disciplina: h.disciplina,
        professor: h.professor,
        dia: h.dia,
        aula: Number(h.aula || 0),
        horario_inicio: h.horarioInicio || null,
        horario_fim: h.horarioFim || null,
        masp: h.masp || null,
        cargo: h.cargo || null,
        importado_em: h.importadoEm || new Date().toISOString(),
      }));

      const chunkSize = 100;
      for (let i = 0; i < payloads.length; i += chunkSize) {
        const chunk = payloads.slice(i, i + chunkSize);
        const { error } = await supabase
          .from("horarios_raw")
          .upsert(chunk, { onConflict: "id" });

        if (error) {
          console.error("Erro ao salvar lote de horários no Supabase:", error);
          throw error;
        }
      }

      return true;
    } catch (err) {
      console.error("Falha ao salvar lote de horários:", err);
      return false;
    }
  }

  /**
   * Limpar horários de uma escola/usuário
   */
  async limpar(userId?: string): Promise<boolean> {
    if (!isSupabaseConfigured || !supabase) return true;

    try {
      const authCtx = await this.getAuthContext();
      let query = supabase.from("horarios_raw").delete();

      if (authCtx.escolaId && !authCtx.isSuperAdmin) {
        query = query.eq("escola_id", authCtx.escolaId);
      } else {
        query = query.neq("id", "00000000-0000-0000-0000-000000000000");
      }

      const { error } = await query;

      if (error) {
        console.error("Erro ao limpar horários no Supabase:", error);
        throw error;
      }

      return true;
    } catch (err) {
      console.error("Falha ao limpar horários:", err);
      return false;
    }
  }

  /**
   * Salvar uma Grade Completa no histórico do Supabase
   */
  async salvarGradeCompleta(
    titulo: string,
    descricao: string,
    alocacoes: Alocacao[],
    diagnostico?: any,
    userId?: string
  ): Promise<{ id: string; versao: number } | null> {
    if (!isSupabaseConfigured || !supabase) return null;

    try {
      const authCtx = await this.getAuthContext();

      // 1. Obter a próxima versão para esta escola
      let versaoQuery = supabase
        .from("historico_grades")
        .select("versao")
        .order("versao", { ascending: false })
        .limit(1);

      if (authCtx.escolaId) {
        versaoQuery = versaoQuery.eq("escola_id", authCtx.escolaId);
      }

      const { data: latestVersao } = await versaoQuery;
      const proximaVersao = (latestVersao && latestVersao.length > 0 && latestVersao[0].versao) ? Number(latestVersao[0].versao) + 1 : 1;

      const payload = {
        escola_id: authCtx.escolaId || undefined,
        user_id: authCtx.userId || userId || undefined,
        versao: proximaVersao,
        titulo: titulo || `Grade de Horários - Versão ${proximaVersao}`,
        descricao: descricao || `Salva em ${new Date().toLocaleString("pt-BR")}`,
        alocacoes: alocacoes || [],
        diagnostico: diagnostico || {},
      };

      const { data, error } = await supabase
        .from("historico_grades")
        .insert(payload)
        .select()
        .single();

      if (error) {
        console.error("Erro ao salvar grade completa no histórico do Supabase:", error);
        throw error;
      }

      return {
        id: data.id,
        versao: data.versao,
      };
    } catch (err) {
      console.error("Falha ao salvar grade completa:", err);
      return null;
    }
  }

  /**
   * Carregar uma grade completa específica do histórico
   */
  async carregarGradeCompleta(idOuVersao?: string | number, userId?: string): Promise<GradeCompletaRegistro | null> {
    if (!isSupabaseConfigured || !supabase) return null;

    try {
      const authCtx = await this.getAuthContext();
      let query = supabase
        .from("historico_grades")
        .select("*");

      if (idOuVersao) {
        if (typeof idOuVersao === "number") {
          query = query.eq("versao", idOuVersao);
        } else if (typeof idOuVersao === "string" && idOuVersao.length > 10) {
          query = query.eq("id", idOuVersao);
        } else {
          const num = Number(idOuVersao);
          if (!isNaN(num)) {
            query = query.eq("versao", num);
          } else {
            query = query.eq("id", idOuVersao);
          }
        }
      } else {
        // Pega a versão mais recente
        query = query.order("versao", { ascending: false }).limit(1);
      }

      if (authCtx.escolaId && !authCtx.isSuperAdmin) {
        query = query.eq("escola_id", authCtx.escolaId);
      }

      const { data, error } = await query.maybeSingle();

      if (error || !data) return null;

      const alocs: Alocacao[] = Array.isArray(data.alocacoes)
        ? data.alocacoes.map((row: any) => ({
            id: row.id,
            turmaId: row.turmaId || row.turma_id,
            disciplinaId: row.disciplinaId || row.disciplina_id,
            professorId: row.professorId || row.professor_id,
            diaSemana: row.diaSemana || row.dia_semana,
            horario: Number(row.horario || 0),
            isLocked: Boolean(row.isLocked ?? row.is_locked),
          }))
        : [];

      return {
        id: data.id,
        escolaId: data.escola_id,
        userId: data.user_id,
        versao: Number(data.versao || 1),
        titulo: data.titulo || "Grade de Horários",
        descricao: data.descricao || "",
        alocacoes: alocs,
        diagnostico: data.diagnostico || {},
        createdAt: data.created_at || new Date().toISOString(),
      };
    } catch (err) {
      console.error("Falha ao carregar grade completa:", err);
      return null;
    }
  }

  /**
   * Listar todas as versões salvas no histórico de grades
   */
  async listarHistoricoGrades(userId?: string): Promise<Array<{ id: string; versao: number; titulo: string; descricao: string; totalAlocacoes: number; createdAt: string }>> {
    if (!isSupabaseConfigured || !supabase) return [];

    try {
      const authCtx = await this.getAuthContext();
      let query = supabase
        .from("historico_grades")
        .select("id, versao, titulo, descricao, alocacoes, created_at")
        .order("versao", { ascending: false });

      if (authCtx.escolaId && !authCtx.isSuperAdmin) {
        query = query.eq("escola_id", authCtx.escolaId);
      }

      const { data, error } = await query;

      if (error || !data) return [];

      return data.map((row: any) => ({
        id: row.id,
        versao: Number(row.versao || 1),
        titulo: row.titulo || `Versão ${row.versao}`,
        descricao: row.descricao || "",
        totalAlocacoes: Array.isArray(row.alocacoes) ? row.alocacoes.length : 0,
        createdAt: row.created_at || new Date().toISOString(),
      }));
    } catch (err) {
      console.error("Falha ao listar histórico de grades:", err);
      return [];
    }
  }

  /**
   * Excluir uma versão do histórico de grades
   */
  async excluirGradeHistorico(id: string): Promise<boolean> {
    if (!isSupabaseConfigured || !supabase) return true;

    try {
      const { error } = await supabase
        .from("historico_grades")
        .delete()
        .eq("id", id);

      if (error) {
        console.error("Erro ao excluir versão do histórico de grades no Supabase:", error);
        throw error;
      }

      return true;
    } catch (err) {
      console.error("Falha ao excluir versão do histórico:", err);
      return false;
    }
  }
}

export const horariosDbService = new HorariosDatabaseService();
