/**
 * cascade-move-engine.ts
 * ──────────────────────────────────────────────────────────────
 * Motor de Movimentos em Cascata (Estratégia de Xadrez)
 * 
 * Função: Encontrar uma cadeia de movimentos que permita
 * alocar uma aula sem violar restrições, movendo outras
 * aulas como num jogo de xadrez.
 */

import type {
  Alocacao,
  Professor,
  Turma,
  Disciplina,
  MatrizCurricular,
  ConfiguracaoHorarios
} from "@/types";

import { verificarSlotViavelComMotivo, isProfAvailableAt } from "./schedule-utils";
import { makeRegras } from "./allocation-engine";

export interface MovimentoCascata {
  id: string;
  tipo: "alocar" | "remover" | "mover";
  alocacaoId?: string;
  professorId: string;
  professorNome: string;
  turmaId: string;
  turmaNome: string;
  disciplinaId: string;
  disciplinaNome: string;
  deDia?: string;
  deHorario?: number;
  paraDia: string;
  paraHorario: number;
  status: "pendente" | "executado" | "falha";
  motivo?: string;
  impacto: "direto" | "cascata" | "swap";
  nivel: number;
}

export interface SolucaoCascata {
  id: string;
  sucesso: boolean;
  mensagem: string;
  alvoOriginal: {
    professorId: string;
    professorNome: string;
    turmaId: string;
    turmaNome: string;
    disciplinaId: string;
    disciplinaNome: string;
    diaDesejado: string;
    horarioDesejado: number;
  };
  movimentos: MovimentoCascata[];
  alocacoesFinais: Alocacao[];
  scoreGanho: number;
  profundidade: number;
  tempoExecucao: number;
  analise: {
    conflitosResolvidos: string[];
    professoresAfetados: string[];
    aulasRealocadas: number;
    impactoIQG: number;
  };
}

export class CascadeMoveEngine {
  private alocacoes: Alocacao[];
  private professores: Professor[];
  private turmas: Turma[];
  private disciplinas: Disciplina[];
  private matriz: MatrizCurricular[];
  private config: ConfiguracaoHorarios;

  constructor(
    alocacoes: Alocacao[],
    professores: Professor[],
    turmas: Turma[],
    disciplinas: Disciplina[],
    matriz: MatrizCurricular[],
    config: ConfiguracaoHorarios
  ) {
    this.alocacoes = [...alocacoes];
    this.professores = professores;
    this.turmas = turmas;
    this.disciplinas = disciplinas;
    this.matriz = matriz;
    this.config = config;
  }

  public encontrarSolucaoCascata(
    profId: string,
    turmaId: string,
    discId: string,
    dia: string,
    h: number
  ): { viavel: boolean; melhorSolucao: SolucaoCascata | null } {
    const solucoes = this.encontrarSolucoes(profId, turmaId, discId);
    const ex = solucoes.find(s => s.alvoOriginal.diaDesejado === dia && s.alvoOriginal.horarioDesejado === h) || solucoes[0];
    if (ex) {
      return { viavel: true, melhorSolucao: ex };
    }
    return { viavel: false, melhorSolucao: null };
  }

