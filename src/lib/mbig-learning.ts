import type { 
  Turma, 
  Disciplina, 
  Professor, 
  Alocacao, 
  MatrizCurricular, 
  ConfiguracaoHorarios, 
  HistoricoAprendizado, 
  Conflito,
  PerfilEscola,
  MbigExperiencia,
  PadraoAjusteManual,
  MemoriaConflitos
} from "@/types";

const EXPERIENCIAS_KEY = "mbig_banco_experiencias_v3";
const CONFLITOS_KEY = "mbig_memoria_conflitos_v3";
const PADROES_MANUAIS_KEY = "mbig_padroes_manuais_v3";
const LEARNING_ENABLED_KEY = "mbig_aprendizado_ativo_enabled";

// Dias de semana padrão
const DIAS_PADRAO = ["segunda", "terça", "quarta", "quinta", "sexta"];

/**
 * 2. PERFIL DA ESCOLA
 * Gera o perfil matemático detalhado da escola com base nos dados reais de cadastro.
 */
export function calcularPerfilEscola(
  turmas: Turma[],
  professores: Professor[],
  disciplinas: Disciplina[],
  matriz: MatrizCurricular[],
  config: ConfiguracaoHorarios
): PerfilEscola {
  const totalProfessores = professores.length;
  const totalTurmas = turmas.length;
  const totalDisciplinas = disciplinas.length;

  // Percentual de contraturno / Noturno
  const contraturnoCount = turmas.filter(t => 
    t.turno === "tarde" || 
    t.turno === "noite" || 
    t.nome.toLowerCase().includes("contra") || 
    t.nome.toLowerCase().includes("noite")
  ).length;
  const pctContraturno = totalTurmas > 0 ? Math.round((contraturnoCount / totalTurmas) * 100) : 0;

  // Percentual de integral
  const integralCount = turmas.filter(t => 
    (t.turno as string) === "integral" || 
    t.nome.toLowerCase().includes("integral")
  ).length;
  const pctIntegral = totalTurmas > 0 ? Math.round((integralCount / totalTurmas) * 100) : 0;

  // Disponibilidade média dos professores (porcentagem de slots livres em relação ao total da semana)
  const slotsPorDia = config.quantidadeHorariosPorDia || 5;
  const totalSlotsSemana = 5 * slotsPorDia;

  let sumDisponibilidadePct = 0;
  professores.forEach(p => {
    let slotsLivres = 0;
    if (p.disponibilidade) {
      Object.keys(p.disponibilidade).forEach(dia => {
        const slotsDia = p.disponibilidade[dia];
        if (Array.isArray(slotsDia)) {
          slotsLivres += slotsDia.length;
        }
      });
    } else {
      slotsLivres = totalSlotsSemana; // Se não tem cadastro, assume 100% disponível
    }
    sumDisponibilidadePct += (slotsLivres / totalSlotsSemana) * 100;
  });
  const disponibilidadeMedia = totalProfessores > 0 
    ? Math.round(sumDisponibilidadePct / totalProfessores) 
    : 100;

  // Carga horária média contratada por professor
  let sumCarga = 0;
  professores.forEach(p => {
    sumCarga += p.cargaHorariaMaximaSemanal || 20;
  });
  const cargaMedia = totalProfessores > 0 ? Math.round(sumCarga / totalProfessores) : 0;

  // Índice de restrições (determinado pela disponibilidade média e densidade de professores)
  let indiceRestricoes: "Baixo" | "Médio" | "Alto" = "Médio";
  if (disponibilidadeMedia < 65 || (totalTurmas > totalProfessores * 0.9)) {
    indiceRestricoes = "Alto";
  } else if (disponibilidadeMedia > 82 && (totalProfessores > totalTurmas * 1.3)) {
    indiceRestricoes = "Baixo";
  }

  // Porte da Escola
  let porte = "Médio Porte";
  if (totalTurmas < 8) {
    porte = "Pequeno Porte";
  } else if (totalTurmas > 20) {
    porte = "Grande Porte";
  }

  const perfil = `${porte} (${indiceRestricoes} Restrição)`;

  return {
    totalProfessores,
    totalTurmas,
    totalDisciplinas,
    pctContraturno,
    pctIntegral,
    disponibilidadeMedia,
    cargaMedia,
    indiceRestricoes,
    perfil
  };
}

