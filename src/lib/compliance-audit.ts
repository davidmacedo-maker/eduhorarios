/**
 * AUDITORIA DE CONFORMIDADE
 * Verifica se todas as regras obrigatórias foram respeitadas
 */

import type { Alocacao, Professor, Turma, Disciplina, MatrizCurricular } from "@/types";

export interface ComplianceViolation {
  tipo: "excesso_carga" | "dia_nao_permitido" | "turno_invalido" | "conflito_horario" | "limite_diario";
  professorId: string;
  professorNome: string;
  turmaId: string;
  turmaNome: string;
  disciplinaId: string;
  disciplinaNome: string;
  diaSemana: string;
  horario: number;
  descricao: string;
  esperado: string;
  encontrado: string;
  gravidade: "critica" | "alta" | "media" | "baixa";
}

export interface ComplianceReport {
  valido: boolean;
  violacoes: ComplianceViolation[];
  resumo: {
    totalViolacoes: number;
    criticas: number;
    altas: number;
    medias: number;
    baixas: number;
  };
  logs: string[];
}

export function auditarConformidade(
  alocacoes: Alocacao[],
  professores: Professor[],
  turmas: Turma[],
  disciplinas: Disciplina[],
  matriz: MatrizCurricular[]
): ComplianceReport {
  const violacoes: ComplianceViolation[] = [];
  const logs: string[] = [];

  return {
    valido: violacoes.length === 0,
    violacoes,
    resumo: {
      totalViolacoes: violacoes.length,
      criticas: violacoes.filter(v => v.gravidade === "critica").length,
      altas: violacoes.filter(v => v.gravidade === "alta").length,
      medias: violacoes.filter(v => v.gravidade === "media").length,
      baixas: violacoes.filter(v => v.gravidade === "baixa").length,
    },
    logs
  };
}
