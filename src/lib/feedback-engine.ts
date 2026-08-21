/**
 * feedback-engine.ts
 * ──────────────────────────────────────────────────────────────
 * Motor de Feedback para o Gerador de Grades
 * Recebe o relatório de integridade e fornece instruções
 * para o motor de geração evitar os mesmos erros.
 */

import type { RelatorioIntegridade } from "./integrity-validator";

export interface FeedbackInstrucao {
  tipo: "erro" | "alerta" | "instrucao";
  mensagem: string;
  acaoRecomendada: string;
  parametrosAjustados?: {
    prioridade?: Record<string, number>;
    limites?: Record<string, number>;
  };
}

export interface FeedbackResultado {
  instrucoes: FeedbackInstrucao[];
  deveRegenerar: boolean;
  mensagemConsolidada: string;
  parametrosAjustados?: {
    prioridade?: Record<string, number>;
    limites?: Record<string, number>;
  };
}

/**
 * Analisa o relatório de integridade e gera feedback para o motor de geração
 */
export function gerarFeedbackParaGerador(
  relatorio: RelatorioIntegridade
): FeedbackResultado {
  const instrucoes: FeedbackInstrucao[] = [];
  let deveRegenerar = false;
  const parametrosAjustados: Record<string, any> = {};

  if (relatorio.valido) {
    instrucoes.push({
      tipo: "instrucao",
      mensagem: "✅ Todos os professores estão dentro da carga planejada.",
      acaoRecomendada: "Manter a grade atual. Nenhuma correção necessária."
    });
    return {
      instrucoes,
      deveRegenerar: false,
      mensagemConsolidada: "Integridade confirmada. Grade aprovada."
    };
  }

  // Analisar padrões de excesso
  const professoresAfetados = [...new Set(relatorio.professoresComExcesso.map(p => p.professorId))];
  const disciplinasAfetadas = [...new Set(relatorio.professoresComExcesso.map(p => p.disciplinaId))];
  const turmasAfetadas = [...new Set(relatorio.professoresComExcesso.map(p => p.turmaId))];

  // 1. Identificar padrões de erro
  const erroPorProfessor = new Map<string, number>();
  const erroPorDisciplina = new Map<string, number>();
  const erroPorTurma = new Map<string, number>();

  for (const excesso of relatorio.professoresComExcesso) {
    erroPorProfessor.set(excesso.professorId, (erroPorProfessor.get(excesso.professorId) || 0) + excesso.excesso);
    erroPorDisciplina.set(excesso.disciplinaId, (erroPorDisciplina.get(excesso.disciplinaId) || 0) + excesso.excesso);
    erroPorTurma.set(excesso.turmaId, (erroPorTurma.get(excesso.turmaId) || 0) + excesso.excesso);
  }

  // 2. Gerar instruções específicas
  if (professoresAfetados.length > 0) {
    const profsNomes = relatorio.professoresComExcesso.map(p => p.professorNome).join(", ");
    instrucoes.push({
      tipo: "erro",
      mensagem: `⚠️ ${professoresAfetados.length} professor(es) excederam a carga planejada: ${profsNomes}`,
      acaoRecomendada: "O motor deve respeitar os limites de carga por (Professor + Turma + Disciplina) durante a alocação."
    });
  }

  if (disciplinasAfetadas.length > 0) {
    const discNomes = [...new Set(relatorio.professoresComExcesso.map(p => p.disciplinaNome))].join(", ");
    instrucoes.push({
      tipo: "alerta",
      mensagem: `📘 Disciplinas com excesso: ${discNomes}`,
      acaoRecomendada: "Verificar se a carga horária destas disciplinas está correta na matriz curricular."
    });
  }

  if (turmasAfetadas.length > 0) {
    const turmasNomes = [...new Set(relatorio.professoresComExcesso.map(p => p.turmaNome))].join(", ");
    instrucoes.push({
      tipo: "alerta",
      mensagem: `🏫 Turmas com excesso: ${turmasNomes}`,
      acaoRecomendada: "Distribuir melhor as aulas destas turmas entre os professores disponíveis."
    });
  }

  // 3. Ajustar parâmetros para próxima geração
  const professoresComErro = [...erroPorProfessor.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  // Marcar professores com erro para receberem prioridade menor na próxima geração
  const prioridadeAjustada: Record<string, number> = {};
  for (const pId of professoresComErro) {
    // Reduzir prioridade para evitar que o motor aloque demais neste professor
    prioridadeAjustada[pId] = -1;
  }

  parametrosAjustados.prioridade = prioridadeAjustada;

  // 4. Se houver excessos, recomendar regeneração
  if (relatorio.totalAulasRemovidas > 0) {
    deveRegenerar = true;
    instrucoes.push({
      tipo: "instrucao",
      mensagem: `🔄 ${relatorio.totalAulasRemovidas} aula(s) foram removidas. Recomenda-se regenerar a grade com os parâmetros ajustados.`,
      acaoRecomendada: "Executar nova geração com os parâmetros de prioridade ajustados.",
      parametrosAjustados
    });
  }

  // Mensagem consolidada
  let mensagemConsolidada = `Foram detectados ${relatorio.professoresComExcesso.length} caso(s) de excesso. `;
  mensagemConsolidada += `${relatorio.totalAulasRemovidas} aula(s) removidas. `;
  mensagemConsolidada += deveRegenerar ? "Recomenda-se regenerar a grade." : "Grade corrigida e aprovada.";

  return {
    instrucoes,
    deveRegenerar,
    mensagemConsolidada,
    parametrosAjustados
  };
}
