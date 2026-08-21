/**
 * score-utils.ts
 * ──────────────────────────────────────────────────────────────
 * Funções de avaliação de qualidade da grade (score).
 * Usado pelos motores de otimização para aceitar/rejeitar movimentos.
 */

import type { Alocacao, Turma, Professor, Disciplina, MatrizCurricular } from "@/types";

// Cache para métricas computadas
interface MetricsCache {
  janelasProfessor: Map<string, number>; // key: professorId
  buracosTurma: Map<string, number>;     // key: turmaId
  timestamp: number;
}

let metricsCache: MetricsCache = {
  janelasProfessor: new Map(),
  buracosTurma: new Map(),
  timestamp: 0
};

const CACHE_TTL = 5000; // 5 segundos de validade

function isCacheValid(): boolean {
  return Date.now() - metricsCache.timestamp < CACHE_TTL;
}

function invalidateCache() {
  metricsCache = {
    janelasProfessor: new Map(),
    buracosTurma: new Map(),
    timestamp: 0
  };
}

// EXPORTAR FUNÇÃO DE INVALIDAÇÃO PARA USO EM COMPONENTES
export function invalidarCacheMetricas() {
  invalidateCache();
}

// Constantes globais (ajustáveis)
const PESOS = {
  AULA_ALOCADA: 1000,
  AULA_FALTANTE: -500,
  BURACO_TURMA: -300,
  JANELA_PROFESSOR: -500,
  GEMINACAO: 100,
  VIOLACAO_PEDAGOGICA: -1000,
  BLOCO_3_CONSECUTIVAS: -2000,
};

/**
 * Conta buracos internos (gaps) nas grades das turmas.
 * Um buraco é um horário vazio entre o primeiro e o último horário ocupado do dia.
 */
export function contarBuracosTurma(alocacoes: Alocacao[], turmas: Turma[]): number {
  // Verificar cache
  const alocacoesHash = alocacoes.length;
  const turmasHash = turmas.length;
  
  if (isCacheValid() && metricsCache.buracosTurma.size === turmas.length) {
    let total = 0;
    for (const t of turmas) {
      total += metricsCache.buracosTurma.get(t.id) || 0;
    }
    return total;
  }

  let totalBuracos = 0;
  const DIAS = ["segunda", "terca", "quarta", "quinta", "sexta"] as const;

  for (const turma of turmas) {
    let buracosTurma = 0;
    for (const dia of DIAS) {
      const horas = alocacoes
        .filter((a) => a.turmaId === turma.id && a.diaSemana === dia)
        .map((a) => a.horario)
        .sort((a, b) => a - b);

      if (horas.length < 2) continue;

      const min = horas[0];
      const max = horas[horas.length - 1];
      let buracosDia = 0;
      for (let h = min; h <= max; h++) {
        if (!horas.includes(h)) buracosDia++;
      }
      buracosTurma += buracosDia;
    }
    metricsCache.buracosTurma.set(turma.id, buracosTurma);
    totalBuracos += buracosTurma;
  }

  metricsCache.timestamp = Date.now();
  return totalBuracos;
}

/**
 * Conta janelas (gaps) na agenda dos professores.
 * Janela = horário vazio entre o primeiro e o último horário do professor no dia.
 */
export function contarJanelasProfessor(alocacoes: Alocacao[], professores: Professor[]): number {
  // Verificar se o cache é válido para esta chamada
  // Usamos um hash simples baseado no número de alocações e professores
  const alocacoesHash = alocacoes.length;
  const professoresHash = professores.length;
  const cacheKey = `${alocacoesHash}|${professoresHash}`;
  
  // Se o cache for válido e tiver o mesmo número de elementos, usar cache
  if (isCacheValid() && metricsCache.janelasProfessor.size === professores.length) {
    let total = 0;
    for (const p of professores) {
      total += metricsCache.janelasProfessor.get(p.id) || 0;
    }
    return total;
  }

  // Caso contrário, recalcular e armazenar no cache
  let totalJanelas = 0;
  const DIAS = ["segunda", "terca", "quarta", "quinta", "sexta"] as const;

  for (const prof of professores) {
    let janelasProf = 0;
    for (const dia of DIAS) {
      const horas = alocacoes
        .filter((a) => a.professorId === prof.id && a.diaSemana === dia)
        .map((a) => a.horario)
        .sort((a, b) => a - b);

      if (horas.length < 2) continue;

      const min = horas[0];
      const max = horas[horas.length - 1];
      let janelasDia = 0;
      for (let h = min; h <= max; h++) {
        if (!horas.includes(h)) janelasDia++;
      }
      janelasProf += janelasDia;
    }
    metricsCache.janelasProfessor.set(prof.id, janelasProf);
    totalJanelas += janelasProf;
  }

  metricsCache.timestamp = Date.now();
  return totalJanelas;
}

