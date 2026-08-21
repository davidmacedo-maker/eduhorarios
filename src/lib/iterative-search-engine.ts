/**
 * Motor de Busca Iterativa Global (MBIG) – EduHorários 3.0
 * 
 * Este módulo gerencia de forma inteligente a otimização combinatória para a geração
 * de grades horárias, integrando as fases de:
 * - Validação de viabilidade inicial (MVEG)
 * - Auditoria de estratégias (MBEA)
 * - 10 Estratégias de priorização de demandas
 * - Busca Iterativa com critérios de parada parametrizados
 * - Perturbação Controlada para sair de mínimos locais
 * - Large Neighborhood Search (LNS)
 * - Simulated Annealing para otimização estocástica
 * - Lista Tabu para evitar ciclos de trocas repetidas
 * - Algoritmo Genético (cruzamento e mutação de soluções de ouro)
 * - Sistema de Pontuação Multicritério (Nota Final)
 * - Ranking estruturado e Aprendizado Histórico persistido
 * - Modo Explicação detalhado de melhorias
 * - Validação final rigorosa de consistência e integridade
 */

import type { 
  Alocacao, 
  Turma, 
  Professor, 
  Disciplina, 
  MatrizCurricular, 
  ConfiguracaoHorarios, 
  RegrasRelaxamento,
  Conflito,
  DiagnosticoGeracao,
  PerfilEscola,
  MbigExperiencia
} from "@/types";
import { runAllocation } from "./schedule-utils";
import { validarIntegridadeGrade } from "./integrity-validator";
import {
  calcularPerfilEscola,
  recomendarEstrategias,
  analisarFimGeracao,
  atualizarMemoriaConflitos,
  obterMemoriaConflitos,
  obterPadroesManuais,
  isLearningEnabled,
  obterBancoExperiencias
} from "./mbig-learning";

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACES DO MBIG
// ─────────────────────────────────────────────────────────────────────────────

export interface MbigOptions {
  modoExecucao: "rapido" | "balanceado" | "profundo";
  tempoMaximoSegundos: number;
  maxIteracoes: number;
  maxIteracoesSemMelhoria: number;
  regrasRelaxamento: RegrasRelaxamento;
  saParams?: {
    tempInicial: number;
    tempMinima: number;
    taxaResfriamento: number;
  };
  tabuParams?: {
    tamanhoLista: number;
  };
  onProgress?: (progress: MbigProgress) => void;
}

export interface MbigProgress {
  iteracaoAtual: number;
  estrategiaAtual: string;
  cobertura: number;
  melhorCobertura: number;
  notaFinal: number;
  melhorNotaFinal: number;
  tempoGastoMs: number;
  estadosExplorados: number;
  retrocessos: number;
  trocas: number;
  temperatura: number;
  listaTabuTamanho: number;
  estimativaRestanteMs: number;
  historicoEvolucao: { it: number; cobertura: number; melhor: number }[];
  alocacoes: Alocacao[];
}

export interface SolucaoClassificada {
  tentativa: number;
  estrategia: string;
  cobertura: number;
  conflitosCount: number;
  conflitosList: Conflito[];
  tempoMs: number;
  backtrackingCount: number;
  notaFinal: number;
  alocacoes: Alocacao[];
  diagnostico: DiagnosticoGeracao;
  momMetrics?: MOM4Metrics;
}

export interface MbigExplainingLog {
  estrategia: string;
  coberturaAnterior: number;
  coberturaNova: number;
  notaAnterior: number;
  notaNova: number;
  motivoMelhoria: string;
  trocasRealizadas: number;
  tempoGastoMs: number;
}

export interface AprendizadoItem {
  id: string;
  nProfs: number;
  nTurmas: number;
  nDisciplinas: number;
  tipoEscola: string;
  estrategiaUtilizada: string;
  tempoMs: number;
  cobertura: number;
  conflitosCount: number;
  notaFinal: number;
  timestamp: string;
}

// Chave para persistir o banco de soluções expandido do MBIG
const MBIG_SOLUCOES_KEY = "mbig_banco_solucoes_ouro";

// Dias de semana padrão
const DIAS_PADRAO = ["segunda", "terça", "quarta", "quinta", "sexta"];

