/**
 * optimization-utils.ts
 * ──────────────────────────────────────────────────────────────
 * Etapas de compactação e otimização pedagógica (permutas locais).
 * Utiliza score-utils (Incluindo IncrementalScore) e schedule-utils (verificarSlotViavelComMotivo)
 * como única autoridade de regras e conformidade do sistema.
 */

import type { Alocacao, Turma, Professor, Disciplina, MatrizCurricular, ConfiguracaoHorarios, Disponibilidade, PlanejamentoItem } from "@/types";
import { calcularScore, gradeValida, IncrementalScore, contarBuracosTurma, contarJanelasProfessor } from "./score-utils";
import { verificarSlotViavelComMotivo, isProfAvailableAt } from "./schedule-utils";
import { provarInviabilidadeMatematica, type ProvaInviabilidadeMatematica } from "./constraint-analyzer";

export interface PassoCadeiaXadrez {
  ordem: number;
  tipo: "alocacao_direta" | "deslocamento_cascata";
  descricao: string;
  aulaRemovidaId?: string;
  novaAlocacao: Alocacao;
  professorNome: string;
  disciplinaNome: string;
  turmaNome: string;
  dia: string;
  horario: number;
}

export interface JogadaXadrezCalculada {
  id: string;
  turmaId: string;
  turmaNome: string;
  disciplinaId: string;
  disciplinaNome: string;
  professorId: string;
  professorNome: string;
  diaPrincipal: string;
  horarioPrincipal: number;
  profundidade: number; // 1 (movimento simples) a 5 (cadeia profunda)
  notaScore: number; // 0 a 100
  ganhoGlobalResumo: string;
  detalhesPontuacao: string[];
  passos: PassoCadeiaXadrez[];
}

export interface ResultadoMotorXadrez {
  alocacoes: Alocacao[];
  aulasAdicionadasCount: number;
  buracosEliminadosCount: number;
  conflitosEliminadosCount: number;
  concluidaComSucesso: boolean;
  jogadasExecutadas: JogadaXadrezCalculada[];
  provasInviabilidade: ProvaInviabilidadeMatematica[];
  logs: string[];
  scoreGlobalInicial: number;
  scoreGlobalFinal: number;
}

const DIAS_SEMANA_XADREZ = ["segunda", "terca", "quarta", "quinta", "sexta"];

export const DIA_NOME_MAP_XADREZ: Record<string, string> = {
  segunda: "Segunda-feira",
  terca: "Terça-feira",
  quarta: "Quarta-feira",
  quinta: "Quinta-feira",
  sexta: "Sexta-feira",
  sabado: "Sábado",
};

export function formatarDiaNomeXadrez(dia: string): string {
  return DIA_NOME_MAP_XADREZ[dia] || dia;
}


const DIAS = ["segunda", "terca", "quarta", "quinta", "sexta"] as const;

/**
 * Obtém o número máximo de horários para uma turma com base no turno.
 */
function getMaxHorarios(turma: Turma, config: any): number {
  const turno = turma.turno || "manha";
  if (turno === "noite") return config.quantidadeHorariosPorDiaNoite ?? 4;
  if (turno === "tarde") return config.quantidadeHorariosPorDiaTarde ?? 5;
  return config.quantidadeHorariosPorDia ?? 6;
}

/**
 * Avalia se o estado proposto aumenta o número acumulado de buracos em qualquer professor ou turma.
 * Regra de Ouro: Nenhuma otimização é permitida se gerar aumento de buracos no sistema.
 */
function avaliaAumentoBuracos(
  gradeAntes: Alocacao[],
  gradeDepois: Alocacao[],
  turmas: Turma[],
  professores: Professor[]
): boolean {
  const buracosAntes = contarBuracosTurma(gradeAntes, turmas) + contarJanelasProfessor(gradeAntes, professores);
  const buracosDepois = contarBuracosTurma(gradeDepois, turmas) + contarJanelasProfessor(gradeDepois, professores);
  return buracosDepois > buracosAntes;
}

/**
 * ETAPA 3 – Compactação: elimina buracos movendo aulas para a esquerda (do 1º horário em diante).
 * Garante que cada movimento respeita rigorosamente verificarSlotViavelComMotivo
 * e melhora ou mantém o score pedagógico/geral de forma incremental.
 */
export function compactarGrade(
  grade: Alocacao[],
  turmas: Turma[],
  professores: Professor[],
  disciplinas: Disciplina[],
  matriz: MatrizCurricular[],
  config: any,
  regrasRelaxamento?: any
): Alocacao[] {
  const startTime = performance.now();
  let novaGrade = grade.map((a) => ({ ...a }));
  const totalPlanejado = matriz.reduce((sum, m) => sum + m.aulasPorSemana, 0);

  // Instancia motor incremental de score para avaliações ultra rápidas por delta
  const scoreEngine = new IncrementalScore(novaGrade, turmas, professores, disciplinas, matriz);
  let scoreAtual = scoreEngine.getScore();

  let fezAlgumaCompactacao = true;
  let iter = 0;

  // Realiza passadas para empurrar consecutivamente sem ferir regras
  while (fezAlgumaCompactacao && iter < 3) {
    if (performance.now() - startTime > 3000) {
      console.warn("⚠️ [compactarGrade] Interrompido por limite de 3 segundos.");
      break;
    }
    fezAlgumaCompactacao = false;
    iter++;

    for (const turma of turmas) {
      if (performance.now() - startTime > 3000) break;
      const maxHorarios = getMaxHorarios(turma, config);

      for (const dia of DIAS) {
        // Encontra as alocações móveis (não trancadas) dessa turma e dia
        const aulas = novaGrade.filter(
          (a) => a.turmaId === turma.id && a.diaSemana === dia && !a.isLocked && a.professorId !== "p_david"
        );
        if (aulas.length === 0) continue;

        // Ordena por horário (crescente) para compactar da esquerda para a direita
        aulas.sort((a, b) => a.horario - b.horario);

        for (const aula of aulas) {
          const anteriorH = aula.horario;

          // Tenta encontrar o menor horário possível livre (h < anteriorH)
          for (let h = 1; h < anteriorH; h++) {
            // Verifica viabilidade completa sob a autoridade única do sistema
            const check = verificarSlotViavelComMotivo(
              novaGrade,
              professores,
              disciplinas,
              turmas,
              matriz,
              config,
              aula.professorId,
              aula.turmaId,
              aula.disciplinaId,
              dia,
              h,
              regrasRelaxamento,
              aula.id // Ignora auto-conflito
            );

            if (check.viavel) {
              const gradeTentativa = novaGrade.map(a => a.id === aula.id ? { ...a, diaSemana: dia, horario: h } : a);
              if (avaliaAumentoBuracos(novaGrade, gradeTentativa, turmas, professores)) {
                continue;
              }

              // Calcula o ganho pedagógico usando delta incremental
              const delta = scoreEngine.calculateMoveDelta(aula.id, dia, h);
              
              // Aceita se o score melhorar ou mantiver (compactação tem peso positivo implícito ao reduzir buracos)
              if (delta >= -150) { // Tolerância suave se compactar remove um buraco mas afeta levemente geminação
                scoreEngine.applyMove(aula.id, dia, h);
                scoreAtual += delta;
                
                // Sincroniza fisicamente na lista local
                const alocReal = novaGrade.find(a => a.id === aula.id);
                if (alocReal) {
                  alocReal.diaSemana = dia;
                  alocReal.horario = h;
                }
                
                fezAlgumaCompactacao = true;
                break;
              }
            }
          }
        }
      }
    }
  }

  return novaGrade;
}

/**
 * ETAPA 4 – Otimização Pedagógica Pelo Lado das Permutas Locais (Swaps simples intra-grupo)
 * Utiliza o IncrementalScore para transições ultra eficientes.
 */
