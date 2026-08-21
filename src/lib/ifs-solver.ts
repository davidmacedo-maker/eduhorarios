/**
 * ifs-solver.ts
 * ──────────────────────────────────────────────────────────────
 * Motor de Alocação Avançado (IFS — Iterative Forward Search Constraint Solver)
 * Implementação em TypeScript de solucionador de restrições por busca progressiva.
 * Baseado no algoritmo Iterative Forward Search (IFS) com detecção e resolução de conflitos
 * por meio de passos de atribuição e desatribuição (backtracking dinâmico / unassigning).
 *
 * Utiliza OBRIGATORIAMENTE e EXCLUSIVAMENTE a API do AllocationCore.
 */

import type {
  Alocacao,
  Turma,
  Professor,
  Disciplina,
  MatrizCurricular,
  ConfiguracaoHorarios,
  DiagnosticoGeracao,
  HistoricoAprendizado,
} from "@/types";

import { AllocationCore, RuleViolation } from "./allocation-core";
import { DAYS } from "./schedule-utils";
import { auditarConformidade } from "./compliance-audit";
import {
  otimizarBuracosTurmas,
  otimizarJanelasProfessores,
  otimizarDistribuicaoSemanal,
  otimizarGeminacao
} from "./optimization-utils";

export interface IFSSolverOptions {
  maxIterations?: number;
  maxBacktracks?: number;
  seed?: number;
  debugGeracao?: boolean;
  regrasRelaxamento?: {
    permitirMaisDeDuasAulasMesmoDia?: boolean;
    permitirTresAulasConsecutivas?: boolean;
    permitirAlocarQualquerHorarioDisponivel?: boolean;
  };
  historico?: HistoricoAprendizado[];
  onProgress?: (progress: {
    iteration: number;
    assignedCount: number;
    totalNeeded: number;
    score: number;
    iqg: number;
    queueSize?: number;
    conflictsCount?: number;
    reorganizationsCount?: number;
  }) => void;
}

interface IFSVariable {
  id: string; // chave única: profId|turmaId|disciplinaId
  professorId: string;
  turmaId: string;
  disciplinaId: string;
  priority: number; // prioritário por carga ou restrição
}

interface IFSValue {
  dia: string;
  horario: number;
}

export class IFSSolver {
  private core: AllocationCore;
  private maxIterations: number;
  private maxBacktracks: number;
  private options: IFSSolverOptions;

  private variables: IFSVariable[] = [];
  private logs: string[] = [];
  private rng: () => number;
  private reorganizationsCount = 0;

  constructor(
    alocacoes: Alocacao[],
    turmas: Turma[],
    disciplinas: Disciplina[],
    professores: Professor[],
    matriz: MatrizCurricular[],
    config: ConfiguracaoHorarios,
    options: IFSSolverOptions = {}
  ) {
    // Cria a camada central AllocationCore
    this.core = new AllocationCore(
      alocacoes,
      turmas,
      disciplinas,
      professores,
      matriz,
      config
    );

    this.maxIterations = options.maxIterations || 1500;
    this.maxBacktracks = options.maxBacktracks || 10;
    this.options = options;

    const solverSeed = options.seed !== undefined ? options.seed : 42;
    let s = solverSeed;
    this.rng = () => {
      const x = Math.sin(s++) * 10000;
      return x - Math.floor(x);
    };
  }

