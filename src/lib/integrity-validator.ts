/**
 * integrity-validator.ts
 * ──────────────────────────────────────────────────────────────
 * Motor de Verificação e Correção de Integridade Docente
 * Atua como camada final de validação, garantindo que nenhum
 * professor exceda sua carga horária planejada.
 * 
 * Se detectar excesso, remove as aulas extras e sinaliza
 * para o motor de geração recalcular com feedback.
 */

import type { 
  Alocacao, 
  Professor, 
  Turma, 
  Disciplina, 
  MatrizCurricular,
  PlanejamentoItem 
} from "@/types";

export interface ExcessoSemanal {
  professorId: string;
  professorNome: string;
  turmaId: string;
  turmaNome: string;
  disciplinaId: string;
  disciplinaNome: string;
  planejado: number;
  alocado: number;
  excesso: number;
  alocacoesExcedentes: Alocacao[];
}

export interface RelatorioIntegridade {
  valido: boolean;
  professoresComExcesso: ExcessoSemanal[];
  totalAulasRemovidas: number;
  alocacoesCorrigidas: Alocacao[];
  mensagens: string[];
  feedbackParaGerador: {
    professoresId: string[];
    disciplinasId: string[];
    turmasId: string[];
    motivo: string;
    sugestao: string;
  };
}

export interface ResultadoValidacao {
  integridadeOk: boolean;
  relatorio: RelatorioIntegridade;
}

/**
 * Verifica a integridade da carga horária de todos os professores
 * Compara o planejado vs alocado por (Professor + Turma + Disciplina)
 */
export function verificarIntegridadeDocente(
  alocacoes: Alocacao[],
  professores: Professor[],
  turmas: Turma[],
  disciplinas: Disciplina[]
): RelatorioIntegridade {
  const mensagens: string[] = [];
  const professoresComExcesso: ExcessoSemanal[] = [];
  const turmaMap = new Map(turmas.map(t => [t.id, t]));
  const discMap = new Map(disciplinas.map(d => [d.id, d]));

  mensagens.push("🔍 VERIFICANDO INTEGRIDADE DOCENTE (NOVA VERSÃO)");
  mensagens.push("=".repeat(60));

  for (const prof of professores) {
    const planejamento = prof.planejamento || [];

    for (const item of planejamento) {
      const planejado = Number(item.aulasPorSemana !== undefined ? item.aulasPorSemana : (item.quantidadeAulas || 0));
      if (planejado <= 0) continue;

      const turma = turmaMap.get(item.turmaId);
      const disciplina = discMap.get(item.disciplinaId);
      if (!turma || !disciplina) continue;

      // Contar alocações reais desta combinação exata de Professor + Turma + Disciplina
      const alocacoesReais = alocacoes.filter(a =>
        a.professorId === prof.id &&
        a.turmaId === item.turmaId &&
        a.disciplinaId === item.disciplinaId
      );

      const alocado = alocacoesReais.length;
      if (alocado > planejado) {
        const excesso = alocado - planejado;

        // Identificar quais alocações remover (priorizar não travadas)
        const alocacoesExcedentes = alocacoesReais
          .filter(a => !a.isLocked)
          .sort((a, b) => {
            // Priorizar remoção das últimas alocações do final da semana
            if (a.diaSemana !== b.diaSemana) {
              const ordemDias = ["segunda", "terca", "quarta", "quinta", "sexta"];
              return ordemDias.indexOf(b.diaSemana) - ordemDias.indexOf(a.diaSemana);
            }
            return b.horario - a.horario;
          })
          .slice(0, excesso);

        professoresComExcesso.push({
          professorId: prof.id,
          professorNome: prof.nomeCompleto,
          turmaId: item.turmaId,
          turmaNome: turma.nome,
          disciplinaId: item.disciplinaId,
          disciplinaNome: disciplina.nome,
          planejado,
          alocado,
          excesso,
          alocacoesExcedentes
        });

        mensagens.push(`⚠️ EXCESSO DETECTADO: ${prof.nomeCompleto} - ${disciplina.nome} na Turma ${turma.nome}`);
        mensagens.push(`   Planejado: ${planejado} aulas | Alocado: ${alocado} aulas | Excesso: ${excesso} aulas`);
      }
    }
  }

  const totalAulasRemovidas = professoresComExcesso.reduce(
    (sum, p) => sum + p.excesso, 0
  );

  // 2. Remover as alocações excedentes
  let alocacoesCorrigidas = [...alocacoes];
  const idsParaRemover = new Set<string>();
  
  for (const excesso of professoresComExcesso) {
    for (const aloc of excesso.alocacoesExcedentes) {
      idsParaRemover.add(aloc.id);
    }
  }

  alocacoesCorrigidas = alocacoesCorrigidas.filter(a => !idsParaRemover.has(a.id));

  // 3. Gerar feedback para o motor de geração
  const professoresId = [...new Set(professoresComExcesso.map(p => p.professorId))];
  const disciplinasId = [...new Set(professoresComExcesso.map(p => p.disciplinaId))];
  const turmasId = [...new Set(professoresComExcesso.map(p => p.turmaId))];

  let feedbackMotivo = "";
  let feedbackSugestao = "";

  if (professoresComExcesso.length > 0) {
    feedbackMotivo = `Foram detectados ${professoresComExcesso.length} caso(s) de excesso de carga horária. O motor de integridade removeu ${totalAulasRemovidas} aula(s) excedentes.`;
    feedbackSugestao = `Para evitar este erro, o motor de geração deve respeitar rigorosamente os limites de carga por (Professor + Turma + Disciplina). Recomenda-se verificar: 
    1. A carga horária máxima cadastrada para cada professor em cada disciplina/turma.
    2. A soma total das aulas planejadas não deve exceder a disponibilidade semanal do professor.
    3. Utilizar o validador central 'validarAlocacao' antes de qualquer inserção.`;
  }

  mensagens.push("=".repeat(60));
  mensagens.push(`📊 RESUMO DA VERIFICAÇÃO:`);
  mensagens.push(`  Total de excessos detectados: ${professoresComExcesso.length}`);
  mensagens.push(`  Total de aulas removidas: ${totalAulasRemovidas}`);
  mensagens.push(`  Status: ${totalAulasRemovidas > 0 ? '⚠️ CORREÇÃO APLICADA' : '✅ INTEGRIDADE OK'}`);
  mensagens.push("=".repeat(60));

  return {
    valido: professoresComExcesso.length === 0,
    professoresComExcesso,
    totalAulasRemovidas,
    alocacoesCorrigidas,
    mensagens,
    feedbackParaGerador: {
      professoresId,
      disciplinasId,
      turmasId,
      motivo: feedbackMotivo,
      sugestao: feedbackSugestao
    }
  };
}