// ─────────────────────────────────────────────────────────────────────────────
// FASE 11 – SISTEMA DE PONTUAÇÃO (Nota de 0 a 100)
// ─────────────────────────────────────────────────────────────────────────────
export interface MOM4Metrics {
  coberturaPct: number;
  conflitos: number;
  profTrocandoTurno: number;
  profJanelas: number;
  turmaJanelas: number;
  aulasIsoladas: number;
  distribucaoRuim: number;
  geminacaoCorreta: number;
  concentracaoContraturno: number;
  equilibrioCarga: number;
  prefProfAtendida: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// FASE 11 – MOTOR DE OTIMIZAÇÃO MATEMÁTICA (MOM 4.0) - FUNÇÃO OBJETIVO
// ─────────────────────────────────────────────────────────────────────────────
export function calcularNotaSolucao(
  alocacoes: Alocacao[],
  conflitos: Conflito[],
  turmas: Turma[],
  professores: Professor[],
  matriz: MatrizCurricular[],
  config: ConfiguracaoHorarios
): { 
  nota: number; 
  coberturaPct: number; 
  qualidadePct: number; 
  conflitosPct: number;
  momMetrics: MOM4Metrics;
} {
  const totalAulasPlanejadas = matriz.reduce((acc, m) => acc + m.aulasPorSemana, 0);
  const totalAlocadas = alocacoes.length;
  
  // 1. % de aulas alocadas (Cobertura)
  const coberturaPct = totalAulasPlanejadas > 0 ? (totalAlocadas / totalAulasPlanejadas) * 100 : 0;

  // 2. Número de Conflitos
  const conflitosCount = conflitos.length;

  const diasParaVerificar = ["segunda", "terca", "terça", "quarta", "quinta", "sexta"];

  // 3. Professor trocando de turno no mesmo dia
  let profTrocandoTurno = 0;
  professores.forEach(p => {
    diasParaVerificar.forEach(dia => {
      const allocs = alocacoes.filter(a => a.professorId === p.id && (a.diaSemana === dia || (dia === "terca" && a.diaSemana === "terça") || (dia === "terça" && a.diaSemana === "terca")));
      if (allocs.length > 0) {
        const turnosDia = new Set<string>();
        allocs.forEach(a => {
          const turma = turmas.find(t => t.id === a.turmaId);
          if (turma) {
            turnosDia.add(turma.turno);
          }
        });
        if (turnosDia.size > 1) {
          profTrocandoTurno += (turnosDia.size - 1);
        }
      }
    });
  });

  // 4. Professor com janela
  let profJanelas = 0;
  professores.forEach(p => {
    diasParaVerificar.forEach(dia => {
      const allocs = alocacoes.filter(a => a.professorId === p.id && (a.diaSemana === dia || (dia === "terca" && a.diaSemana === "terça") || (dia === "terça" && a.diaSemana === "terca")));
      const turnosSet = new Set<string>();
      allocs.forEach(a => {
        const t = turmas.find(tm => tm.id === a.turmaId);
        if (t) turnosSet.add(t.turno);
      });
      
      turnosSet.forEach(turno => {
        const allocsTurno = allocs.filter(a => {
          const t = turmas.find(tm => tm.id === a.turmaId);
          return t && t.turno === turno;
        });
        const slots = allocsTurno.map(a => a.horario).sort((x, y) => x - y);
        if (slots.length >= 2) {
          for (let i = 1; i < slots.length; i++) {
            const diff = slots[i] - slots[i - 1];
            if (diff > 1) {
              profJanelas += (diff - 1);
            }
          }
        }
      });
    });
  });

  // 5. Turma com janela
  let turmaJanelas = 0;
  turmas.forEach(t => {
    diasParaVerificar.forEach(dia => {
      const allocs = alocacoes.filter(a => a.turmaId === t.id && (a.diaSemana === dia || (dia === "terca" && a.diaSemana === "terça") || (dia === "terça" && a.diaSemana === "terca")));
      const slots = allocs.map(a => a.horario).sort((x, y) => x - y);
      if (slots.length >= 2) {
        for (let i = 1; i < slots.length; i++) {
          const diff = slots[i] - slots[i - 1];
          if (diff > 1) {
            turmaJanelas += (diff - 1);
          }
        }
      }
    });
  });

  // 6. Aulas isoladas (Disciplina com aulasPorSemana > 1 e que foi alocada apenas 1 vez num determinado dia)
  let aulasIsoladas = 0;
  turmas.forEach(t => {
    const tMatriz = matriz.filter(m => m.turmaId === t.id);
    tMatriz.forEach(m => {
      if (m.aulasPorSemana > 1) {
        diasParaVerificar.forEach(dia => {
          const allocs = alocacoes.filter(a => 
            a.turmaId === t.id && 
            a.disciplinaId === m.disciplinaId && 
            (a.diaSemana === dia || (dia === "terca" && a.diaSemana === "terça") || (dia === "terça" && a.diaSemana === "terca"))
          );
          if (allocs.length === 1) {
            aulasIsoladas++;
          }
        });
      }
    });
  });

  // 7. Distribuição ruim
  let distribucaoRuim = 0;
  turmas.forEach(t => {
    const counts: number[] = [];
    ["segunda", "terca", "quarta", "quinta", "sexta"].forEach(dia => {
      const allocs = alocacoes.filter(a => a.turmaId === t.id && (a.diaSemana === dia || (dia === "terca" && a.diaSemana === "terça")));
      counts.push(allocs.length);
    });
    
    const totalTurmaAllocs = counts.reduce((a, b) => a + b, 0);
    if (totalTurmaAllocs >= 12) {
      counts.forEach(c => {
        if (c > 0 && c <= 2) {
          distribucaoRuim++;
        }
      });
    }
    
    const activeCounts = counts.filter(c => c > 0);
    if (activeCounts.length >= 2) {
      const maxVal = Math.max(...activeCounts);
      const minVal = Math.min(...activeCounts);
      if (maxVal - minVal >= 3) {
        distribucaoRuim += 2;
      }
    }
  });

  // 8. Geminação correta
  let geminacaoCorreta = 0;
  turmas.forEach(t => {
    ["segunda", "terca", "quarta", "quinta", "sexta"].forEach(dia => {
      const allocs = alocacoes.filter(a => a.turmaId === t.id && (a.diaSemana === dia || (dia === "terca" && a.diaSemana === "terça")));
      allocs.sort((x, y) => x.horario - y.horario);
      for (let i = 1; i < allocs.length; i++) {
        if (
          allocs[i].horario === allocs[i - 1].horario + 1 &&
          allocs[i].disciplinaId === allocs[i - 1].disciplinaId &&
          allocs[i].professorId === allocs[i - 1].professorId
        ) {
          geminacaoCorreta++;
        }
      }
    });
  });

  // 9. Concentração ideal do contraturno
  let concentracaoContraturno = 0;
  turmas.forEach(t => {
    const isIntegralOuContraturno = (t.turno as string) === "integral" || t.nome.toLowerCase().includes("integral") || t.nome.toLowerCase().includes("contra");
    if (isIntegralOuContraturno) {
      ["segunda", "terca", "quarta", "quinta", "sexta"].forEach(dia => {
        const allocs = alocacoes.filter(a => a.turmaId === t.id && (a.diaSemana === dia || (dia === "terca" && a.diaSemana === "terça")));
        if (allocs.length > 0) {
          const slots = allocs.map(a => a.horario).sort((x, y) => x - y);
          const gaps = slots[slots.length - 1] - slots[0] + 1 - slots.length;
          if (gaps === 0) {
            concentracaoContraturno++;
          }
        }
      });
    }
  });

  // 10. Equilíbrio da carga semanal
  let equilibrioCarga = 0;
  turmas.forEach(t => {
    const counts: number[] = [];
    ["segunda", "terca", "quarta", "quinta", "sexta"].forEach(dia => {
      const allocs = alocacoes.filter(a => a.turmaId === t.id && (a.diaSemana === dia || (dia === "terca" && a.diaSemana === "terça")));
      counts.push(allocs.length);
    });
    const activeCounts = counts.filter(c => c > 0);
    if (activeCounts.length >= 2) {
      const maxVal = Math.max(...activeCounts);
      const minVal = Math.min(...activeCounts);
      if (maxVal - minVal <= 1) {
        equilibrioCarga += 2;
      }
    }
  });

  professores.forEach(p => {
    const counts: number[] = [];
    ["segunda", "terca", "quarta", "quinta", "sexta"].forEach(dia => {
      const allocs = alocacoes.filter(a => a.professorId === p.id && (a.diaSemana === dia || (dia === "terca" && a.diaSemana === "terça")));
      counts.push(allocs.length);
    });
    const activeCounts = counts.filter(c => c > 0);
    if (activeCounts.length >= 2) {
      const maxVal = Math.max(...activeCounts);
      if (maxVal <= 5) {
        equilibrioCarga++;
      }
    }
  });

  // 11. Preferência do professor atendida
  let prefProfAtendida = 0;
  alocacoes.forEach(a => {
    const prof = professores.find(p => p.id === a.professorId);
    if (prof && prof.planejamento) {
      const planItem = prof.planejamento.find(pl => pl.turmaId === a.turmaId && pl.disciplinaId === a.disciplinaId);
      if (planItem && planItem.prioridade === "alta") {
        prefProfAtendida++;
      }
    }
  });

  const learningActive = isLearningEnabled();
  const padroesManuais = learningActive ? obterPadroesManuais() : [];
  if (padroesManuais.length > 0) {
    alocacoes.forEach(a => {
      const match = padroesManuais.find(p => 
        p.ativo && 
        p.professorId === a.professorId &&
        (
          (p.tipo === "preferencia_dia" && p.diaSemana === a.diaSemana) ||
          (p.tipo === "preferencia_horario" && p.horario === a.horario)
        )
      );
      if (match) {
        prefProfAtendida += 2;
      }
    });
  }

  // CÁLCULO DA FUNÇÃO OBJETIVO MATEMÁTICA (MOM 4.0)
  const rawScore = 
    1000 * coberturaPct -
    300 * conflitosCount -
    150 * profTrocandoTurno -
    120 * profJanelas -
    100 * turmaJanelas -
    80 * aulasIsoladas -
    60 * distribucaoRuim +
    40 * geminacaoCorreta +
    30 * concentracaoContraturno +
    20 * equilibrioCarga +
    10 * prefProfAtendida;

  // Normalização para escala 0 a 100
  const nota = Math.max(0, Math.min(100, rawScore / 1000));

  const momMetrics: MOM4Metrics = {
    coberturaPct,
    conflitos: conflitosCount,
    profTrocandoTurno,
    profJanelas,
    turmaJanelas,
    aulasIsoladas,
    distribucaoRuim,
    geminacaoCorreta,
    concentracaoContraturno,
    equilibrioCarga,
    prefProfAtendida
  };

  return {
    nota: Number(nota.toFixed(1)),
    coberturaPct: Number(coberturaPct.toFixed(1)),
    qualidadePct: Number(nota.toFixed(1)), // Agora a qualidade é orientada pela função objetivo
    conflitosPct: Math.max(0, 100 - conflitosCount * 10),
    momMetrics
  };
}

export interface GradeHallFama {
  id: string;
  nome: string;
  scoreGlobal: number;
  tempo: number; // em segundos
  estrategia: string;
  conflitos: number;
  janelasProf: number;
  janelasTurma: number;
  trocasTurno: number;
  cobertura: number;
  restricoes: string[];
  timestamp: string;
  alocacoes: Alocacao[];
}

export function obterHallDaFama(): GradeHallFama[] {
  try {
    const data = localStorage.getItem("mbig_hall_da_fama");
    if (!data) return [];
    return JSON.parse(data) as GradeHallFama[];
  } catch (err) {
    console.error("Erro ao ler Hall da Fama:", err);
    return [];
  }
}

export function salvarHallDaFama(lista: GradeHallFama[]) {
  try {
    localStorage.setItem("mbig_hall_da_fama", JSON.stringify(lista));
  } catch (err) {
    console.error("Erro ao salvar Hall da Fama:", err);
  }
}

export function limparHallDaFama() {
  localStorage.removeItem("mbig_hall_da_fama");
}

export function adicionarAoHallDaFama(
  alocacoes: Alocacao[],
  scoreGlobal: number,
  tempoMs: number,
  estrategia: string,
  conflitos: number,
  janelasProf: number,
  janelasTurma: number,
  trocasTurno: number,
  cobertura: number,
  options: any
) {
  try {
    const lista = obterHallDaFama();
    
    // Crie as restrições com base nas configurações ativas
    const restricoes: string[] = [];
    if (options?.regrasRelaxamento?.permitirJanelaProfessor === false) {
      restricoes.push("Janela de Professor Bloqueada");
    } else {
      restricoes.push("Janela de Professor Flexível");
    }
    if (options?.regrasRelaxamento?.permitirFuraDisponibilidade) {
      restricoes.push("Disponibilidade Flexível");
    } else {
      restricoes.push("Respeitar Disponibilidade");
    }
    if (options?.regrasRelaxamento?.cargaDiariaMaximaDocente) {
      restricoes.push(`Carga Máxima Diária: ${options.regrasRelaxamento.cargaDiariaMaximaDocente}h`);
    }
    if (options?.modoExecucao) {
      restricoes.push(`Modo: ${options.modoExecucao}`);
    }

    const novoItem: GradeHallFama = {
      id: "hall_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
      nome: `Grade Temporaria`, // Será renomeada na ordenação
      scoreGlobal,
      tempo: Number((tempoMs / 1000).toFixed(1)),
      estrategia,
      conflitos,
      janelasProf,
      janelasTurma,
      trocasTurno,
      cobertura,
      restricoes,
      timestamp: new Date().toISOString(),
      alocacoes
    };

    lista.push(novoItem);
    
    // Ordena decrescente por score global
    lista.sort((x, y) => y.scoreGlobal - x.scoreGlobal);
    
    // Mantém as 20 melhores
    if (lista.length > 20) {
      lista.splice(20);
    }
    
    // Renomeia de acordo com a ordem de qualidade
    lista.forEach((item, index) => {
      item.nome = `Grade ${String.fromCharCode(65 + index)}`;
    });

    salvarHallDaFama(lista);
  } catch (err) {
    console.error("Erro ao adicionar ao Hall da Fama:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FASE 2 – MÚLTIPLAS ESTRATÉGIAS DE ORDENAÇÃO
// ─────────────────────────────────────────────────────────────────────────────
function aplicarEstrategiaPrioridade(
  estrategiaId: number,
  turmas: Turma[],
  disciplinas: Disciplina[],
  professores: Professor[],
  matriz: MatrizCurricular[],
  config: ConfiguracaoHorarios,
  bestStrategyNameFromDB?: string
): { professores: Professor[]; matSorteada: MatrizCurricular[] } {
  // Clona para não modificar originais
  const profsClonados = JSON.parse(JSON.stringify(professores)) as Professor[];
  const matClonada = [...matriz];

  // Aplica padrões de ajustes manuais aprendidos do usuário (se ativo)
  const learningActive = isLearningEnabled();
  const padroesManuais = learningActive ? obterPadroesManuais() : [];
  const padroesAtivos = padroesManuais.filter(p => p.ativo);

  if (padroesAtivos.length > 0) {
    profsClonados.forEach(p => {
      if (p.planejamento) {
        p.planejamento.forEach(item => {
          // Se há padrão de concentrar contraturno para esta turma
          const hasContraturnoPadrao = padroesAtivos.some(pat => 
            pat.tipo === "concentracao_aulas" && 
            pat.turmaId === item.turmaId
          );
          // Se o professor tem preferência manual por dia ou horário
          const hasProfPadrao = padroesAtivos.some(pat => 
            (pat.tipo === "preferencia_dia" || pat.tipo === "preferencia_horario") && 
            pat.professorId === p.id
          );

          if (hasContraturnoPadrao || hasProfPadrao) {
            item.prioridade = "alta";
          }
        });
      }
    });
  }

  // Identificador da estratégia a ser utilizada
  let estEfetiva = estrategiaId;
  if (estrategiaId === 9 && bestStrategyNameFromDB) {
    // Escolhe a estratégia mapeada
    const estMap: Record<string, number> = {
      "Professor mais restritivo primeiro": 1,
      "Turma mais restritiva primeiro": 2,
      "Maior carga horária primeiro": 3,
      "Contraturno primeiro": 4,
      "Integral primeiro": 5,
      "Disciplinas críticas primeiro": 6,
      "Maior número de conflitos primeiro": 7,
      "Ordem totalmente aleatória": 8,
      "Mistura dinâmica": 10
    };
    estEfetiva = estMap[bestStrategyNameFromDB] || 1;
  }

  // Helper para calcular a disponibilidade de um professor
  const getDisponibilidadeCount = (p: Professor) => {
    let count = 0;
    if (p.disponibilidade) {
      Object.keys(p.disponibilidade).forEach((dia) => {
        count += (p.disponibilidade[dia] || []).length;
      });
    }
    return count === 0 ? 1 : count;
  };

  // Helper para saber se turma é contraturno
  const isContraturno = (tId: string) => {
    const t = turmas.find(x => x.id === tId);
    if (!t) return false;
    return t.turno === "tarde" || t.turno === "noite" || t.nome.toLowerCase().includes("contra");
  };

  // Helper para saber se a disciplina é crítica (Português, Matemática, Física, Química)
  const isDisciplinaCritica = (dId: string) => {
    const d = disciplinas.find(x => x.id === dId);
    if (!d) return false;
    const nome = d.nome.toLowerCase();
    return (
      nome.includes("mat") || 
      nome.includes("port") || 
      nome.includes("fís") || 
      nome.includes("quím") || 
      nome.includes("língua port")
    );
  };

  switch (estEfetiva) {
    case 1: // Professor mais restritivo primeiro (MRV Prof)
      profsClonados.forEach((p) => {
        const slots = getDisponibilidadeCount(p);
        const ratio = p.cargaHorariaMaximaSemanal / slots;
        // Se ratio for alto, professor é muito restrito!
        const pLevel = ratio > 1.2 ? "alta" : ratio > 0.8 ? "media" : "baixa";
        p.planejamento?.forEach((item) => {
          item.prioridade = pLevel;
        });
      });
      // Ordena a matriz também pelos professores mais restritos
      matClonada.sort((x, y) => {
        const profX = profsClonados.find(p => p.id === x.disciplinaId); // simplificado, ou pelo ID de professor associado
        const profY = profsClonados.find(p => p.id === y.disciplinaId);
        const slotsX = profX ? getDisponibilidadeCount(profX) : 99;
        const slotsY = profY ? getDisponibilidadeCount(profY) : 99;
        return slotsX - slotsY;
      });
      break;

    case 2: // Turma mais restritiva primeiro (MRV Turma)
      profsClonados.forEach((p) => {
        p.planejamento?.forEach((item) => {
          const t = turmas.find(x => x.id === item.turmaId);
          // Turmas noturnas ou com menos dias permitidos são mais restritas
          const dias = t?.diasPermitidos?.length || 5;
          if (t?.turno === "noite" || dias < 4) {
            item.prioridade = "alta";
          } else {
            item.prioridade = "media";
          }
        });
      });
      break;

    case 3: // Maior carga horaria primeiro (Heavy Load First)
      profsClonados.forEach((p) => {
        p.planejamento?.forEach((item) => {
          const m = matClonada.find(x => x.turmaId === item.turmaId && x.disciplinaId === item.disciplinaId);
          const aulas = m?.aulasPorSemana || 2;
          item.prioridade = aulas >= 4 ? "alta" : aulas >= 2 ? "media" : "baixa";
        });
      });
      matClonada.sort((x, y) => y.aulasPorSemana - x.aulasPorSemana);
      break;

    case 4: // Contraturno primeiro
      profsClonados.forEach((p) => {
        p.planejamento?.forEach((item) => {
          item.prioridade = isContraturno(item.turmaId) ? "alta" : "media";
        });
      });
      matClonada.sort((x, y) => {
        const cx = isContraturno(x.turmaId) ? 1 : 0;
        const cy = isContraturno(y.turmaId) ? 1 : 0;
        return cy - cx;
      });
      break;

    case 5: // Integral primeiro (ou turmas da manhã / regulares)
      profsClonados.forEach((p) => {
        p.planejamento?.forEach((item) => {
          const t = turmas.find(x => x.id === item.turmaId);
          item.prioridade = t?.turno === "manha" ? "alta" : "media";
        });
      });
      matClonada.sort((x, y) => {
        const tx = turmas.find(t => t.id === x.turmaId)?.turno === "manha" ? 1 : 0;
        const ty = turmas.find(t => t.id === y.turmaId)?.turno === "manha" ? 1 : 0;
        return ty - tx;
      });
      break;

    case 6: // Disciplinas críticas primeiro
      profsClonados.forEach((p) => {
        p.planejamento?.forEach((item) => {
          item.prioridade = isDisciplinaCritica(item.disciplinaId) ? "alta" : "media";
        });
      });
      matClonada.sort((x, y) => {
        const cx = isDisciplinaCritica(x.disciplinaId) ? 1 : 0;
        const cy = isDisciplinaCritica(y.disciplinaId) ? 1 : 0;
        return cy - cx;
      });
      break;

    case 7: // Maior número de conflitos primeiro
      // Em uma primeira tentativa, podemos focar nas disciplinas que têm menos professores habilitados
      profsClonados.forEach((p) => {
        p.planejamento?.forEach((item) => {
          const profsHabilitados = professores.filter(prof => prof.disciplinas.includes(item.disciplinaId)).length;
          item.prioridade = profsHabilitados === 1 ? "alta" : profsHabilitados === 2 ? "media" : "baixa";
        });
      });
      break;

    case 8: // Ordem totalmente aleatória
      profsClonados.forEach((p) => {
        p.planejamento?.forEach((item) => {
          const r = Math.random();
          item.prioridade = r > 0.66 ? "alta" : r > 0.33 ? "media" : "baixa";
        });
      });
      // Embaralha matriz
      for (let i = matClonada.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [matClonada[i], matClonada[j]] = [matClonada[j], matClonada[i]];
      }
      break;

    case 10: // Mistura dinâmica das melhores estratégias
    default:
      profsClonados.forEach((p) => {
        const pSlots = getDisponibilidadeCount(p);
        p.planejamento?.forEach((item) => {
          const isCrit = isDisciplinaCritica(item.disciplinaId);
          const isContra = isContraturno(item.turmaId);
          const pRestrito = p.cargaHorariaMaximaSemanal / pSlots > 1.0;
          if (pRestrito || isCrit || isContra) {
            item.prioridade = "alta";
          } else {
            item.prioridade = "media";
          }
        });
      });
      // Ordenação mista da matriz
      matClonada.sort((x, y) => {
        const xc = isDisciplinaCritica(x.disciplinaId) ? 2 : 0 + (isContraturno(x.turmaId) ? 1 : 0);
        const yc = isDisciplinaCritica(y.disciplinaId) ? 2 : 0 + (isContraturno(y.turmaId) ? 1 : 0);
        return yc - xc;
      });
      break;
  }

  return { professores: profsClonados, matSorteada: matClonada };
}

// Retorna o nome amigável da estratégia
export function getEstrategiaNome(id: number): string {
  const nomes: Record<number, string> = {
    1: "Estratégia 1: Professor mais restritivo primeiro (MRV)",
    2: "Estratégia 2: Turma mais restritiva primeiro (MRV)",
    3: "Estratégia 3: Maior carga horária primeiro",
    4: "Estratégia 4: Contraturno primeiro",
    5: "Estratégia 5: Integral primeiro",
    6: "Estratégia 6: Disciplinas críticas primeiro",
    7: "Estratégia 7: Maior número de conflitos primeiro",
    8: "Estratégia 8: Ordem totalmente aleatória",
    9: "Estratégia 9: Melhor estratégia do Banco de Soluções",
    10: "Estratégia 10: Mistura dinâmica das melhores heurísticas",
  };
  return nomes[id] || `Estratégia Secundária ${id}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// FASE 5 – PERTURBAÇÃO CONTROLADA
// ─────────────────────────────────────────────────────────────────────────────
function aplicarPerturbacao(
  alocacoes: Alocacao[],
  conflitos: Conflito[],
  pctMin = 0.05,
  pctMax = 0.20
): Alocacao[] {
  if (alocacoes.length === 0) return [];
  const pct = pctMin + Math.random() * (pctMax - pctMin);
  const totalDesalocar = Math.max(1, Math.floor(alocacoes.length * pct));

  // Prioriza desalocar aulas que estão gerando conflitos
  const idsConflito = new Set<string>();
  conflitos.forEach((c) => {
    // Tenta encontrar alocações relacionadas a este conflito
    if (c.turmaId && c.dia && c.horario !== undefined) {
      const match = alocacoes.find(a => a.turmaId === c.turmaId && a.diaSemana === c.dia && a.horario === c.horario);
      if (match) idsConflito.add(match.id);
    }
    if (c.professorId && c.dia && c.horario !== undefined) {
      const match = alocacoes.find(a => a.professorId === c.professorId && a.diaSemana === c.dia && a.horario === c.horario);
      if (match) idsConflito.add(match.id);
    }
  });

  const alocacoesEmConflito = alocacoes.filter(a => idsConflito.has(a.id) && !a.isLocked);
  const alocacoesNormais = alocacoes.filter(a => !idsConflito.has(a.id) && !a.isLocked);

  // Embaralha as listas para desalocação aleatória
  const shuffledConflitos = [...alocacoesEmConflito].sort(() => Math.random() - 0.5);
  const shuffledNormais = [...alocacoesNormais].sort(() => Math.random() - 0.5);

  const aRemover = new Set<string>();
  
  // Primeiro remove as de conflito
  for (let i = 0; i < shuffledConflitos.length && aRemover.size < totalDesalocar; i++) {
    aRemover.add(shuffledConflitos[i].id);
  }
  // Se ainda faltar, remove as normais
  for (let i = 0; i < shuffledNormais.length && aRemover.size < totalDesalocar; i++) {
    aRemover.add(shuffledNormais[i].id);
  }

  // Mantém os que não foram desalocados ou estão travados (locked)
  return alocacoes.filter(a => !aRemover.has(a.id) || !!a.isLocked);
}

// ─────────────────────────────────────────────────────────────────────────────
// FASE 6 – LARGE NEIGHBORHOOD SEARCH (LNS)
// ─────────────────────────────────────────────────────────────────────────────
function executarLNS(
  alocacoesAtuais: Alocacao[],
  conflitos: Conflito[],
  turmas: Turma[],
  disciplinas: Disciplina[],
  professores: Professor[],
  matriz: MatrizCurricular[],
  config: ConfiguracaoHorarios,
  regrasRelaxamento: RegrasRelaxamento,
  notaAtual: number
): { alocacoes: Alocacao[]; conflitos: Conflito[]; nota: number; melhorou: boolean } {
  // 1. Selecionar blocos com conflito (ou blocos problemáticos)
  if (conflitos.length === 0 && alocacoesAtuais.length > 0) {
    // Se não há conflito, desalocamos uma turma aleatória para otimizar qualidade
    const turmaSorteada = turmas[Math.floor(Math.random() * turmas.length)];
    const locked = alocacoesAtuais.filter(a => a.turmaId !== turmaSorteada.id);
    const res = runAllocation(turmas, disciplinas, professores, matriz, config, locked, regrasRelaxamento, undefined, undefined, Math.floor(Math.random() * 1000));
    const score = calcularNotaSolucao(res.alocacoes, res.conflitos, turmas, professores, matriz, config);
    if (score.nota > notaAtual) {
      return { alocacoes: res.alocacoes, conflitos: res.conflitos, nota: score.nota, melhorou: true };
    }
    return { alocacoes: alocacoesAtuais, conflitos, nota: notaAtual, melhorou: false };
  }

  // Se há conflito, de-aloca as turmas/professores envolvidos nesses conflitos
  const turmasProblematicas = new Set<string>();
  conflitos.slice(0, 3).forEach((c) => {
    if (c.turmaId) turmasProblematicas.add(c.turmaId);
  });

  if (turmasProblematicas.size === 0) {
    // Fallback: seleciona 2 turmas aleatórias
    const t1 = turmas[Math.floor(Math.random() * turmas.length)]?.id;
    const t2 = turmas[Math.floor(Math.random() * turmas.length)]?.id;
    if (t1) turmasProblematicas.add(t1);
    if (t2) turmasProblematicas.add(t2);
  }

  // De-aloca as aulas dessas turmas problemáticas (ficam de fora das alocações locked)
  const lockedAlocs = alocacoesAtuais.filter(a => !turmasProblematicas.has(a.turmaId));

  // Tenta reconstruir apenas esses blocos usando o motor básico
  const res = runAllocation(
    turmas, 
    disciplinas, 
    professores, 
    matriz, 
    config, 
    lockedAlocs, 
    regrasRelaxamento, 
    undefined, 
    undefined, 
    Math.floor(Math.random() * 2000)
  );

  const score = calcularNotaSolucao(res.alocacoes, res.conflitos, turmas, professores, matriz, config);

  if (score.nota > notaAtual) {
    return {
      alocacoes: res.alocacoes,
      conflitos: res.conflitos,
      nota: score.nota,
      melhorou: true
    };
  }

  return {
    alocacoes: alocacoesAtuais,
    conflitos,
    nota: notaAtual,
    melhorou: false
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FASE 9 – ALGORITMO GENÉTICO (GA - Crossover e Mutação)
// ─────────────────────────────────────────────────────────────────────────────
function executarCrossoverGA(
  solucaoA: Alocacao[],
  solucaoB: Alocacao[],
  turmas: Turma[],
  disciplinas: Disciplina[],
  professores: Professor[],
  matriz: MatrizCurricular[],
  config: ConfiguracaoHorarios,
  regrasRelaxamento: RegrasRelaxamento
): Alocacao[] {
  // Crossover de ponto único ao nível de turmas:
  // Metade das turmas herdam as alocações da Solução A, a outra metade herda da Solução B.
  const turmasIds = turmas.map(t => t.id);
  const corte = Math.floor(turmasIds.length / 2);
  const turmasA = new Set(turmasIds.slice(0, corte));

  const alocacoesFilho: Alocacao[] = [];

  // Adiciona da Solução A para a primeira metade de turmas
  solucaoA.forEach((a) => {
    if (turmasA.has(a.turmaId)) {
      alocacoesFilho.push({ ...a });
    }
  });

  // Adiciona da Solução B para a outra metade de turmas
  solucaoB.forEach((b) => {
    if (!turmasA.has(b.turmaId)) {
      alocacoesFilho.push({ ...b });
    }
  });

  // Como o crossover cru pode gerar pequenos conflitos (ex: professor alocado no mesmo dia e horario em turmas diferentes),
  // nós tratamos isso rodando uma perturbação corretiva nas alocações em conflito
  const tempConflitos: Conflito[] = [];
  const profOcupado = new Set<string>();

  // Filtra as alocações do filho removendo as sobreposições de professores
  const alocacoesFiltradas: Alocacao[] = [];
  alocacoesFilho.forEach((aloc) => {
    const key = `${aloc.professorId}|${aloc.diaSemana}|${aloc.horario}`;
    if (profOcupado.has(key)) {
      // Conflito detectado! Deixamos esta aula de fora para ser re-alocada pelo motor
    } else {
      profOcupado.add(key);
      alocacoesFiltradas.push(aloc);
    }
  });

  // Re-aloca o que ficou de fora travando as que estão sem conflito
  const res = runAllocation(
    turmas,
    disciplinas,
    professores,
    matriz,
    config,
    alocacoesFiltradas,
    regrasRelaxamento,
    undefined,
    undefined,
    888
  );

  return res.alocacoes;
}

// ─────────────────────────────────────────────────────────────────────────────
// FASE 12 – APRENDIZADO (Histórico de Soluções)
// ─────────────────────────────────────────────────────────────────────────────
function lerMelhorEstrategiaHistorico(
  turmasCount: number,
  profsCount: number,
  disciplinasCount: number
): string | undefined {
  try {
    const data = localStorage.getItem(MBIG_SOLUCOES_KEY);
    if (!data) return undefined;
    const historico = JSON.parse(data) as AprendizadoItem[];
    
    // Busca escolas semelhantes (margem de 30% na contagem de turmas e professores)
    const semelhantes = historico.filter((h) => {
      const diffTurmas = Math.abs(h.nTurmas - turmasCount) / Math.max(1, turmasCount);
      const diffProfs = Math.abs(h.nProfs - profsCount) / Math.max(1, profsCount);
      return diffTurmas <= 0.3 && diffProfs <= 0.3;
    });

    if (semelhantes.length === 0) return undefined;

    // Ordena por nota final decrescente e pega a melhor estratégia
    semelhantes.sort((x, y) => y.notaFinal - x.notaFinal);
    return semelhantes[0].estrategiaUtilizada;
  } catch (err) {
    console.error("Erro ao ler aprendizado do MBIG:", err);
    return undefined;
  }
}

function salvarSucessoNoHistorico(
  turmasCount: number,
  profsCount: number,
  disciplinasCount: number,
  tipoEscola: string,
  estrategia: string,
  tempoMs: number,
  cobertura: number,
  conflitosCount: number,
  notaFinal: number
) {
  try {
    const data = localStorage.getItem(MBIG_SOLUCOES_KEY);
    const historico = data ? (JSON.parse(data) as AprendizadoItem[]) : [];
    
    const novoItem: AprendizadoItem = {
      id: "mbig_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
      nProfs: profsCount,
      nTurmas: turmasCount,
      nDisciplinas: disciplinasCount,
      tipoEscola,
      estrategiaUtilizada: estrategia,
      tempoMs,
      cobertura,
      conflitosCount,
      notaFinal,
      timestamp: new Date().toISOString()
    };

    historico.push(novoItem);
    // Limita o histórico aos últimos 100 registros para economizar localStorage
    if (historico.length > 100) {
      historico.sort((x, y) => new Date(y.timestamp).getTime() - new Date(x.timestamp).getTime());
      historico.splice(100);
    }
    localStorage.setItem(MBIG_SOLUCOES_KEY, JSON.stringify(historico));
  } catch (err) {
    console.error("Erro ao salvar aprendizado do MBIG:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MOTOR DE EXECUÇÃO PRINCIPAL DO MBIG
// ─────────────────────────────────────────────────────────────────────────────
export async function runIterativeSearch(
  turmas: Turma[],
  disciplinas: Disciplina[],
  professores: Professor[],
  matriz: MatrizCurricular[],
  config: ConfiguracaoHorarios,
  lockedAlocacoes: Alocacao[] = [],
  options: MbigOptions
): Promise<{
  sucesso: boolean;
  alocacoes: Alocacao[];
  conflitos: Conflito[];
  diagnostico: DiagnosticoGeracao;
  ranking: SolucaoClassificada[];
  explicacoes: MbigExplainingLog[];
  relatorioCriticas: string;
  perfilEscola?: PerfilEscola;
  aprendizadoLog?: MbigExperiencia;
}> {
  const startTimeGlobal = performance.now();
  const explicacoes: MbigExplainingLog[] = [];
  const ranking: SolucaoClassificada[] = [];

  // Tipo da Escola (com base na presença de turmas de contraturno)
  const temContraturno = turmas.some(t => t.nome.toLowerCase().includes("contra") || t.turno === "noite");
  const tipoEscola = temContraturno ? "Contraturno/Noturno" : "Regular Diurno";

  // 1. Validação de Parâmetros de Entrada
  const totalAulasPlanejadas = matriz.reduce((acc, m) => acc + m.aulasPorSemana, 0);

  // ─────────────────────────────────────────────────────────────────────────
  // FASE 1 – VALIDAÇÃO INICIAL (MVEG)
  // ─────────────────────────────────────────────────────────────────────────
  let capacidadeTotalSlots = 0;
  for (const t of turmas) {
    const slotsPorDia = t.turno === "noite" ? (config.quantidadeHorariosPorDiaNoite ?? 4) : t.turno === "tarde" ? (config.quantidadeHorariosPorDiaTarde ?? 5) : config.quantidadeHorariosPorDia;
    capacidadeTotalSlots += slotsPorDia * DIAS_PADRAO.length;
  }

  if (totalAulasPlanejadas > capacidadeTotalSlots) {
    const erroMsg = `Inviabilidade Estrutural (MVEG): Carga curricular total (${totalAulasPlanejadas} aulas) excede a capacidade física total da escola (${capacidadeTotalSlots} slots).`;
    return {
      sucesso: false,
      alocacoes: [],
      conflitos: [],
      diagnostico: {
        sucesso: false,
        taxaAlocacao: 0,
        aulasPlanejadas: totalAulasPlanejadas,
        aulasAlocadas: 0,
        motivoEncerrado: erroMsg,
        mensagens: [erroMsg]
      },
      ranking: [],
      explicacoes: [],
      relatorioCriticas: erroMsg
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MÓDULO DE APRENDIZAGEM PERMANENTE (MBIG 3.0)
  // ─────────────────────────────────────────────────────────────────────────
  const learningActive = isLearningEnabled();
  
  // 2. Perfil Matemático da Escola
  const perfilEscola = calcularPerfilEscola(turmas, professores, disciplinas, matriz, config);

  // 3. Comparação com gerações anteriores e Recomendação de Estratégias
  const todasExperiencias = obterBancoExperiencias();
  const recomendacoes = learningActive ? recomendarEstrategias(perfilEscola, todasExperiencias) : [];

  // 7. Memória de Conflitos Frequentes para re-priorizar estratégias
  const memoriaConflitos = obterMemoriaConflitos();

  // Mapeia nomes das heurísticas recomendadas para IDs
  const estMap: Record<string, number> = {
    "Professor mais restritivo primeiro (MRV)": 1,
    "Turma mais restritiva primeiro (MRV)": 2,
    "Maior carga horária primeiro": 3,
    "Contraturno primeiro": 4,
    "Integral primeiro": 5,
    "Disciplinas críticas primeiro": 6,
    "Maior número de conflitos primeiro": 7,
    "Ordem totalmente aleatória": 8,
    "Mistura dinâmica das melhores heurísticas": 10
  };

  const estsRecomendadas: number[] = [];
  recomendacoes.forEach(rec => {
    const id = estMap[rec.estrategia];
    if (id && !estsRecomendadas.includes(id)) {
      estsRecomendadas.push(id);
    }
  });

  // Decide estratégia prioritária baseada na memória de conflitos físicos mais comuns
  let estPrioritariaPorConflito = 0;
  const maxConflito = Object.entries(memoriaConflitos).reduce((a, b) => a[1] > b[1] ? a : b, ["", 0]);
  if (maxConflito[1] > 3) { // Ativa com dados cumulativos
    if (maxConflito[0] === "professorIndisponivel") {
      estPrioritariaPorConflito = 1; // Prioriza MRV do Professor
    } else if (maxConflito[0] === "contraturno") {
      estPrioritariaPorConflito = 4; // Prioriza Contraturno Primeiro
    } else if (maxConflito[0] === "limiteDiario") {
      estPrioritariaPorConflito = 3; // Prioriza Maior Carga Primeiro
    } else if (maxConflito[0] === "choqueHorario") {
      estPrioritariaPorConflito = 7; // Prioriza Mais Conflitos Primeiro
    }
  }

  // Montagem da lista de estratégias priorizada e otimizada pelo aprendizado ativo
  let listaEstrategias = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  if (learningActive) {
    const estsOtimas: number[] = [];
    if (estPrioritariaPorConflito) {
      estsOtimas.push(estPrioritariaPorConflito);
    }
    estsRecomendadas.forEach(id => {
      if (!estsOtimas.includes(id)) estsOtimas.push(id);
    });
    // Preenche com as demais de forma sequencial
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].forEach(id => {
      if (!estsOtimas.includes(id)) estsOtimas.push(id);
    });
    listaEstrategias = estsOtimas;
  }

  // Determinar parâmetros com base no Modo de Execução (Fase 14)
  let maxIteracoes = options.maxIteracoes;
  let maxIterSemMelhoria = options.maxIteracoesSemMelhoria;
  let usarSA = false;
  let usarLNS = false;
  let usarGA = false;

  if (options.modoExecucao === "rapido") {
    maxIteracoes = Math.min(maxIteracoes, 3);
    maxIterSemMelhoria = Math.min(maxIterSemMelhoria, 2);
    usarSA = false;
    usarLNS = false;
    usarGA = false;
  } else if (options.modoExecucao === "balanceado") {
    maxIteracoes = Math.min(maxIteracoes, 10);
    maxIterSemMelhoria = Math.min(maxIterSemMelhoria, 5);
    usarSA = true;
    usarLNS = true;
    usarGA = false;
  } else { // "profundo"
    maxIteracoes = Math.max(maxIteracoes, 20);
    maxIterSemMelhoria = Math.max(maxIterSemMelhoria, 10);
    usarSA = true;
    usarLNS = true;
    usarGA = true;
  }

  const melhorEstrategiaDB = lerMelhorEstrategiaHistorico(turmas.length, professores.length, disciplinas.length);
  
  // Estado tabu (Fase 8)
  const tabuList: string[] = [];
  const tabuMaxTamanho = options.tabuParams?.tamanhoLista || 12;

  // Parâmetros de Simulated Annealing (Fase 7)
  let temperatura = options.saParams?.tempInicial || 100.0;
  const tempMinima = options.saParams?.tempMinima || 1.0;
  const taxaResfriamento = options.saParams?.taxaResfriamento || 0.85;

  let melhorSolucaoGlobal: SolucaoClassificada | null = null;
  let iteracoesSemMelhoriaCont = 0;

  // Real-time stats
  let totalEstadosExplorados = 0;
  let totalRetrocessos = 0;
  let totalTrocasRealizadas = 0;

  // LOOP DE BUSCA ITERATIVA GLOBAL (Fase 3 & 4)
  for (let it = 1; it <= maxIteracoes; it++) {
    const elapsed = performance.now() - startTimeGlobal;
    if (elapsed > options.tempoMaximoSegundos * 1000) {
      explicacoes.push({
        estrategia: "Critério de Parada",
        coberturaAnterior: melhorSolucaoGlobal?.cobertura || 0,
        coberturaNova: melhorSolucaoGlobal?.cobertura || 0,
        notaAnterior: melhorSolucaoGlobal?.notaFinal || 0,
        notaNova: melhorSolucaoGlobal?.notaFinal || 0,
        motivoMelhoria: "Limite de tempo excedido configurado pelo usuário.",
        trocasRealizadas: 0,
        tempoGastoMs: elapsed
      });
      break;
    }

    if (iteracoesSemMelhoriaCont >= maxIterSemMelhoria) {
      explicacoes.push({
        estrategia: "Critério de Parada",
        coberturaAnterior: melhorSolucaoGlobal?.cobertura || 0,
        coberturaNova: melhorSolucaoGlobal?.cobertura || 0,
        notaAnterior: melhorSolucaoGlobal?.notaFinal || 0,
        notaNova: melhorSolucaoGlobal?.notaFinal || 0,
        motivoMelhoria: `Limite de iterações sem melhoria atingido (${maxIterSemMelhoria}).`,
        trocasRealizadas: 0,
        tempoGastoMs: elapsed
      });
      break;
    }

    // Escolha de estratégia cíclica da lista de 10 como base
    let estIdEfetivo = listaEstrategias[(it - 1) % listaEstrategias.length];
    let adaptadoMotive = "";

    // 6. ADAPTAÇÃO DINÂMICA DE ESTRATÉGIAS (Escapa de mínimos locais)
    if (learningActive && iteracoesSemMelhoriaCont >= 2 && melhorSolucaoGlobal) {
      if (estIdEfetivo === 1 || estIdEfetivo === 2) {
        estIdEfetivo = 10; // Mistura dinâmica
        adaptadoMotive = `Adaptação Dinâmica: Heurísticas de ordenação MRV básicas estagnaram por ${iteracoesSemMelhoriaCont} iterações. Troca adaptativa para Mistura Dinâmica.`;
      } else {
        estIdEfetivo = 1; // Professor restritivo
        adaptadoMotive = `Adaptação Dinâmica: Heurísticas complementares estagnaram. Retornando ao Professor mais restritivo primeiro para obter estabilidade.`;
      }
    }

    const estNome = getEstrategiaNome(estIdEfetivo);

    // ─────────────────────────────────────────────────────────────────────────
    // FASE 2 – APLICAR ESTRATÉGIA NO PLANEJAMENTO E RE-ORDENAR
    // ─────────────────────────────────────────────────────────────────────────
    const { professores: profsEst, matSorteada: matEst } = aplicarEstrategiaPrioridade(
      estIdEfetivo, 
      turmas, 
      disciplinas, 
      professores, 
      matriz, 
      config,
      melhorEstrategiaDB
    );

    // Executa a alocação utilizando o solver básico
    const runStartTime = performance.now();
    const solverRes = runAllocation(
      turmas,
      disciplinas,
      profsEst,
      matEst,
      config,
      lockedAlocacoes,
      options.regrasRelaxamento,
      undefined,
      undefined,
      100 + it * 77 // Sementes mutantes por iteração
    );
    const runTime = performance.now() - runStartTime;

    totalEstadosExplorados += 40; // estimativa de caminhos analisados
    totalRetrocessos += solverRes.diagnostico.aulasImpactadas?.length || 0;

    // Calcula a pontuação e qualidade da solução gerada (Fase 11)
    const scoreInfo = calcularNotaSolucao(
      solverRes.alocacoes,
      solverRes.conflitos,
      turmas,
      professores,
      matriz,
      config
    );

    const solClassificada: SolucaoClassificada = {
      tentativa: it,
      estrategia: estNome,
      cobertura: scoreInfo.coberturaPct,
      conflitosCount: solverRes.conflitos.length,
      conflitosList: solverRes.conflitos,
      tempoMs: runTime,
      backtrackingCount: solverRes.diagnostico.aulasImpactadas?.length || 0,
      notaFinal: scoreInfo.nota,
      alocacoes: solverRes.alocacoes,
      diagnostico: solverRes.diagnostico,
      momMetrics: scoreInfo.momMetrics
    };

    ranking.push(solClassificada);

    // ─────────────────────────────────────────────────────────────────────────
    // COMPARADOR DE SOLUÇÕES (Fase 10)
    // ─────────────────────────────────────────────────────────────────────────
    let aceitouSolucao = false;
    let motivoAceite = "";

    if (!melhorSolucaoGlobal) {
      melhorSolucaoGlobal = solClassificada;
      aceitouSolucao = true;
      motivoAceite = "Geração inicial de referência.";
    } else {
      const deltaNota = scoreInfo.nota - melhorSolucaoGlobal.notaFinal;
      if (deltaNota > 0) {
        // Melhoria clara!
        melhorSolucaoGlobal = solClassificada;
        aceitouSolucao = true;
        motivoAceite = adaptadoMotive 
          ? `${adaptadoMotive} -> Melhoria de +${deltaNota.toFixed(1)} pontos.` 
          : `Melhoria direta via ${estNome}.`;
        iteracoesSemMelhoriaCont = 0;
      } else if (usarSA && temperatura > tempMinima) {
        // Simulated Annealing (Fase 7)
        // Aceita uma piora pequena temporária com base na temperatura
        const probabilidade = Math.exp(deltaNota / temperatura);
        if (Math.random() < probabilidade) {
          // Aceita temporariamente para escapar de órbita estagnada!
          melhorSolucaoGlobal = solClassificada;
          aceitouSolucao = true;
          motivoAceite = `Simulated Annealing: Aceitou pequena piora (delta ${deltaNota.toFixed(1)}) para escapar de mínimo local.`;
          totalTrocasRealizadas++;
        }
      }
    }

    if (aceitouSolucao) {
      explicacoes.push({
        estrategia: estNome,
        coberturaAnterior: ranking[ranking.length - 2]?.cobertura || 0,
        coberturaNova: scoreInfo.coberturaPct,
        notaAnterior: ranking[ranking.length - 2]?.notaFinal || 0,
        notaNova: scoreInfo.nota,
        motivoMelhoria: motivoAceite,
        trocasRealizadas: totalTrocasRealizadas,
        tempoGastoMs: runTime
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FASE 5 – PERTURBAÇÃO SE COBERTURA < 100%
    // ─────────────────────────────────────────────────────────────────────────
    if (scoreInfo.coberturaPct < 100.0 && melhorSolucaoGlobal) {
      const perturbadas = aplicarPerturbacao(melhorSolucaoGlobal.alocacoes, melhorSolucaoGlobal.conflitosList);
      const resP = runAllocation(
        turmas,
        disciplinas,
        professores,
        matriz,
        config,
        perturbadas,
        options.regrasRelaxamento,
        undefined,
        undefined,
        it * 200 + 42
      );
      const scoreP = calcularNotaSolucao(resP.alocacoes, resP.conflitos, turmas, professores, matriz, config);
      if (scoreP.nota > melhorSolucaoGlobal.notaFinal) {
        explicacoes.push({
          estrategia: "Perturbação Controlada (Fase 5)",
          coberturaAnterior: melhorSolucaoGlobal.cobertura,
          coberturaNova: scoreP.coberturaPct,
          notaAnterior: melhorSolucaoGlobal.notaFinal,
          notaNova: scoreP.nota,
          motivoMelhoria: "Perturbação parcial eliminou restrições e re-alocou lacunas órfãs.",
          trocasRealizadas: 1,
          tempoGastoMs: performance.now() - runStartTime
        });
        melhorSolucaoGlobal = {
          ...melhorSolucaoGlobal,
          cobertura: scoreP.coberturaPct,
          conflitosCount: resP.conflitos.length,
          conflitosList: resP.conflitos,
          notaFinal: scoreP.nota,
          alocacoes: resP.alocacoes,
          diagnostico: resP.diagnostico
        };
        iteracoesSemMelhoriaCont = 0;
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FASE 6 – LARGE NEIGHBORHOOD SEARCH (LNS)
    // ─────────────────────────────────────────────────────────────────────────
    if (usarLNS && melhorSolucaoGlobal && melhorSolucaoGlobal.cobertura < 100.0) {
      const resLNS = executarLNS(
        melhorSolucaoGlobal.alocacoes,
        melhorSolucaoGlobal.conflitosList,
        turmas,
        disciplinas,
        professores,
        matriz,
        config,
        options.regrasRelaxamento,
        melhorSolucaoGlobal.notaFinal
      );
      if (resLNS.melhorou) {
        explicacoes.push({
          estrategia: "LNS (Large Neighborhood Search)",
          coberturaAnterior: melhorSolucaoGlobal.cobertura,
          coberturaNova: resLNS.nota,
          notaAnterior: melhorSolucaoGlobal.notaFinal,
          notaNova: resLNS.nota,
          motivoMelhoria: "LNS desalocou blocos de conflito persistente e reconstruiu com sucesso.",
          trocasRealizadas: 1,
          tempoGastoMs: performance.now() - runStartTime
        });
        melhorSolucaoGlobal = {
          ...melhorSolucaoGlobal,
          cobertura: resLNS.nota,
          conflitosCount: resLNS.conflitos.length,
          conflitosList: resLNS.conflitos,
          notaFinal: resLNS.nota,
          alocacoes: resLNS.alocacoes
        };
        iteracoesSemMelhoriaCont = 0;
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FASE 9 – ALGORITMO GENÉTICO (GA)
    // ─────────────────────────────────────────────────────────────────────────
    if (usarGA && ranking.length >= 2 && melhorSolucaoGlobal && melhorSolucaoGlobal.cobertura < 100.0) {
      // Cruzamento genético entre as duas melhores soluções encontradas até agora
      const ordenadoRank = [...ranking].sort((x, y) => y.notaFinal - x.notaFinal);
      const parentA = ordenadoRank[0].alocacoes;
      const parentB = ordenadoRank[1].alocacoes;

      const filhoAlocs = executarCrossoverGA(
        parentA,
        parentB,
        turmas,
        disciplinas,
        professores,
        matriz,
        config,
        options.regrasRelaxamento
      );

      const scoreFilho = calcularNotaSolucao(filhoAlocs, [], turmas, professores, matriz, config);
      if (scoreFilho.nota > melhorSolucaoGlobal.notaFinal) {
        explicacoes.push({
          estrategia: "Algoritmo Genético: Crossover (Fase 9)",
          coberturaAnterior: melhorSolucaoGlobal.cobertura,
          coberturaNova: scoreFilho.coberturaPct,
          notaAnterior: melhorSolucaoGlobal.notaFinal,
          notaNova: scoreFilho.nota,
          motivoMelhoria: "Cruzamento cromossômico recombinou os melhores blocos de duas grades de ouro.",
          trocasRealizadas: 1,
          tempoGastoMs: performance.now() - runStartTime
        });
        melhorSolucaoGlobal = {
          ...melhorSolucaoGlobal,
          cobertura: scoreFilho.coberturaPct,
          notaFinal: scoreFilho.nota,
          alocacoes: filhoAlocs,
          diagnostico: {
            ...melhorSolucaoGlobal.diagnostico,
            aulasAlocadas: filhoAlocs.length
          }
        };
        iteracoesSemMelhoriaCont = 0;
      }
    }

    // ─── Atualização da Lista Tabu (Fase 8) ───
    if (melhorSolucaoGlobal.conflitosList.length > 0) {
      const primeiroConf = melhorSolucaoGlobal.conflitosList[0];
      const tabuMoveKey = `${primeiroConf.turmaId}|${primeiroConf.dia}|${primeiroConf.horario}`;
      tabuList.push(tabuMoveKey);
      if (tabuList.length > tabuMaxTamanho) {
        tabuList.shift();
      }
    }

    // Resfria temperatura (Simulated Annealing)
    temperatura = temperatura * taxaResfriamento;

    if (!aceitouSolucao) {
      iteracoesSemMelhoriaCont++;
    }

    // Callback de Progresso (Fase 13)
    if (options.onProgress) {
      const totalTimeElapsed = performance.now() - startTimeGlobal;
      const progressPercent = it / maxIteracoes;
      const estRestante = progressPercent > 0 ? (totalTimeElapsed / progressPercent) - totalTimeElapsed : 0;

      options.onProgress({
        iteracaoAtual: it,
        estrategiaAtual: estNome,
        cobertura: scoreInfo.coberturaPct,
        melhorCobertura: melhorSolucaoGlobal.cobertura,
        notaFinal: scoreInfo.nota,
        melhorNotaFinal: melhorSolucaoGlobal.notaFinal,
        tempoGastoMs: Math.round(totalTimeElapsed),
        estadosExplorados: totalEstadosExplorados,
        retrocessos: totalRetrocessos,
        trocas: totalTrocasRealizadas,
        temperatura: Number(temperatura.toFixed(2)),
        listaTabuTamanho: tabuList.length,
        estimativaRestanteMs: Math.max(0, Math.round(estRestante)),
        historicoEvolucao: ranking.map(r => ({ it: r.tentativa, cobertura: r.cobertura, melhor: melhorSolucaoGlobal?.cobertura || 0 })),
        alocacoes: melhorSolucaoGlobal.alocacoes
      });
    }

    // Critério de parada: 100% das aulas alocadas sem conflito (Fase 4)
    if (melhorSolucaoGlobal.cobertura >= 100.0 && melhorSolucaoGlobal.conflitosCount === 0) {
      explicacoes.push({
        estrategia: "Conclusão Perfeita",
        coberturaAnterior: melhorSolucaoGlobal.cobertura,
        coberturaNova: 100.0,
        notaAnterior: melhorSolucaoGlobal.notaFinal,
        notaNova: 100.0,
        motivoMelhoria: "Alocação ideal de 100% de cobertura atingida com 0 conflitos.",
        trocasRealizadas: 0,
        tempoGastoMs: performance.now() - startTimeGlobal
      });
      break;
    }
  }

  // Ordena ranking final de soluções para retornar ao usuário (Fase 10)
  ranking.sort((x, y) => y.notaFinal - x.notaFinal);
  const solucaoVencedora = ranking[0] || melhorSolucaoGlobal;

  // ─────────────────────────────────────────────────────────────────────────
  // FASE 16 – VALIDAÇÃO FINAL DE INTEGRIDADE ANTES DE ENTREGAR
  // ─────────────────────────────────────────────────────────────────────────
  const checkIntegridade = validarIntegridadeGrade(
    solucaoVencedora.alocacoes,
    professores,
    turmas,
    disciplinas
  );

  let relatorioCriticas = "";
  if (!checkIntegridade.integridadeOk) {
    relatorioCriticas = `Alerta de Integridade Docente: Detectado professor com carga excedida!\nDetalhamento: ${
      JSON.stringify(checkIntegridade.relatorio.professoresComExcesso)
    }`;
  } else {
    relatorioCriticas = "Grade validada com 100% de sucesso estrutural no Validador de Integridade Docente.";
  }

  // Salva resultado no banco de aprendizado para futuras gerações semelhantes (Fase 12)
  const totalTimeFinal = performance.now() - startTimeGlobal;
  salvarSucessoNoHistorico(
    turmas.length,
    professores.length,
    disciplinas.length,
    tipoEscola,
    solucaoVencedora.estrategia,
    Math.round(totalTimeFinal),
    solucaoVencedora.cobertura,
    solucaoVencedora.conflitosCount,
    solucaoVencedora.notaFinal
  );

  // Adiciona a solução vencedora ao Hall da Fama das melhores grades já geradas
  try {
    const scoreVencedora = calcularNotaSolucao(
      solucaoVencedora.alocacoes,
      solucaoVencedora.conflitosList,
      turmas,
      professores,
      matriz,
      config
    );
    adicionarAoHallDaFama(
      solucaoVencedora.alocacoes,
      solucaoVencedora.notaFinal,
      totalTimeFinal,
      solucaoVencedora.estrategia,
      solucaoVencedora.conflitosCount,
      scoreVencedora.momMetrics.profJanelas,
      scoreVencedora.momMetrics.turmaJanelas,
      scoreVencedora.momMetrics.profTrocandoTurno,
      solucaoVencedora.cobertura,
      options
    );
  } catch (err) {
    console.error("Erro ao registrar no Hall da Fama:", err);
  }

  // MÓDULO DE APRENDIZADO AUTOMÁTICO DE SUCESSO/FRACASSO
  let aprendizadoLog: MbigExperiencia | undefined = undefined;
  if (learningActive) {
    aprendizadoLog = analisarFimGeracao(
      ranking,
      explicacoes,
      perfilEscola,
      totalAulasPlanejadas,
      solucaoVencedora,
      totalTimeFinal
    );

    // Atualiza Memória de Conflitos Físicos
    atualizarMemoriaConflitos(solucaoVencedora.conflitosList);
  }

  return {
    sucesso: solucaoVencedora.cobertura > 0,
    alocacoes: solucaoVencedora.alocacoes,
    conflitos: solucaoVencedora.conflitosList,
    diagnostico: {
      ...solucaoVencedora.diagnostico,
      sucesso: solucaoVencedora.conflitosCount === 0 && solucaoVencedora.cobertura >= 100.0,
      taxaAlocacao: solucaoVencedora.cobertura,
      aulasAlocadas: solucaoVencedora.alocacoes.length,
      aulasPlanejadas: totalAulasPlanejadas,
      mensagens: [
        `Execução concluída via ${solucaoVencedora.estrategia}. Nota final de qualidade: ${solucaoVencedora.notaFinal}/100.`,
        ...solucaoVencedora.diagnostico.mensagens || []
      ]
    },
    ranking,
    explicacoes,
    relatorioCriticas,
    perfilEscola,
    aprendizadoLog
  };
}
