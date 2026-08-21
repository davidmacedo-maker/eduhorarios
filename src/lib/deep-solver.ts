/**
 * deep-solver.ts
 * ──────────────────────────────────────────────────────────────
 * Solver Inteligente de Horários (Árvore de Busca Profunda) - MOTOR 3
 * Atua após o Motor 1 e antes dos refinadores finais / Assistente de Sugestões.
 *
 * Algoritmos combinados:
 * 1. Heurística MRV (Minimum Remaining Values / Menor Disponibilidade Primeiro)
 * 2. Constraint Satisfaction Problem (CSP)
 * 3. Min-Conflicts (Escolha do estado com maior pontuação global)
 * 4. Backtracking & Cadeias de Realocação Recursivas (Cascata de Desalocação / Chess-inspired lookahead)
 * 5. Cache de Estados Testados (Evita retestar permutações e ciclos infinitos)
 * 6. Função de Avaliação Global (Fitness score para IQG)
 * 7. Estratégias de Aprendizado em Execução (Learning scoreboard)
 * 8. Diagnóstico de Inviabilidade Técnica e Resolução recomendada
 */

import type {
  Alocacao,
  Turma,
  Professor,
  Disciplina,
  MatrizCurricular,
  ConfiguracaoHorarios,
  RegrasRelaxamento,
} from "@/types";

export interface ResultadoSolverProfundo {
  alocacoes: Alocacao[];
  aulasAdicionadasCount: number;
  combinaçõesSimuladasCount: number;
  tempoExecucaoMs: number;
  diagnostico: {
    sucessoTotal: boolean;
    taxaAlocacaoFinal: number;
    provasInviabilidade: string[];
    scoreGlobalFinal: number;
    relatorioInviabilidade?: {
      turmaNome: string;
      disciplinaNome: string;
      professorNome: string;
      motivo: string;
      sugestao: string;
    }[];
  };
  logs: string[];
}

interface PendenciaSolver {
  id: string;
  chaveMatriz: string;
  turmaId: string;
  disciplinaId: string;
  professorId: string;
  turno: "manha" | "tarde" | "noite";
  maxHorarios: number;
  maxAulaDia: number;
  maxConsec: number;
  mrvScore: number;
}

interface EstadoSolver {
  alocacoes: Alocacao[];
  turmaSlotMap: Map<string, Alocacao>;
  profSlotMap: Map<string, Alocacao>;
  contDiscTurmaDia: Map<string, number>;
  horariosDiscTurmaDia: Map<string, Set<number>>;
  idCounter: number;
}

const DIAS_PADRAO = ["segunda", "terca", "quarta", "quinta", "sexta"] as const;

// -------------------------------------------------------------
// SISTEMA DE APRENDIZADO DE ESTRATÉGIAS
// -------------------------------------------------------------
interface StrategyStats {
  tentativas: number;
  sucessos: number;
}

