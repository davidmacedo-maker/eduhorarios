/**
 * ai-service.ts
 * ──────────────────────────────────────────────────────────────
 * Camada Inteligente de Auditoria e Propostas de Otimização via IA (Ollama / Gemini).
 * Cria um resumo inteligente da grade escolar com foco em turmas com buracos e janelas de professores
 * para envio otimizado e propõe swaps refinados de alta performance.
 */

import type { Alocacao, Turma, Professor, Disciplina, MatrizCurricular } from "@/types";
import { verificarSlotViavelComMotivo } from "./schedule-utils";
import { contarBuracosTurma, contarJanelasProfessor } from "./score-utils";

export interface AISwapProposal {
  id: string; // ID sequencial temporário para a interface
  type: "move" | "swap";
  alocacaoIdA: string;
  alocacaoIdB?: string; // se for swap duplo
  targetDia: string;
  targetHorario: number;
  originalDiaA: string;
  originalHorarioA: number;
  originalDiaB?: string;
  originalHorarioB?: number;
  motivo: string;
  professorNome: string;
  turmaNome: string;
  disciplinaNome: string;
}

export interface AIAuditoryResult {
  issues: string[];
  suggestedSwaps: {
    alocacaoIdA: string;
    alocacaoIdB?: string;
    targetDia: string;
    targetHorario: number;
    motivo: string;
  }[];
  riskLevel: "low" | "medium" | "high";
  summary: string;
}

/**
 * Cria um resumo limpo e altamente otimizado em formato texto para a IA auditar,
 * reduzindo absurdamente o gasto de tokens e focando apenas nos problemas e slots correlatos.
 */
export function buildCondensedScheduleSummary(
  grade: Alocacao[],
  turmas: Turma[],
  professores: Professor[],
  disciplinas: Disciplina[]
): string {
  let summary = "=== RESUMO CONCENTRADO DA GRADE ESCOLAR (Foco em Inconformidades) ===\n\n";

  // Encontra turmas que possuem buracos no horário escolar
  const turmasComBuraco = turmas.filter((t) => {
    const gaps = contarBuracosTurma(grade.filter((a) => a.turmaId === t.id), [t]);
    return gaps > 0;
  });

  if (turmasComBuraco.length > 0) {
    summary += "--- TURMAS COM BURACOS (HORÁRIOS VAZIOS INDESEJADOS) ---\n";
    for (const t of turmasComBuraco) {
      summary += `Turma: ${t.nome} (Turno: ${t.turno})\n`;
      const tAlocs = grade.filter((a) => a.turmaId === t.id);

      const dias = ["segunda", "terca", "quarta", "quinta", "sexta"];
      for (const dia of dias) {
        const diaAlocs = tAlocs.filter((a) => a.diaSemana === dia).sort((a, b) => a.horario - b.horario);
        if (diaAlocs.length === 0) continue;

        const maxH = Math.max(...diaAlocs.map((a) => a.horario));
        const minH = Math.min(...diaAlocs.map((a) => a.horario));

        let linhaDia = `  * ${dia.toUpperCase()}: `;
        const listSlots: string[] = [];
        
        for (let h = 1; h <= maxH; h++) {
          const aloc = diaAlocs.find((a) => a.horario === h);
          if (aloc) {
            const disc = disciplinas.find((d) => d.id === aloc.disciplinaId);
            const prof = professores.find((p) => p.id === aloc.professorId);
            listSlots.push(`[${h}º H: ${disc?.abreviacao || disc?.nome} - Prof: ${prof?.nomeCompleto?.split(" ")[0]} (ID_ALOC: ${aloc.id})]`);
          } else if (h > minH) {
            listSlots.push(`[${h}º H: << BURACO VAZIO >>]`);
          } else {
            listSlots.push(`[${h}º H: Vago (Início)]`);
          }
        }
        summary += linhaDia + listSlots.join(" -> ") + "\n";
      }
      summary += "\n";
    }
  } else {
    summary += "Nenhum buraco detectado em turmas.\n\n";
  }

  // Encontra professores com janelas indesejadas
  const proferesComJanelas = professores.filter((p) => {
    const janelas = contarJanelasProfessor(grade.filter((a) => a.professorId === p.id), [p]);
    return janelas > 0;
  });

  if (proferesComJanelas.length > 0) {
    summary += "--- PROFESSORES COM JANELAS OCIOSAS ---\n";
    for (const p of proferesComJanelas) {
      summary += `Professor: ${p.nomeCompleto} (ID: ${p.id})\n`;
      const pAlocs = grade.filter((a) => a.professorId === p.id);

      const dias = ["segunda", "terca", "quarta", "quinta", "sexta"];
      for (const dia of dias) {
        const diaAlocs = pAlocs.filter((a) => a.diaSemana === dia).sort((a, b) => a.horario - b.horario);
        if (diaAlocs.length < 2) continue;

        const maxH = Math.max(...diaAlocs.map((a) => a.horario));
        const minH = Math.min(...diaAlocs.map((a) => a.horario));

        let linhaDia = `  * ${dia.toUpperCase()}: `;
        const listSlots: string[] = [];

        for (let h = minH; h <= maxH; h++) {
          const aloc = diaAlocs.find((a) => a.horario === h);
          if (aloc) {
            const turma = turmas.find((t) => t.id === aloc.turmaId);
            listSlots.push(`[${h}º H: Ala em ${turma?.nome} (ID_ALOC: ${aloc.id})]`);
          } else {
            listSlots.push(`[${h}º H: << JANELA OCIOSA >>]`);
          }
        }
        summary += linhaDia + listSlots.join(" -> ") + "\n";
      }
      summary += "\n";
    }
  } else {
    summary += "Nenhum professor com janela ociosa.\n\n";
  }

  return summary;
}

