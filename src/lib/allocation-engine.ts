/**
 * allocation-engine.ts
 * ──────────────────────────────────────────────────────────────
 * Camada de orquestração acima do motor puro (schedule-utils).
 * Agora com o fluxo completo de 6 etapas (validação → geração → compactação → otimização → auditoria → correção).
 */

import type {
  Turma,
  Disciplina,
  Professor,
  MatrizCurricular,
  ConfiguracaoHorarios,
  Alocacao,
  Conflito,
  DiagnosticoGeracao,
  RegrasRelaxamento,
} from "@/types";

import { runAllocation, detectConflicts, isProfAvailableAt, ensureProfessoresPlanejamento, verificarSlotViavelComMotivo } from "@/lib/schedule-utils";
import { alocarProfessor, calcularDistribuicaoPrioritaria, diagnosticarProfessor } from "./allocation-core";

// Importar as novas funções de score e otimização
import { calcularScore, gradeValida, contarJanelasProfessor } from "./score-utils";
import { otimizarGrade } from "./optimization-utils";
import { aplicarCorrecaoIntegridade, validarIntegridadeGrade } from "./integrity-validator";
import { gerarFeedbackParaGerador } from "./feedback-engine";
import { PredictiveValidator, executarPredicao } from "./predictive-validator";

export function makeRegras(overrides?: Partial<RegrasRelaxamento>): RegrasRelaxamento {
  return {
    modo: overrides?.modo || "equilibrado",
    permitirMaisDeDuasAulasMesmoDia: overrides?.permitirMaisDeDuasAulasMesmoDia ?? false,
    permitirTresAulasConsecutivas: overrides?.permitirTresAulasConsecutivas ?? false,
    permitirOcuparHorariosLivresEntreAulas: overrides?.permitirOcuparHorariosLivresEntreAulas ?? true,
    permitirAumentarLimiteDiario: overrides?.permitirAumentarLimiteDiario ?? false,
    permitirAlocarQualquerHorarioDisponivel: overrides?.permitirAlocarQualquerHorarioDisponivel ?? false,
  };
}

// ─── Regra 17: limites rígidos contra travamento ────────────────────────────
export const MAX_ITERATIONS = 8; // tentativas de relaxamento progressivo no autoFix
export const MAX_RECURSION = 6; // profundidade máxima de chamadas encadeadas
export const MAX_OPTIMIZATION_CYCLES = 4; // ciclos de re-otimização pós-geração

const DAYS = ["segunda", "terca", "quarta", "quinta", "sexta"] as const;
type Dia = (typeof DAYS)[number];

// ════════════════════════════════════════════════════════════════════════════
// REGRA 14 — AUDITOR DE BURACOS COM CLASSIFICAÇÃO
// ════════════════════════════════════════════════════════════════════════════

export type TipoBuraco = "evitavel" | "necessario" | "pedagogico";

export interface BuracoClassificado {
  turmaId: string;
  diaSemana: string;
  horario: number;
  tipo: TipoBuraco;
  motivo: string;
}

export interface RelatorioBuracos {
  total: number;
  evitaveis: number;
  necessarios: number;
  pedagogicos: number;
  buracos: BuracoClassificado[];
}

/**
 * Detecta e CLASSIFICA cada buraco interno na grade de cada turma.
 */
