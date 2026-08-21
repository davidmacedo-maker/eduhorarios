import type { Alocacao, Turma, Professor, Disciplina, MatrizCurricular } from "@/types";

export interface AuditoriaDisciplina {
  professorId: string;
  professorNome: string;
  turmaId: string;
  turmaNome: string;
  disciplinaId: string;
  disciplinaNome: string;
  turno: string;
  planejado: number;      // Do cadastro do professor
  alocado: number;        // Do motor
  faltam: number;         // planejado - alocado
  excesso: number;        // alocado - planejado (se positivo)
  status: "completa" | "incompleta" | "excesso";
  alerta: string | null;
}

export interface RelatorioAuditoria {
  professores: AuditoriaDisciplina[];
  resumo: {
    totalPlanejado: number;
    totalAlocado: number;
    totalExcesso: number;
    totalFaltante: number;
    professoresComExcesso: number;
    professoresComFalta: number;
    turmasComFalsaOcupacao: { turmaId: string; turmaNome: string; dia: string; horario: number }[];
  };
  logs: string[];
}

/**
 * MOTOR DE AUDITORIA - Remove Falsos Positivos
 * Compara o cadastro do professor com as alocações do motor
 * e identifica inconsistências.
 */
export function executarAuditoria(
  turmas: Turma[],
  disciplinas: Disciplina[],
  professores: Professor[],
  matriz: MatrizCurricular[],
  alocacoes: Alocacao[]
): RelatorioAuditoria {
  const logs: string[] = [];
  const resultados: AuditoriaDisciplina[] = [];
  let totalPlanejado = 0;
  let totalAlocado = 0;
  let totalExcesso = 0;
  let totalFaltante = 0;
  let professoresComExcesso = 0;
  let professoresComFalta = 0;

  logs.push("🔍 INICIANDO AUDITORIA DE CONFORMIDADE");
  logs.push("=".repeat(60));

  const turmaMap = new Map(turmas.map(t => [t.id, t]));
  const discMap = new Map(disciplinas.map(d => [d.id, d]));

  // 1. Analisar cada professor
  for (const prof of professores) {
    const items = Array.isArray(prof.planejamento) ? prof.planejamento : [];
    
    for (const item of items) {
      // ✅ CARGA DO CADASTRO (FONTE DA VERDADE)
      const planejado = Number(item.aulasPorSemana !== undefined ? item.aulasPorSemana : item.quantidadeAulas) || 0;
      if (planejado <= 0) continue;

      const turma = turmaMap.get(item.turmaId);
      const disciplina = discMap.get(item.disciplinaId);
      if (!turma || !disciplina) continue;

      // ✅ CONTAR O QUE FOI ALOCADO
      const alocado = alocacoes.filter(a =>
        a.professorId === prof.id &&
        a.turmaId === item.turmaId &&
        a.disciplinaId === item.disciplinaId
      ).length;

      // ✅ CALCULAR DIFERENÇAS
      const faltam = Math.max(0, planejado - alocado);
      const excesso = Math.max(0, alocado - planejado);

      let status: "completa" | "incompleta" | "excesso" = "completa";
      let alerta: string | null = null;

      if (excesso > 0) {
        status = "excesso";
        alerta = `⚠️ EXCESSO: ${alocado} aulas alocadas, mas o planejamento é de ${planejado} aulas. Remover ${excesso} aula(s).`;
        professoresComExcesso++;
        totalExcesso += excesso;
      } else if (faltam > 0) {
        status = "incompleta";
        alerta = `⚠️ FALTAM: ${faltam} aula(s) para completar o planejamento de ${planejado} aulas.`;
        professoresComFalta++;
        totalFaltante += faltam;
      } else {
        status = "completa";
        alerta = null;
      }

      totalPlanejado += planejado;
      totalAlocado += alocado;

      resultados.push({
        professorId: prof.id,
        professorNome: prof.nomeCompleto,
        turmaId: turma.id,
        turmaNome: turma.nome,
        disciplinaId: disciplina.id,
        disciplinaNome: disciplina.nome,
        turno: turma.turno || "manha",
        planejado,
        alocado,
        faltam,
        excesso,
        status,
        alerta
      });

      if (alerta) {
        logs.push(`  ${alerta} (${prof.nomeCompleto} - ${disciplina.nome} - ${turma.nome})`);
      }
    }
  }

  // 2. Detectar Falsa Ocupação (Turmas com "PROIBIDO" indevido)
  const falsaOcupacao: { turmaId: string; turmaNome: string; dia: string; horario: number }[] = [];

  for (const turma of turmas) {
    const dias = ["segunda", "terca", "quarta", "quinta", "sexta"];
    for (const dia of dias) {
      // Verificar se há slots que o sistema considera ocupados mas estão vazios
      const alocacoesDia = alocacoes.filter(a => a.turmaId === turma.id && a.diaSemana === dia);
      const horariosOcupados = new Set(alocacoesDia.map(a => a.horario));
      
      // Verificar se há "PROIBIDO" em horários que deveriam estar livres
      // (Isso é detectado pelo assistente, não pelo motor)
    }
  }

  // 3. Gerar relatório
  logs.push("=".repeat(60));
  logs.push(`📊 RESUMO DA AUDITORIA:`);
  logs.push(`  Total planejado: ${totalPlanejado} aulas`);
  logs.push(`  Total alocado: ${totalAlocado} aulas`);
  logs.push(`  Total em excesso: ${totalExcesso} aulas`);
  logs.push(`  Total faltante: ${totalFaltante} aulas`);
  logs.push(`  Professores com excesso: ${professoresComExcesso}`);
  logs.push(`  Professores com falta: ${professoresComFalta}`);
  logs.push("=".repeat(60));

  return {
    professores: resultados,
    resumo: {
      totalPlanejado,
      totalAlocado,
      totalExcesso,
      totalFaltante,
      professoresComExcesso,
      professoresComFalta,
      turmasComFalsaOcupacao: falsaOcupacao
    },
    logs
  };
}