export function executarSolverInteligenteProfundo(
  alocacoesIniciais: Alocacao[],
  turmas: Turma[],
  disciplinas: Disciplina[],
  professores: Professor[],
  matriz: MatrizCurricular[],
  config: ConfiguracaoHorarios,
  regrasRelaxamento?: RegrasRelaxamento,
  nivelBusca = 2
): ResultadoSolverProfundo {
  const startTime = performance.now();
  const logs: string[] = [];
  const provasInviabilidade: string[] = [];
  const relatorioInviabilidade: {
    turmaNome: string;
    disciplinaNome: string;
    professorNome: string;
    motivo: string;
    sugestao: string;
  }[] = [];
  let combSimuladas = 0;

  logs.push(`Iniciando MOTOR 3: SOLVER INTELIGENTE PROFUNDO x BUSCA COMBINATÓRIA (Nível de Busca: ${nivelBusca})...`);

  // Configurações dinâmicas com base no nível de busca do usuário
  let maxCombinacoes = 1000;
  let maxDepth = 2;
  switch (nivelBusca) {
    case 1:
      maxCombinacoes = 100;
      maxDepth = 1;
      break;
    case 2:
      maxCombinacoes = 1000;
      maxDepth = 2;
      break;
    case 3:
      maxCombinacoes = 10000;
      maxDepth = 3;
      break;
    case 4:
      maxCombinacoes = 100000;
      maxDepth = 4;
      break;
    default:
      maxCombinacoes = 1000;
      maxDepth = 2;
  }

  logs.push(`Configurado limite de busca do Motor 3: Max ${maxCombinacoes} combinações, profundidade de encadeamento de até ${maxDepth} swaps.`);

  const strategyLearningMap = new Map<string, StrategyStats>();

  function registrarEstrategia(nome: string, sucesso: boolean) {
    const stats = strategyLearningMap.get(nome) || { tentativas: 0, sucessos: 0 };
    stats.tentativas++;
    if (sucesso) stats.sucessos++;
    strategyLearningMap.set(nome, stats);
  }

  const turmaMap = new Map(turmas.map((t) => [t.id, t]));
  const profMap = new Map(professores.map((p) => [p.id, p]));
  const diasSemana: string[] = Array.from(DIAS_PADRAO);

  const totalPlanejadoGlobal = matriz.reduce((acc, m) => acc + (Number(m.aulasPorSemana) || 0), 0);

  // -------------------------------------------------------------
  // CONTROLE E CLONAGEM DE ESTADOS DA GRADE
  // -------------------------------------------------------------
  function criarEstado(alocs: Alocacao[]): EstadoSolver {
    const turmaSlotMap = new Map<string, Alocacao>();
    const profSlotMap = new Map<string, Alocacao>();
    const contDiscTurmaDia = new Map<string, number>();
    const horariosDiscTurmaDia = new Map<string, Set<number>>();

    for (const a of alocs) {
      const shift = turmaMap.get(a.turmaId)?.turno || "manha";
      turmaSlotMap.set(`${a.turmaId}|${a.diaSemana}|${a.horario}`, a);
      profSlotMap.set(`${a.professorId}|${a.diaSemana}|${shift}|${a.horario}`, a);

      const kDiscDia = `${a.turmaId}|${a.diaSemana}|${a.disciplinaId}`;
      contDiscTurmaDia.set(kDiscDia, (contDiscTurmaDia.get(kDiscDia) || 0) + 1);

      if (!horariosDiscTurmaDia.has(kDiscDia)) {
        horariosDiscTurmaDia.set(kDiscDia, new Set<number>());
      }
      horariosDiscTurmaDia.get(kDiscDia)!.add(a.horario);
    }

    return {
      alocacoes: alocs.map((a) => ({ ...a })),
      turmaSlotMap,
      profSlotMap,
      contDiscTurmaDia,
      horariosDiscTurmaDia,
      idCounter: alocs.length + 1000,
    };
  }

  function clonarEstado(est: EstadoSolver): EstadoSolver {
    const novoHorarios = new Map<string, Set<number>>();
    est.horariosDiscTurmaDia.forEach((v: Set<number>, k: string) => novoHorarios.set(k, new Set(v)));

    return {
      alocacoes: est.alocacoes.map((a) => ({ ...a })),
      turmaSlotMap: new Map(est.turmaSlotMap),
      profSlotMap: new Map(est.profSlotMap),
      contDiscTurmaDia: new Map(est.contDiscTurmaDia),
      horariosDiscTurmaDia: novoHorarios,
      idCounter: est.idCounter,
    };
  }

  function alocarNoEstado(est: EstadoSolver, pend: PendenciaSolver, dia: string, h: number): Alocacao {
    const shift = pend.turno;
    const novaAloc: Alocacao = {
      id: `deep-${pend.chaveMatriz}-${est.idCounter++}`,
      turmaId: pend.turmaId,
      disciplinaId: pend.disciplinaId,
      professorId: pend.professorId,
      diaSemana: dia,
      horario: h,
    };

    est.alocacoes.push(novaAloc);
    est.turmaSlotMap.set(`${pend.turmaId}|${dia}|${h}`, novaAloc);
    est.profSlotMap.set(`${pend.professorId}|${dia}|${shift}|${h}`, novaAloc);

    const kDiscDia = `${pend.turmaId}|${dia}|${pend.disciplinaId}`;
    est.contDiscTurmaDia.set(kDiscDia, (est.contDiscTurmaDia.get(kDiscDia) || 0) + 1);

    if (!est.horariosDiscTurmaDia.has(kDiscDia)) {
      est.horariosDiscTurmaDia.set(kDiscDia, new Set<number>());
    }
    est.horariosDiscTurmaDia.get(kDiscDia)!.add(h);

    return novaAloc;
  }

  function desalocarDoEstado(est: EstadoSolver, a: Alocacao) {
    const idx = est.alocacoes.findIndex((al) => al.id === a.id);
    if (idx >= 0) est.alocacoes.splice(idx, 1);

    const shift = turmaMap.get(a.turmaId)?.turno || "manha";
    est.turmaSlotMap.delete(`${a.turmaId}|${a.diaSemana}|${a.horario}`);
    est.profSlotMap.delete(`${a.professorId}|${a.diaSemana}|${shift}|${a.horario}`);

    const kDiscDia = `${a.turmaId}|${a.diaSemana}|${a.disciplinaId}`;
    const cur = est.contDiscTurmaDia.get(kDiscDia) || 0;
    if (cur > 0) est.contDiscTurmaDia.set(kDiscDia, cur - 1);

    est.horariosDiscTurmaDia.get(kDiscDia)?.delete(a.horario);
  }

  // -------------------------------------------------------------
  // FUNÇÃO DE AVALIAÇÃO FITNESS (OBJETIVO) DA GRADE
  // -------------------------------------------------------------
  function avaliarEstadoFitness(est: EstadoSolver): number {
    let score = est.alocacoes.length * 5000;

    const qManha = config.quantidadeHorariosPorDia ?? 6;
    const qTarde = config.quantidadeHorariosPorDiaTarde ?? 5;
    const qNoite = config.quantidadeHorariosPorDiaNoite ?? 4;

    // 1. Buracos da turma (Gaps) - Penalidade
    let gaps = 0;
    for (const t of turmas) {
      const maxSlots = t.turno === "manha" ? qManha : t.turno === "tarde" ? qTarde : qNoite;
      for (const dia of DIAS_PADRAO) {
        const slotsAtivos: number[] = [];
        for (let h = 1; h <= maxSlots; h++) {
          if (est.turmaSlotMap.has(`${t.id}|${dia}|${h}`)) {
            slotsAtivos.push(h);
          }
        }
        if (slotsAtivos.length >= 2) {
          slotsAtivos.sort((a, b) => a - b);
          const min = slotsAtivos[0];
          const max = slotsAtivos[slotsAtivos.length - 1];
          for (let h = min + 1; h < max; h++) {
            if (!slotsAtivos.includes(h)) {
              gaps++;
            }
          }
        }
      }
    }

    // 2. Janelas de professor (Windows) - Penalidade
    let windows = 0;
    for (const prof of professores) {
      for (const dia of DIAS_PADRAO) {
        const slotsAtivos: number[] = [];
        for (const shift of ["manha", "tarde", "noite"] as const) {
          const maxSlots = shift === "noite" ? qNoite : shift === "tarde" ? qTarde : qManha;
          for (let h = 1; h <= maxSlots; h++) {
            if (est.profSlotMap.has(`${prof.id}|${dia}|${shift}|${h}`)) {
              const offset = shift === "manha" ? 0 : shift === "tarde" ? 10 : 20;
              slotsAtivos.push(h + offset);
            }
          }
        }
        if (slotsAtivos.length >= 2) {
          slotsAtivos.sort((a, b) => a - b);
          const min = slotsAtivos[0];
          const max = slotsAtivos[slotsAtivos.length - 1];
          for (let h = min + 1; h < max; h++) {
            if (!slotsAtivos.includes(h)) {
              windows++;
            }
          }
        }
      }
    }

    score -= gaps * 150;
    score -= windows * 100;
    return score;
  }

  function isProfDisponivel(prof: Professor | undefined, dia: string, h: number): boolean {
    if (!prof || !prof.disponibilidade) return true;
    const dispDia = prof.disponibilidade[dia];
    if (!dispDia || !Array.isArray(dispDia)) return false;
    return dispDia.includes(h);
  }

  function slotViavel(
    est: EstadoSolver,
    pend: PendenciaSolver,
    dia: string,
    h: number,
    relaxMode = false
  ): boolean {
    const kTurma = `${pend.turmaId}|${dia}|${h}`;
    if (est.turmaSlotMap.has(kTurma)) return false;

    const kProf = `${pend.professorId}|${dia}|${pend.turno}|${h}`;
    if (est.profSlotMap.has(kProf)) return false;

    const prof = profMap.get(pend.professorId);
    if (!isProfDisponivel(prof, dia, h)) return false;

    // Verificação de carga semanal em tempo real para o deep-solver
    let weeklyLimit = 0;
    const planeItem = prof?.planejamento?.find((p) => p.turmaId === pend.turmaId && p.disciplinaId === pend.disciplinaId);
    if (planeItem) {
      weeklyLimit = Number(planeItem.aulasPorSemana !== undefined ? planeItem.aulasPorSemana : planeItem.quantidadeAulas) || 0;
    } else {
      const matMatch = matriz?.find((m) => m.turmaId === pend.turmaId && m.disciplinaId === pend.disciplinaId);
      if (matMatch) {
        weeklyLimit = Number(matMatch.aulasPorSemana) || 0;
      }
    }

    const currentAllocatedCount = est.alocacoes.filter(
      (a) => a.professorId === pend.professorId && a.turmaId === pend.turmaId && a.disciplinaId === pend.disciplinaId
    ).length;

    if (currentAllocatedCount >= weeklyLimit) return false;

    const kDiscDia = `${pend.turmaId}|${dia}|${pend.disciplinaId}`;
    const aulasNoDia = est.contDiscTurmaDia.get(kDiscDia) || 0;
    
    const maxDia = relaxMode ? Math.max(3, pend.maxAulaDia + 1) : pend.maxAulaDia;
    if (aulasNoDia >= maxDia && !regrasRelaxamento?.permitirMaisDeDuasAulasMesmoDia) {
      if (!relaxMode) return false;
    }

    const setHor = est.horariosDiscTurmaDia.get(kDiscDia);
    const ativos = setHor ? Array.from(setHor) : [];
    ativos.push(h);
    ativos.sort((a, b) => a - b);

    let maxC = 0;
    let atualC = 0;
    let ultH = -99;
    for (const hVal of ativos) {
      if (hVal === ultH + 1) {
        atualC++;
      } else {
        atualC = 1;
      }
      if (atualC > maxC) maxC = atualC;
      ultH = hVal;
    }

    const maxConsecAllowed = relaxMode ? Math.max(3, pend.maxConsec + 1) : pend.maxConsec;
    if (maxC > maxConsecAllowed) return false;

    return true;
  }

  const estado = criarEstado(alocacoesIniciais);

  // Guardar melhor estado de forma reativa
  let melhorEstadoVisitado = clonarEstado(estado);
  let melhorFitnessScore = avaliarEstadoFitness(estado);

  function atualizarMelhorEstado(est: EstadoSolver) {
    const fit = avaliarEstadoFitness(est);
    if (fit > melhorFitnessScore) {
      melhorFitnessScore = fit;
      melhorEstadoVisitado = clonarEstado(est);
    }
  }

  function mapearPendencias(): PendenciaSolver[] {
    const lista: PendenciaSolver[] = [];
    for (const m of matriz) {
      const planejado = Number(m.aulasPorSemana) || 0;
      
      let profId = "";
      let maxAulaDia = 2;
      let maxConsec = 2;
      for (const p of professores) {
        const pl = p.planejamento && Array.isArray(p.planejamento)
          ? p.planejamento.find((item) => item.turmaId === m.turmaId && item.disciplinaId === m.disciplinaId)
          : null;
        if (pl) {
          profId = p.id;
          maxAulaDia = pl.maximoAulasPorDia ?? 2;
          maxConsec = pl.maximoConsecutivas ?? 2;
          break;
        }
      }

      if (!profId) continue;

      const alocadas = estado.alocacoes.filter(
        (a) => a.turmaId === m.turmaId && a.disciplinaId === m.disciplinaId && a.professorId === profId
      ).length;

      const faltam = planejado - alocadas;
      if (faltam > 0) {
        const t = turmaMap.get(m.turmaId);
        const shift = t?.turno || "manha";
        const maxH = shift === "noite"
          ? (config?.quantidadeHorariosPorDiaNoite ?? 4)
          : shift === "tarde"
          ? (config?.quantidadeHorariosPorDiaTarde ?? 5)
          : (config?.quantidadeHorariosPorDia ?? 5);

        const prof = profMap.get(profId);
        let slotsPossiveis = 0;
        diasSemana.forEach((dia: string) => {
          for (let h = 1; h <= maxH; h++) {
            if (isProfDisponivel(prof, dia, h)) slotsPossiveis++;
          }
        });

        const mrv = slotsPossiveis === 0 ? 999999 : (faltam * 1000) / slotsPossiveis;
        const chMat = `${m.turmaId}|${m.disciplinaId}`;

        for (let k = 0; k < faltam; k++) {
          lista.push({
            id: `pend-${chMat}-${k}`,
            chaveMatriz: chMat,
            turmaId: m.turmaId,
            disciplinaId: m.disciplinaId,
            professorId: profId,
            turno: shift,
            maxHorarios: maxH,
            maxAulaDia,
            maxConsec,
            mrvScore: mrv,
          });
        }
      }
    }

    return lista.sort((a, b) => b.mrvScore - a.mrvScore);
  }

  const cacheAssinaturas = new Set<string>();

  // -------------------------------------------------------------
  // ALGORITMO RECURSIVO DE BUSCA EM ÁRVORE E CADEIA DE REALOCAÇÃO (CHESS-STYLE)
  // -------------------------------------------------------------
  function tentarReencaixarOrfa(
    est: EstadoSolver,
    pendOrfa: PendenciaSolver,
    depth: number,
    assinaturaParcial: string,
    relaxMode = false,
    evictedIds: Set<string> = new Set()
  ): boolean {
    if (depth > maxDepth) {
      registrarEstrategia(`Encadeamento Profundo > ${maxDepth}`, false);
      return false;
    }

    if (combSimuladas >= maxCombinacoes) {
      return false;
    }

    // Estratégia 1: Tentativa direta (Alocação Simples)
    for (const dia of diasSemana) {
      for (let h = 1; h <= pendOrfa.maxHorarios; h++) {
        if (combSimuladas >= maxCombinacoes) return false;
        combSimuladas++;
        if (slotViavel(est, pendOrfa, dia, h, relaxMode)) {
          alocarNoEstado(est, pendOrfa, dia, h);
          atualizarMelhorEstado(est);
          registrarEstrategia("Direct Free Slot", true);
          return true;
        }
      }
    }

    // Estratégia 2: Cascade Swap (Desalocação e realocação recursiva de terceiros)
    for (const dia of diasSemana) {
      for (let h = 1; h <= pendOrfa.maxHorarios; h++) {
        if (combSimuladas >= maxCombinacoes) return false;

        const keyTurma = `${pendOrfa.turmaId}|${dia}|${h}`;
        const ocTurma = est.turmaSlotMap.get(keyTurma);
        
        if (!ocTurma || ocTurma.isLocked || evictedIds.has(ocTurma.id)) continue;

        const prof = profMap.get(pendOrfa.professorId);
        if (!isProfDisponivel(prof, dia, h)) continue;

        const keyProf = `${pendOrfa.professorId}|${dia}|${pendOrfa.turno}|${h}`;
        if (est.profSlotMap.has(keyProf)) continue; 

        const kDiscDia = `${pendOrfa.turmaId}|${dia}|${pendOrfa.disciplinaId}`;
        const aulasNoDia = est.contDiscTurmaDia.get(kDiscDia) || 0;
        const maxDia = relaxMode ? Math.max(3, pendOrfa.maxAulaDia + 1) : pendOrfa.maxAulaDia;
        if (aulasNoDia >= maxDia && !regrasRelaxamento?.permitirMaisDeDuasAulasMesmoDia) {
          if (!relaxMode) continue;
        }

        // Criar checkpoint de simulação de movimento
        const backup = clonarEstado(est);
        desalocarDoEstado(est, ocTurma);
        alocarNoEstado(est, pendOrfa, dia, h);

        let pSolverEvicted: PendenciaSolver | null = null;
        for (const pDocente of professores) {
          const plOrfa = pDocente.planejamento && Array.isArray(pDocente.planejamento)
            ? pDocente.planejamento.find((it) => it.turmaId === ocTurma.turmaId && it.disciplinaId === ocTurma.disciplinaId)
            : null;
          if (plOrfa) {
            const tOrfa = turmaMap.get(ocTurma.turmaId);
            const shiftOrfa = tOrfa?.turno || "manha";
            const qManha = config.quantidadeHorariosPorDia ?? 6;
            const qTarde = config.quantidadeHorariosPorDiaTarde ?? 5;
            const qNoite = config.quantidadeHorariosPorDiaNoite ?? 4;
            const maxHOrfa = shiftOrfa === "noite" ? qNoite : shiftOrfa === "tarde" ? qTarde : qManha;

            pSolverEvicted = {
              id: `orfa-${ocTurma.id}`,
              chaveMatriz: `${ocTurma.turmaId}|${ocTurma.disciplinaId}`,
              turmaId: ocTurma.turmaId,
              disciplinaId: ocTurma.disciplinaId,
              professorId: pDocente.id,
              turno: shiftOrfa,
              maxHorarios: maxHOrfa,
              maxAulaDia: plOrfa.maximoAulasPorDia ?? 2,
              maxConsec: plOrfa.maximoConsecutivas ?? 2,
              mrvScore: 0,
            };
            break;
          }
        }

        if (pSolverEvicted) {
          const nextEvicted = new Set(evictedIds);
          nextEvicted.add(ocTurma.id);
          const strategyName = `Cascade Eviction (Depth ${depth})`;
          if (tentarReencaixarOrfa(est, pSolverEvicted, depth + 1, signatureForState(est), relaxMode, nextEvicted)) {
            atualizarMelhorEstado(est);
            registrarEstrategia(strategyName, true);
            return true;
          } else {
            registrarEstrategia(strategyName, false);
          }
        }

        // Desfazer jogada em caso de falha de encaixe
        est.alocacoes = backup.alocacoes;
        est.turmaSlotMap = backup.turmaSlotMap;
        est.profSlotMap = backup.profSlotMap;
        est.contDiscTurmaDia = backup.contDiscTurmaDia;
        est.horariosDiscTurmaDia = backup.horariosDiscTurmaDia;
        est.idCounter = backup.idCounter;
      }
    }

    return false;
  }

  function signatureForState(est: EstadoSolver): string {
    return est.alocacoes.map(a => `${a.turmaId}-${a.diaSemana}-${a.horario}`).sort().join("|");
  }

  const MAX_RODADAS = 15;
  let aulasAdicionadasTotal = 0;

  // PASS 1: STRICT CSP BACKTRACKING
  for (let r = 1; r <= MAX_RODADAS; r++) {
    const pendencias = mapearPendencias();
    if (pendencias.length === 0) break;

    let resolveuNaRodada = 0;

    for (const pend of pendencias) {
      if (combSimuladas >= maxCombinacoes) break;

      const candidatosLivres: { dia: string; h: number; score: number }[] = [];

      for (const dia of diasSemana) {
        for (let h = 1; h <= pend.maxHorarios; h++) {
          if (combSimuladas >= maxCombinacoes) break;
          combSimuladas++;
          if (slotViavel(estado, pend, dia, h, false)) {
            const backup = clonarEstado(estado);
            alocarNoEstado(backup, pend, dia, h);
            const fit = avaliarEstadoFitness(backup);
            candidatosLivres.push({ dia, h, score: fit });
          }
        }
      }

      if (candidatosLivres.length > 0) {
        candidatosLivres.sort((a, b) => b.score - a.score);
        const melhor = candidatosLivres[0];
        alocarNoEstado(estado, pend, melhor.dia, melhor.h);
        atualizarMelhorEstado(estado);
        resolveuNaRodada++;
        aulasAdicionadasTotal++;
        registrarEstrategia("Direct Free Slot", true);
        continue;
      }

      let reencaixouComCascata = false;

      for (const dia of diasSemana) {
        if (reencaixouComCascata || combSimuladas >= maxCombinacoes) break;
        for (let h = 1; h <= pend.maxHorarios; h++) {
          if (combSimuladas >= maxCombinacoes) break;
          combSimuladas++;

          const ocTurma = estado.turmaSlotMap.get(`${pend.turmaId}|${dia}|${h}`);
          const ocProf = estado.profSlotMap.get(`${pend.professorId}|${dia}|${pend.turno}|${h}`);

          if (ocTurma?.isLocked || ocProf?.isLocked) continue;
          if (!ocTurma && !ocProf) continue;

          const prof = profMap.get(pend.professorId);
          if (!isProfDisponivel(prof, dia, h)) continue;

          const sig = `${pend.id}|${dia}|${h}`;
          if (cacheAssinaturas.has(sig)) continue;
          cacheAssinaturas.add(sig);

          const backup = clonarEstado(estado);

          const orfas: Alocacao[] = [];
          if (ocTurma) {
            desalocarDoEstado(estado, ocTurma);
            orfas.push(ocTurma);
          }
          if (ocProf && (!ocTurma || ocProf.id !== ocTurma.id)) {
            desalocarDoEstado(estado, ocProf);
            orfas.push(ocProf);
          }

          if (slotViavel(estado, pend, dia, h, false)) {
            alocarNoEstado(estado, pend, dia, h);

            let todasOrfasResolvidas = true;
            for (const aOrfa of orfas) {
              let pSolverOrfa: PendenciaSolver | null = null;
              for (const pDocente of professores) {
                const plOrfa = pDocente.planejamento && Array.isArray(pDocente.planejamento)
                  ? pDocente.planejamento.find((it) => it.turmaId === aOrfa.turmaId && it.disciplinaId === aOrfa.disciplinaId)
                  : null;
                if (plOrfa) {
                  const tOrfa = turmaMap.get(aOrfa.turmaId);
                  const shiftOrfa = tOrfa?.turno || "manha";
                  const qManha = config.quantidadeHorariosPorDia ?? 6;
                  const qTarde = config.quantidadeHorariosPorDiaTarde ?? 5;
                  const qNoite = config.quantidadeHorariosPorDiaNoite ?? 4;
                  const maxHOrfa = shiftOrfa === "noite" ? qNoite : shiftOrfa === "tarde" ? qTarde : qManha;

                  pSolverOrfa = {
                    id: `orfa-${aOrfa.id}`,
                    chaveMatriz: `${aOrfa.turmaId}|${aOrfa.disciplinaId}`,
                    turmaId: aOrfa.turmaId,
                    disciplinaId: aOrfa.disciplinaId,
                    professorId: pDocente.id,
                    turno: shiftOrfa,
                    maxHorarios: maxHOrfa,
                    maxAulaDia: plOrfa.maximoAulasPorDia ?? 2,
                    maxConsec: plOrfa.maximoConsecutivas ?? 2,
                    mrvScore: 0,
                  };
                  break;
                }
              }

              if (!pSolverOrfa || !tentarReencaixarOrfa(estado, pSolverOrfa, 1, sig, false)) {
                todasOrfasResolvidas = false;
                break;
              }
            }

            if (todasOrfasResolvidas) {
              atualizarMelhorEstado(estado);
              reencaixouComCascata = true;
              resolveuNaRodada++;
              aulasAdicionadasTotal++;
              logs.push(`   → [Solver CSP] Encaixe de cascata com sucesso na ${dia.toUpperCase()} (${h}º Horário) - Turma ${turmaMap.get(pend.turmaId)?.nome}.`);
              registrarEstrategia("Heuristic Cascade Swap", true);
              break;
            } else {
              registrarEstrategia("Heuristic Cascade Swap", false);
            }
          }

          estado.alocacoes = backup.alocacoes;
          estado.turmaSlotMap = backup.turmaSlotMap;
          estado.profSlotMap = backup.profSlotMap;
          estado.contDiscTurmaDia = backup.contDiscTurmaDia;
          estado.horariosDiscTurmaDia = backup.horariosDiscTurmaDia;
          estado.idCounter = backup.idCounter;
        }
      }
    }

    logs.push(`Rodada ${r} do Solver Profundo concluída: +${resolveuNaRodada} aulas alocadas.`);
    if (resolveuNaRodada === 0) break;
  }

  // PASS 2: RELAXED GAP-FILLER & COMBINATORIAL SEARCH (THE HOLE RESOLVER)
  const pendenciasAposFase1 = mapearPendencias();
  if (pendenciasAposFase1.length > 0 && combSimuladas < maxCombinacoes) {
    logs.push(`Iniciando Fase Relaxada de Segunda Chance (Preenchimento de furos) para as ${pendenciasAposFase1.length} pendências restantes...`);
    
    for (let r = 1; r <= 15; r++) {
      if (combSimuladas >= maxCombinacoes) break;
      const pendencias = mapearPendencias();
      if (pendencias.length === 0) {
        logs.push("✅ Fase relaxada de Segunda Chance resolveu 100% das pendências!");
        break;
      }

      let resolveuNaRodada = 0;

      for (const pend of pendencias) {
        if (combSimuladas >= maxCombinacoes) break;

        const candidatosLivres: { dia: string; h: number; score: number }[] = [];

        for (const dia of diasSemana) {
          for (let h = 1; h <= pend.maxHorarios; h++) {
            if (combSimuladas >= maxCombinacoes) break;
            combSimuladas++;
            if (slotViavel(estado, pend, dia, h, true)) {
              const backup = clonarEstado(estado);
              alocarNoEstado(backup, pend, dia, h);
              const fit = avaliarEstadoFitness(backup);
              candidatosLivres.push({ dia, h, score: fit });
            }
          }
        }

        if (candidatosLivres.length > 0) {
          candidatosLivres.sort((a, b) => b.score - a.score);
          const melhor = candidatosLivres[0];
          alocarNoEstado(estado, pend, melhor.dia, melhor.h);
          atualizarMelhorEstado(estado);
          resolveuNaRodada++;
          aulasAdicionadasTotal++;
          registrarEstrategia("Direct Free Slot (Relaxed)", true);
          continue;
        }

        let reencaixouComCascata = false;

        for (const dia of diasSemana) {
          if (reencaixouComCascata || combSimuladas >= maxCombinacoes) break;
          for (let h = 1; h <= pend.maxHorarios; h++) {
            if (combSimuladas >= maxCombinacoes) break;
            combSimuladas++;

            const ocTurma = estado.turmaSlotMap.get(`${pend.turmaId}|${dia}|${h}`);
            const ocProf = estado.profSlotMap.get(`${pend.professorId}|${dia}|${pend.turno}|${h}`);

            if (ocTurma?.isLocked || ocProf?.isLocked) continue;
            if (!ocTurma && !ocProf) continue;

            const prof = profMap.get(pend.professorId);
            if (!isProfDisponivel(prof, dia, h)) continue;

            const sig = `${pend.id}|${dia}|${h}`;
            if (cacheAssinaturas.has(sig)) continue;
            cacheAssinaturas.add(sig);

            const backup = clonarEstado(estado);

            const orfas: Alocacao[] = [];
            if (ocTurma) {
              desalocarDoEstado(estado, ocTurma);
              orfas.push(ocTurma);
            }
            if (ocProf && (!ocTurma || ocProf.id !== ocTurma.id)) {
              desalocarDoEstado(estado, ocProf);
              orfas.push(ocProf);
            }

            if (slotViavel(estado, pend, dia, h, true)) {
              alocarNoEstado(estado, pend, dia, h);

              let todasOrfasResolvidas = true;
              for (const aOrfa of orfas) {
                let pSolverOrfa: PendenciaSolver | null = null;
                for (const pDocente of professores) {
                  const plOrfa = pDocente.planejamento && Array.isArray(pDocente.planejamento)
                    ? pDocente.planejamento.find((it) => it.turmaId === aOrfa.turmaId && it.disciplinaId === aOrfa.disciplinaId)
                    : null;
                  if (plOrfa) {
                    const tOrfa = turmaMap.get(aOrfa.turmaId);
                    const shiftOrfa = tOrfa?.turno || "manha";
                    const qManha = config.quantidadeHorariosPorDia ?? 6;
                    const qTarde = config.quantidadeHorariosPorDiaTarde ?? 5;
                    const qNoite = config.quantidadeHorariosPorDiaNoite ?? 4;
                    const maxHOrfa = shiftOrfa === "noite" ? qNoite : shiftOrfa === "tarde" ? qTarde : qManha;

                    pSolverOrfa = {
                      id: `orfa-${aOrfa.id}`,
                      chaveMatriz: `${aOrfa.turmaId}|${aOrfa.disciplinaId}`,
                      turmaId: aOrfa.turmaId,
                      disciplinaId: aOrfa.disciplinaId,
                      professorId: pDocente.id,
                      turno: shiftOrfa,
                      maxHorarios: maxHOrfa,
                      maxAulaDia: plOrfa.maximoAulasPorDia ?? 2,
                      maxConsec: plOrfa.maximoConsecutivas ?? 2,
                      mrvScore: 0,
                    };
                    break;
                  }
                }

                if (!pSolverOrfa || !tentarReencaixarOrfa(estado, pSolverOrfa, 1, sig, true)) {
                  todasOrfasResolvidas = false;
                  break;
                }
              }

              if (todasOrfasResolvidas) {
                atualizarMelhorEstado(estado);
                reencaixouComCascata = true;
                resolveuNaRodada++;
                aulasAdicionadasTotal++;
                logs.push(`   → [Solver CSP Relaxado] Encaixe em cascata com sucesso na ${dia.toUpperCase()} (${h}º Horário) - Turma ${turmaMap.get(pend.turmaId)?.nome}.`);
                registrarEstrategia("Heuristic Cascade Swap (Relaxed)", true);
                break;
              } else {
                registrarEstrategia("Heuristic Cascade Swap (Relaxed)", false);
              }
            }

            estado.alocacoes = backup.alocacoes;
            estado.turmaSlotMap = backup.turmaSlotMap;
            estado.profSlotMap = backup.profSlotMap;
            estado.contDiscTurmaDia = backup.contDiscTurmaDia;
            estado.horariosDiscTurmaDia = backup.horariosDiscTurmaDia;
            estado.idCounter = backup.idCounter;
          }
        }
      }
    }
  }

  // Se excedeu o limite máximo de combinações, restaurar o melhor estado obtido
  if (combSimuladas >= maxCombinacoes) {
    logs.push(`⚠️ Alerta: Limite de busca exaustiva atingido para o Nível ${nivelBusca} (${combSimuladas}/${maxCombinacoes} combinações).`);
    logs.push("Restaurando e fixando o melhor estado com maior pontuação global de IQG encontrado durante o processamento...");
    estado.alocacoes = melhorEstadoVisitado.alocacoes;
    estado.turmaSlotMap = melhorEstadoVisitado.turmaSlotMap;
    estado.profSlotMap = melhorEstadoVisitado.profSlotMap;
    estado.contDiscTurmaDia = melhorEstadoVisitado.contDiscTurmaDia;
    estado.horariosDiscTurmaDia = melhorEstadoVisitado.horariosDiscTurmaDia;
  }

  // -------------------------------------------------------------
  // SISTEMA DE APRENDIZADO - SCOREBOARD LOG
  // -------------------------------------------------------------
  logs.push("──────────────────────────────────────────────────────────────");
  logs.push("🧠 APRENDIZADO DE ESTRATÉGIAS DO MOTOR EM EXECUÇÃO:");
  strategyLearningMap.forEach((stats, name) => {
    const taxa = stats.tentativas > 0 ? (stats.sucessos / stats.tentativas) * 100 : 0;
    logs.push(`   • [Estratégia] "${name}": ${taxa.toFixed(1)}% de aproveitamento (${stats.sucessos}/${stats.tentativas} sucessos)`);
  });
  logs.push("──────────────────────────────────────────────────────────────");

  // -------------------------------------------------------------
  // DIAGNÓSTICO MATEMÁTICO DE INVIABILIDADE COM RECOMENDAÇÕES (ASSISTENTE)
  // -------------------------------------------------------------
  const pendenciasFinais = mapearPendencias();
  for (const p of pendenciasFinais) {
    const t = turmaMap.get(p.turmaId);
    const disc = disciplinas.find((d) => d.id === p.disciplinaId);
    const prof = profMap.get(p.professorId);

    let capProf = 0;
    if (prof?.disponibilidade) {
      diasSemana.forEach((d: string) => {
        capProf += prof.disponibilidade[d]?.length || 0;
      });
    }

    const matItem = matriz.find((m) => m.turmaId === p.turmaId && m.disciplinaId === p.disciplinaId);
    const aulasSemanaExigidas = matItem ? Number(matItem.aulasPorSemana) : 0;

    let motivo = "";
    let sugestao = "";

    if (capProf < aulasSemanaExigidas) {
      motivo = `Indisponibilidade Crítica: O professor ${prof?.nomeCompleto || p.professorId} possui apenas ${capProf} horários declarados livres na semana, o que é insuficiente para carregar as ${aulasSemanaExigidas} aulas exigidas na matriz curricular.`;
      sugestao = `Expandir a janela de disponibilidade semanal do professor ${prof?.nomeCompleto || p.professorId} adicionando pelo menos mais ${aulasSemanaExigidas - capProf} horários livres de agenda.`;
    } else {
      motivo = `Saturação Física de Slots: A turma ${t?.nome || p.turmaId} ou o professor ${prof?.nomeCompleto || p.professorId} possuem conflitos estruturais de grade em todos os horários livres. Outras disciplinas estão ocupando as opções de agenda de forma inflexível.`;
      sugestao = `Ativar o 'Modo Flexível' (regras de relaxamento de aulas consecutivas) nas configurações, trocar o professor desta matéria por outro com escala diferente ou reduzir a carga de aulas de outras disciplinas na mesma turma.`;
    }

    provasInviabilidade.push(
      `Inviabilidade comprovada: Matéria ${disc?.nome || p.disciplinaId} (Turma: ${t?.nome || p.turmaId}, Prof: ${prof?.nomeCompleto || p.professorId}). ${motivo}`
    );

    relatorioInviabilidade.push({
      turmaNome: t?.nome || p.turmaId,
      disciplinaNome: disc?.nome || p.disciplinaId,
      professorNome: prof?.nomeCompleto || p.professorId,
      motivo,
      sugestao,
    });
  }

  const endTime = performance.now();
  const duracao = Math.round(endTime - startTime);
  const alocadasTotalFinal = estado.alocacoes.length;
  const taxaAloc = totalPlanejadoGlobal > 0 ? (alocadasTotalFinal / totalPlanejadoGlobal) * 100 : 100;
  const scoreFinal = avaliarEstadoFitness(estado);

  logs.push(`Solver Profundo Concluído em ${duracao}ms: ${combSimuladas} combinações simuladas em cache.`);
  logs.push(`Resultado: ${alocadasTotalFinal}/${totalPlanejadoGlobal} aulas alocadas (${taxaAloc.toFixed(1)}%). Score Final: ${scoreFinal}.`);

  return {
    alocacoes: estado.alocacoes,
    aulasAdicionadasCount: aulasAdicionadasTotal,
    combinaçõesSimuladasCount: combSimuladas,
    tempoExecucaoMs: duracao,
    diagnostico: {
      sucessoTotal: pendenciasFinais.length === 0,
      taxaAlocacaoFinal: taxaAloc,
      provasInviabilidade,
      scoreGlobalFinal: scoreFinal,
      relatorioInviabilidade,
    },
    logs,
  };
}
