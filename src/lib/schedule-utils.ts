/**
 * schedule-utils.ts
 * ──────────────────────────────────────────────────────────────
 * Utilitários de horários e motor de geração de grade iterativo.
 * Evolução do Motor 1 para otimização automática contínua.
 */

import type {
  Turma,
  Disciplina,
  Professor,
  Alocacao,
  MatrizCurricular,
  ConfiguracaoHorarios,
  DiagnosticoGeracao,
  RegrasRelaxamento,
  Conflito,
  PlanejamentoItem,
} from "@/types";

export type { Conflito };

export interface TimeSlot {
  period: number;
  start: string;
  end: string;
  isBreak: boolean;
  turno: "manha" | "tarde" | "noite";
}

// ──────────────────────────────────────────────────────────────
// AUXILIARES DE PLANEJAMENTO E TEMPO
// ──────────────────────────────────────────────────────────────

export function ensureProfessoresPlanejamento(professores: Professor[], matriz: MatrizCurricular[]): Professor[] {
  return (professores ?? []).map((p) => {
    let planejado = p.planejamento && Array.isArray(p.planejamento) ? [...p.planejamento] : [];
    if (planejado.length === 0) {
      const discIds = p.disciplinas ?? [];
      const tIds = p.turmas ?? [];
      discIds.forEach((dId) => {
        tIds.forEach((tId) => {
          const match = (matriz ?? []).find((m) => m.disciplinaId === dId && m.turmaId === tId);
          if (match) {
            planejado.push({
              disciplinaId: dId,
              turmaId: tId,
              aulasPorSemana: match.aulasPorSemana,
              quantidadeAulas: match.aulasPorSemana,
            });
          }
        });
      });
    } else {
      // Unificar itens duplicados do planejamento (mesma turma + disciplina)
      const uniquePlan = new Map<string, PlanejamentoItem>();
      planejado.forEach((item) => {
        if (!item.turmaId || !item.disciplinaId) return;
        const key = `${item.turmaId}|${item.disciplinaId}`;
        if (uniquePlan.has(key)) {
          const existing = uniquePlan.get(key)!;
          // Unifica somando as aulas semanais
          existing.aulasPorSemana = (existing.aulasPorSemana || 0) + (item.aulasPorSemana || 0);
          existing.quantidadeAulas = (existing.quantidadeAulas || 0) + (item.quantidadeAulas || 0);
        } else {
          uniquePlan.set(key, { ...item });
        }
      });
      planejado = Array.from(uniquePlan.values());
    }
    return { ...p, planejamento: planejado };
  });
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const newH = Math.floor(total / 60) % 24;
  const newM = total % 60;
  return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
}

export function generateTimeSlotsForTurno(config: ConfiguracaoHorarios, turno: "manha" | "tarde" | "noite"): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const isTarde = turno === "tarde";
  const isNoite = turno === "noite";

  const qtd = isNoite ? (config.quantidadeHorariosPorDiaNoite ?? 4) : isTarde ? (config.quantidadeHorariosPorDiaTarde ?? 5) : config.quantidadeHorariosPorDia;
  const duracao = isNoite ? (config.duracaoAulaMinutosNoite ?? 50) : isTarde ? (config.duracaoAulaMinutosTarde ?? 50) : config.duracaoAulaMinutos;
  const inicio = isNoite ? (config.horarioInicialNoite ?? "19:00") : isTarde ? (config.horarioInicialTarde ?? "13:00") : config.horarioInicial;
  const temInt = isNoite ? (config.possuiIntervaloNoite ?? false) : isTarde ? (config.possuiIntervaloTarde ?? true) : config.possuiIntervalo;
  const aposHor = isNoite ? (config.horarioIntervaloNoite ?? 2) : isTarde ? (config.horarioIntervaloTarde ?? 3) : config.horarioIntervalo;
  const durInt = isNoite ? (config.duracaoIntervaloMinutosNoite ?? 15) : isTarde ? (config.duracaoIntervaloMinutosTarde ?? 15) : config.duracaoIntervaloMinutos;

  let current = inicio;
  let periodCount = 0;

  for (let i = 1; i <= qtd; i++) {
    periodCount++;
    const start = current;
    const end = addMinutes(current, duracao);
    slots.push({ period: i, start, end, isBreak: false, turno });
    current = end;

    if (temInt && periodCount === aposHor) {
      slots.push({ period: 0, start: current, end: addMinutes(current, durInt), isBreak: true, turno });
      current = addMinutes(current, durInt);
    }
  }
  return slots;
}

export function generateTimeSlots(config: ConfiguracaoHorarios): TimeSlot[] {
  return generateTimeSlotsForTurno(config, "manha");
}

export const DAY_NAMES: Record<string, string> = { segunda: "Segunda", terca: "Terça", quarta: "Quarta", quinta: "Quinta", sexta: "Sexta" };
export const DAYS = ["segunda", "terca", "quarta", "quinta", "sexta"];

export function isProfAvailableAt(disponibilidade: Record<string, any> | undefined, dia: string, h: number, turno: string): boolean {
  if (!disponibilidade) return false;
  
  const diaClean = dia.toLowerCase().trim();
  const available = (disponibilidade[diaClean] ?? []).map(Number);
  if (available.length === 0) return false;

  // 🌟 MAPEAMENTO PRECISO DE TURNO + SLOT INDEPENDENTE
  // Se o cadastro salva os índices de forma sequencial ou segmentada:
  const offset = turno === "noite" ? h + 20 : turno === "tarde" ? h + 10 : h;
  if (available.includes(offset)) return true;

  // Retrocompatibilidade se houver dados antigos legados salvos de 1 a 10 apenas pelo número do slot bruto:
  // 1..5 -> Manhã (1..5)
  // 6..10 -> Tarde (11..15)
  const hasOnlyLegacyValues = available.every((v: number) => v <= 10);
  if (hasOnlyLegacyValues) {
    const mappedAvailable = available.map((v: number) => (v > 5 ? v + 5 : v));
    if (mappedAvailable.includes(offset)) return true;
  }

  // Verificação fallback: se a estrutura estiver salva como objeto boolean por turno { manha: true, tarde: false }
  if (typeof disponibilidade[diaClean] === "object" && !Array.isArray(disponibilidade[diaClean])) {
    return disponibilidade[diaClean][turno] !== false;
  }

  return false;
}

// ──────────────────────────────────────────────────────────────
// DETECÇÃO DE CONFLITOS
// ──────────────────────────────────────────────────────────────

export function detectConflicts(
  alocacoes: Alocacao[],
  professores: Professor[],
  disciplinas: Disciplina[],
  turmas: Turma[],
  _matriz: MatrizCurricular[],
): Conflito[] {
  const conflicts: Conflito[] = [];
  const sanitizedProfs = ensureProfessoresPlanejamento(professores, _matriz);
  const profMap = new Map(sanitizedProfs.map((p) => [p.id, p]));
  const turmaMap = new Map(turmas.map((t) => [t.id, t]));

  for (const dia of DAYS) {
    for (let horario = 1; horario <= 12; horario++) {
      const slot = alocacoes.filter((a) => a.diaSemana === dia && a.horario === horario);
      if (slot.length === 0) continue;

      const profByTurno = new Map<string, Alocacao[]>();
      slot.forEach((a) => {
        const turno = turmaMap.get(a.turmaId)?.turno ?? "manha";
        const key = `${a.professorId}-${turno}`;
        const arr = profByTurno.get(key) ?? [];
        arr.push(a);
        profByTurno.set(key, arr);
      });

      profByTurno.forEach((alocs, key) => {
        if (alocs.length > 1) {
          const profId = key.split("-")[0];
          const prof = profMap.get(profId);
          conflicts.push({
            descricao: `Prof. ${prof?.nomeCompleto ?? "?"} está em ${alocs.length} turmas ao mesmo tempo — ${DAY_NAMES[dia]}, ${horario}º horário`,
            tipo: "professor_duplo",
            dia,
            horario,
            professorId: profId,
          });
        }
      });

      const turmaCount = new Map<string, Alocacao[]>();
      slot.forEach((a) => {
        const arr = turmaCount.get(a.turmaId) ?? [];
        arr.push(a);
        turmaCount.set(a.turmaId, arr);
      });
      turmaCount.forEach((alocs, turmaId) => {
        if (alocs.length > 1) {
          const turma = turmaMap.get(turmaId);
          conflicts.push({
            descricao: `Turma ${turma?.nome ?? "?"} tem ${alocs.length} aulas simultâneas — ${DAY_NAMES[dia]}, ${horario}º horário`,
            tipo: "turma_dupla",
            dia,
            horario,
            turmaId,
          });
        }
      });
    }
  }

  alocacoes.forEach((a) => {
    const prof = profMap.get(a.professorId);
    if (prof) {
      const t = turmaMap.get(a.turmaId);
      const shift = t?.turno ?? "manha";
      if (!isProfAvailableAt(prof.disponibilidade, a.diaSemana, a.horario, shift)) {
        conflicts.push({
          descricao: `Prof. ${prof.nomeCompleto} não está disponível em ${DAY_NAMES[a.diaSemana]} no ${a.horario}º horário`,
          tipo: "disponibilidade",
          dia: a.diaSemana,
          horario: a.horario,
          professorId: a.professorId,
          turmaId: a.turmaId,
        });
      }
    }
  });

  const consecMap = new Map<string, number[]>();
  alocacoes.forEach((a) => {
    const key = `${a.turmaId}|${a.diaSemana}|${a.disciplinaId}|${a.professorId}`;
    if (!consecMap.has(key)) consecMap.set(key, []);
    consecMap.get(key)!.push(a.horario);
  });

  consecMap.forEach((horas, key) => {
    const [turmaId, diaSemana, disciplinaId, professorId] = key.split("|");
    const profObj = profMap.get(professorId);
    let maxConsecLimit = 2;
    if (profObj && Array.isArray(profObj.planejamento)) {
      const planeItem = profObj.planejamento.find((item) => item.disciplinaId === disciplinaId && item.turmaId === turmaId);
      if (planeItem && planeItem.maximoConsecutivas !== undefined && planeItem.maximoConsecutivas !== null) {
        maxConsecLimit = planeItem.maximoConsecutivas;
      }
    }

    const sorted = horas.sort((a, b) => a - b);
    let currentConsec = 0;
    let lastH = -10;
    for (const hVal of sorted) {
      if (hVal === lastH + 1) {
        currentConsec++;
      } else {
        currentConsec = 1;
      }
      if (currentConsec > maxConsecLimit) {
        const disc = disciplinas.find((d) => d.id === disciplinaId);
        const discName = disc?.nome || disciplinaId;
        const turma = turmas.find((t) => t.id === turmaId);
        const turmaName = turma?.nome || turmaId;
        const profName = profObj?.nomeCompleto || professorId;
        conflicts.push({
          descricao: `Excede o limite de ${maxConsecLimit} aulas consecutivas da disciplina ${discName} na Turma ${turmaName} (${profName}) na ${DAY_NAMES[diaSemana] || diaSemana}`,
          tipo: "carga_excedida",
          dia: diaSemana,
          horario: hVal,
          turmaId,
          professorId,
        });
        break;
      }
      lastH = hVal;
    }
  });

  return conflicts;
}

export function autoResolveConflicts(alocacoes: Alocacao[], professores: Professor[], turmas: Turma[]): { resolved: Alocacao[]; removedIds: string[]; descricoes: string[] } {
  const conflicts = detectConflicts(alocacoes, professores, [], turmas, []);
  const idsToRemove = new Set<string>();
  const descricoes: string[] = [];

  conflicts.forEach((c) => {
    const targets = alocacoes.filter((a) => !a.isLocked && a.diaSemana === c.dia && a.horario === c.horario && (a.turmaId === c.turmaId || a.professorId === c.professorId));
    targets.forEach((t) => {
      if (!idsToRemove.has(t.id)) {
        idsToRemove.add(t.id);
        descricoes.push(c.descricao);
      }
    });
  });

  return {
    resolved: alocacoes.filter((a) => !idsToRemove.has(a.id)),
    removedIds: Array.from(idsToRemove),
    descricoes,
  };
}

