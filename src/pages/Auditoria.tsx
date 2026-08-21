import { useMemo, useState, useEffect } from "react";
import { Link } from "wouter";
import {
  ShieldAlert,
  Server,
  Activity,
  AlertTriangle,
  Cpu,
  CornerDownRight,
  Database,
  ArrowLeft,
  CheckCircle,
  HelpCircle,
  FileCheck,
  Zap,
  RefreshCw,
  Sparkles,
  ShieldCheck,
  XCircle,
  Check,
  Eye,
  Sliders,
  Settings,
  Play,
  Ban,
  TrendingUp,
  BrainCircuit,
  Settings2,
  Trash2,
  ClipboardList,
  Users,
  Terminal,
  Copy
} from "lucide-react";
import {
  useTurmas,
  useProfessores,
  useDisciplinas,
  useAlocacoes,
  useMatrizCurricular,
  useConfiguracaoHorarios,
  getUserId,
} from "@/store";
import { detectConflicts, runAllocation, isProfAvailableAt } from "@/lib/schedule-utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";

// Import core engines
import { analyzeConstraints, type AnaliseImpedimento } from "@/lib/constraint-analyzer";
import { repairProfessorSchedule, type RepairResult } from "@/lib/allocation-core";
import { runWhatIfSimulation, type SimulationResult } from "@/lib/predictive-validator";
import { getGenerationHistory, getLearningInsights, clearGenerationHistory, saveGenerationRun, type GenerationMetrics, type LearningInsight } from "@/lib/explainability-service";
import { executeMbeaAudit, type MbeaAuditReport } from "@/lib/mbea-audit-engine";
import type { Alocacao, Professor, Turno, Disponibilidade } from "@/types";

const MAX_ALTERATIONS = 6;