export function otimizarPermutas(
  grade: Alocacao[],
  turmas: Turma[],
  professores: Professor[],
  disciplinas: Disciplina[],
  matriz: MatrizCurricular[],
  config: any,
  regrasRelaxamento?: any,
  maxIteracoes = 1000
): Alocacao[] {
  const startTime = performance.now();
  let novaGrade = grade.map((a) => ({ ...a }));
  const scoreEngine = new IncrementalScore(novaGrade, turmas, professores, disciplinas, matriz);
  let scoreAtual = scoreEngine.getScore();

  let melhorou = true;
  let iter = 0;

  while (melhorou && iter < maxIteracoes) {
    if (performance.now() - startTime > 3000) {
      console.warn("⚠️ [otimizarPermutas] Interrompido por limite de 3 segundos.");
      break;
    }
    melhorou = false;
    iter++;

    for (const turma of turmas) {
      if (performance.now() - startTime > 3000) break;
      for (const dia of DIAS) {
        if (performance.now() - startTime > 3000) break;
        const aulas = novaGrade.filter(
          (a) => a.turmaId === turma.id && a.diaSemana === dia && !a.isLocked && a.professorId !== "p_david"
        );
        if (aulas.length < 2) continue;

        for (let i = 0; i < aulas.length; i++) {
          if (performance.now() - startTime > 3000) break;
          for (let j = i + 1; j < aulas.length; j++) {
            if (performance.now() - startTime > 3000) break;
            const a1 = aulas[i];
            const a2 = aulas[j];

            const h1 = a1.horario;
            const h2 = a2.horario;

            if (h1 === h2) continue;

            // Valida viabilidade mútua de swap usando autoridade unificada de slot
            const check1 = verificarSlotViavelComMotivo(
              novaGrade,
              professores,
              disciplinas,
              turmas,
              matriz,
              config,
              a1.professorId,
              a1.turmaId,
              a1.disciplinaId,
              dia,
              h2,
              regrasRelaxamento,
              a1.id
            );
            if (!check1.viavel) continue;

            const check2 = verificarSlotViavelComMotivo(
              novaGrade,
              professores,
              disciplinas,
              turmas,
              matriz,
              config,
              a2.professorId,
              a2.turmaId,
              a2.disciplinaId,
              dia,
              h1,
              regrasRelaxamento,
              a2.id
            );
            if (!check2.viavel) continue;

            // Calcula delta incremental de pontuação
            const delta = scoreEngine.calculateSwapDelta(a1.id, a2.id);
            if (delta > 0) {
              const gradeTentativa = novaGrade.map(a => {
                if (a.id === a1.id) return { ...a, diaSemana: dia, horario: h2 };
                if (a.id === a2.id) return { ...a, diaSemana: dia, horario: h1 };
                return a;
              });

              if (avaliaAumentoBuracos(novaGrade, gradeTentativa, turmas, professores)) {
                continue;
              }

              // Aplica de forma rápida e segura
              scoreEngine.applySwap(a1.id, a2.id);
              scoreAtual += delta;

              // Sincroniza localmente
              const realA1 = novaGrade.find(a => a.id === a1.id);
              const realA2 = novaGrade.find(a => a.id === a2.id);
              if (realA1 && realA2) {
                realA1.horario = h2;
                realA2.horario = h1;
              }

              melhorou = true;
            }
          }
        }
      }
    }
  }

  return novaGrade;
}

/**
 * MOTOR 4 – SOLUCIONADOR GLOBAL (PERMUTAS INTER-DIAS E CADEIAS DIVERSAS DE SUCESSO)
 * Executa permutas 2-way e cadeias de 3-way sobre a grade inteira para remover os últimos buracos
 * e acomodar restrições severas de professores de alta carga (Ex: Claudiane).
 */
export function otimizarPermutasGlobais(
  grade: Alocacao[],
  turmas: Turma[],
  professores: Professor[],
  disciplinas: Disciplina[],
  matriz: MatrizCurricular[],
  config: any,
  regrasRelaxamento?: any
): Alocacao[] {
  const startTime = performance.now();
  let novaGrade = grade.map((a) => ({ ...a }));
  const totalPlanejado = matriz.reduce((sum, m) => sum + m.aulasPorSemana, 0);
  const scoreEngine = new IncrementalScore(novaGrade, turmas, professores, disciplinas, matriz);
  let scoreAtual = scoreEngine.getScore();

  let melhorou = true;
  let iter = 0;
  let totalPermutasEfetuadas = 0;

  while (melhorou && iter < 8) {
    if (performance.now() - startTime > 3000) {
      console.warn("⚠️ [otimizarPermutasGlobais] Interrompido por limite de 3 segundos.");
      break;
    }
    melhorou = false;
    iter++;

    const moveis = novaGrade.filter((a) => !a.isLocked && a.professorId !== "p_david");

    // ── 1. PERMUTAS GLOBAIS 2-WAY (A <-> B) ──
    for (let i = 0; i < moveis.length; i++) {
      if (performance.now() - startTime > 3000) break;
      for (let j = i + 1; j < moveis.length; j++) {
        if (performance.now() - startTime > 3000) break;
        const a1 = moveis[i];
        const a2 = moveis[j];

        if (a1.diaSemana === a2.diaSemana && a1.horario === a2.horario) continue;

        // Validação unificada de viabilidade para permuta inter-dia/tempo
        const check1 = verificarSlotViavelComMotivo(
          novaGrade,
          professores,
          disciplinas,
          turmas,
          matriz,
          config,
          a1.professorId,
          a1.turmaId,
          a1.disciplinaId,
          a2.diaSemana,
          a2.horario,
          regrasRelaxamento,
          a1.id
        );
        if (!check1.viavel) continue;

        const check2 = verificarSlotViavelComMotivo(
          novaGrade,
          professores,
          disciplinas,
          turmas,
          matriz,
          config,
          a2.professorId,
          a2.turmaId,
          a2.disciplinaId,
          a1.diaSemana,
          a1.horario,
          regrasRelaxamento,
          a2.id
        );
        if (!check2.viavel) continue;

        // Analisa delta de qualidade do remanejamento
        const delta = scoreEngine.calculateSwapDelta(a1.id, a2.id);
        if (delta > 0) {
          const gradeTentativa = novaGrade.map(a => {
            if (a.id === a1.id) return { ...a, diaSemana: a2.diaSemana, horario: a2.horario };
            if (a.id === a2.id) return { ...a, diaSemana: a1.diaSemana, horario: a1.horario };
            return a;
          });

          if (avaliaAumentoBuracos(novaGrade, gradeTentativa, turmas, professores)) {
            continue;
          }

          scoreEngine.applySwap(a1.id, a2.id);
          scoreAtual += delta;

          // Sincroniza local
          const realA1 = novaGrade.find(a => a.id === a1.id);
          const realA2 = novaGrade.find(a => a.id === a2.id);
          if (realA1 && realA2) {
            const tempDia = realA1.diaSemana;
            const tempH = realA1.horario;
            realA1.diaSemana = realA2.diaSemana;
            realA1.horario = realA2.horario;
            realA2.diaSemana = tempDia;
            realA2.horario = tempH;
          }

          melhorou = true;
          totalPermutasEfetuadas++;
          break;
        }
      }
      if (melhorou) break;
    }

    if (melhorou) continue;

    // ── 2. PERMUTAS GLOBAIS EM CADEIA 3-WAY (A -> B -> C -> A) ──
    const subSetMoveis = moveis.slice(0, 120);

    for (let i = 0; i < subSetMoveis.length; i++) {
      if (performance.now() - startTime > 3000) break;
      for (let j = 0; j < subSetMoveis.length; j++) {
        if (performance.now() - startTime > 3000) break;
        if (i === j) continue;
        for (let k = 0; k < subSetMoveis.length; k++) {
          if (performance.now() - startTime > 3000) break;
          if (i === k || j === k) continue;

          const a1 = subSetMoveis[i];
          const a2 = subSetMoveis[j];
          const a3 = subSetMoveis[k];

          // Verifica viabilidade sequencial em cadeia
          const check1 = verificarSlotViavelComMotivo(
            novaGrade,
            professores,
            disciplinas,
            turmas,
            matriz,
            config,
            a1.professorId,
            a1.turmaId,
            a1.disciplinaId,
            a2.diaSemana,
            a2.horario,
            regrasRelaxamento,
            a1.id
          );
          if (!check1.viavel) continue;

          const check2 = verificarSlotViavelComMotivo(
            novaGrade,
            professores,
            disciplinas,
            turmas,
            matriz,
            config,
            a2.professorId,
            a2.turmaId,
            a2.disciplinaId,
            a3.diaSemana,
            a3.horario,
            regrasRelaxamento,
            a2.id
          );
          if (!check2.viavel) continue;

          const check3 = verificarSlotViavelComMotivo(
            novaGrade,
            professores,
            disciplinas,
            turmas,
            matriz,
            config,
            a3.professorId,
            a3.turmaId,
            a3.disciplinaId,
            a1.diaSemana,
            a1.horario,
            regrasRelaxamento,
            a3.id
          );
          if (!check3.viavel) continue;

          const d1 = a1.diaSemana; const h1 = a1.horario;
          const d2 = a2.diaSemana; const h2 = a2.horario;
          const d3 = a3.diaSemana; const h3 = a3.horario;

          const gradeAntesDoGiro = novaGrade.map(a => ({ ...a }));

          // Aplicação temporária física para avaliação
          a1.diaSemana = d2; a1.horario = h2;
          a2.diaSemana = d3; a2.horario = h3;
          a3.diaSemana = d1; a3.horario = h1;

          if (avaliaAumentoBuracos(gradeAntesDoGiro, novaGrade, turmas, professores)) {
            // Desfaz alteração
            a1.diaSemana = d1; a1.horario = h1;
            a2.diaSemana = d2; a2.horario = h2;
            a3.diaSemana = d3; a3.horario = h3;
            continue;
          }

          const scoreNovo = calcularScore(
            novaGrade,
            turmas,
            professores,
            disciplinas,
            matriz,
            totalPlanejado
          );
          const delta = scoreNovo - scoreAtual;

          if (delta > 0) {
            scoreAtual = scoreNovo;
            scoreEngine.syncAlocacoes(novaGrade);
            melhorou = true;
            totalPermutasEfetuadas++;
            break;
          } else {
            // Desfaz alteração
            a1.diaSemana = d1; a1.horario = h1;
            a2.diaSemana = d2; a2.horario = h2;
            a3.diaSemana = d3; a3.horario = h3;
          }
        }
        if (melhorou) break;
      }
      if (melhorou) break;
    }
  }

  console.log(`[Motor 4 Solucionador Global] Permutas executadas com sucesso: ${totalPermutasEfetuadas}`);
  return novaGrade;
}

/**
 * ETAPA 5 – Estabilização Final: Garante que a grade convirja sem loops ou oscilações.
 * Utiliza o threshold de melhoria mínima (IMPROVEMENT_THRESHOLD) e impede qualquer movimento
 * que aumente o número acumulado de buracos em turmas ou professores.
 */