/**
 * Conta geminações válidas (aulas consecutivas da mesma disciplina em pares permitidos).
 * Pares permitidos: (1,2), (2,3), (4,5), (5,6).
 */
export function contarGeminacoes(alocacoes: Alocacao[], disciplinas: Disciplina[]): number {
  let geminacoes = 0;
  const DIAS = ["segunda", "terca", "quarta", "quinta", "sexta"] as const;

  // Agrupa por turma, dia, disciplina
  const map = new Map<string, number[]>();

  for (const a of alocacoes) {
    const key = `${a.turmaId}|${a.diaSemana}|${a.disciplinaId}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(a.horario);
  }

  const isGoodPair = (h1: number, h2: number): boolean => {
    const diff = Math.abs(h1 - h2);
    if (diff !== 1) return false;
    const min = Math.min(h1, h2);
    return min === 1 || min === 2 || min === 4 || min === 5;
  };

  for (const [key, horas] of map.entries()) {
    const sorted = horas.sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 1; i++) {
      if (isGoodPair(sorted[i], sorted[i + 1])) {
        geminacoes++;
        i++; // pula o próximo para não contar duplicado
      }
    }
  }

  return geminacoes;
}

function contarViolacoesPedagogicasInterno(
  alocacoes: Alocacao[],
  discMap: Map<string, Disciplina>,
  profMap: Map<string, Professor>
): number {
  let violacoes = 0;

  // Agrupa por turma, dia, disciplina, professor
  const map = new Map<string, number[]>();
  for (const a of alocacoes) {
    const key = `${a.turmaId}|${a.diaSemana}|${a.disciplinaId}|${a.professorId}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(a.horario);
  }

  for (const [key, horas] of map.entries()) {
    const [turmaId, , disciplinaId, professorId] = key.split("|");
    const disc = discMap.get(disciplinaId);
    if (!disc) continue;

    const prof = profMap.get(professorId);
    let maxPorDia = 2; // Decoupled from Disciplina model's maximoAulasPorDia
    let maxConsecLimit = 2; // padrão

    if (prof && Array.isArray(prof.planejamento)) {
      const planeItem = prof.planejamento.find(
        (item) => item.disciplinaId === disciplinaId && item.turmaId === turmaId
      );
      if (planeItem) {
        if (planeItem.maximoAulasPorDia !== undefined && planeItem.maximoAulasPorDia !== null) {
          maxPorDia = planeItem.maximoAulasPorDia;
        }
        if (planeItem.maximoConsecutivas !== undefined && planeItem.maximoConsecutivas !== null) {
          maxConsecLimit = planeItem.maximoConsecutivas;
        }
      }
    }

    if (horas.length > maxPorDia) {
      violacoes++;
    }

    // consecutivas check
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
        violacoes++;
        break; // conta uma vez por disciplina/turma/dia
      }
      lastH = hVal;
    }
  }

  return violacoes;
}

/**
 * Conta violações pedagógicas:
 * - Mais de maxPorDia da mesma disciplina no mesmo dia (padrão 2).
 * - Mais de maximoConsecutivas consecutivas da mesma disciplina no mesmo dia (padrão 2).
 */
export function contarViolacoesPedagogicas(
  alocacoes: Alocacao[],
  disciplinas: Disciplina[],
  turmas: Turma[],
  professores: Professor[]
): number {
  const discMap = new Map(disciplinas.map((d) => [d.id, d]));
  const profMap = new Map(professores.map((p) => [p.id, p]));
  return contarViolacoesPedagogicasInterno(alocacoes, discMap, profMap);
}

/**
 * Calcula o score completo de uma grade.
 * Quanto maior, melhor.
 */