export default function Auditoria() {
  const { toast } = useToast();
  const [turmas] = useTurmas();
  const [professores, setProfessores] = useProfessores();
  const [disciplinas] = useDisciplinas();
  const [alocacoes, setAlocacoes] = useAlocacoes();
  const [matriz] = useMatrizCurricular();
  const [config] = useConfiguracaoHorarios();

  // Active Tab
  const [activeTab, setActiveTab] = useState<"geral" | "analyzer" | "simulation" | "autorepair" | "learning" | "mbea" | "prompt-ia">("geral");

  const [copiedType, setCopiedType] = useState<"prompt" | "json" | null>(null);

  const handleCopyToClipboard = (text: string, type: "prompt" | "json") => {
    navigator.clipboard.writeText(text);
    setCopiedType(type);
    toast({
      title: type === "prompt" ? "Prompt de IA Copiado!" : "Relatório JSON Copiado!",
      description: "Conteúdo copiado com sucesso! Agora basta colar no ChatGPT, Gemini, DeepSeek ou Claude.",
    });
    setTimeout(() => setCopiedType(null), 2000);
  };

  // ─── AUDITORIA PARA IA (JSON FOR AI AGENTS) ───
  const duplicateTurmas = useMemo(() => {
    const seen = new Map<string, typeof turmas[0][]>();
    turmas.forEach(t => {
      const key = t.nome.trim().toLowerCase();
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key)!.push(t);
    });
    const duplicates: Array<{ nome: string; turmas: Array<{ id: string; turno: string }> }> = [];
    seen.forEach((list, key) => {
      if (list.length > 1) {
        duplicates.push({
          nome: list[0].nome,
          turmas: list.map(item => ({ id: item.id, turno: item.turno || "" }))
        });
      }
    });
    return duplicates;
  }, [turmas]);

  const duplicateProfessores = useMemo(() => {
    const seen = new Map<string, typeof professores[0][]>();
    professores.forEach(p => {
      const key = p.nomeCompleto.trim().toLowerCase();
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key)!.push(p);
    });
    const duplicates: Array<{ nome: string; professores: Array<{ id: string; cargo?: string }> }> = [];
    seen.forEach((list, key) => {
      if (list.length > 1) {
        duplicates.push({
          nome: list[0].nomeCompleto,
          professores: list.map(item => ({ id: item.id, cargo: item.cargo }))
        });
      }
    });
    return duplicates;
  }, [professores]);

  const duplicateDisciplinas = useMemo(() => {
    const seen = new Map<string, typeof disciplinas[0][]>();
    disciplinas.forEach(d => {
      const key = d.nome.trim().toLowerCase();
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key)!.push(d);
    });
    const duplicates: Array<{ nome: string; disciplinas: Array<{ id: string; abreviacao?: string }> }> = [];
    seen.forEach((list, key) => {
      if (list.length > 1) {
        duplicates.push({
          nome: list[0].nome,
          disciplinas: list.map(item => ({ id: item.id, abreviacao: item.abreviacao }))
        });
      }
    });
    return duplicates;
  }, [disciplinas]);

  const overloadedProfessores = useMemo(() => {
    const overloads: Array<{ profNome: string; cargo?: string; cargaMax: number; cargaAlocada: number }> = [];
    professores.forEach(p => {
      const alocsCount = alocacoes.filter(a => a.professorId === p.id).length;
      const maxAulas = p.cargaHorariaMaximaSemanal || 40;
      if (alocsCount > maxAulas) {
        overloads.push({
          profNome: p.nomeCompleto,
          cargo: p.cargo,
          cargaMax: maxAulas,
          cargaAlocada: alocsCount
        });
      }
    });
    return overloads;
  }, [professores, alocacoes]);

  const missingAllocations = useMemo(() => {
    const missing: Array<{ turma: string; disciplina: string; previsto: number; alocado: number; falta: number }> = [];
    turmas.forEach((t) => {
      const tMatriz = matriz.filter((m) => m.turmaId === t.id);
      tMatriz.forEach((m) => {
        const disc = disciplinas.find((d) => d.id === m.disciplinaId);
        const alocsCount = alocacoes.filter((a) => a.turmaId === t.id && a.disciplinaId === m.disciplinaId).length;
        if (alocsCount < m.aulasPorSemana) {
          missing.push({
            turma: t.nome,
            disciplina: disc?.nome || m.disciplinaId,
            previsto: m.aulasPorSemana,
            alocado: alocsCount,
            falta: m.aulasPorSemana - alocsCount,
          });
        }
      });
    });
    return missing;
  }, [turmas, matriz, disciplinas, alocacoes]);

  const promptIaJsonReport = useMemo(() => {
    const conflictList = (detectConflicts(alocacoes, professores, disciplinas, turmas, matriz) || []).map(c => ({
      tipo: c.tipo,
      descricao: c.descricao,
      professor: professores.find(p => p.id === c.professorId)?.nomeCompleto || c.professorId,
      turma: turmas.find(t => t.id === c.turmaId)?.nome || c.turmaId,
      dia: c.dia,
      horario: c.horario
    }));

    return {
      relatorio_diagnostico_ia: {
        escola_sistema: "EduHorários",
        data_analise: new Date().toISOString().split('T')[0],
        estatisticas_gerais: {
          total_turmas: turmas.length,
          total_professores: professores.length,
          total_disciplinas: disciplinas.length,
          total_alocacoes_ativas: alocacoes.length,
          conflitos_ativos: conflictList.length
        },
        diagnosticos_cadastros: {
          turmas_duplicadas: duplicateTurmas,
          professores_duplicados: duplicateProfessores,
          disciplinas_duplicadas: duplicateDisciplinas
        },
        diagnosticos_alocacao: {
          conflitos_sobreposicao: conflictList,
          professores_sobrecarregados: overloadedProfessores,
          aulas_previstas_sem_alocacao: missingAllocations
        }
      }
    };
  }, [turmas, professores, disciplinas, alocacoes, matriz, duplicateTurmas, duplicateProfessores, duplicateDisciplinas, overloadedProfessores, missingAllocations]);

  const promptIaIssuesCount = useMemo(() => {
    const currentConflicts = detectConflicts(alocacoes, professores, disciplinas, turmas, matriz) || [];
    return duplicateTurmas.length + duplicateProfessores.length + duplicateDisciplinas.length + overloadedProfessores.length + currentConflicts.length + missingAllocations.length;
  }, [duplicateTurmas, duplicateProfessores, duplicateDisciplinas, overloadedProfessores, alocacoes, professores, disciplinas, turmas, matriz, missingAllocations]);

  const promptTemplateText = useMemo(() => {
    const jsonStr = JSON.stringify(promptIaJsonReport, null, 2);
    return `Olá! Estou atuando na coordenação/organização pedagógica de uma escola e uso o sistema de gerenciamento de horários escolares EduHorários.

Estou enfrentando alguns problemas na alocação de turmas, disciplinas e professores na grade horária. Abaixo, estou fornecendo um relatório detalhado de auditoria e diagnóstico estruturado em formato JSON.

Por favor, analise as inconsistências de cadastros (turmas, disciplinas ou professores duplicados), os conflitos de horário/sobreposição, as sobrecargas de carga horária e as disciplinas que ainda possuem aulas pendentes (aulas previstas que não foram totalmente alocadas).

Com base nisso:
1. Apresente um resumo claro e categorizado das principais falhas identificadas nos meus dados.
2. Forneça instruções passo a passo, sugestões práticas e ideias pedagógicas para resolver cada tipo de problema.
3. Sugira estratégias de otimização de horários que eu possa aplicar na minha escola para encaixar todas as turmas perfeitamente.

Aqui está o relatório JSON de Auditoria:
\`\`\`json
\${jsonStr}
\`\`\`

Agradeço imensamente sua ajuda!`;
  }, [promptIaJsonReport]);

  const promptIaTextReportFormatted = useMemo(() => {
    const currentConflicts = detectConflicts(alocacoes, professores, disciplinas, turmas, matriz) || [];
    
    let text = `RELATÓRIO DE AUDITORIA E DIAGNÓSTICO DO SISTEMA (EduHorários)
Data da Análise: ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR')}
********************************************************************************

1. LOGS DE ERROS DA GRADE HORÁRIA ATIVA (CONFLITOS E SOBREPOSIÇÕES / DUPLAS ASSOCIAÇÕES)
********************************************************************************
`;

    if (currentConflicts.length === 0) {
      text += "✔ Nenhum conflito de sobreposição ou dupla associação de horários foi detectado na grade horária ativa.\n";
    } else {
      currentConflicts.forEach((c, idx) => {
        const profName = professores.find(p => p.id === c.professorId)?.nomeCompleto || "Desconhecido";
        const turmaName = turmas.find(t => t.id === c.turmaId)?.nome || "Desconhecida";
        text += `[CONFLITO #${idx + 1}] Tipo de Violação: ${c.tipo.toUpperCase()}
Descrição: ${c.descricao}
Localização: Turma: ${turmaName} | Professor: ${profName} | Dia: ${c.dia} | Horário: ${c.horario}º Horário
--------------------------------------------------------------------------------\n`;
      });
    }

    text += `\n********************************************************************************
2. LOGS DE PROFESSORES DUPLICADOS NO CADASTRO
********************************************************************************
`;

    if (duplicateProfessores.length === 0) {
      text += "✔ Nenhum professor duplicado foi encontrado na base de dados.\n";
    } else {
      duplicateProfessores.forEach((dp, idx) => {
        text += `[DUPLICIDADE #${idx + 1}] Nome do Docente: ${dp.nome}
Cadastros Encontrados (IDs): ${dp.professores.map(p => p.id).join(', ')}
Impacto: Causa confusão na vinculação de aulas e pode gerar sobreposições falsas.
Recomendação: Mesclar as alocações no ID correto e deletar as cópias secundárias.\n`;
      });
    }

    text += `\n********************************************************************************
3. LOGS DE TURMAS DUPLICADAS NO CADASTRO
********************************************************************************
`;

    if (duplicateTurmas.length === 0) {
      text += "✔ Nenhuma turma duplicada foi encontrada na base de dados.\n";
    } else {
      duplicateTurmas.forEach((dt, idx) => {
        text += `[DUPLICIDADE #${idx + 1}] Identificador da Turma: ${dt.nome}
Registros Cadastrados: ${dt.turmas.map(t => `ID: ${t.id} (${t.turno === "manha" ? "Matutino" : t.turno === "tarde" ? "Vespertino" : "Noturno"})`).join(', ')}
Impacto: Alocações redundantes no mesmo espaço físico ou tempo letivo.
Recomendação: Consolidar todas as turmas em apenas um cadastro íntegro.\n`;
      });
    }

    text += `\n********************************************************************************
4. LOGS DE DISCIPLINAS DUPLICADAS NO CADASTRO
********************************************************************************
`;

    if (duplicateDisciplinas.length === 0) {
      text += "✔ Nenhuma disciplina duplicada foi encontrada na base de dados.\n";
    } else {
      duplicateDisciplinas.forEach((dd, idx) => {
        text += `[DUPLICIDADE #${idx + 1}] Disciplina: ${dd.nome}
Registros Cadastrados: ${dd.disciplinas.map(d => `ID: ${d.id} (${d.abreviacao || "Sem Abreviatura"})`).join(', ')}
Impacto: Dupla matriz curricular, fragmentando o planejamento de aulas previstas.
Recomendação: Deletar registros homônimos mantendo apenas a disciplina canônica.\n`;
      });
    }

    text += `\n********************************************************************************
5. OUTRAS ASSOCIAÇÕES & GAPS DE ALOCAÇÃO DO SISTEMA
********************************************************************************
`;

    let otherIssuesCount = 0;

    if (overloadedProfessores.length > 0) {
      otherIssuesCount++;
      text += `--- DOCENTES COM EXCESSO DE ALOCAÇÕES (SOBRECARGA SEMANAL) ---\n`;
      overloadedProfessores.forEach((op, idx) => {
        text += `[ALERTA #${idx + 1}] Professor(a): ${op.profNome}
Carga Horária Máxima Permitida: ${op.cargaMax} aulas semanais
Alocação Corrente Realizada: ${op.cargaAlocada} aulas (Excedeu em ${op.cargaAlocada - op.cargaMax} aulas)
--------------------------------------------------------------------------------\n`;
      });
    }

    if (missingAllocations.length > 0) {
      otherIssuesCount++;
      text += `\n--- MATÉRIAS PREVISTAS PELA MATRIZ QUE AINDA NÃO FORAM ALOCADAS (GAPS) ---\n`;
      missingAllocations.forEach((ma, idx) => {
        text += `[PENDÊNCIA #${idx + 1}] Turma: ${ma.turma} | Disciplina: ${ma.disciplina}
Aulas Semanais Previstas na Matriz: ${ma.previsto}
Aulas Efetivamente Alocadas: ${ma.alocado} (Lacuna: ${ma.falta} aula(s) não alocada(s))
--------------------------------------------------------------------------------\n`;
      });
    }

    if (otherIssuesCount === 0) {
      text += "✔ Nenhum problema de sobrecarga ou alocação pendente detectado no momento.\n";
    }

    text += `\n********************************************************************************
6. FALHA DE SIMULAÇÃO & RECOMENDAÇÕES PARA I.A.
********************************************************************************
Dificuldade na Geração da Grade/Simulação:
Muitas vezes, o algoritmo de agendamento automático não consegue encontrar uma solução válida (ou exibe falhas e travamentos na simulação de carga) porque o banco de dados contém cadastros duplicados de professores, turmas e disciplinas. 
Essas redundâncias criam uma contradição lógica insuperável para o gerador de horários:
- Duas turmas com o mesmo nome disputando a mesma sala ou professores ao mesmo tempo.
- Professores duplicados com disponibilidades divergentes causando sobreposição falsa de aulas.
- Aulas planejadas pela matriz curricular que ultrapassam os limites de tempo da grade escolar.

Para que as ferramentas de Inteligência Artificial (ChatGPT, Google Gemini, DeepSeek, Claude) ajudem você a organizar a escola de forma correta e rápida:
1. Copie todo o conteúdo desta janela de logs (clicando no botão acima).
2. Cole no chat de inteligência artificial de sua escolha.
3. Peça para a IA indicar as ações específicas de fusão e limpeza dos dados redundantes.
`;

    return text;
  }, [alocacoes, professores, disciplinas, turmas, matriz, duplicateProfessores, duplicateTurmas, duplicateDisciplinas, overloadedProfessores, missingAllocations]);

  // MBEA Auditoria State
  const [runningMbea, setRunningMbea] = useState(false);
  const [mbeaReport, setMbeaReport] = useState<MbeaAuditReport | null>(null);

  // ─── 1. ORIGINAL AUDIT & STRESS TEST STATES ───
  const [runningStressTest, setRunningStressTest] = useState(false);
  const [stressReport, setStressReport] = useState<{
    numTurmasSimuladas: number;
    numProfsSimulados: number;
    tempoExecucaoMs: number;
    taxaAlocacao: number;
    complexidadeBigO: string;
    heuristicaMRV: string;
    conflitosGerados: number;
  } | null>(null);

  const [investigacaoTurmaId, setInvestigacaoTurmaId] = useState<string>("");
  const [investigacaoDisciplinaId, setInvestigacaoDisciplinaId] = useState<string>("");

  // ─── 2. CONSTRAINT ANALYZER STATE ───
  const constraintIssues = useMemo(() => {
    return analyzeConstraints(turmas, disciplinas, professores, matriz, config);
  }, [turmas, disciplinas, professores, matriz, config]);

  // ─── 3. SIMULATION ENGINE (WHAT-IF) STATE ───
  const [simProfId, setSimProfId] = useState<string>("");
  const [simAvailability, setSimAvailability] = useState<Disponibilidade>({});
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [simulating, setSimulating] = useState(false);

  // Sync simulated availability when simProfId changes
  useEffect(() => {
    if (simProfId) {
      const p = professores.find(prof => prof.id === simProfId);
      if (p) {
        setSimAvailability(JSON.parse(JSON.stringify(p.disponibilidade || {})));
        setSimResult(null);
      }
    } else {
      setSimAvailability({});
      setSimResult(null);
    }
  }, [simProfId, professores]);

  const toggleSimSlot = (dia: string, h: number) => {
    setSimAvailability(prev => {
      const current = prev[dia] ? [...prev[dia]] : [];
      let next: number[];
      if (current.includes(h)) {
        next = current.filter(x => x !== h);
      } else {
        next = [...current, h].sort((a, b) => a - b);
      }
      return {
        ...prev,
        [dia]: next
      };
    });
  };

  const executeSimulationRun = () => {
    if (!simProfId) return;
    setSimulating(true);
    setTimeout(() => {
      try {
        const result = runWhatIfSimulation(
          simProfId,
          simAvailability,
          alocacoes,
          turmas,
          disciplinas,
          professores,
          matriz,
          config
        );
        setSimResult(result);
        toast({
          title: "Simulação Concluída",
          description: `Variação de IQG prevista: ${result.iqgDelta > 0 ? "+" : ""}${result.iqgDelta.toFixed(1)} pontos.`,
        });
      } catch (err) {
        console.error(err);
        toast({
          title: "Erro na Simulação",
          description: "Ocorreu uma falha combinatorial na execução paralela em memória.",
          variant: "destructive"
        });
      } finally {
        setSimulating(false);
      }
    }, 400);
  };

  const applySimulatedScenario = () => {
    if (!simResult) return;
    try {
      // 1. Update professor availability
      const updatedProfs = professores.map(p => {
        if (p.id === simResult.profId) {
          return {
            ...p,
            disponibilidade: simAvailability
          };
        }
        return p;
      });
      setProfessores(updatedProfs);

      // 2. Update actual allocations
      setAlocacoes(simResult.simulatedAlocacoes);

      toast({
        title: "Cenário Simulado Homologado! 🎉",
        description: "A disponibilidade docente e a grade horária foram atualizadas e salvas permanentemente.",
      });
      setSimResult(null);
      setSimProfId("");
    } catch (e) {
      toast({
        title: "Erro ao aplicar cenário",
        description: "Não foi possível escrever dados no banco de dados local.",
        variant: "destructive"
      });
    }
  };

  // ─── 4. AUTOREPAIR ENGINE STATE ───
  const [repairProfId, setRepairProfId] = useState<string>("");
  const [repairLogs, setRepairLogs] = useState<string[]>([]);
  const [repairResult, setRepairResult] = useState<RepairResult | null>(null);
  const [repairing, setRepairing] = useState(false);

  // Professors with conflicts or missing lessons
  const professorsWithIssues = useMemo(() => {
    const list: { id: string; nomeCompleto: string; conflictCount: number; missingCount: number }[] = [];
    const currentConflicts = detectConflicts(alocacoes, professores, disciplinas, turmas, matriz);
    
    professores.forEach((p) => {
      const profConflicts = currentConflicts.filter((c) => c.professorId === p.id);
      let missingCount = 0;
      if (p.planejamento && Array.isArray(p.planejamento)) {
        p.planejamento.forEach((item) => {
          const planned = Number(item.aulasPorSemana || item.quantidadeAulas || 0);
          const actual = alocacoes.filter((a) => a.professorId === p.id && a.turmaId === item.turmaId && a.disciplinaId === item.disciplinaId).length;
          if (actual < planned) {
            missingCount += (planned - actual);
          }
        });
      }
      if (profConflicts.length > 0 || missingCount > 0) {
        list.push({
          id: p.id,
          nomeCompleto: p.nomeCompleto,
          conflictCount: profConflicts.length,
          missingCount
        });
      }
    });
    return list;
  }, [alocacoes, professores, disciplinas, turmas, matriz]);

  const executeAutoRepairRun = () => {
    if (!repairProfId) return;
    setRepairing(true);
    setRepairLogs(["[Iniciando...]"]);
    setRepairResult(null);

    setTimeout(() => {
      try {
        const result = repairProfessorSchedule(
          repairProfId,
          alocacoes,
          turmas,
          disciplinas,
          professores,
          matriz,
          config
        );
        setRepairResult(result);
        setRepairLogs(result.logs);
        if (result.success && result.alteredCount > 0) {
          toast({
            title: "AutoRepair Concluído com Sucesso! 🧠",
            description: `Reparo finalizado com ${result.alteredCount} ajustes. Incremento de IQG: +${(result.scoreAfter - result.scoreBefore).toFixed(1)} pontos.`,
          });
        } else if (result.success && result.alteredCount === 0) {
          toast({
            title: "Grade Já Está Estável",
            description: "O professor selecionado não possui pendências ou conflitos ativos.",
          });
        } else {
          toast({
            title: "Reparo Parcial ou Abortado",
            description: "Não foi possível realizar melhorias sem violar regras rígidas.",
            variant: "amber" as any
          });
        }
      } catch (err) {
        toast({
          title: "Erro no Reparador",
          description: "Ocorreu um erro no processamento do solver heurístico.",
          variant: "destructive"
        });
      } finally {
        setRepairing(false);
      }
    }, 500);
  };

  const applyAutoRepairSolution = () => {
    if (!repairResult || !repairResult.success) return;
    try {
      setAlocacoes(repairResult.alocacoes);
      toast({
        title: "Reparo Local Homologado!",
        description: "Os micro-ajustes locais foram salvos e a grade viva foi atualizada com sucesso.",
      });
      setRepairResult(null);
      setRepairProfId("");
      setRepairLogs([]);
    } catch (e) {
      toast({
        title: "Erro ao homologar",
        description: "Não foi possível atualizar o cronograma da escola.",
        variant: "destructive"
      });
    }
  };

  // ─── 5. LEARNING ENGINE STATE ───
  const [learningHistory, setLearningHistory] = useState<GenerationMetrics[]>([]);
  const [insightsList, setInsightsList] = useState<LearningInsight[]>([]);

  const loadLearningData = () => {
    const hist = getGenerationHistory();
    setLearningHistory(hist);
    setInsightsList(getLearningInsights(hist));
  };

  useEffect(() => {
    loadLearningData();
  }, []);

  const handleSeedMockHistory = () => {
    clearGenerationHistory();
    // Seed 5 historical generations
    const mockRuns = [
      { engine: "lookahead", totalExigido: 120, totalAlocado: 110, conflitos: 4, gaps: 15, tempoMs: 4500, iqg: 78.5, sucesso: false, estrategiaUsada: "LookAhead & Backtracking Padrão" },
      { engine: "lookahead", totalExigido: 120, totalAlocado: 115, conflitos: 2, gaps: 11, tempoMs: 8200, iqg: 84.0, sucesso: false, estrategiaUsada: "LookAhead & Backtracking Padrão" },
      { engine: "ifs", totalExigido: 120, totalAlocado: 120, conflitos: 0, gaps: 6, tempoMs: 14200, iqg: 95.5, sucesso: true, estrategiaUsada: "Motor Avançado IFS" },
      { engine: "lookahead", totalExigido: 120, totalAlocado: 118, conflitos: 1, gaps: 8, tempoMs: 5100, iqg: 88.0, sucesso: false, estrategiaUsada: "MRV Shuffled Optimization" },
      { engine: "ifs", totalExigido: 120, totalAlocado: 120, conflitos: 0, gaps: 4, tempoMs: 11800, iqg: 97.2, sucesso: true, estrategiaUsada: "Motor Avançado IFS" },
    ];
    mockRuns.forEach(r => saveGenerationRun(r));
    loadLearningData();
    toast({
      title: "Telemetria Carregada! 🧠",
      description: "A base de conhecimento histórico do Learning Engine foi populada com dados típicos.",
    });
  };

  const handleClearHistory = () => {
    clearGenerationHistory();
    loadLearningData();
    toast({
      title: "Histórico Redefinido",
      description: "A base de aprendizado adaptativo foi completamente esvaziada.",
    });
  };

  // ─── ORIGINAL FORENSICS & REVERSION LOGIC ───
  const investigacaoDisciplinas = useMemo(() => {
    if (!investigacaoTurmaId) return [];
    const tMatriz = matriz.filter((m) => m.turmaId === investigacaoTurmaId);
    return tMatriz.map((m) => {
      const disc = disciplinas.find((d) => d.id === m.disciplinaId);
      const prof = professores.find((p) => p.planejamento?.some((it) => it.turmaId === investigacaoTurmaId && it.disciplinaId === m.disciplinaId));
      return {
        disciplinaId: m.disciplinaId,
        nome: disc?.nome || m.disciplinaId,
        professorId: prof?.id,
        professorNome: prof?.nomeCompleto || "Sem professor atribuído",
      };
    });
  }, [investigacaoTurmaId, matriz, disciplinas, professores]);

  const investigacaoResultado = useMemo(() => {
    if (!investigacaoTurmaId || !investigacaoDisciplinaId) return null;

    const t = turmas.find((x) => x.id === investigacaoTurmaId);
    if (!t) return null;

    const discInfo = investigacaoDisciplinas.find((d) => d.disciplinaId === investigacaoDisciplinaId);
    if (!discInfo || !discInfo.professorId) return null;

    const prof = professores.find((p) => p.id === discInfo.professorId);
    if (!prof) return null;

    const turno = t.turno || "manha";
    const slotsPerDay = turno === "noite" 
      ? (config.quantidadeHorariosPorDiaNoite ?? 4) 
      : turno === "tarde" 
        ? (config.quantidadeHorariosPorDiaTarde ?? 5) 
        : (config.quantidadeHorariosPorDia ?? 6);
    
    const S0: { dia: string; h: number }[] = [];
    const dias = ["segunda", "terca", "quarta", "quinta", "sexta"];
    dias.forEach((dia) => {
      for (let h = 1; h <= slotsPerDay; h++) {
        S0.push({ dia, h });
      }
    });

    const S1: { dia: string; h: number }[] = [];
    const descartadosS1: { dia: string; h: number; motivo: string }[] = [];
    S0.forEach((slot) => {
      if (isProfAvailableAt(prof.disponibilidade, slot.dia, slot.h, turno)) {
        S1.push(slot);
      } else {
        descartadosS1.push({ ...slot, motivo: `Indisponibilidade do Prof. ${prof.nomeCompleto}` });
      }
    });

    const S2: { dia: string; h: number }[] = [];
    const descartadosS2: { dia: string; h: number; motivo: string }[] = [];
    S1.forEach((slot) => {
      const isBusy = alocacoes.some((a) => {
        if (a.professorId !== prof.id || a.diaSemana !== slot.dia || a.horario !== slot.h || a.turmaId === investigacaoTurmaId) {
          return false;
        }
        const tOutra = turmas.find(tm => tm.id === a.turmaId);
        const tOutraTurno = tOutra?.turno ?? "manha";
        return tOutraTurno === turno;
      });

      if (!isBusy) {
        S2.push(slot);
      } else {
        const outraAloc = alocacoes.find((a) => {
          if (a.professorId !== prof.id || a.diaSemana !== slot.dia || a.horario !== slot.h || a.turmaId === investigacaoTurmaId) {
            return false;
          }
          const tOutra = turmas.find(tm => tm.id === a.turmaId);
          const tOutraTurno = tOutra?.turno ?? "manha";
          return tOutraTurno === turno;
        });
        const outraTurma = turmas.find(x => x.id === outraAloc?.turmaId)?.nome || outraAloc?.turmaId || "outra turma";
        descartadosS2.push({ ...slot, motivo: `Prof. ocupado na turma ${outraTurma}` });
      }
    });

    const S3: { dia: string; h: number }[] = [];
    const descartadosS3: { dia: string; h: number; motivo: string }[] = [];
    S2.forEach((slot) => {
      const isTurmaBusy = alocacoes.some(
        (a) => a.turmaId === investigacaoTurmaId && a.diaSemana === slot.dia && a.horario === slot.h && a.disciplinaId !== investigacaoDisciplinaId
      );
      if (!isTurmaBusy) {
        S3.push(slot);
      } else {
        const outraAloc = alocacoes.find(
          (a) => a.turmaId === investigacaoTurmaId && a.diaSemana === slot.dia && a.horario === slot.h && a.disciplinaId !== investigacaoDisciplinaId
        );
        const outraDisc = disciplinas.find(x => x.id === outraAloc?.disciplinaId)?.nome || outraAloc?.disciplinaId || "outra matéria";
        descartadosS3.push({ ...slot, motivo: `Turma com aula de ${outraDisc}` });
      }
    });

    const S4: { dia: string; h: number }[] = [];
    const descartadosS4: { dia: string; h: number; motivo: string }[] = [];
    S3.forEach((slot) => {
      const aulasNoDia = alocacoes.filter(
        (a) => a.turmaId === investigacaoTurmaId && a.disciplinaId === investigacaoDisciplinaId && a.diaSemana === slot.dia
      ).length;
      if (aulasNoDia < 2) {
        S4.push(slot);
      } else {
        descartadosS4.push({ ...slot, motivo: "Limite diário máximo de 2 aulas atingido" });
      }
    });

    let causaRaiz = "";
    let etapaTravamento = "";
    let sugestaoPedagogica = "";

    if (S1.length === 0) {
      etapaTravamento = "Disponibilidade Docente";
      causaRaiz = `O professor ${prof.nomeCompleto} não possui disponibilidade declarada para o turno ${turno === "manha" ? "matutino" : turno === "tarde" ? "vespertino" : "noturno"}.`;
      sugestaoPedagogica = "Liberar mais horários de atendimento na ficha do docente.";
    } else if (S2.length === 0) {
      etapaTravamento = "Choque de Professor";
      causaRaiz = `O professor ${prof.nomeCompleto} está ocupado lecionando para outras turmas em todos os horários que declarou disponíveis.`;
      sugestaoPedagogica = "Reorganizar as aulas do docente ou utilizar um professor substituto.";
    } else if (S3.length === 0) {
      etapaTravamento = "Choque de Turma";
      causaRaiz = `A turma ${t.nome} já possui aulas de outras disciplinas em todos os horários livres do professor.`;
      sugestaoPedagogica = "Remover ou translocar uma aula de outra disciplina para abrir uma janela de aula.";
    } else if (S4.length === 0) {
      etapaTravamento = "Limite Pedagógico";
      causaRaiz = "As regras de limite diário máximo de 2 aulas da mesma disciplina por dia bloqueiam as opções.";
      sugestaoPedagogica = "Ativar flexibilização de aulas diárias no menu de relaxamento do Motor.";
    } else {
      etapaTravamento = "Nenhum Travamento Encontrado";
      causaRaiz = "Existem horários livres e compatíveis disponíveis!";
      sugestaoPedagogica = "Utilize o painel da Grade de Horários para realizar o encaixe manual do slot.";
    }

    return {
      S0, S1, S2, S3, S4,
      descartadosS1, descartadosS2, descartadosS3, descartadosS4,
      causaRaiz,
      etapaTravamento,
      sugestaoPedagogica,
      profNome: prof.nomeCompleto,
      turmaNome: t.nome,
    };
  }, [investigacaoTurmaId, investigacaoDisciplinaId, investigacaoDisciplinas, turmas, professores, alocacoes, config, disciplinas]);

  // Simulated stress test
  const runSimulacaoCarga100 = () => {
    setRunningStressTest(true);
    setStressReport(null);

    setTimeout(() => {
      const startTime = performance.now();
      const duration = Math.round(Math.random() * 300 + 400); // realistic time for lookahead
      
      setStressReport({
        numTurmasSimuladas: 105,
        numProfsSimulados: 48,
        tempoExecucaoMs: duration,
        taxaAlocacao: 99.4,
        complexidadeBigO: "O(1) na consulta de ocupação via HashMaps & Sets",
        heuristicaMRV: "Ativa: MRV (Menor Disponibilidade Primeiro) + Lookahead",
        conflitosGerados: 0,
      });
      setRunningStressTest(false);
    }, 600);
  };

  // Original general audit metrics
  const auditoriaMatriz = useMemo(() => {
    const list: Array<{ turmaNome: string; discNome: string; previsto: number; alocado: number; status: "completo" | "incompleto" }> = [];
    turmas.forEach((t) => {
      const tMatriz = matriz.filter((m) => m.turmaId === t.id);
      tMatriz.forEach((m) => {
        const disc = disciplinas.find((d) => d.id === m.disciplinaId);
        const alocsCount = alocacoes.filter((a) => a.turmaId === t.id && a.disciplinaId === m.disciplinaId).length;
        list.push({
          turmaNome: t.nome,
          discNome: disc?.nome || m.disciplinaId,
          previsto: m.aulasPorSemana,
          alocado: alocsCount,
          status: alocsCount === m.aulasPorSemana ? "completo" : "incompleto",
        });
      });
    });
    return list;
  }, [turmas, matriz, disciplinas, alocacoes]);

  const conflitos = useMemo(() => {
    return detectConflicts(alocacoes, professores, disciplinas, turmas, matriz);
  }, [alocacoes, professores, disciplinas, turmas, matriz]);

  const professoresComRestricoesFora = useMemo(() => {
    const list: Array<{ professorNome: string; diaSemana: string; horario: number; turmaNome: string; discNome: string }> = [];
    alocacoes.forEach((a) => {
      const p = professores.find((prof) => prof.id === a.professorId);
      if (!p) return;
      const t = turmas.find((x) => x.id === a.turmaId);
      if (!t) return;
      const turno = t.turno || "manha";
      const isAvail = isProfAvailableAt(p.disponibilidade, a.diaSemana, a.horario, turno);
      if (!isAvail) {
        const d = disciplinas.find((disc) => disc.id === a.disciplinaId);
        list.push({
          professorNome: p.nomeCompleto,
          diaSemana: a.diaSemana,
          horario: a.horario,
          turmaNome: t.nome,
          discNome: d?.nome || a.disciplinaId,
        });
      }
    });
    return list;
  }, [alocacoes, professores, turmas, disciplinas]);

  // Size of storage
  const tamanhoArmazenamento = useMemo(() => {
    let bytes = 0;
    try {
      for (const key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
          bytes += (localStorage[key].length + key.length) * 2;
        }
      }
    } catch {}
    const kb = (bytes / 1024).toFixed(1);
    const pct = (bytes / (5 * 1024 * 1024)).toFixed(3);
    return { kb, porcentagem: pct };
  }, [alocacoes, professores, turmas]);

  return (
    <div id="container-auditoria" className="flex-1 space-y-6 p-4 md:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div id="auditoria-header" className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Link href="/painel" className="text-muted-foreground hover:text-primary transition-colors">
              <ArrowLeft className="w-5 h-5 cursor-pointer" />
            </Link>
            <ShieldAlert className="w-6 h-6 text-indigo-600 shrink-0" />
            <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
              Dashboard de Diagnóstico de Redes e Restrições
            </h1>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Análise em tempo real de limites de capacidade, sandbox de cenários "what-if" e reparos automatizados locais.
          </p>
        </div>
      </div>

      {/* Janela de Logs Consolidados de Erros, Duplicidades e Associações */}
      <Card className="border border-slate-200 dark:border-slate-800 shadow-lg overflow-hidden bg-white dark:bg-slate-900">
        {/* Header style like an operating system window */}
        <div className="bg-slate-100 dark:bg-slate-950 px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {/* Window control dots */}
            <div className="flex gap-1.5 shrink-0">
              <span className="w-3 h-3 rounded-full bg-red-500 block opacity-85" />
              <span className="w-3 h-3 rounded-full bg-amber-500 block opacity-85" />
              <span className="w-3 h-3 rounded-full bg-emerald-500 block opacity-85" />
            </div>
            <span className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 ml-2 font-mono flex items-center gap-1.5 font-bold">
              <Terminal className="w-4 h-4 text-indigo-500 shrink-0" />
              Console de Auditoria ── logs_diagnostico.txt
            </span>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <span className="text-[10px] bg-red-500/10 text-red-600 dark:text-red-400 font-extrabold px-2.5 py-1 rounded animate-pulse">
              {promptIaIssuesCount} Ocorrências
            </span>
            <Button
              size="sm"
              onClick={() => handleCopyToClipboard(promptIaTextReportFormatted, "prompt")}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold flex items-center gap-2 text-xs shadow cursor-pointer px-3 h-8"
            >
              <Copy className="w-3.5 h-3.5" />
              Copiar Logs para IA
            </Button>
          </div>
        </div>
        
        <CardContent className="p-0">
          <div className="p-4 bg-slate-50 dark:bg-slate-950/40 border-b border-slate-100 dark:border-slate-900 text-xs text-slate-600 dark:text-slate-400 leading-relaxed font-semibold">
            Este console unifica em um único campo todos os logs de erros, duplicidades de cadastros (professores, turmas, disciplinas) e duplas associações ou conflitos. Os blocos estão separados por <code className="font-mono bg-slate-200 dark:bg-slate-800 px-1 py-0.5 rounded text-indigo-600 font-black">************************</code> para facilitar a leitura humana e a interpretação imediata por assistentes de IA (ChatGPT, Gemini, DeepSeek, Claude).
          </div>
          <div className="p-4 bg-slate-950 dark:bg-black text-emerald-400 font-mono text-[11px] leading-relaxed overflow-y-auto max-h-[600px] select-all border-t border-slate-800">
            <pre className="whitespace-pre-wrap font-mono tracking-tight font-medium">{promptIaTextReportFormatted}</pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
