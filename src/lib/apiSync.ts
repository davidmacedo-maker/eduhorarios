// src/lib/apiSync.ts

import type {
  Turma,
  Disciplina,
  MatrizCurricular,
  Professor,
  Alocacao,
  RegistroPonto,
  HorarioRaw,
  BancoDeDados,
} from "@/types";
import { supabase, isSupabaseConfigured, testSupabaseConnection } from "./supabase";

// ── Mapping Functions ──

export function mapFromDbTurma(row: any): Turma {
  return {
    id: row.id,
    nome: row.nome || "",
    turno: row.turno || "manha",
    serie: row.serie || "",
    anoLetivo: Number(row.ano_letivo ?? row.anoLetivo ?? new Date().getFullYear()),
    observacoes: row.observacoes,
    diasPermitidos: typeof row.dias_permitidos === "string" ? JSON.parse(row.dias_permitidos) : (row.dias_permitidos ?? row.diasPermitidos),
    estrategiaDistribuicao: row.estrategia_distribuicao ?? row.estrategiaDistribuicao,
  };
}

export function mapToDbTurma(item: Turma, userId: string): any {
  return {
    id: item.id,
    user_id: userId,
    nome: item.nome,
    turno: item.turno,
    serie: item.serie,
    ano_letivo: item.anoLetivo,
    observacoes: item.observacoes,
    dias_permitidos: item.diasPermitidos,
    estrategia_distribuicao: item.estrategiaDistribuicao,
  };
}

export function mapFromDbDisciplina(row: any): Disciplina {
  return {
    id: row.id,
    nome: row.nome || "",
    abreviacao: row.abreviacao || "",
    cor: row.cor || "#3b82f6",
    cargaHorariaSemanal: Number(row.carga_horaria_semanal ?? row.cargaHorariaSemanal ?? 0),
    maximoAulasPorDia: row.maximo_aulas_por_dia ?? row.maximoAulasPorDia,
  };
}

export function mapToDbDisciplina(item: Disciplina, userId: string): any {
  return {
    id: item.id,
    user_id: userId,
    nome: item.nome,
    abreviacao: item.abreviacao,
    cor: item.cor,
    carga_horaria_semanal: item.cargaHorariaSemanal,
    maximo_aulas_por_dia: item.maximoAulasPorDia,
  };
}

export function mapFromDbMatriz(row: any): MatrizCurricular {
  return {
    turmaId: row.turma_id ?? row.turmaId,
    disciplinaId: row.disciplina_id ?? row.disciplinaId,
    aulasPorSemana: Number(row.aulas_por_semana ?? row.aulasPorSemana ?? 0),
  };
}

export function mapToDbMatriz(item: MatrizCurricular, userId: string): any {
  return {
    user_id: userId,
    turma_id: item.turmaId,
    disciplina_id: item.disciplinaId,
    aulas_por_semana: item.aulasPorSemana,
  };
}

export function mapFromDbProfessor(row: any): Professor {
  return {
    id: row.id,
    nomeCompleto: row.nome_completo ?? row.nomeCompleto ?? "",
    masp: row.masp,
    dataAdmissao: row.data_admissao ?? row.dataAdmissao,
    tipoVinculo: row.tipo_vinculo ?? row.tipoVinculo,
    cargo: row.cargo,
    disciplinas: typeof row.disciplinas === "string" ? JSON.parse(row.disciplinas) : (Array.isArray(row.disciplinas) ? row.disciplinas : []),
    turmas: typeof row.turmas === "string" ? JSON.parse(row.turmas) : (Array.isArray(row.turmas) ? row.turmas : []),
    disponibilidade: typeof row.disponibilidade === "string" ? JSON.parse(row.disponibilidade) : (row.disponibilidade && typeof row.disponibilidade === "object" ? row.disponibilidade : {}),
    cargaHorariaMaximaSemanal: Number(row.carga_horaria_maxima_semanal ?? row.cargaHorariaMaximaSemanal ?? 40),
    planejamento: typeof row.planejamento === "string" ? JSON.parse(row.planejamento) : (Array.isArray(row.planejamento) ? row.planejamento : []),
  };
}

export function mapToDbProfessor(item: Professor, userId: string): any {
  return {
    id: item.id,
    user_id: userId,
    nome_completo: item.nomeCompleto,
    masp: item.masp,
    data_admissao: item.dataAdmissao,
    tipo_vinculo: item.tipoVinculo,
    cargo: item.cargo,
    disciplinas: item.disciplinas || [],
    turmas: item.turmas || [],
    disponibilidade: item.disponibilidade || {},
    carga_horaria_maxima_semanal: item.cargaHorariaMaximaSemanal,
    planejamento: item.planejamento || [],
  };
}