export function calcularScore(
  alocacoes: Alocacao[],
  turmas: Turma[],
  professores: Professor[],
  disciplinas: Disciplina[],
  matriz: MatrizCurricular[],
  totalPlanejado: number
): number {
  let score = 0;

  // 1. Aulas alocadas vs planejadas
  const geradas = alocacoes.length;
  score += geradas * PESOS.AULA_ALOCADA;
  score += (totalPlanejado - geradas) * PESOS.AULA_FALTANTE;

  // 2. Buracos internos (turma)
  const buracos = contarBuracosTurma(alocacoes, turmas);
  score += buracos * PESOS.BURACO_TURMA;

  // 3. Janelas de professor
  const janelas = contarJanelasProfessor(alocacoes, professores);
  score += janelas * PESOS.JANELA_PROFESSOR;

  // 4. Geminações
  const geminacoes = contarGeminacoes(alocacoes, disciplinas);
  score += geminacoes * PESOS.GEMINACAO;

  // Pre-instantiate Maps once to optimize nested lookups
  const discMap = new Map(disciplinas.map((d) => [d.id, d]));
  const profMap = new Map(professores.map((p) => [p.id, p]));

  // 5. Violações pedagógicas
  const violacoes = contarViolacoesPedagogicasInterno(alocacoes, discMap, profMap);
  score += violacoes * PESOS.VIOLACAO_PEDAGOGICA;

  // 6. Penalidade extra para blocos excedidos
  let blocosExcedidos = 0;
  const extraConsecMap = new Map<string, number[]>();
  for (const a of alocacoes) {
    const key = `${a.turmaId}|${a.diaSemana}|${a.disciplinaId}|${a.professorId}`;
    if (!extraConsecMap.has(key)) extraConsecMap.set(key, []);
    extraConsecMap.get(key)!.push(a.horario);
  }

  for (const [key, horas] of extraConsecMap.entries()) {
    const [turmaId, , disciplinaId, professorId] = key.split("|");
    const profObj = profMap.get(professorId);
    let maxConsecLimit = 2; // default
    if (profObj && Array.isArray(profObj.planejamento)) {
      const planeItem = profObj.planejamento.find(
        (item) => item.disciplinaId === disciplinaId && item.turmaId === turmaId
      );
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
        blocosExcedidos++;
        break;
      }
      lastH = hVal;
    }
  }
  score += blocosExcedidos * PESOS.BLOCO_3_CONSECUTIVAS;

  return score;
}

/**
 * Verifica se uma grade é válida (sem choques, sem violações de disponibilidade, etc.)
 * Usa detectConflicts do schedule-utils (importado para evitar duplicação).
 */
import { detectConflicts } from "./schedule-utils";

export function gradeValida(alocacoes: Alocacao[], professores: Professor[], disciplinas: Disciplina[], turmas: Turma[], matriz: MatrizCurricular[]): boolean {
  const conflicts = detectConflicts(alocacoes, professores, disciplinas, turmas, matriz);
  return conflicts.length === 0;
}

// ── SISTEMA DE SCORE INCREMENTAL E CÁLCULO DE DELTA (PERFORMANCE INDUSTRIAL) ──

export function getLocalBuracosTurma(alocacoes: Alocacao[], turmaId: string, dia: string): number {
  const horas = alocacoes
    .filter((a) => a.turmaId === turmaId && a.diaSemana === dia)
    .map((a) => a.horario)
    .sort((a, b) => a - b);
  if (horas.length < 2) return 0;
  let buracos = 0;
  const min = horas[0];
  const max = horas[horas.length - 1];
  for (let h = min; h <= max; h++) {
    if (!horas.includes(h)) buracos++;
  }
  return buracos;
}

export function getLocalJanelasProf(alocacoes: Alocacao[], profId: string, dia: string): number {
  const horas = alocacoes
    .filter((a) => a.professorId === profId && a.diaSemana === dia)
    .map((a) => a.horario)
    .sort((a, b) => a - b);
  if (horas.length < 2) return 0;
  let janelas = 0;
  const min = horas[0];
  const max = horas[horas.length - 1];
  for (let h = min; h <= max; h++) {
    if (!horas.includes(h)) janelas++;
  }
  return janelas;
}

export function getLocalGeminacoes(alocacoes: Alocacao[], turmaId: string, discId: string, dia: string): number {
  const horas = alocacoes
    .filter((a) => a.turmaId === turmaId && a.disciplinaId === discId && a.diaSemana === dia)
    .map((a) => a.horario)
    .sort((a, b) => a - b);
  if (horas.length < 2) return 0;
  const isGoodPair = (h1: number, h2: number): boolean => {
    const diff = Math.abs(h1 - h2);
    if (diff !== 1) return false;
    const min = Math.min(h1, h2);
    return min === 1 || min === 2 || min === 4 || min === 5;
  };
  let geminacoes = 0;
  for (let i = 0; i < horas.length - 1; i++) {
    if (isGoodPair(horas[i], horas[i + 1])) {
      geminacoes++;
      i++;
    }
  }
  return geminacoes;
}

