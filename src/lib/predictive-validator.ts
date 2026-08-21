/**
 * predictive-validator.ts
 * ──────────────────────────────────────────────────────────────
 * Motor Preditivo de Alocação
 * 
 * Função: Analisar antecipadamente todas as restrições e
 * prever o resultado da alocação ANTES de executá-la.
 * 
 * Objetivo: Prevenir 100% dos casos de excesso de carga,
 * conflitos de horário e violações de regras.
 */

import type {
  Alocacao,
  Professor,
  Turma,
  Disciplina,
  MatrizCurricular,
  ConfiguracaoHorarios,
  Disponibilidade
} from "@/types";
import { detectConflicts } from "./schedule-utils";
import { validateSchedule } from "./allocation-engine";
import { repairProfessorSchedule } from "./allocation-core";

// ──────────────────────────────────────────────────────────────
// 1. PREDIÇÃO DE CARGA HORÁRIA
// ──────────────────────────────────────────────────────────────

export interface PredicaoCarga {
  professorId: string;
  professorNome: string;
  turmaId: string;
  turmaNome: string;
  disciplinaId: string;
  disciplinaNome: string;
  
  // Dados atuais
  planejado: number;
  alocadoAtual: number;
  faltam: number;
  
  // Predição
  predicaoAlocacao: "OK" | "EXCESSO" | "CONFLITO" | "INSUFICIENTE";
  risco: "baixo" | "medio" | "alto" | "critico";
  probabilidadeExcesso: number; // 0-100
  probabilidadeConflito: number; // 0-100
  
  // Análise detalhada
  analise: string[];
  recomendacao: string;
  slotsDisponiveis: number;
  slotsNecessarios: number;
  deficitSlots: number;
}

export interface RelatorioPreditivo {
  timestamp: string;
  totalAnalisados: number;
  problemasEncontrados: number;
  criticos: number;
  altos: number;
  medios: number;
  baixos: number;
  predicoes: PredicaoCarga[];
  resumoGeral: string;
  recomendacoesGerais: string[];
}

// ──────────────────────────────────────────────────────────────
// 2. PREDIÇÃO DE CONFLITOS DE HORÁRIO
// ──────────────────────────────────────────────────────────────

export interface PredicaoConflitoHorario {
  professorId: string;
  professorNome: string;
  diaSemana: string;
  horario: number;
  turno: string;
  
  // Conflitos previstos
  tipoConflito: "disponibilidade" | "choque_professor" | "choque_turma" | "limite_diario" | "limite_consecutivo";
  probabilidade: number; // 0-100
  severidade: "baixa" | "media" | "alta" | "critica";
  
  // Análise
  causa: string;
  resolucaoSugerida: string;
  alternativas: {
    dia: string;
    horario: number;
    probabilidadeSucesso: number;
  }[];
}

export interface PredicaoConflitos {
  professorId: string;
  professorNome: string;
  conflitosPrevistos: PredicaoConflitoHorario[];
  totalConflitos: number;
  conflitosCriticos: number;
  resolvivelAutomaticamente: boolean;
}

// ──────────────────────────────────────────────────────────────
// 3. PREDIÇÃO DE DISPONIBILIDADE
// ──────────────────────────────────────────────────────────────

export interface PredicaoDisponibilidade {
  professorId: string;
  professorNome: string;
  turno: string;
  
  // Métricas
  totalSlotsDisponiveis: number;
  totalSlotsOcupados: number;
  totalSlotsLivres: number;
  utilizacaoPercentual: number;
  
  // Previsão de ocupação
  previsaoOcupacao: {
    dia: string;
    horariosOcupados: number[];
    horariosLivres: number[];
    ocupacaoPercentual: number;
  }[];
  
  // Análise
  temGargalo: boolean;
  gargaloDescricao: string;
  recomendacao: string;
}

// ──────────────────────────────────────────────────────────────
// 4. MOTOR PREDITIVO PRINCIPAL
// ──────────────────────────────────────────────────────────────