/**
 * 3. COMPARAÇÃO DE CENÁRIOS
 * Encontra no banco de experiências as escolas mais semelhantes e recomenda estratégias eficientes.
 */
export function recomendarEstrategias(
  perfil: PerfilEscola,
  experiencias: MbigExperiencia[]
): { estrategia: string; similaridade: number; notaFinal: number }[] {
  if (experiencias.length === 0) return [];

  const recomendacoes: { estrategia: string; similaridade: number; notaFinal: number }[] = [];

  experiencias.forEach(exp => {
    // Cálculo de distância euclidiana normalizada para definir a similaridade
    const diffTurmas = Math.abs(exp.nTurmas - perfil.totalTurmas) / Math.max(1, perfil.totalTurmas);
    const diffProfs = Math.abs(exp.nProfs - perfil.totalProfessores) / Math.max(1, perfil.totalProfessores);
    const diffContraturno = Math.abs(exp.pctContraturno - perfil.pctContraturno) / 100;
    const diffIntegral = Math.abs(exp.pctIntegral - perfil.pctIntegral) / 100;
    
    // Pesos para as dimensões matemáticas da escola
    const distancia = (diffTurmas * 2.0) + (diffProfs * 1.5) + (diffContraturno * 1.0) + (diffIntegral * 1.0);
    const similaridade = Math.max(0, Math.round((1 - (distancia / 5.5)) * 100));

    if (similaridade >= 55) { // Escola parecida o suficiente
      recomendacoes.push({
        estrategia: exp.estrategiaUtilizada,
        similaridade,
        notaFinal: exp.notaFinal
      });
    }
  });

  // Ordena por similaridade e nota final descrescente
  return recomendacoes.sort((a, b) => b.similaridade * b.notaFinal - a.similaridade * a.notaFinal);
}

/**
 * 4. RANKING DAS ESTRATÉGIAS
 * Compila estatísticas consolidadas para cada estratégia de busca de forma cumulativa.
 */
export function obterEstatisticasEstrategias(experiencias: MbigExperiencia[]): {
  estrategia: string;
  executada: number;
  coberturaMedia: number;
  tempoMedioMs: number;
  notaMedia: number;
}[] {
  const statsMap: Record<string, { somaCobertura: number; somaTempo: number; somaNota: number; cont: number }> = {};

  // Inicializa valores mínimos de heurísticas conhecidas
  const estrategiasConhecidas = [
    "Professor mais restritivo primeiro (MRV)",
    "Turma mais restritiva primeiro (MRV)",
    "Maior carga horária primeiro",
    "Contraturno primeiro",
    "Integral primeiro",
    "Disciplinas críticas primeiro",
    "Maior número de conflitos primeiro",
    "Ordem totalmente aleatória",
    "LNS (Large Neighborhood Search)",
    "Algoritmo Genético: Crossover (Fase 9)",
    "Mistura dinâmica das melhores heurísticas"
  ];

  estrategiasConhecidas.forEach(est => {
    statsMap[est] = { somaCobertura: 0, somaTempo: 0, somaNota: 0, cont: 0 };
  });

  // Consolida o histórico real
  experiencias.forEach(exp => {
    // Normaliza o nome da estratégia para agrupar
    let nomeEst = exp.estrategiaUtilizada;
    if (nomeEst.includes("Estratégia 1:") || nomeEst.includes("MRV") && nomeEst.includes("Professor")) nomeEst = "Professor mais restritivo primeiro (MRV)";
    else if (nomeEst.includes("Estratégia 2:") || nomeEst.includes("MRV") && nomeEst.includes("Turma")) nomeEst = "Turma mais restritiva primeiro (MRV)";
    else if (nomeEst.includes("Estratégia 3:")) nomeEst = "Maior carga horária primeiro";
    else if (nomeEst.includes("Estratégia 4:")) nomeEst = "Contraturno primeiro";
    else if (nomeEst.includes("Estratégia 5:")) nomeEst = "Integral primeiro";
    else if (nomeEst.includes("Estratégia 6:")) nomeEst = "Disciplinas críticas primeiro";
    else if (nomeEst.includes("Estratégia 7:")) nomeEst = "Maior número de conflitos primeiro";
    else if (nomeEst.includes("Estratégia 8:")) nomeEst = "Ordem totalmente aleatória";
    else if (nomeEst.includes("Estratégia 10:") || nomeEst.includes("Mistura")) nomeEst = "Mistura dinâmica das melhores heurísticas";

    if (!statsMap[nomeEst]) {
      statsMap[nomeEst] = { somaCobertura: 0, somaTempo: 0, somaNota: 0, cont: 0 };
    }

    statsMap[nomeEst].somaCobertura += exp.cobertura;
    statsMap[nomeEst].somaTempo += exp.tempoMs;
    statsMap[nomeEst].somaNota += exp.notaFinal;
    statsMap[nomeEst].cont += 1;
  });

  return Object.keys(statsMap).map(est => {
    const item = statsMap[est];
    return {
      estrategia: est,
      executada: item.cont,
      coberturaMedia: item.cont > 0 ? Math.round(item.somaCobertura / item.cont) : 0,
      tempoMedioMs: item.cont > 0 ? Math.round(item.somaTempo / item.cont) : 0,
      notaMedia: item.cont > 0 ? Math.round(item.somaNota / item.cont) : 0
    };
  }).filter(item => item.executada > 0 || estrategiasConhecidas.includes(item.estrategia));
}

