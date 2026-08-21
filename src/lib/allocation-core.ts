/**
 * allocation-core.ts
 * ──────────────────────────────────────────────────────────────
 * Camada Central de Alocação (Allocation Core)
 * Responsável por toda validação, indexação e alteração da grade.
 * Garante que nenhuma parte do sistema ou motor de otimização
 * modifique a grade sem passar por esta API padronizada.
 */

import type {
  Alocacao,
  Turma,
  Professor,
  Disciplina,
  MatrizCurricular,
  ConfiguracaoHorarios,
  Conflito,
} from "@/types";

import {
  ensureProfessoresPlanejamento,
  isProfAvailableAt,
  DAYS,
  DAY_NAMES,
  verificarSlotViavelComMotivo,
  isProfessorBusyAt,
  detectConflicts,
} from "./schedule-utils";

import {
  calcularScore,
  contarBuracosTurma,
  contarJanelasProfessor,
  contarGeminacoes,
  gradeValida,
} from "./score-utils";

import { validarAlocacao } from "./audit-engine";

// ──────────────────────────────────────────────────────────────
// REGRAS PEDAGÓGICAS — defaults, distribuição semanal e turno
// ──────────────────────────────────────────────────────────────

export type PrioridadeNivel = "alta" | "media" | "baixa";

export interface LimitesPedagogicos {
  maxDia: number;
  maxConsec: number;
  exigeGeminacao: boolean;
  prioridade: PrioridadeNivel;
}

export function prioridadePeso(p: PrioridadeNivel | string | undefined): number {
  if (p === "alta") return 3;
  if (p === "baixa") return 1;
  return 2;
}

/** Defaults pedagógicos quando o usuário não preenche os campos do planejamento. */
export function getLimitesPedagogicos(
  planeItem:
    | {
        maximoAulasPorDia?: number | null;
        maximoConsecutivas?: number | null;
        exigeGeminacao?: boolean;
        prioridade?: string;
      }
    | null
    | undefined,
  weeklyHours: number,
): LimitesPedagogicos {
  let maxDia = planeItem?.maximoAulasPorDia;
  if (maxDia === undefined || maxDia === null) {
    maxDia = weeklyHours >= 5 ? 3 : 2;
  }
  return {
    maxDia,
    maxConsec: planeItem?.maximoConsecutivas ?? 2,
    exigeGeminacao: planeItem?.exigeGeminacao ?? false,
    prioridade: (planeItem?.prioridade as PrioridadeNivel) ?? "media",
  };
}

/**
 * Plano semanal de distribuição.
 * Regra 2 (preferida): 2+2+1 para 5 aulas.
 * Regra 1 (fallback): 3+2 quando maxDia >= 3.
 */
export function computeWeeklyDistributionPlan(
  weeklyHours: number,
  maxDia: number,
  exigeGeminacao = false,
): Record<string, number> {
  const plan: Record<string, number> = {
    segunda: 0,
    terca: 0,
    quarta: 0,
    quinta: 0,
    sexta: 0,
  };
  if (weeklyHours <= 0) return plan;

  if (weeklyHours === 5 && maxDia >= 2 && !exigeGeminacao) {
    plan.segunda = 2;
    plan.terca = 2;
    plan.quarta = 1;
    return plan;
  }

  if (weeklyHours === 5 && maxDia >= 3) {
    plan.segunda = 3;
    plan.terca = 2;
    return plan;
  }

  let remaining = weeklyHours;
  for (const dia of DAYS) {
    if (remaining <= 0) break;
    const toPlace = Math.min(maxDia, remaining);
    plan[dia] = toPlace;
    remaining -= toPlace;
  }
  return plan;
}

export function getSlotsPerDay(turno: string, config: ConfiguracaoHorarios): number {
  if (turno === "noite") return config.quantidadeHorariosPorDiaNoite ?? 4;
  if (turno === "tarde") return config.quantidadeHorariosPorDiaTarde ?? 5;
  return config.quantidadeHorariosPorDia ?? 5;
}

/** Verifica ocupação do professor no mesmo turno (matutino ≠ vespertino). */
export function isProfessorBusyAtTurno(
  alocacoes: Alocacao[],
  professorId: string,
  dia: string,
  horario: number,
  turno: string,
  turmas: Turma[],
): boolean {
  const turmaMap = new Map(turmas.map((t) => [t.id, t]));
  return alocacoes.some((a) => {
    if (a.professorId !== professorId || a.diaSemana !== dia || a.horario !== horario) return false;
    const aTurno = turmaMap.get(a.turmaId)?.turno || "manha";
    return aTurno === turno;
  });
}

export function scoreDistribuicaoSemanal(
  alocacoes: Alocacao[],
  turmaId: string,
  disciplinaId: string,
  weeklyHours: number,
): number {
  const planIdeal = computeWeeklyDistributionPlan(weeklyHours, weeklyHours >= 5 ? 3 : 2, false);
  let score = 0;
  for (const dia of DAYS) {
    const count = alocacoes.filter(
      (a) => a.turmaId === turmaId && a.disciplinaId === disciplinaId && a.diaSemana === dia,
    ).length;
    if (count === planIdeal[dia]) score += 20;
    else if (Math.abs(count - planIdeal[dia]) === 1) score += 5;
  }
  return score;
}