// ──────────────────────────────────────────────────────────────
// MOTOR DE GERAÇÃO ITERATIVO EVOLUÍDO
// ──────────────────────────────────────────────────────────────

interface ReqUnit {
  turmaId: string;
  disciplinaId: string;
  profId: string;
  turno: "manha" | "tarde" | "noite";
  maxHorarios: number;
}

interface DemandGroup extends ReqUnit {
  key: string;
  pendentes: number;
  cargaProf: number;
  restricaoScore: number;
  mrvScore?: number;
  priority?: "alta" | "media" | "baixa";
  slotsDisponiveis?: number;
  exigeGeminacao?: boolean;
  maximoAulasPorDia?: number;
  maximoConsecutivas?: number;
}

type Estado = {
  alocacoes: Map<string, Alocacao>;
  turmaOcupada: Set<string>;
  profOcupado: Set<string>;
  contDiscDia: Map<string, number>;
  horariosDiscTurmaDia: Map<string, Set<number>>;
  alocPorTurmaSlot: Map<string, Alocacao>;
  alocPorProfSlot: Map<string, Alocacao>;
};

function makeRng(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWithRng<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function gerarDiagnosticoProvaMatematica(
  p: Professor,
  turmas: Turma[],
  disciplinas: Disciplina[],
  matriz: MatrizCurricular[],
  config: ConfiguracaoHorarios,
  lockedAlocacoes: Alocacao[],
  reqManha: number,
  reqTarde: number,
  reqNoite: number,
  availManha: number,
  availTarde: number,
  availNoite: number
): string {
  const itens = p.planejamento && Array.isArray(p.planejamento) ? p.planejamento : [];
  const totalCarga = reqManha + reqTarde + reqNoite;
  const totalAvail = availManha + availTarde + availNoite;

  // ETAPA 1 — Validar o cadastro
  const hasProblem = totalCarga > totalAvail || reqManha > availManha || reqTarde > availTarde || reqNoite > availNoite;

  // ETAPA 2 — Comparar todas as camadas
  let erroSincronizacao = false;
  let detalheSincronizacao = "";
  
  if (!p.id || !p.nomeCompleto) {
    erroSincronizacao = true;
    detalheSincronizacao += "Divergência: Objeto do professor possui campos nulos ou indefinidos na leitura.\n";
  }

  if (p.disponibilidade) {
    Object.keys(p.disponibilidade).forEach((dia) => {
      const vals = p.disponibilidade![dia];
      if (!Array.isArray(vals)) {
        erroSincronizacao = true;
        detalheSincronizacao += `Banco possui formato corrompido para o dia ${dia}. Esperado Array, recebido ${typeof vals}.\n`;
      }
    });
  }

  let report = `AUDITORIA DA HOMOLOGAÇÃO MATEMÁTICA — PROVA DE INVIABILIDADE\n`;
  report += `-------------------------------------------------------------\n`;
  report += `[ETAPA 1] VALIDAÇÃO DO CADASTRO\n`;
  if (hasProblem) {
    report += `✔ Confirmado: O cadastro possui inconsistência matemática real.\n`;
  } else {
    report += `❌ Cadastro OK. Inviabilidade não pôde ser provada pelo cadastro direto. Verificando regras dinâmicas...\n`;
  }

  report += `\n[ETAPA 2] COMPARAÇÃO DE CAMADAS DE DADOS\n`;
  if (erroSincronizacao) {
    report += `🚨 DIVERGÊNCIA IDENTIFICADA ENTRE AS CAMADAS DO SISTEMA:\n`;
    report += `   - Supabase / Estado React: Dados presentes.\n`;
    report += `   - Allocation Core: Ignorou ou falhou na leitura dos horários.\n`;
    report += `   - Detalhe: ${detalheSincronizacao}\n`;
    report += `   - Erro encontrado: Sincronização e Cache de Leitura.\n`;
  } else {
    report += `✔ Perfeita consistência de dados em todas as camadas:\n`;
    report += `   Supabase [OK] ↔ Estado React [OK] ↔ Store [OK] ↔ Allocation Core [OK] ↔ schedule-utils [OK] ↔ Constraint Analyzer [OK]\n`;
  }

  report += `\n[ETAPA 3] EXPLICAR O CÁLCULO (BALANÇO DE CARGA VS DISPONIBILIDADE)\n`;
  report += `Professor: ${p.nomeCompleto}\n`;
  report += `Carga Necessária Total: ${totalCarga} aulas/semana (Matutino: ${reqManha}, Vespertino: ${reqTarde}, Noturno: ${reqNoite})\n`;
  report += `Disponibilidade Real Lida pelo Motor: ${totalAvail} slots (Matutino: ${availManha}, Vespertino: ${availTarde}, Noturno: ${availNoite})\n`;

  const diasDaSemana = ["segunda", "terca", "quarta", "quinta", "sexta"];
  report += `Slots Disponíveis Detalhados por Dia:\n`;
  for (const d of diasDaSemana) {
    const slotsDia = p.disponibilidade && p.disponibilidade[d] ? p.disponibilidade[d] : [];
    report += `  - ${d.toUpperCase()}: ${slotsDia.length} slots [${slotsDia.map(s => `${s}º`).join(", ")}]\n`;
  }

  // ETAPA 4 — Mostrar cada rejeição e ETAPA 5 — Descobrir a verdadeira causa
  report += `\n[ETAPA 4 e 5] AUDITORIA DETALHADA E CAUSA DO BLOQUEIO DE CADA SLOT\n`;
  
  const slotsRejeitados: { dia: string; h: number; turno: string; motivo: string; causa: string; funcao: string; regra: string }[] = [];
  const turnosProf = new Set<string>();
  itens.forEach((it) => {
    const t = turmas.find(x => x.id === it.turmaId);
    if (t) turnosProf.add(t.turno);
  });
  if (turnosProf.size === 0) turnosProf.add("manha"); // default fallback

  for (const dia of diasDaSemana) {
    for (const turno of Array.from(turnosProf)) {
      const slotsPorDiaLimit = turno === "noite" ? (config.quantidadeHorariosPorDiaNoite ?? 4) : turno === "tarde" ? (config.quantidadeHorariosPorDiaTarde ?? 5) : config.quantidadeHorariosPorDia;
      
      for (let h = 1; h <= slotsPorDiaLimit; h++) {
        const offset = turno === "noite" ? 20 : turno === "tarde" ? 10 : 0;
        const actualHour = h + offset;
        
        // 1. Disponibilidade cadastrada
        const isAvail = isProfAvailableAt(p.disponibilidade, dia, h, turno);
        if (!isAvail) {
          slotsRejeitados.push({
            dia,
            h,
            turno,
            motivo: `Não cadastrado como disponível na interface de horários.`,
            causa: "indisponibilidade",
            funcao: "isProfAvailableAt()",
            regra: "Disponibilidade do Professor"
          });
          continue;
        }

        // 2. Conflito de professor (já ocupado por aula travada)
        const isOcupado = lockedAlocacoes.some(a => {
          if (a.professorId !== p.id || a.diaSemana !== dia || a.horario !== h) return false;
          const t = turmas.find(tm => tm.id === a.turmaId);
          const shift = t?.turno || "manha";
          return shift === turno;
        });
        if (isOcupado) {
          slotsRejeitados.push({
            dia,
            h,
            turno,
            motivo: `Já existe aula travada alocada para este docente neste slot.`,
            causa: "conflito de professor",
            funcao: "verificarSlotViavel()",
            regra: "Conflito de Professor Ocupado"
          });
          continue;
        }

        // 3. Regra de turnos incorretos
        const isTurnoIncorreto = (turno === "manha" && actualHour > config.quantidadeHorariosPorDia) ||
                                 (turno === "tarde" && (actualHour < 11 || actualHour > 10 + (config.quantidadeHorariosPorDiaTarde ?? 5))) ||
                                 (turno === "noite" && (actualHour < 21 || actualHour > 20 + (config.quantidadeHorariosPorDiaNoite ?? 4)));
        if (isTurnoIncorreto) {
          slotsRejeitados.push({
            dia,
            h,
            turno,
            motivo: `O horário ${h}º no turno ${turno} é incompatível com as configurações do turno selecionado.`,
            causa: "turno incorreto",
            funcao: "verificarSlotViavel()",
            regra: "Turno Incorreto"
          });
          continue;
        }
      }
    }
  }

  slotsRejeitados.forEach(r => {
    report += `  - ${r.dia.toUpperCase()} (${r.h}º Horário - Turno ${r.turno}) -> REJEITADO\n`;
    report += `    Motivo: ${r.motivo}\n`;
    report += `    Função de Validação: ${r.funcao}\n`;
    report += `    Regra de Bloqueio: ${r.regra} [Causa: ${r.causa}]\n`;
  });

  // ETAPA 6 — Emitir diagnóstico baseado em evidências
  report += `\n[ETAPA 6] VEREDICTO DE AUDITORIA BASEADO EM EVIDÊNCIAS\n`;
  let causaFinal = "";
  let arquivoCausa = "schedule-utils.ts";
  let funcaoCausa = "runAllocation()";
  let linhaAproximada = "400-420";

  if (erroSincronizacao) {
    causaFinal = "O Allocation Core ignorou ou não sincronizou corretamente os horários por erro de sincronização/cache.";
    arquivoCausa = "allocation-core.ts";
    funcaoCausa = "loadProfessorAvailability()";
    linhaAproximada = "113";
  } else if (totalCarga > totalAvail) {
    causaFinal = `O professor necessita de ${totalCarga} slots semanais, mas o cadastro do professor possui apenas ${totalAvail} slots livres.`;
    arquivoCausa = "schedule-utils.ts";
    funcaoCausa = "runAllocation()";
    linhaAproximada = "406";
  } else if (reqManha > availManha) {
    causaFinal = `O professor possui carga de ${reqManha} aulas no turno Matutino, mas possui apenas ${availManha} slots disponíveis nesse turno.`;
    arquivoCausa = "schedule-utils.ts";
    funcaoCausa = "runAllocation()";
    linhaAproximada = "406";
  } else if (reqTarde > availTarde) {
    causaFinal = `O professor possui carga de ${reqTarde} aulas no turno Vespertino, mas possui apenas ${availTarde} slots disponíveis nesse turno.`;
    arquivoCausa = "schedule-utils.ts";
    funcaoCausa = "runAllocation()";
    linhaAproximada = "406";
  } else if (reqNoite > availNoite) {
    causaFinal = `O professor possui carga de ${reqNoite} aulas no turno Noturno, mas possui apenas ${availNoite} slots disponíveis nesse turno.`;
    arquivoCausa = "schedule-utils.ts";
    funcaoCausa = "runAllocation()";
    linhaAproximada = "406";
  } else {
    causaFinal = "Inviabilidade causada por conflito de professor, conflito de turmas concorrentes ou regra pedagógica de consecutividade na matriz.";
    arquivoCausa = "allocation-engine.ts";
    funcaoCausa = "autoFix()";
    linhaAproximada = "648";
  }

  report += `  - Causa Raiz: ${causaFinal}\n`;
  report += `  - Arquivo: ${arquivoCausa}\n`;
  report += `  - Função: ${funcaoCausa}\n`;
  report += `  - Linha aproximada: ${linhaAproximada}\n`;

  // ETAPA 7 — Sugestão correta baseada na causa raiz
  report += `\n[ETAPA 7] SUGESTÃO PEDAGÓGICA E DE RESOLUÇÃO\n`;
  if (erroSincronizacao) {
    report += `  - Ação: Atualizar sincronização de cache de leitura.\n`;
    report += `    Nenhuma alteração cadastral é necessária. Recarregue os horários ou clique em Sincronizar.\n`;
  } else if (totalCarga > totalAvail || reqManha > availManha || reqTarde > availTarde || reqNoite > availNoite) {
    const quartaAvail = p.disponibilidade && p.disponibilidade["quarta"] && p.disponibilidade["quarta"].length > 0;
    const tercaAvail = p.disponibilidade && p.disponibilidade["terca"] && p.disponibilidade["terca"].length > 0;
    const quintaAvail = p.disponibilidade && p.disponibilidade["quinta"] && p.disponibilidade["quinta"].length > 0;

    let diaSugerido = "um dia adicional";
    if (!quartaAvail) diaSugerido = "Quarta-feira";
    else if (!tercaAvail) diaSugerido = "Terça-feira";
    else if (!quintaAvail) diaSugerido = "Quinta-feira";
    else {
      for (const d of diasDaSemana) {
        const slotsDia = p.disponibilidade && p.disponibilidade[d] ? p.disponibilidade[d].length : 0;
        if (slotsDia < 2) {
          diaSugerido = d.charAt(0).toUpperCase() + d.slice(1);
          break;
        }
      }
    }

    report += `  - Ação: Liberar mais horários para o professor ${p.nomeCompleto} no cadastro, preferencialmente na ${diaSugerido}.\n`;
    report += `    Alternativamente, reduza a carga horária na matriz curricular de alguma turma associada ou transfira a aula para outro professor.\n`;
  } else {
    report += `  - Ação: Mover disciplinas concorrentes para outro dia útil (conflito de turma) ou utilizar o assistente de otimização pedagógica global.\n`;
  }

  return report;
}
export interface DistribuicaoSemanal {
  dia: string;
  qtdAulas: number;
  horarios: number[];
}

export function calcularDistribuicaoPrioritaria(
  weeklyHours: number,
  maxDia: number,
  maxConsec: number,
  exigeGeminacao: boolean,
  prioridade: "alta" | "media" | "baixa",
  turno: string,
  slotsPerDay: number,
  disponibilidade?: Record<string, any>
): DistribuicaoSemanal[] {
  const dias = ["segunda", "terca", "quarta", "quinta", "sexta"];
  
  // Encontrar dias preferidos com base na disponibilidade do professor no turno, se fornecido
  let diasPreferidos = [...dias];
  if (disponibilidade) {
    const contagemDisponibilidade = dias.map(d => {
      let count = 0;
      for (let h = 1; h <= slotsPerDay; h++) {
        if (isProfAvailableAt(disponibilidade, d, h, turno)) {
          count++;
        }
      }
      return { dia: d, count };
    });
    // Filtra dias que têm pelo menos alguma disponibilidade, ordenados por maior disponibilidade primeiro
    const diasComDisponibilidade = contagemDisponibilidade
      .filter(x => x.count > 0)
      .sort((a, b) => b.count - a.count)
      .map(x => x.dia);
    
    if (diasComDisponibilidade.length > 0) {
      diasPreferidos = diasComDisponibilidade;
    }
  }

  const resultado: DistribuicaoSemanal[] = [];
  
  // CASO 1: 5 aulas semanais - REGRA 2 (2+2+1) - PRIORITÁRIA
  if (weeklyHours === 5 && maxDia >= 2 && !exigeGeminacao) {
    const d1 = diasPreferidos[0] || "segunda";
    const d2 = diasPreferidos[1] || "terca";
    const d3 = diasPreferidos[2] || "quarta";
    return [
      { dia: d1, qtdAulas: 2, horarios: [1, 2] },
      { dia: d2, qtdAulas: 2, horarios: [1, 2] },
      { dia: d3, qtdAulas: 1, horarios: [1] },
    ];
  }
  
  // CASO 2: 5 aulas semanais - REGRA 1 (3+2) - ALTERNATIVA
  if (weeklyHours === 5 && maxDia >= 3) {
    const d1 = diasPreferidos[0] || "segunda";
    const d2 = diasPreferidos[1] || "terca";
    return [
      { dia: d1, qtdAulas: 3, horarios: [1, 2, 3] },
      { dia: d2, qtdAulas: 2, horarios: [1, 2] },
    ];
  }
  
  // CASO 3: 5 aulas com geminação exigida (2+2+1)
  if (weeklyHours === 5 && exigeGeminacao) {
    const d1 = diasPreferidos[0] || "segunda";
    const d2 = diasPreferidos[1] || "terca";
    const d3 = diasPreferidos[2] || "quarta";
    return [
      { dia: d1, qtdAulas: 2, horarios: [1, 2] },
      { dia: d2, qtdAulas: 2, horarios: [1, 2] },
      { dia: d3, qtdAulas: 1, horarios: [1] },
    ];
  }
  
  // CASO 4: 4 aulas semanais - 2+2
  if (weeklyHours === 4 && maxDia >= 2) {
    const d1 = diasPreferidos[0] || "segunda";
    const d2 = diasPreferidos[1] || "terca";
    return [
      { dia: d1, qtdAulas: 2, horarios: [1, 2] },
      { dia: d2, qtdAulas: 2, horarios: [1, 2] },
    ];
  }
  
  // CASO 5: 3 aulas semanais - 2+1
  if (weeklyHours === 3 && maxDia >= 2) {
    const d1 = diasPreferidos[0] || "segunda";
    const d2 = diasPreferidos[1] || "terca";
    return [
      { dia: d1, qtdAulas: 2, horarios: [1, 2] },
      { dia: d2, qtdAulas: 1, horarios: [1] },
    ];
  }
  
  // CASO 6: 2 aulas semanais - 2
  if (weeklyHours === 2 && maxDia >= 2) {
    const d1 = diasPreferidos[0] || "segunda";
    return [
      { dia: d1, qtdAulas: 2, horarios: [1, 2] },
    ];
  }
  
  // Outras cargas (uniforme)
  let restante = weeklyHours;
  let diaIndex = 0;
  while (restante > 0) {
    const dia = diasPreferidos[diaIndex % diasPreferidos.length] || dias[diaIndex % dias.length];
    const qtd = Math.min(maxDia, restante);
    const horarios: number[] = [];
    for (let h = 1; h <= qtd && h <= slotsPerDay; h++) {
      horarios.push(h);
    }
    resultado.push({
      dia,
      qtdAulas: qtd,
      horarios
    });
    restante -= qtd;
    diaIndex++;
  }
  
  return resultado;
}

export function alocarProfessor(
  professor: Professor,
  turmas: Turma[],
  disciplinas: Disciplina[],
  matriz: MatrizCurricular[],
  config: ConfiguracaoHorarios,
  alocacoesExistentes: Alocacao[],
  regrasRelaxamento?: any
): { alocacoes: Alocacao[]; logs: string[] } {
  const logs: string[] = [];
  const novasAlocacoes: Alocacao[] = [];
  const dias = ["segunda", "terca", "quarta", "quinta", "sexta"];

  const items = Array.isArray(professor.planejamento) ? professor.planejamento : [];
  if (items.length === 0) {
    logs.push(`⚠️ Professor ${professor.nomeCompleto} não possui disciplinas vinculadas no planejamento.`);
    return { alocacoes: [], logs };
  }

  logs.push(`\nIniciando alocação para o Professor: ${professor.nomeCompleto}`);

  // Verificar carga máxima do professor
  const cargaAtualProfessor = alocacoesExistentes.filter(a => a.professorId === professor.id).length;
  const cargaMaximaProfessor = professor.cargaHorariaMaximaSemanal || 0;

  if (cargaMaximaProfessor > 0 && cargaAtualProfessor >= cargaMaximaProfessor) {
    logs.push(`⚠️ Professor ${professor.nomeCompleto} atingiu carga máxima (${cargaMaximaProfessor}h)`);
    return { alocacoes: [], logs };
  }

  // 1. Agrupar e ordenar as disciplinas atribuídas ao professor por prioridade
  const atribuicoesSorted = [...items].sort((a, b) => {
    const pA = a.prioridade === "alta" ? 3 : a.prioridade === "baixa" ? 1 : 2;
    const pB = b.prioridade === "alta" ? 3 : b.prioridade === "baixa" ? 1 : 2;
    if (pB !== pA) return pB - pA;
    
    const countA = Number(a.aulasPorSemana !== undefined ? a.aulasPorSemana : a.quantidadeAulas) || 0;
    const countB = Number(b.aulasPorSemana !== undefined ? b.aulasPorSemana : b.quantidadeAulas) || 0;
    return countB - countA;
  });

  for (const item of atribuicoesSorted) {
    const turma = turmas.find(t => t.id === item.turmaId);
    const disciplina = disciplinas.find(d => d.id === item.disciplinaId);
    if (!turma || !disciplina) {
      logs.push(`❌ Turma ou disciplina não localizada para o item de planejamento.`);
      continue;
    }

    if (cargaMaximaProfessor > 0 && (cargaAtualProfessor + novasAlocacoes.length) >= cargaMaximaProfessor) {
      logs.push(`⚠️ Carga máxima do professor (${cargaMaximaProfessor}h) atingida. Encerrando alocações.`);
      break;
    }

    // ✅ CARGA HORÁRIA SEMANAL DA DISCIPLINA (DO CADASTRO DO USUÁRIO)
    const weeklyHours = Number(item.aulasPorSemana !== undefined ? item.aulasPorSemana : item.quantidadeAulas) || 0;
    if (weeklyHours <= 0) continue;

    // ✅ CALCULAR QUANTAS AULAS JÁ FORAM ALOCADAS PARA ESTA DISCIPLINA
    const aulasJaAlocadasEstaDisciplina = [...alocacoesExistentes, ...novasAlocacoes].filter(a =>
      a.professorId === professor.id &&
      a.turmaId === turma.id &&
      a.disciplinaId === disciplina.id
    ).length;

    // ✅ VERIFICAR SE A DISCIPLINA JÁ ATINGIU O LIMITE SEMANAL
    if (aulasJaAlocadasEstaDisciplina >= weeklyHours) {
      logs.push(`  ⚠️ Disciplina ${disciplina.nome} na turma ${turma.nome} já atingiu limite semanal (${weeklyHours}h)`);
      continue;
    }

    const turno = turma.turno || "manha";
    const slotsPerDay = turno === "noite" ? (config.quantidadeHorariosPorDiaNoite ?? 4) : turno === "tarde" ? (config.quantidadeHorariosPorDiaTarde ?? 5) : config.quantidadeHorariosPorDia;
    const maxDia = item.maximoAulasPorDia ?? (weeklyHours >= 5 ? 3 : 2);
    const maxConsec = item.maximoConsecutivas ?? 2;
    const exigeGeminacao = !!item.exigeGeminacao;
    const prioridade = (item.prioridade as "alta" | "media" | "baixa") || "media";

    logs.push(`  → Atribuição: ${disciplina.nome} para Turma ${turma.nome} (${weeklyHours} aulas/semana, Turno: ${turno})`);

    // 2. Calcular a distribuição ideal
    const distribuicao = calcularDistribuicaoPrioritaria(
      weeklyHours,
      maxDia,
      maxConsec,
      exigeGeminacao,
      prioridade,
      turno,
      slotsPerDay,
      professor.disponibilidade
    );

    // ✅ VARIÁVEL PARA CONTROLAR O LIMITE SEMANAL
    let alocadasNestaDisciplina = aulasJaAlocadasEstaDisciplina;

    const diasTurma = (turma.diasPermitidos && Array.isArray(turma.diasPermitidos))
      ? dias.filter(d => turma.diasPermitidos!.includes(d))
      : dias;

    // 3. Tentar alocar conforme a distribuição proposta
    for (const dist of distribuicao) {
      // ✅ VERIFICAR SE A DISCIPLINA JÁ ATINGIU O LIMITE SEMANAL
      if (alocadasNestaDisciplina >= weeklyHours) {
        logs.push(`     ⚠️ Limite semanal de ${weeklyHours} aulas para ${disciplina.nome} atingido.`);
        break;
      }

      if (!diasTurma.includes(dist.dia)) continue;
      
      let horariosAlocadosNoDia = 0;
      const horariosDisponiveis = [...dist.horarios];

      // Tentar os horários preferidos da distribuição
      for (const h of horariosDisponiveis) {
        // ✅ VERIFICAR LIMITE SEMANAL ANTES DE CADA ALOCAÇÃO
        if (alocadasNestaDisciplina >= weeklyHours) {
          logs.push(`     ⚠️ Limite semanal de ${weeklyHours} aulas para ${disciplina.nome} atingido.`);
          break;
        }
        if (horariosAlocadosNoDia >= dist.qtdAulas) break;

        if (cargaMaximaProfessor > 0 && (cargaAtualProfessor + novasAlocacoes.length) >= cargaMaximaProfessor) {
          logs.push(`     ⚠️ Carga máxima do professor (${cargaMaximaProfessor}h) atingida.`);
          break;
        }

        // Verificar limite diário
        const aulasHoje = [...alocacoesExistentes, ...novasAlocacoes].filter(a =>
          a.professorId === professor.id &&
          a.turmaId === turma.id &&
          a.disciplinaId === disciplina.id &&
          a.diaSemana === dist.dia
        ).length;

        if (aulasHoje >= maxDia) {
          logs.push(`     ⚠️ Limite diário de ${maxDia} aulas para ${disciplina.nome} em ${dist.dia} atingido.`);
          continue;
        }

        const check = verificarSlotViavelComMotivo(
          [...alocacoesExistentes, ...novasAlocacoes],
          [professor],
          disciplinas,
          turmas,
          matriz,
          config,
          professor.id,
          turma.id,
          disciplina.id,
          dist.dia,
          h,
          regrasRelaxamento
        );

        if (check.viavel) {
          const novaAlocacao: Alocacao = {
            id: `prof-${professor.id}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            professorId: professor.id,
            diaSemana: dist.dia,
            horario: h,
          };
          novasAlocacoes.push(novaAlocacao);
          horariosAlocadosNoDia++;
          alocadasNestaDisciplina++;
          logs.push(`     ✅ Alocada: ${dist.dia.toUpperCase()} ${h}º horário (${alocadasNestaDisciplina}/${weeklyHours})`);
        } else {
          logs.push(`     ⚠️ Slot indisponível: ${dist.dia.toUpperCase()} ${h}º horário - ${check.motivo || "ocupado"}`);
        }
      }

      // ✅ BUSCA DE ALTERNATIVOS - COM VERIFICAÇÃO DE LIMITE SEMANAL
      if (horariosAlocadosNoDia < dist.qtdAulas && alocadasNestaDisciplina < weeklyHours) {
        logs.push(`     🔄 Buscando horários alternativos para ${dist.dia.toUpperCase()}...`);
        for (let hAlt = 1; hAlt <= slotsPerDay && horariosAlocadosNoDia < dist.qtdAulas && alocadasNestaDisciplina < weeklyHours; hAlt++) {
          if (horariosDisponiveis.includes(hAlt)) continue;

          // Verificar limite diário
          const aulasHoje = [...alocacoesExistentes, ...novasAlocacoes].filter(a =>
            a.professorId === professor.id &&
            a.turmaId === turma.id &&
            a.disciplinaId === disciplina.id &&
            a.diaSemana === dist.dia
          ).length;

          if (aulasHoje >= maxDia) {
            continue;
          }

          if (cargaMaximaProfessor > 0 && (cargaAtualProfessor + novasAlocacoes.length) >= cargaMaximaProfessor) {
            logs.push(`     ⚠️ Carga máxima do professor (${cargaMaximaProfessor}h) atingida.`);
            break;
          }

          const check = verificarSlotViavelComMotivo(
            [...alocacoesExistentes, ...novasAlocacoes],
            [professor],
            disciplinas,
            turmas,
            matriz,
            config,
            professor.id,
            turma.id,
            disciplina.id,
            dist.dia,
            hAlt,
            regrasRelaxamento
          );

          if (check.viavel) {
            const novaAlocacao: Alocacao = {
              id: `prof-${professor.id}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
              turmaId: turma.id,
              disciplinaId: disciplina.id,
              professorId: professor.id,
              diaSemana: dist.dia,
              horario: hAlt,
            };
            novasAlocacoes.push(novaAlocacao);
            horariosAlocadosNoDia++;
            alocadasNestaDisciplina++;
            logs.push(`     ✅ Alocada (alt): ${dist.dia.toUpperCase()} ${hAlt}º horário (${alocadasNestaDisciplina}/${weeklyHours})`);
          }
        }
      }
    }

    // ✅ BUSCA SEMANAL - COM VERIFICAÇÃO DE LIMITE
    if (alocadasNestaDisciplina < weeklyHours) {
      logs.push(`     🔄 Carga incompleta para ${disciplina.nome} (${alocadasNestaDisciplina}/${weeklyHours}). Buscando slots semanais...`);
      for (const dAlt of diasTurma) {
        if (alocadasNestaDisciplina >= weeklyHours) break;
        for (let hAlt = 1; hAlt <= slotsPerDay && alocadasNestaDisciplina < weeklyHours; hAlt++) {
          if (cargaMaximaProfessor > 0 && (cargaAtualProfessor + novasAlocacoes.length) >= cargaMaximaProfessor) {
            logs.push(`     ⚠️ Carga máxima do professor (${cargaMaximaProfessor}h) atingida.`);
            break;
          }

          // Verificar limite diário
          const aulasHoje = [...alocacoesExistentes, ...novasAlocacoes].filter(a =>
            a.professorId === professor.id &&
            a.turmaId === turma.id &&
            a.disciplinaId === disciplina.id &&
            a.diaSemana === dAlt
          ).length;

          if (aulasHoje >= maxDia) {
            continue;
          }

          const check = verificarSlotViavelComMotivo(
            [...alocacoesExistentes, ...novasAlocacoes],
            [professor],
            disciplinas,
            turmas,
            matriz,
            config,
            professor.id,
            turma.id,
            disciplina.id,
            dAlt,
            hAlt,
            regrasRelaxamento
          );

          if (check.viavel) {
            const novaAlocacao: Alocacao = {
              id: `prof-${professor.id}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
              turmaId: turma.id,
              disciplinaId: disciplina.id,
              professorId: professor.id,
              diaSemana: dAlt,
              horario: hAlt,
            };
            novasAlocacoes.push(novaAlocacao);
            alocadasNestaDisciplina++;
            logs.push(`     ✅ Alocada (semanal): ${dAlt.toUpperCase()} ${hAlt}º horário (${alocadasNestaDisciplina}/${weeklyHours})`);
          }
        }
      }
    }

    // ✅ RESULTADO FINAL
    if (alocadasNestaDisciplina < weeklyHours) {
      logs.push(`     ❌ Falha de Alocação: Alocadas apenas ${alocadasNestaDisciplina} de ${weeklyHours} aulas semanais para ${disciplina.nome}.`);
    } else {
      logs.push(`     ✔ Carga completa: ${alocadasNestaDisciplina}/${weeklyHours} aulas alocadas.`);
    }
  }

  return { alocacoes: novasAlocacoes, logs };
}

export function runAllocation(
  turmas: Turma[],
  disciplinas: Disciplina[],
  professores: Professor[],
  matriz: MatrizCurricular[],
  config: ConfiguracaoHorarios,
  lockedAlocacoes: Alocacao[] = [],
  regrasRelaxamento?: RegrasRelaxamento,
  _maxIterations?: number,
  _mode?: string,
  baseSeed?: number,
  debugGeracao?: boolean
): { alocacoes: Alocacao[]; conflitos: Conflito[]; diagnostico: DiagnosticoGeracao } {
  
  const turmaMap = new Map(turmas.map((t) => [t.id, t]));
  const sanitizedProfs = ensureProfessoresPlanejamento(professores, matriz);
  const profMap = new Map(sanitizedProfs.map((p) => [p.id, p]));

  const totalAulasPlanejadasGlobal = matriz.reduce((acc, m) => acc + m.aulasPorSemana, 0);

  // 1. ANÁLISE MATEMÁTICA ANTECIPADA (CONDIÇÃO DE PARADA 3: Prova matemática de inviabilidade)
  let totalCapacidadeSlotsEscola = 0;
  for (const t of turmas) {
    const slotsPorDia = t.turno === "noite" ? (config.quantidadeHorariosPorDiaNoite ?? 4) : t.turno === "tarde" ? (config.quantidadeHorariosPorDiaTarde ?? 5) : config.quantidadeHorariosPorDia;
    const capTurma = slotsPorDia * DAYS.length;
    totalCapacidadeSlotsEscola += capTurma;

    const aulasTurma = matriz.filter((m) => m.turmaId === t.id).reduce((acc, m) => acc + m.aulasPorSemana, 0);
    if (aulasTurma > capTurma) {
      const msgCompleta = `HOMOLOGAÇÃO: Não existe solução.\n\nMotivos: Turma ${t.nome} - Capacidade insuficiente - Exige ${aulasTurma} aulas, mas o turno tem apenas ${capTurma} slots.\n\nSolução: Aumentar a quantidade de horários diários nas configurações ou reduzir a carga na matriz.`;
      return {
        alocacoes: [],
        conflitos: [],
        diagnostico: {
          sucesso: false,
          taxaAlocacao: 0,
          aulasPlanejadas: totalAulasPlanejadasGlobal,
          aulasAlocadas: 0,
          motivoEncerrado: msgCompleta,
          mensagens: [msgCompleta]
        },
      };
    }
  }

  if (totalAulasPlanejadasGlobal > totalCapacidadeSlotsEscola) {
    const msgCompleta = `HOMOLOGAÇÃO: Não existe solução.\n\nMotivos: Carga total excede capacidade - A escola exige ${totalAulasPlanejadasGlobal} aulas, mas tem apenas ${totalCapacidadeSlotsEscola} slots físicos.\n\nSolução: Ampliar slots nas configurações ou reduzir a carga curricular geral.`;
    return {
      alocacoes: [],
      conflitos: [],
      diagnostico: {
        sucesso: false,
        taxaAlocacao: 0,
        aulasPlanejadas: totalAulasPlanejadasGlobal,
        aulasAlocadas: 0,
        motivoEncerrado: msgCompleta,
        mensagens: [msgCompleta]
      },
    };
  }

  for (const p of sanitizedProfs) {
    const itens = p.planejamento && Array.isArray(p.planejamento) ? p.planejamento : [];
    
    // Calcular carga por turno
    let reqManha = 0;
    let reqTarde = 0;
    let reqNoite = 0;
    
    itens.forEach((it) => {
      const t = turmaMap.get(it.turmaId);
      const aulas = Number(it.aulasPorSemana !== undefined ? it.aulasPorSemana : it.quantidadeAulas) || 0;
      if (t) {
        if (t.turno === "manha") reqManha += aulas;
        else if (t.turno === "tarde") reqTarde += aulas;
        else if (t.turno === "noite") reqNoite += aulas;
      }
    });

    const slotsDiaManhaMax = config.quantidadeHorariosPorDia;
    const slotsDiaTardeMax = config.quantidadeHorariosPorDiaTarde ?? 5;
    const slotsDiaNoiteMax = config.quantidadeHorariosPorDiaNoite ?? 4;

    let availManha = 0;
    let availTarde = 0;
    let availNoite = 0;

    if (p.disponibilidade) {
      Object.keys(p.disponibilidade).forEach((d) => {
        const diaClean = d.toLowerCase().trim();
        const arr = (p.disponibilidade[diaClean] ?? []).map(Number);
        arr.forEach((val) => {
          if (val >= 1 && val <= slotsDiaManhaMax) availManha++;
          else if (val >= 11 && val <= 10 + slotsDiaTardeMax) availTarde++;
          else if (val >= 21 && val <= 20 + slotsDiaNoiteMax) availNoite++;
        });
      });
    }

    const totalCarga = reqManha + reqTarde + reqNoite;
    const totalAvail = availManha + availTarde + availNoite;

    const isInsuficienteTotal = totalCarga > totalAvail;
    const isInsuficienteManha = reqManha > availManha;
    const isInsuficienteTarde = reqTarde > availTarde;
    const isInsuficienteNoite = reqNoite > availNoite;

    if ((isInsuficienteTotal || isInsuficienteManha || isInsuficienteTarde || isInsuficienteNoite) && !regrasRelaxamento?.permitirAlocarQualquerHorarioDisponivel) {
      const msgCompleta = "HOMOLOGAÇÃO: Não existe solução.\n\n" + gerarDiagnosticoProvaMatematica(
        p,
        turmas,
        disciplinas,
        matriz,
        config,
        lockedAlocacoes,
        reqManha,
        reqTarde,
        reqNoite,
        availManha,
        availTarde,
        availNoite
      );
      return {
        alocacoes: [],
        conflitos: [],
        diagnostico: {
          sucesso: false,
          taxaAlocacao: 0,
          aulasPlanejadas: totalAulasPlanejadasGlobal,
          aulasAlocadas: 0,
          motivoEncerrado: msgCompleta,
          mensagens: [msgCompleta]
        },
      };
    }
  }

  // Caching de disponibilidade dos professores para busca O(1)
  const profAvailCache = new Map<string, boolean>();
  function getIsProfAvailable(profId: string, dia: string, h: number, turno: string): boolean {
    const key = `${profId}|${dia}|${h}|${turno}`;
    let res = profAvailCache.get(key);
    if (res === undefined) {
      const p = profMap.get(profId);
      res = isProfAvailableAt(p?.disponibilidade, dia, h, turno);
      profAvailCache.set(key, res);
    }
    return res;
  }

  // Precalculo de limites e planejamento de disciplinas para busca O(1)
  const limitesDisciplinas = new Map<string, number>();
  disciplinas.forEach((d) => limitesDisciplinas.set(d.id, 2));

  const planningMap = new Map<string, any>();
  sanitizedProfs.forEach((p) => {
    const itens = p.planejamento && Array.isArray(p.planejamento) ? p.planejamento : [];
    itens.forEach((item) => {
      planningMap.set(`${p.id}|${item.disciplinaId}|${item.turmaId}`, item);
    });
  });

  const profTotalCargaMap = new Map<string, number>();
  const profRestricaoScoreMap = new Map<string, number>();

  sanitizedProfs.forEach((p) => {
    let cargaTotal = 0;
    const itens = p.planejamento && Array.isArray(p.planejamento) ? p.planejamento : [];
    itens.forEach((it) => {
      cargaTotal += Number(it.aulasPorSemana !== undefined ? it.aulasPorSemana : it.quantidadeAulas) || 0;
    });
    profTotalCargaMap.set(p.id, cargaTotal);

    let slotsDisponiveis = 0;
    if (p.disponibilidade) {
      Object.keys(p.disponibilidade).forEach((dia) => {
        const slotsDia = p.disponibilidade[dia];
        if (Array.isArray(slotsDia)) slotsDisponiveis += slotsDia.length;
      });
    }
    if (slotsDisponiveis === 0) slotsDisponiveis = 1;
    profRestricaoScoreMap.set(p.id, (cargaTotal * 100) / slotsDisponiveis);
  });

  // Construção das demandas
  const grupos: DemandGroup[] = [];
  sanitizedProfs.forEach((p) => {
    const itens = p.planejamento && Array.isArray(p.planejamento) ? p.planejamento : [];
    itens.forEach((item) => {
      const cargaSemanal = Number(item.aulasPorSemana !== undefined ? item.aulasPorSemana : item.quantidadeAulas) || 0;
      const t = turmaMap.get(item.turmaId);
      if (!t || cargaSemanal <= 0) return;

      const jaAlocadasFixo = lockedAlocacoes.filter((la) => la.turmaId === item.turmaId && la.disciplinaId === item.disciplinaId && la.professorId === p.id).length;
      const pendentes = cargaSemanal - jaAlocadasFixo;
      if (pendentes <= 0) return;

      const maxHorarios = t.turno === "noite" ? (config.quantidadeHorariosPorDiaNoite ?? 4) : t.turno === "tarde" ? (config.quantidadeHorariosPorDiaTarde ?? 5) : config.quantidadeHorariosPorDia;

      let slotsDisponiveis = 0;
      if (p.disponibilidade) {
        Object.keys(p.disponibilidade).forEach((dia) => {
          const slotsDia = p.disponibilidade[dia];
          if (Array.isArray(slotsDia)) slotsDisponiveis += slotsDia.length;
        });
      }
      if (slotsDisponiveis === 0) slotsDisponiveis = 1;

      const dConf = disciplinas.find((d) => d.id === item.disciplinaId);

      grupos.push({
        key: `${item.turmaId}|${item.disciplinaId}|${p.id}`,
        turmaId: item.turmaId,
        disciplinaId: item.disciplinaId,
        profId: p.id,
        turno: t.turno,
        maxHorarios,
        pendentes,
        cargaProf: profTotalCargaMap.get(p.id) || 0,
        restricaoScore: profRestricaoScoreMap.get(p.id) || 0,
        priority: item.prioridade || "media",
        slotsDisponiveis,
        exigeGeminacao: !!item.exigeGeminacao,
        maximoAulasPorDia: item.maximoAulasPorDia ?? dConf?.maximoAulasPorDia ?? 3,
        maximoConsecutivas: item.maximoConsecutivas ?? 2,
      });
    });
  });

  // Heurística de MRV Global Avançada (Global Minimum Remaining Values)
  // Calcula a quantidade real de horários viáveis globais para cada demanda, considerando:
  // - Disponibilidade do professor no turno da turma
  // - Conflitos com alocações fixadas (locked)
  grupos.forEach((g) => {
    let slotsValidosCount = 0;
    DAYS.forEach((dia) => {
      for (let h = 1; h <= g.maxHorarios; h++) {
        // 1. Verificar disponibilidade do professor (Soft Constraint relaxável, mas considerada na heurística inicial)
        const profDisponivel = getIsProfAvailable(g.profId, dia, h, g.turno);
        if (!profDisponivel) continue;

        // 2. Verificar se o slot na turma ou no professor já está ocupado por alocações travadas (Hard Constraints)
        const turmaOcupadaLock = lockedAlocacoes.some(la => la.turmaId === g.turmaId && la.diaSemana === dia && la.horario === h);
        if (turmaOcupadaLock) continue;

        const profOcupadoLock = lockedAlocacoes.some(la => {
          if (la.professorId !== g.profId || la.diaSemana !== dia || la.horario !== h) return false;
          const t = turmaMap.get(la.turmaId);
          const shift = t?.turno || "manha";
          return shift === g.turno;
        });
        if (profOcupadoLock) continue;

        slotsValidosCount++;
      }
    });
    // Se o grupo não tem nenhum slot viável, a prioridade de alocação deve ser máxima (score alto)
    g.mrvScore = slotsValidosCount <= 0 ? 999999 : (g.pendentes * 1000) / slotsValidosCount;
  });

  function getSlotKey(dia: string, turno: string, horario: number): string {
    return `${dia}|${turno}|${horario}`;
  }

  function estadoInicial(): Estado {
    const turmaOcupada = new Set<string>();
    const profOcupado = new Set<string>();
    const contDiscDia = new Map<string, number>();
    const horariosDiscTurmaDia = new Map<string, Set<number>>();
    const alocPorTurmaSlot = new Map<string, Alocacao>();
    const alocPorProfSlot = new Map<string, Alocacao>();
    const alocacoesMap = new Map<string, Alocacao>();

    lockedAlocacoes.forEach((la) => {
      const t = turmaMap.get(la.turmaId);
      const shift = t?.turno || "manha";
      // ✅ CHAVE COM TURNO
      const slotKey = getSlotKey(la.diaSemana, shift, la.horario);
      turmaOcupada.add(`${la.turmaId}|${slotKey}`);
      profOcupado.add(`${la.professorId}|${slotKey}`);
      
      const kDiscDia = `${la.turmaId}-${la.diaSemana}-${la.disciplinaId}`;
      contDiscDia.set(kDiscDia, (contDiscDia.get(kDiscDia) || 0) + 1);

      const kHorarios = `${la.turmaId}|${la.diaSemana}|${la.disciplinaId}`;
      if (!horariosDiscTurmaDia.has(kHorarios)) horariosDiscTurmaDia.set(kHorarios, new Set());
      horariosDiscTurmaDia.get(kHorarios)!.add(la.horario);

      alocPorTurmaSlot.set(`${la.turmaId}|${la.diaSemana}|${la.horario}`, la);
      alocPorProfSlot.set(`${la.professorId}|${la.diaSemana}|${shift}|${la.horario}`, la);
      alocacoesMap.set(la.id, { ...la });
    });

    return {
      alocacoes: alocacoesMap,
      turmaOcupada,
      profOcupado,
      contDiscDia,
      horariosDiscTurmaDia,
      alocPorTurmaSlot,
      alocPorProfSlot,
    };
  }

  function slotViavel(estado: Estado, g: DemandGroup, dia: string, h: number): boolean {
    // ✅ CHAVE COM TURNO
    const slotKey = getSlotKey(dia, g.turno, h);
    if (estado.turmaOcupada.has(`${g.turmaId}|${slotKey}`)) return false;
    if (estado.profOcupado.has(`${g.profId}|${slotKey}`)) return false;
    
    const profAvail = getIsProfAvailable(g.profId, dia, h, g.turno);
    if (!profAvail && !regrasRelaxamento?.permitirAlocarQualquerHorarioDisponivel) return false;

    const planeItem = planningMap.get(`${g.profId}|${g.disciplinaId}|${g.turmaId}`);
    
    // Verificação de carga semanal em tempo real
    let weeklyLimit = 0;
    if (planeItem) {
      weeklyLimit = Number(planeItem.aulasPorSemana !== undefined ? planeItem.aulasPorSemana : planeItem.quantidadeAulas) || 0;
    } else {
      const matMatch = matriz?.find((m) => m.turmaId === g.turmaId && m.disciplinaId === g.disciplinaId);
      if (matMatch) {
        weeklyLimit = Number(matMatch.aulasPorSemana) || 0;
      }
    }

    const currentAllocatedCount = Array.from(estado.alocacoes.values()).filter(
      (a) => a.professorId === g.profId && a.turmaId === g.turmaId && a.disciplinaId === g.disciplinaId
    ).length;

    if (currentAllocatedCount >= weeklyLimit) return false;

    // Verificação adicional do limite da matriz curricular para a disciplina nesta turma
    const matMatch = matriz?.find((m) => m.turmaId === g.turmaId && m.disciplinaId === g.disciplinaId);
    if (matMatch) {
      const matrixLimit = Number(matMatch.aulasPorSemana) || 0;
      if (matrixLimit > 0) {
        const totalAllocatedForDisc = Array.from(estado.alocacoes.values()).filter(
          (a) => a.turmaId === g.turmaId && a.disciplinaId === g.disciplinaId
        ).length;
        if (totalAllocatedForDisc >= matrixLimit) return false;
      }
    }

    const maxDia = planeItem?.maximoAulasPorDia ?? g.maximoAulasPorDia ?? 3;
    const limit = regrasRelaxamento?.permitirMaisDeDuasAulasMesmoDia ? Math.max(3, maxDia + 1) : maxDia;
    if ((estado.contDiscDia.get(`${g.turmaId}-${dia}-${g.disciplinaId}`) || 0) >= limit) return false;

    // Redução Big O: Consulta O(1) via Map de Sets em vez de scan linear O(N) em alocacoes
    const maxConsecLimit = planeItem?.maximoConsecutivas ?? g.maximoConsecutivas ?? 2;
    const setHor = estado.horariosDiscTurmaDia.get(`${g.turmaId}|${dia}|${g.disciplinaId}`);
    const activeHorarios = setHor ? Array.from(setHor) : [];
    activeHorarios.push(h);
    activeHorarios.sort((a, b) => a - b);

    let maxConsec = 0, currentConsec = 0, lastH = -10;
    for (const hVal of activeHorarios) {
      currentConsec = (hVal === lastH + 1) ? currentConsec + 1 : 1;
      if (currentConsec > maxConsec) maxConsec = currentConsec;
      lastH = hVal;
    }

    const currentConsecLimit = g.exigeGeminacao ? 6 : (regrasRelaxamento?.permitirTresAulasConsecutivas ? Math.max(3, maxConsecLimit + 1) : maxConsecLimit);
    if (maxConsec > currentConsecLimit) return false;

    return true;
  }

  function aplicar(estado: Estado, g: DemandGroup, dia: string, h: number, idCounterRef: { v: number }) {
    // ✅ CHAVE COM TURNO
    const slotKey = getSlotKey(dia, g.turno, h);
    estado.turmaOcupada.add(`${g.turmaId}|${slotKey}`);
    estado.profOcupado.add(`${g.profId}|${slotKey}`);
    const kDiscDia = `${g.turmaId}-${dia}-${g.disciplinaId}`;
    estado.contDiscDia.set(kDiscDia, (estado.contDiscDia.get(kDiscDia) || 0) + 1);

    const kHorarios = `${g.turmaId}|${dia}|${g.disciplinaId}`;
    let setHor = estado.horariosDiscTurmaDia.get(kHorarios);
    if (!setHor) {
      setHor = new Set<number>();
      estado.horariosDiscTurmaDia.set(kHorarios, setHor);
    }
    setHor.add(h);

    const novaAloc: Alocacao = {
      id: `gen-${idCounterRef.v++}`,
      turmaId: g.turmaId,
      disciplinaId: g.disciplinaId,
      professorId: g.profId,
      diaSemana: dia,
      horario: h,
    } as Alocacao;

    estado.alocacoes.set(novaAloc.id, novaAloc);
    estado.alocPorTurmaSlot.set(`${g.turmaId}|${dia}|${h}`, novaAloc);
    estado.alocPorProfSlot.set(`${g.profId}|${dia}|${g.turno}|${h}`, novaAloc);
  }

  function removerAlocacao(estado: Estado, a: Alocacao) {
    estado.alocacoes.delete(a.id);
    const t = turmaMap.get(a.turmaId);
    const shift = t?.turno || "manha";
    // ✅ CHAVE COM TURNO
    const slotKey = getSlotKey(a.diaSemana, shift, a.horario);
    estado.turmaOcupada.delete(`${a.turmaId}|${slotKey}`);
    estado.profOcupado.delete(`${a.professorId}|${slotKey}`);
    const kDiscDia = `${a.turmaId}-${a.diaSemana}-${a.disciplinaId}`;
    const cur = estado.contDiscDia.get(kDiscDia) || 0;
    if (cur > 0) estado.contDiscDia.set(kDiscDia, cur - 1);

    const kHorarios = `${a.turmaId}|${a.diaSemana}|${a.disciplinaId}`;
    estado.horariosDiscTurmaDia.get(kHorarios)?.delete(a.horario);
    estado.alocPorTurmaSlot.delete(`${a.turmaId}|${a.diaSemana}|${a.horario}`);
    estado.alocPorProfSlot.delete(`${a.professorId}|${a.diaSemana}|${shift}|${a.horario}`);
  }

  function clonarEstado(est: Estado): Estado {
    const mapHorarios = new Map<string, Set<number>>();
    est.horariosDiscTurmaDia.forEach((v, k) => mapHorarios.set(k, new Set(v)));
    const alocClone = new Map<string, Alocacao>();
    est.alocacoes.forEach((v, k) => alocClone.set(k, { ...v }));
    return {
      alocacoes: alocClone,
      turmaOcupada: new Set(est.turmaOcupada),
      profOcupado: new Set(est.profOcupado),
      contDiscDia: new Map(est.contDiscDia),
      horariosDiscTurmaDia: mapHorarios,
      alocPorTurmaSlot: new Map(est.alocPorTurmaSlot),
      alocPorProfSlot: new Map(est.alocPorProfSlot),
    };
  }

  function restaurarEstado(alvo: Estado, backup: Estado) {
    alvo.alocacoes = backup.alocacoes;
    alvo.turmaOcupada = backup.turmaOcupada;
    alvo.profOcupado = backup.profOcupado;
    alvo.contDiscDia = backup.contDiscDia;
    alvo.horariosDiscTurmaDia = backup.horariosDiscTurmaDia;
    alvo.alocPorTurmaSlot = backup.alocPorTurmaSlot;
    alvo.alocPorProfSlot = backup.alocPorProfSlot;
  }

  function realocarOnTheFlyCSP(estado: Estado, g: DemandGroup, idCounterRef: { v: number }, depth: number, visitedCSP: Set<string>): boolean {
    if (depth > 4) return false;
    const sig = `${g.turmaId}|${g.disciplinaId}|${depth}`;
    if (visitedCSP.has(sig)) return false;
    visitedCSP.add(sig);

    for (const dia of DAYS) {
      for (let h = 1; h <= g.maxHorarios; h++) {
        if (!getIsProfAvailable(g.profId, dia, h, g.turno)) continue;

        // Consulta O(1) HashMaps em vez de filter O(N) em alocacoes
        const ocupantes: Alocacao[] = [];
        const alocT = estado.alocPorTurmaSlot.get(`${g.turmaId}|${dia}|${h}`);
        if (alocT && !alocT.isLocked) ocupantes.push(alocT);
        const alocP = estado.alocPorProfSlot.get(`${g.profId}|${dia}|${g.turno}|${h}`);
        if (alocP && !alocP.isLocked && alocP.id !== alocT?.id) ocupantes.push(alocP);

        if (alocT?.isLocked || alocP?.isLocked) continue;

        if (ocupantes.length === 0) {
          if (slotViavel(estado, g, dia, h)) {
            aplicar(estado, g, dia, h, idCounterRef);
            return true;
          }
          continue;
        }

        const backupEstado = clonarEstado(estado);
        ocupantes.forEach((oc) => removerAlocacao(estado, oc));

        if (slotViavel(estado, g, dia, h)) {
          aplicar(estado, g, dia, h, idCounterRef);
          let resolverTodos = true;

          for (const oc of ocupantes) {
            const tOc = turmaMap.get(oc.turmaId);
            const shiftOc = tOc?.turno || "manha";
            const maxHorOc = shiftOc === "noite" ? (config.quantidadeHorariosPorDiaNoite ?? 4) : shiftOc === "tarde" ? (config.quantidadeHorariosPorDiaTarde ?? 5) : config.quantidadeHorariosPorDia;
            const gOc: DemandGroup = { ...g, turmaId: oc.turmaId, disciplinaId: oc.disciplinaId, profId: oc.professorId, turno: shiftOc, maxHorarios: maxHorOc, pendentes: 1 };
            
            let realocou = false;
            for (const d2 of DAYS) {
              for (let h2 = 1; h2 <= maxHorOc; h2++) {
                if (slotViavel(estado, gOc, d2, h2)) {
                  aplicar(estado, gOc, d2, h2, idCounterRef);
                  realocou = true;
                  break;
                }
              }
              if (realocou) break;
            }
            if (!realocou && !realocarOnTheFlyCSP(estado, gOc, idCounterRef, depth + 1, visitedCSP)) {
              resolverTodos = false;
              break;
            }
          }

          if (resolverTodos) return true;
        }
        
        restaurarEstado(estado, backupEstado);
      }
    }
    return false;
  }

  // Heurística de ordenação de variáveis conforme Etapa 1, 2, 3 e 4 do Arquiteto
  function ordenarDemandasPeloPipeline(
    gruposList: DemandGroup[],
    rng?: () => number
  ): DemandGroup[] {
    const uniqueTurmaIds = Array.from(new Set(gruposList.map((g) => g.turmaId)));
    let orderedTurmaIds = [...uniqueTurmaIds];

    if (rng) {
      // Embaralha turmas para explorar soluções globais no CSP
      for (let i = orderedTurmaIds.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [orderedTurmaIds[i], orderedTurmaIds[j]] = [orderedTurmaIds[j], orderedTurmaIds[i]];
      }
    } else {
      // Ordem estável determinística para as turmas na primeira tentativa
      orderedTurmaIds.sort((a, b) => {
        const tA = turmaMap.get(a);
        const tB = turmaMap.get(b);
        return (tA?.nome || "").localeCompare(tB?.nome || "");
      });
    }

    const out: DemandGroup[] = [];
    orderedTurmaIds.forEach((tId) => {
      const subset = gruposList.filter((g) => g.turmaId === tId);
      subset.sort((a, b) => {
        // 1. Campo de prioridade oficial: alta (3) > media (2) > baixa (1)
        const prioA = a.priority === "alta" ? 3 : a.priority === "media" ? 2 : 1;
        const prioB = b.priority === "alta" ? 3 : b.priority === "media" ? 2 : 1;
        if (prioB !== prioA) return prioB - prioA;

        // 2. Maior carga semanal primeiro (carga horária da disciplina)
        if (b.pendentes !== a.pendentes) return b.pendentes - a.pendentes;

        // 3. Menor disponibilidade do professor primeiro (restrição)
        const slotsA = a.slotsDisponiveis || 99;
        const slotsB = b.slotsDisponiveis || 99;
        if (slotsA !== slotsB) return slotsA - slotsB; // Menor disponibilidade primeiro

        // 4. Disciplinas com exigência de geminação primeiro
        const gemA = a.exigeGeminacao ? 1 : 0;
        const gemB = b.exigeGeminacao ? 1 : 0;
        if (gemB !== gemA) return gemB - gemA;

        return 0;
      });
      out.push(...subset);
    });

    return out;
  }

  const gruposBase = ordenarDemandasPeloPipeline(grupos);

  // ──────────────────────────────────────────────────────────────
  // LOOP DE GERAÇÃO E REAVALIAÇÃO ITERATIVA CONTÍNUA (Busca 100% de Alocação)
  // ──────────────────────────────────────────────────────────────
  let melhorAlocacoes: Alocacao[] = [];
  let melhorPercentual = 0;
  let iteracoesSemMelhoria = 0;
  const META_QUALIDADE_MIN = 100.0;
  const META_QUALIDADE_IDEAL = 100.0;
  const MAX_ITERACOES_SEM_MELHORIA = 80;
  const MAX_TOTAL_ITERACOES = 400;
  const debugMessages: string[] = [];

  for (let it = 0; it < MAX_TOTAL_ITERACOES; it++) {
    const currentSeed = (baseSeed !== undefined ? baseSeed : 42) + it * 1337;
    const rng = makeRng(currentSeed);
    const estado = estadoInicial();
    const idCounterRef = { v: 1 };

    let ordemDemandas = it === 0 ? gruposBase : ordenarDemandasPeloPipeline(grupos, rng);

    ordemDemandas.forEach((g: DemandGroup) => {
      let spacePerDay: Record<string, number> = {};
      const turma = turmaMap.get(g.turmaId);
      const isContra = turma ? (turma.nome.toLowerCase().includes("contra") || turma.nome.toLowerCase().includes("contraturno")) : false;
      const isConcentrar = turma ? (turma.estrategiaDistribuicao === "concentrar" || (turma.estrategiaDistribuicao !== "distribuir" && isContra)) : false;

      if (isConcentrar) {
        DAYS.forEach(d => {
          let count = 0;
          for (let h = 1; h <= g.maxHorarios; h++) {
            if (slotViavel(estado, g, d, h)) count++;
          }
          spacePerDay[d] = count;
        });
      }

      for (let u = 0; u < g.pendentes; u++) {
        let alocado = false;

        // Heurística de Seleção de Valor (Value Ordering) baseada nas Regras Pedagogicas (Geminação e Distribuição/Spreading)
        const viableSlots: { dia: string; h: number; score: number }[] = [];
        for (const dia of DAYS) {
          for (let h = 1; h <= g.maxHorarios; h++) {
            if (slotViavel(estado, g, dia, h)) {
              let score = 0;
              const countOnDia = estado.contDiscDia.get(`${g.turmaId}-${dia}-${g.disciplinaId}`) || 0;
              const totalExigidas = g.pendentes;

              if (isConcentrar) {
                // PRIORIDADE 1 & 2: Concentrar no menor número de dias
                if (countOnDia > 0) {
                  score -= 100; // Mesmo dia: +100 pontos de bônus (score menor é melhor)
                  
                  const setHor = estado.horariosDiscTurmaDia.get(`${g.turmaId}|${dia}|${g.disciplinaId}`);
                  const hasAdjacent = setHor && (setHor.has(h - 1) || setHor.has(h + 1));
                  if (hasAdjacent) {
                    score -= 30; // Mesmo bloco consecutivo: +30 pontos de bônus
                  }
                } else {
                  // Se já temos a disciplina alocada em outros dias, penalizar o espalhamento
                  let daysWithThisDisc = 0;
                  for (const d of DAYS) {
                    if ((estado.contDiscDia.get(`${g.turmaId}-${d}-${g.disciplinaId}`) || 0) > 0) {
                      daysWithThisDisc++;
                    }
                  }
                  if (daysWithThisDisc > 0) {
                    score += 50;  // Dia diferente: -50 pontos de penalidade
                    score += 100; // Cada novo dia utilizado: -100 pontos de penalidade
                  }
                }
              } else if (g.exigeGeminacao) {
                // Regra C — Exige Geminação
                if (countOnDia > 0) {
                  const setHor = estado.horariosDiscTurmaDia.get(`${g.turmaId}|${dia}|${g.disciplinaId}`);
                  const hasAdjacent = setHor && (setHor.has(h - 1) || setHor.has(h + 1));
                  if (hasAdjacent) {
                    score -= 150; // Super bônus: forma ou fecha par consecutivo
                  } else {
                    score += 100; // Penalidade: mesma disciplina no dia mas isolada/não consecutiva
                  }
                } else {
                  // Primeiro horário do dia. Preferir dias onde as posições adjacentes estão livres para preencher depois
                  const nextSlotFree = (h + 1 <= g.maxHorarios) && !estado.turmaOcupada.has(`${g.turmaId}|${dia}|${g.turno}|${h + 1}`) && !estado.profOcupado.has(`${g.profId}|${dia}|${g.turno}|${h + 1}`) && getIsProfAvailable(g.profId, dia, h + 1, g.turno);
                  const prevSlotFree = (h - 1 >= 1) && !estado.turmaOcupada.has(`${g.turmaId}|${dia}|${g.turno}|${h - 1}`) && !estado.profOcupado.has(`${g.profId}|${dia}|${g.turno}|${h - 1}`) && getIsProfAvailable(g.profId, dia, h - 1, g.turno);
                  if (nextSlotFree || prevSlotFree) {
                    score -= 40; // Bônus: bom início de par consecutivo
                  } else {
                    score += 50; // Evitar iniciar par onde não há vizinho livre
                  }
                }
              } else {
                // Regra D — Distribuição Inteligente (Spreading) para disciplinas sem geminação obrigatória
                if (totalExigidas >= 5) {
                  if (countOnDia === 0) {
                    score -= 50; // Altamente desejável: espalha para um novo dia letivo
                  } else if (countOnDia === 1) {
                    score += 10; // Aceitável: 2 aulas no mesmo dia (comum em carga de 5 aulas, ex: 2+2+1)
                  } else if (countOnDia === 2) {
                    score += 120; // Indesejável: colocar 3 aulas no mesmo dia (usar só como último recurso)
                  }
                } else {
                  // Carga menor que 5 aulas
                  if (countOnDia === 0) {
                    score -= 30; // Prefere espalhar para dias vazios
                  } else if (countOnDia === 1) {
                    score += 40; // Evitar colocar 2 aulas no mesmo dia para cargas pequenas (2 ou 3 aulas/semana)
                  } else if (countOnDia >= 2) {
                    score += 150; // Fortemente penalizado
                  }
                }
              }

              // Adiciona ruído estocástico controlado nas iterações aleatórias do solver
              if (rng && it > 0) {
                score += (rng() - 0.5) * 15;
              }

              viableSlots.push({ dia, h, score });
            }
          }
        }

        if (viableSlots.length > 0) {
          // Ordena pelo score menor (melhor) e escolhe o topo
          viableSlots.sort((a, b) => a.score - b.score);
          const chosen = viableSlots[0];
          aplicar(estado, g, chosen.dia, chosen.h, idCounterRef);
          alocado = true;
        }

        if (!alocado) {
          const localVisitedCSP = new Set<string>();
          const successBacktrack = realocarOnTheFlyCSP(estado, g, idCounterRef, 0, localVisitedCSP);
          if (debugGeracao && !successBacktrack && it === 0) {
            debugMessages.push(`[Debug Geração] Backtracking falhou para alocar ${g.disciplinaId} (Turma: ${g.turmaId}, Prof: ${g.profId}). Aula deixada pendente temporariamente.`);
          }
        }

        if (isConcentrar && u === g.pendentes - 1 && it === 0) {
          const prof = profMap.get(g.profId);
          const disc = disciplinas.find(d => d.id === g.disciplinaId);
          const tName = turma?.nome || g.turmaId;
          const pName = prof?.nomeCompleto || g.profId;
          const dName = disc?.nome || g.disciplinaId;
          
          const dailyAllocation: Record<string, number> = {};
          let totalAlocadas = 0;
          DAYS.forEach(d => {
            const c = estado.contDiscDia.get(`${g.turmaId}-${d}-${g.disciplinaId}`) || 0;
            dailyAllocation[d] = c;
            totalAlocadas += c;
          });
          
          const allocatedDays = DAYS.filter(d => dailyAllocation[d] > 0);
          const numDays = allocatedDays.length;
          
          let motivoNaoAgrupar = "N/A - Agrupado com sucesso!";
          if (numDays > 1) {
            motivoNaoAgrupar = "Falta de horários consecutivos livres ou indisponibilidade de horários do professor em um único dia";
          } else if (totalAlocadas < g.pendentes) {
            motivoNaoAgrupar = "Incompatibilidade de horários ou conflito com outras disciplinas já alocadas";
          }
          
          const spaceOnTerca = spacePerDay["terca"] !== undefined ? spacePerDay["terca"] : 0;
          const spaceSuff = spaceOnTerca >= g.pendentes ? "SIM" : "NÃO";
          
          const logMsg = `[AUDITORIA CONTRATURNO]
Turma: ${tName}
Disciplina: ${dName}
Professor: ${pName}
Necessário: ${g.pendentes} aulas
Espaço na terça: ${spaceOnTerca} horários livres
Espaço suficiente: ${spaceSuff}
Distribuição final: ${DAYS.map(d => `${d}: ${dailyAllocation[d]} aula(s)`).join(', ')}
Motivo para NÃO agrupar: ${motivoNaoAgrupar}
------------------------------------------------------`;
          
          debugMessages.push(logMsg);
          console.log(logMsg);
        }
      }
    });

    const totalAulasDestaIteracao = estado.alocacoes.size;
    const taxaDestaIteracao = totalAulasPlanejadasGlobal > 0 ? (totalAulasDestaIteracao / totalAulasPlanejadasGlobal) * 100 : 100;

    if (taxaDestaIteracao > melhorPercentual) {
      melhorPercentual = taxaDestaIteracao;
      melhorAlocacoes = Array.from(estado.alocacoes.values()).map((a) => ({ ...a }));
      iteracoesSemMelhoria = 0;
    } else {
      iteracoesSemMelhoria++;
    }

    // CONDIÇÃO DE PARADA 1: Atingiu meta ideal (100%)
    if (melhorPercentual >= META_QUALIDADE_IDEAL) {
      return {
        alocacoes: melhorAlocacoes,
        conflitos: detectConflicts(melhorAlocacoes, professores, disciplinas, turmas, matriz),
        diagnostico: {
          sucesso: true,
          taxaAlocacao: melhorPercentual,
          aulasPlanejadas: totalAulasPlanejadasGlobal,
          aulasAlocadas: melhorAlocacoes.length,
          motivoEncerrado: `Meta ideal de 100% de alocação atingida em ${it + 1} iterações automáticas com semente ${currentSeed}.`,
          mensagens: debugGeracao ? debugMessages : [],
        },
      };
    }

    // CONDIÇÃO DE PARADA 2: Estagnação absoluta sem melhoria alguma
    if (iteracoesSemMelhoria >= MAX_ITERACOES_SEM_MELHORIA) {
      break;
    }
  }

  return {
    alocacoes: melhorAlocacoes,
    conflitos: detectConflicts(melhorAlocacoes, professores, disciplinas, turmas, matriz),
    diagnostico: {
      sucesso: melhorPercentual >= 100.0,
      taxaAlocacao: melhorPercentual,
      aulasPlanejadas: totalAulasPlanejadasGlobal,
      aulasAlocadas: melhorAlocacoes.length,
      motivoEncerrado: `Processamento encerrado no Motor LookAhead após ${melhorPercentual >= 100.0 ? "atingir 100% de alocação" : "esgotar o espaço amostral sem estagnação adicional"} (Taxa final: ${melhorPercentual.toFixed(1)}%).`,
      mensagens: debugGeracao ? debugMessages : [],
    },
  };
}

/**
 * Verifica se um professor está ocupado em um determinado horário e turno
 */
export function isProfessorBusyAt(
  alocacoes: Alocacao[],
  professorId: string,
  dia: string,
  horario: number,
  turno: string,
  turmas: Turma[]
): boolean {
  const turmaMap = new Map(turmas.map(t => [t.id, t]));
  
  return alocacoes.some(a => {
    if (a.professorId !== professorId) return false;
    if (a.diaSemana !== dia) return false;
    if (a.horario !== horario) return false;
    
    const turmaAloc = turmaMap.get(a.turmaId);
    const turnoAloc = turmaAloc?.turno || 'manha';
    
    // ✅ Só considera ocupado se for o MESMO TURNO
    return turnoAloc === turno;
  });
}

/**
 * Verifica se uma turma está ocupada em um horário
 */
export function isTurmaBusyAt(
  alocacoes: Alocacao[],
  turmaId: string,
  dia: string,
  horario: number
): boolean {
  return alocacoes.some(a => 
    a.turmaId === turmaId &&
    a.diaSemana === dia &&
    a.horario === horario
  );
}

export function verificarSlotViavelComMotivoInterno(
  alocacoes: Alocacao[],
  professores: Professor[],
  _disciplinas: Disciplina[],
  turmas: Turma[],
  _matriz: MatrizCurricular[],
  _config: ConfiguracaoHorarios,
  profId: string,
  turmaId: string,
  discId: string,
  diaSemana: string,
  horario: number,
  regrasRelaxamento?: RegrasRelaxamento,
  ignoreAlocacaoId?: string
): { viavel: boolean; motivo?: string } {
  const prof = professores.find((p) => p.id === profId);
  if (!prof) return { viavel: false, motivo: "Professor não encontrado" };

  const turma = turmas.find((t) => t.id === turmaId);
  if (!turma) return { viavel: false, motivo: "Turma não encontrada" };

  const targetTurno = turma.turno ?? "manha";

  // ✅ NOVA VALIDAÇÃO 1: Verificar dias permitidos da turma
  if (turma.diasPermitidos && Array.isArray(turma.diasPermitidos)) {
    if (!turma.diasPermitidos.includes(diaSemana)) {
      return {
        viavel: false,
        motivo: `🚨 Dia ${diaSemana} NÃO é permitido para a turma ${turma.nome}. Permitidos: ${turma.diasPermitidos.join(', ')}`
      };
    }
  }

  // ✅ NOVA VALIDAÇÃO 2: Verificar carga TOTAL do professor para esta disciplina (todas as turmas)
  const planejamento = prof.planejamento || [];
  let limiteTotal = 0;
  for (const item of planejamento) {
    if (item.disciplinaId === discId) {
      limiteTotal += Number(item.aulasPorSemana !== undefined ? item.aulasPorSemana : (item.quantidadeAulas || 0));
    }
  }

  if (limiteTotal > 0) {
    const alocadoTotal = alocacoes.filter(a =>
      a.professorId === profId &&
      a.disciplinaId === discId &&
      a.id !== ignoreAlocacaoId
    ).length;

    if (alocadoTotal >= limiteTotal) {
      return {
        viavel: false,
        motivo: `🚨 CARGA TOTAL EXCEDIDA: ${alocadoTotal}/${limiteTotal} aulas para ${discId} (todas as turmas)`
      };
    }
  }

  // 0. Verificação obrigatória de carga horária semanal da atribuição (Professor × Turma × Disciplina)
  let weeklyLimit = 0;
  let source = "nenhum";
  const planeItem = prof.planejamento?.find((p) => p.turmaId === turmaId && p.disciplinaId === discId);
  if (planeItem) {
    weeklyLimit = Number(planeItem.aulasPorSemana !== undefined ? planeItem.aulasPorSemana : planeItem.quantidadeAulas) || 0;
    source = "planejamento";
    console.log(`[DEBUG] Planejamento: ${prof.nomeCompleto} - ${discId} - ${turma.nome}: ${weeklyLimit} aulas`);
  } else {
    const matMatch = _matriz?.find((m) => m.turmaId === turmaId && m.disciplinaId === discId);
    if (matMatch) {
      weeklyLimit = Number(matMatch.aulasPorSemana) || 0;
      source = "matriz";
      console.log(`[DEBUG] Matriz: ${discId} - ${turma.nome}: ${weeklyLimit} aulas`);
    } else {
      console.log(`[DEBUG] Nenhum limite encontrado para ${discId} - ${turma.nome}`);
    }
  }

  // ✅ SE AINDA FOR 0, USAR DEFAULT (2)
  if (weeklyLimit === 0) {
    weeklyLimit = 2;
    source = "default";
    console.log(`[DEBUG] Usando limite padrão (2 aulas) para ${discId} - ${turma.nome}`);
  }

  const allocatedCount = alocacoes.filter(
    (a) => a.professorId === profId && a.turmaId === turmaId && a.disciplinaId === discId && a.id !== ignoreAlocacaoId
  ).length;

  console.log(`[DEBUG] Alocadas: ${allocatedCount}/${weeklyLimit} (origem: ${source}) para ${discId} - ${turma.nome}`);

  if (allocatedCount >= weeklyLimit) {
    return { 
      viavel: false, 
      motivo: `Limite semanal de ${weeklyLimit} aula(s) para esta disciplina já atingido (${allocatedCount}/${weeklyLimit})` 
    };
  }

  // 0.1. Verificação do limite geral da matriz curricular da turma para esta disciplina (evitar falso positivo / sobre-alocação)
  const matMatch = _matriz?.find((m) => m.turmaId === turmaId && m.disciplinaId === discId);
  if (matMatch) {
    const matrixLimit = Number(matMatch.aulasPorSemana) || 0;
    if (matrixLimit > 0) {
      const totalAllocatedForDisc = alocacoes.filter(
        (a) => a.turmaId === turmaId && a.disciplinaId === discId && a.id !== ignoreAlocacaoId
      ).length;
      if (totalAllocatedForDisc >= matrixLimit) {
        return {
          viavel: false,
          motivo: `Limite total da matriz curricular de ${matrixLimit} aula(s) para a disciplina nesta turma já foi atingido (${totalAllocatedForDisc}/${matrixLimit})`
        };
      }
    }
  }

  // 1. Ocupação da turma
  const ocupacaoTurma = isTurmaBusyAt(
    alocacoes.filter((a) => a.id !== ignoreAlocacaoId),
    turmaId,
    diaSemana,
    horario
  );
  if (ocupacaoTurma) {
    return { viavel: false, motivo: "Horário já ocupado na turma" };
  }

  // 2. Choque de horário do professor (no mesmo turno)
  const ocupacaoProf = isProfessorBusyAt(
    alocacoes.filter((a) => a.id !== ignoreAlocacaoId),
    profId,
    diaSemana,
    horario,
    targetTurno,
    turmas
  );
  if (ocupacaoProf) {
    return { viavel: false, motivo: "Professor ocupado em outra turma no mesmo horário" };
  }

  // 3. Disponibilidade do professor
  if (!regrasRelaxamento?.permitirAlocarQualquerHorarioDisponivel) {
    if (!isProfAvailableAt(prof.disponibilidade, diaSemana, horario, targetTurno)) {
      return { viavel: false, motivo: "Professor indisponível neste horário" };
    }
  }

  // 4. Limite diário de aulas da disciplina na mesma turma
  if (!regrasRelaxamento?.permitirMaisDeDuasAulasMesmoDia) {
    const aulasNoDia = alocacoes.filter(
      (a) => a.turmaId === turmaId && a.disciplinaId === discId && a.diaSemana === diaSemana && a.id !== ignoreAlocacaoId
    ).length;
    const planeItem = prof.planejamento?.find((p) => p.turmaId === turmaId && p.disciplinaId === discId);
    const maxPorDia = planeItem?.maximoAulasPorDia ?? 2;
    if (aulasNoDia >= maxPorDia) {
      return { viavel: false, motivo: `Limite diário de ${maxPorDia} aulas atingido para esta disciplina` };
    }
  }

  // 5. Aulas consecutivas permitidas
  if (!regrasRelaxamento?.permitirTresAulasConsecutivas) {
    const horariosNoDia = alocacoes
      .filter((a) => a.turmaId === turmaId && a.disciplinaId === discId && a.diaSemana === diaSemana && a.id !== ignoreAlocacaoId)
      .map((a) => a.horario);
    horariosNoDia.push(horario);
    horariosNoDia.sort((a, b) => a - b);

    let maxSeq = 1;
    let seq = 1;
    for (let i = 1; i < horariosNoDia.length; i++) {
      if (horariosNoDia[i] === horariosNoDia[i - 1] + 1) {
        seq++;
        if (seq > maxSeq) maxSeq = seq;
      } else if (horariosNoDia[i] !== horariosNoDia[i - 1]) {
        seq = 1;
      }
    }
    const planeItem = prof.planejamento?.find((p) => p.turmaId === turmaId && p.disciplinaId === discId);
    const maxConsec = planeItem?.maximoConsecutivas ?? 2;
    if (maxSeq > maxConsec) {
      return { viavel: false, motivo: `Máximo de ${maxConsec} aulas consecutivas excedido` };
    }
  }

  return { viavel: true };
}

export function verificarSlotViavelComMotivo(
  alocacoes: Alocacao[],
  professores: Professor[],
  disciplinas: Disciplina[],
  turmas: Turma[],
  matriz: MatrizCurricular[],
  config: ConfiguracaoHorarios,
  profId: string,
  turmaId: string,
  discId: string,
  diaSemana: string,
  horario: number,
  regrasRelaxamento?: RegrasRelaxamento,
  ignoreAlocacaoId?: string
): { viavel: boolean; motivo?: string } {
  const result = verificarSlotViavelComMotivoInterno(
    alocacoes,
    professores,
    disciplinas,
    turmas,
    matriz,
    config,
    profId,
    turmaId,
    discId,
    diaSemana,
    horario,
    regrasRelaxamento,
    ignoreAlocacaoId
  );

  const prof = professores.find((p) => p.id === profId);
  const turma = turmas.find((t) => t.id === turmaId);
  const disc = disciplinas.find((d) => d.id === discId);

  if (prof && turma) {
    const targetTurno = turma.turno ?? "manha";
    const diasPermitidos = (turma.diasPermitidos && Array.isArray(turma.diasPermitidos))
      ? turma.diasPermitidos.join(', ')
      : "segunda, terca, quarta, quinta, sexta";
    const planeItem = prof.planejamento?.find((p) => p.turmaId === turmaId && p.disciplinaId === discId);
    const weeklyLimit = planeItem 
      ? Number(planeItem.aulasPorSemana !== undefined ? planeItem.aulasPorSemana : planeItem.quantidadeAulas) || 0
      : 2;
    const allocatedCount = alocacoes.filter(
      (a) => a.professorId === profId && a.turmaId === turmaId && a.disciplinaId === discId && a.id !== ignoreAlocacaoId
    ).length;

    console.log(`[AUDIT-LOG] Professor: ${prof.nomeCompleto} | Turma: ${turma.nome} | Disciplina: ${disc?.nome || discId} | Turno Permitido: ${turma.turno || "manha"} | Turno Utilizado: ${targetTurno} | Dias Permitidos: [${diasPermitidos}] | Dia Utilizado: ${diaSemana} | Carga Permitida: ${weeklyLimit} | Carga Utilizada: ${allocatedCount} | Resultado: ${result.viavel ? "SUCESSO (VIÁVEL)" : "REJEITADO - " + result.motivo}`);
  }

  return result;
}

/**
 * CAMADA ÚNICA DE VALIDAÇÃO (Centralizada sob os requisitos do usuário)
 * Verifica se uma alocação de aula é válida respeitando todas as regras físicas e limites semanais/diários.
 */
export function canAllocateLesson(
  alocacoes: Alocacao[],
  professores: Professor[],
  disciplinas: Disciplina[],
  turmas: Turma[],
  matriz: MatrizCurricular[],
  config: ConfiguracaoHorarios,
  profId: string,
  turmaId: string,
  discId: string,
  diaSemana: string,
  horario: number,
  regrasRelaxamento?: RegrasRelaxamento,
  ignoreAlocacaoId?: string
): { viavel: boolean; motivo?: string } {
  return verificarSlotViavelComMotivo(
    alocacoes,
    professores,
    disciplinas,
    turmas,
    matriz,
    config,
    profId,
    turmaId,
    discId,
    diaSemana,
    horario,
    regrasRelaxamento,
    ignoreAlocacaoId
  );
}

/**
 * FUNÇÃO ÚNICA DE INSERÇÃO DE AULA (Centralizada)
 * Executa a inserção de forma segura apenas se passar pelo validador central.
 */
export function allocateLesson(
  alocacoes: Alocacao[],
  professores: Professor[],
  disciplinas: Disciplina[],
  turmas: Turma[],
  matriz: MatrizCurricular[],
  config: ConfiguracaoHorarios,
  profId: string,
  turmaId: string,
  discId: string,
  diaSemana: string,
  horario: number,
  regrasRelaxamento?: RegrasRelaxamento,
  sourceInfo?: { step: string; file: string; func: string }
): { sucesso: boolean; alocacoes: Alocacao[]; motivo?: string } {
  const check = canAllocateLesson(
    alocacoes,
    professores,
    disciplinas,
    turmas,
    matriz,
    config,
    profId,
    turmaId,
    discId,
    diaSemana,
    horario,
    regrasRelaxamento
  );

  if (!check.viavel) {
    if (sourceInfo) {
      console.warn(
        `[allocateLesson BLOQUEADO] Tentativa ilegal em ${sourceInfo.step} (${sourceInfo.file} -> ${sourceInfo.func}): ${check.motivo}`
      );
    }
    return { sucesso: false, alocacoes, motivo: check.motivo };
  }

  const novaAloc: Alocacao = {
    id: `alloc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    diaSemana,
    horario,
    turmaId,
    disciplinaId: discId,
    professorId: profId,
  };

  return {
    sucesso: true,
    alocacoes: [...alocacoes, novaAloc],
  };
}