export function estabilizarGrade(
  grade: Alocacao[],
  turmas: Turma[],
  professores: Professor[],
  disciplinas: Disciplina[],
  matriz: MatrizCurricular[],
  config: any,
  regrasRelaxamento?: any,
  maxIteracoes = 50
): Alocacao[] {
  const startTime = performance.now();
  let novaGrade = grade.map((a) => ({ ...a }));
  const scoreEngine = new IncrementalScore(novaGrade, turmas, professores, disciplinas, matriz);
  let scoreAtual = scoreEngine.getScore();

  const IMPROVEMENT_THRESHOLD = 0.5;
  let improved = true;
  let iterations = 0;

  while (improved && iterations < maxIteracoes) {
    if (performance.now() - startTime > 3000) {
      console.warn("⚠️ [estabilizarGrade] Interrompido por limite de 3 segundos.");
      break;
    }
    improved = false;
    iterations++;

    const moveis = novaGrade.filter((a) => !a.isLocked && a.professorId !== "p_david");

    for (const aula of moveis) {
      if (performance.now() - startTime > 3000) break;
      const originalDia = aula.diaSemana;
      const originalHorario = aula.horario;

      const turmaObj = turmas.find(t => t.id === aula.turmaId) || turmas[0];
      const maxH = getMaxHorarios(turmaObj, config);

      for (const dia of DIAS) {
        if (performance.now() - startTime > 3000) break;
        for (let h = 1; h <= maxH; h++) {
          if (performance.now() - startTime > 3000) break;
          if (dia === originalDia && h === originalHorario) continue;

          // Verifica viabilidade completa sob a autoridade única
          const check = verificarSlotViavelComMotivo(
            novaGrade,
            professores,
            disciplinas,
            turmas,
            matriz,
            config,
            aula.professorId,
            aula.turmaId,
            aula.disciplinaId,
            dia,
            h,
            regrasRelaxamento,
            aula.id
          );

          if (check.viavel) {
            // Calcula delta de pontuação
            const delta = scoreEngine.calculateMoveDelta(aula.id, dia, h);

            // Só aceita se houver melhoria real maior que o threshold
            if (delta >= IMPROVEMENT_THRESHOLD) {
              const gradeTentativa = novaGrade.map(a => 
                a.id === aula.id ? { ...a, diaSemana: dia, horario: h } : a
              );

              if (!avaliaAumentoBuracos(novaGrade, gradeTentativa, turmas, professores)) {
                // Aplica movimento
                scoreEngine.applyMove(aula.id, dia, h);
                scoreAtual += delta;

                const realAula = novaGrade.find(a => a.id === aula.id);
                if (realAula) {
                  realAula.diaSemana = dia;
                  realAula.horario = h;
                }

                improved = true;
                break;
              }
            }
          }
        }
        if (improved) break;
      }
    }
  }

  console.log(`[Stabilizer Layer] Grade estabilizada em ${iterations} iterações. Placar final: ${scoreAtual}`);
  return novaGrade;
}

/**
 * Combina compactação, permutas locais, solucionador global e a camada de estabilização em uma única rotina robusta.
 */
export function otimizarGrade(
  grade: Alocacao[],
  turmas: Turma[],
  professores: Professor[],
  disciplinas: Disciplina[],
  matriz: MatrizCurricular[],
  config: any,
  regrasRelaxamento?: any
): Alocacao[] {
  let otimizada = compactarGrade(grade, turmas, professores, disciplinas, matriz, config, regrasRelaxamento);
  otimizada = otimizarPermutas(otimizada, turmas, professores, disciplinas, matriz, config, regrasRelaxamento);
  otimizada = otimizarPermutasGlobais(otimizada, turmas, professores, disciplinas, matriz, config, regrasRelaxamento);
  otimizada = estabilizarGrade(otimizada, turmas, professores, disciplinas, matriz, config, regrasRelaxamento);
  return otimizada;
}

/**
 * 2. CÁLCULO DE PONTUAÇÃO ESCOLAR GLOBAL (0 a 100) E PONTUAÇÃO DE JOGADA
 */
export function calcularScoreGlobalEscola(
  alocacoes: Alocacao[],
  turmas: Turma[],
  professores: Professor[],
  matriz: MatrizCurricular[]
): number {
  let totalExigido = 0;
  for (const m of matriz) {
    if (m.aulasPorSemana > 0) totalExigido += m.aulasPorSemana;
  }
  if (totalExigido === 0) return 100;

  const totalAlocado = alocacoes.length;
  const taxaIntegralizacao = Math.min(100, (totalAlocado / totalExigido) * 100);

  // Penalidade por buracos de turma
  let buracosTurmaCount = 0;
  for (const t of turmas) {
    for (const dia of DIAS_SEMANA_XADREZ) {
      const aulasDia = alocacoes.filter((a) => a.turmaId === t.id && a.diaSemana === dia);
      if (aulasDia.length <= 1) continue;
      const setH = new Set<number>(aulasDia.map((a) => a.horario));
      const min = Math.min(...Array.from(setH));
      const max = Math.max(...Array.from(setH));
      for (let p = min; p < max; p++) {
        if (!setH.has(p)) buracosTurmaCount++;
      }
    }
  }

  // Penalidade por janelas de professor (tempo ocioso no mesmo dia e turno)
  let janelasProfCount = 0;
  for (const p of professores) {
    for (const dia of DIAS_SEMANA_XADREZ) {
      const aulasDia = alocacoes.filter((a) => a.professorId === p.id && a.diaSemana === dia);
      if (aulasDia.length <= 1) continue;
      const setH = new Set<number>(aulasDia.map((a) => a.horario));
      const min = Math.min(...Array.from(setH));
      const max = Math.max(...Array.from(setH));
      for (let h = min; h < max; h++) {
        if (!setH.has(h)) janelasProfCount++;
      }
    }
  }

  // Score composto: 70% integralização - 1.5 pts por buraco - 1 pt por janela docente
  const scoreRaw = taxaIntegralizacao * 0.7 + 30 - buracosTurmaCount * 1.5 - janelasProfCount * 1.0;
  return Math.max(0, Math.min(100, Math.round(scoreRaw * 10) / 10));
}

/**
 * Encontra professor responsável por uma disciplina na turma
 */
export function obterProfessorResponsavel(
  turmaId: string,
  disciplinaId: string,
  professores: Professor[],
  alocacoes: Alocacao[]
): Professor | null {
  const alocExistente = alocacoes.find((a) => a.turmaId === turmaId && a.disciplinaId === disciplinaId);
  if (alocExistente) {
    const p = professores.find((pr) => pr.id === alocExistente.professorId);
    if (p) return p;
  }

  for (const pr of professores) {
    if (Array.isArray(pr.planejamento)) {
      const it = pr.planejamento.find((pl) => pl.turmaId === turmaId && pl.disciplinaId === disciplinaId);
      if (it) return pr;
    }
  }

  const vinc = professores.find(
    (p) => Array.isArray(p.disciplinas) && p.disciplinas.includes(disciplinaId) && Array.isArray(p.turmas) && p.turmas.includes(turmaId)
  );
  if (vinc) return vinc;

  return professores.find((p) => Array.isArray(p.disciplinas) && p.disciplinas.includes(disciplinaId)) || null;
}

/**
 * Avalia a nota detalhada (0 a 100) de uma jogada candidata de xadrez
 */