  public encontrarSolucoes(
    professorId: string,
    turmaId: string,
    disciplinaId: string
  ): SolucaoCascata[] {
    const inicio = performance.now();
    const prof = this.professores.find(p => p.id === professorId);
    const turma = this.turmas.find(t => t.id === turmaId);
    const disc = this.disciplinas.find(d => d.id === disciplinaId);

    if (!prof || !turma || !disc) return [];

    const dias = ["segunda", "terca", "quarta", "quinta", "sexta"];
    const solucoes: SolucaoCascata[] = [];
    const regras = makeRegras();

    for (const dia of dias) {
      for (let h = 1; h <= 5; h++) {

        const alocConflitoTurma = this.alocacoes.find(
          a => a.turmaId === turmaId && a.diaSemana === dia && a.horario === h
        );

        if (alocConflitoTurma) {
          const profConflito = this.professores.find(p => p.id === alocConflitoTurma.professorId);
          const discConflito = this.disciplinas.find(d => d.id === alocConflitoTurma.disciplinaId);

          if (!profConflito || !discConflito) continue;

          for (const diaDestino of dias) {
            for (let hDestino = 1; hDestino <= 5; hDestino++) {
              if (diaDestino === dia && hDestino === h) continue;

              const v = verificarSlotViavelComMotivo(
                this.alocacoes.filter(a => a.id !== alocConflitoTurma.id),
                this.professores,
                this.disciplinas,
                this.turmas,
                this.matriz,
                this.config,
                profConflito.id,
                turma.id,
                discConflito.id,
                diaDestino,
                hDestino,
                regras
              );

              if (v.viavel) {
                const mov1: MovimentoCascata = {
                  id: `mov-1-${Date.now()}`,
                  tipo: "mover",
                  alocacaoId: alocConflitoTurma.id,
                  professorId: profConflito.id,
                  professorNome: profConflito.nomeCompleto,
                  turmaId: turma.id,
                  turmaNome: turma.nome,
                  disciplinaId: discConflito.id,
                  disciplinaNome: discConflito.nome,
                  deDia: dia,
                  deHorario: h,
                  paraDia: diaDestino,
                  paraHorario: hDestino,
                  status: "pendente",
                  impacto: "cascata",
                  nivel: 1
                };

                const mov2: MovimentoCascata = {
                  id: `mov-2-${Date.now()}`,
                  tipo: "alocar",
                  professorId: prof.id,
                  professorNome: prof.nomeCompleto,
                  turmaId: turma.id,
                  turmaNome: turma.nome,
                  disciplinaId: disc.id,
                  disciplinaNome: disc.nome,
                  paraDia: dia,
                  paraHorario: h,
                  status: "pendente",
                  impacto: "direto",
                  nivel: 0
                };

                const alocFinais = this.alocacoes.map(a => {
                  if (a.id === alocConflitoTurma.id) {
                    return { ...a, diaSemana: diaDestino, horario: hDestino };
                  }
                  return a;
                });

                alocFinais.push({
                  id: `aloc-casc-${Date.now()}`,
                  turmaId: turma.id,
                  disciplinaId: disc.id,
                  professorId: prof.id,
                  diaSemana: dia,
                  horario: h
                });

                solucoes.push({
                  id: `sol-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
                  sucesso: true,
                  mensagem: `Libera o horário em ${dia.toUpperCase()} (${h}º slot) movendo ${discConflito.nome} de ${profConflito.nomeCompleto} para ${diaDestino.toUpperCase()} (${hDestino}º slot).`,
                  alvoOriginal: {
                    professorId: prof.id,
                    professorNome: prof.nomeCompleto,
                    turmaId: turma.id,
                    turmaNome: turma.nome,
                    disciplinaId: disc.id,
                    disciplinaNome: disc.nome,
                    diaDesejado: dia,
                    horarioDesejado: h
                  },
                  movimentos: [mov1, mov2],
                  alocacoesFinais: alocFinais,
                  scoreGanho: 150,
                  profundidade: 2,
                  tempoExecucao: Math.round(performance.now() - inicio),
                  analise: {
                    conflitosResolvidos: [`Liberado slot ${h}º em ${dia}`],
                    professoresAfetados: [prof.nomeCompleto, profConflito.nomeCompleto],
                    aulasRealocadas: 1,
                    impactoIQG: 15
                  }
                });

                if (solucoes.length >= 3) break;
              }
            }
            if (solucoes.length >= 3) break;
          }
        }
      }
    }

    return solucoes;
  }

  public executarSolucao(solucao: SolucaoCascata): { sucesso: boolean; alocacoes: Alocacao[] } {
    if (!solucao.sucesso || !solucao.alocacoesFinais) {
      return { sucesso: false, alocacoes: this.alocacoes };
    }
    return { sucesso: true, alocacoes: solucao.alocacoesFinais };
  }
}
