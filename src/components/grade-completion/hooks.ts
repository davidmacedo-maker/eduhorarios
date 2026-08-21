import { useMemo } from "react";
import {
  useTurmas,
  useProfessores,
  useDisciplinas,
  useAlocacoes,
  useConfiguracaoHorarios,
  useMatrizCurricular,
} from "@/store";
import { validateSchedule } from "@/lib/allocation-engine";
import { detectConflicts, verificarSlotViavelComMotivo, isProfAvailableAt } from "@/lib/schedule-utils";
import type { Alocacao, Disciplina, Professor, Turma } from "@/types";

export interface PendingLessonItem {
  id: string;
  disciplina: Disciplina;
  professor: Professor;
  turma: Turma;
  planejado: number;
  alocado: number;
  restante: number;
  cor: "verde" | "amarelo" | "vermelho";
}

// 1. Hook: useRemainingLessons
export function useRemainingLessons() {
  const [turmas] = useTurmas();
  const [professores] = useProfessores();
  const [disciplinas] = useDisciplinas();
  const [alocacoes] = useAlocacoes();
  const [matriz] = useMatrizCurricular();

  return useMemo(() => {
    const items: PendingLessonItem[] = [];
    const usedIds = new Set<string>();

    // Scan through all professors and their planning items
    professores.forEach((prof) => {
      const planejamento = prof.planejamento ?? [];
      planejamento.forEach((plan) => {
        const tId = plan.turmaId;
        const dId = plan.disciplinaId;
        const planejado = Number(plan.aulasPorSemana !== undefined ? plan.aulasPorSemana : plan.quantidadeAulas) || 0;

        if (planejado <= 0) return;

        const turma = turmas.find((t) => t.id === tId);
        const disc = disciplinas.find((d) => d.id === dId);

        if (!turma || !disc) return;

        const alocado = alocacoes.filter(
          (a) => a.professorId === prof.id && a.turmaId === tId && a.disciplinaId === dId
        ).length;

        const restante = Math.max(0, planejado - alocado);

        let cor: "verde" | "amarelo" | "vermelho" = "verde";
        if (restante >= 3) {
          cor = "vermelho";
        } else if (restante > 0) {
          cor = "amarelo";
        }

        let itemId = `${prof.id}-${tId}-${dId}`;
        let counter = 1;
        while (usedIds.has(itemId)) {
          itemId = `${prof.id}-${tId}-${dId}-${counter}`;
          counter++;
        }
        usedIds.add(itemId);

        items.push({
          id: itemId,
          disciplina: disc,
          professor: prof,
          turma,
          planejado,
          alocado,
          restante,
          cor,
        });
      });
    });

    // Fallback search in matriz for combinations with no specific planning matched
    matriz.forEach((m) => {
      const alreadyHas = items.some((item) => item.turma.id === m.turmaId && item.disciplina.id === m.disciplinaId);
      if (alreadyHas) return;

      const turma = turmas.find((t) => t.id === m.turmaId);
      const disc = disciplinas.find((d) => d.id === m.disciplinaId);
      if (!turma || !disc) return;

      const getNomeBaseTurma = (name: string) => name.replace(/\s+(CONTRA|MATUTINO|VESPERTINO)/i, '').trim();

      // Find any professor who has this discipline/turma (checking both exact and base name matching for counter-shifts)
      const matchedProf = professores.find((p) => {
        const temDisc = p.disciplinas.includes(disc.id);
        if (!temDisc) return false;
        
        return p.turmas.some((pTurmaId) => {
          if (pTurmaId === turma.id) return true;
          const pt = turmas.find((t) => t.id === pTurmaId);
          if (!pt) return false;
          return getNomeBaseTurma(pt.nome) === getNomeBaseTurma(turma.nome);
        });
      });
      if (!matchedProf) return;

      const alocado = alocacoes.filter(
        (a) => a.professorId === matchedProf.id && a.turmaId === m.turmaId && a.disciplinaId === m.disciplinaId
      ).length;

      const planejado = m.aulasPorSemana ?? 0;
      const restante = Math.max(0, planejado - alocado);

      let cor: "verde" | "amarelo" | "vermelho" = "verde";
      if (restante >= 3) {
        cor = "vermelho";
      } else if (restante > 0) {
        cor = "amarelo";
      }

      let itemId = `${matchedProf.id}-${m.turmaId}-${m.disciplinaId}`;
      let counter = 1;
      while (usedIds.has(itemId)) {
        itemId = `${matchedProf.id}-${m.turmaId}-${m.disciplinaId}-${counter}`;
        counter++;
      }
      usedIds.add(itemId);

      items.push({
        id: itemId,
        disciplina: disc,
        professor: matchedProf,
        turma,
        planejado,
        alocado,
        restante,
        cor,
      });
    });

    // Sort by remaining count descending
    return items.sort((a, b) => b.restante - a.restante);
  }, [turmas, professores, disciplinas, alocacoes, matriz]);
}

