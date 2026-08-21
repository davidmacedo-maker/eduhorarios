/**
 * explainability-service.ts
 * ──────────────────────────────────────────────────────────────
 * Camada de Explicabilidade Ativa (Explainability Layer) para o Escalonador de Horários.
 * Registra e reconstrói a cadeia causal de decisões de alocação,
 * permitindo análise profunda de por que as coisas aconteceram e por que restam buracos.
 */

import type { Alocacao, Turma, Professor, Disciplina, MatrizCurricular } from "@/types";
import { verificarSlotViavelComMotivo, isProfAvailableAt } from "./schedule-utils";
import { contarBuracosTurma, contarJanelasProfessor } from "./score-utils";

export interface DecisionTrace {
  stepId: string;
  action: string; // e.g., "M1_INITIAL_ALLOCATION", "M2_BACKFILL", "M3_COMPACT", "M4_LOCAL_SWAP", "M4_GLOBAL_SWAP", "ESTABILIZACAO", "MANUAL_EDIT", "AI_SUGGESTED"
  timestamp: number;
  description: string;
  beforeState: {
    gapsCount: number;
    allocatedCount: number;
    conflictsCount: number;
  };
  afterState: {
    gapsCount: number;
    allocatedCount: number;
    conflictsCount: number;
  };
  delta: {
    gaps: number; // positive means gaps increased, negative means reduced
    allocated: number;
    conflicts: number;
  };
  reason: string; // Causal reasoning (text representation of the rule or why it was run)
  validatorResult: {
    ok: boolean;
    reason?: string;
  };
  scoreImpact: number; // change in absolute fitness score
}

export class ExplainabilityEngine {
  private traces: DecisionTrace[] = [];

  constructor(initialTraces?: DecisionTrace[]) {
    if (initialTraces) {
      this.traces = [...initialTraces];
    }
  }