export class PredictiveValidator {
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
    this.alocacoes = alocacoes;
    this.professores = professores;
    this.turmas = turmas;
    this.disciplinas = disciplinas;
    this.matriz = matriz;
    this.config = config;
  }

  /**
   * PREDIÇÃO 1: Prever excesso de carga antes de alocar
   */
  public preverExcessoCarga(): RelatorioPreditivo {
    const predicoes: PredicaoCarga[] = [];

    for (const prof of this.professores) {
      const planejamento = prof.planejamento || [];
      
      for (const item of planejamento) {
        const planejado = Number(item.aulasPorSemana !== undefined ? item.aulasPorSemana : item.quantidadeAulas) || 0;
        if (planejado <= 0) continue;

        const turma = this.turmas.find(t => t.id === item.turmaId);
        const disciplina = this.disciplinas.find(d => d.id === item.disciplinaId);
        if (!turma || !disciplina) continue;

        // Contar alocações atuais
        const alocadoAtual = this.alocacoes.filter(a =>
          a.professorId === prof.id &&
          a.turmaId === item.turmaId &&
          a.disciplinaId === item.disciplinaId
        ).length;

        const faltam = planejado - alocadoAtual;

        // ✅ PREDIÇÃO: Calcular probabilidade de excesso
        const slotsDisponiveis = this.contarSlotsDisponiveis(prof, turma, disciplina);
        const slotsNecessarios = faltam > 0 ? faltam : 0;
        const deficitSlots = slotsNecessarios - slotsDisponiveis;

        // Análise detalhada
        const analise: string[] = [];
        let probabilidadeExcesso = 0;
        let predicaoAlocacao: "OK" | "EXCESSO" | "CONFLITO" | "INSUFICIENTE" = "OK";
        let risco: "baixo" | "medio" | "alto" | "critico" = "baixo";

        // Se já há excesso atual
        if (alocadoAtual > planejado) {
          predicaoAlocacao = "EXCESSO";
          probabilidadeExcesso = 100;
          risco = "critico";
          analise.push(`⚠️ EXCESSO ATUAL: ${alocadoAtual} > ${planejado} (${alocadoAtual - planejado} aulas extras)`);
          analise.push(`   → É necessário remover ${alocadoAtual - planejado} aula(s) IMEDIATAMENTE`);
        }
        // Se pode haver excesso
        else if (slotsDisponiveis > planejado) {
          const probabilidade = ((slotsDisponiveis - planejado) / planejado) * 100;
          probabilidadeExcesso = Math.min(probabilidade, 100);
          
          if (probabilidadeExcesso > 50) {
            predicaoAlocacao = "EXCESSO";
            risco = "alto";
            analise.push(`🔴 ALTO RISCO DE EXCESSO: ${slotsDisponiveis} slots disponíveis para ${planejado} aulas`);
            analise.push(`   → O motor pode alocar até ${slotsDisponiveis - planejado} aulas extras`);
          } else if (probabilidadeExcesso > 20) {
            risco = "medio";
            analise.push(`   → Risco médio de excesso com slots abundantes`);
          } else {
            risco = "baixo";
            analise.push(`   → Baixo risco de excesso`);
          }
        }
        // Se faltam slots
        else if (deficitSlots > 0) {
          predicaoAlocacao = "INSUFICIENTE";
          risco = "critico";
          probabilidadeExcesso = 0;
          analise.push(`❌ SLOTS INSUFICIENTES: Faltam ${deficitSlots} slots para completar ${planejado} aulas`);
          analise.push(`   → Professor tem apenas ${slotsDisponiveis} slots disponíveis`);
        }
        // OK
        else {
          analise.push(`✅ SLOTS SUFICIENTES: ${slotsDisponiveis} disponíveis para ${planejado} aulas`);
          // Verificar distribuição
          const distribuicao = this.preverDistribuicao(prof, turma, planejado);
          if (distribuicao.riscoDesbalanceamento > 0.5) {
            risco = "medio";
            analise.push(`⚠️ Risco de desbalanceamento: ${distribuicao.descricao}`);
          }
        }

        // Recomendação
        let recomendacao = "";
        if (predicaoAlocacao === "EXCESSO") {
          recomendacao = `🔧 Aplicar validador de integridade com limite de ${planejado} aulas para (${prof.nomeCompleto} + ${disciplina.nome} + ${turma.nome})`;
        } else if (predicaoAlocacao === "INSUFICIENTE") {
          recomendacao = `⚠️ Aumentar disponibilidade do professor ou reduzir carga planejada de ${planejado} para ${slotsDisponiveis} aulas`;
        } else {
          recomendacao = `✅ Manter alocação normal com monitoramento de ${slotsDisponiveis} slots disponíveis`;
        }

        predicoes.push({
          professorId: prof.id,
          professorNome: prof.nomeCompleto,
          turmaId: turma.id,
          turmaNome: turma.nome,
          disciplinaId: disciplina.id,
          disciplinaNome: disciplina.nome,
          planejado,
          alocadoAtual,
          faltam: faltam > 0 ? faltam : 0,
          predicaoAlocacao,
          risco,
          probabilidadeExcesso,
          probabilidadeConflito: this.preverProbabilidadeConflito(prof, turma, disciplina),
          analise,
          recomendacao,
          slotsDisponiveis,
          slotsNecessarios,
          deficitSlots: deficitSlots > 0 ? deficitSlots : 0
        });
      }
    }

    // Gerar relatório consolidado
    const problemas = predicoes.filter(p => p.risco === "critico" || p.risco === "alto");
    const criticos = predicoes.filter(p => p.risco === "critico");
    const altos = predicoes.filter(p => p.risco === "alto");
    const medios = predicoes.filter(p => p.risco === "medio");
    const baixos = predicoes.filter(p => p.risco === "baixo");

    const recomendacoesGerais: string[] = [];
    
    if (criticos.length > 0) {
      recomendacoesGerais.push(`🚨 ${criticos.length} situação(ões) CRÍTICAS detectadas - CORREÇÃO IMEDIATA necessária`);
      for (const c of criticos) {
        recomendacoesGerais.push(`   - ${c.professorNome}: ${c.disciplinaNome} (${c.turmaNome}) - ${c.recomendacao}`);
      }
    }

    if (altos.length > 0) {
      recomendacoesGerais.push(`⚠️ ${altos.length} situação(ões) de ALTO RISCO - Recomenda-se ajuste preventivo`);
      for (const a of altos) {
        recomendacoesGerais.push(`   - ${a.professorNome}: ${a.disciplinaNome} (${a.turmaNome}) - ${a.recomendacao}`);
      }
    }

    if (predicoes.every(p => p.risco === "baixo")) {
      recomendacoesGerais.push("✅ Todas as alocações previstas estão dentro dos parâmetros seguros");
    }

    return {
      timestamp: new Date().toISOString(),
      totalAnalisados: predicoes.length,
      problemasEncontrados: problemas.length,
      criticos: criticos.length,
      altos: altos.length,
      medios: medios.length,
      baixos: baixos.length,
      predicoes,
      resumoGeral: `${problemas.length} problemas encontrados em ${predicoes.length} análises`,
      recomendacoesGerais
    };
  }

  /**
   * PREDIÇÃO 2: Prever conflitos de horário
   */
  public preverConflitosHorario(professorId: string): PredicaoConflitos {
    const prof = this.professores.find(p => p.id === professorId);
    if (!prof) {
      return {
        professorId,
        professorNome: "Desconhecido",
        conflitosPrevistos: [],
        totalConflitos: 0,
        conflitosCriticos: 0,
        resolvivelAutomaticamente: false
      };
    }

    const conflitos: PredicaoConflitoHorario[] = [];
    const diasSemana = ["segunda", "terca", "quarta", "quinta", "sexta"];

    for (const dia of diasSemana) {
      for (let h = 1; h <= 6; h++) {
        // Verificar disponibilidade
        const disponivel = this.isProfAvailable(prof, dia, h);
        
        // Verificar se já está ocupado
        const ocupado = this.alocacoes.some(a =>
          a.professorId === prof.id &&
          a.diaSemana === dia &&
          a.horario === h
        );

        if (!disponivel && ocupado) {
          // CONFLITO: Professor ocupado em horário indisponível
          conflitos.push({
            professorId: prof.id,
            professorNome: prof.nomeCompleto,
            diaSemana: dia,
            horario: h,
            turno: this.getTurnoProf(prof, dia, h),
            tipoConflito: "disponibilidade",
            probabilidade: 100,
            severidade: "critica",
            causa: `Professor alocado em ${dia} ${h}º horário, mas NÃO está disponível neste horário`,
            resolucaoSugerida: `Mover aula para horário disponível do professor`,
            alternativas: this.encontrarAlternativas(prof, dia, h)
          });
        }
        else if (!disponivel && !ocupado) {
          // PREDIÇÃO: Possível tentativa de alocar em horário indisponível
          const probabilidade = this.calcularProbabilidadeAlocacao(prof, dia, h);
          if (probabilidade > 30) {
            conflitos.push({
              professorId: prof.id,
              professorNome: prof.nomeCompleto,
              diaSemana: dia,
              horario: h,
              turno: this.getTurnoProf(prof, dia, h),
              tipoConflito: "disponibilidade",
              probabilidade,
              severidade: probabilidade > 70 ? "alta" : "media",
              causa: `Alta probabilidade (${probabilidade}%) de tentar alocar em horário indisponível`,
              resolucaoSugerida: `Bloquear alocação em ${dia} ${h}º horário no motor de geração`,
              alternativas: this.encontrarAlternativas(prof, dia, h)
            });
          }
        }
      }
    }

    const conflitosCriticos = conflitos.filter(c => c.severidade === "critica");
    const totalConflitos = conflitos.length;

    return {
      professorId: prof.id,
      professorNome: prof.nomeCompleto,
      conflitosPrevistos: conflitos,
      totalConflitos,
      conflitosCriticos: conflitosCriticos.length,
      resolvivelAutomaticamente: conflitosCriticos.length === 0
    };
  }

  /**
   * PREDIÇÃO 3: Prever a distribuição ideal
   */
  public preverDistribuicaoIdeal(): Record<string, any> {
    const resultado: Record<string, any> = {};
    const diasSemana = ["segunda", "terca", "quarta", "quinta", "sexta"];

    for (const prof of this.professores) {
      const planejamento = prof.planejamento || [];
      const distribuicao: Record<string, number> = {};

      for (const dia of diasSemana) {
        distribuicao[dia] = 0;
      }

      for (const item of planejamento) {
        const planejado = Number(item.aulasPorSemana || item.quantidadeAulas || 0);
        if (planejado <= 0) continue;

        // Calcular distribuição ideal (2+2+1 para 5 aulas)
        const distrib = this.calcularDistribuicaoIdeal(planejado);
        for (const [dia, qtd] of Object.entries(distrib)) {
          distribuicao[dia] = (distribuicao[dia] || 0) + (qtd as number);
        }
      }

      // Verificar se a distribuição é viável
      let viavel = true;
      const problemas: string[] = [];

      for (const [dia, qtd] of Object.entries(distribuicao)) {
        const slotsDisponiveis = this.contarSlotsDisponiveisDia(prof, dia);
        if (qtd > slotsDisponiveis) {
          viavel = false;
          problemas.push(`${dia}: precisa ${qtd} aulas, mas tem ${slotsDisponiveis} slots`);
        }
      }

      resultado[prof.id] = {
        professor: prof.nomeCompleto,
        distribuicao,
        viavel,
        problemas,
        recomendacao: viavel ? 
          "✅ Distribuição viável" : 
          `❌ Ajustar distribuição: ${problemas.join("; ")}`
      };
    }

    return resultado;
  }

  // ──────────────────────────────────────────────────────────────
  // MÉTODOS AUXILIARES
  // ──────────────────────────────────────────────────────────────

  private contarSlotsDisponiveis(
    prof: Professor,
    turma: Turma,
    disciplina: Disciplina
  ): number {
    let count = 0;
    const diasSemana = ["segunda", "terca", "quarta", "quinta", "sexta"];
    const turno = turma.turno || "manha";
    const maxHorarios = this.getMaxHorarios(turno);

    for (const dia of diasSemana) {
      for (let h = 1; h <= maxHorarios; h++) {
        // Verificar disponibilidade do professor
        if (!this.isProfAvailable(prof, dia, h)) continue;
        
        // Verificar se a turma está livre
        const turmaOcupada = this.alocacoes.some(a =>
          a.turmaId === turma.id &&
          a.diaSemana === dia &&
          a.horario === h
        );
        if (turmaOcupada) continue;
        
        // Verificar se o professor está livre neste turno
        const profOcupado = this.alocacoes.some(a =>
          a.professorId === prof.id &&
          a.diaSemana === dia &&
          a.horario === h
        );
        if (profOcupado) continue;

        count++;
      }
    }

    return count;
  }

  private contarSlotsDisponiveisDia(prof: Professor, dia: string): number {
    let count = 0;
    const maxHorarios = 6;

    for (let h = 1; h <= maxHorarios; h++) {
      if (this.isProfAvailable(prof, dia, h)) {
        const ocupado = this.alocacoes.some(a =>
          a.professorId === prof.id &&
          a.diaSemana === dia &&
          a.horario === h
        );
        if (!ocupado) count++;
      }
    }

    return count;
  }

  private isProfAvailable(prof: Professor, dia: string, horario: number): boolean {
    if (!prof.disponibilidade) return false;
    const disponivel = prof.disponibilidade[dia];
    return Array.isArray(disponivel) && disponivel.includes(horario);
  }

  private getTurnoProf(prof: Professor, dia: string, horario: number): string {
    if (horario <= 6) return "manha";
    if (horario <= 11) return "tarde";
    return "noite";
  }

  private getMaxHorarios(turno: string): number {
    if (turno === "noite") return 4;
    if (turno === "tarde") return 5;
    return 6;
  }

  private preverProbabilidadeConflito(
    prof: Professor,
    turma: Turma,
    disciplina: Disciplina
  ): number {
    let fatores = 0;
    let totalFatores = 0;

    // Fator 1: Disponibilidade
    const slotsDisponiveis = this.contarSlotsDisponiveis(prof, turma, disciplina);
    const planejado = Number(prof.planejamento?.find(p => 
      p.turmaId === turma.id && p.disciplinaId === disciplina.id
    )?.aulasPorSemana || 0);
    
    if (planejado > 0) {
      const proporcao = slotsDisponiveis / planejado;
      if (proporcao < 1.5) fatores += 0.8;
      else if (proporcao < 2) fatores += 0.4;
      else fatores += 0.1;
      totalFatores++;
    }

    // Fator 2: Ocupação da turma
    const ocupacaoTurma = this.alocacoes.filter(a => a.turmaId === turma.id).length;
    const totalSlotsTurma = 5 * this.getMaxHorarios(turma.turno || "manha");
    const taxaOcupacao = ocupacaoTurma / totalSlotsTurma;
    if (taxaOcupacao > 0.8) fatores += 0.7;
    else if (taxaOcupacao > 0.6) fatores += 0.3;
    else fatores += 0.1;
    totalFatores++;

    // Fator 3: Histórico do professor
    const conflitosPassados = this.alocacoes.filter(a => 
      a.professorId === prof.id && a.isLocked === false
    ).length;
    if (conflitosPassados > 5) fatores += 0.5;
    totalFatores++;

    return totalFatores > 0 ? Math.min((fatores / totalFatores) * 100, 100) : 0;
  }

  private preverDistribuicao(
    prof: Professor,
    turma: Turma,
    planejado: number
  ): { riscoDesbalanceamento: number; descricao: string } {
    const diasSemana = ["segunda", "terca", "quarta", "quinta", "sexta"];
    const alocacoesPorDia: Record<string, number> = {};

    for (const dia of diasSemana) {
      alocacoesPorDia[dia] = this.alocacoes.filter(a =>
        a.professorId === prof.id &&
        a.turmaId === turma.id &&
        a.diaSemana === dia
      ).length;
    }

    const valores = Object.values(alocacoesPorDia);
    const max = Math.max(...valores);
    const min = Math.min(...valores);
    const media = valores.reduce((a, b) => a + b, 0) / valores.length;

    // Quanto maior a diferença entre max e min, maior o desbalanceamento
    const desbalanceamento = max - min;
    const risco = desbalanceamento > 2 ? 1 : desbalanceamento > 1 ? 0.5 : 0;

    let descricao = "";
    if (risco > 0.8) {
      descricao = `Distribuição muito desbalanceada (${max} aulas em um dia, ${min} em outro)`;
    } else if (risco > 0.4) {
      descricao = `Distribuição moderadamente desbalanceada`;
    } else {
      descricao = `Distribuição balanceada (média ${media.toFixed(1)} aulas/dia)`;
    }

    return { riscoDesbalanceamento: risco, descricao };
  }

  private calcularDistribuicaoIdeal(planejado: number): Record<string, number> {
    const dias = ["segunda", "terca", "quarta", "quinta", "sexta"];
    const distribuicao: Record<string, number> = {};

    for (const dia of dias) {
      distribuicao[dia] = 0;
    }

    if (planejado === 5) {
      // 2+2+1
      distribuicao.segunda = 2;
      distribuicao.terca = 2;
      distribuicao.quarta = 1;
    } else if (planejado === 4) {
      // 2+2
      distribuicao.segunda = 2;
      distribuicao.terca = 2;
    } else if (planejado === 3) {
      // 2+1
      distribuicao.segunda = 2;
      distribuicao.terca = 1;
    } else if (planejado === 2) {
      // 2
      distribuicao.segunda = 2;
    } else if (planejado === 1) {
      // 1
      distribuicao.segunda = 1;
    } else {
      // Distribuição uniforme
      const base = Math.floor(planejado / 5);
      const resto = planejado % 5;
      for (let i = 0; i < 5; i++) {
        distribuicao[dias[i]] = base + (i < resto ? 1 : 0);
      }
    }

    return distribuicao;
  }

  private encontrarAlternativas(
    prof: Professor,
    dia: string,
    horario: number
  ): { dia: string; horario: number; probabilidadeSucesso: number }[] {
    const alternativas: { dia: string; horario: number; probabilidadeSucesso: number }[] = [];
    const diasSemana = ["segunda", "terca", "quarta", "quinta", "sexta"];

    for (const d of diasSemana) {
      for (let h = 1; h <= 6; h++) {
        if (d === dia && h === horario) continue;
        
        if (this.isProfAvailable(prof, d, h)) {
          // Verificar se o slot está livre
          const ocupado = this.alocacoes.some(a =>
            a.professorId === prof.id &&
            a.diaSemana === d &&
            a.horario === h
          );
          
          if (!ocupado) {
            // Calcular probabilidade de sucesso baseado em conflitos futuros
            let prob = 80; // Base
            const conflitos = this.alocacoes.filter(a =>
              a.diaSemana === d &&
              a.horario === h
            ).length;
            
            if (conflitos > 0) prob -= conflitos * 10;
            
            alternativas.push({
              dia: d,
              horario: h,
              probabilidadeSucesso: Math.max(prob, 20)
            });
          }
        }
      }
    }

    return alternativas.sort((a, b) => b.probabilidadeSucesso - a.probabilidadeSucesso).slice(0, 5);
  }

  private calcularProbabilidadeAlocacao(prof: Professor, dia: string, horario: number): number {
    let prob = 0;
    
    // Se o professor tem poucos slots disponíveis, a probabilidade de tentar alocar aqui é maior
    const totalDisponivel = this.contarSlotsDisponiveisDia(prof, dia);
    if (totalDisponivel < 3) prob += 30;

    // Se há muitas aulas pendentes, a probabilidade aumenta
    const planejamento = prof.planejamento || [];
    let totalPendente = 0;
    for (const item of planejamento) {
      const planejado = Number(item.aulasPorSemana || item.quantidadeAulas || 0);
      const alocado = this.alocacoes.filter(a =>
        a.professorId === prof.id &&
        a.turmaId === item.turmaId &&
        a.disciplinaId === item.disciplinaId
      ).length;
      totalPendente += Math.max(0, planejado - alocado);
    }
    if (totalPendente > 3) prob += 20;

    // Se é um horário "popular" (meio da manhã), a probabilidade é maior
    if (horario >= 2 && horario <= 4) prob += 15;

    return Math.min(prob, 100);
  }
}