// 2. Hook: useCompletionStats
export function useCompletionStats() {
  const [turmas] = useTurmas();
  const [professores] = useProfessores();
  const [disciplinas] = useDisciplinas();
  const [alocacoes] = useAlocacoes();
  const [matriz] = useMatrizCurricular();

  return useMemo(() => {
    const totalPlanned = matriz.reduce((sum, m) => sum + (Number(m.aulasPorSemana) || 0), 0);
    const totalAllocated = alocacoes.length;
    const remainingCount = Math.max(0, totalPlanned - totalAllocated);
    const percentConcluido = totalPlanned > 0 ? Math.round((totalAllocated / totalPlanned) * 100) : 0;

    const validation = validateSchedule(alocacoes, turmas, disciplinas, professores, matriz);
    const iqg = validation?.resumo?.iqg ?? 0;

    const conflicts = detectConflicts(alocacoes, professores, disciplinas, turmas, matriz);
    const conflictsCount = conflicts.length;

    // Count subjects complete and pending
    const subjectStatsMap = new Map<string, { planejado: number; alocado: number }>();
    professores.forEach((prof) => {
      (prof.planejamento ?? []).forEach((plan) => {
        const dId = plan.disciplinaId;
        const current = subjectStatsMap.get(dId) || { planejado: 0, alocado: 0 };
        const alocCount = alocacoes.filter(
          (a) => a.professorId === prof.id && a.turmaId === plan.turmaId && a.disciplinaId === dId
        ).length;
        const planVal = Number(plan.aulasPorSemana !== undefined ? plan.aulasPorSemana : plan.quantidadeAulas) || 0;
        subjectStatsMap.set(dId, {
          planejado: current.planejado + planVal,
          alocado: current.alocado + alocCount,
        });
      });
    });

    let completedSubjectsCount = 0;
    let pendingSubjectsCount = 0;

    subjectStatsMap.forEach((val) => {
      if (val.alocado >= val.planejado && val.planejado > 0) {
        completedSubjectsCount++;
      } else if (val.planejado > 0) {
        pendingSubjectsCount++;
      }
    });

    // Count slots
    // Total physical empty slots in the grid (only within valid shifts and school hours)
    // We can assume total slots across all active turmas
    const totalSlots = turmas.reduce((sum, t) => {
      // 5 days * 5 slots average (usually config tells us how many slots per day)
      // Let's use 5 or 6 as standard
      return sum + 5 * 6;
    }, 0);
    const freeSlots = Math.max(0, totalSlots - totalAllocated);

    return {
      completedSubjectsCount,
      pendingSubjectsCount,
      totalSubjectsCount: subjectStatsMap.size,
      remainingCount,
      freeSlots,
      blockedSlots: totalAllocated,
      conflictsCount,
      iqg,
      percentConcluido,
    };
  }, [turmas, professores, disciplinas, alocacoes, matriz]);
}

// 3. Hook: useSuggestedSlots
export interface SuggestedSlotItem {
  dia: string;
  horario: number;
  turno: "manha" | "tarde" | "noite";
  impactoIQG: number;
  stars: number;
  warning: string;
  scoreResultante: number;
}