  /**
   * Registra uma decisão com snapshot de estados
   */
  public log(
    action: string,
    description: string,
    before: { gapsCount: number; allocatedCount: number; conflictsCount: number },
    after: { gapsCount: number; allocatedCount: number; conflictsCount: number },
    reason: string,
    validatorOk = true,
    validatorReason = "Aprovado por regras determinísticas",
    scoreChange = 0
  ) {
    const traceId = `trace-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const trace: DecisionTrace = {
      stepId: traceId,
      action,
      timestamp: Date.now(),
      description,
      beforeState: before,
      afterState: after,
      delta: {
        gaps: after.gapsCount - before.gapsCount,
        allocated: after.allocatedCount - before.allocatedCount,
        conflicts: after.conflictsCount - before.conflictsCount
      },
      reason,
      validatorResult: {
        ok: validatorOk,
        reason: validatorReason
      },
      scoreImpact: scoreChange
    };
    this.traces.push(trace);
  }

  public getFullExplanation(): DecisionTrace[] {
    return this.traces;
  }

  public clear() {
    this.traces = [];
  }
}

export interface GapDiagnosis {
  turmaId: string;
  turmaNome: string;
  diaSemana: string;
  horariosVagos: number[];
  causas: {
    disciplinaId: string;
    disciplinaNome: string;
    professorId: string;
    professorNome: string;
    motivoBloqueio: string;
  }[];
}

/**
 * Realiza Engenharia Reversa em buracos remanescentes para explicar por que não puderam ser removidos.
 * Testa cada professor disponível no planejamento para aquela turma e disciplina, justificando a falha de slot.
 */
export function diagnoseRemainingGaps(
  grade: Alocacao[],
  turmas: Turma[],
  professores: Professor[],
  disciplinas: Disciplina[],
  matriz: MatrizCurricular[],
  config: any
): GapDiagnosis[] {
  const diagnoses: GapDiagnosis[] = [];

  // Mapeia planejamento para saber qual professor leciona qual disciplina para qual turma
  const profDe = new Map<string, string>();
  professores.forEach((p) => {
    const itens = Array.isArray(p.planejamento) ? p.planejamento : [];
    itens.forEach((it) => {
      profDe.set(`${it.turmaId}|${it.disciplinaId}`, p.id);
    });
  });

  for (const t of turmas) {
    const maxSlots = t.turno === "manha" ? (config.quantidadeHorariosPorDia ?? 6) :
                     t.turno === "tarde" ? (config.quantidadeHorariosPorDiaTarde ?? 5) :
                     (config.quantidadeHorariosPorDiaNoite ?? 4);

    const tAlocs = grade.filter((a) => a.turmaId === t.id);
    const dias = ["segunda", "terca", "quarta", "quinta", "sexta"];

    for (const dia of dias) {
      const diaAlocs = tAlocs.filter((a) => a.diaSemana === dia).sort((a, b) => a.horario - b.horario);
      if (diaAlocs.length < 2) continue; // Sem buraco possível se tem <= 1 aula no dia

      const occupied = new Set(diaAlocs.map((a) => a.horario));
      const maxOccupied = Math.max(...occupied);
      const minOccupied = Math.min(...occupied);

      const emptySlotsBelowMax: number[] = [];
      for (let h = minOccupied; h < maxOccupied; h++) {
        if (!occupied.has(h)) {
          emptySlotsBelowMax.push(h);
        }
      }

      if (emptySlotsBelowMax.length === 0) continue;

      // Temos buraco(s) neste dia para esta turma! Vamos diagnosticar.
      const diag: GapDiagnosis = {
        turmaId: t.id,
        turmaNome: t.nome,
        diaSemana: dia,
        horariosVagos: emptySlotsBelowMax,
        causas: []
      };

      // Quais disciplinas/professores pertencem a esta turma que teoricamente poderiam cobrir o buraco?
      const tMatriz = matriz.filter((m) => m.turmaId === t.id);

      for (const h of emptySlotsBelowMax) {
        for (const m of tMatriz) {
          const profId = profDe.get(`${t.id}|${m.disciplinaId}`);
          if (!profId) continue;

          const prof = professores.find((p) => p.id === profId);
          const disc = disciplinas.find((d) => d.id === m.disciplinaId);
          if (!prof || !disc) continue;

          // Testa viabilidade deterministica do slot
          const check = verificarSlotViavelComMotivo(
            grade,
            professores,
            disciplinas,
            turmas,
            matriz,
            config,
            profId,
            t.id,
            m.disciplinaId,
            dia,
            h,
            undefined // regras normais sem relaxamento para ver por que travou
          );

          if (!check.viavel) {
            diag.causas.push({
              disciplinaId: disc.id,
              disciplinaNome: disc.nome,
              professorId: profId,
              professorNome: prof.nomeCompleto,
              motivoBloqueio: `Horário ${h}º H indisponível: ${check.motivo || "Carga horária restrita ou choque de horário."}`
            });
          }
        }
      }

      if (diag.causas.length > 0) {
        diagnoses.push(diag);
      }
    }
  }

  return diagnoses;
}

export interface UnallocatedClassDiagnosis {
  codigo: "CAD001" | "MAT001" | "PRO001" | "TUR001" | "MOT001" | "CON001" | "REP001";
  turmaId: string;
  turmaNome: string;
  disciplinaId: string;
  disciplinaNome: string;
  professorId: string;
  professorNome: string;
  motivo: string;
  sugestao: string;
}

export function diagnoseUnallocatedClasses(
  grade: Alocacao[],
  turmas: Turma[],
  professores: Professor[],
  disciplinas: Disciplina[],
  matriz: MatrizCurricular[],
  config: any
): UnallocatedClassDiagnosis[] {
  const diagnoses: UnallocatedClassDiagnosis[] = [];

  // Mapeia planejamento para achar o professor
  const profDe = new Map<string, string>();
  professores.forEach((p) => {
    const itens = Array.isArray(p.planejamento) ? p.planejamento : [];
    itens.forEach((it) => {
      profDe.set(`${it.turmaId}|${it.disciplinaId}`, p.id);
    });
  });

  for (const m of matriz) {
    const t = turmas.find(x => x.id === m.turmaId);
    const d = disciplinas.find(x => x.id === m.disciplinaId);
    if (!t || !d) continue;

    // Aulas alocadas para este componente curricular
    const allocated = grade.filter(a => a.turmaId === t.id && a.disciplinaId === d.id);
    const planejado = m.aulasPorSemana || 0;
    const faltantes = Math.max(0, planejado - allocated.length);

    if (faltantes > 0) {
      const profId = profDe.get(`${t.id}|${d.id}`);
      const prof = profId ? professores.find(p => p.id === profId) : null;
      const profNome = prof ? prof.nomeCompleto : "Sem Professor Atribuído";

      for (let i = 0; i < faltantes; i++) {
        // Se não tem professor
        if (!profId || !prof) {
          diagnoses.push({
            codigo: "CAD001",
            turmaId: t.id,
            turmaNome: t.nome,
            disciplinaId: d.id,
            disciplinaNome: d.nome,
            professorId: "",
            professorNome: "Sem Professor",
            motivo: `Nenhum professor foi vinculado a esta disciplina no planejamento da turma.`,
            sugestao: `Editar cadastro do professor ou associá-lo no Planejamento.`
          });
          continue;
        }

        // 1. CHECAGEM DE CAPACIDADE FÍSICA SELETIVA DA TURMA (TUR001)
        const slotsPerDay = t.turno === "noite"
          ? (config.quantidadeHorariosPorDiaNoite ?? 4)
          : t.turno === "tarde"
            ? (config.quantidadeHorariosPorDiaTarde ?? 5)
            : (config.quantidadeHorariosPorDia ?? 6);
        const allowedDaysCount = t.diasPermitidos?.length ?? 5;
        const classCapacity = allowedDaysCount * slotsPerDay;
        const requiredHoursForTurma = matriz
          .filter((mat) => mat.turmaId === t.id)
          .reduce((acc, mat) => acc + (mat.aulasPorSemana || 0), 0);

        if (requiredHoursForTurma > classCapacity) {
          diagnoses.push({
            codigo: "TUR001",
            turmaId: t.id,
            turmaNome: t.nome,
            disciplinaId: d.id,
            disciplinaNome: d.nome,
            professorId: prof.id,
            professorNome: prof.nomeCompleto,
            motivo: `A matriz curricular excede a capacidade física da turma (${requiredHoursForTurma} aulas planejadas vs. capacidade máxima de ${classCapacity} aulas em ${allowedDaysCount} dias de ${slotsPerDay} horários).`,
            sugestao: `Adicionar mais um dia ao contraturno ou aumentar os horários diários.`
          });
          continue;
        }

        // 2. CHECAGEM DE CAPACIDADE DE CONTRATO DO PROFESSOR (PRO001)
        let totalProfNeeded = 0;
        const pItems = Array.isArray(prof.planejamento) ? prof.planejamento : [];
        pItems.forEach((it) => {
          totalProfNeeded += Number(it.aulasPorSemana || it.quantidadeAulas || 0);
        });

        if (prof.cargaHorariaMaximaSemanal && totalProfNeeded > prof.cargaHorariaMaximaSemanal) {
          diagnoses.push({
            codigo: "PRO001",
            turmaId: t.id,
            turmaNome: t.nome,
            disciplinaId: d.id,
            disciplinaNome: d.nome,
            professorId: prof.id,
            professorNome: prof.nomeCompleto,
            motivo: `O professor ${prof.nomeCompleto} atingiu a carga horária máxima cadastrada (${prof.cargaHorariaMaximaSemanal} aulas).`,
            sugestao: `Aumentar a carga horária máxima permitida ou redistribuir aulas.`
          });
          continue;
        }

        // 3. DISPONIBILIDADE INSUFICIENTE DO PROFESSOR (PRO001)
        let availableCount = 0;
        const daysOfWeek = ["segunda", "terca", "quarta", "quinta", "sexta"];
        daysOfWeek.forEach((dia) => {
          for (let h = 1; h <= slotsPerDay; h++) {
            if (isProfAvailableAt(prof.disponibilidade, dia, h, t.turno)) {
              availableCount++;
            }
          }
        });

        if (totalProfNeeded > availableCount) {
          diagnoses.push({
            codigo: "PRO001",
            turmaId: t.id,
            turmaNome: t.nome,
            disciplinaId: d.id,
            disciplinaNome: d.nome,
            professorId: prof.id,
            professorNome: prof.nomeCompleto,
            motivo: `Professor indisponível: Carga do planejamento (${totalProfNeeded} aulas) excede a disponibilidade real declarada (${availableCount} horários livres).`,
            sugestao: `Adicionar mais um dia de disponibilidade para ${prof.nomeCompleto} ou reduzir sua carga no planejamento.`
          });
          continue;
        }

        // 4. CONFLITOS DE HORÁRIO / BLOQUEIO DETERMINÍSTICO (CON001)
        let openSlotsCount = 0;
        let classOccupiedCount = 0;
        let profConflictedCount = 0;
        let pedRestrictCount = 0;

        daysOfWeek.forEach((dia) => {
          for (let h = 1; h <= slotsPerDay; h++) {
            if (isProfAvailableAt(prof.disponibilidade, dia, h, t.turno)) {
              openSlotsCount++;
              
              // Verifica se a turma já tem aula nesse slot
              const classOccupied = grade.some(a => a.turmaId === t.id && a.diaSemana === dia && a.horario === h);
              if (classOccupied) {
                classOccupiedCount++;
                continue;
              }

              // Verifica se o professor já está alocado em outra turma nesse slot
              const profOccupied = grade.some(a => a.professorId === prof.id && a.diaSemana === dia && a.horario === h);
              if (profOccupied) {
                profConflictedCount++;
                continue;
              }

              // Se ambos livres, testamos as regras pedagógicas (geminação, limites, etc.)
              const check = verificarSlotViavelComMotivo(
                grade,
                professores,
                disciplinas,
                turmas,
                matriz,
                config,
                prof.id,
                t.id,
                d.id,
                dia,
                h
              );
              if (!check.viavel) {
                pedRestrictCount++;
              }
            }
          }
        });

        if (profConflictedCount > 0 || classOccupiedCount > 0) {
          diagnoses.push({
            codigo: "CON001",
            turmaId: t.id,
            turmaNome: t.nome,
            disciplinaId: d.id,
            disciplinaNome: d.nome,
            professorId: prof.id,
            professorNome: prof.nomeCompleto,
            motivo: `Conflito de horários: Os horários disponíveis de ${prof.nomeCompleto} coincidem com aulas de outras turmas ou a turma já está preenchida por outras matérias.`,
            sugestao: `Mover aula de outra disciplina para liberar o slot ou aumentar a disponibilidade de professores.`
          });
        } else if (pedRestrictCount > 0) {
          diagnoses.push({
            codigo: "REP001",
            turmaId: t.id,
            turmaNome: t.nome,
            disciplinaId: d.id,
            disciplinaNome: d.nome,
            professorId: prof.id,
            professorNome: prof.nomeCompleto,
            motivo: `Restrição Pedagógica: O limite de aulas consecutivas ou aulas diárias do componente impediram a alocação nos horários livres restantes.`,
            sugestao: `Flexibilizar o limite diário de aulas ou requisitos de geminação.`
          });
        } else {
          diagnoses.push({
            codigo: "MOT001",
            turmaId: t.id,
            turmaNome: t.nome,
            disciplinaId: d.id,
            disciplinaNome: d.nome,
            professorId: prof.id,
            professorNome: prof.nomeCompleto,
            motivo: `Limitação do motor: Não foi possível encaixar devido ao empacotamento combinatorial complexo das demais disciplinas.`,
            sugestao: `Aumentar o nível de busca profunda do motor para permitir mais retrocesso (backtracking).`
          });
        }
      }
    }
  }

  return diagnoses;
}

/**
 * Envia diagnósticos de buraco e traços de decisões para a inteligência artificial
 * para tradução em prosa humanizada de fácil digestão pelos coordenadores pedagógicos.
 */
export async function requestAITranslationOfTraces(
  traces: DecisionTrace[],
  diagnoses: GapDiagnosis[],
  provider: "ollama" | "gemini",
  ollamaUrl = "http://localhost:11434",
  modelName = "qwen2.5",
  customGeminiKey = ""
): Promise<string> {
  const condensedTraces = traces.map((t) => ({
    etapa: t.action,
    descricao: t.description,
    gapsAntes: t.beforeState.gapsCount,
    gapsDepois: t.afterState.gapsCount,
    deltaGaps: t.delta.gaps,
    motivo: t.reason
  }));

  const condensedDiagnoses = diagnoses.map((d) => ({
    turma: d.turmaNome,
    dia: d.diaSemana,
    horariosBuracos: d.horariosVagos,
    impedimentosFisicos: d.causas.map((c) => ({
      disciplina: c.disciplinaNome,
      professor: c.professorNome,
      porqueNaoMoveu: c.motivoBloqueio
    }))
  }));

  const prompt = `Você é um Analista de Escalonamento Escolar e Engenheiro Causal.
Analise a trilha de decisão do motor de geração de horários e os diagnósticos de buracos remanescentes.
Escreva um relatório pedagógico claro, extremamente inteligente e humanizado para a coordenação de ensino municipal.

O relatório deve conter:
1. **Análise de Eficácia do Pipeline**: Comente as etapas de redução acumulada de buracos (compactação e permutas do Motor 3 e 4).
2. **Explicação de Buracos Remanescentes**: Traduza os "impedimentosFisicos" científicos em frases simples e acolhedoras para o pedagogo (Ex: "O buraco na terça-feira do 2º Ano ocorre porque o professor Carlos de Matemática já dá aulas no 1º Ano naquele mesmo instante, impossibilitando a junção").
3. **Sugestões Pedagógicas Práticas**: O que a escola pode negociar (ex: liberar mais um horário de planejamento, ajustar permissões diárias de aulas dos professores ou alterar a disponibilidade semanal de tal docente) para zerar completamente esses buracos.

Use um tom profissional, acolhedor e com clareza. Evite jargões de código ou banco de dados.

=== TRILHA DE DECISÕES DO MOTOR ===
${JSON.stringify(condensedTraces, null, 2)}

=== DIAGNÓSTICOS DOS BURACOS ATUAIS ===
${JSON.stringify(condensedDiagnoses, null, 2)}

Responda em Markdown limpo (sem tags de retorno extras além de texto corrido estruturado):`;

  try {
    if (provider === "ollama") {
      const response = await fetch(`${ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: "user", content: prompt }],
          stream: false,
          options: { temperature: 0.3 }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama indisponível.`);
      }

      const rawJson = await response.json();
      return rawJson.message?.content || "Sem resposta do Ollama.";
    } else {
      const apiKey = customGeminiKey || (import.meta.env.VITE_GEMINI_API_KEY as string) || "";
      if (!apiKey) {
        throw new Error("Chave do Gemini API necessária.");
      }

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3 }
        })
      });

      if (!response.ok) {
        throw new Error(`Erro na API do Gemini.`);
      }

      const rawJson = await response.json();
      return rawJson.candidates?.[0]?.content?.parts?.[0]?.text || "Falha na tradução via Gemini.";
    }
  } catch (err: any) {
    console.error("[Causal Translation Error]:", err);
    return `Não foi possível gerar a tradução de IA de forma automática devido a um problema de conexão.\n\nContudo, aqui estão os dados puros para consulta rápida:\n\n**Buracos Remanescentes Rastreáveis:**\n${diagnoses.map(d => `• **${d.turmaNome}** (${d.diaSemana.toUpperCase()}): buracos no(s) horário(s) ${d.horariosVagos.join(", ")}º H, travado por indisponibilidade de professores contratados.`).join("\n")}`;
  }
}

export interface GenerationMetrics {
  id: string;
  timestamp: string;
  engine: string;
  totalExigido: number;
  totalAlocado: number;
  conflitos: number;
  gaps: number;
  tempoMs: number;
  iqg: number;
  sucesso: boolean;
  estrategiaUsada: string;
}

export interface LearningInsight {
  tipo: "sucesso" | "alerta" | "recomendacao";
  titulo: string;
  descricao: string;
  impactoEstimado?: string;
}

const STORAGE_KEY = "edu_learning_runs";

/**
 * Saves a generation run metrics into the Learning Engine history.
 */
export function saveGenerationRun(metrics: Omit<GenerationMetrics, "id" | "timestamp">): GenerationMetrics {
  const run: GenerationMetrics = {
    ...metrics,
    id: `run-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString()
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list: GenerationMetrics[] = raw ? JSON.parse(raw) : [];
    list.push(run);
    // Keep last 100 runs
    if (list.length > 100) list.shift();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    console.error("Erro ao salvar métricas no Learning Engine:", e);
  }

  return run;
}