  /**
   * Executa o algoritmo de busca e otimização.
   */
  public solve(): {
    alocacoes: Alocacao[];
    diagnostico: DiagnosticoGeracao;
    logs: string[];
  } {
    this.reorganizationsCount = 0;
    this.logs = [];
    this.logs.push("Iniciando Motor Avançado (IFS) com arquitetura Allocation Core...");

    // Limpa a grade de alocações não travadas (non-locked) para reconstrução completa
    const lockedAlocs = this.core.getAlocacoes().filter((a) => a.isLocked);
    this.core.clear();
    lockedAlocs.forEach((la) => {
      this.core.insert(la, { force: true });
    });

    // 1. Construir a lista de variáveis (aulas a serem alocadas) a partir do AssignmentMap
    this.buildVariables();

    if (this.variables.length === 0) {
      this.logs.push("Nenhuma aula pendente para alocar.");
      return this.finishAndReturn(true, "Nenhuma pendência.");
    }

    this.logs.push(`Encontradas ${this.variables.length} aulas pendentes para alocação.`);

    // 2. Executar busca Iterative Forward Search (IFS)
    const success = this.runIFS();

    // 3. Executar fase de Otimização Local (Hill Climbing) pós-geração para polir a grade
    if (success) {
      this.logs.push("Executando fase de otimização local (Hill Climbing / Swaps)...");
      this.optimizeLocal();

      this.logs.push("🔧 Aplicando otimizações avançadas de IQG...");
      let alocs = this.core.getAlocacoes();
      
      this.logs.push("  → Otimizando buracos em turmas...");
      alocs = otimizarBuracosTurmas(
        alocs,
        this.core.getTurmas(),
        this.core.getProfessores(),
        this.core.getDisciplinas(),
        this.core.getMatriz(),
        this.core.getConfig()
      );
      
      this.logs.push("  → Otimizando janelas de professores...");
      alocs = otimizarJanelasProfessores(
        alocs,
        this.core.getProfessores(),
        this.core.getTurmas(),
        this.core.getDisciplinas(),
        this.core.getMatriz(),
        this.core.getConfig()
      );
      
      this.logs.push("  → Otimizando distribuição semanal...");
      alocs = otimizarDistribuicaoSemanal(
        alocs,
        this.core.getTurmas(),
        this.core.getDisciplinas(),
        this.core.getProfessores(),
        this.core.getMatriz(),
        this.core.getConfig()
      );
      
      this.logs.push("  → Otimizando geminação...");
      alocs = otimizarGeminacao(
        alocs,
        this.core.getTurmas(),
        this.core.getDisciplinas(),
        this.core.getProfessores(),
        this.core.getMatriz(),
        this.core.getConfig()
      );
      
      // Atualiza o core com as alocações otimizadas
      const lockedOnes = this.core.getAlocacoes().filter(a => a.isLocked);
      this.core.clear();
      lockedOnes.forEach(la => this.core.insert(la, { force: true }));
      alocs.forEach(a => {
        if (!a.isLocked) {
          this.core.insert(a, { force: true });
        }
      });
      this.logs.push("✅ Otimizações avançadas de IQG concluídas com sucesso!");
    }

    const { iqg } = this.core.scoreEngine.calculate(
      this.core.getAlocacoes(),
      this.core.getTurmas(),
      this.core.getProfessores(),
      this.core.getDisciplinas(),
      this.core.getMatriz()
    );

    return this.finishAndReturn(success, success ? "Sucesso na alocação completa." : "Limite de iterações atingido com grade parcial.", iqg);
  }

  /**
   * Reconstrói as demandas que restam ser alocadas.
   */
  private buildVariables() {
    this.variables = [];
    const assignmentEntries = this.core.assignmentMap.getAll();

    assignmentEntries.forEach((entry) => {
      // Cada restante é uma variável de IFS a ser agendada
      for (let i = 0; i < entry.restante; i++) {
        // Calcula uma prioridade simples (MRV): quanto maior o planejamento do prof, mais crítico é
        const prof = this.core.teacherIndex.get(entry.professorId);
        let slotsDisponiveis = 0;
        if (prof && prof.disponibilidade) {
          Object.values(prof.disponibilidade).forEach((d) => {
            if (Array.isArray(d)) slotsDisponiveis += d.length;
          });
        }
        if (slotsDisponiveis === 0) slotsDisponiveis = 1;

        // Prioridade calculada por demanda/disponibilidade do professor (grau de restrição)
        const priority = (entry.planejado * 100) / slotsDisponiveis;

        this.variables.push({
          id: `${entry.professorId}|${entry.turmaId}|${entry.disciplinaId}|${i}`,
          professorId: entry.professorId,
          turmaId: entry.turmaId,
          disciplinaId: entry.disciplinaId,
          priority,
        });
      }
    });

    // Ordena as variáveis: as mais restritas/difíceis primeiro (Heurística de Maior Restrição por Carga/Janela)
    const solverSeed = this.options.seed !== undefined ? this.options.seed : 42;
    let s = solverSeed;
    const rng = () => {
      const x = Math.sin(s++) * 10000;
      return x - Math.floor(x);
    };

    this.variables.sort((a, b) => {
      const diff = b.priority - a.priority;
      if (diff === 0 && this.options.seed !== undefined) {
        return rng() - 0.5;
      }
      return diff;
    });
  }