export function useSuggestedSlots(
  profId: string | undefined,
  turmaId: string | undefined,
  discId: string | undefined,
  turno: "manha" | "tarde" | "noite" = "manha"
) {
  const [turmas] = useTurmas();
  const [professores] = useProfessores();
  const [disciplinas] = useDisciplinas();
  const [alocacoes] = useAlocacoes();
  const [config] = useConfiguracaoHorarios();
  const [matriz] = useMatrizCurricular();

  return useMemo(() => {
    if (!profId || !turmaId || !discId) return [];

    const suggestions: SuggestedSlotItem[] = [];
    const DIAS = ["segunda", "terca", "quarta", "quinta", "sexta"];
    
    // Get slots configuration based on shift
    let totalSlots = 5;
    if (turno === "tarde") totalSlots = config.quantidadeHorariosPorDiaTarde || 5;
    else if (turno === "noite") totalSlots = config.quantidadeHorariosPorDiaNoite || 4;
    else totalSlots = config.quantidadeHorariosPorDia || 6;

    const baseValidation = validateSchedule(alocacoes, turmas, disciplinas, professores, matriz);
    const currentIQG = baseValidation?.resumo?.iqg ?? 0;

    // Evaluate each slot
    for (const dia of DIAS) {
      for (let h = 1; h <= totalSlots; h++) {
        // Run verification
        const check = verificarSlotViavelComMotivo(
          alocacoes,
          professores,
          disciplinas,
          turmas,
          matriz,
          config,
          profId,
          turmaId,
          discId,
          dia,
          h
        );

        if (check.viavel) {
          // Simulate adding this lesson
          const simAloc: Alocacao = {
            id: `sim-${Date.now()}-${Math.random()}`,
            turmaId,
            disciplinaId: discId,
            professorId: profId,
            diaSemana: dia,
            horario: h,
          };
          const simList = [...alocacoes, simAloc];
          const simVal = validateSchedule(simList, turmas, disciplinas, professores, matriz);
          const simIQG = simVal?.resumo?.iqg ?? currentIQG;
          const delta = Math.round((simIQG - currentIQG) * 10) / 10;

          // Compute stars & warning info
          let stars = 3;
          let warning = "Sem conflitos";

          if (delta > 1) {
            stars = 5;
          } else if (delta >= 0) {
            stars = 4;
          } else {
            stars = 3;
            warning = "Decréscimo no IQG";
          }

          // Check if same-day class count for this subject in class is at max (conflito leve)
          const profObj = professores.find((p) => p.id === profId);
          const planItem = profObj?.planejamento?.find((p) => p.turmaId === turmaId && p.disciplinaId === discId);
          const maxDiario = planItem?.maximoAulasPorDia ?? 2;
          const sameDayCount = alocacoes.filter(
            (a) => a.turmaId === turmaId && a.disciplinaId === discId && a.diaSemana === dia
          ).length;

          if (sameDayCount >= maxDiario) {
            stars = Math.max(2, stars - 1);
            warning = "Conflito leve (Concentração)";
          }

          suggestions.push({
            dia,
            horario: h,
            turno,
            impactoIQG: delta,
            stars,
            warning,
            scoreResultante: simIQG,
          });
        }
      }
    }

    // Sort by IQG score resulting (highest first), then by stars descending
    return suggestions.sort((a, b) => b.scoreResultante - a.scoreResultante || b.stars - a.stars);
  }, [profId, turmaId, discId, turno, alocacoes, turmas, disciplinas, professores, matriz, config]);
}

// 4. Hook: useSlotRanking
export interface RankingOption {
  disciplina: Disciplina;
  professor: Professor;
  restante: number;
  viavel: boolean;
  motivo: string;
  impactoIQG: number;
  stars: number;
  status: string;
  scoreResultante: number;
}