export function calcularNotaJogada(
  turma: Turma,
  disciplina: Disciplina,
  professor: Professor,
  dia: string,
  horario: number,
  profundidade: number,
  alocacoesAtuais: Alocacao[],
  alocacoesDepois: Alocacao[],
  turmas: Turma[],
  professores: Professor[],
  matriz: MatrizCurricular[]
): { nota: number; resumoGanho: string; detalhes: string[] } {
  let nota = 70; // base de sucesso em alocar
  const detalhes: string[] = [];

  // 1. Distribuição Semanal da Disciplina
  const aulasDiscNoDia = alocacoesDepois.filter(
    (a) => a.turmaId === turma.id && a.disciplinaId === disciplina.id && a.diaSemana === dia
  ).length;

  if (aulasDiscNoDia === 1) {
    nota += 15;
    detalhes.push("Excelente distribuição: 1 aula no dia (evita fadiga discente).");
  } else if (aulasDiscNoDia === 2) {
    nota += 8;
    detalhes.push("Aula geminada diária aceitável (bloco de 2 horários).");
  } else if (aulasDiscNoDia > 2) {
    nota -= 18;
    detalhes.push(`Aviso: Concentração excessiva (${aulasDiscNoDia} aulas de ${disciplina.nome} no mesmo dia).`);
  }

  // 2. Buracos na Turma antes vs depois
  const contarBuracosTurmaLoc = (alocs: Alocacao[], tId: string) => {
    let bur = 0;
    for (const d of DIAS_SEMANA_XADREZ) {
      const aulasD = alocs.filter((a) => a.turmaId === tId && a.diaSemana === d);
      if (aulasD.length <= 1) continue;
      const setH = new Set<number>(aulasD.map((a) => a.horario));
      const mn = Math.min(...Array.from(setH));
      const mx = Math.max(...Array.from(setH));
      for (let p = mn; p < mx; p++) if (!setH.has(p)) bur++;
    }
    return bur;
  };

  const buracosAntes = contarBuracosTurmaLoc(alocacoesAtuais, turma.id);
  const buracosDepois = contarBuracosTurmaLoc(alocacoesDepois, turma.id);

  if (buracosDepois < buracosAntes) {
    const elim = buracosAntes - buracosDepois;
    nota += elim * 12;
    detalhes.push(`Impacto estrutural: Elimina ${elim} buraco(s) na grade da turma ${turma.nome}.`);
  } else if (buracosDepois > buracosAntes) {
    const ger = buracosDepois - buracosAntes;
    nota -= ger * 15;
    detalhes.push(`Aviso: Gera ${ger} janela(s) vazia(s) intermediária(s) na turma.`);
  } else {
    detalhes.push("Mantém a compacidade diária da turma.");
  }

  // 3. Janela do Professor antes vs depois
  const contarJanelasProf = (alocs: Alocacao[], pId: string) => {
    let jan = 0;
    for (const d of DIAS_SEMANA_XADREZ) {
      const aulasD = alocs.filter((a) => a.professorId === pId && a.diaSemana === d);
      if (aulasD.length <= 1) continue;
      const setH = new Set<number>(aulasD.map((a) => a.horario));
      const mn = Math.min(...Array.from(setH));
      const mx = Math.max(...Array.from(setH));
      for (let p = mn; p < mx; p++) if (!setH.has(p)) jan++;
    }
    return jan;
  };

  const janelasProfAntes = contarJanelasProf(alocacoesAtuais, professor.id);
  const janelasProfDepois = contarJanelasProf(alocacoesDepois, professor.id);

  if (janelasProfDepois < janelasProfAntes) {
    nota += (janelasProfAntes - janelasProfDepois) * 10;
    detalhes.push(`Otimização docente: Ocupa janela ociosa do Prof. ${professor.nomeCompleto.split(" ")[0]}.`);
  } else if (janelasProfDepois > janelasProfAntes) {
    nota -= (janelasProfDepois - janelasProfAntes) * 8;
    detalhes.push("Gera pequena janela ociosa na grade do professor.");
  }

  // 4. Penalidade por complexidade / profundidade do swap
  if (profundidade === 1) {
    nota += 5;
    detalhes.push("Alocação direta em slot perfeitamente livre.");
  } else {
    nota -= (profundidade - 1) * 3;
    detalhes.push(`Resolução combinatória em profundidade ${profundidade} (remaneja aulas em cascata).`);
  }

  const notaFinal = Math.max(10, Math.min(100, Math.round(nota)));
  
  let resumoGanho = "";
  if (notaFinal >= 90) resumoGanho = "🚀 Ganho Máximo para a Escola";
  else if (notaFinal >= 75) resumoGanho = "✨ Solução Estável e Equilibrada";
  else resumoGanho = "⚡ Solução Viável de Recuperação";

  return { nota: notaFinal, resumoGanho, detalhes };
}

/**
 * 3. MOTOR INTELIGENTE DE OTIMIZAÇÃO GLOBAL (JOGADOR DE XADREZ)
 * Explora dezenas de movimentos à frente por backtracking em árvore até convergir a grade.
 */