/**
 * Dispara auditoria inteligente em direção ao Ollama (Local) ou Gemini API.
 */
export async function runAIAudit(
  grade: Alocacao[],
  turmas: Turma[],
  professores: Professor[],
  disciplinas: Disciplina[],
  provider: "ollama" | "gemini",
  ollamaUrl = "http://localhost:11434",
  modelName = "qwen2.5",
  customGeminiKey = ""
): Promise<AIAuditoryResult> {
  const textSummary = buildCondensedScheduleSummary(grade, turmas, professores, disciplinas);

  const prompt = `Você é um Auditor e Inteligência Suprema de Otimização de Grades Escolares.
Sua missão é ajudar a reduzir ou eliminar os buracos das turmas (intervalos vazios no meio da aula do aluno) e as janelas dos professores (intervalos ociosos entre aulas do docente).

Analise o resumo da grade escolar focada em problemas abaixo. Gere um plano cirúrgico de realocação (movimentos de aula ou trocas de lugar equilibradas) para otimizar.

REGRAS CRÍTICAS DE GERAÇÃO:
1. Proponha movimentos de aula (da esquerda de volta a um espaço vazio) ou permutas/swaps (trocar aula de tal horário com outra aula).
2. Cada troca ou movimento deve apontar no campo "alocacaoIdA" (o ID da alocação que vai sair) e no "targetDia" + "targetHorario" (para onde ela vai). Se for uma troca dupla mútua, informe também o "alocacaoIdB" que assumirá o lugar antigo de A.
3. Não invente IDs de alocações! Use APENAS os IDs reais listados nos itens como (ID_ALOC: ...).
4. Suas sugestões serão testadas deterministicamente pelo nosso motor matemático de regras duras, logo proponha apenas coisas coerentes.
5. Retorne a resposta estritamente em formato JSON válido e legível, sem markdown na wrapper se possível, ou usando bloco de código JSON.

--- RESUMO DOS PROBLEMAS ---
${textSummary}

Sua resposta DEVE seguir este exato formato JSON:
{
  "issues": [
    "Breve descrição de buraco ou janela ociosa encontrada"
  ],
  "suggestedSwaps": [
    {
      "alocacaoIdA": "ID_REAL_DA_ALOCACAO_A",
      "alocacaoIdB": "ID_REAL_DA_ALOCACAO_B_OU_NULO",
      "targetDia": "segunda|terca|quarta|quinta|sexta",
      "targetHorario": 3,
      "motivo": "Passar Geografia para a terça-feira de modo a eliminar o buraco no 3º horário."
    }
  ],
  "riskLevel": "low|medium|high",
  "summary": "Resumo acolhedor da análise estruturada da grade pela IA."
}`;

  try {
    if (provider === "ollama") {
      const response = await fetch(`${ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: "user", content: prompt }],
          stream: false,
          options: {
            temperature: 0.2, // Mantém temperatura baixa para focar em regras precisas
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Erro ao conectar ao Ollama local em ${ollamaUrl}. Certifique-se de que o Ollama está rodando e a variável OLLAMA_ORIGINS="*" está habilitada.`);
      }

      const rawJson = await response.json();
      const content = rawJson.message?.content || "";
      return parseAIStringResponse(content);
    } else {
      // Provedor Gemini (Chamada REST segura direta para diminuir pacotes de biblioteca em SPA)
      const apiKey = customGeminiKey || (import.meta.env.VITE_GEMINI_API_KEY as string) || "";
      if (!apiKey) {
        throw new Error("Chave do Gemini API não encontrada. Por favor, forneça na tela de configurações ou nas variáveis de ambiente.");
      }

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json"
          }
        }),
      });

      if (!response.ok) {
        throw new Error(`Erro na chamada da API do Gemini.`);
      }

      const rawJson = await response.json();
      const content = rawJson.candidates?.[0]?.content?.parts?.[0]?.text || "";
      return parseAIStringResponse(content);
    }
  } catch (err: any) {
    console.error("[AI Auditor API error]:", err);
    throw new Error(err.message || "Erro desconhecido na requisição da inteligência artificial.");
  }
}

/**
 * Trata e limpa strings de retorno de IAs para garantir parsing seguro de JSON
 */