/**
 * 5. APRENDIZADO AUTOMÁTICO AO FINALIZAR
 * Analisa a rodada finalizada para preencher os dados de experiência e entender o comportamento de cada busca.
 */
export function analisarFimGeracao(
  ranking: any[],
  explicacoes: any[],
  perfil: PerfilEscola,
  totalAulas: number,
  solucaoVencedora: any,
  tempoTotalMs: number
): MbigExperiencia {
  const oQueFuncionou: string[] = [];
  const oQueNaoFuncionou: string[] = [];
  let estrategiaMelhorou = "Nenhuma";
  let estrategiaPiorou = "Nenhuma";
  let estrategiaResolveuConflitos: string | undefined = undefined;
  
  let maiorMelhoria = 0;
  let maiorPiora = 0;

  // Analisa a trilha de explicações para mapear as evoluções
  explicacoes.forEach(exp => {
    const ganho = exp.notaNova - exp.notaAnterior;
    if (ganho > 0) {
      oQueFuncionou.push(`${exp.estrategia}: Melhorou a nota de ${exp.notaAnterior.toFixed(1)} para ${exp.notaNova.toFixed(1)} (+${ganho.toFixed(1)} pontos)`);
      if (ganho > maiorMelhoria) {
        maiorMelhoria = ganho;
        estrategiaMelhorou = exp.estrategia;
      }
    } else {
      oQueNaoFuncionou.push(`${exp.estrategia}: Não apresentou evolução significativa no ciclo de busca.`);
    }

    if (ganho < 0 && Math.abs(ganho) > maiorPiora) {
      maiorPiora = Math.abs(ganho);
      estrategiaPiorou = exp.estrategia;
    }

    // Se resolveu conflitos estruturais
    if (exp.motivoMelhoria && exp.motivoMelhoria.toLowerCase().includes("eliminou") || exp.motivoMelhoria && exp.motivoMelhoria.toLowerCase().includes("sucesso")) {
      estrategiaResolveuConflitos = exp.estrategia;
    }
  });

  if (oQueFuncionou.length === 0) {
    oQueFuncionou.push("Geração inicial de heurística pedagógica direta serviu como base principal.");
  }

  const novaExp: MbigExperiencia = {
    id: "exp_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
    nProfs: perfil.totalProfessores,
    nTurmas: perfil.totalTurmas,
    nDisciplinas: perfil.totalDisciplinas,
    nAulas: totalAulas,
    pctContraturno: perfil.pctContraturno,
    pctIntegral: perfil.pctIntegral,
    mediaRestricoes: perfil.disponibilidadeMedia,
    estrategiaUtilizada: solucaoVencedora.estrategia || "Heurística Combinada",
    ordemProcessamento: explicacoes.map(e => e.estrategia).filter((v, i, self) => self.indexOf(v) === i),
    tempoMs: Math.round(tempoTotalMs),
    cobertura: solucaoVencedora.cobertura,
    conflitosCount: solucaoVencedora.conflitosCount,
    notaFinal: solucaoVencedora.notaFinal,
    timestamp: new Date().toISOString(),
    oQueFuncionou: oQueFuncionou.slice(0, 5),
    oQueNaoFuncionou: oQueNaoFuncionou.slice(0, 5),
    estrategiaMelhorou,
    estrategiaPiorou,
    estrategiaResolveuConflitos
  };

  // Salva no banco persistente
  salvarExperienciaNoBanco(novaExp);

  return novaExp;
}