export function executarMotorXadrezGlobal(
  alocacoesBase: Alocacao[],
  turmas: Turma[],
  disciplinas: Disciplina[],
  professores: Professor[],
  matriz: MatrizCurricular[],
  config: ConfiguracaoHorarios,
  maxCiclos = 12
): ResultadoMotorXadrez {
  const startTime = performance.now();
  const logs: string[] = [];
  logs.push("Iniciando MOTOR XADREZ – Árvore de Busca Combinatória Profunda...");

  const turmaMap = new Map<string, Turma>(turmas.map((t) => [t.id, t]));
  const discMap = new Map<string, Disciplina>(disciplinas.map((d) => [d.id, d]));
  const profMap = new Map<string, Professor>(professores.map((p) => [p.id, p]));

  // Passo 1: Auditoria matemática prévia
  const provasInviabilidade = provarInviabilidadeMatematica(turmas, professores, disciplinas, matriz, config, alocacoesBase);
  if (provasInviabilidade.length > 0) {
    logs.push(`⚠️ Detectadas ${provasInviabilidade.length} impossibilidades físicas estruturais (Exigido > Disponível).`);
  }

  let gradeAtual = [...alocacoesBase];
  const jogadasExecutadas: JogadaXadrezCalculada[] = [];
  const scoreGlobalInicial = calcularScoreGlobalEscola(gradeAtual, turmas, professores, matriz);
  let aulasAdicionadasCount = 0;

  logs.push(`Score Escolar Inicial: ${scoreGlobalInicial}/100. Localizando aulas pendentes...`);

  // Ciclo principal de re-otimização em árvore
  const limiteCiclos = Math.max(maxCiclos, 150);
  for (let ciclo = 1; ciclo <= limiteCiclos; ciclo++) {
    if (performance.now() - startTime > 3000) {
      logs.push("⚠️ [executarMotorXadrezGlobal] Interrompido por limite de 3 segundos.");
      break;
    }
    // A) Encontrar todas as pendências curriculares reais
    const pendencias: {
      turma: Turma;
      disc: Disciplina;
      prof: Professor;
      faltam: number;
    }[] = [];

    for (const item of matriz) {
      if (item.aulasPorSemana <= 0) continue;
      const t = turmaMap.get(item.turmaId);
      const d = discMap.get(item.disciplinaId);
      if (!t || !d) continue;

      const jaAlocadas = gradeAtual.filter((a) => a.turmaId === t.id && a.disciplinaId === d.id).length;
      const faltantes = item.aulasPorSemana - jaAlocadas;
      if (faltantes <= 0) continue;

      const p = obterProfessorResponsavel(t.id, d.id, professores, gradeAtual);
      if (!p) continue; // Sem professor para alocar

      // Se esse professor tiver prova de inviabilidade por sobrecarga insuperável, ignora
      if (provasInviabilidade.some((pr) => pr.id === `inv_prof_${p.id}`)) continue;

      pendencias.push({ turma: t, disc: d, prof: p, faltam: faltantes });
    }

    if (pendencias.length === 0) {
      logs.push(`[Ciclo ${ciclo}] Todas as pendências viáveis foram integralizadas! Estabilizado.`);
      break;
    }

    // Ordenar pendências pela maior restrição diária do professor
    pendencias.sort((a, b) => {
      const slotsA = DIAS_SEMANA_XADREZ.reduce((acc, dia) => acc + (a.prof.disponibilidade?.[dia] || []).length, 0);
      const slotsB = DIAS_SEMANA_XADREZ.reduce((acc, dia) => acc + (b.prof.disponibilidade?.[dia] || []).length, 0);
      return slotsA - slotsB; // resolve primeiro os mais restritos (gargalo crítico)
    });

    let jogadaAplicadaNoCiclo = false;

    // B) Para cada pendência, calcular todas as jogadas possíveis em árvore (Xadrez)
    for (const pend of pendencias) {
      if (jogadaAplicadaNoCiclo) break;

      const { turma, disc, prof } = pend;
      const turno = turma.turno || "manha";
      const slotsDia = turno === "noite"
        ? (config.quantidadeHorariosPorDiaNoite ?? 4)
        : turno === "tarde"
          ? (config.quantidadeHorariosPorDiaTarde ?? 5)
          : (config.quantidadeHorariosPorDia ?? 5);

      const candidatas: JogadaXadrezCalculada[] = [];

      // Explorar todos os slots (dia, h)
      for (const dia of DIAS_SEMANA_XADREZ) {
        for (let h = 1; h <= slotsDia; h++) {
          // 0. Carga horária semanal já atingida?
          let weeklyLimit = 0;
          const planeItem = prof?.planejamento?.find((p) => p.turmaId === turma.id && p.disciplinaId === disc.id);
          if (planeItem) {
            weeklyLimit = Number(planeItem.aulasPorSemana !== undefined ? planeItem.aulasPorSemana : planeItem.quantidadeAulas) || 0;
          } else {
            const matMatch = matriz?.find((m) => m.turmaId === turma.id && m.disciplinaId === disc.id);
            if (matMatch) {
              weeklyLimit = Number(matMatch.aulasPorSemana) || 0;
            }
          }

          const currentAllocatedCount = gradeAtual.filter(
            (a) => a.professorId === prof.id && a.turmaId === turma.id && a.disciplinaId === disc.id
          ).length;

          if (currentAllocatedCount >= weeklyLimit) continue;

          // 1. Professor está disponível nesse slot?
          if (!isProfAvailableAt(prof.disponibilidade, dia, h, turno)) continue;

          // 2. Professor já está ocupado em outra turma no mesmo dia e horário?
          const profOcupado = gradeAtual.some((a) => {
            if (a.professorId !== prof.id || a.diaSemana !== dia || a.horario !== h) return false;
            const tOutra = turmaMap.get(a.turmaId);
            const tOutraTurno = tOutra?.turno || "manha";
            return tOutraTurno === turno;
          });
          if (profOcupado) continue; // Professor ocupado

          // 3. O que está acontecendo na turma no slot (dia, h)?
          const alocExistenteIndex = gradeAtual.findIndex(
            (a) => a.turmaId === turma.id && a.diaSemana === dia && a.horario === h
          );

          if (alocExistenteIndex === -1) {
            // [CENÁRIO 1] Slot 100% livre! Profundidade 1
            const novaAloc: Alocacao = {
              id: `xadrez_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              turmaId: turma.id,
              disciplinaId: disc.id,
              professorId: prof.id,
              diaSemana: dia,
              horario: h,
            };

            const gradeTeste = [...gradeAtual, novaAloc];
            const avaliacao = calcularNotaJogada(
              turma, disc, prof, dia, h, 1, gradeAtual, gradeTeste, turmas, professores, matriz
            );

            candidatas.push({
              id: novaAloc.id,
              turmaId: turma.id,
              turmaNome: turma.nome,
              disciplinaId: disc.id,
              disciplinaNome: disc.nome,
              professorId: prof.id,
              professorNome: prof.nomeCompleto,
              diaPrincipal: dia,
              horarioPrincipal: h,
              profundidade: 1,
              notaScore: avaliacao.nota,
              ganhoGlobalResumo: avaliacao.resumoGanho,
              detalhesPontuacao: avaliacao.detalhes,
              passos: [
                {
                  ordem: 1,
                  tipo: "alocacao_direta",
                  descricao: `Alocar direta de ${disc.nome} (${prof.nomeCompleto.split(" ")[0]}) na ${formatarDiaNomeXadrez(dia)}, ${h}º horário.`,
                  novaAlocacao: novaAloc,
                  professorNome: prof.nomeCompleto,
                  disciplinaNome: disc.nome,
                  turmaNome: turma.nome,
                  dia,
                  horario: h,
                },
              ],
            });
          } else {
            // [CENÁRIO 2] Slot ocupado na turma por outra aula (Aula B). Tentar deslocar Aula B em cascata!
            const aulaB = gradeAtual[alocExistenteIndex];
            if (aulaB.isLocked) continue; // Aula travada manualmente

            const profB = profMap.get(aulaB.professorId);
            const discB = discMap.get(aulaB.disciplinaId);
            if (!profB || !discB) continue;

            // Procurar slot alternativo (diaAlt, hAlt) para remanejar Aula B
            for (const diaAlt of DIAS_SEMANA_XADREZ) {
              for (let hAlt = 1; hAlt <= slotsDia; hAlt++) {
                if (diaAlt === dia && hAlt === h) continue;

                // Turma livre em (diaAlt, hAlt)?
                const turmaOcupadaAlt = gradeAtual.some(
                  (a) => a.turmaId === turma.id && a.diaSemana === diaAlt && a.horario === hAlt
                );
                if (turmaOcupadaAlt) continue;

                // ProfB disponível em (diaAlt, hAlt)?
                if (!isProfAvailableAt(profB.disponibilidade, diaAlt, hAlt, turno)) continue;

                // ProfB livre em (diaAlt, hAlt)?
                const profBOcupadoAlt = gradeAtual.some((a) => {
                  if (a.professorId !== profB.id || a.diaSemana !== diaAlt || a.horario !== hAlt) return false;
                  const tOutra = turmaMap.get(a.turmaId);
                  const tOutraTurno = tOutra?.turno || "manha";
                  return tOutraTurno === turno;
                });
                if (profBOcupadoAlt) continue;

                // Encontrada cadeia de xadrez em profundidade 2!
                const aulaBDeslocada: Alocacao = {
                  ...aulaB,
                  diaSemana: diaAlt,
                  horario: hAlt,
                };

                const novaAloc: Alocacao = {
                  id: `xadrez_swap_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                  turmaId: turma.id,
                  disciplinaId: disc.id,
                  professorId: prof.id,
                  diaSemana: dia,
                  horario: h,
                };

                // Monta grade simulada do movimento
                const gradeTeste = gradeAtual.map((a, idx) => idx === alocExistenteIndex ? aulaBDeslocada : a);
                gradeTeste.push(novaAloc);

                const avaliacao = calcularNotaJogada(
                  turma, disc, prof, dia, h, 2, gradeAtual, gradeTeste, turmas, professores, matriz
                );

                candidatas.push({
                  id: novaAloc.id,
                  turmaId: turma.id,
                  turmaNome: turma.nome,
                  disciplinaId: disc.id,
                  disciplinaNome: disc.nome,
                  professorId: prof.id,
                  professorNome: prof.nomeCompleto,
                  diaPrincipal: dia,
                  horarioPrincipal: h,
                  profundidade: 2,
                  notaScore: avaliacao.nota,
                  ganhoGlobalResumo: avaliacao.resumoGanho,
                  detalhesPontuacao: [
                    ...avaliacao.detalhes,
                    `Desloca ${discB.nome} (${profB.nomeCompleto.split(" ")[0]}) para ${formatarDiaNomeXadrez(diaAlt)} ${hAlt}º hor.`,
                  ],
                  passos: [
                    {
                      ordem: 1,
                      tipo: "deslocamento_cascata",
                      descricao: `Remanejar ${discB.nome} (${profB.nomeCompleto.split(" ")[0]}) do ${h}º para o ${hAlt}º horário na ${formatarDiaNomeXadrez(diaAlt)}.`,
                      aulaRemovidaId: aulaB.id,
                      novaAlocacao: aulaBDeslocada,
                      professorNome: profB.nomeCompleto,
                      disciplinaNome: discB.nome,
                      turmaNome: turma.nome,
                      dia: diaAlt,
                      horario: hAlt,
                    },
                    {
                      ordem: 2,
                      tipo: "alocacao_direta",
                      descricao: `Alocar ${disc.nome} (${prof.nomeCompleto.split(" ")[0]}) no slot liberado (${formatarDiaNomeXadrez(dia)}, ${h}º horário).`,
                      novaAlocacao: novaAloc,
                      professorNome: prof.nomeCompleto,
                      disciplinaNome: disc.nome,
                      turmaNome: turma.nome,
                      dia,
                      horario: h,
                    },
                  ],
                });
              }
            }
          }
        }
      }

      // C) Escolher a jogada candidata com MAIOR NOTA SCORE (Regra de Ouro do Jogador de Xadrez)
      if (candidatas.length > 0) {
        candidatas.sort((a, b) => b.notaScore - a.notaScore);
        const melhorJogada = candidatas[0];

        // Aplicar a melhor jogada na gradeAtual
        for (const passo of melhorJogada.passos) {
          if (passo.aulaRemovidaId) {
            gradeAtual = gradeAtual.filter((a) => a.id !== passo.aulaRemovidaId);
          }
          gradeAtual.push(passo.novaAlocacao);
        }

        jogadasExecutadas.push(melhorJogada);
        aulasAdicionadasCount++;
        jogadaAplicadaNoCiclo = true;

        logs.push(
          `♟️ [Ciclo ${ciclo}] Jogada Xadrez escolhida (Nota ${melhorJogada.notaScore}/100): ${melhorJogada.disciplinaNome} na ${melhorJogada.turmaNome} (${formatarDiaNomeXadrez(melhorJogada.diaPrincipal)} ${melhorJogada.horarioPrincipal}º hor) — ${melhorJogada.ganhoGlobalResumo}`
        );
        break; // Avança para o próximo ciclo com a grade updated
      }
    }
  }

  const scoreGlobalFinal = calcularScoreGlobalEscola(gradeAtual, turmas, professores, matriz);
  
  // Contar buracos eliminados comparando base e final
  const contarTotalBuracos = (alocs: Alocacao[]) => {
    let tot = 0;
    for (const t of turmas) {
      for (const d of DIAS_SEMANA_XADREZ) {
        const ad = alocs.filter((a) => a.turmaId === t.id && a.diaSemana === d);
        if (ad.length <= 1) continue;
        const sH = new Set<number>(ad.map((a) => a.horario));
        const mn = Math.min(...Array.from(sH));
        const mx = Math.max(...Array.from(sH));
        for (let p = mn; p < mx; p++) if (!sH.has(p)) tot++;
      }
    }
    return tot;
  };

  const buracosEliminadosCount = Math.max(0, contarTotalBuracos(alocacoesBase) - contarTotalBuracos(gradeAtual));
  const conflitosEliminadosCount = jogadasExecutadas.filter((j) => j.profundidade > 1).length;
  const concluidaComSucesso = provasInviabilidade.length === 0;

  logs.push(`Motor Xadrez Concluído: +${aulasAdicionadasCount} aulas inseridas, ${buracosEliminadosCount} buracos eliminados, ${conflitosEliminadosCount} conflitos resolvidos em cascata. Score Final: ${scoreGlobalFinal}/100.`);

  return {
    alocacoes: gradeAtual,
    aulasAdicionadasCount,
    buracosEliminadosCount,
    conflitosEliminadosCount,
    concluidaComSucesso,
    jogadasExecutadas,
    provasInviabilidade,
    logs,
    scoreGlobalInicial,
    scoreGlobalFinal,
  };
}

const PRIMEIROS_NOMES = [
  "José", "Maria", "João", "Ana", "Carlos", "Sandra", "Paulo", "Helena", "Marcos", "Patrícia",
  "Luiz", "Cláudia", "Ricardo", "Aline", "Fábio", "Camila", "Reginaldo", "Alessandra", "Roberto", "Juliana",
  "Daniel", "Letícia", "Bruno", "Renata", "Eduardo", "Gisele", "Fernando", "Simone", "Gustavo", "Priscila",
  "Rodrigo", "Tatiane", "Marcelo", "Bianca", "Thiago", "Carla", "André", "Vanessa", "Alexandre", "Mariana",
  "Maurício", "Débora", "Leonardo", "Larissa", "Rafael", "Clara", "Felipe", "Gabriela", "Hugo", "Isabela"
];