  /**
   * Algoritmo Iterative Forward Search (IFS)
   */
  private runIFS(): boolean {
    let unassignedQueue = [...this.variables];
    let iter = 0;
    let btracksCount = new Map<string, number>(); // rastreia backtrack por variável para evitar loops

    const totalToAssign = this.variables.length;
    let bestAllocationState: Alocacao[] = [...this.core.getAlocacoes()];
    let bestAssignedCount = bestAllocationState.length - this.getLockedCount();

    while (unassignedQueue.length > 0 && iter < this.maxIterations) {
      iter++;

      // Escolhe a variável da fila com maior prioridade (heurística de seleção de variável)
      const variable = unassignedQueue.shift()!;

      // Encontra o melhor valor (dia, horário) para alocar esta variável
      const bestValueInfo = this.selectBestValue(variable);

      if (bestValueInfo) {
        const { value, conflicts } = bestValueInfo;

        // Executa as desatribuições (unassign) das alocações concorrentes/conflitantes
        conflicts.forEach((conflictingAlloc) => {
          if (!conflictingAlloc.isLocked) {
            this.reorganizationsCount++;
            this.core.removeById(conflictingAlloc.id);
            // Re-insere a aula removida na fila de variáveis a alocar
            const matchedVar: IFSVariable = {
              id: `${conflictingAlloc.professorId}|${conflictingAlloc.turmaId}|${conflictingAlloc.disciplinaId}|unassigned-${Date.now()}-${this.rng()}`,
              professorId: conflictingAlloc.professorId,
              turmaId: conflictingAlloc.turmaId,
              disciplinaId: conflictingAlloc.disciplinaId,
              priority: 50, // prioridade média de reentrada
            };
            unassignedQueue.push(matchedVar);

            // Incrementa contador de backtracks para detectar loops
            const vKey = `${conflictingAlloc.professorId}|${conflictingAlloc.turmaId}`;
            btracksCount.set(vKey, (btracksCount.get(vKey) || 0) + 1);
          }
        });

        // Insere a nova alocação no AllocationCore
        const insertRes = this.core.insert(
          {
            turmaId: variable.turmaId,
            disciplinaId: variable.disciplinaId,
            professorId: variable.professorId,
            diaSemana: value.dia,
            horario: value.horario,
          },
          {
            regrasRelaxamento: this.options.regrasRelaxamento,
          }
        );

        if (!insertRes.success) {
          // Se mesmo após remover conflitos falhou (ex: indisponibilidade rígida), devolve para a fila
          unassignedQueue.push(variable);
        } else {
          // Registra progresso se for o melhor estado até agora
          const currentAlocs = this.core.getAlocacoes();
          const currentAssigned = currentAlocs.length - this.getLockedCount();

          if (currentAssigned > bestAssignedCount) {
            bestAssignedCount = currentAssigned;
            bestAllocationState = [...currentAlocs];
          }
        }
      } else {
        // Se não encontrou nenhum valor viável para a variável, re-insere-a no fim com prioridade menor
        variable.priority = Math.max(0, variable.priority - 5);
        unassignedQueue.push(variable);
      }

      // Ordenar fila periodicamente para processar as mais difíceis primeiro
      if (iter % 15 === 0) {
        unassignedQueue.sort((a, b) => b.priority - a.priority);
      }

      // Progresso periódico
      if (this.options.onProgress && iter % 10 === 0) {
        const alocs = this.core.getAlocacoes();
        const { score, iqg } = this.core.scoreEngine.calculate(
          alocs,
          this.core.getTurmas(),
          this.core.getProfessores(),
          this.core.getDisciplinas(),
          this.core.getMatriz()
        );
        this.options.onProgress({
          iteration: iter,
          assignedCount: alocs.length - this.getLockedCount(),
          totalNeeded: totalToAssign,
          score,
          iqg,
          queueSize: unassignedQueue.length,
          conflictsCount: 0, // IFS solver remains conflict-free by unassigning
          reorganizationsCount: this.reorganizationsCount,
        });
      }
    }

    // Se não concluiu 100%, restaura o melhor estado de alocação parcial encontrado
    const finalAssignedCount = this.core.getAlocacoes().length - this.getLockedCount();
    if (finalAssignedCount < bestAssignedCount) {
      this.logs.push(`IFS encerrado em sub-ótimo. Restaurando melhor estado de alocação (${bestAssignedCount} aulas).`);
      this.core.clear();
      bestAllocationState.forEach((a) => this.core.insert(a, { force: true }));
    }

    // ✅ AUDITORIA DE CONFORMIDADE PÓS-GERAÇÃO
    this.logs.push("🔍 Executando auditoria de conformidade pós-geração...");
    const report = auditarConformidade(
      this.core.getAlocacoes(),
      this.core.getProfessores(),
      this.core.getTurmas(),
      this.core.getDisciplinas(),
      this.core.getMatriz()
    );
    this.logs.push(...report.logs);

    if (!report.valido && report.resumo.criticas > 0) {
      this.logs.push(`🚨 [ERRO CRÍTICO] Bloqueando retorno da grade devido a ${report.resumo.criticas} violações críticas.`);
      throw new Error(`Grade inválida: ${report.resumo.criticas} violações críticas de conformidade detectadas.`);
    }

    this.logs.push(`Iterative Forward Search concluído em ${iter} iterações.`);
    return finalAssignedCount === totalToAssign;
  }