function parseAIStringResponse(content: string): AIAuditoryResult {
  let cleanStr = content.trim();
  
  // Remove blocos de código markdown se retornados
  if (cleanStr.includes("```json")) {
    const start = cleanStr.indexOf("```json") + 7;
    const end = cleanStr.lastIndexOf("```");
    cleanStr = cleanStr.slice(start, end).trim();
  } else if (cleanStr.includes("```")) {
    const start = cleanStr.indexOf("```") + 3;
    const end = cleanStr.lastIndexOf("```");
    cleanStr = cleanStr.slice(start, end).trim();
  }

  try {
    const parsed = JSON.parse(cleanStr);
    return {
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      suggestedSwaps: Array.isArray(parsed.suggestedSwaps) ? parsed.suggestedSwaps : [],
      riskLevel: parsed.riskLevel || "medium",
      summary: parsed.summary || "Auditoria de IA gerada com sucesso."
    };
  } catch (err) {
    console.warn("Retorno da IA não era JSON legível puro:", cleanStr);
    // Tenta montar um objeto mínimo de retorno
    return {
      issues: ["A IA não retornou um formato JSON válido devido à formatação de texto."],
      suggestedSwaps: [],
      riskLevel: "medium",
      summary: "Falha ao ler JSON de retorno."
    };
  }
}

/**
 * Consolida as propostas sugeridas pela IA enriquecendo com os dados reais
 * e calculando a viabilidade de cada uma delas de forma determinística
 */
export function buildVerifiedProposals(
  grade: Alocacao[],
  suggestedFromAI: AIAuditoryResult["suggestedSwaps"],
  turmas: Turma[],
  professores: Professor[],
  disciplinas: Disciplina[],
  config: any,
  regrasRelaxamento?: any
): AISwapProposal[] {
  const verified: AISwapProposal[] = [];
  let idAcc = 1;

  for (const sug of suggestedFromAI) {
    const alocA = grade.find((a) => a.id === sug.alocacaoIdA);
    if (!alocA) continue; // Alocação A inexistente

    const turma = turmas.find((t) => t.id === alocA.turmaId);
    const profA = professores.find((p) => p.id === alocA.professorId);
    const discA = disciplinas.find((d) => d.id === alocA.disciplinaId);

    // Se propõe um swap de dois elementos
    if (sug.alocacaoIdB) {
      const alocB = grade.find((a) => a.id === sug.alocacaoIdB);
      if (!alocB) continue;

      // Valida se a troca das duas é viável via motor unificado
      const checkA_para_B = verificarSlotViavelComMotivo(
        grade,
        professores,
        disciplinas,
        turmas,
        [], // passa vazio ou matriz se quiser
        config,
        alocA.professorId,
        alocA.turmaId,
        alocA.disciplinaId,
        alocB.diaSemana,
        alocB.horario,
        regrasRelaxamento,
        alocA.id
      );

      const checkB_para_A = verificarSlotViavelComMotivo(
        grade,
        professores,
        disciplinas,
        turmas,
        [],
        config,
        alocB.professorId,
        alocB.turmaId,
        alocB.disciplinaId,
        alocA.diaSemana,
        alocA.horario,
        regrasRelaxamento,
        alocB.id
      );

      if (checkA_para_B.viavel && checkB_para_A.viavel) {
        verified.push({
          id: `ai-prop-${idAcc++}`,
          type: "swap",
          alocacaoIdA: alocA.id,
          alocacaoIdB: alocB.id,
          targetDia: alocB.diaSemana,
          targetHorario: alocB.horario,
          originalDiaA: alocA.diaSemana,
          originalHorarioA: alocA.horario,
          originalDiaB: alocB.diaSemana,
          originalHorarioB: alocB.horario,
          motivo: sug.motivo,
          professorNome: profA?.nomeCompleto || "Professor",
          turmaNome: turma?.nome || "Turma",
          disciplinaNome: discA?.nome || "Disciplina"
        });
      }
    } else {
      // Proposta de movimento unidirecional para slot vago
      const checkMove = verificarSlotViavelComMotivo(
        grade,
        professores,
        disciplinas,
        turmas,
        [],
        config,
        alocA.professorId,
        alocA.turmaId,
        alocA.disciplinaId,
        sug.targetDia,
        sug.targetHorario,
        regrasRelaxamento,
        alocA.id
      );

      if (checkMove.viavel) {
        verified.push({
          id: `ai-prop-${idAcc++}`,
          type: "move",
          alocacaoIdA: alocA.id,
          targetDia: sug.targetDia,
          targetHorario: sug.targetHorario,
          originalDiaA: alocA.diaSemana,
          originalHorarioA: alocA.horario,
          motivo: sug.motivo,
          professorNome: profA?.nomeCompleto || "Professor",
          turmaNome: turma?.nome || "Turma",
          disciplinaNome: discA?.nome || "Disciplina"
        });
      }
    }
  }

  return verified;
}