export function mapFromDbAlocacao(row: any): Alocacao {
  return {
    id: row.id,
    turmaId: row.turma_id ?? row.turmaId,
    disciplinaId: row.disciplina_id ?? row.disciplinaId,
    professorId: row.professor_id ?? row.professorId,
    diaSemana: row.dia_semana ?? row.diaSemana,
    horario: Number(row.horario ?? 0),
    isLocked: Boolean(row.is_locked ?? row.isLocked),
  };
}

export function mapToDbAlocacao(item: Alocacao, userId: string): any {
  return {
    id: item.id,
    user_id: userId,
    turma_id: item.turmaId,
    disciplina_id: item.disciplinaId,
    professor_id: item.professorId,
    dia_semana: item.diaSemana,
    horario: item.horario,
    is_locked: item.isLocked,
  };
}

export function mapFromDbRegistroPonto(row: any): RegistroPonto {
  return {
    id: row.id,
    alocacaoId: row.alocacao_id ?? row.alocacaoId,
    data: row.data || "",
    presente: Boolean(row.presente),
    observacao: row.observacao,
    valor: row.valor ? String(row.valor) : undefined,
  };
}

export function mapToDbRegistroPonto(item: RegistroPonto, userId: string): any {
  return {
    id: item.id,
    user_id: userId,
    alocacao_id: item.alocacaoId,
    data: item.data,
    presente: item.presente,
    observacao: item.observacao,
    valor: item.valor,
  };
}

export function mapFromDbHorarioRaw(row: any): HorarioRaw {
  return {
    id: row.id,
    turno: row.turno || "Matutino",
    turma: row.turma || "",
    disciplina: row.disciplina || "",
    professor: row.professor || "",
    dia: row.dia || "",
    aula: Number(row.aula ?? 0),
    horarioInicio: row.horario_inicio ?? row.horarioInicio,
    horarioFim: row.horario_fim ?? row.horarioFim,
    masp: row.masp,
    cargo: row.cargo,
    importadoEm: row.importado_em ?? row.importadoEm ?? new Date().toISOString(),
  };
}

export function mapToDbHorarioRaw(item: HorarioRaw, userId: string): any {
  return {
    id: item.id,
    user_id: userId,
    turno: item.turno,
    turma: item.turma,
    disciplina: item.disciplina,
    professor: item.professor,
    dia: item.dia,
    aula: item.aula,
    horario_inicio: item.horarioInicio,
    horario_fim: item.horarioFim,
    masp: item.masp,
    cargo: item.cargo,
    importado_em: item.importadoEm,
  };
}

import { professoresDbService } from "./database/professores.service";
import { turmasDbService } from "./database/turmas.service";
import { disciplinasDbService } from "./database/disciplinas.service";
import { alocacoesDbService } from "./database/alocacoes.service";
import { horariosDbService } from "./database/horarios.service";

// Importações da store (criada no passo 2)
import { normalizeProfessor, setStoreValue } from "@/store";

// ── Estado e Métodos de Sincronização ──

export interface DatabaseHealthStatus {
  success: boolean;
  database: string;
  provider: string;
  connected: boolean;
  latency_ms?: number;
  database_name?: string;
  version?: string;
  error?: string;
}

export async function checkDatabaseHealth(): Promise<DatabaseHealthStatus> {
  const testRes = await testSupabaseConnection();
  if (testRes.configured && testRes.success) {
    return {
      success: true,
      database: "postgresql",
      provider: "supabase",
      connected: true,
      latency_ms: testRes.latency_ms || 0,
      database_name: "supabase",
      version: "PostgreSQL (Supabase)",
    };
  }

  return {
    success: testRes.configured && testRes.success,
    database: "supabase",
    provider: "supabase",
    connected: testRes.configured && testRes.success,
    latency_ms: testRes.latency_ms || 0,
    database_name: testRes.configured ? "supabase" : "aguardando-credenciais",
    version: "PostgreSQL (Supabase)",
    error: testRes.message,
  };
}