export function getLocalViolacoesPedagogicas(
  alocacoes: Alocacao[],
  turmaId: string,
  discId: string,
  profId: string,
  dia: string,
  discObj?: Disciplina,
  profObj?: Professor
): { violacoes: number; blocosExcedidos: number } {
  const horas = alocacoes
    .filter(
      (a) =>
        a.turmaId === turmaId &&
        a.disciplinaId === discId &&
        a.professorId === profId &&
        a.diaSemana === dia
    )
    .map((a) => a.horario)
    .sort((a, b) => a - b);

  let violacoes = 0;
  let blocosExcedidos = 0;

  if (horas.length === 0) return { violacoes, blocosExcedidos };

  let maxPorDia = 2; // Decoupled from Disciplina model's maximoAulasPorDia
  let maxConsecLimit = 2;

  if (profObj && Array.isArray(profObj.planejamento)) {
    const planeItem = profObj.planejamento.find(
      (item) => item.disciplinaId === discId && item.turmaId === turmaId
    );
    if (planeItem) {
      if (planeItem.maximoAulasPorDia !== undefined && planeItem.maximoAulasPorDia !== null) {
        maxPorDia = planeItem.maximoAulasPorDia;
      }
      if (planeItem.maximoConsecutivas !== undefined && planeItem.maximoConsecutivas !== null) {
        maxConsecLimit = planeItem.maximoConsecutivas;
      }
    }
  }

  if (horas.length > maxPorDia) {
    violacoes++;
  }

  let currentConsec = 0;
  let lastH = -10;
  for (const hVal of horas) {
    if (hVal === lastH + 1) {
      currentConsec++;
    } else {
      currentConsec = 1;
    }
    if (currentConsec > maxConsecLimit) {
      blocosExcedidos++;
      violacoes++;
      break;
    }
    lastH = hVal;
  }

  return { violacoes, blocosExcedidos };
}

export class IncrementalScore {
  private score: number = 0;
  private totalPlanejado: number = 0;
  private lastAlocacoes: Alocacao[] = [];
  
  constructor(
    alocacoes: Alocacao[],
    private turmas: Turma[],
    private professores: Professor[],
    private disciplinas: Disciplina[],
    private matriz: MatrizCurricular[]
  ) {
    this.totalPlanejado = matriz.reduce((sum, m) => sum + m.aulasPorSemana, 0);
    this.lastAlocacoes = alocacoes.map(a => ({ ...a }));
    this.score = calcularScore(alocacoes, turmas, professores, disciplinas, matriz, this.totalPlanejado);
  }

  public getScore(): number {
    return this.score;
  }

  // Calcula o delta de score para a mudança de dia e horário de uma única alocação
  public calculateMoveDelta(
    alocId: string,
    newDia: string,
    newHorario: number
  ): number {
    const targetAloc = this.lastAlocacoes.find(a => a.id === alocId);
    if (!targetAloc) return 0;

    const oldDia = targetAloc.diaSemana;
    const oldHorario = targetAloc.horario;

    if (oldDia === newDia && oldHorario === newHorario) return 0;

    const turmaId = targetAloc.turmaId;
    const profId = targetAloc.professorId;
    const discId = targetAloc.disciplinaId;

    const affectedDays = oldDia === newDia ? [oldDia] : [oldDia, newDia];

    let oldScoreLocal = 0;
    let newScoreLocal = 0;

    const discObj = this.disciplinas.find(d => d.id === discId);
    const profObj = this.professores.find(p => p.id === profId);

    // Calcular o score local antes
    for (const dia of affectedDays) {
      oldScoreLocal += this.calculateScoreLocal(this.lastAlocacoes, turmaId, profId, discId, dia, discObj, profObj);
    }

    // Aplica a alteração temporariamente
    targetAloc.diaSemana = newDia;
    targetAloc.horario = newHorario;

    // Calcular o score local depois
    for (const dia of affectedDays) {
      newScoreLocal += this.calculateScoreLocal(this.lastAlocacoes, turmaId, profId, discId, dia, discObj, profObj);
    }

    // Desfaz a alteração temporária
    targetAloc.diaSemana = oldDia;
    targetAloc.horario = oldHorario;

    return newScoreLocal - oldScoreLocal;
  }