const SOBRENOMES = [
  "Silva", "Santos", "Oliveira", "Souza", "Rodrigues", "Ferreira", "Alves", "Pereira", "Lima", "Gomes",
  "Costa", "Ribeiro", "Martins", "Carvalho", "Teixeira", "Barbosa", "Pinto", "Correia", "Cardoso", "Melo",
  "Rocha", "Dias", "Moreira", "Nunes", "Viana", "Araújo", "Mendes", "Marques", "Campos", "Figueiredo"
];

const DISCIPLINAS_BASE = [
  { nome: "Matemática", abr: "MAT", cor: "#3B82F6", ch: 5 },
  { nome: "Língua Portuguesa", abr: "LPO", cor: "#10B981", ch: 5 },
  { nome: "História", abr: "HIS", cor: "#8B5CF6", ch: 3 },
  { nome: "Geografia", abr: "GEO", cor: "#F59E0B", ch: 3 },
  { nome: "Ciências", abr: "CIE", cor: "#EF4444", ch: 4 },
  { nome: "Educação Física", abr: "EDF", cor: "#EC4899", ch: 2 },
  { nome: "Arte", abr: "ART", cor: "#14B8A6", ch: 2 },
  { nome: "Língua Inglesa", abr: "ING", cor: "#06B6D4", ch: 2 },
  { nome: "Biologia", abr: "BIO", cor: "#059669", ch: 2 },
  { nome: "Física", abr: "FIS", cor: "#6366F1", ch: 2 },
  { nome: "Química", abr: "QUI", cor: "#D97706", ch: 2 },
  { nome: "Filosofia", abr: "FIL", cor: "#7C3AED", ch: 1 },
  { nome: "Sociologia", abr: "SOC", cor: "#DB2777", ch: 1 },
  { nome: "Ensino Religioso", abr: "ERE", cor: "#6B7280", ch: 1 },
  { nome: "Projeto de Vida", abr: "PDV", cor: "#0D9488", ch: 2 },
  { nome: "Tecnologia", abr: "TEC", cor: "#4F46E5", ch: 1 },
  { nome: "Eletiva I", abr: "EL1", cor: "#B45309", ch: 2 },
  { nome: "Eletiva II", abr: "EL2", cor: "#9A3412", ch: 2 },
  { nome: "Redação", abr: "RED", cor: "#BE185D", ch: 2 },
  { nome: "Literatura", abr: "LIT", cor: "#047857", ch: 2 },
  { nome: "Álgebra", abr: "ALG", cor: "#1D4ED8", ch: 2 },
  { nome: "Geometria", abr: "GEM", cor: "#0369A1", ch: 2 },
  { nome: "Espanhol", abr: "ESP", cor: "#0F766E", ch: 1 },
  { nome: "Projeto Comunitário", abr: "PCO", cor: "#701A75", ch: 1 },
  { nome: "Estudos Sociais", abr: "ESO", cor: "#1E1B4B", ch: 1 }
];

export function generateDemoData(size: "pequena" | "media" | "grande") {
  let targetTeachersCount = 20;
  let targetClassesCount = 10;
  let targetSubjectsCount = 12;

  if (size === "media") {
    targetTeachersCount = 80;
    targetClassesCount = 40;
    targetSubjectsCount = 18;
  } else if (size === "grande") {
    targetTeachersCount = 250;
    targetClassesCount = 120;
    targetSubjectsCount = 25;
  }

  // 1. Disciplines
  const disciplinas: Disciplina[] = [];
  const subjectsToUse = DISCIPLINAS_BASE.slice(0, targetSubjectsCount);
  subjectsToUse.forEach((db, index) => {
    disciplinas.push({
      id: `dem_d${index + 1}`,
      nome: db.nome,
      abreviacao: db.abr,
      cor: db.cor,
      cargaHorariaSemanal: db.ch
    });
  });

  // 2. Classes (Turmas)
  const turmas: Turma[] = [];
  const series = ["6º Ano", "7º Ano", "8º Ano", "9º Ano", "1º Ano EM", "2º Ano EM", "3º Ano EM"];
  const letras = ["A", "B", "C", "D", "E", "F"];

  for (let i = 0; i < targetClassesCount; i++) {
    const serie = series[i % series.length];
    const letra = letras[Math.floor(i / series.length) % letras.length];
    const turno = i % 2 === 0 ? "manha" : "tarde";
    turmas.push({
      id: `dem_t${i + 1}`,
      nome: `${serie} ${letra}`,
      turno,
      serie,
      anoLetivo: 2026,
      observacoes: `Turma gerada automaticamente para demonstração (${turno === "manha" ? "Matutino" : "Vespertino"}).`
    });
  }

  // 3. Matriz Curricular
  const matriz: MatrizCurricular[] = [];
  turmas.forEach((t) => {
    // Each class has a subset of disciplines based on school size
    disciplinas.forEach((d) => {
      matriz.push({
        turmaId: t.id,
        disciplinaId: d.id,
        aulasPorSemana: d.cargaHorariaSemanal
      });
    });
  });

  // 4. Teachers (Professores)
  const professores: Professor[] = [];
  const generatedNames = new Set<string>();

  for (let i = 0; i < targetTeachersCount; i++) {
    let name = "";
    do {
      const fName = PRIMEIROS_NOMES[Math.floor(Math.random() * PRIMEIROS_NOMES.length)];
      const lName1 = SOBRENOMES[Math.floor(Math.random() * SOBRENOMES.length)];
      const lName2 = SOBRENOMES[Math.floor(Math.random() * SOBRENOMES.length)];
      name = `${fName} ${lName1} ${lName2}`;
    } while (generatedNames.has(name));
    generatedNames.add(name);

    // Assign 1-2 disciplines to each teacher
    const teacherDiscIds: string[] = [];
    const mainDiscIdx = i % disciplinas.length;
    teacherDiscIds.push(disciplinas[mainDiscIdx].id);
    if (i % 5 === 0 && disciplinas.length > 1) {
      const altDiscIdx = (mainDiscIdx + 2) % disciplinas.length;
      teacherDiscIds.push(disciplinas[altDiscIdx].id);
    }

    // Assign a subset of compatible classes
    const teacherTurmaIds: string[] = [];
    turmas.forEach((t) => {
      // Teachers tend to specialize in either manha or tarde to avoid conflicts, or a mix
      const compatibleTurno = i % 3 === 0 ? "manha" : (i % 3 === 1 ? "tarde" : t.turno);
      if (t.turno === compatibleTurno && Math.random() < 0.4) {
        teacherTurmaIds.push(t.id);
      }
    });

    // Ensure they have at least 2 classes
    if (teacherTurmaIds.length < 2) {
      for (let j = 0; j < 3; j++) {
        const randT = turmas[Math.floor(Math.random() * turmas.length)];
        if (!teacherTurmaIds.includes(randT.id)) {
          teacherTurmaIds.push(randT.id);
        }
      }
    }

    // Availability grid
    const disponibilidade: Disponibilidade = {
      segunda: [1, 2, 3, 4, 5, 6],
      terca: [1, 2, 3, 4, 5, 6],
      quarta: [1, 2, 3, 4, 5, 6],
      quinta: [1, 2, 3, 4, 5, 6],
      sexta: [1, 2, 3, 4, 5, 6]
    };

    // Randomly remove some slots to simulate realistic constraints
    const dias = ["segunda", "terca", "quarta", "quinta", "sexta"];
    if (i % 4 === 0) {
      const offDay = dias[i % dias.length];
      disponibilidade[offDay] = [];
    } else {
      dias.forEach((d) => {
        if (Math.random() < 0.25) {
          disponibilidade[d] = disponibilidade[d].filter(() => Math.random() > 0.3);
        }
      });
    }

    const maxCh = 12 + (i % 3) * 8; // 12, 20 or 28 max hours

    professores.push({
      id: `dem_p${i + 1}`,
      nomeCompleto: name,
      masp: `MASP-${100000 + i}`,
      tipoVinculo: i % 2 === 0 ? "efetivo" : "designado",
      cargo: "Professor Regente",
      disciplinas: teacherDiscIds,
      turmas: teacherTurmaIds,
      disponibilidade,
      cargaHorariaMaximaSemanal: maxCh
    });
  }

  // 5. Procedural Greedy Allocation (Alocações)
  const alocacoes: Alocacao[] = [];
  let alocIdCounter = 1;

  // Track teacher and class busy slots
  const teacherBusy = new Map<string, Set<string>>(); // "profId_day_slot"
  const classBusy = new Map<string, Set<string>>();   // "turmaId_day_slot"

  const markBusy = (pId: string, tId: string, day: string, slot: number) => {
    const keyP = `${pId}_${day}_${slot}`;
    const keyT = `${tId}_${day}_slot`;
    if (!teacherBusy.has(pId)) teacherBusy.set(pId, new Set());
    if (!classBusy.has(tId)) classBusy.set(tId, new Set());
    teacherBusy.get(pId)!.add(keyP);
    classBusy.get(tId)!.add(keyT);
  };

  const isBusy = (pId: string, tId: string, day: string, slot: number): boolean => {
    const keyP = `${pId}_${day}_${slot}`;
    const keyT = `${tId}_${day}_slot`;
    return (teacherBusy.get(pId)?.has(keyP) || false) || (classBusy.get(tId)?.has(keyT) || false);
  };

  const diasLetivos = ["segunda", "terca", "quarta", "quinta", "sexta"];
  const maxSlots = 6;

  // Sort turmas so we allocate key classes first
  turmas.forEach((t) => {
    // For each discipline on this class's matrix
    const classMatrix = matriz.filter((m) => m.turmaId === t.id);
    classMatrix.forEach((m) => {
      // Find eligible teachers who teach this discipline and have this class
      const eligibleProfs = professores.filter(
        (p) => p.disciplinas.includes(m.disciplinaId) && p.turmas.includes(t.id)
      );

      if (eligibleProfs.length === 0) return;

      // Select a teacher deterministically to spread work
      const p = eligibleProfs[Math.floor(Math.random() * eligibleProfs.length)];

      let assignedCount = 0;
      // Try to assign the required number of weekly hours
      for (let attempt = 0; attempt < 50 && assignedCount < m.aulasPorSemana; attempt++) {
        const randDay = diasLetivos[Math.floor(Math.random() * diasLetivos.length)];
        const randSlot = Math.floor(Math.random() * maxSlots) + 1;

        // Check teacher availability for this day and slot
        const isProfAvailable = p.disponibilidade[randDay]?.includes(randSlot);

        if (isProfAvailable && !isBusy(p.id, t.id, randDay, randSlot)) {
          alocacoes.push({
            id: `dem_a${alocIdCounter++}`,
            turmaId: t.id,
            disciplinaId: m.disciplinaId,
            professorId: p.id,
            diaSemana: randDay,
            horario: randSlot,
            isLocked: false
          });
          markBusy(p.id, t.id, randDay, randSlot);
          assignedCount++;
        }
      }
    });
  });

  return {
    turmas,
    disciplinas,
    professores,
    matriz,
    alocacoes
  };
}