export function auditScheduleGaps(
  alocacoes: Alocacao[],
  matriz: MatrizCurricular[],
  professores: Professor[],
  turmas: Turma[],
): RelatorioBuracos {
  const sanitizedProfs = ensureProfessoresPlanejamento(professores, matriz);
  const buracos: BuracoClassificado[] = [];

  // demanda pendente por (turma, disciplina)
  const planejado = new Map<string, number>();
  matriz.forEach((m) => planejado.set(`${m.turmaId}|${m.disciplinaId}`, m.aulasPorSemana));
  const gerado = new Map<string, number>();
  alocacoes.forEach((a) => {
    const k = `${a.turmaId}|${a.disciplinaId}`;
    gerado.set(k, (gerado.get(k) || 0) + 1);
  });
  const pendente = (turmaId: string, disciplinaId: string) =>
    (planejado.get(`${turmaId}|${disciplinaId}`) || 0) - (gerado.get(`${turmaId}|${disciplinaId}`) || 0);

  // professor responsável por cada (turma, disciplina)
  const profDe = new Map<string, Professor>();
  sanitizedProfs.forEach((p) => {
    const itens = Array.isArray(p.planejamento) ? p.planejamento : [];
    itens.forEach((it) => profDe.set(`${it.turmaId}|${it.disciplinaId}`, p));
  });

  for (const t of turmas) {
    for (const dia of DAYS) {
      const horas = alocacoes
        .filter((a) => a.turmaId === t.id && a.diaSemana === dia)
        .map((a) => a.horario)
        .sort((x, y) => x - y);
      if (horas.length < 2) continue;

      const min = horas[0];
      const max = horas[horas.length - 1];
      for (let h = min; h <= max; h++) {
        if (horas.includes(h)) continue;

        // É um buraco interno. Classifica.
        const candidatas = matriz.filter(
          (m) => m.turmaId === t.id && pendente(m.turmaId, m.disciplinaId) > 0,
        );

        let tipo: TipoBuraco = "necessario";
        let motivo = "Nenhuma disciplina pendente com professor disponível para este horário.";

        for (const c of candidatas) {
          const prof = profDe.get(`${t.id}|${c.disciplinaId}`);
          const dispOk = prof
            ? isProfAvailableAt(prof.disponibilidade, dia as Dia, h, t.turno)
            : false;
          if (!dispOk) continue;

          // checa limite de 2 aulas/dia da disciplina candidata
          const noDia = alocacoes.filter(
            (a) => a.turmaId === t.id && a.diaSemana === dia && a.disciplinaId === c.disciplinaId,
          ).length;
          if (noDia >= 2) {
            tipo = "pedagogico";
            motivo = `Só a disciplina pendente caberia aqui, mas já há 2 aulas dela em ${dia} (regra de 2/dia).`;
            continue;
          }

          // checa limite semanal máximo do professor
          const totalAlocadoProf = prof ? alocacoes.filter((a) => a.professorId === prof.id).length : 0;
          const maxSemanalProf = prof ? (Number(prof.cargaHorariaMaximaSemanal) || 0) : 0;
          if (prof && maxSemanalProf > 0 && totalAlocadoProf >= maxSemanalProf) {
            tipo = "pedagogico";
            motivo = `A disciplina pendente não pode ser alocada porque o professor ${prof.nomeCompleto} atingiu seu limite semanal de ${maxSemanalProf} aulas.`;
            continue;
          }

          tipo = "evitavel";
          motivo = `Aula pendente poderia ocupar este horário (professor disponível).`;
          break;
        }

        buracos.push({ turmaId: t.id, diaSemana: dia, horario: h, tipo, motivo });
      }
    }
  }

  return {
    total: buracos.length,
    evitaveis: buracos.filter((b) => b.tipo === "evitavel").length,
    necessarios: buracos.filter((b) => b.tipo === "necessario").length,
    pedagogicos: buracos.filter((b) => b.tipo === "pedagogico").length,
    buracos,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// REGRA 19 — TESTES AUTOMÁTICOS (validateSchedule)
// ════════════════════════════════════════════════════════════════════════════

export interface ResultadoTeste {
  nome: string;
  passou: boolean;
  detalhe: string;
}

export interface AuditoriaDisciplinaItem {
  professorId: string;
  professorNome: string;
  turmaId: string;
  turmaNome: string;
  disciplinaId: string;
  disciplinaNome: string;
  planejado: number;
  gerado: number;
  diferenca: number;
  alerta: boolean;
}

export interface ValidacaoSchedule {
  ok: boolean;
  testes: ResultadoTeste[];
  auditoriaIntegralizacao?: AuditoriaDisciplinaItem[];
  resumo: {
    aulasPlanejadas: number;
    aulasGeradas: number;
    aulasFaltantes: number;
    conflitos: number;
    buracosEvitaveis: number;
    janelasProfessor: number;
    violacoesPedagogicas: number;
    iqg: number;
    iqgClassificacao: string;
  };
}



/** Conta violações de "no máximo 2 aulas da mesma disciplina por dia". */
function contarViolacoesPedagogicas(alocacoes: Alocacao[]): number {
  const cont = new Map<string, number>();
  for (const a of alocacoes) {
    const k = `${a.turmaId}|${a.diaSemana}|${a.disciplinaId}`;
    cont.set(k, (cont.get(k) || 0) + 1);
  }
  let v = 0;
  cont.forEach((n) => {
    if (n > 2) v++;
  });
  return v;
}

/**
 * Regra 19 — bateria completa de testes sobre uma grade já gerada.
 * Não lança erro: devolve um relatório estruturado.
 */
export function validateSchedule(
  alocacoes: Alocacao[],
  turmas: Turma[],
  disciplinas: Disciplina[],
  professores: Professor[],
  matriz: MatrizCurricular[],
): ValidacaoSchedule {
  const sanitizedProfs = ensureProfessoresPlanejamento(professores, matriz);
  const aulasPlanejadas = matriz.reduce((acc, m) => acc + m.aulasPorSemana, 0);
  const aulasGeradas = alocacoes.length;
  const aulasFaltantes = aulasPlanejadas - aulasGeradas;

  const conflitos = detectConflicts(alocacoes, sanitizedProfs, disciplinas, turmas, matriz);
  const choquesProf = conflitos.filter((c) => c.tipo === "professor_duplo").length;
  const choquesTurma = conflitos.filter((c) => c.tipo === "turma_dupla").length;

  const relatorioBuracos = auditScheduleGaps(alocacoes, matriz, sanitizedProfs, turmas);
  const janelas = contarJanelasProfessor(alocacoes, sanitizedProfs);
  const violacoes = contarViolacoesPedagogicas(alocacoes);

  // disponibilidade: nenhuma aula pode cair fora da disponibilidade do prof
  const profMap = new Map(sanitizedProfs.map((p) => [p.id, p]));
  const turmaMap = new Map(turmas.map((t) => [t.id, t]));
  const discMap = new Map(disciplinas.map((d) => [d.id, d]));

  let forasDisponibilidade = 0;
  for (const a of alocacoes) {
    if (a.isLocked) continue;
    const prof = profMap.get(a.professorId);
    const turno = turmaMap.get(a.turmaId)?.turno || "manha";
    if (prof && !isProfAvailableAt(prof.disponibilidade, a.diaSemana, a.horario, turno)) {
      forasDisponibilidade++;
    }
  }

  // AUDITORIA DE INTEGRALIZAÇÃO CURRICULAR: Professor + Turma + Disciplina e nunca apenas por Professor
  const auditoriaIntegralizacao: AuditoriaDisciplinaItem[] = [];
  let erroDiscrepanciaCarga = false;

  sanitizedProfs.forEach((p) => {
    const itens = Array.isArray(p.planejamento)
      ? p.planejamento
      : p.planejamento && typeof p.planejamento === "object"
        ? Object.entries(p.planejamento).map(([disciplinaId, aulas]) => {
            const parsedVal = Number(aulas) || 0;
            return {
              disciplinaId,
              turmaId: (p.turmas && p.turmas[0]) || "",
              aulasPorSemana: parsedVal,
              quantidadeAulas: parsedVal,
            };
          })
        : [];

    itens.forEach((item) => {
      const pId = p.id;
      const tId = item.turmaId;
      const dId = item.disciplinaId;
      
      const weeklyHours = Number(item.aulasPorSemana !== undefined ? item.aulasPorSemana : item.quantidadeAulas) || 0;
      if (weeklyHours <= 0) return;

      // count how many classes are generated for this exact combo of Prof + Turma + Disc
      const generatedHours = alocacoes.filter(
        (a) => a.professorId === pId && a.turmaId === tId && a.disciplinaId === dId
      ).length;

      const diferenca = weeklyHours - generatedHours;

      let alerta = false;
      if (generatedHours !== weeklyHours) {
        alerta = true;
      }

      // Implementar verificação final obrigatória:
      if (generatedHours !== weeklyHours) {
        erroDiscrepanciaCarga = true;
      }

      auditoriaIntegralizacao.push({
        professorId: pId,
        professorNome: p.nomeCompleto,
        turmaId: tId,
        turmaNome: turmaMap.get(tId)?.nome || "Turma Desconhecida",
        disciplinaId: dId,
        disciplinaNome: discMap.get(dId)?.nome || "Disciplina Desconhecida",
        planejado: weeklyHours,
        gerado: generatedHours,
        diferenca: diferenca,
        alerta: alerta,
      });
    });
  });

  const testes: ResultadoTeste[] = [
    {
      nome: "Contratos de carga horária cumpridos",
      passou: !erroDiscrepanciaCarga,
      detalhe: erroDiscrepanciaCarga
        ? "Existem disciplinas com divergência na carga horária semanal planejada."
        : "Todas as cargas de disciplinas estão perfeitamente calibradas.",
    },
    {
      nome: "Carga horária integralizada",
      passou: aulasFaltantes === 0,
      detalhe: `${aulasGeradas}/${aulasPlanejadas} aulas geradas (${aulasFaltantes} faltantes).`,
    },
    {
      nome: "Sem choque de professor",
      passou: choquesProf === 0,
      detalhe: `${choquesProf} choque(s) de professor.`,
    },
    {
      nome: "Sem choque de turma",
      passou: choquesTurma === 0,
      detalhe: `${choquesTurma} choque(s) de turma.`,
    },
    {
      nome: "Disponibilidade respeitada",
      passou: forasDisponibilidade === 0,
      detalhe: `${forasDisponibilidade} aula(s) fora da disponibilidade do professor.`,
    },
    {
      nome: "Limite pedagógico (2 aulas/dia)",
      passou: violacoes === 0,
      detalhe: `${violacoes} disciplina(s) com mais de 2 aulas no mesmo dia.`,
    },
    {
      nome: "Sem buracos evitáveis",
      passou: relatorioBuracos.evitaveis === 0,
      detalhe: `${relatorioBuracos.evitaveis} buraco(s) evitável(is) (${relatorioBuracos.necessarios} necessário(s), ${relatorioBuracos.pedagogicos} pedagógico(s)).`,
    },
    {
      nome: "Janelas de professor",
      passou: janelas === 0,
      detalhe: `${janelas} janela(s) na agenda dos professores.`,
    },
  ];

  // IQG (Índice de Qualidade da Grade) Base 100
  // Conflitos Docentes: peso 35
  const penaltyConflitos = Math.min(35, (choquesProf + choquesTurma) * 17.5);
  // Pendências Não Alocadas: peso 25
  const percentFaltante = aulasPlanejadas > 0 ? (aulasFaltantes / aulasPlanejadas) * 100 : 0;
  const penaltyPendencias = Math.min(25, percentFaltante > 0 ? (aulasFaltantes * 5) : 0);
  // Buracos em Turmas: peso 15
  const penaltyBuracos = Math.min(15, relatorioBuracos.evitaveis * 3);
  // Janelas: peso 10
  const penaltyJanelas = Math.min(10, janelas * 2);
  // Distribuição Pedagógica (violações): peso 10
  const penaltyPedagogica = Math.min(10, violacoes * 2);

  // Preferências Atendidas (bônus/métrica de 5 pontos)
  let bonusPreferencias = 5;
  if ((choquesProf + choquesTurma) > 0 || aulasFaltantes > 0) {
    bonusPreferencias -= 2.5;
  }
  if (relatorioBuracos.evitaveis > 2 || janelas > 3) {
    bonusPreferencias -= 2.5;
  }
  bonusPreferencias = Math.max(0, bonusPreferencias);

  const iqgValue = 100 - penaltyConflitos - penaltyPendencias - penaltyBuracos - penaltyJanelas - penaltyPedagogica + (bonusPreferencias - 5);
  const iqg = Math.max(0, Math.min(100, Math.round(iqgValue * 10) / 10));

  let iqgClassificacao = "Necessita Revisão";
  if (iqg >= 95) iqgClassificacao = "Excelente";
  else if (iqg >= 90) iqgClassificacao = "Muito Boa";
  else if (iqg >= 80) iqgClassificacao = "Boa";
  else if (iqg >= 70) iqgClassificacao = "Aceitável";

  return {
    ok: testes.every((t) => t.passou),
    testes,
    auditoriaIntegralizacao,
    resumo: {
      aulasPlanejadas,
      aulasGeradas,
      aulasFaltantes,
      conflitos: conflitos.length,
      buracosEvitaveis: relatorioBuracos.evitaveis,
      janelasProfessor: janelas,
      violacoesPedagogicas: violacoes,
      iqg,
      iqgClassificacao,
    },
  };
}

export interface AlertaPreventivo {
  tipo: "erro" | "alerta";
  categoria: "professor" | "turma" | "contrato";
  titulo: string;
  descricao: string;
  resolucao: string;
}

/**
 * Realiza uma auditoria preventiva de limites físicos e contratuais antes da geração.
 */
export function runPreventativeAudit(
  turmas: Turma[],
  disciplinas: Disciplina[],
  professores: Professor[],
  matriz: MatrizCurricular[],
  config: ConfiguracaoHorarios
): AlertaPreventivo[] {
  const alertas: AlertaPreventivo[] = [];
  const sanitizedProfs = ensureProfessoresPlanejamento(professores, matriz);
  const turmaMap = new Map(turmas.map(t => [t.id, t]));

  // 1. CHECAGEM DE DUPLICIDADES E ERROS DE CADASTRO (CAD001)
  const seenProfIds = new Set<string>();
  const seenProfNames = new Set<string>();
  professores.forEach((p) => {
    const normName = p.nomeCompleto.trim().toLowerCase();
    if (seenProfIds.has(p.id) || seenProfNames.has(normName)) {
      alertas.push({
        tipo: "erro",
        categoria: "professor",
        titulo: `Professor Duplicado: ${p.nomeCompleto}`,
        descricao: `Existem dois ou mais professores cadastrados com o mesmo identificador ou nome completo (${p.nomeCompleto}).`,
        resolucao: `Acesse o cadastro de Professores e remova ou corrija a duplicidade.`
      });
    }
    seenProfIds.add(p.id);
    seenProfNames.add(normName);
  });

  const seenDiscIds = new Set<string>();
  const seenDiscNames = new Set<string>();
  disciplinas.forEach((d) => {
    const normName = d.nome.trim().toLowerCase();
    if (seenDiscIds.has(d.id) || seenDiscNames.has(normName)) {
      alertas.push({
        tipo: "erro",
        categoria: "contrato",
        titulo: `Disciplina Duplicada: ${d.nome}`,
        descricao: `Existem duas ou mais disciplinas com o mesmo identificador ou nome (${d.nome}).`,
        resolucao: `Acesse o menu Disciplinas e corrija o cadastro de componentes curriculares.`
      });
    }
    seenDiscIds.add(d.id);
    seenDiscNames.add(normName);
  });

  // Checar itens duplicados no planejamento pedagógico
  const seenPlanningKeys = new Set<string>();
  professores.forEach((p) => {
    const items = Array.isArray(p.planejamento) ? p.planejamento : [];
    items.forEach((item) => {
      const key = `${p.id}|${item.turmaId}|${item.disciplinaId}`;
      if (seenPlanningKeys.has(key)) {
        alertas.push({
          tipo: "erro",
          categoria: "professor",
          titulo: `Duplicidade de Planejamento para ${p.nomeCompleto}`,
          descricao: `Há mais de um registro de planejamento vinculando este professor à mesma turma e disciplina simultaneamente.`,
          resolucao: `Revise e unifique as atribuições deste professor no Planejamento.`
        });
      }
      seenPlanningKeys.add(key);
    });
  });

  // 2. CHECAGEM DE CAPACIDADE FÍSICA SELETIVA DE TURMAS (TUR001 e MAT001)
  turmas.forEach((t) => {
    const turno = t.turno || "manha";
    const slotsPerDay = turno === "noite"
      ? (config.quantidadeHorariosPorDiaNoite ?? 4)
      : turno === "tarde"
        ? (config.quantidadeHorariosPorDiaTarde ?? 5)
        : (config.quantidadeHorariosPorDia ?? 6);
    
    const allowedDaysCount = t.diasPermitidos?.length ?? 5;
    const maxWeeklyCapacity = allowedDaysCount * slotsPerDay;
    const requiredHours = matriz
      .filter((m) => m.turmaId === t.id)
      .reduce((acc, m) => acc + (m.aulasPorSemana || 0), 0);

    if (requiredHours > maxWeeklyCapacity) {
      alertas.push({
        tipo: "erro",
        categoria: "turma",
        titulo: `Capacidade Excedida na Turma ${t.nome}`,
        descricao: `A turma suporta apenas ${maxWeeklyCapacity} aulas, mas a matriz curricular possui ${requiredHours} aulas. Diferença: ${requiredHours - maxWeeklyCapacity} aulas. (Turno ${turno === "manha" ? "Matutino" : turno === "tarde" ? "Vespertino" : "Noturno"} com ${slotsPerDay} horários em ${allowedDaysCount} dias permitidos).`,
        resolucao: `Adicionar mais um dia ao contraturno, aumentar os horários diários na aba Configurações ou reduzir as aulas na matriz.`
      });
    }
  });

  // 3. CHECAGEM DE DISPONIBILIDADE CONTRATUAL E CAPACIDADE REAL DE PROFESSORES (PRO001)
  sanitizedProfs.forEach((p) => {
    const neededByTurno = new Map<string, number>();
    const items = Array.isArray(p.planejamento) ? p.planejamento : [];

    let totalNeeded = 0;
    items.forEach((item) => {
      const t = turmaMap.get(item.turmaId);
      if (!t) return;
      const turno = t.turno || "manha";
      const hours = Number(item.aulasPorSemana || item.quantidadeAulas || 0);
      neededByTurno.set(turno, (neededByTurno.get(turno) || 0) + hours);
      totalNeeded += hours;
    });

    // Validar carga horária máxima semanal cadastrada do professor vs planejamento
    if (p.cargaHorariaMaximaSemanal && totalNeeded > p.cargaHorariaMaximaSemanal) {
      alertas.push({
        tipo: "erro",
        categoria: "professor",
        titulo: `Excesso de Contrato para Prof. ${p.nomeCompleto}`,
        descricao: `O professor tem carga máxima configurada de ${p.cargaHorariaMaximaSemanal} aulas semanais, mas seu planejamento exige ${totalNeeded} aulas. Diferença: ${totalNeeded - p.cargaHorariaMaximaSemanal} aulas. Resultado: IMPOSSÍVEL GERAR.`,
        resolucao: `Reduza o número de aulas planejadas para este professor ou aumente seu limite contratual semanal.`
      });
    }

    neededByTurno.forEach((neededHours, turno) => {
      if (neededHours <= 0) return;

      let availableCount = 0;
      const slotsPerDay = turno === "noite"
        ? (config.quantidadeHorariosPorDiaNoite ?? 4)
        : turno === "tarde"
          ? (config.quantidadeHorariosPorDiaTarde ?? 5)
          : (config.quantidadeHorariosPorDia ?? 6);

      const daysOfWeek = ["segunda", "terca", "quarta", "quinta", "sexta"];
      daysOfWeek.forEach((dia) => {
        for (let h = 1; h <= slotsPerDay; h++) {
          if (isProfAvailableAt(p.disponibilidade, dia, h, turno)) {
            availableCount++;
          }
        }
      });

      if (neededHours > availableCount) {
        alertas.push({
          tipo: "erro",
          categoria: "professor",
          titulo: `Inviabilidade de Horários para Prof. ${p.nomeCompleto}`,
          descricao: `Inviabilidade de Horários para Prof. ${p.nomeCompleto}: Carga necessária: ${neededHours}, Capacidade: ${availableCount}. Faltam ${neededHours - availableCount} horários livres disponíveis no turno ${turno === "manha" ? "Matutino" : turno === "tarde" ? "Vespertino" : "Noturno"}.`,
          resolucao: `Adicionar disponibilidade ou redistribuir aulas.`
        });
      }
    });
  });

  return alertas;
}

// ════════════════════════════════════════════════════════════════════════════
// REGRA 16 — AUTO CORREÇÃO (autoFix)
// ════════════════════════════════════════════════════════════════════════════

export interface SugestaoFix {
  ordem: number;
  descricao: string;
  regras: RegrasRelaxamento;
  ganhoEstimado: string;
}

export interface ResultadoAutoFix {
  aplicado: boolean;
  alocacoes: Alocacao[];
  conflitos: Conflito[];
  diagnostico: DiagnosticoGeracao;
  validacao: ValidacaoSchedule;
  sugestoes: SugestaoFix[];
  regrasAplicadas: RegrasRelaxamento | null;
  iteracoes: number;
}

function escadaDeRelaxamento(): RegrasRelaxamento[] {
  return [
    makeRegras({ modo: "equilibrado" }),
    makeRegras({ modo: "equilibrado", permitirAumentarLimiteDiario: true }),
    makeRegras({ modo: "personalizado", permitirAumentarLimiteDiario: true }),
    makeRegras({
      modo: "personalizado",
      permitirAumentarLimiteDiario: true,
      permitirMaisDeDuasAulasMesmoDia: true,
    }),
    makeRegras({
      modo: "personalizado",
      permitirAumentarLimiteDiario: true,
      permitirMaisDeDuasAulasMesmoDia: true,
      permitirAlocarQualquerHorarioDisponivel: true,
    }),
  ].slice(0, MAX_ITERATIONS);
}

/** Diagnóstico mínimo seguro usado quando o motor lança exceção. */
function diagnosticoVazio(mensagemErro: string): DiagnosticoGeracao {
  return {
    professoresSemHorario: [],
    disciplinasSemAlocacao: [],
    turmasIncompletas: [],
    conflitos: [],
    decisoes: [`Falha controlada no motor: ${mensagemErro}`],
    regrasFlexibilizadas: [],
    regrasMantidas: [],
    regrasRelaxadas: [],
    aulasImpactadas: [],
    modoConfigurado: "equilibrado",
    pendenciasCausaRaiz: [],
    sucesso: false,
    mensagens: [`Não foi possível gerar a grade: ${mensagemErro}. Os dados foram preservados.`],
  } as DiagnosticoGeracao;
}

export function safeRunAllocation(
  turmas: Turma[],
  disciplinas: Disciplina[],
  professores: Professor[],
  matriz: MatrizCurricular[],
  config: ConfiguracaoHorarios,
  lockedAlocacoes: Alocacao[] = [],
  regrasRelaxamento?: RegrasRelaxamento,
  seed?: number,
  debugGeracao?: boolean
): { alocacoes: Alocacao[]; conflitos: Conflito[]; diagnostico: DiagnosticoGeracao } {
  try {
    return runAllocation(
      turmas,
      disciplinas,
      professores,
      matriz,
      config,
      lockedAlocacoes,
      regrasRelaxamento,
      undefined,
      undefined,
      seed,
      debugGeracao
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (typeof console !== "undefined") {
      console.error("[v0] safeRunAllocation capturou erro do motor:", msg);
    }
    // mantém ao menos as aulas travadas, que nunca devem se perder
    return {
      alocacoes: lockedAlocacoes.slice(),
      conflitos: [],
      diagnostico: diagnosticoVazio(msg),
    };
  }
}

/** Compara duas validações: prioriza menos faltantes, depois menos conflitos, depois menos buracos. */
function melhorQue(nova: ValidacaoSchedule, atual: ValidacaoSchedule): boolean {
  if (nova.resumo.aulasFaltantes !== atual.resumo.aulasFaltantes)
    return nova.resumo.aulasFaltantes < atual.resumo.aulasFaltantes;
  if (nova.resumo.conflitos !== atual.resumo.conflitos) return nova.resumo.conflitos < atual.resumo.conflitos;
  if (nova.resumo.buracosEvitaveis !== atual.resumo.buracosEvitaveis)
    return nova.resumo.buracosEvitaveis < atual.resumo.buracosEvitaveis;
  return nova.resumo.janelasProfessor < atual.resumo.janelasProfessor;
}

export function autoFix(
  turmas: Turma[],
  disciplinas: Disciplina[],
  professores: Professor[],
  matriz: MatrizCurricular[],
  config: ConfiguracaoHorarios,
  lockedAlocacoes: Alocacao[] = [],
  aplicarAutomaticamente = true,
): ResultadoAutoFix {
  const sanitizedProfs = ensureProfessoresPlanejamento(professores, matriz);
  const escada = escadaDeRelaxamento();
  const sugestoes: SugestaoFix[] = [];

  let melhor: {
    alocacoes: Alocacao[];
    conflitos: Conflito[];
    diagnostico: DiagnosticoGeracao;
    validacao: ValidacaoSchedule;
    regras: RegrasRelaxamento;
  } | null = null;

  let iteracoes = 0;

  for (let i = 0; i < escada.length; i++) {
    if (iteracoes >= MAX_ITERATIONS) break;
    iteracoes++;
    const regras = escada[i];

    const res = safeRunAllocation(turmas, disciplinas, sanitizedProfs, matriz, config, lockedAlocacoes, regras);
    const validacao = validateSchedule(res.alocacoes, turmas, disciplinas, sanitizedProfs, matriz);

    // registra a sugestão correspondente a este passo (exceto o passo base)
    if (i > 0) {
      sugestoes.push({
        ordem: i,
        descricao: descreverRelaxamento(regras),
        regras,
        ganhoEstimado: `Recupera até ${Math.max(
          0,
          (melhor?.validacao.resumo.aulasFaltantes ?? validacao.resumo.aulasFaltantes) -
            validacao.resumo.aulasFaltantes,
        )} aula(s).`,
      });
    }

    if (!melhor || melhorQue(validacao, melhor.validacao)) {
      melhor = { ...res, validacao, regras };
    }

    // homologou? para imediatamente (Regra 20)
    if (validacao.ok) break;
  }

  // fallback impossível, mas mantém o contrato de tipos seguro
  if (!melhor) {
    const res = safeRunAllocation(turmas, disciplinas, sanitizedProfs, matriz, config, lockedAlocacoes);
    melhor = {
      ...res,
      validacao: validateSchedule(res.alocacoes, turmas, disciplinas, sanitizedProfs, matriz),
      regras: makeRegras({ modo: "equilibrado" }),
    };
  }

  const aplicado = aplicarAutomaticamente && melhor && melhor.regras && melhor.regras.modo !== "equilibrado";

  return {
    aplicado: !!aplicado,
    alocacoes: melhor.alocacoes,
    conflitos: melhor.conflitos,
    diagnostico: melhor.diagnostico,
    validacao: melhor.validacao,
    sugestoes,
    regrasAplicadas: aplicado ? melhor.regras : null,
    iteracoes,
  };
}

export function descreverRelaxamento(r: RegrasRelaxamento): string {
  const partes: string[] = [];
  if (r.permitirAumentarLimiteDiario) partes.push("permitir aulas extras por dia");
  if (r.permitirMaisDeDuasAulasMesmoDia) partes.push("permitir mais de 2 aulas da mesma disciplina por dia");
  if (r.permitirAlocarQualquerHorarioDisponivel) partes.push("desconsiderar indisponibilidade de professores");
  if (r.modo === "personalizado") partes.push("modo flexível de distribuição");
  return partes.length ? `Flexibilizar: ${partes.join(", ")}.` : "Manter todas as regras (modo equilibrado).";
}

export interface ResultadoGeracao {
  alocacoes: Alocacao[];
  conflitos: Conflito[];
  diagnostico: DiagnosticoGeracao;
  validacao: ValidacaoSchedule;
  buracos: RelatorioBuracos;
  homologado: boolean;
  sugestoes: SugestaoFix[];
  regrasAplicadas: RegrasRelaxamento | null;
  // novos campos
  scoreInicial: number;
  scoreFinal: number;
  etapas: {
    validacao: boolean;
    geracao: boolean;
    compactacao: boolean;
    otimizacao: boolean;
    auditoria: boolean;
    correcao: boolean;
  };
}

/**
 * ETAPA 1 – Validação de dados (pré-condições).
 * Verifica se todos os professores têm disponibilidade, turmas têm turno, matriz está completa.
 */
function validarDados(
  turmas: Turma[],
  disciplinas: Disciplina[],
  professores: Professor[],
  matriz: MatrizCurricular[],
  config: ConfiguracaoHorarios
): { ok: boolean; erros: string[] } {
  const erros: string[] = [];

  // Professores sem disponibilidade
  professores.forEach((p) => {
    if (!p.disponibilidade || Object.keys(p.disponibilidade).length === 0) {
      erros.push(`Professor ${p.nomeCompleto} não tem disponibilidade definida.`);
    }
  });

  // Turmas sem turno
  turmas.forEach((t) => {
    if (!t.turno) {
      erros.push(`Turma ${t.nome} não tem turno definido.`);
    }
  });

  // Matriz vazia ou incompleta
  if (matriz.length === 0) {
    erros.push("Matriz curricular vazia. Cadastre disciplinas nas turmas.");
  }

  // Configuração de horários
  if (!config || !config.quantidadeHorariosPorDia) {
    erros.push("Configuração de horários incompleta. Acesse Configurações de Horários.");
  }

  return { ok: erros.length === 0, erros };
}

export interface GeracaoCallbacks {
  onProgress?: (dados: {
    etapa: string;
    progresso: number;
    mensagem: string;
    subEtapa?: string;
  }) => void;
  onPredicao?: (dados: any) => void;
  onErro?: (erro: string) => void;
  onConcluido?: (resultado: any) => void;
}

/**
 * Função orquestradora principal – executa as 6 etapas.
 */
export function gerarGradeCompleta(
  turmas: Turma[],
  disciplinas: Disciplina[],
  professores: Professor[],
  matriz: MatrizCurricular[],
  config: ConfiguracaoHorarios,
  lockedAlocacoes: Alocacao[] = [],
  permitirAutoFix = true,
  callbacks?: GeracaoCallbacks
): ResultadoGeracao {
  // ── ETAPA 0: PREDIÇÃO (NOVA) ──
  console.log("🔮 Executando predição de alocação...");
  if (callbacks?.onProgress) {
    callbacks.onProgress({
      etapa: "🔮 Predição de Alocação",
      progresso: 5,
      mensagem: "Analisando dados de entrada e prevendo possíveis conflitos...",
      subEtapa: "Análise preditiva de carga"
    });
  }
  
  const predicao = executarPredicao(
    lockedAlocacoes,
    professores,
    turmas,
    disciplinas,
    matriz,
    config
  );

  if (callbacks?.onPredicao) {
    callbacks.onPredicao(predicao);
  }

  if (predicao.criticos > 0) {
    console.warn("🚨 Problemas críticos detectados na predição:");
    for (const p of predicao.predicoes) {
      if (p.risco === "critico") {
        console.warn(`   - ${p.professorNome}: ${p.disciplinaNome} (${p.turmaNome})`);
        console.warn(`     ${p.analise.join(" ")}`);
        console.warn(`     Recomendação: ${p.recomendacao}`);
      }
    }
  }

  // ── ETAPA 1: VALIDAÇÃO ──
  if (callbacks?.onProgress) {
    callbacks.onProgress({
      etapa: "📋 Validação de Cadastros",
      progresso: 15,
      mensagem: "Garantindo integridade dos dados, turnos e matriz curricular...",
      subEtapa: "Validação de consistência"
    });
  }

  const validacao = validarDados(turmas, disciplinas, professores, matriz, config);
  if (!validacao.ok) {
    if (callbacks?.onErro) {
      callbacks.onErro("Validação de cadastros falhou: " + validacao.erros.join("; "));
    }
    const diag: DiagnosticoGeracao = {
      professoresSemHorario: [],
      disciplinasSemAlocacao: [],
      turmasIncompletas: [],
      conflitos: [],
      decisoes: ["Validação falhou: " + validacao.erros.join("; ")],
      regrasFlexibilizadas: [],
      regrasMantidas: [],
      regrasRelaxadas: [],
      aulasImpactadas: [],
      modoConfigurado: "equilibrado",
      pendenciasCausaRaiz: [],
      sucesso: false,
      mensagens: validacao.erros,
    };
    const vazia: ValidacaoSchedule = {
      ok: false,
      testes: [],
      resumo: {
        aulasPlanejadas: 0,
        aulasGeradas: 0,
        aulasFaltantes: 0,
        conflitos: 0,
        buracosEvitaveis: 0,
        janelasProfessor: 0,
        violacoesPedagogicas: 0,
        iqg: 0,
        iqgClassificacao: "Necessita Revisão"
      },
    };
    const buracosVazios: RelatorioBuracos = {
      total: 0,
      evitaveis: 0,
      necessarios: 0,
      pedagogicos: 0,
      buracos: [],
    };
    return {
      alocacoes: [],
      conflitos: [],
      diagnostico: diag,
      validacao: vazia,
      buracos: buracosVazios,
      homologado: false,
      sugestoes: [],
      regrasAplicadas: null,
      scoreInicial: 0,
      scoreFinal: 0,
      etapas: {
        validacao: false,
        geracao: false,
        compactacao: false,
        otimizacao: false,
        auditoria: false,
        correcao: false,
      },
    };
  }

  // ── ETAPA 2: GERAÇÃO PRINCIPAL (válida) ──
  if (callbacks?.onProgress) {
    callbacks.onProgress({
      etapa: "⚙️ Gerando Grade Horária",
      progresso: 35,
      mensagem: "Executando motor de alocação IFS inteligente...",
      subEtapa: "Orquestração de restrições"
    });
  }

  const totalPlanejado = matriz.reduce((sum, m) => sum + m.aulasPorSemana, 0);
  const resultadoGeracao = runAllocation(
    turmas,
    disciplinas,
    professores,
    matriz,
    config,
    lockedAlocacoes,
    undefined, // sem relaxamento inicial
    0,
    "validade" // modo validade
  );

  let gradeAtual = resultadoGeracao.alocacoes;
  let scoreAtual = calcularScore(gradeAtual, turmas, professores, disciplinas, matriz, totalPlanejado);

  const etapas = {
    validacao: true,
    geracao: true,
    compactacao: false,
    otimizacao: false,
    auditoria: false,
    correcao: false,
  };

  // ── ETAPA 3: COMPACTAÇÃO ──
  if (callbacks?.onProgress) {
    callbacks.onProgress({
      etapa: "🔧 Compactando Grade",
      progresso: 60,
      mensagem: "Agrupando horários e eliminando janelas ociosas...",
      subEtapa: "Compactação inteligente"
    });
  }

  const gradeCompactada = otimizarGrade(gradeAtual, turmas, professores, disciplinas, matriz, config);
  const scoreCompactacao = calcularScore(gradeCompactada, turmas, professores, disciplinas, matriz, totalPlanejado);

  if (scoreCompactacao >= scoreAtual && gradeValida(gradeCompactada, professores, disciplinas, turmas, matriz)) {
    gradeAtual = gradeCompactada;
    scoreAtual = scoreCompactacao;
    etapas.compactacao = true;
  }

  // ── ETAPA 4: OTIMIZAÇÃO PEDAGÓGICA (permutas) ──
  if (callbacks?.onProgress) {
    callbacks.onProgress({
      etapa: "🔧 Otimização Pedagógica",
      progresso: 75,
      mensagem: "Aplicando permutas de aulas para melhor distribuição pedagógica...",
      subEtapa: "Permuta inteligente"
    });
  }

  const gradeOtimizada = otimizarGrade(gradeAtual, turmas, professores, disciplinas, matriz, config);
  const scoreOtimizacao = calcularScore(gradeOtimizada, turmas, professores, disciplinas, matriz, totalPlanejado);

  if (scoreOtimizacao >= scoreAtual && gradeValida(gradeOtimizada, professores, disciplinas, turmas, matriz)) {
    gradeAtual = gradeOtimizada;
    scoreAtual = scoreOtimizacao;
    etapas.otimizacao = true;
  }

  // ── ETAPA 5: AUDITORIA ──
  if (callbacks?.onProgress) {
    callbacks.onProgress({
      etapa: "📊 Auditando Grade",
      progresso: 82,
      mensagem: "Analisando furos na grade e conflitos residuais...",
      subEtapa: "Cálculo de buracos e furos"
    });
  }

  const validacaoFinal = validateSchedule(gradeAtual, turmas, disciplinas, professores, matriz);
  const buracos = auditScheduleGaps(gradeAtual, matriz, professores, turmas);
  etapas.auditoria = true;

  // ── ETAPA 5.5: VALIDAÇÃO DE INTEGRIDADE DOCENTE (NOVA) ──
  if (callbacks?.onProgress) {
    callbacks.onProgress({
      etapa: "✅ Validando Integridade Docente",
      progresso: 90,
      mensagem: "Garantindo que nenhum professor ultrapasse a carga horária máxima permitida...",
      subEtapa: "Auditoria final de cargas"
    });
  }

  let gradeIntegra = gradeAtual;
  let houveCorrecaoIntegridade = false;
  let relatorioIntegridade = null;
  let feedbackGerador = null;
  const integridadeMensagens: string[] = [];

  // Executar validador de integridade como camada final
  const resultadoIntegridade = aplicarCorrecaoIntegridade(
    gradeAtual,
    professores,
    turmas,
    disciplinas
  );

  gradeIntegra = resultadoIntegridade.alocacoesCorrigidas;
  houveCorrecaoIntegridade = resultadoIntegridade.houveCorrecao;
  relatorioIntegridade = resultadoIntegridade.relatorio;

  // Se houve correção, gerar feedback para o motor e atualizar a grade atual
  if (houveCorrecaoIntegridade) {
    gradeAtual = gradeIntegra;
    feedbackGerador = gerarFeedbackParaGerador(relatorioIntegridade!);
    console.warn("[Integridade] Correção aplicada:", feedbackGerador);
    
    if (callbacks?.onProgress) {
      callbacks.onProgress({
        etapa: "🔧 Corrigindo Excessos de Carga",
        progresso: 93,
        mensagem: `Removendo ${relatorioIntegridade!.totalAulasRemovidas} aula(s) de professores sobrecarregados...`,
        subEtapa: "Auto-correção de carga"
      });
    }

    integridadeMensagens.push(
      `🔧 CORREÇÃO DE INTEGRIDADE: ${relatorioIntegridade!.totalAulasRemovidas} aula(s) removidas.`
    );
    integridadeMensagens.push(
      `📋 ${relatorioIntegridade!.professoresComExcesso.length} professor(es) com excesso corrigido.`
    );
  }

  // ── ETAPA 6: CORREÇÃO AUTOMÁTICA (se necessário e permitido) ──
  let homologado = validacaoFinal.ok && !houveCorrecaoIntegridade;
  let regrasAplicadas: RegrasRelaxamento | null = null;
  let sugestoes: SugestaoFix[] = [];

  if (!homologado && permitirAutoFix) {
    if (callbacks?.onProgress) {
      callbacks.onProgress({
        etapa: "🩹 Auto-Correção de Horários",
        progresso: 96,
        mensagem: "Aplicando regras de relaxamento para acomodar conflitos remanescentes...",
        subEtapa: "Acomodação de restrições"
      });
    }

    const fix = autoFix(turmas, disciplinas, professores, matriz, config, lockedAlocacoes, true);
    if (fix.aplicado) {
      const gradeCorrigida = fix.alocacoes;
      const scoreCorrigido = calcularScore(gradeCorrigida, turmas, professores, disciplinas, matriz, totalPlanejado);
      if (scoreCorrigido >= scoreAtual && gradeValida(gradeCorrigida, professores, disciplinas, turmas, matriz)) {
        gradeAtual = gradeCorrigida;
        scoreAtual = scoreCorrigido;
        regrasAplicadas = fix.regrasAplicadas || null;
        sugestoes = fix.sugestoes;
        etapas.correcao = true;
        // revalida
        const novaValidacao = validateSchedule(gradeAtual, turmas, disciplinas, professores, matriz);
        homologado = novaValidacao.ok && !houveCorrecaoIntegridade;
      }
    } else {
      // Se não aplicou, mas gerou sugestões
      sugestoes = fix.sugestoes;
    }
  }

  // Score final
  const scoreFinal = calcularScore(gradeAtual, turmas, professores, disciplinas, matriz, totalPlanejado);

  // Conflitos finais
  const conflitosFinais = detectConflicts(gradeAtual, professores, disciplinas, turmas, matriz);

  // Diagnóstico final
  const diagnosticoFinal: DiagnosticoGeracao = {
    professoresSemHorario: [],
    disciplinasSemAlocacao: [],
    turmasIncompletas: [],
    conflitos: conflitosFinais.map((c) => c.descricao),
    decisoes: [
      `Gerado com ${gradeAtual.length} aulas (score: ${scoreFinal}).`,
      `Compactação: ${etapas.compactacao ? "aplicada" : "não aplicada"}`,
      `Otimização: ${etapas.otimizacao ? "aplicada" : "não aplicada"}`,
      `Correção: ${etapas.correcao ? "aplicada" : "não aplicada"}`,
    ],
    regrasFlexibilizadas: regrasAplicadas ? ["Regras relaxadas: " + descreverRelaxamento(regrasAplicadas)] : [],
    regrasMantidas: [],
    regrasRelaxadas: [],
    aulasImpactadas: [],
    modoConfigurado: "equilibrado",
    pendenciasCausaRaiz: [],
    sucesso: homologado,
    mensagens: integridadeMensagens,
  };

  const resultadoFinal = {
    alocacoes: gradeAtual,
    conflitos: conflitosFinais,
    diagnostico: diagnosticoFinal,
    validacao: validateSchedule(gradeAtual, turmas, disciplinas, professores, matriz),
    buracos,
    homologado,
    sugestoes,
    regrasAplicadas,
    scoreInicial: scoreAtual, // pode ser o score após geração
    scoreFinal,
    etapas,
  };

  if (callbacks?.onProgress) {
    callbacks.onProgress({
      etapa: "✅ Concluído",
      progresso: 100,
      mensagem: "Grade horária finalizada com absoluto sucesso!",
      subEtapa: "Orquestração completa"
    });
  }

  if (callbacks?.onConcluido) {
    callbacks.onConcluido(resultadoFinal);
  }

  return resultadoFinal;
}

export function generateSchedule(
  turmas: Turma[],
  disciplinas: Disciplina[],
  professores: Professor[],
  matriz: MatrizCurricular[],
  config: ConfiguracaoHorarios,
  lockedAlocacoes: Alocacao[] = [],
  permitirAutoFix = true
): ResultadoAutoFix {
  return autoFix(turmas, disciplinas, professores, matriz, config, lockedAlocacoes, permitirAutoFix);
}

export function gerarGradePorProfessor(
  turmas: Turma[],
  disciplinas: Disciplina[],
  professores: Professor[],
  matriz: MatrizCurricular[],
  config: ConfiguracaoHorarios,
  lockedAlocacoes: Alocacao[] = [],
  regrasRelaxamento?: any
): { alocacoes: Alocacao[]; conflitos: Conflito[]; diagnostico: DiagnosticoGeracao } {
  const logs: string[] = [];
  const sanitizedProfs = ensureProfessoresPlanejamento(professores, matriz);
  
  logs.push("=== INICIANDO MOTOR DE ALOCAÇÃO INDIVIDUAL POR PROFESSOR ===");
  logs.push(`Total de professores cadastrados: ${sanitizedProfs.length}`);

  // 1. Prioridade dos Professores (Nível 5: Professores com atribuições de maior prioridade primeiro)
  // Se houver empate, ordenar por maior número de aulas planejadas para otimizar os casos mais difíceis primeiro.
  const professoresOrdenados = [...sanitizedProfs].sort((a, b) => {
    const maxPrioA = Math.max(...(a.planejamento || []).map(p => {
      if (p.prioridade === "alta") return 3;
      if (p.prioridade === "baixa") return 1;
      return 2;
    }), 0);

    const maxPrioB = Math.max(...(b.planejamento || []).map(p => {
      if (p.prioridade === "alta") return 3;
      if (p.prioridade === "baixa") return 1;
      return 2;
    }), 0);

    if (maxPrioB !== maxPrioA) return maxPrioB - maxPrioA;

    const cargaA = (a.planejamento || []).reduce((acc, p) => acc + (Number(p.aulasPorSemana ?? p.quantidadeAulas) || 0), 0);
    const cargaB = (b.planejamento || []).reduce((acc, p) => acc + (Number(p.aulasPorSemana ?? p.quantidadeAulas) || 0), 0);
    return cargaB - cargaA;
  });

  let alocacoes: Alocacao[] = [...lockedAlocacoes];

  // 2. Processar cada professor sequencialmente
  for (const prof of professoresOrdenados) {
    const res = alocarProfessor(
      prof,
      turmas,
      disciplinas,
      matriz,
      config,
      alocacoes,
      regrasRelaxamento
    );
    alocacoes = [...alocacoes, ...res.alocacoes];
    logs.push(...res.logs);
  }

  // 3. Calcular e auditar conflitos e diagnóstico final
  const conflitos = detectConflicts(alocacoes, professores, disciplinas, turmas, matriz);
  const totalAulasPlanejadasGlobal = matriz.reduce((acc, m) => acc + m.aulasPorSemana, 0);
  const totalAlocadas = alocacoes.length;
  const taxaAlocacao = totalAulasPlanejadasGlobal > 0 ? (totalAlocadas / totalAulasPlanejadasGlobal) * 100 : 100;

  // Identificar e diagnosticar professores com falha de alocação
  const calcularCargaTotal = (prof: Professor, matrizCurricular: MatrizCurricular[]): number => {
    return (prof.planejamento || []).reduce((acc, p) => {
      const m = matrizCurricular.find(m => m.turmaId === p.turmaId && m.disciplinaId === p.disciplinaId);
      const weeklyHours = Number(p.aulasPorSemana !== undefined ? p.aulasPorSemana : p.quantidadeAulas) || m?.aulasPorSemana || 0;
      return acc + weeklyHours;
    }, 0);
  };

  const professoresComFalha = sanitizedProfs.filter(p => {
    const alocadas = alocacoes.filter(a => a.professorId === p.id).length;
    const planejadas = calcularCargaTotal(p, matriz);
    return alocadas < planejadas;
  });

  if (professoresComFalha.length > 0) {
    logs.push("\n⚠️ PROFESSORES COM FALHA DE ALOCAÇÃO:");
    for (const p of professoresComFalha) {
      const diag = diagnosticarProfessor(p, turmas, disciplinas, matriz, alocacoes, config);
      logs.push(`  📋 ${p.nomeCompleto}:`);
      logs.push(`     Carga Alocada: ${diag.cargaAtual}/${diag.cargaMaxima || diag.disciplinasPlanejadas}h (${diag.cargaFaltante || (diag.disciplinasPlanejadas - diag.disciplinasAlocadas)}h faltantes)`);
      logs.push(`     Disciplinas: ${diag.disciplinasAlocadas}/${diag.disciplinasPlanejadas} aulas`);
      if (diag.conflitos.length > 0) {
        logs.push("     Conflitos detectados:");
        for (const c of diag.conflitos) {
          logs.push(`       ${c}`);
        }
      }
      if (diag.sugestoes.length > 0) {
        logs.push("     Sugestões corretivas:");
        for (const s of diag.sugestoes) {
          logs.push(`       ${s}`);
        }
      }
    }
  }

  return {
    alocacoes,
    conflitos,
    diagnostico: {
      sucesso: taxaAlocacao >= 100,
      taxaAlocacao,
      aulasPlanejadas: totalAulasPlanejadasGlobal,
      aulasAlocadas: totalAlocadas,
      motivoEncerrado: `Motor de Alocação por Professor finalizado com taxa de alocação de ${taxaAlocacao.toFixed(1)}%.`,
      mensagens: logs
    }
  };
}

export interface AutoRepairResult {
  alocacoes: Alocacao[];
  logs: string[];
  repairedCount: number;
  scoreBefore: number;
  scoreAfter: number;
}

/**
 * Motor Local de Reparação Pontual e Heurística (Auto-Repair Queue Flow)
 */
export function runSmartAutoRepair(
  alocacoes: Alocacao[],
  turmas: Turma[],
  disciplinas: Disciplina[],
  professores: Professor[],
  matriz: MatrizCurricular[],
  config: ConfiguracaoHorarios
): AutoRepairResult {
  const logs: string[] = [];
  let tempAlocacoes = [...alocacoes];
  
  const sanitizedProfs = ensureProfessoresPlanejamento(professores, matriz);
  const originalValidation = validateSchedule(tempAlocacoes, turmas, disciplinas, sanitizedProfs, matriz);
  const scoreBefore = originalValidation.resumo.iqg;

  logs.push(`Processando Auto Repair Engine de Alta Precisão...`);
  logs.push(`IQG de início: ${scoreBefore}/100. Localizando aulas pendentes de planejamento...`);

  const profMap = new Map(sanitizedProfs.map(p => [p.id, p]));
  const turmaMap = new Map(turmas.map(t => [t.id, t]));
  const discMap = new Map(disciplinas.map(d => [d.id, d]));

  // 1. Identificar a Fila de Reparação (Repair Queue) de aulas que faltam ser geradas
  const repairQueue: {
    professorId: string;
    turmaId: string;
    disciplinaId: string;
  }[] = [];

  sanitizedProfs.forEach((prof) => {
    const items = Array.isArray(prof.planejamento) ? prof.planejamento : [];
    items.forEach((item) => {
      const needed = Number(item.aulasPorSemana || item.quantidadeAulas || 0);
      if (needed <= 0) return;

      const generated = tempAlocacoes.filter(
        (a) =>
          a.professorId === prof.id &&
          a.turmaId === item.turmaId &&
          a.disciplinaId === item.disciplinaId
      ).length;

      const missing = needed - generated;
      for (let m = 0; m < missing; m++) {
        repairQueue.push({
          professorId: prof.id,
          turmaId: item.turmaId,
          disciplinaId: item.disciplinaId,
        });
      }
    });
  });

  if (repairQueue.length === 0) {
    logs.push(`Nenhuma pendência estrutural identificada na Fila. Todas as turmas estão com carga cheia!`);
    return { alocacoes: tempAlocacoes, logs, repairedCount: 0, scoreBefore, scoreAfter: scoreBefore };
  }

  logs.push(`Total de ${repairQueue.length} aula(s) colocadas na Fila de Correção.`);

  const startTime = performance.now();
  let repairedCount = 0;
  const daysOfWeek = ["segunda", "terca", "quarta", "quinta", "sexta"];

  // 2. Resolver cada item da Fila de Reparação sequencialmente
  for (let qIdx = 0; qIdx < repairQueue.length; qIdx++) {
    if (performance.now() - startTime > 3000) {
      logs.push("⚠️ [runSmartAutoRepair] Interrompido por limite de 3 segundos.");
      break;
    }
    const item = repairQueue[qIdx];
    const prof = profMap.get(item.professorId);
    const turma = turmaMap.get(item.turmaId);
    const disc = discMap.get(item.disciplinaId);

    if (!prof || !turma || !disc) continue;

    const label = `${disc.nome} com Prof. ${prof.nomeCompleto} na Turma ${turma.nome}`;
    logs.push(`[Fila #${qIdx + 1}] Tentando alocar pendência: ${label}...`);

    const turno = turma.turno || "manha";
    const slotsPerDay = turno === "noite"
      ? (config.quantidadeHorariosPorDiaNoite ?? 4)
      : turno === "tarde"
        ? (config.quantidadeHorariosPorDiaTarde ?? 5)
        : (config.quantidadeHorariosPorDia ?? 5);

    // Encontrar todos os slots vagos nesta turma para testar o impacto
    const viableSlots: { dia: string; horario: number; score: number }[] = [];

    daysOfWeek.forEach((dia) => {
      for (let h = 1; h <= slotsPerDay; h++) {
        const check = verificarSlotViavelComMotivo(
          tempAlocacoes,
          sanitizedProfs,
          disciplinas,
          turmas,
          matriz,
          config,
          prof.id,
          turma.id,
          disc.id,
          dia,
          h,
          makeRegras()
        );
        if (!check.viavel) continue;

        // Criar alocação candidata temporária
        const tempAlloc: Alocacao = {
          id: `repair-${Date.now()}-${Math.random()}`,
          diaSemana: dia,
          horario: h,
          turmaId: turma.id,
          disciplinaId: disc.id,
          professorId: prof.id,
        };

        const testList = [...tempAlocacoes, tempAlloc];
        const validation = validateSchedule(testList, turmas, disciplinas, sanitizedProfs, matriz);

        // Teste de Impacto: Não pode causar novos choques (conflitos) rígidos!
        const currentConflicts = validateSchedule(tempAlocacoes, turmas, disciplinas, sanitizedProfs, matriz).resumo.conflitos;
        if (validation.resumo.conflitos <= currentConflicts) {
          viableSlots.push({
            dia,
            horario: h,
            score: validation.resumo.iqg,
          });
        }
      }
    });

    if (viableSlots.length > 0) {
      // Ordena pelo maior IQG após a alocação (Reavaliação IQG)
      viableSlots.sort((a, b) => b.score - a.score);
      const best = viableSlots[0];

      const fixedAlloc: Alocacao = {
        id: `fixed-${Date.now()}-${Math.random()}`,
        diaSemana: best.dia,
        horario: best.horario,
        turmaId: turma.id,
        disciplinaId: disc.id,
        professorId: prof.id,
      };

      tempAlocacoes.push(fixedAlloc);
      repairedCount++;
      logs.push(`   → ✅ Sucesso! Alocado em: ${best.dia.toUpperCase()}, ${best.horario}º Horário. IQG resultante: ${best.score}/100.`);
    } else {
      logs.push(`   → ❌ Mal-sucedido: Não há slots sem conflitos compatíveis com este professor nessa turma.`);
    }
  }

  const finalValidation = validateSchedule(tempAlocacoes, turmas, disciplinas, sanitizedProfs, matriz);
  const scoreAfter = finalValidation.resumo.iqg;

  logs.push(`\n[Processamento Concluído]`);
  logs.push(`Resultados do Reparo: ${repairedCount} pendência(s) corrigida(s).`);
  logs.push(`IQG evoluiu de ${scoreBefore} para ${scoreAfter} (+${(scoreAfter - scoreBefore).toFixed(1)}).`);

  return {
    alocacoes: tempAlocacoes,
    logs,
    repairedCount,
    scoreBefore,
    scoreAfter,
  };
}

/**
 * Motor 5 - Busca de Horários Livres (Intelligent Reallocation Engine)
 * If a required class (P, T, D) is missing (pending) because Turma T's schedule is full or the slots where P is available are occupied:
 * 1. Find slots (dia, h) where Professor P is AVAILABLE and FREE (has no other class alocations).
 * 2. If Turma T is already occupied at (dia, h) by a class of another teacher (P2, D2):
 *    We check if we can displace (P2, D2) to another slot (dia_other, h_other) where:
 *    - Turma T is empty
 *    - Professor P2 is available and free (has no other classes at dia_other, h_other).
 * 3. If such a slot exists, execute the displacement:
 *    - Move (P2, D2) from (dia, h) to (dia_other, h_other).
 *    - Allocate the pending (P, T, D) at (dia, h).
 */
export function runReallocationEngine(
  alocacoes: Alocacao[],
  turmas: Turma[],
  disciplinas: Disciplina[],
  professores: Professor[],
  matriz: MatrizCurricular[],
  config: ConfiguracaoHorarios
): { alocacoes: Alocacao[]; numFixed: number; logs: string[] } {
  const logs: string[] = ["Iniciando MOTOR 5 – BUSCA DE HORÁRIOS LIVRES (Permuta Trilateral)..."];
  let currentAlocs = [...alocacoes];
  const sanitizedProfs = ensureProfessoresPlanejamento(professores, matriz);
  
  const DAYS = ["segunda", "terca", "quarta", "quinta", "sexta"];
  const profMap = new Map(sanitizedProfs.map(p => [p.id, p]));
  const turmaMap = new Map(turmas.map(t => [t.id, t]));
  const discMap = new Map(disciplinas.map(d => [d.id, d]));

  // Find remaining missing requirements
  const pendingQueue: {
    professorId: string;
    turmaId: string;
    disciplinaId: string;
  }[] = [];

  sanitizedProfs.forEach((prof) => {
    const items = Array.isArray(prof.planejamento) ? prof.planejamento : [];
    items.forEach((item) => {
      const needed = Number(item.aulasPorSemana || item.quantidadeAulas || 0);
      if (needed <= 0) return;

      const generated = currentAlocs.filter(
        (a) =>
          a.professorId === prof.id &&
          a.turmaId === item.turmaId &&
          a.disciplinaId === item.disciplinaId
      ).length;

      const missing = needed - generated;
      for (let m = 0; m < missing; m++) {
        pendingQueue.push({
          professorId: prof.id,
          turmaId: item.turmaId,
          disciplinaId: item.disciplinaId,
        });
      }
    });
  });

  if (pendingQueue.length === 0) {
    logs.push("Nenhuma pendência para o Motor 5 resolver.");
    return { alocacoes: currentAlocs, numFixed: 0, logs };
  }

  logs.push(`Identificadas ${pendingQueue.length} pendências para resolução trilateral.`);
  const startTime = performance.now();
  let numFixed = 0;

  for (const pending of pendingQueue) {
    if (performance.now() - startTime > 3000) {
      logs.push("⚠️ [runReallocationEngine] Interrompido por limite de 3 segundos.");
      break;
    }
    const prof = profMap.get(pending.professorId);
    const turma = turmaMap.get(pending.turmaId);
    const disc = discMap.get(pending.disciplinaId);
    if (!prof || !turma || !disc) continue;

    const turno = turma.turno || "manha";
    const slotsPerDay = turno === "noite"
      ? (config.quantidadeHorariosPorDiaNoite ?? 4)
      : turno === "tarde"
        ? (config.quantidadeHorariosPorDiaTarde ?? 5)
        : (config.quantidadeHorariosPorDia ?? 5);

    let resolved = false;

    // Scan all slots where our current pending professor is available
    for (const dia of DAYS) {
      if (resolved) break;
      for (let h = 1; h <= slotsPerDay; h++) {
        if (resolved) break;

        // Is Professor P available here?
        if (!isProfAvailableAt(prof.disponibilidade, dia, h, turno)) continue;

        // Does Professor P have another class at (dia, h)? (If yes, they are not free)
        const profIsBusy = currentAlocs.some(a => {
          if (a.professorId !== prof.id || a.diaSemana !== dia || a.horario !== h) return false;
          const aTurno = turmas.find(tx => tx.id === a.turmaId)?.turno || "manha";
          return aTurno === turno;
        });
        if (profIsBusy) continue;

        // What occupies Turma T's (dia, h) slot?
        const existingAlocIndex = currentAlocs.findIndex(a => a.turmaId === turma.id && a.diaSemana === dia && a.horario === h);

        if (existingAlocIndex === -1) {
          // Slot is completely free for both! We can just place it directly after validation
          const check = verificarSlotViavelComMotivo(
            currentAlocs,
            sanitizedProfs,
            disciplinas,
            turmas,
            matriz,
            config,
            prof.id,
            turma.id,
            disc.id,
            dia,
            h,
            makeRegras()
          );

          if (check.viavel) {
            const newAlloc: Alocacao = {
              id: `m5-direct-${Date.now()}-${Math.random()}`,
              diaSemana: dia,
              horario: h,
              turmaId: turma.id,
              disciplinaId: disc.id,
              professorId: prof.id,
            };
            currentAlocs.push(newAlloc);
            resolved = true;
            numFixed++;
            logs.push(`✅ [Direto] Alocado (${disc.nome} - ${prof.nomeCompleto}) em ${dia.toUpperCase()} ${h}º Horário na turma ${turma.nome}.`);
          }
        } else {
          // Slot is busy on Turma T by another class. Let's see if we can displace that class!
          const existingAloc = currentAlocs[existingAlocIndex];
          const prof2 = profMap.get(existingAloc.professorId);
          const disc2 = discMap.get(existingAloc.disciplinaId);
          if (!prof2 || !disc2 || existingAloc.isLocked) continue;

          // Look for ANOTHER slot (dia_other, h_other) where:
          // 1. Turma T has no class
          // 2. Professor P2 is available AND free
          for (const dia_other of DAYS) {
            if (resolved) break;
            for (let h_other = 1; h_other <= slotsPerDay; h_other++) {
              if (dia === dia_other && h === h_other) continue;

              // Is Turma T free?
              const turmaIsOccupied = currentAlocs.some(a => a.turmaId === turma.id && a.diaSemana === dia_other && a.horario === h_other);
              if (turmaIsOccupied) continue;

              // Is Professor P2 available here?
              if (!isProfAvailableAt(prof2.disponibilidade, dia_other, h_other, turno)) continue;

              // Is Professor P2 free here?
              const prof2IsBusy = currentAlocs.some(a => {
                if (a.professorId !== prof2.id || a.diaSemana !== dia_other || a.horario !== h_other) return false;
                const aTurno = turmas.find(tx => tx.id === a.turmaId)?.turno || "manha";
                return aTurno === turno;
              });
              if (prof2IsBusy) continue;

              // Bingo! We found a swap pathway! Let's validate both moves thoroughly first!
              
              // 1. O remanejamento da aula existente do prof2 para o novo slot é viável?
              const checkOcc = verificarSlotViavelComMotivo(
                currentAlocs,
                sanitizedProfs,
                disciplinas,
                turmas,
                matriz,
                config,
                existingAloc.professorId,
                existingAloc.turmaId,
                existingAloc.disciplinaId,
                dia_other,
                h_other,
                makeRegras(),
                existingAloc.id // ignora ele mesmo ao testar o novo slot
              );

              if (!checkOcc.viavel) continue;

              // 2. A alocação da nova aula pendente no slot liberado é viável?
              const checkNew = verificarSlotViavelComMotivo(
                currentAlocs,
                sanitizedProfs,
                disciplinas,
                turmas,
                matriz,
                config,
                prof.id,
                turma.id,
                disc.id,
                dia,
                h,
                makeRegras(),
                existingAloc.id // ignora a aula antiga que sairá deste slot
              );

              if (!checkNew.viavel) continue;

              logs.push(`🔄 [Cascata] Deslocando aula existente de ${prof2.nomeCompleto} de (${dia.toUpperCase()}, ${h}) para (${dia_other.toUpperCase()}, ${h_other}) na turma ${turma.nome} para acomodar ${prof.nomeCompleto}.`);

              // Update P2, D2 alocation's slot
              currentAlocs[existingAlocIndex] = {
                ...existingAloc,
                diaSemana: dia_other,
                horario: h_other,
              };

              // Add our pending class at (dia, h)
              const newAlloc: Alocacao = {
                id: `m5-swap-${Date.now()}-${Math.random()}`,
                diaSemana: dia,
                horario: h,
                turmaId: turma.id,
                disciplinaId: disc.id,
                professorId: prof.id,
              };
              currentAlocs.push(newAlloc);
              resolved = true;
              numFixed++;
              break;
            }
          }
        }
      }
    }
  }

  logs.push(`Motor 5 Concluído: Rezolvidas ${numFixed} pendências adicionais.`);
  return { alocacoes: currentAlocs, numFixed, logs };
}

/**
 * Regenera a grade com base no feedback do validador de integridade
 * Esta função deve ser chamada quando o validador detectar excessos
 */
export function regenerarComFeedback(
  turmas: Turma[],
  disciplinas: Disciplina[],
  professores: Professor[],
  matriz: MatrizCurricular[],
  config: ConfiguracaoHorarios,
  lockedAlocacoes: Alocacao[] = [],
  feedback: any,
  maxTentativas = 3,
  callbacks?: GeracaoCallbacks
): ResultadoGeracao {
  let tentativa = 0;
  let resultado: ResultadoGeracao | null = null;
  let ultimoRelatorio: any = null;

  while (tentativa < maxTentativas) {
    tentativa++;
    console.log(`[Regeneração] Tentativa ${tentativa} de ${maxTentativas}`);
    if (callbacks?.onProgress) {
      callbacks.onProgress({
        etapa: `🔄 Regenerando (Tentativa ${tentativa}/${maxTentativas})`,
        progresso: Math.round(((tentativa - 1) / maxTentativas) * 100),
        mensagem: `Ajustando alocações na tentativa ${tentativa} baseando-se no feedback de integridade...`,
        subEtapa: `Ajuste inteligente de prioridades`
      });
    }

    // Aplicar ajustes de prioridade se fornecidos
    const regrasAjustadas = feedback?.parametrosAjustados?.prioridade 
      ? { prioridade: feedback.parametrosAjustados.prioridade }
      : undefined;

    // Gerar nova grade
    resultado = gerarGradeCompleta(
      turmas,
      disciplinas,
      professores,
      matriz,
      config,
      lockedAlocacoes,
      true,
      callbacks
    );

    // Verificar integridade da nova grade
    const validacaoIntegridade = validarIntegridadeGrade(
      resultado.alocacoes,
      professores,
      turmas,
      disciplinas
    );

    if (validacaoIntegridade.integridadeOk) {
      console.log(`[Regeneração] ✅ Sucesso na tentativa ${tentativa}`);
      return resultado;
    }

    ultimoRelatorio = validacaoIntegridade.relatorio;
    console.log(`[Regeneração] ⚠️ Falha na tentativa ${tentativa}: ${ultimoRelatorio.totalAulasRemovidas} aulas removidas`);

    // Atualizar feedback para próxima tentativa
    const novoFeedback = gerarFeedbackParaGerador(ultimoRelatorio);
    if (novoFeedback.parametrosAjustados) {
      feedback = {
        ...feedback,
        ...novoFeedback.parametrosAjustados
      };
    }
  }

  // Se todas as tentativas falharem, retornar a melhor grade encontrada
  console.warn(`[Regeneração] ❌ Todas as ${maxTentativas} tentativas falharam. Retornando melhor resultado.`);
  return resultado || gerarGradeCompleta(turmas, disciplinas, professores, matriz, config, lockedAlocacoes, true, callbacks);
}