export async function fetchRemoteData(userId: string): Promise<any | null> {
  if (!userId || userId === "local") return null;
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const [professores, turmas, disciplinas, matriz, alocacoes, horariosRaw, registrosPonto] = await Promise.all([
      professoresDbService.listar(userId),
      turmasDbService.listar(userId),
      disciplinasDbService.listar(userId),
      turmasDbService.listarMatriz(userId),
      alocacoesDbService.listar(userId),
      horariosDbService.listar(userId),
      alocacoesDbService.listarRegistrosPonto(userId),
    ]);

    // Reconstruct BancoDeDados hierarchical structure if needed
    const horarios: BancoDeDados = {};
    if (Array.isArray(horariosRaw)) {
      for (const h of horariosRaw) {
        const turnoKey = h.turno || "Matutino";
        if (!horarios[turnoKey]) {
          horarios[turnoKey] = {};
        }
        horarios[turnoKey][h.id] = h;
      }
    }

    return { professores, turmas, disciplinas, matriz, alocacoes, horarios, horariosRaw, registrosPonto };
  } catch (err) {
    console.error("Erro ao carregar dados do Supabase:", err);
    return null;
  }
}

export async function sendRemoteSync(_payload: any): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return true;
  return true;
}

export function resolveUserId(userId?: string): string {
  if (userId && userId !== "local") return userId;
  try {
    const activeLocalStr = localStorage.getItem("eduhorarios_active_user_profile");
    if (activeLocalStr) {
      const parsed = JSON.parse(activeLocalStr);
      if (parsed?.id) return parsed.id;
    }
  } catch {}
  return "usr-admin-1";
}

// Métodos individuais de sincronização
export async function syncTurmas(turmas: any[], userId?: string): Promise<void> {
  const uid = resolveUserId(userId);
  if (!uid || !Array.isArray(turmas)) return;
  await turmasDbService.salvarLote(turmas, uid);
}

export async function syncDisciplinas(disciplinas: any[], userId?: string): Promise<void> {
  const uid = resolveUserId(userId);
  if (!uid || !Array.isArray(disciplinas)) return;
  await disciplinasDbService.salvarLote(disciplinas, uid);
}

export async function syncMatriz(matriz: any[], userId?: string): Promise<void> {
  const uid = resolveUserId(userId);
  if (!uid || !Array.isArray(matriz)) return;
  await turmasDbService.salvarMatriz(matriz, uid);
}

export async function syncProfessores(professores: any[], userId?: string): Promise<void> {
  const uid = resolveUserId(userId);
  if (!uid || !Array.isArray(professores)) return;
  await professoresDbService.salvarLote(professores, uid);
}

export async function syncAlocacoes(alocacoes: any[], userId?: string): Promise<void> {
  const uid = resolveUserId(userId);
  if (!uid || !Array.isArray(alocacoes)) return;
  await alocacoesDbService.salvarLote(alocacoes, uid);
}

export async function syncRegistrosPonto(registros: any[], userId?: string): Promise<void> {
  const uid = resolveUserId(userId);
  if (!uid || !Array.isArray(registros)) return;
  await alocacoesDbService.upsertRegistrosPonto(registros, uid);
}

export async function fetchRegistrosPonto(userId?: string): Promise<any[]> {
  const uid = resolveUserId(userId);
  return await alocacoesDbService.listarRegistrosPonto(uid);
}

export async function upsertRegistrosPonto(rows: any[], userId?: string): Promise<boolean> {
  const uid = resolveUserId(userId);
  return await alocacoesDbService.upsertRegistrosPonto(rows, uid);
}

export async function deleteRegistrosPonto(params: any, userId?: string): Promise<boolean> {
  const uid = resolveUserId(userId);
  return await alocacoesDbService.excluirRegistrosPonto(params, uid);
}

export async function syncConfig(config: any, userId?: string): Promise<void> {
  const uid = resolveUserId(userId);
  if (!uid || !config) return;
  await sendRemoteSync({ user_id: uid, config });
}

export async function syncEscolaConfig(escolaNome: string, escolaCodigo: string, userId?: string): Promise<void> {
  const uid = resolveUserId(userId);
  if (!uid) return;
  await sendRemoteSync({ user_id: uid, escola_nome: escolaNome, escola_codigo: escolaCodigo });
}

export async function syncHorarios(horarios: any, userId?: string): Promise<void> {
  const uid = resolveUserId(userId);
  if (!uid || !horarios) return;
  
  // Flatten if BancoDeDados structure
  let list: HorarioRaw[] = [];
  if (Array.isArray(horarios)) {
    list = horarios;
  } else if (typeof horarios === "object") {
    Object.values(horarios).forEach((turnData: any) => {
      if (typeof turnData === "object" && turnData !== null) {
        Object.values(turnData).forEach((h: any) => {
          if (h && typeof h === "object" && h.id) {
            list.push(h as HorarioRaw);
          }
        });
      }
    });
  }

  if (list.length > 0) {
    await horariosDbService.salvarLote(list, uid);
  }
}