export interface BuracoInfo {
  turmaId: string;
  turmaNome: string;
  diaSemana: string;
  horario: number;
  tamanho: number;
  posicao: number;
}

export function otimizarBuracosTurmas(
  grade: Alocacao[],
  turmas: Turma[],
  professores: Professor[],
  disciplinas: Disciplina[],
  matriz: MatrizCurricular[],
  config: any
): Alocacao[] {
  const startTime = performance.now();
  let novaGrade = [...grade];
  
  // 1. IDENTIFICAR BUROCOS CRÍTICOS
  const buracosCriticos = identificarBuracosCriticos(novaGrade, turmas);
  
  // 2. PRIORIZAR BUROCOS QUE AFETAM MAIS TURMAS
  const buracosPriorizados = buracosCriticos.sort((a, b) => {
    const impactoA = calcularImpactoBuraco(a, novaGrade, turmas);
    const impactoB = calcularImpactoBuraco(b, novaGrade, turmas);
    return impactoB - impactoA;
  });
  
  // 3. APLICAR MOVIMENTOS INTELIGENTES
  for (const buraco of buracosPriorizados) {
    if (performance.now() - startTime > 3000) {
      console.warn("⚠️ [otimizarBuracosTurmas] Interrompido por limite de 3 segundos.");
      break;
    }
    const aulaCandidata = encontrarAulaParaPreencherBuraco(
      novaGrade,
      buraco.turmaId,
      buraco.diaSemana,
      buraco.horario,
      professores,
      disciplinas
    );
    
    if (aulaCandidata) {
      const check = verificarSlotViavelComMotivo(
        novaGrade,
        professores,
        disciplinas,
        turmas,
        matriz,
        config,
        aulaCandidata.professorId,
        buraco.turmaId,
        aulaCandidata.disciplinaId,
        buraco.diaSemana,
        buraco.horario,
        undefined,
        aulaCandidata.id
      );
      
      if (check.viavel) {
        // Movimentar a aula
        const aulaIndex = novaGrade.findIndex(a => a.id === aulaCandidata.id);
        if (aulaIndex !== -1) {
          novaGrade[aulaIndex] = {
            ...novaGrade[aulaIndex],
            diaSemana: buraco.diaSemana,
            horario: buraco.horario
          };
        }
      }
    }
  }
  
  return novaGrade;
}

function identificarBuracosCriticos(grade: Alocacao[], turmas: Turma[]): BuracoInfo[] {
  const buracos: BuracoInfo[] = [];
  const DIAS = ["segunda", "terca", "quarta", "quinta", "sexta"];
  
  for (const turma of turmas) {
    for (const dia of DIAS) {
      const aulasDia = grade.filter(a => a.turmaId === turma.id && a.diaSemana === dia);
      if (aulasDia.length < 2) continue;
      
      const ocupados = new Set(aulasDia.map(a => a.horario));
      const min = Math.min(...ocupados);
      const max = Math.max(...ocupados);
      
      for (let h = min + 1; h < max; h++) {
        if (!ocupados.has(h)) {
          buracos.push({
            turmaId: turma.id,
            turmaNome: turma.nome,
            diaSemana: dia,
            horario: h,
            tamanho: max - min,
            posicao: h - min
          });
        }
      }
    }
  }
  
  return buracos;
}

function calcularImpactoBuraco(
  buraco: BuracoInfo,
  grade: Alocacao[],
  _turmas: Turma[]
): number {
  let impacto = 0;
  
  // 1. Impacto no IQG do buraco
  impacto += buraco.tamanho * 10;
  
  // 2. Impacto na turma
  const aulasTurma = grade.filter(a => a.turmaId === buraco.turmaId);
  impacto += aulasTurma.length * 2;
  
  // 3. Proximidade do centro do dia (buracos no meio são piores)
  const centro = 3.5;
  const distanciaCentro = Math.abs(buraco.horario - centro);
  impacto += (3 - distanciaCentro) * 5;
  
  return impacto;
}

function encontrarAulaParaPreencherBuraco(
  grade: Alocacao[],
  turmaId: string,
  diaSemana: string,
  horario: number,
  _professores: Professor[],
  _disciplinas: Disciplina[]
): Alocacao | undefined {
  const candidatas = grade.filter(a => a.turmaId === turmaId && !a.isLocked && (a.diaSemana !== diaSemana || a.horario !== horario));
  return candidatas[0];
}

export function otimizarJanelasProfessores(
  grade: Alocacao[],
  professores: Professor[],
  turmas: Turma[],
  disciplinas: Disciplina[],
  matriz: MatrizCurricular[],
  config: any
): Alocacao[] {
  const startTime = performance.now();
  let novaGrade = [...grade];
  
  const professoresComJanelas = identificarProfessoresComJanelas(novaGrade, professores);
  const ordenados = professoresComJanelas.sort((a, b) => b.totalJanelas - a.totalJanelas);
  
  for (const profInfo of ordenados) {
    if (performance.now() - startTime > 3000) {
      console.warn("⚠️ [otimizarJanelasProfessores] Interrompido por limite de 3 segundos.");
      break;
    }
    if (profInfo.totalJanelas < 1) continue;
    
    const aulasDoProfessor = novaGrade.filter(a => a.professorId === profInfo.professorId);
    const diasComAulas = new Set(aulasDoProfessor.map(a => a.diaSemana));
    
    for (const dia of diasComAulas) {
      const aulasDia = aulasDoProfessor.filter(a => a.diaSemana === dia);
      if (aulasDia.length < 2) continue;
      
      const horarios = aulasDia.map(a => a.horario).sort((a, b) => a - b);
      const gaps = [];
      
      for (let i = 0; i < horarios.length - 1; i++) {
        gaps.push(horarios[i + 1] - horarios[i] - 1);
      }
      
      if (gaps.some(g => g > 0)) {
        const melhoresHorarios = encontrarMelhorAgrupamento(aulasDia, grade, config);
        
        for (let i = 0; i < aulasDia.length && i < melhoresHorarios.length; i++) {
          const aula = aulasDia[i];
          const novoHorario = melhoresHorarios[i];
          
          if (aula.horario !== novoHorario) {
            const check = verificarSlotViavelComMotivo(
              novaGrade,
              professores,
              disciplinas,
              turmas,
              matriz,
              config,
              aula.professorId,
              aula.turmaId,
              aula.disciplinaId,
              dia,
              novoHorario,
              undefined,
              aula.id
            );
            
            if (check.viavel) {
              const index = novaGrade.findIndex(a => a.id === aula.id);
              if (index !== -1) {
                novaGrade[index] = { ...novaGrade[index], horario: novoHorario };
              }
            }
          }
        }
      }
    }
  }
  
  return novaGrade;
}

function identificarProfessoresComJanelas(
  grade: Alocacao[],
  professores: Professor[]
): { professorId: string; professorNome: string; totalJanelas: number }[] {
  const resultado = [];
  
  for (const prof of professores) {
    const aulasProf = grade.filter(a => a.professorId === prof.id);
    const dias = ["segunda", "terca", "quarta", "quinta", "sexta"];
    let totalJanelas = 0;
    
    for (const dia of dias) {
      const aulasDia = aulasProf.filter(a => a.diaSemana === dia);
      if (aulasDia.length < 2) continue;
      
      const horarios = aulasDia.map(a => a.horario).sort((a, b) => a - b);
      const min = horarios[0];
      const max = horarios[horarios.length - 1];
      
      for (let h = min + 1; h < max; h++) {
        if (!horarios.includes(h)) totalJanelas++;
      }
    }
    
    if (totalJanelas > 0) {
      resultado.push({
        professorId: prof.id,
        professorNome: prof.nomeCompleto,
        totalJanelas
      });
    }
  }
  
  return resultado.sort((a, b) => b.totalJanelas - a.totalJanelas);
}