  // Calcula o delta de score para a troca de horários de duas alocações (permuta)
  public calculateSwapDelta(
    alocId1: string,
    alocId2: string
  ): number {
    const a1 = this.lastAlocacoes.find(a => a.id === alocId1);
    const a2 = this.lastAlocacoes.find(a => a.id === alocId2);
    if (!a1 || !a2) return 0;

    const d1 = a1.diaSemana;
    const h1 = a1.horario;
    const d2 = a2.diaSemana;
    const h2 = a2.horario;

    if (d1 === d2 && h1 === h2) return 0;

    const affectedDays = d1 === d2 ? [d1] : [d1, d2];
    const entities = [
      { tId: a1.turmaId, pId: a1.professorId, dId: a1.disciplinaId },
      { tId: a2.turmaId, pId: a2.professorId, dId: a2.disciplinaId }
    ];

    let oldScoreLocal = 0;
    let newScoreLocal = 0;

    const getEntityLocalScore = (alocs: Alocacao[]) => {
      let sum = 0;
      const seen = new Set<string>();
      for (const ent of entities) {
        for (const dia of affectedDays) {
          const key = `${ent.tId}|${ent.pId}|${ent.dId}|${dia}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const discObj = this.disciplinas.find(d => d.id === ent.dId);
          const profObj = this.professores.find(p => p.id === ent.pId);
          sum += this.calculateScoreLocal(alocs, ent.tId, ent.pId, ent.dId, dia, discObj, profObj);
        }
      }
      return sum;
    };

    oldScoreLocal = getEntityLocalScore(this.lastAlocacoes);

    // Aplica o swap temporariamente
    a1.diaSemana = d2;
    a1.horario = h2;
    a2.diaSemana = d1;
    a2.horario = h1;

    newScoreLocal = getEntityLocalScore(this.lastAlocacoes);

    // Desfaz o swap temporário
    a1.diaSemana = d1;
    a1.horario = h1;
    a2.diaSemana = d2;
    a2.horario = h2;

    return newScoreLocal - oldScoreLocal;
  }

  public applyMove(alocId: string, newDia: string, newHorario: number) {
    const delta = this.calculateMoveDelta(alocId, newDia, newHorario);
    const targetAloc = this.lastAlocacoes.find(a => a.id === alocId);
    if (targetAloc) {
      targetAloc.diaSemana = newDia;
      targetAloc.horario = newHorario;
    }
    this.score += delta;
  }

  public applySwap(alocId1: string, alocId2: string) {
    const delta = this.calculateSwapDelta(alocId1, alocId2);
    const a1 = this.lastAlocacoes.find(a => a.id === alocId1);
    const a2 = this.lastAlocacoes.find(a => a.id === alocId2);
    if (a1 && a2) {
      const d1 = a1.diaSemana;
      const h1 = a1.horario;
      const d2 = a2.diaSemana;
      const h2 = a2.horario;
      a1.diaSemana = d2;
      a1.horario = h2;
      a2.diaSemana = d1;
      a2.horario = h1;
    }
    this.score += delta;
  }

  public syncAlocacoes(newAlocs: Alocacao[]) {
    this.lastAlocacoes = newAlocs.map(a => ({ ...a }));
    this.score = calcularScore(newAlocs, this.turmas, this.professores, this.disciplinas, this.matriz, this.totalPlanejado);
  }

  private calculateScoreLocal(
    alocs: Alocacao[],
    turmaId: string,
    profId: string,
    discId: string,
    dia: string,
    discObj?: Disciplina,
    profObj?: Professor
  ): number {
    let score = 0;
    
    // 1. Buracos turma
    const buracos = getLocalBuracosTurma(alocs, turmaId, dia);
    score += buracos * PESOS.BURACO_TURMA;

    // 2. Janelas prof
    const janelas = getLocalJanelasProf(alocs, profId, dia);
    score += janelas * PESOS.JANELA_PROFESSOR;

    // 3. Geminação
    const geminacoes = getLocalGeminacoes(alocs, turmaId, discId, dia);
    score += geminacoes * PESOS.GEMINACAO;

    // 4. Violações & Blocos consecutivos
    const { violacoes, blocosExcedidos } = getLocalViolacoesPedagogicas(alocs, turmaId, discId, profId, dia, discObj, profObj);
    score += violacoes * PESOS.VIOLACAO_PEDAGOGICA;
    score += blocosExcedidos * PESOS.BLOCO_3_CONSECUTIVAS;

    return score;
  }
}

export interface MetricasDetalhadas {
  iqg: number;
  componentes: {
    buracosTurmas: number;
    janelasProfessores: number;
    distribuicaoSemanal: number;
    geminacao: number;
    consecutividade: number;
    cargaHoraria: number;
  };
  oportunidades: {
    buracosEvitaveis: number;
    janelasEvitaveis: number;
    geminacoesPossiveis: number;
  };
}

export function calcularMetricasDetalhadas(
  alocacoes: Alocacao[],
  turmas: Turma[],
  professores: Professor[],
  disciplinas: Disciplina[],
  matriz: MatrizCurricular[]
): MetricasDetalhadas {
  const totalPlanejado = matriz.reduce((sum, m) => sum + m.aulasPorSemana, 0);
  const score = calcularScore(alocacoes, turmas, professores, disciplinas, matriz, totalPlanejado);
  
  const iqg = Math.max(0, Math.min(100, (score / (Math.max(1, totalPlanejado) * 1000)) * 100));
  
  const buracos = contarBuracosTurma(alocacoes, turmas);
  const janelas = contarJanelasProfessor(alocacoes, professores);
  const geminacoes = contarGeminacoes(alocacoes, disciplinas);
  
  const maxBuracos = Math.max(1, turmas.length * 5 * 5);
  const maxJanelas = Math.max(1, professores.length * 5 * 5);
  const maxGeminacoes = Math.max(1, totalPlanejado);
  
  let scoreDist = 100;
  try {
    const idealMap = new Map<string, number>();
    for (const m of matriz) {
      const key = `${m.turmaId}|${m.disciplinaId}`;
      idealMap.set(key, m.aulasPorSemana);
    }
    let desbalanceamentosCount = 0;
    const DIAS = ["segunda", "terca", "quarta", "quinta", "sexta"];
    for (const [key, aulasPorSemana] of idealMap.entries()) {
      const [turmaId, discId] = key.split('|');
      const baseIdeal = Math.floor(aulasPorSemana / 5);
      const restoIdeal = aulasPorSemana % 5;
      
      for (let i = 0; i < 5; i++) {
        const dia = DIAS[i];
        const atual = alocacoes.filter(a => a.turmaId === turmaId && a.disciplinaId === discId && a.diaSemana === dia).length;
        const ideal = baseIdeal + (i < restoIdeal ? 1 : 0);
        if (Math.abs(atual - ideal) > 1) {
          desbalanceamentosCount++;
        }
      }
    }
    scoreDist = Math.max(0, 100 - (desbalanceamentosCount * 3));
  } catch (e) {
    scoreDist = 95;
  }

  let consecutividadeScore = 100;
  try {
    let consecExcedidas = 0;
    const map = new Map<string, number[]>();
    for (const a of alocacoes) {
      const key = `${a.turmaId}|${a.diaSemana}|${a.disciplinaId}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a.horario);
    }
    for (const horas of map.values()) {
      const sorted = horas.sort((a, b) => a - b);
      let consec = 1;
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] === sorted[i - 1] + 1) {
          consec++;
          if (consec > 2) consecExcedidas++;
        } else {
          consec = 1;
        }
      }
    }
    consecutividadeScore = Math.max(0, 100 - (consecExcedidas * 5));
  } catch (e) {
    consecutividadeScore = 95;
  }

  let excessoCarga = 0;
  for (const prof of professores) {
    const aulasProf = alocacoes.filter(a => a.professorId === prof.id);
    let totalMaxPermitido = 0;
    if (prof.planejamento) {
      totalMaxPermitido = prof.planejamento.reduce((sum, item) => sum + (Number(item.aulasPorSemana !== undefined ? item.aulasPorSemana : item.quantidadeAulas) || 0), 0);
    }
    if (aulasProf.length > totalMaxPermitido) {
      excessoCarga += (aulasProf.length - totalMaxPermitido);
    }
  }
  const cargaHorariaScore = Math.max(0, 100 - (excessoCarga * 10));
  
  return {
    iqg,
    componentes: {
      buracosTurmas: Math.max(0, Math.min(100, 100 - (buracos / maxBuracos) * 100)),
      janelasProfessores: Math.max(0, Math.min(100, 100 - (janelas / maxJanelas) * 100)),
      distribuicaoSemanal: scoreDist,
      geminacao: Math.min(100, (geminacoes / maxGeminacoes) * 100),
      consecutividade: consecutividadeScore,
      cargaHoraria: cargaHorariaScore
    },
    oportunidades: {
      buracosEvitaveis: buracos,
      janelasEvitaveis: janelas,
      geminacoesPossiveis: Math.max(0, maxGeminacoes - geminacoes)
    }
  };
}