// ──────────────────────────────────────────────────────────────
// 5. FUNÇÃO DE ENTRADA RÁPIDA
// ──────────────────────────────────────────────────────────────

export function executarPredicao(
  alocacoes: Alocacao[],
  professores: Professor[],
  turmas: Turma[],
  disciplinas: Disciplina[],
  matriz: MatrizCurricular[],
  config: ConfiguracaoHorarios
): RelatorioPreditivo {
  const validator = new PredictiveValidator(
    alocacoes,
    professores,
    turmas,
    disciplinas,
    matriz,
    config
  );

  return validator.preverExcessoCarga();
}

export interface SimulationResult {
  profId: string;
  profNome: string;
  success: boolean;
  scoreBefore: number;
  scoreAfter: number;
  iqgDelta: number;
  conflictsBefore: number;
  conflictsAfter: number;
  conflictsDelta: number;
  gapsBefore: number;
  gapsAfter: number;
  gapsDelta: number;
  affectedCount: number;
  simulatedAlocacoes: Alocacao[];
  explanation: string;
}

/**
 * Runs a rapid non-destructive "what-if" simulation by altering a professor's availability and measuring quality metrics.
 */
export function runWhatIfSimulation(
  professorId: string,
  simulatedAvailability: Disponibilidade,
  currentAlocacoes: Alocacao[],
  turmas: Turma[],
  disciplinas: Disciplina[],
  professores: Professor[],
  matriz: MatrizCurricular[],
  config: ConfiguracaoHorarios
): SimulationResult {
  const prof = professores.find(p => p.id === professorId);
  if (!prof) {
    return {
      profId: professorId,
      profNome: "Desconhecido",
      success: false,
      scoreBefore: 0,
      scoreAfter: 0,
      iqgDelta: 0,
      conflictsBefore: 0,
      conflictsAfter: 0,
      conflictsDelta: 0,
      gapsBefore: 0,
      gapsAfter: 0,
      gapsDelta: 0,
      affectedCount: 0,
      simulatedAlocacoes: currentAlocacoes,
      explanation: "Professor não encontrado."
    };
  }

  // 1. Calculate base metrics
  const baseValidation = validateSchedule(currentAlocacoes, turmas, disciplinas, professores, matriz);
  const baseConflicts = detectConflicts(currentAlocacoes, professores, disciplinas, turmas, matriz);
  const baseGaps = baseValidation.resumo.buracosEvitaveis;
  const baseScore = baseValidation.resumo.iqg;

  // 2. Clone and modify teacher availability
  const simulatedProfs = professores.map(p => {
    if (p.id === professorId) {
      return {
        ...p,
        disponibilidade: simulatedAvailability
      };
    }
    return p;
  });

  // 3. Run localized repair using the new availability profile
  const repairResult = repairProfessorSchedule(
    professorId,
    currentAlocacoes,
    turmas,
    disciplinas,
    simulatedProfs,
    matriz,
    config
  );

  // 4. Calculate simulated metrics
  const simValidation = validateSchedule(repairResult.alocacoes, turmas, disciplinas, simulatedProfs, matriz);
  const simConflicts = detectConflicts(repairResult.alocacoes, simulatedProfs, disciplinas, turmas, matriz);
  const simGaps = simValidation.resumo.buracosEvitaveis;
  const simScore = simValidation.resumo.iqg;

  const iqgDelta = simScore - baseScore;
  const conflictsDelta = simConflicts.length - baseConflicts.length;
  const gapsDelta = simGaps - baseGaps;
  const affectedCount = repairResult.alteredCount;

  // 5. Build friendly literal explanation
  let explanation = "";
  if (iqgDelta > 0) {
    explanation += `🎉 Cenário Altamente Favorável! Modificar a disponibilidade de ${prof.nomeCompleto} prevê um ganho de +${iqgDelta.toFixed(1)} pontos no IQG. `;
  } else if (iqgDelta === 0 && conflictsDelta < 0) {
    explanation += `👍 Mudança Benéfica. Estabilizou o índice geral de qualidade e eliminou ${Math.abs(conflictsDelta)} conflito(s) existente(s). `;
  } else if (iqgDelta === 0 && gapsDelta < 0) {
    explanation += `👍 Otimização de Grade. Reduziu com sucesso ${Math.abs(gapsDelta)} 'janela(s)' vazia(s) na grade semanal. `;
  } else if (iqgDelta < 0) {
    explanation += `⚠️ Cenário com Impacto Negativo. A alteração reduziu o IQG em ${iqgDelta.toFixed(1)} pontos, potencialmente forçando novos conflitos ou aumentando gaps de turmas. `;
  } else {
    explanation += `ℹ️ Sem impacto detectável. A alteração não mudou os índices agregados de conflitos ou compacidade da grade. `;
  }

  if (affectedCount > 0) {
    explanation += `Para resolver as pendências locais, o motor realizou ${affectedCount} micro-ajustes pontuais de alocações (re-alocando ou permutando aulas de forma segura).`;
  } else {
    explanation += `Nenhum ajuste foi necessário ou viável com a mudança de grade especificada.`;
  }

  return {
    profId: professorId,
    profNome: prof.nomeCompleto,
    success: repairResult.success,
    scoreBefore: baseScore,
    scoreAfter: simScore,
    iqgDelta,
    conflictsBefore: baseConflicts.length,
    conflictsAfter: simConflicts.length,
    conflictsDelta,
    gapsBefore: baseGaps,
    gapsAfter: simGaps,
    gapsDelta,
    affectedCount,
    simulatedAlocacoes: repairResult.alocacoes,
    explanation
  };
}