/**
 * Retrieves the full generation runs history.
 */
export function getGenerationHistory(): GenerationMetrics[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

/**
 * Resets the history logs.
 */
export function clearGenerationHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Learns and generates optimization insights based on historical runs.
 */
export function getLearningInsights(history: GenerationMetrics[]): LearningInsight[] {
  const insights: LearningInsight[] = [];

  if (history.length === 0) {
    insights.push({
      tipo: "recomendacao",
      titulo: "Heurística em Fase de Treinamento",
      descricao: "Inicie algumas gerações da grade horária para que o motor de aprendizado colete telemetria de tentativas e otimize as escolhas de backtracking.",
      impactoEstimado: "Melhoria gradual no IQG geral"
    });
    return insights;
  }

  const totalRuns = history.length;
  const successRuns = history.filter(r => r.sucesso).length;
  const avgIqg = history.reduce((sum, r) => sum + r.iqg, 0) / totalRuns;
  const avgTime = history.reduce((sum, r) => sum + r.tempoMs, 0) / totalRuns;

  insights.push({
    tipo: "sucesso",
    titulo: "Base de Conhecimento Estabelecida",
    descricao: `Análise consolidada a partir de ${totalRuns} execuções anteriores, com uma taxa de conversão bem-sucedida de ${((successRuns / totalRuns) * 100).toFixed(0)}%.`,
    impactoEstimado: `IQG médio histórico de ${avgIqg.toFixed(1)} pontos`
  });

  // Analyze if IFS vs LookAhead has better scores
  const ifsRuns = history.filter(r => r.engine.toLowerCase().includes("ifs"));
  const lookaheadRuns = history.filter(r => !r.engine.toLowerCase().includes("ifs") && r.engine !== "repair");

  if (ifsRuns.length > 0 && lookaheadRuns.length > 0) {
    const avgIqgIFS = ifsRuns.reduce((sum, r) => sum + r.iqg, 0) / ifsRuns.length;
    const avgIqgLookahead = lookaheadRuns.reduce((sum, r) => sum + r.iqg, 0) / lookaheadRuns.length;

    if (avgIqgIFS > avgIqgLookahead + 2) {
      insights.push({
        tipo: "recomendacao",
        titulo: "Recomendação de Motor: Motor Avançado (IFS)",
        descricao: "Historicamente, o solucionador de restrições por busca progressiva IFS obteve grades horárias com melhor compacidade de blocos.",
        impactoEstimado: `+${(avgIqgIFS - avgIqgLookahead).toFixed(1)} pontos esperados no IQG`
      });
    } else if (avgIqgLookahead > avgIqgIFS + 2) {
      insights.push({
        tipo: "recomendacao",
        titulo: "Recomendação de Motor: LookAhead / Deep Solver",
        descricao: "Para o perfil atual de restrições da escola, as heurísticas profundas com matriz de colisão de xadrez do motor LookAhead alcançaram melhores resultados.",
        impactoEstimado: `+${(avgIqgLookahead - avgIqgIFS).toFixed(1)} pontos esperados no IQG`
      });
    }
  }

  // Detect bottleneck trends (frequent high conflict count)
  const highConflictRuns = history.filter(r => r.conflitos > 2);
  if (highConflictRuns.length > 0.4 * totalRuns) {
    insights.push({
      tipo: "alerta",
      titulo: "Tendência de Gargalo de Flexibilidade",
      descricao: "Mais de 40% das tentativas de geração resultaram em conflitos pendentes. Isso sugere alta rigidez nas janelas de disponibilidade dos professores cadastrados.",
      impactoEstimado: "Risco alto de travamento do solver principal"
    });
  }

  // Dynamic recommendations for Search level (nivelBusca)
  if (avgTime > 15000) {
    insights.push({
      tipo: "recomendacao",
      titulo: "Limitação de Profundidade de Busca",
      descricao: "O tempo médio de geração está excedendo 15 segundos. Recomendamos reduzir o Nível de Busca para 'Equilibrado' para evitar sobrecarga de processamento no navegador.",
      impactoEstimado: "Redução de até 60% no tempo de espera do usuário"
    });
  } else if (avgTime < 2000 && history.some(r => !r.sucesso)) {
    insights.push({
      tipo: "recomendacao",
      titulo: "Oportunidade de Busca Profunda (Nível 4)",
      descricao: "Gerações estão sendo executadas de forma muito veloz, porém com falhas eventuais. Ativar o Nível de Busca Profunda abrirá mais caminhos de backtracking.",
      impactoEstimado: "Aumento de até 15% na taxa de sucesso de alocação"
    });
  }

  return insights;
}

/**
 * Recommends optimal solver parameters based on learning logs.
 */
export function getAdaptiveParameters(history: GenerationMetrics[]): {
  preferredEngine: "ifs" | "lookahead";
  backtrackDepthLimit: number;
  shuffledHeuristics: boolean;
} {
  const result = {
    preferredEngine: "lookahead" as "ifs" | "lookahead",
    backtrackDepthLimit: 4000,
    shuffledHeuristics: false
  };

  if (history.length === 0) return result;

  const ifsRuns = history.filter(r => r.engine.toLowerCase().includes("ifs"));
  const lookaheadRuns = history.filter(r => !r.engine.toLowerCase().includes("ifs") && r.engine !== "repair");

  const sumIqgIFS = ifsRuns.reduce((sum, r) => sum + r.iqg, 0);
  const sumIqgLookahead = lookaheadRuns.reduce((sum, r) => sum + r.iqg, 0);

  const avgIqgIFS = ifsRuns.length ? sumIqgIFS / ifsRuns.length : 0;
  const avgIqgLookahead = lookaheadRuns.length ? sumIqgLookahead / lookaheadRuns.length : 0;

  if (avgIqgIFS > avgIqgLookahead && ifsRuns.length >= 3) {
    result.preferredEngine = "ifs";
  }

  // If there are many runs with high conflicts, recommend shuffling heuristics to break local minima
  const totalConflicts = history.reduce((sum, r) => sum + r.conflitos, 0);
  if (totalConflicts / history.length > 2) {
    result.shuffledHeuristics = true;
    result.backtrackDepthLimit = 8000; // expand search limit to escape bottlenecks
  }

  return result;
}