  /**
   * CORREÇÃO: Validar carga TOTAL antes de alocar
   */
  private validarCargaTotalAntesDeAlocar(
    professorId: string,
    disciplinaId: string,
    turmaId: string
  ): { permitido: boolean; motivo?: string } {
    const prof = this.core.teacherIndex.get(professorId);
    if (!prof) return { permitido: false, motivo: "Professor não encontrado" };

    const alocacoesExistentes = this.core.getAlocacoes();

    // ✅ Verificar Carga Horária Máxima Semanal do Professor como restrição obrigatória
    const totalAlocadoGeralProfessor = alocacoesExistentes.filter(a => a.professorId === professorId).length;
    if (prof.cargaHorariaMaximaSemanal && totalAlocadoGeralProfessor >= prof.cargaHorariaMaximaSemanal) {
      return {
        permitido: false,
        motivo: `Carga horária máxima semanal do professor (${prof.cargaHorariaMaximaSemanal} aulas) já foi atingida (${totalAlocadoGeralProfessor} alocadas)`
      };
    }

    // Calcular carga TOTAL planejada para esta disciplina
    const planejamento = prof.planejamento || [];
    let totalPlanejado = 0;
    let turmasPlanejadas: string[] = [];

    for (const item of planejamento) {
      if (item.disciplinaId === disciplinaId) {
        totalPlanejado += Number(item.aulasPorSemana !== undefined ? item.aulasPorSemana : (item.quantidadeAulas || 0));
        turmasPlanejadas.push(item.turmaId);
      }
    }

    // ✅ Verificar se a turma atual está no planejamento
    if (!turmasPlanejadas.includes(turmaId)) {
      return { permitido: false, motivo: "Turma não está no planejamento" };
    }

    // ✅ Contar TOTAL de alocações desta disciplina (todas as turmas)
    const totalAlocado = alocacoesExistentes.filter(a =>
      a.professorId === professorId &&
      a.disciplinaId === disciplinaId
    ).length;

    if (totalAlocado >= totalPlanejado) {
      return {
        permitido: false,
        motivo: `Carga total de ${totalPlanejado} aulas para ${disciplinaId} já foi atingida (${totalAlocado} alocadas)`
      };
    }

    // ✅ Verificar se há aulas disponíveis para esta turma específica
    const alocadoNestaTurma = alocacoesExistentes.filter(a =>
      a.professorId === professorId &&
      a.disciplinaId === disciplinaId &&
      a.turmaId === turmaId
    ).length;

    // Buscar planejamento específico desta turma
    const planeItem = planejamento.find(p => p.disciplinaId === disciplinaId && p.turmaId === turmaId);
    const planejadoNestaTurma = Number(planeItem?.aulasPorSemana !== undefined ? planeItem.aulasPorSemana : (planeItem?.quantidadeAulas || 0));

    if (alocadoNestaTurma >= planejadoNestaTurma) {
      return {
        permitido: false,
        motivo: `Carga para a turma ${turmaId} (${planejadoNestaTurma} aulas) já foi atingida (${alocadoNestaTurma} alocadas)`
      };
    }

    return { permitido: true };
  }