/**
 * CORRIGE EXCESSOS - Remove aulas que excedem o planejamento
 */
export function corrigirExcessos(
  alocacoes: Alocacao[],
  professores: Professor[],
  matriz: MatrizCurricular[]
): { alocacoes: Alocacao[]; removidas: number; logs: string[] } {
  const logs: string[] = [];
  let alocacoesCorrigidas = [...alocacoes];
  let removidas = 0;

  logs.push("🛠️ CORRIGINDO EXCESSOS DE ALOCAÇÃO");
  logs.push("=".repeat(60));

  for (const prof of professores) {
    const items = Array.isArray(prof.planejamento) ? prof.planejamento : [];
    
    for (const item of items) {
      const planejado = Number(item.aulasPorSemana !== undefined ? item.aulasPorSemana : item.quantidadeAulas) || 0;
      if (planejado <= 0) continue;

      // Encontrar todas as alocações desta disciplina
      const alocacoesDisciplina = alocacoesCorrigidas.filter(a =>
        a.professorId === prof.id &&
        a.turmaId === item.turmaId &&
        a.disciplinaId === item.disciplinaId
      );

      // Se houver excesso, remover as últimas alocações (não travadas)
      const excesso = alocacoesDisciplina.length - planejado;
      if (excesso > 0) {
        // Ordenar por horário (do maior para o menor) e remover as últimas
        const paraRemover = alocacoesDisciplina
          .filter(a => !a.isLocked)
          .sort((a, b) => b.horario - a.horario)
          .slice(0, excesso);

        for (const aloc of paraRemover) {
          alocacoesCorrigidas = alocacoesCorrigidas.filter(a => a.id !== aloc.id);
          removidas++;
          logs.push(`  ✅ Removida aula de ${prof.nomeCompleto} - ${item.disciplinaId} - ${aloc.diaSemana} ${aloc.horario}º`);
        }
      }
    }
  }

  logs.push("=".repeat(60));
  logs.push(`📊 Total removido: ${removidas} aulas em excesso`);
  logs.push("=".repeat(60));

  return { alocacoes: alocacoesCorrigidas, removidas, logs };
}

/**
 * VALIDA SE O MOTOR ESTÁ RESPEITANDO O CADASTRO
 * Antes de cada alocação, verifica se o limite foi atingido
 */
export function validarAlocacao(
  professor: Professor,
  turmaId: string,
  disciplinaId: string,
  alocacoesExistentes: Alocacao[]
): { permitido: boolean; motivo?: string; limite: number; alocado: number } {
  // Buscar no planejamento do professor
  const item = professor.planejamento?.find(p =>
    p.turmaId === turmaId && p.disciplinaId === disciplinaId
  );

  if (!item) {
    return {
      permitido: false,
      motivo: "Disciplina não está no planejamento do professor",
      limite: 0,
      alocado: 0
    };
  }

  const limite = Number(item.aulasPorSemana !== undefined ? item.aulasPorSemana : item.quantidadeAulas) || 0;
  if (limite <= 0) {
    return {
      permitido: false,
      motivo: "Limite semanal é zero ou inválido",
      limite: 0,
      alocado: 0
    };
  }

  const alocado = alocacoesExistentes.filter(a =>
    a.professorId === professor.id &&
    a.turmaId === turmaId &&
    a.disciplinaId === disciplinaId
  ).length;

  if (alocado >= limite) {
    return {
      permitido: false,
      motivo: `Limite semanal de ${limite} aula(s) já atingido (${alocado}/${limite})`,
      limite,
      alocado
    };
  }

  return {
    permitido: true,
    limite,
    alocado
  };
}