/** Escolhe horários preferenciais respeitando geminação e Regra 1 (último horário). */
export function escolherHorariosPreferenciais(
  n: number,
  slotsPerDay: number,
  horariosJaUsados: number[],
  exigeGeminacao: boolean,
  ultimoHorario = false,
): number[] {
  const usados = new Set(horariosJaUsados);
  const livres: number[] = [];
  for (let h = 1; h <= slotsPerDay; h++) {
    if (!usados.has(h)) livres.push(h);
  }
  if (livres.length < n) return [];

  if (ultimoHorario && n === 1 && livres.includes(slotsPerDay)) {
    return [slotsPerDay];
  }

  if (exigeGeminacao && n >= 2) {
    for (let h = 1; h < slotsPerDay; h++) {
      if (livres.includes(h) && livres.includes(h + 1)) {
        const bloco = [h, h + 1];
        for (const x of livres) {
          if (bloco.length >= n) break;
          if (!bloco.includes(x)) bloco.push(x);
        }
        return bloco.slice(0, n).sort((a, b) => a - b);
      }
    }
  }

  if (n === 3 && ultimoHorario && livres.includes(slotsPerDay)) {
    const escolhidos = [slotsPerDay];
    for (let h = 1; h < slotsPerDay - 1; h++) {
      if (livres.includes(h) && livres.includes(h + 1)) {
        escolhidos.unshift(h, h + 1);
        break;
      }
    }
    if (escolhidos.length >= 3) return escolhidos.slice(0, 3).sort((a, b) => a - b);
  }

  for (let start = 1; start <= slotsPerDay; start++) {
    const bloco: number[] = [];
    for (let h = start; h <= slotsPerDay && bloco.length < n; h++) {
      if (livres.includes(h)) bloco.push(h);
      else if (bloco.length > 0) break;
    }
    if (bloco.length >= n) return bloco.slice(0, n);
  }

  return livres.slice(0, n);
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
  prioridade: PrioridadeNivel,
  turno: string,
  slotsPerDay: number,
  disponibilidade?: Record<string, any>
): DistribuicaoSemanal[] {
  const dias = ['segunda', 'terca', 'quarta', 'quinta', 'sexta'];
  
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
    const d1 = diasPreferidos[0] || 'segunda';
    const d2 = diasPreferidos[1] || 'terca';
    const d3 = diasPreferidos[2] || 'quarta';
    return [
      { dia: d1, qtdAulas: 2, horarios: [1, 2] },
      { dia: d2, qtdAulas: 2, horarios: [1, 2] },
      { dia: d3, qtdAulas: 1, horarios: [1] },
    ];
  }
  
  // CASO 2: 5 aulas semanais - REGRA 1 (3+2) - ALTERNATIVA
  if (weeklyHours === 5 && maxDia >= 3) {
    const d1 = diasPreferidos[0] || 'segunda';
    const d2 = diasPreferidos[1] || 'terca';
    return [
      { dia: d1, qtdAulas: 3, horarios: [1, 2, 3] },
      { dia: d2, qtdAulas: 2, horarios: [1, 2] },
    ];
  }
  
  // CASO 3: 5 aulas com geminação exigida (2+2+1)
  if (weeklyHours === 5 && exigeGeminacao) {
    const d1 = diasPreferidos[0] || 'segunda';
    const d2 = diasPreferidos[1] || 'terca';
    const d3 = diasPreferidos[2] || 'quarta';
    return [
      { dia: d1, qtdAulas: 2, horarios: [1, 2] },
      { dia: d2, qtdAulas: 2, horarios: [1, 2] },
      { dia: d3, qtdAulas: 1, horarios: [1] },
    ];
  }
  
  // CASO 4: 4 aulas semanais - 2+2
  if (weeklyHours === 4 && maxDia >= 2) {
    const d1 = diasPreferidos[0] || 'segunda';
    const d2 = diasPreferidos[1] || 'terca';
    return [
      { dia: d1, qtdAulas: 2, horarios: [1, 2] },
      { dia: d2, qtdAulas: 2, horarios: [1, 2] },
    ];
  }
  
  // CASO 5: 3 aulas semanais - 2+1
  if (weeklyHours === 3 && maxDia >= 2) {
    const d1 = diasPreferidos[0] || 'segunda';
    const d2 = diasPreferidos[1] || 'terca';
    return [
      { dia: d1, qtdAulas: 2, horarios: [1, 2] },
      { dia: d2, qtdAulas: 1, horarios: [1] },
    ];
  }
  
  // CASO 6: 2 aulas semanais - 2
  if (weeklyHours === 2 && maxDia >= 2) {
    const d1 = diasPreferidos[0] || 'segunda';
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
  const dias = ['segunda', 'terca', 'quarta', 'quinta', 'sexta'];

  const items = Array.isArray(professor.planejamento) ? professor.planejamento : [];
  if (items.length === 0) {
    logs.push(`⚠️ Professor ${professor.nomeCompleto} não possui disciplinas vinculadas no planejamento.`);
    return { alocacoes: [], logs };
  }

  logs.push(`\nIniciando alocação para o Professor: ${professor.nomeCompleto}`);

  // Verificar carga máxima do professor
  const totalPlanejadoProfessor = items.reduce((acc, p) => acc + (Number(p.aulasPorSemana !== undefined ? p.aulasPorSemana : p.quantidadeAulas) || 0), 0);
  const cargaAtualProfessor = alocacoesExistentes.filter(a => a.professorId === professor.id).length;
  let cargaMaximaProfessor = professor.cargaHorariaMaximaSemanal || 0;

  // Se o total planejado pelo usuário excede a carga máxima do professor, ajustar automaticamente para permitir alocar tudo o que foi planejado
  if (cargaMaximaProfessor > 0 && totalPlanejadoProfessor > cargaMaximaProfessor) {
    logs.push(`ℹ️ Ajustando limite de carga máxima do Professor ${professor.nomeCompleto} de ${cargaMaximaProfessor}h para ${totalPlanejadoProfessor}h para acomodar o Planejamento de Atribuição.`);
    cargaMaximaProfessor = totalPlanejadoProfessor;
  }

  if (cargaMaximaProfessor > 0 && cargaAtualProfessor >= cargaMaximaProfessor) {
    logs.push(`⚠️ Professor ${professor.nomeCompleto} atingiu carga máxima (${cargaMaximaProfessor}h)`);
    return { alocacoes: [], logs };
  }

  // 1. Agrupar e ordenar as disciplinas atribuídas ao professor por prioridade (Alta primeiro)
  const atribuicoesSorted = [...items].sort((a, b) => {
    const prioA = prioridadePeso(a.prioridade);
    const prioB = prioridadePeso(b.prioridade);
    if (prioB !== prioA) return prioB - prioA; // Prioridade mais alta primeiro
    
    const countA = Number(a.aulasPorSemana !== undefined ? a.aulasPorSemana : a.quantidadeAulas) || 0;
    const countB = Number(b.aulasPorSemana !== undefined ? b.aulasPorSemana : b.quantidadeAulas) || 0;
    return countB - countA; // Maior carga primeiro
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

    const weeklyHours = Number(item.aulasPorSemana !== undefined ? item.aulasPorSemana : item.quantidadeAulas) || 0;
    if (weeklyHours <= 0) continue;

    // ✅ VALIDAÇÃO PRÉVIA - NÃO PERMITIR MAIS QUE O CADASTRO
    const validacao = validarAlocacao(
      professor,
      turma.id,
      disciplina.id,
      [...alocacoesExistentes, ...novasAlocacoes]
    );

    if (!validacao.permitido) {
      logs.push(`  ⚠️ ${disciplina.nome} na turma ${turma.nome} - ${validacao.motivo}`);
      continue;
    }

    const aulasJaAlocadasEstaDisciplina = [...alocacoesExistentes, ...novasAlocacoes].filter(a =>
      a.professorId === professor.id &&
      a.turmaId === turma.id &&
      a.disciplinaId === disciplina.id
    ).length;

    const turno = turma.turno || 'manha';
    const slotsPerDay = getSlotsPerDay(turno, config);
    const { maxDia, maxConsec, exigeGeminacao, prioridade } = getLimitesPedagogicos(item, weeklyHours);

    const diasTurma = (turma.diasPermitidos && Array.isArray(turma.diasPermitidos))
      ? dias.filter(d => turma.diasPermitidos!.includes(d))
      : dias;

    logs.push(`  → Atribuição: ${disciplina.nome} para Turma ${turma.nome} (${weeklyHours} aulas/semana, Turno: ${turno})`);

    // 2. Calcular a distribuição ideal prioritária (Ex: 2+2+1 ou similar)
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

    let alocadasNestaDisciplina = aulasJaAlocadasEstaDisciplina;

    // Ordenar a distribuição proposta por menor ocupação do dia para a turma (best-fit inicial)
    const distribuicaoOrdenada = [...distribuicao].sort((a, b) => {
      const occA = [...alocacoesExistentes, ...novasAlocacoes].filter(al => al.turmaId === turma.id && al.diaSemana === a.dia).length;
      const occB = [...alocacoesExistentes, ...novasAlocacoes].filter(al => al.turmaId === turma.id && al.diaSemana === b.dia).length;
      return occA - occB;
    });

    // 3. Tentar alocar conforme a distribuição proposta ordenada
    for (const dist of distribuicaoOrdenada) {
      // ✅ NOVO: Verificar se a disciplina já atingiu o limite semanal
      if (alocadasNestaDisciplina >= weeklyHours) {
        logs.push(`     ⚠️ Limite semanal de ${weeklyHours} aulas para ${disciplina.nome} atingido.`);
        break;
      }

      if (!diasTurma.includes(dist.dia)) continue;
      
      let horariosAlocadosNoDia = 0;
      const horariosDisponiveis = [...dist.horarios];

      // Tentar os horários preferidos da distribuição
      for (const h of horariosDisponiveis) {
        // ✅ NOVO: Verificar se a disciplina já atingiu o limite semanal
        if (alocadasNestaDisciplina >= weeklyHours) break;
        if (horariosAlocadosNoDia >= dist.qtdAulas) break;

        if (cargaMaximaProfessor > 0 && (cargaAtualProfessor + novasAlocacoes.length) >= cargaMaximaProfessor) {
          logs.push(`     ⚠️ Carga máxima do professor (${cargaMaximaProfessor}h) atingida. Interrompendo alocação.`);
          break;
        }

        // ✅ NOVO: Verificar se o limite diário já foi atingido para esta disciplina
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
          logs.push(`     ⚠️ Slot indisponível: ${dist.dia.toUpperCase()} ${h}º horário - ${check.motivo || 'ocupado'}`);
        }
      }

      // Se não conseguiu alocar todos os horários planejados para o dia, tentar horários alternativos no mesmo dia usando best-fit (menor disputa)
      if (horariosAlocadosNoDia < dist.qtdAulas && alocadasNestaDisciplina < weeklyHours) {
        logs.push(`     🔄 Buscando horários alternativos para ${dist.dia.toUpperCase()} usando estratégia 'best-fit'...`);
        
        const candidatosDia: { horario: number; slotDisputeScore: number }[] = [];
        const todasAlocs = [...alocacoesExistentes, ...novasAlocacoes];
        
        for (let hAlt = 1; hAlt <= slotsPerDay; hAlt++) {
          if (horariosDisponiveis.includes(hAlt)) continue;
          
          // ✅ NOVO: Verificar limite diário
          const aulasHoje = todasAlocs.filter(a =>
            a.professorId === professor.id &&
            a.turmaId === turma.id &&
            a.disciplinaId === disciplina.id &&
            a.diaSemana === dist.dia
          ).length;

          if (aulasHoje >= maxDia) {
            continue;
          }

          const check = verificarSlotViavelComMotivo(
            todasAlocs,
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
            // Contagem de outras alocações do sistema no mesmo dia e horário (disputa)
            const slotDisputeScore = todasAlocs.filter(a => a.diaSemana === dist.dia && a.horario === hAlt).length;
            candidatosDia.push({
              horario: hAlt,
              slotDisputeScore
            });
          }
        }
        
        // Ordenar candidatos do dia por menor disputa de slot
        candidatosDia.sort((a, b) => a.slotDisputeScore - b.slotDisputeScore);
        
        for (const cand of candidatosDia) {
          if (horariosAlocadosNoDia >= dist.qtdAulas) break;
          if (alocadasNestaDisciplina >= weeklyHours) break;
          
          if (cargaMaximaProfessor > 0 && (cargaAtualProfessor + novasAlocacoes.length) >= cargaMaximaProfessor) {
            logs.push(`     ⚠️ Carga máxima do professor (${cargaMaximaProfessor}h) atingida. Interrompendo busca de alternativos.`);
            break;
          }

          // ✅ NOVO: Verificar limite diário
          const aulasHoje = [...alocacoesExistentes, ...novasAlocacoes].filter(a =>
            a.professorId === professor.id &&
            a.turmaId === turma.id &&
            a.disciplinaId === disciplina.id &&
            a.diaSemana === dist.dia
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
            dist.dia,
            cand.horario,
            regrasRelaxamento
          );
          
          if (check.viavel) {
            const novaAlocacao: Alocacao = {
              id: `prof-${professor.id}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
              turmaId: turma.id,
              disciplinaId: disciplina.id,
              professorId: professor.id,
              diaSemana: dist.dia,
              horario: cand.horario,
            };
            novasAlocacoes.push(novaAlocacao);
            horariosAlocadosNoDia++;
            alocadasNestaDisciplina++;
            logs.push(`     ✅ Alocada (best-fit alt): ${dist.dia.toUpperCase()} ${cand.horario}º horário (${alocadasNestaDisciplina}/${weeklyHours}, Disputa: ${cand.slotDisputeScore})`);
          }
        }
      }
    }

    // Se ainda faltarem aulas para fechar a carga horária da disciplina, tentar alocar em qualquer slot disponível na semana usando a estratégia 'best-fit'
    if (alocadasNestaDisciplina < weeklyHours) {
      logs.push(`     🔄 Carga incompleta para ${disciplina.nome} (${alocadasNestaDisciplina}/${weeklyHours}). Buscando slots livres usando estratégia 'best-fit'...`);
      
      const candidatos: { dia: string; horario: number; turmaDayCount: number; slotDisputeScore: number }[] = [];
      const todasAlocs = [...alocacoesExistentes, ...novasAlocacoes];
      
      for (const dAlt of diasTurma) {
        const slotsDAlt = getSlotsPerDay(turno, config);
        for (let hAlt = 1; hAlt <= slotsDAlt; hAlt++) {
          // ✅ NOVO: Verificar limite diário
          const aulasHoje = todasAlocs.filter(a =>
            a.professorId === professor.id &&
            a.turmaId === turma.id &&
            a.disciplinaId === disciplina.id &&
            a.diaSemana === dAlt
          ).length;

          if (aulasHoje >= maxDia) {
            continue;
          }

          const check = verificarSlotViavelComMotivo(
            todasAlocs,
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
            // Ocupação do dia para a turma (queremos distribuir uniformemente ao longo da semana)
            const turmaDayCount = todasAlocs.filter(a => a.turmaId === turma.id && a.diaSemana === dAlt).length;
            // Disputa do slot na escola como um todo
            const slotDisputeScore = todasAlocs.filter(a => a.diaSemana === dAlt && a.horario === hAlt).length;
            
            candidatos.push({
              dia: dAlt,
              horario: hAlt,
              turmaDayCount,
              slotDisputeScore
            });
          }
        }
      }
      
      // Ordenar candidatos pela estratégia Best-Fit:
      // 1. Prioriza dias com menor ocupação de aulas para essa turma
      // 2. Prioriza slots menos disputados no sistema (menor concorrência)
      candidatos.sort((a, b) => {
        if (a.turmaDayCount !== b.turmaDayCount) {
          return a.turmaDayCount - b.turmaDayCount;
        }
        return a.slotDisputeScore - b.slotDisputeScore;
      });
      
      for (const cand of candidatos) {
        if (alocadasNestaDisciplina >= weeklyHours) break;
        
        if (cargaMaximaProfessor > 0 && (cargaAtualProfessor + novasAlocacoes.length) >= cargaMaximaProfessor) {
          logs.push(`     ⚠️ Carga máxima do professor (${cargaMaximaProfessor}h) atingida. Interrompendo busca semanal.`);
          break;
        }

        // ✅ NOVO: Verificar limite diário
        const aulasHoje = [...alocacoesExistentes, ...novasAlocacoes].filter(a =>
          a.professorId === professor.id &&
          a.turmaId === turma.id &&
          a.disciplinaId === disciplina.id &&
          a.diaSemana === cand.dia
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
          cand.dia,
          cand.horario,
          regrasRelaxamento
        );
        
        if (check.viavel) {
          const novaAlocacao: Alocacao = {
            id: `prof-${professor.id}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            turmaId: turma.id,
            disciplinaId: disciplina.id,
            professorId: professor.id,
            diaSemana: cand.dia,
            horario: cand.horario,
          };
          novasAlocacoes.push(novaAlocacao);
          alocadasNestaDisciplina++;
          logs.push(`     ✅ Alocada (best-fit semanal): ${cand.dia.toUpperCase()} ${cand.horario}º horário (${alocadasNestaDisciplina}/${weeklyHours}, Ocupação Dia: ${cand.turmaDayCount}, Disputa: ${cand.slotDisputeScore})`);
        }
      }
    }

    if (alocadasNestaDisciplina < weeklyHours) {
      logs.push(`     ❌ Falha de Alocação: Alocadas apenas ${alocadasNestaDisciplina} de ${weeklyHours} aulas semanais para ${disciplina.nome}.`);
    } else {
      logs.push(`     ✔ Carga completa: ${alocadasNestaDisciplina}/${weeklyHours} aulas alocadas.`);
    }
  }

  return { alocacoes: novasAlocacoes, logs };
}

export interface DiagnosticoProfessor {
  professorId: string;
  professorNome: string;
  cargaMaxima: number;
  cargaAtual: number;
  cargaFaltante: number;
  disciplinasPlanejadas: number;
  disciplinasAlocadas: number;
  disciplinasFaltantes: { turmaId: string; disciplinaId: string; aulas: number }[];
  disponibilidade: {
    dia: string;
    horarios: number[];
  }[];
  conflitos: string[];
  sugestoes: string[];
}

export function diagnosticarProfessor(
  professor: Professor,
  turmas: Turma[],
  disciplinas: Disciplina[],
  matriz: MatrizCurricular[],
  alocacoes: Alocacao[],
  config: ConfiguracaoHorarios
): DiagnosticoProfessor {
  const conflitos: string[] = [];
  const sugestoes: string[] = [];
  const disciplinasFaltantes: { turmaId: string; disciplinaId: string; aulas: number }[] = [];

  // 1. Verificar disponibilidade
  const disponibilidade: { dia: string; horarios: number[] }[] = [];
  if (professor.disponibilidade) {
    for (const [dia, horarios] of Object.entries(professor.disponibilidade)) {
      if (Array.isArray(horarios)) {
        disponibilidade.push({ dia, horarios: horarios.map(Number) });
      }
    }
  } else {
    conflitos.push("❌ Professor não tem disponibilidade definida");
    sugestoes.push("💡 Defina a disponibilidade do professor");
  }

  // 2. Verificar carga horária
  const cargaAtual = alocacoes.filter(a => a.professorId === professor.id).length;
  const cargaMaxima = professor.cargaHorariaMaximaSemanal || 0;
  const cargaFaltante = cargaMaxima - cargaAtual;

  // 3. Verificar disciplinas planejadas
  let disciplinasPlanejadas = 0;
  let disciplinasAlocadas = 0;

  if (professor.planejamento && Array.isArray(professor.planejamento)) {
    for (const item of professor.planejamento) {
      const m = matriz.find(m => 
        m.turmaId === item.turmaId && 
        m.disciplinaId === item.disciplinaId
      );
      const weeklyHours = Number(item.aulasPorSemana !== undefined ? item.aulasPorSemana : item.quantidadeAulas) || m?.aulasPorSemana || 0;
      disciplinasPlanejadas += weeklyHours;

      const alocadas = alocacoes.filter(a => 
        a.professorId === professor.id &&
        a.turmaId === item.turmaId &&
        a.disciplinaId === item.disciplinaId
      ).length;

      disciplinasAlocadas += alocadas;

      if (alocadas < weeklyHours) {
        disciplinasFaltantes.push({
          turmaId: item.turmaId,
          disciplinaId: item.disciplinaId,
          aulas: weeklyHours - alocadas
        });
      }
    }
  } else {
    conflitos.push("❌ Professor não tem planejamento definido");
    sugestoes.push("💡 Associe disciplinas ao professor no planejamento");
  }

  // 4. Verificar conflitos por turno
  const turmaMap = new Map(turmas.map(t => [t.id, t]));
  const alocacoesProfessor = alocacoes.filter(a => a.professorId === professor.id);

  for (const a of alocacoesProfessor) {
    const turma = turmaMap.get(a.turmaId);
    if (!turma) continue;
    const turno = turma.turno || "manha";
    const disponivel = isProfAvailableAt(professor.disponibilidade, a.diaSemana, a.horario, turno);
    if (!disponivel) {
      conflitos.push(`❌ Aula em ${a.diaSemana} ${a.horario}º horário está fora da disponibilidade`);
    }
  }

  // 5. Sugestões
  if (cargaFaltante > 0 && disciplinasFaltantes.length > 0) {
    sugestoes.push(`💡 ${cargaFaltante} aulas faltantes para ${disciplinasFaltantes.length} disciplina(s)`);
    for (const df of disciplinasFaltantes) {
      const turma = turmaMap.get(df.turmaId);
      const disciplina = disciplinas.find(d => d.id === df.disciplinaId);
      if (turma && disciplina) {
        sugestoes.push(`   - ${disciplina.nome} na ${turma.nome}: ${df.aulas} aula(s) faltantes`);
      }
    }
  }

  // 6. Verificar se há slots livres
  if (cargaFaltante > 0) {
    const turnos = new Set<string>();
    for (const df of disciplinasFaltantes) {
      const turma = turmaMap.get(df.turmaId);
      if (turma) turnos.add(turma.turno || "manha");
    }

    for (const turno of turnos) {
      const slotsPerDay = turno === "noite"
        ? (config.quantidadeHorariosPorDiaNoite ?? 4)
        : turno === "tarde"
          ? (config.quantidadeHorariosPorDiaTarde ?? 5)
          : (config.quantidadeHorariosPorDia ?? 5);

      const dias = ["segunda", "terca", "quarta", "quinta", "sexta"];
      let slotsLivres = 0;

      for (const dia of dias) {
        for (let h = 1; h <= slotsPerDay; h++) {
          if (isProfAvailableAt(professor.disponibilidade, dia, h, turno)) {
            const ocupado = isProfessorBusyAt(alocacoes, professor.id, dia, h, turno, turmas);
            if (!ocupado) slotsLivres++;
          }
        }
      }

      sugestoes.push(`💡 ${slotsLivres} slots livres disponíveis no turno ${turno}`);
    }
  }

  return {
    professorId: professor.id,
    professorNome: professor.nomeCompleto,
    cargaMaxima,
    cargaAtual,
    cargaFaltante,
    disciplinasPlanejadas,
    disciplinasAlocadas,
    disciplinasFaltantes,
    disponibilidade,
    conflitos,
    sugestoes,
  };
}

export function contarViolacoesLimiteDiario(
  alocacoes: Alocacao[],
  professores: Professor[],
): number {
  const profMap = new Map(professores.map((p) => [p.id, p]));
  const cont = new Map<string, { count: number; turmaId: string; disciplinaId: string; professorId: string }>();

  for (const a of alocacoes) {
    const k = `${a.turmaId}|${a.diaSemana}|${a.disciplinaId}|${a.professorId}`;
    const entry = cont.get(k) || { count: 0, turmaId: a.turmaId, disciplinaId: a.disciplinaId, professorId: a.professorId };
    entry.count++;
    cont.set(k, entry);
  }

  let violacoes = 0;
  cont.forEach(({ count, turmaId, disciplinaId, professorId }) => {
    const prof = profMap.get(professorId);
    const planeItem = prof?.planejamento?.find((it) => it.turmaId === turmaId && it.disciplinaId === disciplinaId);
    const weeklyHours = Number(planeItem?.aulasPorSemana ?? planeItem?.quantidadeAulas ?? count);
    const { maxDia } = getLimitesPedagogicos(planeItem, weeklyHours);
    if (count > maxDia) violacoes++;
  });
  return violacoes;
}

// ──────────────────────────────────────────────────────────────
// INDICES
// ──────────────────────────────────────────────────────────────

export class TeacherIndex {
  private map = new Map<string, Professor>();

  constructor(professores: Professor[], matriz: MatrizCurricular[]) {
    const sanitized = ensureProfessoresPlanejamento(professores, matriz);
    sanitized.forEach((p) => this.map.set(p.id, p));
  }

  public get(id: string): Professor | undefined {
    return this.map.get(id);
  }

  public getAll(): Professor[] {
    return Array.from(this.map.values());
  }
}

export class TurmaIndex {
  private map = new Map<string, Turma>();

  constructor(turmas: Turma[]) {
    turmas.forEach((t) => this.map.set(t.id, t));
  }

  public get(id: string): Turma | undefined {
    return this.map.get(id);
  }

  public getAll(): Turma[] {
    return Array.from(this.map.values());
  }
}

export class DisciplinaIndex {
  private map = new Map<string, Disciplina>();

  constructor(disciplinas: Disciplina[]) {
    disciplinas.forEach((d) => this.map.set(d.id, d));
  }

  public get(id: string): Disciplina | undefined {
    return this.map.get(id);
  }

  public getAll(): Disciplina[] {
    return Array.from(this.map.values());
  }
}

export class HorarioIndex {
  // Key formats:
  // - Turma: turmaId|diaSemana|horario
  // - Professor: professorId|diaSemana|turno|horario
  private turmaMap = new Map<string, Alocacao>();
  private profMap = new Map<string, Alocacao[]>();
  private allAllocations: Alocacao[] = [];

  constructor(alocacoes: Alocacao[], turmas: Turma[]) {
    this.rebuild(alocacoes, turmas);
  }

  public rebuild(alocacoes: Alocacao[], turmas: Turma[]) {
    this.turmaMap.clear();
    this.profMap.clear();
    this.allAllocations = [...alocacoes];

    const tMap = new Map(turmas.map((t) => [t.id, t]));

    alocacoes.forEach((a) => {
      const t = tMap.get(a.turmaId);
      const shift = t?.turno || "manha";

      // Index por Turma
      const turmaKey = `${a.turmaId}|${a.diaSemana}|${a.horario}`;
      this.turmaMap.set(turmaKey, a);

      // Index por Professor
      const profKey = `${a.professorId}|${a.diaSemana}|${shift}|${a.horario}`;
      if (!this.profMap.has(profKey)) {
        this.profMap.set(profKey, []);
      }
      this.profMap.get(profKey)!.push(a);
    });
  }

  public getByTurmaDiaSlot(turmaId: string, dia: string, horario: number): Alocacao | undefined {
    return this.turmaMap.get(`${turmaId}|${dia}|${horario}`);
  }

  public getByProfessorDiaSlot(professorId: string, dia: string, turno: string, horario: number): Alocacao[] {
    return this.profMap.get(`${professorId}|${dia}|${turno}|${horario}`) || [];
  }

  public getAll(): Alocacao[] {
    return this.allAllocations;
  }
}

// ──────────────────────────────────────────────────────────────
// ASSIGNMENT MAP
// ──────────────────────────────────────────────────────────────

export interface AssignmentEntry {
  professorId: string;
  professorNome: string;
  turmaId: string;
  turmaNome: string;
  disciplinaId: string;
  disciplinaNome: string;
  planejado: number;
  alocado: number;
  restante: number;
}

export class AssignmentMap {
  private entries: AssignmentEntry[] = [];
  private entryMap = new Map<string, AssignmentEntry>();

  constructor(
    professores: Professor[],
    turmas: Turma[],
    disciplinas: Disciplina[],
    matriz: MatrizCurricular[],
    alocacoes: Alocacao[]
  ) {
    this.rebuild(professores, turmas, disciplinas, matriz, alocacoes);
  }

  public rebuild(
    professores: Professor[],
    turmas: Turma[],
    disciplinas: Disciplina[],
    matriz: MatrizCurricular[],
    alocacoes: Alocacao[]
  ) {
    this.entries = [];
    this.entryMap.clear();

    const tMap = new Map(turmas.map((t) => [t.id, t]));
    const dMap = new Map(disciplinas.map((d) => [d.id, d]));
    const pMap = new Map(ensureProfessoresPlanejamento(professores, matriz).map((p) => [p.id, p]));

    // Inicializar a partir do planejamento / matriz
    pMap.forEach((prof) => {
      const planejamento = prof.planejamento || [];
      planejamento.forEach((item) => {
        const key = `${prof.id}|${item.turmaId}|${item.disciplinaId}`;
        const planejado = Number(item.aulasPorSemana !== undefined ? item.aulasPorSemana : item.quantidadeAulas) || 0;
        if (planejado <= 0) return;

        const entry: AssignmentEntry = {
          professorId: prof.id,
          professorNome: prof.nomeCompleto,
          turmaId: item.turmaId,
          turmaNome: tMap.get(item.turmaId)?.nome || "Turma Desconhecida",
          disciplinaId: item.disciplinaId,
          disciplinaNome: dMap.get(item.disciplinaId)?.nome || "Disciplina Desconhecida",
          planejado,
          alocado: 0,
          restante: planejado,
        };

        this.entries.push(entry);
        this.entryMap.set(key, entry);
      });
    });

    // Contabilizar alocações reais
    alocacoes.forEach((a) => {
      const key = `${a.professorId}|${a.turmaId}|${a.disciplinaId}`;
      const entry = this.entryMap.get(key);
      if (entry) {
        entry.alocado++;
        entry.restante = entry.planejado - entry.alocado;
      } else {
        // Alocação órfã (sem planejamento associado)
        const entry: AssignmentEntry = {
          professorId: a.professorId,
          professorNome: pMap.get(a.professorId)?.nomeCompleto || "Prof. Desconhecido",
          turmaId: a.turmaId,
          turmaNome: tMap.get(a.turmaId)?.nome || "Turma Desconhecida",
          disciplinaId: a.disciplinaId,
          disciplinaNome: dMap.get(a.disciplinaId)?.nome || "Disciplina Desconhecida",
          planejado: 0,
          alocado: 1,
          restante: -1,
        };
        this.entries.push(entry);
        this.entryMap.set(key, entry);
      }
    });
  }

  public get(professorId: string, turmaId: string, disciplinaId: string): AssignmentEntry | undefined {
    return this.entryMap.get(`${professorId}|${turmaId}|${disciplinaId}`);
  }

  public getAll(): AssignmentEntry[] {
    return this.entries;
  }
}

// ──────────────────────────────────────────────────────────────
// CONSTRAINT ENGINE
// ──────────────────────────────────────────────────────────────

export interface RuleViolation {
  tipo: "indisponibilidade_professor" | "professor_ocupado" | "turma_ocupada" | "limite_disciplina_dia" | "limite_consecutivo" | "limite_carga_semanal" | "turno_incompativel";
  descricao: string;
  critica: boolean; // true se for hard constraint (inválida), false se for soft constraint
}

export class ConstraintEngine {
  constructor() {}

  /**
   * Verifica se o slot é viável para alocação.
   */
  public checkSlotViability(
    professorId: string,
    turmaId: string,
    disciplinaId: string,
    dia: string,
    horario: number,
    context: {
      turmas: Turma[];
      disciplinas: Disciplina[];
      professores: Professor[];
      matriz: MatrizCurricular[];
      config: ConfiguracaoHorarios;
      alocacoes: Alocacao[];
      horariosIndex: HorarioIndex;
    },
    options?: {
      permitirMaisDeDuasAulasMesmoDia?: boolean;
      permitirTresAulasConsecutivas?: boolean;
      permitirAlocarQualquerHorarioDisponivel?: boolean;
      ignoreAllocationId?: string; // ignora essa alocação em checagem de concorrência
    }
  ): RuleViolation[] {
    const violations: RuleViolation[] = [];

    const t = context.turmas.find((x) => x.id === turmaId);
    if (!t) return [{ tipo: "turno_incompativel", descricao: "Turma inválida", critica: true }];

    const shift = t.turno;
    const prof = context.professores.find((p) => p.id === professorId);
    if (!prof) return [{ tipo: "turno_incompativel", descricao: "Professor inválido", critica: true }];

    // 1. Disponibilidade do Professor
    const isAvail = isProfAvailableAt(prof.disponibilidade, dia, horario, shift);
    if (!isAvail && !options?.permitirAlocarQualquerHorarioDisponivel) {
      violations.push({
        tipo: "indisponibilidade_professor",
        descricao: `Prof. ${prof.nomeCompleto} não possui disponibilidade na ${DAY_NAMES[dia] || dia} no ${horario}º horário (${shift})`,
        critica: true,
      });
    }

    // 2. Conflito de Turma Ocupada
    const existingTurmaAloc = context.horariosIndex.getByTurmaDiaSlot(turmaId, dia, horario);
    if (existingTurmaAloc && existingTurmaAloc.id !== options?.ignoreAllocationId) {
      violations.push({
        tipo: "turma_ocupada",
        descricao: `Turma ${t.nome} já possui aula de ${existingTurmaAloc.disciplinaId} neste horário`,
        critica: true,
      });
    }

    // 3. Conflito de Professor Ocupado
    const existingProfAlocs = context.horariosIndex.getByProfessorDiaSlot(professorId, dia, shift, horario);
    const concurrentProfAlocs = existingProfAlocs.filter((a) => a.id !== options?.ignoreAllocationId);
    if (concurrentProfAlocs.length > 0) {
      violations.push({
        tipo: "professor_ocupado",
        descricao: `Prof. ${prof.nomeCompleto} já está alocado em outra turma (${concurrentProfAlocs[0].turmaId}) neste horário`,
        critica: true,
      });
    }

    // Filtra alocações ativas para cálculos de contagem, ignorando o ID atual
    const activeAlocacoes = context.alocacoes.filter((a) => a.id !== options?.ignoreAllocationId);

    // 4. Limite de aulas da mesma disciplina por dia
    const planeItem = (prof.planejamento || []).find((item) => item.disciplinaId === disciplinaId && item.turmaId === turmaId);
    const weeklyHours = Number(planeItem?.aulasPorSemana ?? planeItem?.quantidadeAulas ?? 0);
    const limites = getLimitesPedagogicos(planeItem, weeklyHours);
    const maxDia = limites.maxDia;
    const limit = options?.permitirMaisDeDuasAulasMesmoDia ? Math.max(3, maxDia + 1) : maxDia;

    const noDia = activeAlocacoes.filter(
      (a) => a.turmaId === turmaId && a.diaSemana === dia && a.disciplinaId === disciplinaId
    ).length;

    if (noDia >= limit) {
      violations.push({
        tipo: "limite_disciplina_dia",
        descricao: `Turma ${t.nome} já possui ${noDia} aulas de ${disciplinaId} na ${DAY_NAMES[dia] || dia} (limite: ${limit})`,
        critica: false,
      });
    }

    // 5. Limite Consecutivo
    const maxConsecLimit = limites.maxConsec;
    const currentConsecLimit = options?.permitirTresAulasConsecutivas ? Math.max(3, maxConsecLimit + 1) : maxConsecLimit;

    const consecHoras = activeAlocacoes
      .filter((a) => a.turmaId === turmaId && a.diaSemana === dia && a.disciplinaId === disciplinaId)
      .map((a) => a.horario);
    consecHoras.push(horario);
    consecHoras.sort((x, y) => x - y);

    let maxConsec = 0, currentConsec = 0, lastH = -10;
    for (const hVal of consecHoras) {
      currentConsec = (hVal === lastH + 1) ? currentConsec + 1 : 1;
      if (currentConsec > maxConsec) maxConsec = currentConsec;
      lastH = hVal;
    }

    if (maxConsec > currentConsecLimit) {
      violations.push({
        tipo: "limite_consecutivo",
        descricao: `Excede o limite de ${currentConsecLimit} aulas consecutivas de ${disciplinaId} na ${DAY_NAMES[dia] || dia}`,
        critica: false,
      });
    }

    // 5b. Exige Geminação — aula isolada no dia (soft)
    if (limites.exigeGeminacao) {
      const totalNoDia = noDia + 1;
      if (totalNoDia === 1) {
        violations.push({
          tipo: "limite_consecutivo",
          descricao: `Disciplina exige geminação: aula isolada em ${DAY_NAMES[dia] || dia} (aguardando par consecutivo)`,
          critica: false,
        });
      }
    }

    // 6. Limite de Carga Semanal do Planejamento
    const planejado = Number(planeItem?.aulasPorSemana !== undefined ? planeItem?.aulasPorSemana : planeItem?.quantidadeAulas) || 0;
    const alocado = activeAlocacoes.filter(
      (a) => a.professorId === professorId && a.turmaId === turmaId && a.disciplinaId === disciplinaId
    ).length;

    if (alocado >= planejado && planejado > 0) {
      violations.push({
        tipo: "limite_carga_semanal",
        descricao: `Toda a carga semanal planejada (${planejado} aulas) para ${disciplinaId} com Prof. ${prof.nomeCompleto} já foi preenchida`,
        critica: true,
      });
    }

    // 6b. Limite Contratual Máximo Semanal do Professor
    const totalAlocadoProfessor = activeAlocacoes.filter((a) => a.professorId === professorId).length;
    const cargaMaximaProfessor = Number(prof.cargaHorariaMaximaSemanal) || 0;
    if (cargaMaximaProfessor > 0 && totalAlocadoProfessor >= cargaMaximaProfessor) {
      violations.push({
        tipo: "limite_carga_semanal",
        descricao: `O professor ${prof.nomeCompleto} já atingiu seu limite contratual semanal máximo de ${cargaMaximaProfessor} aulas`,
        critica: true,
      });
    }

    return violations;
  }
}

// ──────────────────────────────────────────────────────────────
// CONFLICT ENGINE
// ──────────────────────────────────────────────────────────────

export class ConflictEngine {
  constructor() {}

  public detectConflicts(
    alocacoes: Alocacao[],
    professores: Professor[],
    disciplinas: Disciplina[],
    turmas: Turma[],
    matriz: MatrizCurricular[]
  ): Conflito[] {
    const conflicts: Conflito[] = [];
    const sanitizedProfs = ensureProfessoresPlanejamento(professores, matriz);
    const profMap = new Map(sanitizedProfs.map((p) => [p.id, p]));
    const turmaMap = new Map(turmas.map((t) => [t.id, t]));

    for (const dia of DAYS) {
      for (let horario = 1; horario <= 12; horario++) {
        const slot = alocacoes.filter((a) => a.diaSemana === dia && a.horario === horario);
        if (slot.length === 0) continue;

        const profByTurno = new Map<string, Alocacao[]>();
        slot.forEach((a) => {
          const t = turmaMap.get(a.turmaId);
          const shift = t?.turno ?? "manha";
          const key = `${a.professorId}-${shift}`;
          const arr = profByTurno.get(key) || [];
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
          const arr = turmaCount.get(a.turmaId) || [];
          arr.push(a);
          turmaCount.set(a.turmaId, arr);
        });

        turmaCount.forEach((alocs, tId) => {
          if (alocs.length > 1) {
            const turma = turmaMap.get(tId);
            conflicts.push({
              descricao: `Turma ${turma?.nome ?? "?"} tem ${alocs.length} aulas simultâneas — ${DAY_NAMES[dia]}, ${horario}º horário`,
              tipo: "turma_dupla",
              dia,
              horario,
              turmaId: tId,
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

    // Violação de aulas consecutivas
    const consecMap = new Map<string, number[]>();
    alocacoes.forEach((a) => {
      const key = `${a.turmaId}|${a.diaSemana}|${a.disciplinaId}|${a.professorId}`;
      if (!consecMap.has(key)) consecMap.set(key, []);
      consecMap.get(key)!.push(a.horario);
    });

    consecMap.forEach((horas, key) => {
      const [tId, diaSemana, dId, pId] = key.split("|");
      const profObj = profMap.get(pId);
      const planeItem = profObj?.planejamento?.find((item) => item.disciplinaId === dId && item.turmaId === tId);
      const weeklyHours = Number(planeItem?.aulasPorSemana ?? planeItem?.quantidadeAulas ?? horas.length);
      const limites = getLimitesPedagogicos(planeItem, weeklyHours);
      const maxConsecLimit = limites.maxConsec;

      const sorted = horas.sort((x, y) => x - y);
      let currentConsec = 0;
      let lastH = -10;
      for (const hVal of sorted) {
        currentConsec = (hVal === lastH + 1) ? currentConsec + 1 : 1;
        if (currentConsec > maxConsecLimit) {
          const dObj = disciplinas.find((d) => d.id === dId);
          const dName = dObj?.nome || dId;
          const tObj = turmas.find((t) => t.id === tId);
          const tName = tObj?.nome || tId;
          const pName = profObj?.nomeCompleto || pId;
          conflicts.push({
            descricao: `Excede o limite de ${maxConsecLimit} aulas consecutivas da disciplina ${dName} na Turma ${tName} (${pName}) na ${DAY_NAMES[diaSemana] || diaSemana}`,
            tipo: "carga_excedida",
            dia: diaSemana,
            horario: hVal,
            turmaId: tId,
            professorId: pId,
          });
          break;
        }
        lastH = hVal;
      }
    });

    return conflicts;
  }
}

// ──────────────────────────────────────────────────────────────
// SCORE ENGINE
// ──────────────────────────────────────────────────────────────

export class ScoreEngine {
  constructor() {}

  public calculate(
    alocacoes: Alocacao[],
    turmas: Turma[],
    professores: Professor[],
    disciplinas: Disciplina[],
    matriz: MatrizCurricular[]
  ): { score: number; iqg: number; iqgClassificacao: string } {
    // Calcular o IQG (Índice de Qualidade da Grade) similar à lógica de auditoria do allocation-engine
    const aulasPlanejadas = matriz.reduce((acc, m) => acc + m.aulasPorSemana, 0);
    const value = calcularScore(alocacoes, turmas, professores, disciplinas, matriz, aulasPlanejadas);
    const aulasGeradas = alocacoes.length;
    const aulasFaltantes = Math.max(0, aulasPlanejadas - aulasGeradas);

    const conflicts = new ConflictEngine().detectConflicts(alocacoes, professores, disciplinas, turmas, matriz);
    const choquesProf = conflicts.filter((c) => c.tipo === "professor_duplo").length;
    const choquesTurma = conflicts.filter((c) => c.tipo === "turma_dupla").length;

    const totalBuracosTurma = contarBuracosTurma(alocacoes, turmas);
    const janelasProf = contarJanelasProfessor(alocacoes, professores);

    // Contar violacoes pedagógicas (limite diário dinâmico por planejamento)
    const violacoes = contarViolacoesLimiteDiario(alocacoes, professores);

    const penaltyConflitos = Math.min(35, (choquesProf + choquesTurma) * 17.5);
    const percentFaltante = aulasPlanejadas > 0 ? (aulasFaltantes / aulasPlanejadas) * 100 : 0;
    const penaltyPendencias = Math.min(25, percentFaltante > 0 ? (aulasFaltantes * 5) : 0);
    const penaltyBuracos = Math.min(15, totalBuracosTurma * 3);
    const penaltyJanelas = Math.min(10, janelasProf * 2);
    const penaltyPedagogica = Math.min(10, violacoes * 2);

    let bonusPreferencias = 5;
    if ((choquesProf + choquesTurma) > 0 || aulasFaltantes > 0) {
      bonusPreferencias -= 2.5;
    }
    if (totalBuracosTurma > 2 || janelasProf > 3) {
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
      score: value,
      iqg,
      iqgClassificacao,
    };
  }
}

// ──────────────────────────────────────────────────────────────
// GAP ENGINE
// ──────────────────────────────────────────────────────────────

export interface BuracoClassificado {
  turmaId: string;
  diaSemana: string;
  horario: number;
  tipo: "evitavel" | "necessario" | "pedagogico";
  motivo: string;
}

export class GapEngine {
  constructor() {}

  public countProfessorWindows(alocacoes: Alocacao[], professores: Professor[]): number {
    return contarJanelasProfessor(alocacoes, professores);
  }

  public auditScheduleGaps(
    alocacoes: Alocacao[],
    matriz: MatrizCurricular[],
    professores: Professor[],
    turmas: Turma[]
  ): {
    total: number;
    evitaveis: number;
    necessarios: number;
    pedagogicos: number;
    buracos: BuracoClassificado[];
  } {
    const sanitizedProfs = ensureProfessoresPlanejamento(professores, matriz);
    const buracos: BuracoClassificado[] = [];

    const planejado = new Map<string, number>();
    matriz.forEach((m) => planejado.set(`${m.turmaId}|${m.disciplinaId}`, m.aulasPorSemana));
    const gerado = new Map<string, number>();
    alocacoes.forEach((a) => {
      const k = `${a.turmaId}|${a.disciplinaId}`;
      gerado.set(k, (gerado.get(k) || 0) + 1);
    });
    const pendente = (tId: string, dId: string) =>
      (planejado.get(`${tId}|${dId}`) || 0) - (gerado.get(`${tId}|${dId}`) || 0);

    const profDe = new Map<string, Professor>();
    sanitizedProfs.forEach((p) => {
      const itens = p.planejamento || [];
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

          const candidatas = matriz.filter(
            (m) => m.turmaId === t.id && pendente(m.turmaId, m.disciplinaId) > 0
          );

          let tipo: "evitavel" | "necessario" | "pedagogico" = "necessario";
          let motivo = "Nenhuma disciplina pendente com professor disponível para este horário.";

          for (const c of candidatas) {
            const prof = profDe.get(`${t.id}|${c.disciplinaId}`);
            const dispOk = prof
              ? isProfAvailableAt(prof.disponibilidade, dia, h, t.turno)
              : false;
            if (!dispOk) continue;

            const noDia = alocacoes.filter(
              (a) => a.turmaId === t.id && a.diaSemana === dia && a.disciplinaId === c.disciplinaId
            ).length;
            const planeItem = prof?.planejamento?.find(
              (it) => it.turmaId === t.id && it.disciplinaId === c.disciplinaId,
            );
            const weeklyHours = Number(planeItem?.aulasPorSemana ?? c.aulasPorSemana ?? 0);
            const { maxDia } = getLimitesPedagogicos(planeItem, weeklyHours);
            if (noDia >= maxDia) {
              tipo = "pedagogico";
              motivo = `Só a disciplina pendente caberia aqui, mas já há ${noDia} aula(s) dela em ${dia} (limite: ${maxDia}/dia).`;
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
}

// ──────────────────────────────────────────────────────────────
// CENTRAL ALLOCATION CORE CLASS
// ──────────────────────────────────────────────────────────────

export class AllocationCore {
  private alocacoes: Alocacao[] = [];
  private turmas: Turma[] = [];
  private disciplinas: Disciplina[] = [];
  private professores: Professor[] = [];
  private matriz: MatrizCurricular[] = [];
  private config: ConfiguracaoHorarios;

  // Sub-Motores
  public assignmentMap!: AssignmentMap;
  public constraintEngine!: ConstraintEngine;
  public conflictEngine!: ConflictEngine;
  public scoreEngine!: ScoreEngine;
  public gapEngine!: GapEngine;

  // Índices
  public teacherIndex!: TeacherIndex;
  public turmaIndex!: TurmaIndex;
  public horarioIndex!: HorarioIndex;
  public disciplinaIndex!: DisciplinaIndex;

  constructor(
    alocacoes: Alocacao[],
    turmas: Turma[],
    disciplinas: Disciplina[],
    professores: Professor[],
    matriz: MatrizCurricular[],
    config: ConfiguracaoHorarios
  ) {
    this.turmas = turmas;
    this.disciplinas = disciplinas;
    this.professores = professores;
    this.matriz = matriz;
    this.config = config;
    this.alocacoes = [...alocacoes];

    this.rebuildAll();
  }

  private rebuildAll() {
    this.teacherIndex = new TeacherIndex(this.professores, this.matriz);
    this.turmaIndex = new TurmaIndex(this.turmas);
    this.disciplinaIndex = new DisciplinaIndex(this.disciplinas);
    this.horarioIndex = new HorarioIndex(this.alocacoes, this.turmas);

    this.assignmentMap = new AssignmentMap(
      this.professores,
      this.turmas,
      this.disciplinas,
      this.matriz,
      this.alocacoes
    );

    this.constraintEngine = new ConstraintEngine();
    this.conflictEngine = new ConflictEngine();
    this.scoreEngine = new ScoreEngine();
    this.gapEngine = new GapEngine();
  }

  // ──────────────────────────────────────────────────────────────
  // GETTERS & READ API
  // ──────────────────────────────────────────────────────────────

  public getAlocacoes(): Alocacao[] {
    return [...this.alocacoes];
  }

  public getTurmas(): Turma[] {
    return this.turmas;
  }

  public getDisciplinas(): Disciplina[] {
    return this.disciplinas;
  }

  public getProfessores(): Professor[] {
    return this.professores;
  }

  public getMatriz(): MatrizCurricular[] {
    return this.matriz;
  }

  public getConfig(): ConfiguracaoHorarios {
    return this.config;
  }

  // ──────────────────────────────────────────────────────────────
  // MUTATION API
  // ──────────────────────────────────────────────────────────────

  /**
   * Tenta alocar uma aula na grade.
   */
  public insert(
    allocation: Omit<Alocacao, "id"> & { id?: string },
    options?: {
      force?: boolean; // Se true, ignora conflitos hard e força a inserção
      regrasRelaxamento?: {
        permitirMaisDeDuasAulasMesmoDia?: boolean;
        permitirTresAulasConsecutivas?: boolean;
        permitirAlocarQualquerHorarioDisponivel?: boolean;
      };
    }
  ): { success: boolean; error?: string; allocation?: Alocacao; violations: RuleViolation[] } {
    const id = allocation.id || `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const fullAlloc: Alocacao = { ...allocation, id };

    // Validar regras
    const context = {
      turmas: this.turmas,
      disciplinas: this.disciplinas,
      professores: this.professores,
      matriz: this.matriz,
      config: this.config,
      alocacoes: this.alocacoes,
      horariosIndex: this.horarioIndex,
    };

    const violations = this.constraintEngine.checkSlotViability(
      fullAlloc.professorId,
      fullAlloc.turmaId,
      fullAlloc.disciplinaId,
      fullAlloc.diaSemana,
      fullAlloc.horario,
      context,
      {
        permitirMaisDeDuasAulasMesmoDia: options?.regrasRelaxamento?.permitirMaisDeDuasAulasMesmoDia,
        permitirTresAulasConsecutivas: options?.regrasRelaxamento?.permitirTresAulasConsecutivas,
        permitirAlocarQualquerHorarioDisponivel: options?.regrasRelaxamento?.permitirAlocarQualquerHorarioDisponivel,
      }
    );

    const hasCriticalViolation = violations.some((v) => v.critica);

    if (hasCriticalViolation && !options?.force) {
      const crit = violations.find((v) => v.critica);
      return {
        success: false,
        error: crit?.descricao || "Violação crítica de restrição.",
        violations,
      };
    }

    // Se houver uma alocação exatamente no mesmo slot de turma, remova-a para substituir
    const tAloc = this.horarioIndex.getByTurmaDiaSlot(fullAlloc.turmaId, fullAlloc.diaSemana, fullAlloc.horario);
    if (tAloc) {
      this.alocacoes = this.alocacoes.filter((a) => a.id !== tAloc.id);
    }

    // Adiciona a nova alocação
    this.alocacoes.push(fullAlloc);
    this.rebuildAll();

    return {
      success: true,
      allocation: fullAlloc,
      violations,
    };
  }

  /**
   * Remove uma alocação por ID.
   */
  public removeById(id: string): { success: boolean; removed?: Alocacao } {
    const target = this.alocacoes.find((a) => a.id === id);
    if (!target) return { success: false };

    this.alocacoes = this.alocacoes.filter((a) => a.id !== id);
    this.rebuildAll();

    return {
      success: true,
      removed: target,
    };
  }

  /**
   * Remove uma alocação por slot de turma.
   */
  public remove(diaSemana: string, horario: number, turmaId: string): { success: boolean; removed?: Alocacao } {
    const target = this.horarioIndex.getByTurmaDiaSlot(turmaId, diaSemana, horario);
    if (!target) return { success: false };

    return this.removeById(target.id);
  }

  /**
   * Realiza a troca (swap) de duas alocações.
   */
  public swap(
    dia1: string,
    horario1: number,
    turmaId1: string,
    dia2: string,
    horario2: number,
    turmaId2: string,
    options?: { force?: boolean }
  ): { success: boolean; error?: string } {
    const a1 = this.horarioIndex.getByTurmaDiaSlot(turmaId1, dia1, horario1);
    const a2 = this.horarioIndex.getByTurmaDiaSlot(turmaId2, dia2, horario2);

    if (!a1 && !a2) {
      return { success: false, error: "Nenhum horário preenchido para realizar a troca." };
    }

    // Se temos apenas um elemento, age como um "move"
    if (a1 && !a2) {
      return this.move(dia1, horario1, turmaId1, dia2, horario2, turmaId2, options);
    }
    if (!a1 && a2) {
      return this.move(dia2, horario2, turmaId2, dia1, horario1, turmaId1, options);
    }

    // Ambos existem, realiza a troca temporária e valida
    const a1Mod: Alocacao = { ...a1!, diaSemana: dia2, horario: horario2, turmaId: turmaId2 };
    const a2Mod: Alocacao = { ...a2!, diaSemana: dia1, horario: horario1, turmaId: turmaId1 };

    // Se não for forçado, valida a compatibilidade cruzada
    if (!options?.force) {
      const v1 = this.constraintEngine.checkSlotViability(
        a1Mod.professorId,
        a1Mod.turmaId,
        a1Mod.disciplinaId,
        a1Mod.diaSemana,
        a1Mod.horario,
        {
          turmas: this.turmas,
          disciplinas: this.disciplinas,
          professores: this.professores,
          matriz: this.matriz,
          config: this.config,
          alocacoes: this.alocacoes,
          horariosIndex: this.horarioIndex,
        },
        { ignoreAllocationId: a1!.id }
      );

      const v2 = this.constraintEngine.checkSlotViability(
        a2Mod.professorId,
        a2Mod.turmaId,
        a2Mod.disciplinaId,
        a2Mod.diaSemana,
        a2Mod.horario,
        {
          turmas: this.turmas,
          disciplinas: this.disciplinas,
          professores: this.professores,
          matriz: this.matriz,
          config: this.config,
          alocacoes: this.alocacoes,
          horariosIndex: this.horarioIndex,
        },
        { ignoreAllocationId: a2!.id }
      );

      if (v1.some((v) => v.critica) || v2.some((v) => v.critica)) {
        return { success: false, error: "Troca violaria regras críticas de conflito." };
      }
    }

    // Executa a troca
    this.alocacoes = this.alocacoes.filter((a) => a.id !== a1!.id && a.id !== a2!.id);
    this.alocacoes.push(a1Mod, a2Mod);
    this.rebuildAll();

    return { success: true };
  }

  /**
   * Move uma alocação para um novo slot de turma.
   */
  public move(
    fromDia: string,
    fromHorario: number,
    fromTurmaId: string,
    toDia: string,
    toHorario: number,
    toTurmaId?: string,
    options?: { force?: boolean }
  ): { success: boolean; error?: string } {
    const target = this.horarioIndex.getByTurmaDiaSlot(fromTurmaId, fromDia, fromHorario);
    if (!target) return { success: false, error: "Nenhuma alocação encontrada na origem." };

    const destTurmaId = toTurmaId || fromTurmaId;

    const moved: Alocacao = {
      ...target,
      diaSemana: toDia,
      horario: toHorario,
      turmaId: destTurmaId,
    };

    if (!options?.force) {
      const violations = this.constraintEngine.checkSlotViability(
        moved.professorId,
        moved.turmaId,
        moved.disciplinaId,
        moved.diaSemana,
        moved.horario,
        {
          turmas: this.turmas,
          disciplinas: this.disciplinas,
          professores: this.professores,
          matriz: this.matriz,
          config: this.config,
          alocacoes: this.alocacoes,
          horariosIndex: this.horarioIndex,
        },
        { ignoreAllocationId: target.id }
      );

      if (violations.some((v) => v.critica)) {
        return { success: false, error: violations.find((v) => v.critica)?.descricao || "Movimento inválido." };
      }
    }

    this.alocacoes = this.alocacoes.filter((a) => a.id !== target.id);
    this.alocacoes.push(moved);
    this.rebuildAll();

    return { success: true };
  }

  /**
   * Limpa todas as alocações não travadas (non-locked).
   */
  public clear(): void {
    this.alocacoes = this.alocacoes.filter((a) => a.isLocked);
    this.rebuildAll();
  }
}

export interface RepairResult {
  alocacoes: Alocacao[];
  logs: string[];
  success: boolean;
  alteredCount: number;
  scoreBefore: number;
  scoreAfter: number;
}

function getIqg(
  alocacoes: Alocacao[],
  turmas: Turma[],
  professores: Professor[],
  disciplinas: Disciplina[],
  matriz: MatrizCurricular[]
): number {
  const aulasPlanejadas = matriz.reduce((acc, m) => acc + m.aulasPorSemana, 0);
  const aulasGeradas = alocacoes.length;
  const aulasFaltantes = aulasPlanejadas - aulasGeradas;

  const conflitos = detectConflicts(alocacoes, professores, disciplinas, turmas, matriz);
  const choquesProf = conflitos.filter((c: Conflito) => c.tipo === "professor_duplo").length;
  const choquesTurma = conflitos.filter((c: Conflito) => c.tipo === "turma_dupla").length;

  const janelas = contarJanelasProfessor(alocacoes, professores);

  // Simple count of holes in turmas
  let buracos = 0;
  for (const t of turmas) {
    for (const dia of ["segunda", "terca", "quarta", "quinta", "sexta"]) {
      const ad = alocacoes.filter((a) => a.turmaId === t.id && a.diaSemana === dia);
      if (ad.length <= 1) continue;
      const sH = new Set<number>(ad.map((a) => a.horario));
      const mn = Math.min(...Array.from(sH));
      const mx = Math.max(...Array.from(sH));
      for (let p = mn; p < mx; p++) if (!sH.has(p)) buracos++;
    }
  }

  // Count pedagogic violations (more than 2 classes per subject on same day in same class)
  let violacoes = 0;
  for (const t of turmas) {
    for (const d of disciplinas) {
      for (const dia of ["segunda", "terca", "quarta", "quinta", "sexta"]) {
        const count = alocacoes.filter((a) => a.turmaId === t.id && a.disciplinaId === d.id && a.diaSemana === dia).length;
        if (count > 2) violacoes++;
      }
    }
  }

  const penaltyConflitos = Math.min(35, (choquesProf + choquesTurma) * 17.5);
  const percentFaltante = aulasPlanejadas > 0 ? (aulasFaltantes / aulasPlanejadas) * 100 : 0;
  const penaltyPendencias = Math.min(25, percentFaltante > 0 ? (aulasFaltantes * 5) : 0);
  const penaltyBuracos = Math.min(15, buracos * 3);
  const penaltyJanelas = Math.min(10, janelas * 2);
  const penaltyPedagogica = Math.min(10, violacoes * 2);

  let bonusPreferencias = 5;
  if ((choquesProf + choquesTurma) > 0 || aulasFaltantes > 0) {
    bonusPreferencias -= 2.5;
  }
  if (buracos > 2 || janelas > 3) {
    bonusPreferencias -= 2.5;
  }
  bonusPreferencias = Math.max(0, bonusPreferencias);

  const iqgValue = 100 - penaltyConflitos - penaltyPendencias - penaltyBuracos - penaltyJanelas - penaltyPedagogica + (bonusPreferencias - 5);
  return Math.max(0, Math.min(100, Math.round(iqgValue * 10) / 10));
}

/**
 * Executes a targeted local repair for a single professor, keeping changes to other professors at an absolute minimum (max 5-6 alterations).
 */
export function repairProfessorSchedule(
  professorId: string,
  currentAlocacoes: Alocacao[],
  turmas: Turma[],
  disciplinas: Disciplina[],
  professores: Professor[],
  matriz: MatrizCurricular[],
  config: ConfiguracaoHorarios
): RepairResult {
  const logs: string[] = [];
  let tempAlocs = [...currentAlocacoes];
  
  const scoreBefore = getIqg(tempAlocs, turmas, professores, disciplinas, matriz);
  logs.push(`Iniciando AutoRepair Local para Professor(a) ID: ${professorId}`);
  
  const prof = professores.find(p => p.id === professorId);
  if (!prof) {
    logs.push(`❌ Professor com ID ${professorId} não encontrado.`);
    return { alocacoes: currentAlocacoes, logs, success: false, alteredCount: 0, scoreBefore, scoreAfter: scoreBefore };
  }

  logs.push(`Professor(a) selecionado(a): ${prof.nomeCompleto}`);
  
  // Find all current allocations for this professor
  const profAlocs = tempAlocs.filter(a => a.professorId === professorId);
  logs.push(`O professor possui ${profAlocs.length} aulas alocadas no momento.`);

  // Detect conflicts specifically involving this professor
  const allConflicts = detectConflicts(tempAlocs, professores, disciplinas, turmas, matriz);
  const profConflicts = allConflicts.filter(c => c.professorId === professorId);
  
  // Also check if they have unassigned (missing) planned lessons
  const missingLessons: { turmaId: string; disciplinaId: string }[] = [];
  if (prof.planejamento && Array.isArray(prof.planejamento)) {
    prof.planejamento.forEach(item => {
      const planned = Number(item.aulasPorSemana !== undefined ? item.aulasPorSemana : item.quantidadeAulas) || 0;
      const actual = profAlocs.filter(a => a.turmaId === item.turmaId && a.disciplinaId === item.disciplinaId).length;
      if (actual < planned) {
        const diff = planned - actual;
        for (let i = 0; i < diff; i++) {
          missingLessons.push({ turmaId: item.turmaId, disciplinaId: item.disciplinaId });
        }
      }
    });
  }

  logs.push(`Detectados: ${profConflicts.length} conflitos lógicos e ${missingLessons.length} aulas pendentes de alocação.`);

  if (profConflicts.length === 0 && missingLessons.length === 0) {
    logs.push(`✅ Nenhuma pendência ou conflito pendente para este professor. Grade estável!`);
    return { alocacoes: currentAlocacoes, logs, success: true, alteredCount: 0, scoreBefore, scoreAfter: scoreBefore };
  }

  let alteredCount = 0;
  const MAX_ALTERATIONS = 6;
  const DAYS_LIST = ["segunda", "terca", "quarta", "quinta", "sexta"];
  const localRegras = {
    modo: "equilibrado" as const,
    permitirMaisDeDuasAulasMesmoDia: false,
    permitirTresAulasConsecutivas: false,
    permitirOcuparHorariosLivresEntreAulas: true,
    permitirAumentarLimiteDiario: false,
    permitirAlocarQualquerHorarioDisponivel: false,
  };

  // ── STEP 1: RESOLVE ACTIVE CONFLICTS FOR THIS PROFESSOR ──
  for (const conflict of profConflicts) {
    if (alteredCount >= MAX_ALTERATIONS) {
      logs.push(`⚠️ Limite de alterações (${MAX_ALTERATIONS}) atingido. Interrompendo reparo para preservar a estabilidade da grade.`);
      break;
    }

    // Find the specific allocation causing conflict
    const targetAlocIndex = tempAlocs.findIndex(a => 
      a.professorId === professorId && 
      a.diaSemana === conflict.dia && 
      a.horario === conflict.horario
    );
    if (targetAlocIndex === -1) continue;
    
    const targetAloc = tempAlocs[targetAlocIndex];
    if (targetAloc.isLocked) {
      logs.push(`🔒 Aula de ${prof.nomeCompleto} em ${conflict.dia} ${conflict.horario} está travada e não pode ser movida.`);
      continue;
    }

    const t = turmas.find(x => x.id === targetAloc.turmaId);
    if (!t) continue;

    const tTurno = t.turno || "manha";
    const slotsPerDay = tTurno === "noite"
      ? (config.quantidadeHorariosPorDiaNoite ?? 4)
      : tTurno === "tarde"
        ? (config.quantidadeHorariosPorDiaTarde ?? 5)
        : (config.quantidadeHorariosPorDia ?? 6);

    logs.push(`Resolvendo conflito na turma ${t.nome} (${conflict.dia} - ${conflict.horario}º Horário)...`);

    // Strategy A: Find an alternative empty and viable slot in Class T where Professor P is available and free
    let resolvedConflict = false;
    for (const dia of DAYS_LIST) {
      if (resolvedConflict || alteredCount >= MAX_ALTERATIONS) break;
      for (let h = 1; h <= slotsPerDay; h++) {
        if (dia === conflict.dia && h === conflict.horario) continue;

        // Is Professor P available and free in this slot?
        if (!isProfAvailableAt(prof.disponibilidade, dia, h, tTurno)) continue;
        const profBusy = tempAlocs.some(a => {
          if (a.professorId !== professorId || a.diaSemana !== dia || a.horario !== h) return false;
          const tOutra = turmas.find(tm => tm.id === a.turmaId);
          const tOutraTurno = tOutra?.turno || "manha";
          return tOutraTurno === tTurno;
        });
        if (profBusy) continue;

        // Is Class T empty in this slot?
        const classOccupied = tempAlocs.some(a => a.turmaId === t.id && a.diaSemana === dia && a.horario === h);
        if (classOccupied) continue;

        // Check overall slot viability
        const check = verificarSlotViavelComMotivo(
          tempAlocs, professores, disciplinas, turmas, matriz, config,
          professorId, t.id, targetAloc.disciplinaId, dia, h, localRegras, targetAloc.id
        );

        if (check.viavel) {
          tempAlocs[targetAlocIndex] = {
            ...targetAloc,
            diaSemana: dia,
            horario: h
          };
          alteredCount++;
          resolvedConflict = true;
          logs.push(`   → ✅ Resolvido! Aula movida para ${dia.toUpperCase()} ${h}º Horário.`);
          break;
        }
      }
    }

    // Strategy B: Try a localized swap within the same class T with another teacher (modifies 2 allocations)
    if (!resolvedConflict && alteredCount + 2 <= MAX_ALTERATIONS) {
      for (const dia of DAYS_LIST) {
        if (resolvedConflict || alteredCount + 2 >= MAX_ALTERATIONS) break;
        for (let h = 1; h <= slotsPerDay; h++) {
          if (dia === conflict.dia && h === conflict.horario) continue;

          // Find what is occupying class T at (dia, h)
          const otherAlocIndex = tempAlocs.findIndex(a => a.turmaId === t.id && a.diaSemana === dia && a.horario === h);
          if (otherAlocIndex === -1) continue;

          const otherAloc = tempAlocs[otherAlocIndex];
          if (otherAloc.isLocked || otherAloc.professorId === professorId) continue;

          const otherProf = professores.find(p => p.id === otherAloc.professorId);
          if (!otherProf) continue;

          // Can we swap?
          // 1. Is Professor P available and free at (dia, h)?
          if (!isProfAvailableAt(prof.disponibilidade, dia, h, tTurno)) continue;
          const profBusy = tempAlocs.some(a => {
            if (a.professorId !== professorId || a.diaSemana !== dia || a.horario !== h) return false;
            const tOutra = turmas.find(tm => tm.id === a.turmaId);
            const tOutraTurno = tOutra?.turno || "manha";
            return tOutraTurno === tTurno;
          });
          if (profBusy) continue;

          // 2. Is otherProf available and free at (conflict.dia, conflict.horario)?
          if (!isProfAvailableAt(otherProf.disponibilidade, conflict.dia!, conflict.horario!, tTurno)) continue;
          const otherProfBusy = tempAlocs.some(a => {
            if (a.professorId !== otherProf.id || a.diaSemana !== conflict.dia || a.horario !== conflict.horario || a.id !== targetAloc.id) return false;
            const tOutra = turmas.find(tm => tm.id === a.turmaId);
            const tOutraTurno = tOutra?.turno || "manha";
            return tOutraTurno === tTurno;
          });
          if (otherProfBusy) continue;

          // Validate the swap path
          const checkP = verificarSlotViavelComMotivo(
            tempAlocs, professores, disciplinas, turmas, matriz, config,
            professorId, t.id, targetAloc.disciplinaId, dia, h, localRegras, targetAloc.id
          );
          if (!checkP.viavel) continue;

          const checkOther = verificarSlotViavelComMotivo(
            tempAlocs, professores, disciplinas, turmas, matriz, config,
            otherProf.id, t.id, otherAloc.disciplinaId, conflict.dia!, conflict.horario!, localRegras, otherAloc.id
          );
          if (!checkOther.viavel) continue;

          // Perform swap!
          tempAlocs[targetAlocIndex] = { ...targetAloc, diaSemana: dia, horario: h };
          tempAlocs[otherAlocIndex] = { ...otherAloc, diaSemana: conflict.dia!, horario: conflict.horario! };
          alteredCount += 2;
          resolvedConflict = true;
          logs.push(`   → 🔄 Permutado! Aula de ${prof.nomeCompleto} movida para (${dia.toUpperCase()}, ${h}) e de ${otherProf.nomeCompleto} para (${conflict.dia!.toUpperCase()}, ${conflict.horario}).`);
          break;
        }
      }
    }
  }

  // ── STEP 2: ALLOCATE MISSING PLANNED LESSONS ──
  for (const lesson of missingLessons) {
    if (alteredCount >= MAX_ALTERATIONS) {
      logs.push(`⚠️ Limite de alterações (${MAX_ALTERATIONS}) atingido. Interrompendo inserção de pendências.`);
      break;
    }

    const t = turmas.find(x => x.id === lesson.turmaId);
    if (!t) continue;

    const tTurno = t.turno || "manha";
    const slotsPerDay = tTurno === "noite"
      ? (config.quantidadeHorariosPorDiaNoite ?? 4)
      : tTurno === "tarde"
        ? (config.quantidadeHorariosPorDiaTarde ?? 5)
        : (config.quantidadeHorariosPorDia ?? 6);

    // ✅ VERIFICAR O LIMITE SEMANAL CORRETO DO CADASTRO (OU MATRIZ)
    let weeklyLimit = 0;
    const planeItem = prof.planejamento?.find(p => 
      p.turmaId === t.id && p.disciplinaId === lesson.disciplinaId
    );
    if (planeItem) {
      weeklyLimit = Number(planeItem.aulasPorSemana !== undefined ? planeItem.aulasPorSemana : planeItem.quantidadeAulas) || 0;
    } else {
      const matMatch = matriz.find(m => m.turmaId === t.id && m.disciplinaId === lesson.disciplinaId);
      if (matMatch) {
        weeklyLimit = Number(matMatch.aulasPorSemana) || 0;
      }
    }

    // ✅ SE NÃO TIVER LIMITE DEFINIDO, USAR DEFAULT (2)
    if (weeklyLimit === 0) {
      weeklyLimit = 2;
    }

    // ✅ CONTAR QUANTAS JÁ FORAM ALOCADAS NO MOMENTO
    const alreadyAllocated = tempAlocs.filter(a =>
      a.professorId === professorId &&
      a.turmaId === t.id &&
      a.disciplinaId === lesson.disciplinaId
    ).length;

    if (alreadyAllocated >= weeklyLimit) {
      logs.push(`⚠️ ${disciplinas.find(d => d.id === lesson.disciplinaId)?.nome || lesson.disciplinaId} já atingiu o limite semanal (${weeklyLimit}h).`);
      continue;
    }

    logs.push(`Alocando aula pendente de ${disciplinas.find(d => d.id === lesson.disciplinaId)?.nome || lesson.disciplinaId} na turma ${t.nome}...`);

    let allocatedMissing = false;

    // Scan for completely free slot in both professor and class
    for (const dia of DAYS_LIST) {
      if (allocatedMissing || alteredCount >= MAX_ALTERATIONS) break;
      for (let h = 1; h <= slotsPerDay; h++) {
        // Is teacher available and free?
        if (!isProfAvailableAt(prof.disponibilidade, dia, h, tTurno)) continue;
        const profBusy = tempAlocs.some(a => {
          if (a.professorId !== professorId || a.diaSemana !== dia || a.horario !== h) return false;
          const tOutra = turmas.find(tm => tm.id === a.turmaId);
          const tOutraTurno = tOutra?.turno || "manha";
          return tOutraTurno === tTurno;
        });
        if (profBusy) continue;

        // Is class free?
        const classOccupied = tempAlocs.some(a => a.turmaId === t.id && a.diaSemana === dia && a.horario === h);
        if (classOccupied) continue;

        // ✅ VERIFICAR LIMITE DIÁRIO
        const aulasHoje = tempAlocs.filter(a =>
          a.professorId === professorId &&
          a.turmaId === t.id &&
          a.disciplinaId === lesson.disciplinaId &&
          a.diaSemana === dia
        ).length;
        const maxDia = planeItem?.maximoAulasPorDia ?? 2;
        if (aulasHoje >= maxDia) continue;

        // Check slot viability
        const check = verificarSlotViavelComMotivo(
          tempAlocs, professores, disciplinas, turmas, matriz, config,
          professorId, t.id, lesson.disciplinaId, dia, h, localRegras
        );

        if (check.viavel) {
          const newAloc: Alocacao = {
            id: `repair-new-${Date.now()}-${Math.random()}`,
            turmaId: t.id,
            disciplinaId: lesson.disciplinaId,
            professorId: professorId,
            diaSemana: dia,
            horario: h
          };
          tempAlocs.push(newAloc);
          alteredCount++;
          allocatedMissing = true;
          logs.push(`   → ✅ Alocado com sucesso em ${dia.toUpperCase()} ${h}º Horário!`);
          break;
        }
      }
    }

    // Try swap with another teacher in Class T to free a slot for our teacher
    if (!allocatedMissing && alteredCount + 2 <= MAX_ALTERATIONS) {
      for (const dia of DAYS_LIST) {
        if (allocatedMissing || alteredCount + 2 >= MAX_ALTERATIONS) break;
        for (let h = 1; h <= slotsPerDay; h++) {
          // Is our teacher available and free at (dia, h)?
          if (!isProfAvailableAt(prof.disponibilidade, dia, h, tTurno)) continue;
          const profBusy = tempAlocs.some(a => {
            if (a.professorId !== professorId || a.diaSemana !== dia || a.horario !== h) return false;
            const tOutra = turmas.find(tm => tm.id === a.turmaId);
            const tOutraTurno = tOutra?.turno || "manha";
            return tOutraTurno === tTurno;
          });
          if (profBusy) continue;

          // Find occupier in class T
          const occupierIndex = tempAlocs.findIndex(a => a.turmaId === t.id && a.diaSemana === dia && a.horario === h);
          if (occupierIndex === -1) continue;

          const occupier = tempAlocs[occupierIndex];
          if (occupier.isLocked || occupier.professorId === professorId) continue;

          const occupierProf = professores.find(p => p.id === occupier.professorId);
          if (!occupierProf) continue;

          // ✅ VERIFICAR LIMITE DIÁRIO PARA NOSSO PROFESSOR NO DIA DO SWAP
          const aulasHoje = tempAlocs.filter(a =>
            a.professorId === professorId &&
            a.turmaId === t.id &&
            a.disciplinaId === lesson.disciplinaId &&
            a.diaSemana === dia
          ).length;
          const maxDia = planeItem?.maximoAulasPorDia ?? 2;
          if (aulasHoje >= maxDia) continue;

          // Can we displace occupier to another empty slot (dia_other, h_other)?
          for (const dia_other of DAYS_LIST) {
            if (allocatedMissing || alteredCount + 2 >= MAX_ALTERATIONS) break;
            for (let h_other = 1; h_other <= slotsPerDay; h_other++) {
              if (dia === dia_other && h === h_other) continue;

              // Is class free at (dia_other, h_other)?
              const classOccupiedOther = tempAlocs.some(a => a.turmaId === t.id && a.diaSemana === dia_other && a.horario === h_other);
              if (classOccupiedOther) continue;

              // Is occupier teacher available and free at (dia_other, h_other)?
              if (!isProfAvailableAt(occupierProf.disponibilidade, dia_other, h_other, tTurno)) continue;
              const occupierBusyOther = tempAlocs.some(a => {
                if (a.professorId !== occupierProf.id || a.diaSemana !== dia_other || a.horario !== h_other || a.id !== occupier.id) return false;
                const tOutra = turmas.find(tm => tm.id === a.turmaId);
                const tOutraTurno = tOutra?.turno || "manha";
                return tOutraTurno === tTurno;
              });
              if (occupierBusyOther) continue;

              // Validate moves
              const checkOccupier = verificarSlotViavelComMotivo(
                tempAlocs, professores, disciplinas, turmas, matriz, config,
                occupier.professorId, t.id, occupier.disciplinaId, dia_other, h_other, localRegras, occupier.id
              );
              if (!checkOccupier.viavel) continue;

              const checkNew = verificarSlotViavelComMotivo(
                tempAlocs, professores, disciplinas, turmas, matriz, config,
                professorId, t.id, lesson.disciplinaId, dia, h, localRegras, occupier.id
              );
              if (!checkNew.viavel) continue;

              // Move occupier
              tempAlocs[occupierIndex] = { ...occupier, diaSemana: dia_other, horario: h_other };

              // Add our new class
              const newAloc: Alocacao = {
                id: `repair-new-swap-${Date.now()}-${Math.random()}`,
                turmaId: t.id,
                disciplinaId: lesson.disciplinaId,
                professorId: professorId,
                diaSemana: dia,
                horario: h
              };
              tempAlocs.push(newAloc);

              alteredCount += 2;
              allocatedMissing = true;
              logs.push(`   → 🔄 Alocado por deslocamento! Moveu ${occupierProf.nomeCompleto} para (${dia_other.toUpperCase()}, ${h_other}) e colocou ${prof.nomeCompleto} em (${dia.toUpperCase()}, ${h}).`);
              break;
            }
          }
        }
      }
    }
  }

  const scoreAfter = getIqg(tempAlocs, turmas, professores, disciplinas, matriz);
  const currentConflictsCount = detectConflicts(tempAlocs, professores, disciplinas, turmas, matriz).filter((c: Conflito) => c.professorId === professorId).length;
  const isBetterOrEqual = scoreAfter >= scoreBefore || (profConflicts.length > 0 && currentConflictsCount < profConflicts.length);

  if (isBetterOrEqual && alteredCount > 0) {
    logs.push(`\n[Reparo Concluído com Sucesso]`);
    logs.push(`Total de modificações efetuadas na grade: ${alteredCount} (estabilidade mantida).`);
    logs.push(`IQG de: ${scoreBefore} -> ${scoreAfter} (+${(scoreAfter - scoreBefore).toFixed(1)} pontos).`);
    return { alocacoes: tempAlocs, logs, success: true, alteredCount, scoreBefore, scoreAfter };
  } else {
    logs.push(`\n[Reparo Abortado ou Sem Melhorias]`);
    logs.push(`Não foi possível resolver de forma segura sem introduzir novos conflitos ou exceder o limite de alterações.`);
    return { alocacoes: currentAlocacoes, logs, success: false, alteredCount: 0, scoreBefore, scoreAfter: scoreBefore };
  }
}