export function useSlotRanking(
  dia: string | undefined,
  horario: number | undefined,
  turno: "manha" | "tarde" | "noite" = "manha",
  turmaId: string | undefined
) {
  const [turmas] = useTurmas();
  const [professores] = useProfessores();
  const [disciplinas] = useDisciplinas();
  const [alocacoes] = useAlocacoes();
  const [config] = useConfiguracaoHorarios();
  const [matriz] = useMatrizCurricular();

  return useMemo(() => {
    if (!dia || !horario || !turmaId) return [];

    const options: RankingOption[] = [];
    const baseValidation = validateSchedule(alocacoes, turmas, disciplinas, professores, matriz);
    const currentIQG = baseValidation?.resumo?.iqg ?? 0;

    // Scan disciplines matching this turma
    const turmaMatriz = matriz.filter((m) => m.turmaId === turmaId);

    turmaMatriz.forEach((matItem) => {
      const disc = disciplinas.find((d) => d.id === matItem.disciplinaId);
      if (!disc) return;

      // Find any professor assigned in planning for this (turma, disc)
      const possibleProfs = professores.filter((p) =>
        p.planejamento?.some((plan) => plan.turmaId === turmaId && plan.disciplinaId === disc.id) ||
        (p.disciplinas.includes(disc.id) && p.turmas.includes(turmaId))
      );

      possibleProfs.forEach((prof) => {
        const alocCount = alocacoes.filter(
          (a) => a.professorId === prof.id && a.turmaId === turmaId && a.disciplinaId === disc.id
        ).length;
        const planItem = prof.planejamento?.find((p) => p.turmaId === turmaId && p.disciplinaId === disc.id);
        const planejado = Number(planItem?.aulasPorSemana !== undefined ? planItem.aulasPorSemana : (planItem?.quantidadeAulas ?? matItem.aulasPorSemana ?? 0));
        const restante = Math.max(0, planejado - alocCount);

        const check = verificarSlotViavelComMotivo(
          alocacoes,
          professores,
          disciplinas,
          turmas,
          matriz,
          config,
          prof.id,
          turmaId,
          disc.id,
          dia,
          horario
        );

        let delta = 0;
        let scoreResultante = currentIQG;
        let stars = 3;
        let status = check.motivo || "Sem conflitos";

        if (check.viavel) {
          const simAloc: Alocacao = {
            id: `sim-rank-${Date.now()}-${Math.random()}`,
            turmaId,
            disciplinaId: disc.id,
            professorId: prof.id,
            diaSemana: dia,
            horario,
          };
          const simList = [...alocacoes, simAloc];
          const simVal = validateSchedule(simList, turmas, disciplinas, professores, matriz);
          scoreResultante = simVal?.resumo?.iqg ?? currentIQG;
          delta = Math.round((scoreResultante - currentIQG) * 10) / 10;

          if (delta > 1) {
            stars = 5;
          } else if (delta >= 0) {
            stars = 4;
          } else {
            stars = 3;
            status = "IQG Reduzido";
          }

          if (restante === 0) {
            stars = Math.max(1, stars - 2);
            status = "Carga já concluída";
          }
        } else {
          stars = 1;
        }

        options.push({
          disciplina: disc,
          professor: prof,
          restante,
          viavel: check.viavel,
          motivo: check.motivo || "",
          impactoIQG: delta,
          stars,
          status,
          scoreResultante,
        });
      });
    });

    // Sort: viavel first, then scoreResultante desc, then remaining desc
    return options.sort((a, b) => {
      if (a.viavel !== b.viavel) return a.viavel ? -1 : 1;
      return b.scoreResultante - a.scoreResultante || b.restante - a.restante;
    });
  }, [dia, horario, turno, turmaId, alocacoes, turmas, disciplinas, professores, matriz, config]);
}

// 5. Hook: useGradeProgress
export function useGradeProgress() {
  const [alocacoes] = useAlocacoes();
  const [matriz] = useMatrizCurricular();
  const [turmas] = useTurmas();

  return useMemo(() => {
    const totalPlanned = matriz.reduce((sum, m) => sum + (Number(m.aulasPorSemana) || 0), 0);
    const totalAllocated = alocacoes.length;
    const remainingCount = Math.max(0, totalPlanned - totalAllocated);
    const progressPercent = totalPlanned > 0 ? Math.round((totalAllocated / totalPlanned) * 100) : 0;

    let completeClassesCount = 0;
    let incompleteClassesCount = 0;

    turmas.forEach((t) => {
      const plannedForClass = matriz
        .filter((m) => m.turmaId === t.id)
        .reduce((sum, m) => sum + m.aulasPorSemana, 0);
      const allocatedForClass = alocacoes.filter((a) => a.turmaId === t.id).length;

      if (allocatedForClass >= plannedForClass && plannedForClass > 0) {
        completeClassesCount++;
      } else if (plannedForClass > 0) {
        incompleteClassesCount++;
      }
    });

    return {
      totalPlanned,
      totalAllocated,
      progressPercent,
      remainingCount,
      completeClassesCount,
      incompleteClassesCount,
    };
  }, [alocacoes, matriz, turmas]);
}