function salvarExperienciaNoBanco(exp: MbigExperiencia) {
  try {
    const raw = localStorage.getItem(EXPERIENCIAS_KEY);
    const lista: MbigExperiencia[] = raw ? JSON.parse(raw) : [];
    lista.push(exp);
    // Guarda até 100 experiências para evitar gargalo de tamanho no localStorage
    if (lista.length > 100) {
      lista.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      lista.splice(100);
    }
    localStorage.setItem(EXPERIENCIAS_KEY, JSON.stringify(lista));
  } catch (err) {
    console.error("Erro ao persistir experiência MBIG:", err);
  }
}

export function obterBancoExperiencias(): MbigExperiencia[] {
  try {
    const raw = localStorage.getItem(EXPERIENCIAS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * 7. MEMÓRIA DE CONFLITOS FÍSICOS
 * Salva a contagem cumulativa de restrições pedagógicas e choques físicos que geraram críticas.
 */
export function atualizarMemoriaConflitos(conflitos: Conflito[]) {
  try {
    const memoria = obterMemoriaConflitos();

    conflitos.forEach(c => {
      if (c.tipo === "disponibilidade") {
        memoria.professorIndisponivel++;
      } else if (c.tipo === "professor_duplo") {
        memoria.choqueHorario++;
      } else if (c.tipo === "turma_dupla") {
        memoria.choqueHorario++;
      } else if (c.tipo === "carga_excedida") {
        memoria.limiteDiario++;
      } else if (c.descricao.toLowerCase().includes("gemina")) {
        memoria.geminacao++;
      } else if (c.descricao.toLowerCase().includes("contra") || c.descricao.toLowerCase().includes("noite")) {
        memoria.contraturno++;
      }
    });

    localStorage.setItem(CONFLITOS_KEY, JSON.stringify(memoria));
  } catch (err) {
    console.error("Erro ao salvar memória de conflitos:", err);
  }
}

export function obterMemoriaConflitos(): MemoriaConflitos {
  const padrao: MemoriaConflitos = {
    professorIndisponivel: 0,
    contraturno: 0,
    limiteDiario: 0,
    geminacao: 0,
    choqueHorario: 0
  };

  try {
    const raw = localStorage.getItem(CONFLITOS_KEY);
    if (!raw) return padrao;
    const parsed = JSON.parse(raw);
    return {
      professorIndisponivel: parsed.professorIndisponivel ?? 0,
      contraturno: parsed.contraturno ?? 0,
      limiteDiario: parsed.limiteDiario ?? 0,
      geminacao: parsed.geminacao ?? 0,
      choqueHorario: parsed.choqueHorario ?? 0
    };
  } catch {
    return padrao;
  }
}

/**
 * 8. APRENDIZADO DAS ALTERAÇÕES MANUAIS DO USUÁRIO
 * Analisa as edições salvas no histórico de modificações manuais do usuário.
 * Se o mesmo comportamento/ajuste for detectado múltiplas vezes (ex: sempre concentrar contraturno na segunda),
 * gera uma heurística de aprendizado e ajusta pesos futuros.
 */
export function analisarAjustesManuais(
  historico: HistoricoAprendizado[],
  turmas: Turma[],
  professores: Professor[]
): PadraoAjusteManual[] {
  if (historico.length === 0) return [];

  const padroes: PadraoAjusteManual[] = [];

  // 1. Analisa concentração de aulas das turmas de contraturno
  // Se o usuário adicionou ou inseriu aulas de turmas de contraturno repetidamente em determinados dias
  const contraturnoInsertions: Record<string, number> = {};
  
  // 2. Analisa preferências de dia de semana por professor
  const professorDiaPreferences: Record<string, number> = {};

  // 3. Analisa preferências de horário por professor
  const professorHorarioPreferences: Record<string, number> = {};

  historico.forEach(item => {
    if (item.operacao === "insercao" || item.operacao === "bloqueio") {
      const t = turmas.find(x => x.id === item.turmaId);
      const isContraturno = t && (t.turno === "tarde" || t.turno === "noite" || t.nome.toLowerCase().includes("contra"));
      
      if (isContraturno) {
        const key = `${item.turmaId}|${item.diaSemana}`;
        contraturnoInsertions[key] = (contraturnoInsertions[key] || 0) + 1;
      }

      const keyProfDia = `${item.professorId}|${item.diaSemana}`;
      professorDiaPreferences[keyProfDia] = (professorDiaPreferences[keyProfDia] || 0) + 1;

      const keyProfHorario = `${item.professorId}|${item.horario}`;
      professorHorarioPreferences[keyProfHorario] = (professorHorarioPreferences[keyProfHorario] || 0) + 1;
    }
  });

  // Transforma as contagens de contraturno em padrões (Limiar de ocorrência: >= 3 vezes)
  Object.keys(contraturnoInsertions).forEach(key => {
    const freq = contraturnoInsertions[key];
    if (freq >= 3) {
      const [turmaId, dia] = key.split("|");
      const t = turmas.find(x => x.id === turmaId);
      padroes.push({
        id: `p_manual_contra_${turmaId}_${dia}`,
        tipo: "concentracao_aulas",
        descricao: `Concentrar aulas da turma de contraturno "${t?.nome || turmaId}" preferencialmente na ${dia}-feira (Ajustado manualmente ${freq} vezes pelo usuário).`,
        turmaId,
        diaSemana: dia,
        frequencia: freq,
        ativo: true
      });
    }
  });

  // Transforma preferências de dia do professor em padrões (Limiar: >= 3 vezes)
  Object.keys(professorDiaPreferences).forEach(key => {
    const freq = professorDiaPreferences[key];
    if (freq >= 3) {
      const [professorId, dia] = key.split("|");
      const p = professores.find(x => x.id === professorId);
      if (p) {
        padroes.push({
          id: `p_manual_prof_dia_${professorId}_${dia}`,
          tipo: "preferencia_dia",
          descricao: `Alocar aulas do docente "${p.nomeCompleto}" preferencialmente na ${dia}-feira (Ajustado ${freq} vezes pelo usuário).`,
          professorId,
          diaSemana: dia,
          frequencia: freq,
          ativo: true
        });
      }
    }
  });

  // Transforma preferências de horário do professor em padrões (Limiar: >= 3 vezes)
  Object.keys(professorHorarioPreferences).forEach(key => {
    const freq = professorHorarioPreferences[key];
    if (freq >= 3) {
      const [professorId, horarioStr] = key.split("|");
      const p = professores.find(x => x.id === professorId);
      const horario = Number(horarioStr);
      if (p) {
        padroes.push({
          id: `p_manual_prof_hor_${professorId}_${horario}`,
          tipo: "preferencia_horario",
          descricao: `Alocar aulas do docente "${p.nomeCompleto}" preferencialmente no horário ${horario + 1}º (Ajustado ${freq} vezes pelo usuário).`,
          professorId,
          horario,
          frequencia: freq,
          ativo: true
        });
      }
    }
  });

  return padroes;
}

export function salvarPadroesManuais(padroes: PadraoAjusteManual[]) {
  try {
    localStorage.setItem(PADROES_MANUAIS_KEY, JSON.stringify(padroes));
  } catch (err) {
    console.error("Erro ao salvar padrões de ajustes manuais:", err);
  }
}

export function obterPadroesManuais(): PadraoAjusteManual[] {
  try {
    const raw = localStorage.getItem(PADROES_MANUAIS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * 10. ATIVAR / DESATIVAR MOTOR DE APRENDIZADO (Auditoria)
 * Permite ao usuário ligar ou desligar as decisões automáticas inteligentes do MBIG.
 */
export function isLearningEnabled(): boolean {
  try {
    const raw = localStorage.getItem(LEARNING_ENABLED_KEY);
    return raw === null ? true : raw === "true"; // Ativo por padrão
  } catch {
    return true;
  }
}

export function toggleLearning(enabled: boolean) {
  try {
    localStorage.setItem(LEARNING_ENABLED_KEY, String(enabled));
  } catch (err) {
    console.error("Erro ao alternar ativação do aprendizado:", err);
  }
}