/**
 * Valida a integridade e retorna resultado estruturado
 */
export function validarIntegridadeGrade(
  alocacoes: Alocacao[],
  professores: Professor[],
  turmas: Turma[],
  disciplinas: Disciplina[]
): ResultadoValidacao {
  const relatorio = verificarIntegridadeDocente(alocacoes, professores, turmas, disciplinas);
  
  return {
    integridadeOk: relatorio.valido,
    relatorio
  };
}

/**
 * Gera um relatório formatado em texto para exibição
 */
export function formatarRelatorioIntegridade(relatorio: RelatorioIntegridade): string {
  let texto = "=".repeat(70) + "\n";
  texto += "  RELATÓRIO DE INTEGRIDADE DOCENTE - CONTROLE DE CARGA HORÁRIA\n";
  texto += "=".repeat(70) + "\n\n";

  if (relatorio.valido) {
    texto += "✅ INTEGRIDADE CONFIRMADA: Nenhum professor com excesso de carga.\n";
    texto += `📊 Total de professores analisados: ${relatorio.professoresComExcesso.length}\n`;
    texto += `📚 Total de aulas na grade: ${relatorio.alocacoesCorrigidas.length}\n`;
    return texto;
  }

  texto += "⚠️ EXCESSOS DE CARGA HORÁRIA DETECTADOS E CORRIGIDOS\n\n";

  for (const excesso of relatorio.professoresComExcesso) {
    texto += `👤 Professor: ${excesso.professorNome}\n`;
    texto += `   📘 Disciplina: ${excesso.disciplinaNome}\n`;
    texto += `   🏫 Turma: ${excesso.turmaNome}\n`;
    texto += `   📊 Planejado: ${excesso.planejado} aulas | Alocado: ${excesso.alocado} aulas\n`;
    texto += `   ❌ Excesso: ${excesso.excesso} aula(s) removida(s)\n`;
    texto += `   🗑️ Aulas removidas: ${excesso.alocacoesExcedentes.map(a => 
      `${a.diaSemana.toUpperCase()} ${a.horario}º`
    ).join(", ")}\n\n`;
  }

  texto += "-".repeat(70) + "\n";
  texto += `📊 Total de excessos corrigidos: ${relatorio.professoresComExcesso.length}\n`;
  texto += `🗑️ Total de aulas removidas: ${relatorio.totalAulasRemovidas}\n`;
  texto += `✅ Grade corrigida: ${relatorio.alocacoesCorrigidas.length} aulas\n\n`;

  texto += "💡 FEEDBACK PARA O MOTOR DE GERAÇÃO:\n";
  texto += `   ${relatorio.feedbackParaGerador.motivo}\n`;
  texto += `   ${relatorio.feedbackParaGerador.sugestao}\n`;

  return texto;
}

/**
 * Função auxiliar que integra o validador no pipeline de geração
 * Retorna a grade corrigida e um booleano indicando se houve correção
 */
export function aplicarCorrecaoIntegridade(
  alocacoes: Alocacao[],
  professores: Professor[],
  turmas: Turma[],
  disciplinas: Disciplina[]
): { alocacoesCorrigidas: Alocacao[]; houveCorrecao: boolean; relatorio: RelatorioIntegridade } {
  const relatorio = verificarIntegridadeDocente(alocacoes, professores, turmas, disciplinas);
  
  return {
    alocacoesCorrigidas: relatorio.alocacoesCorrigidas,
    houveCorrecao: relatorio.totalAulasRemovidas > 0,
    relatorio
  };
}