  /**
   * Seleciona o melhor valor (dia, horário) para uma variável com heurística de mínimo conflito.
   */
  private selectBestValue(variable: IFSVariable): { value: IFSValue; conflicts: Alocacao[] } | null {
    const validacaoCarga = this.validarCargaTotalAntesDeAlocar(
      variable.professorId,
      variable.disciplinaId,
      variable.turmaId
    );
    if (!validacaoCarga.permitido) {
      if (this.options.debugGeracao) {
        this.logs.push(`[validarCarga] Impedido: ${validacaoCarga.motivo}`);
      }
      return null;
    }

    const t = this.core.turmaIndex.get(variable.turmaId);
    if (!t) return null;

    const maxHorarios = t.turno === "noite"
      ? (this.core.getConfig().quantidadeHorariosPorDiaNoite ?? 4)
      : t.turno === "tarde"
        ? (this.core.getConfig().quantidadeHorariosPorDiaTarde ?? 5)
        : (this.core.getConfig().quantidadeHorariosPorDia ?? 6);

    const candidates: { value: IFSValue; conflicts: Alocacao[]; score: number }[] = [];

    // Avaliar todas as possíveis atribuições (dias e horários)
    for (const dia of DAYS) {
      // ✅ NOVA VALIDAÇÃO: Verificar dias permitidos da turma
      if (t.diasPermitidos && Array.isArray(t.diasPermitidos) && !t.diasPermitidos.includes(dia)) {
        continue;
      }

      for (let h = 1; h <= maxHorarios; h++) {
        // Verifica a viabilidade do slot usando o ConstraintEngine do AllocationCore
        const violations = this.core.constraintEngine.checkSlotViability(
          variable.professorId,
          variable.turmaId,
          variable.disciplinaId,
          dia,
          h,
          {
            turmas: this.core.getTurmas(),
            disciplinas: this.core.getDisciplinas(),
            professores: this.core.getProfessores(),
            matriz: this.core.getMatriz(),
            config: this.core.getConfig(),
            alocacoes: this.core.getAlocacoes(),
            horariosIndex: this.core.horarioIndex,
          },
          {
            permitirMaisDeDuasAulasMesmoDia: this.options.regrasRelaxamento?.permitirMaisDeDuasAulasMesmoDia,
            permitirTresAulasConsecutivas: this.options.regrasRelaxamento?.permitirTresAulasConsecutivas,
            permitirAlocarQualquerHorarioDisponivel: this.options.regrasRelaxamento?.permitirAlocarQualquerHorarioDisponivel,
          }
        );

        // Se houver indisponibilidade do professor (regra rígida do prof), pula
        if (violations.some((v) => v.tipo === "indisponibilidade_professor" && v.critica)) {
          continue;
        }

        // Identificar conflitos de alocação que precisarão ser desfeitos (unassigned)
        const conflicts: Alocacao[] = [];

        // Conflito de Turma Ocupada
        const tAloc = this.core.horarioIndex.getByTurmaDiaSlot(variable.turmaId, dia, h);
        if (tAloc) conflicts.push(tAloc);

        // Conflito de Professor Ocupado
        const pAlocs = this.core.horarioIndex.getByProfessorDiaSlot(variable.professorId, dia, t.turno, h);
        pAlocs.forEach((pa) => {
          if (!conflicts.some((c) => c.id === pa.id)) {
            conflicts.push(pa);
          }
        });

        // Se houver algum conflito de alocação travada (locked), pula esta opção
        if (conflicts.some((c) => c.isLocked)) {
          continue;
        }

        // Se a quantidade de remoções necessárias excede o limite do backtracking, desconsidera
        if (conflicts.length > this.maxBacktracks) {
          continue;
        }

        // Calcula um score de "atratividade" do slot (prioriza menor quantidade de conflitos e penalidades pedagógicas)
        let cost = conflicts.length * 1000;

        const violacoesPedagogicas = violations.filter((v) => !v.critica).length;
        cost += violacoesPedagogicas * 100;

        // Se for um slot com janela para o professor, adiciona custo leve
        const hasWindow = this.wouldCreateProfessorWindow(variable.professorId, dia, h);
        if (hasWindow) cost += 50;

        // MEMÓRIA DE AJUSTES DO USUÁRIO: despriorizar slots que o usuário removeu repetidamente no histórico
        if (this.options.historico && Array.isArray(this.options.historico)) {
          const matchingRemovals = this.options.historico.filter(hist => 
            hist.professorId === variable.professorId &&
            hist.diaSemana === dia &&
            hist.horario === h &&
            hist.operacao === 'remocao'
          );
          if (matchingRemovals.length > 0) {
            if (matchingRemovals.length >= 3) {
              cost += 5000; // Penalidade forte se movido 3 ou mais vezes
            } else {
              cost += matchingRemovals.length * 1500; // Penalidade média para desincentivar
            }
          }
        }

        candidates.push({
          value: { dia, horario: h },
          conflicts,
          score: cost,
        });
      }
    }

    if (candidates.length === 0) return null;

    // Ordena candidatos pelo menor custo/pontuação de penalidade (Heurística de Mínimo Conflito)
    candidates.sort((a, b) => a.score - b.score);

    // Seleciona de forma elitista (pode introduzir leve ruído aleatório para evitar órbita cíclica)
    const selectIdx = this.rng() < 0.85 ? 0 : Math.floor(this.rng() * Math.min(3, candidates.length));
    return candidates[selectIdx];
  }