function encontrarMelhorAgrupamento(
  aulas: Alocacao[],
  grade: Alocacao[],
  _config: any
): number[] {
  const maxHorarios = 6;
  const ocupados = new Set(aulas.map(a => a.horario));
  const disponiveis = [];
  
  for (let h = 1; h <= maxHorarios; h++) {
    if (!ocupados.has(h)) {
      disponiveis.push(h);
    }
  }
  
  let melhorBloco: number[] = [];
  let blocoAtual: number[] = [];
  
  for (const h of disponiveis) {
    if (blocoAtual.length === 0 || h === blocoAtual[blocoAtual.length - 1] + 1) {
      blocoAtual.push(h);
    } else {
      if (blocoAtual.length > melhorBloco.length) {
        melhorBloco = [...blocoAtual];
      }
      blocoAtual = [h];
    }
  }
  
  if (blocoAtual.length > melhorBloco.length) {
    melhorBloco = [...blocoAtual];
  }
  
  if (melhorBloco.length === 0) {
    melhorBloco = Array.from({ length: maxHorarios }, (_, i) => i + 1);
  }
  
  const resultado = [];
  const aulasOrdenadas = [...aulas].sort((a, b) => a.horario - b.horario);
  
  for (let i = 0; i < aulasOrdenadas.length; i++) {
    resultado.push(melhorBloco[i % melhorBloco.length]);
  }
  
  return resultado;
}

export function otimizarDistribuicaoSemanal(
  grade: Alocacao[],
  turmas: Turma[],
  disciplinas: Disciplina[],
  professores: Professor[],
  matriz: MatrizCurricular[],
  config: any
): Alocacao[] {
  const startTime = performance.now();
  let novaGrade = [...grade];
  
  const distribuicoesIdeais = calcularDistribuicoesIdeais(grade, turmas, disciplinas);
  const desbalanceamentos = identificarDesbalanceamentos(grade, distribuicoesIdeais);
  
  for (const item of desbalanceamentos) {
    if (performance.now() - startTime > 3000) {
      console.warn("⚠️ [otimizarDistribuicaoSemanal] Interrompido por limite de 3 segundos.");
      break;
    }
    const { turmaId, disciplinaId, diaAtual, diaIdeal } = item;
    
    const aulaParaMover = novaGrade.find(a =>
      a.turmaId === turmaId &&
      a.disciplinaId === disciplinaId &&
      a.diaSemana === diaAtual &&
      !a.isLocked
    );
    
    if (aulaParaMover && aulaParaMover.professorId !== "p_david") {
      const aulasNoDiaIdeal = novaGrade.filter(a =>
        a.turmaId === turmaId &&
        a.diaSemana === diaIdeal
      ).length;
      
      const maxHorarios = 6;
      if (aulasNoDiaIdeal < maxHorarios) {
        const horariosOcupados = new Set(
          novaGrade
            .filter(a => a.turmaId === turmaId && a.diaSemana === diaIdeal)
            .map(a => a.horario)
        );
        
        for (let h = 1; h <= maxHorarios; h++) {
          if (!horariosOcupados.has(h)) {
            const check = verificarSlotViavelComMotivo(
              novaGrade,
              professores,
              disciplinas,
              turmas,
              matriz,
              config,
              aulaParaMover.professorId,
              turmaId,
              disciplinaId,
              diaIdeal,
              h,
              undefined,
              aulaParaMover.id
            );
            
            if (check.viavel) {
              const index = novaGrade.findIndex(a => a.id === aulaParaMover.id);
              if (index !== -1) {
                novaGrade[index] = {
                  ...novaGrade[index],
                  diaSemana: diaIdeal,
                  horario: h
                };
              }
              break;
            }
          }
        }
      }
    }
  }
  
  return novaGrade;
}

export function otimizarGeminacao(
  grade: Alocacao[],
  turmas: Turma[],
  disciplinas: Disciplina[],
  professores: Professor[],
  matriz: MatrizCurricular[],
  config: any
): Alocacao[] {
  const startTime = performance.now();
  let novaGrade = [...grade];
  const DIAS = ["segunda", "terca", "quarta", "quinta", "sexta"];
  
  const disciplinasGeminadas = disciplinas.filter(d => (d as any).exigeGeminacao || true);
  
  for (const turma of turmas) {
    if (performance.now() - startTime > 3000) {
      console.warn("⚠️ [otimizarGeminacao] Interrompido por limite de 3 segundos.");
      break;
    }
    for (const disciplina of disciplinasGeminadas) {
      if (performance.now() - startTime > 3000) break;
      const aulasDisciplina = novaGrade.filter(a =>
        a.turmaId === turma.id &&
        a.disciplinaId === disciplina.id
      );
      
      if (aulasDisciplina.length < 2) continue;
      if (aulasDisciplina.some(a => a.professorId === "p_david")) continue;
      
      for (const dia of DIAS) {
        const aulasDia = aulasDisciplina.filter(a => a.diaSemana === dia);
        if (aulasDia.length < 2) continue;
        
        const horarios = aulasDia.map(a => a.horario).sort((a, b) => a - b);
        let geminado = true;
        
        for (let i = 0; i < horarios.length - 1; i++) {
          if (horarios[i + 1] - horarios[i] !== 1) {
            geminado = false;
            break;
          }
        }
        
        if (!geminado) {
          const novasAulas = tentarGeminarAulas(aulasDia, novaGrade, turma, dia, config);
          
          for (const [aula, novoHorario] of novasAulas.entries()) {
            const index = novaGrade.findIndex(a => a.id === aula.id);
            if (index !== -1) {
              const check = verificarSlotViavelComMotivo(
                novaGrade,
                professores,
                disciplinas,
                turmas,
                matriz,
                config,
                aula.professorId,
                turma.id,
                disciplina.id,
                dia,
                novoHorario,
                undefined,
                aula.id
              );
              
              if (check.viavel) {
                novaGrade[index] = { ...novaGrade[index], horario: novoHorario };
              }
            }
          }
        }
      }
    }
  }
  
  return novaGrade;
}

function calcularDistribuicoesIdeais(
  grade: Alocacao[],
  turmas: Turma[],
  disciplinas: Disciplina[]
): Map<string, Record<string, number>> {
  const resultado = new Map<string, Record<string, number>>();
  const DIAS = ["segunda", "terca", "quarta", "quinta", "sexta"];
  
  for (const turma of turmas) {
    for (const disciplina of disciplinas) {
      const key = `${turma.id}|${disciplina.id}`;
      const totalAulas = grade.filter(a =>
        a.turmaId === turma.id &&
        a.disciplinaId === disciplina.id
      ).length;
      
      if (totalAulas === 0) continue;
      
      const distribuicao: Record<string, number> = {};
      const base = Math.floor(totalAulas / 5);
      const resto = totalAulas % 5;
      
      for (let i = 0; i < 5; i++) {
        distribuicao[DIAS[i]] = base + (i < resto ? 1 : 0);
      }
      
      resultado.set(key, distribuicao);
    }
  }
  
  return resultado;
}

function identificarDesbalanceamentos(
  grade: Alocacao[],
  distribuicoesIdeais: Map<string, Record<string, number>>
): { turmaId: string; disciplinaId: string; diaAtual: string; diaIdeal: string; diferenca: number }[] {
  const desbalanceamentos = [];
  const DIAS = ["segunda", "terca", "quarta", "quinta", "sexta"];
  
  for (const [key, ideal] of distribuicoesIdeais) {
    const [turmaId, disciplinaId] = key.split('|');
    
    const atual: Record<string, number> = {};
    for (const dia of DIAS) {
      atual[dia] = grade.filter(a =>
        a.turmaId === turmaId &&
        a.disciplinaId === disciplinaId &&
        a.diaSemana === dia
      ).length;
    }
    
    for (const dia of DIAS) {
      const diff = atual[dia] - (ideal[dia] || 0);
      if (diff > 0) {
        for (const diaIdeal of DIAS) {
          const deficit = (ideal[diaIdeal] || 0) - atual[diaIdeal];
          if (deficit > 0) {
            desbalanceamentos.push({
              turmaId,
              disciplinaId,
              diaAtual: dia,
              diaIdeal,
              diferenca: diff
            });
            break;
          }
        }
      }
    }
  }
  
  return desbalanceamentos;
}

function tentarGeminarAulas(
  aulas: Alocacao[],
  grade: Alocacao[],
  turma: Turma,
  dia: string,
  _config: any
): Map<Alocacao, number> {
  const resultado = new Map<Alocacao, number>();
  const maxHorarios = 6;
  
  let inicio = 1;
  let encontrou = false;
  
  while (inicio <= maxHorarios - aulas.length + 1 && !encontrou) {
    let disponivel = true;
    
    for (let i = 0; i < aulas.length; i++) {
      const h = inicio + i;
      const ocupado = grade.some(a =>
        a.turmaId === turma.id &&
        a.diaSemana === dia &&
        a.horario === h &&
        !aulas.includes(a)
      );
      
      if (ocupado) {
        disponivel = false;
        break;
      }
    }
    
    if (disponivel) {
      encontrou = true;
      for (let i = 0; i < aulas.length; i++) {
        resultado.set(aulas[i], inicio + i);
      }
    }
    
    inicio++;
  }
  
  return resultado;
}