  /**
   * Checagem rápida de impacto de janela antes de alocar.
   */
  private wouldCreateProfessorWindow(professorId: string, dia: string, horario: number): boolean {
    const alocs = this.core.getAlocacoes().filter((a) => a.professorId === professorId && a.diaSemana === dia);
    if (alocs.length === 0) return false;

    const horas = alocs.map((a) => a.horario);
    horas.push(horario);
    horas.sort((a, b) => a - b);

    const min = horas[0];
    const max = horas[horas.length - 1];

    let countGaps = 0;
    for (let h = min; h <= max; h++) {
      if (!horas.includes(h)) countGaps++;
    }

    return countGaps > 0;
  }

  /**
   * Fase de otimização local (Hill Climbing / Local Search)
   * Realiza swaps e movimentos utilizando unicamente a API de AllocationCore.
   */
  private optimizeLocal() {
    const turmas = this.core.getTurmas();
    const currentScore = () => this.core.scoreEngine.calculate(
      this.core.getAlocacoes(),
      this.core.getTurmas(),
      this.core.getProfessores(),
      this.core.getDisciplinas(),
      this.core.getMatriz()
    ).score;

    let stepsWithoutImprovement = 0;
    let maxSteps = 200;

    for (let i = 0; i < maxSteps; i++) {
      const scoreBefore = currentScore();

      // Escolhe aleatoriamente duas turmas e slots para testar troca
      const tIdx = Math.floor(this.rng() * turmas.length);
      const t = turmas[tIdx];
      const maxH = t.turno === "noite" ? 4 : t.turno === "tarde" ? 5 : 6;

      const dia1 = DAYS[Math.floor(this.rng() * DAYS.length)];
      const h1 = Math.floor(this.rng() * maxH) + 1;

      const dia2 = DAYS[Math.floor(this.rng() * DAYS.length)];
      const h2 = Math.floor(this.rng() * maxH) + 1;

      if (dia1 === dia2 && h1 === h2) continue;

      // Executa tentativa de swap usando AllocationCore
      const swapRes = this.core.swap(dia1, h1, t.id, dia2, h2, t.id, { force: false });

      if (swapRes.success) {
        const scoreAfter = currentScore();
        if (scoreAfter > scoreBefore) {
          // Melhorou! Mantém a troca
          stepsWithoutImprovement = 0;
        } else {
          // Reverte a troca (desfazendo o swap)
          this.core.swap(dia2, h2, t.id, dia1, h1, t.id, { force: true });
          stepsWithoutImprovement++;
        }
      } else {
        stepsWithoutImprovement++;
      }

      if (stepsWithoutImprovement > 40) {
        break; // converge
      }
    }
  }

  private getLockedCount(): number {
    return this.core.getAlocacoes().filter((a) => a.isLocked).length;
  }

  private finishAndReturn(
    success: boolean,
    motivo: string,
    iqg: number = 0
  ) {
    const alocacoesFinais = this.core.getAlocacoes();
    const aulasPlanejadas = this.core.getMatriz().reduce((acc, m) => acc + m.aulasPorSemana, 0);
    const aulasAlocadas = alocacoesFinais.length;

    const diagnostico: DiagnosticoGeracao = {
      sucesso: success,
      taxaAlocacao: aulasPlanejadas > 0 ? (aulasAlocadas / aulasPlanejadas) * 100 : 0,
      aulasPlanejadas,
      aulasAlocadas,
      motivoEncerrado: motivo,
      modoConfigurado: this.options.regrasRelaxamento?.permitirAlocarQualquerHorarioDisponivel ? "emergencial" : "equilibrado",
    };

    return {
      alocacoes: alocacoesFinais,
      diagnostico,
      logs: this.logs,
    };
  }
}

/**
 * Função utilitária de entrada para executar o solucionador de restrições por busca progressiva (IFS).
 */
export function runIFSSolver(
  turmas: Turma[],
  disciplinas: Disciplina[],
  professores: Professor[],
  matriz: MatrizCurricular[],
  config: ConfiguracaoHorarios,
  lockedAlocacoes: Alocacao[] = [],
  options: IFSSolverOptions = {}
) {
  const solver = new IFSSolver(
    lockedAlocacoes,
    turmas,
    disciplinas,
    professores,
    matriz,
    config,
    options
  );
  return solver.solve();
}
