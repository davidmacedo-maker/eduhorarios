import { useState, useRef, useMemo, useEffect } from "react";
import { useTurmas, useProfessores, useDisciplinas, useAlocacoes, useConfiguracaoHorarios, useNomeEscola, useMatrizCurricular, generateId, useHistoricoAprendizado } from "@/store";
import { generateTimeSlotsForTurno, verificarSlotViavelComMotivo, isProfAvailableAt } from "@/lib/schedule-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Printer, Grid3x3, Pencil, Eye, Trash2, GripVertical, Plus, LayoutGrid, Sun, Sunset, Moon, AlertTriangle, Lock, Unlock, Sliders, Sparkles, CheckCircle2, XCircle, AlertCircle, AlertOctagon, Check, HelpCircle, X, User, Search, Brain } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import type { Alocacao } from "@/types";
import { motion, AnimatePresence } from "motion/react";

import { AuditoriaModal } from "@/components/AuditoriaModal";
import { corrigirExcessos, validarAlocacao } from "@/lib/audit-engine";
import { validarIntegridadeGrade, aplicarCorrecaoIntegridade, type RelatorioIntegridade } from "@/lib/integrity-validator";
import { IntegridadePanel } from "@/components/IntegridadePanel";
import { gerarFeedbackParaGerador } from "@/lib/feedback-engine";
import { regenerarComFeedback } from "@/lib/allocation-engine";
import { executarPredicao, type RelatorioPreditivo } from "@/lib/predictive-validator";
import { PredicaoPanel } from "@/components/PredicaoPanel";
import { useFeedbackProgress } from "@/components/FeedbackProgress";

// Intelligent Completion imports
import { TurmaCompletionSidebar } from "@/components/grade-completion/TurmaCompletionSidebar";
import { GradeStatusPanel } from "@/components/grade-completion/GradeStatusPanel";
import { useRemainingLessons } from "@/components/grade-completion/hooks";
import type { PendingLessonItem, RankingOption } from "@/components/grade-completion/hooks";
import { isLearningEnabled, analisarAjustesManuais, salvarPadroesManuais } from "@/lib/mbig-learning";
import type { HistoricoAprendizado } from "@/types";

const DIAS = ["segunda", "terca", "quarta", "quinta", "sexta"] as const;
const DIA_LABELS: Record<string, string> = {
  segunda: "Segunda", terca: "Terça", quarta: "Quarta", quinta: "Quinta", sexta: "Sexta",
};

type ViewMode = "turma" | "professor";

interface CellDialogState {
  open: boolean;
  dia: string;
  horario: number;
  turno: "manha" | "tarde" | "noite";
  existing: Alocacao | null;
}

export default function Grade() {
  const [turmas]                  = useTurmas();
  const [professores]             = useProfessores();
  const [disciplinas]             = useDisciplinas();
  const [alocacoes, setAlocacoes] = useAlocacoes();
  const progress                  = useFeedbackProgress();
  const [config, setConfig]       = useConfiguracaoHorarios();
  const [nomeEscola]              = useNomeEscola();
  const [matriz]                  = useMatrizCurricular();
  const { toast }                 = useToast();
  const remainingLessons          = useRemainingLessons();
  const [historico, setHistorico] = useHistoricoAprendizado();

  const [viewMode, setViewMode]   = useState<ViewMode>("turma");
  const [selectedId, setSelectedId] = useState<string>("");
  const [editMode, setEditMode]   = useState(false);
  const [selectedPending, setSelectedPending] = useState<{ turmaId: string; disciplinaId: string } | null>(null);

  const [dialog, setDialog] = useState<CellDialogState>({
    open: false, dia: "", horario: 0, turno: "manha", existing: null,
  });
  const [editDiscId, setEditDiscId] = useState("");
  const [editProfId, setEditProfId] = useState("");
  const [editTurmaId, setEditTurmaId] = useState("");
  const [ignorarFiltroPlanejamento, setIgnorarFiltroPlanejamento] = useState<boolean>(false);
  const [auditoriaOpen, setAuditoriaOpen] = useState(false);

  const [relatorioIntegridade, setRelatorioIntegridade] = useState<RelatorioIntegridade | null>(null);
  const [mostrarPainelIntegridade, setMostrarPainelIntegridade] = useState(false);

  const verificarIntegridade = () => {
    const resultado = validarIntegridadeGrade(
      alocacoes,
      professores,
      turmas,
      disciplinas
    );
    
    setRelatorioIntegridade(resultado.relatorio);
    setMostrarPainelIntegridade(true);
    
    if (!resultado.integridadeOk) {
      toast({
        title: "⚠️ Correção de Integridade Aplicada",
        description: `${resultado.relatorio.totalAulasRemovidas} aula(s) removidas de ${resultado.relatorio.professoresComExcesso.length} professor(es).`,
        variant: "destructive"
      });
    } else {
      toast({
        title: "✅ Integridade Confirmada",
        description: "Todos os professores estão dentro da carga planejada.",
        variant: "default"
      });
    }
  };

  const regenerarComCorrecao = async () => {
    if (!relatorioIntegridade) return;
    
    // Inicia feedback
    progress.start({
      titulo: "Regenerando Grade de Horários",
      mensagem: "O sistema está ajustando o planejamento e aplicando as correções de integridade...",
      subtitulo: "Aguarde enquanto o motor calcula a melhor distribuição",
      etapa: "🔮 Analisando dados...",
      tempoEstimado: 8
    });

    try {
      // Pequeno delay para renderizar a abertura do painel
      await new Promise(resolve => setTimeout(resolve, 800));

      const feedback = gerarFeedbackParaGerador(relatorioIntegridade);

      // Executa com os callbacks do progress tracker
      const resultado = regenerarComFeedback(
        turmas,
        disciplinas,
        professores,
        matriz,
        config,
        alocacoes.filter(a => a.isLocked),
        feedback,
        3,
        {
          onProgress: (dados) => {
            progress.update({
              etapa: dados.etapa,
              progresso: dados.progresso,
              mensagem: dados.mensagem,
              subtitulo: dados.subEtapa,
            });
          },
          onErro: (erro) => {
            progress.fail("Erro na alocação", erro);
          }
        }
      );

      // Pequeno delay final para o usuário contemplar a conclusão com sucesso
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Atualizar grade
      setAlocacoes(resultado.alocacoes);
      
      // Verificar novamente
      const novaVerificacao = validarIntegridadeGrade(
        resultado.alocacoes,
        professores,
        turmas,
        disciplinas
      );
      
      setRelatorioIntegridade(novaVerificacao.relatorio);
      
      progress.success("A grade horária foi regenerada com total integridade e otimização!");
      
      toast({
        title: "🔄 Grade Regenerada com Sucesso",
        description: `Nova grade gerada com ${resultado.alocacoes.length} aulas.`,
        variant: "default"
      });
    } catch (err: any) {
      console.error(err);
      progress.fail("Erro de Processamento", err?.message || String(err));
    }
  };

  const [relatorioPredicao, setRelatorioPredicao] = useState<RelatorioPreditivo | null>(null);
  const [mostrarPredicao, setMostrarPredicao] = useState(false);

  const executarPredicaoGrade = () => {
    const resultado = executarPredicao(
      alocacoes,
      professores,
      turmas,
      disciplinas,
      matriz,
      config
    );
    
    setRelatorioPredicao(resultado);
    setMostrarPredicao(true);
    
    if (resultado.criticos > 0) {
      toast({
        title: "🚨 Problemas Críticos Detectados",
        description: `${resultado.criticos} situação(ões) crítica(s) encontradas. Verifique o relatório.`,
        variant: "destructive"
      });
    } else if (resultado.altos > 0) {
      toast({
        title: "⚠️ Alertas de Alto Risco",
        description: `${resultado.altos} situação(ões) de alto risco detectadas.`,
        variant: "destructive"
      });
    } else {
      toast({
        title: "✅ Predição Concluída",
        description: "Nenhum problema crítico detectado.",
        variant: "default"
      });
    }
  };

  const aplicarCorrecoesPreventivas = () => {
    const resultado = aplicarCorrecaoIntegridade(
      alocacoes,
      professores,
      turmas,
      disciplinas
    );
    
    if (resultado.houveCorrecao) {
      setAlocacoes(resultado.alocacoesCorrigidas);
      toast({
        title: "🔧 Correções Preventivas Aplicadas",
        description: `${resultado.relatorio.totalAulasRemovidas} aula(s) excedentes foram removidas.`,
        variant: "default"
      });
      // Re-run prediction
      const novaPredicao = executarPredicao(
        resultado.alocacoesCorrigidas,
        professores,
        turmas,
        disciplinas,
        matriz,
        config
      );
      setRelatorioPredicao(novaPredicao);
    } else {
      toast({
        title: "ℹ️ Nenhuma Correção Necessária",
        description: "Nenhum excesso de carga foi encontrado para remoção.",
        variant: "default"
      });
    }
  };

  useEffect(() => {
    setSelectedPending(null);
  }, [selectedId, viewMode]);

  useEffect(() => {
    try {
      const href = window.location.href;
      if (href.includes("?")) {
        const queryStr = href.split("?")[1];
        if (queryStr) {
          const searchParams = new URLSearchParams(queryStr);
          const pId = searchParams.get("profId");
          const tId = searchParams.get("turmaId");
          if (pId) {
            setViewMode("professor");
            setSelectedId(pId);
          } else if (tId) {
            setViewMode("turma");
            setSelectedId(tId);
          }
        }
      }
    } catch (err) {
      console.error("Erro ao sincronizar parâmetros da URL:", err);
    }
  }, []);
  const [dialogConflictError, setDialogConflictError] = useState<string | null>(null);

  const realTimeAnalysis = useMemo(() => {
    if (!dialog.open) return null;
    const targetTurmaId = viewMode === "turma" ? selectedId : editTurmaId;
    
    const profId = editProfId;
    const discId = editDiscId;
    const turmaId = targetTurmaId;

    if (!profId || !discId || !turmaId) {
      return {
        complete: false,
        profId,
        discId,
        turmaId,
        message: "Selecione a disciplina, o professor e a turma para ativar o painel de verificação em tempo real."
      };
    }

    const targetProf = professores.find((p) => p.id === profId);
    const targetTurma = turmas.find((t) => t.id === turmaId);
    const targetDisc = disciplinas.find((d) => d.id === discId);

    if (!targetProf || !targetTurma || !targetDisc) {
      return {
        complete: false,
        profId,
        discId,
        turmaId,
        message: "Erro: Dados de alocação inválidos ou não encontrados."
      };
    }

    // 1. Is professor available by availability matrix?
    const isProfAvailable = isProfAvailableAt(targetProf.disponibilidade, dialog.dia, dialog.horario, targetTurma.turno);

    // 2. Is professor busy in another class in this same slot (same day, hour, shift)?
    const otherAlocForProf = alocacoes.find((a) => {
      if (a.id === dialog.existing?.id) return false;
      if (a.professorId !== profId || a.diaSemana !== dialog.dia || a.horario !== dialog.horario) return false;
      const aTurno = turmas.find((tx) => tx.id === a.turmaId)?.turno || "manha";
      return aTurno === targetTurma.turno;
    });

    // 3. Is target class (turma) occupied in this same slot?
    const otherAlocForTurma = alocacoes.find((a) => {
      if (a.id === dialog.existing?.id) return false;
      return a.turmaId === turmaId && a.diaSemana === dialog.dia && a.horario === dialog.horario;
    });

    // 4. Matrix checking
    const isDiscInMatrix = matriz.some((m) => m.turmaId === turmaId && m.disciplinaId === discId);

    // 5. Complete verification (via schedule-utils function: verificarSlotViavelComMotivo)
    const verification = verificarSlotViavelComMotivo(
      alocacoes,
      professores,
      disciplinas,
      turmas,
      matriz,
      config,
      profId,
      turmaId,
      discId,
      dialog.dia,
      dialog.horario,
      undefined,
      dialog.existing?.id
    );

    // 6. Check weekly hour limits / planned weekly hours for this professor-class-disc combination
    const allocatedWeekly = alocacoes.filter(
      (a) => a.turmaId === turmaId && a.disciplinaId === discId && a.professorId === profId
    ).length;
    
    // exclude current slot from allocated count if editing
    const currentAllocatedWeekly = (dialog.existing && dialog.existing.professorId === profId && dialog.existing.turmaId === turmaId && dialog.existing.disciplinaId === discId)
      ? Math.max(0, allocatedWeekly - 1)
      : allocatedWeekly;

    const planningItem = targetProf.planejamento?.find(
      (p) => p.turmaId === turmaId && p.disciplinaId === discId
    );
    const matrixItem = matriz.find(
      (m) => m.turmaId === turmaId && m.disciplinaId === discId
    );
    const plannedWeekly = Number(planningItem?.aulasPorSemana !== undefined ? planningItem.aulasPorSemana : (planningItem?.quantidadeAulas ?? matrixItem?.aulasPorSemana ?? 0));
    const isLimitExceeded = currentAllocatedWeekly >= plannedWeekly;

    return {
      complete: true,
      profId,
      discId,
      turmaId,
      targetProf,
      targetTurma,
      targetDisc,
      isProfAvailable,
      otherAlocForProf,
      otherAlocForTurma,
      isDiscInMatrix,
      isLimitExceeded,
      allocatedWeekly: currentAllocatedWeekly,
      plannedWeekly,
      verification
    };
  }, [dialog.open, dialog.dia, dialog.horario, dialog.existing, viewMode, selectedId, editProfId, editDiscId, editTurmaId, alocacoes, professores, disciplinas, turmas, matriz, config, ignorarFiltroPlanejamento]);

  const analysisResult = useMemo(() => {
    return realTimeAnalysis && realTimeAnalysis.complete ? realTimeAnalysis : null;
  }, [realTimeAnalysis]);

  const dragSrcRef  = useRef<Alocacao | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  // Intelligent Sandbox State variables
  const [stateIntelProfId, setStateIntelProfId] = useState<string>("");
  const [stateIntelTurmaId, setStateIntelTurmaId] = useState<string>("");
  const [intelDiscId, setIntelDiscId] = useState<string>("");
  const [showPossibleSlots, setShowPossibleSlots] = useState<boolean>(false);
  const [hoveredAnalysisCell, setHoveredAnalysisCell] = useState<{
    dia: string;
    horario: number;
    turno: "manha" | "tarde" | "noite";
  } | null>(null);

  // Grade Completion Smart Panel States
  const [focusedPendingItem, setFocusedPendingItem] = useState<PendingLessonItem | null>(null);
  const [selectedEmptySlot, setSelectedEmptySlot] = useState<{
    dia: string;
    horario: number;
    turno: "manha" | "tarde" | "noite";
    turmaId: string;
  } | null>(null);
  const [blinkCellKey, setBlinkCellKey] = useState<string | null>(null);

  const intelProfId = viewMode === "professor" ? selectedId : stateIntelProfId;
  const intelTurmaId = viewMode === "turma" ? selectedId : stateIntelTurmaId;

  // Grade Completion Handlers
  function handleFocusPendingItem(item: PendingLessonItem | null) {
    setFocusedPendingItem(item);
    if (item) {
      setViewMode("turma");
      setSelectedId(item.turma.id);
      setStateIntelProfId(item.professor.id);
      setStateIntelTurmaId(item.turma.id);
      setIntelDiscId(item.disciplina.id);
      setShowPossibleSlots(true);
      setEditMode(true);
      setSelectedEmptySlot(null);
    } else {
      setShowPossibleSlots(false);
    }
  }

  function handleSelectSuggestion(s: any) {
    const key = `${s.turno}-${s.dia}-${s.horario}`;
    setBlinkCellKey(key);
    
    // Switch empty slot state
    setSelectedEmptySlot({
      dia: s.dia,
      horario: s.horario,
      turno: s.turno,
      turmaId: selectedId,
    });

    setTimeout(() => {
      setBlinkCellKey(null);
    }, 2500);

    // Scroll into view
    setTimeout(() => {
      document.getElementById(`cell-${s.turno}-${s.dia}-${s.horario}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 100);
  }

  function handleAllocateEmptySlot(option: RankingOption) {
    if (!selectedEmptySlot) return;

    const newAloc: Alocacao = {
      id: generateId(),
      turmaId: selectedEmptySlot.turmaId,
      disciplinaId: option.disciplina.id,
      professorId: option.professor.id,
      diaSemana: selectedEmptySlot.dia,
      horario: selectedEmptySlot.horario,
    };

    setAlocacoes((prev) => [...prev, newAloc]);
    
    toast({
      title: "Aula Alocada com Sucesso",
      description: `${option.disciplina.nome} foi alocada na ${DIA_LABELS[selectedEmptySlot.dia]} no ${selectedEmptySlot.horario}º horário.`,
    });

    // Reset focused states or update pending list item
    setSelectedEmptySlot(null);
    if (focusedPendingItem && focusedPendingItem.disciplina.id === option.disciplina.id && focusedPendingItem.turma.id === selectedEmptySlot.turmaId) {
      const remainingCount = Math.max(0, focusedPendingItem.restante - 1);
      if (remainingCount === 0) {
        setFocusedPendingItem(null);
      } else {
        setFocusedPendingItem((prev: any) => prev ? { ...prev, restante: remainingCount, alocado: prev.alocado + 1 } : null);
      }
    }
  }

  function handleDirectAllocate(
    dia: string,
    horario: number,
    turno: "manha" | "tarde" | "noite",
    turmaId: string,
    profId: string,
    discId: string
  ) {
    const prof = professores.find(p => p.id === profId);
    const disc = disciplinas.find(d => d.id === discId);
    const turma = turmas.find(t => t.id === turmaId);
    if (!prof || !disc || !turma) return;

    // VALIDAR ANTES DE ALOCAR DIRETO
    const validacao = validarAlocacao(prof, turmaId, discId, alocacoes);
    if (!validacao.permitido) {
      toast({
        title: "Alocação Bloqueada",
        description: validacao.motivo,
        variant: "destructive"
      });
      return;
    }

    const newAloc: Alocacao = {
      id: generateId(),
      turmaId,
      disciplinaId: discId,
      professorId: profId,
      diaSemana: dia,
      horario,
    };

    setAlocacoes((prev) => [...prev, newAloc]);
    
    toast({
      title: "Aula Alocada com Sucesso",
      description: `${disc.nome} foi alocada na ${DIA_LABELS[dia]} no ${horario}º horário para ${prof.nomeCompleto}.`,
    });

    // Clear empty slot state and sync focused item
    setSelectedEmptySlot(null);
    if (focusedPendingItem && focusedPendingItem.disciplina.id === discId && focusedPendingItem.turma.id === turmaId) {
      const remainingCount = Math.max(0, focusedPendingItem.restante - 1);
      if (remainingCount === 0) {
        setFocusedPendingItem(null);
      } else {
        setFocusedPendingItem((prev: any) => prev ? { ...prev, restante: remainingCount, alocado: prev.alocado + 1 } : null);
      }
    }
  }

  // Auto-propagate defaults for Intelligent Sandbox when entity is selected
  useEffect(() => {
    if (viewMode === "professor" && selectedId) {
      setShowPossibleSlots(true);
      const prof = professores.find((p) => p.id === selectedId);
      const plan = prof?.planejamento?.[0];
      if (plan) {
        setStateIntelTurmaId(plan.turmaId);
        setIntelDiscId(plan.disciplinaId);
      } else {
        if (turmas.length > 0) setStateIntelTurmaId(turmas[0].id);
        if (disciplinas.length > 0) setIntelDiscId(disciplinas[0].id);
      }
    } else if (viewMode === "turma" && selectedId) {
      setShowPossibleSlots(true);
      const m = matriz.find((item) => item.turmaId === selectedId);
      if (m) {
        setIntelDiscId(m.disciplinaId);
        const matchedProf = professores.find((p) => 
          (p.planejamento ?? []).some((pl) => pl.turmaId === selectedId && pl.disciplinaId === m.disciplinaId)
        );
        if (matchedProf) {
          setStateIntelProfId(matchedProf.id);
        } else if (professores.length > 0) {
          setStateIntelProfId(professores[0].id);
        }
      } else {
        if (disciplinas.length > 0) setIntelDiscId(disciplinas[0].id);
        if (professores.length > 0) setStateIntelProfId(professores[0].id);
      }
    }
  }, [selectedId, viewMode, professores, turmas, disciplinas, matriz]);

  const turmaMap = useMemo(() => new Map(turmas.map((t) => [t.id, t])), [turmas]);

  const currentTurma = viewMode === "turma" ? turmas.find((t) => t.id === selectedId) : null;
  const currentProf  = viewMode === "professor" ? professores.find((p) => p.id === selectedId) : null;

  const emptyCellStatus = useMemo(() => {
    if (!editMode) return null;
    return (dia: string, horario: number, turno: "manha" | "tarde" | "noite") => {
      if (viewMode === "professor" && currentProf) {
        const isAvail = isProfAvailableAt(currentProf.disponibilidade, dia, horario, turno);
        if (!isAvail) {
          return {
            clss: "bg-red-500/[0.03] dark:bg-red-950/[0.03] border border-dashed border-red-200/50 dark:border-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-500/[0.08] hover:border-red-500/40",
            label: "🔴 Bloqueado",
            sub: "Indisponível"
          };
        } else {
          return {
            clss: "bg-emerald-500/[0.02] dark:bg-emerald-950/[0.02] border border-dashed border-emerald-200/50 dark:border-emerald-900/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/[0.08] hover:border-emerald-500/45",
            label: "🟢 Livre",
            sub: "Prof. Disponível"
          };
        }
      }
      
      return {
        clss: "bg-emerald-500/[0.02] dark:bg-emerald-950/[0.02] border border-dashed border-emerald-200/50 dark:border-emerald-900/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/[0.08] hover:border-emerald-500/45",
        label: "🟢 Livre",
        sub: "Turma s/ aula"
      };
    };
  }, [editMode, viewMode, currentProf]);

  // Which shifts does the selected entity participate in?
  const activeShifts = useMemo<Array<"manha" | "tarde" | "noite">>(() => {
    if (!selectedId) return [];
    if (viewMode === "turma" && currentTurma) {
      const turno = currentTurma.turno || "manha";
      return [turno];
    }
    if (viewMode === "professor" && currentProf) {
      const arr: Array<"manha" | "tarde" | "noite"> = [];
      
      const hasManha = alocacoes.some(a => a.professorId === selectedId && (turmaMap.get(a.turmaId)?.turno === "manha" || !turmaMap.get(a.turmaId)?.turno)) ||
                       (currentProf.planejamento || []).some(p => (turmaMap.get(p.turmaId)?.turno === "manha" || !turmaMap.get(p.turmaId)?.turno));
      if (hasManha) arr.push("manha");

      const hasTarde = alocacoes.some(a => a.professorId === selectedId && (turmaMap.get(a.turmaId)?.turno === "tarde")) ||
                       (currentProf.planejamento || []).some(p => (turmaMap.get(p.turmaId)?.turno === "tarde"));
      if (hasTarde) arr.push("tarde");

      const hasNoite = alocacoes.some(a => a.professorId === selectedId && (turmaMap.get(a.turmaId)?.turno === "noite")) ||
                       (currentProf.planejamento || []).some(p => (turmaMap.get(p.turmaId)?.turno === "noite"));
      if (hasNoite) arr.push("noite");

      if (arr.length === 0) {
        arr.push("manha");
        if (config.habilitarTarde) arr.push("tarde");
        if (config.habilitarNoite) arr.push("noite");
      }
      return arr;
    }
    return [];
  }, [selectedId, viewMode, currentTurma, currentProf, config, alocacoes, turmaMap]);

  const getProfessorCellDetails = (dia: string, horario: number, turno: "manha" | "tarde" | "noite") => {
    if (viewMode !== "professor" || !currentProf) return null;

    const aloc = getCellForShift(dia, horario, turno);
    if (aloc) {
      return {
        type: "alocada" as const,
        aloc,
        label: "🔵 Aula alocada",
        clss: "",
        sub: ""
      };
    }

    const isAvail = isProfAvailableAt(currentProf.disponibilidade, dia, horario, turno);
    if (!isAvail) {
      return {
        type: "indisponivel" as const,
        label: "🔴 Indisponível",
        clss: "bg-red-500/[0.03] dark:bg-red-950/[0.03] border border-dashed border-red-200/50 dark:border-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-500/[0.08] hover:border-red-500/40",
        sub: "Indisponível na agenda"
      };
    }

    // Now check compatibility of this slot across all planning items
    const planning = currentProf.planejamento || [];
    let possibleCount = 0;
    let totalPlannedItems = 0;
    let hasConflict = false;
    let conflictMotivo = "";

    for (const item of planning) {
      const t = turmas.find((x) => x.id === item.turmaId);
      if (!t || t.turno !== turno) continue;
      totalPlannedItems++;

      const otherAlocForTurma = alocacoes.find(
        (a) => a.turmaId === t.id && a.diaSemana === dia && a.horario === horario
      );
      
      const otherAlocForProf = alocacoes.find(
        (a) => {
          if (a.professorId === currentProf.id && a.diaSemana === dia && a.horario === horario) {
            const aTurno = turmas.find((tx) => tx.id === a.turmaId)?.turno || "manha";
            return aTurno === turno;
          }
          return false;
        }
      );

      const allocatedCount = alocacoes.filter(
        (a) => a.professorId === currentProf.id && a.turmaId === t.id && a.disciplinaId === item.disciplinaId
      ).length;
      const maxHrs = Number(item.aulasPorSemana !== undefined ? item.aulasPorSemana : item.quantidadeAulas) || 0;
      const isLimitExceeded = allocatedCount >= maxHrs;

      if (!otherAlocForTurma && !otherAlocForProf && !isLimitExceeded) {
        possibleCount++;
      } else {
        hasConflict = true;
        if (otherAlocForTurma) {
          conflictMotivo = `Turma ${t.nome} ocupada`;
        } else if (otherAlocForProf) {
          conflictMotivo = "Prof. ocupado";
        } else if (isLimitExceeded) {
          conflictMotivo = "Limite atingido";
        }
      }
    }

    // If a pending item is selected, we prioritize it
    if (selectedPending) {
      const isTargetPlanningItem = planning.some(p => p.turmaId === selectedPending.turmaId && p.disciplinaId === selectedPending.disciplinaId);
      if (isTargetPlanningItem) {
        const t = turmas.find(x => x.id === selectedPending.turmaId);
        const d = disciplinas.find(x => x.id === selectedPending.disciplinaId);
        
        // Is this slot compatible for the selected pending item?
        const isSlotAvailableForPending = t && t.turno === turno;
        if (isSlotAvailableForPending) {
          const otherAlocForTurma = alocacoes.find(
            (a) => a.turmaId === t.id && a.diaSemana === dia && a.horario === horario
          );
          
          const otherAlocForProf = alocacoes.find(
            (a) => {
              if (a.professorId === currentProf.id && a.diaSemana === dia && a.horario === horario) {
                const aTurno = turmas.find((tx) => tx.id === a.turmaId)?.turno || "manha";
                return aTurno === turno;
              }
              return false;
            }
          );

          const allocatedCount = alocacoes.filter(
            (a) => a.professorId === currentProf.id && a.turmaId === t.id && a.disciplinaId === selectedPending.disciplinaId
          ).length;
          const planningItem = planning.find(p => p.turmaId === selectedPending.turmaId && p.disciplinaId === selectedPending.disciplinaId);
          const maxHrs = Number(planningItem?.aulasPorSemana !== undefined ? planningItem.aulasPorSemana : planningItem?.quantidadeAulas) || 2;
          const isLimitExceeded = allocatedCount >= maxHrs;

          if (!otherAlocForTurma && !otherAlocForProf && !isLimitExceeded) {
            return {
              type: "pendente_viavel" as const,
              label: "🟡 Aula pendente",
              clss: "bg-amber-500/[0.08] dark:bg-amber-950/[0.08] border border-dashed border-amber-400 text-amber-700 dark:text-amber-300 font-bold hover:bg-amber-500/[0.12] ring-2 ring-amber-400 animate-pulse",
              sub: `Compatível c/ ${t.nome}`
            };
          } else {
            return {
              type: "conflito" as const,
              label: "⚠️ Conflito",
              clss: "bg-red-500/[0.03] dark:bg-red-950/[0.03] border border-dashed border-red-300 dark:border-red-950 text-red-600 dark:text-red-400 hover:bg-red-500/[0.08]",
              sub: otherAlocForTurma ? `${t.nome} ocupada` : isLimitExceeded ? "Limite atingido" : "Prof. ocupado"
            };
          }
        } else {
          return {
            type: "indisponivel_turno" as const,
            label: "🔴 Incompatível",
            clss: "bg-gray-100/40 dark:bg-zinc-900/40 border border-dashed border-gray-250 dark:border-zinc-850 text-muted-foreground/50 cursor-not-allowed",
            sub: "Turno diferente"
          };
        }
      }
    }

    if (totalPlannedItems === 0) {
      return {
        type: "livre" as const,
        label: "🟢 Livre",
        clss: "bg-emerald-500/[0.02] dark:bg-emerald-950/[0.02] border border-dashed border-emerald-200/50 dark:border-emerald-900/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/[0.08] hover:border-emerald-500/45",
        sub: "Sem turmas vinculadas"
      };
    }

    if (possibleCount > 0) {
      return {
        type: "livre_viavel" as const,
        label: "🟢 Livre",
        clss: "bg-emerald-500/[0.05] dark:bg-emerald-950/[0.05] border border-dashed border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500",
        sub: `${possibleCount} ${possibleCount === 1 ? "turma livre" : "turmas livres"}`
      };
    }

    return {
      type: "conflito" as const,
      label: "⚠️ Conflito potencial",
      clss: "bg-amber-500/[0.03] dark:bg-amber-950/[0.03] border border-dashed border-amber-300 dark:border-amber-900/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/[0.08]",
      sub: conflictMotivo || "Turmas ocupadas"
    };
  };

  const compativeisForSlot = useMemo(() => {
    if (!dialog.open || viewMode !== "professor" || !currentProf) return [];
    
    const results: Array<{
      turma: typeof turmas[0];
      disciplina: typeof disciplinas[0];
      planningItem: any;
      viavel: boolean;
      motivoBloqueio?: string;
    }> = [];

    if (!ignorarFiltroPlanejamento) {
      const planning = currentProf.planejamento || [];
      for (const item of planning) {
        const t = turmas.find((x) => x.id === item.turmaId);
        if (!t || t.turno !== dialog.turno) continue;

        const d = disciplinas.find((x) => x.id === item.disciplinaId);
        if (!d) continue;

        // Check matrix
        const inMatrix = matriz.some((m) => m.turmaId === t.id && m.disciplinaId === d.id);
        if (!inMatrix) continue;

        // Check class occupancy
        const otherAlocForTurma = alocacoes.find(
          (a) => a.id !== dialog.existing?.id && a.turmaId === t.id && a.diaSemana === dialog.dia && a.horario === dialog.horario
        );

        // Check professor availability
        const isProfAvail = isProfAvailableAt(currentProf.disponibilidade, dialog.dia, dialog.horario, dialog.turno);

        // Check professor occupancy in this shift
        const otherAlocForProf = alocacoes.find(
          (a) => {
            if (a.id !== dialog.existing?.id && a.professorId === currentProf.id && a.diaSemana === dialog.dia && a.horario === dialog.horario) {
              const aTurno = turmas.find((tx) => tx.id === a.turmaId)?.turno || "manha";
              return aTurno === dialog.turno;
            }
            return false;
          }
        );

        // Check weekly load
        const allocatedCount = alocacoes.filter(
          (a) => a.id !== dialog.existing?.id && a.professorId === currentProf.id && a.turmaId === t.id && a.disciplinaId === d.id
        ).length;
        const maxHrs = Number(item.aulasPorSemana !== undefined ? item.aulasPorSemana : item.quantidadeAulas) || 0;
        const isLimitExceeded = allocatedCount >= maxHrs;

        let viavel = true;
        let motivoBloqueio = "";

        if (!isProfAvail) {
          viavel = false;
          motivoBloqueio = "Professor indisponível na agenda";
        } else if (otherAlocForProf) {
          const outT = turmas.find((tx) => tx.id === otherAlocForProf.turmaId);
          viavel = false;
          motivoBloqueio = `Prof. já ocupado com a turma ${outT?.nome ?? "?"}`;
        } else if (otherAlocForTurma) {
          const outD = disciplinas.find((dx) => dx.id === otherAlocForTurma.disciplinaId);
          viavel = false;
          motivoBloqueio = `Turma já possui aula de ${outD?.abreviacao ?? "?"}`;
        } else if (isLimitExceeded) {
          viavel = false;
          motivoBloqueio = `Carga semanal atingida (${allocatedCount}/${maxHrs}h)`;
        }

        results.push({
          turma: t,
          disciplina: d,
          planningItem: item,
          viavel,
          motivoBloqueio,
        });
      }
    } else {
      // If ignoring planning, show all classes of current shift compatible with professor disciplines in the matrix
      const profDisciplinas = currentProf.disciplinas || [];
      const sameTurnoTurmas = turmas.filter((t) => t.turno === dialog.turno);

      for (const t of sameTurnoTurmas) {
        for (const dId of profDisciplinas) {
          const d = disciplinas.find((x) => x.id === dId);
          if (!d) continue;

          // Check if this discipline is in this class's matrix curricular
          const matrixItem = matriz.find((m) => m.turmaId === t.id && m.disciplinaId === dId);
          if (!matrixItem) continue;

          // Check class occupancy
          const otherAlocForTurma = alocacoes.find(
            (a) => a.id !== dialog.existing?.id && a.turmaId === t.id && a.diaSemana === dialog.dia && a.horario === dialog.horario
          );

          // Check professor availability
          const isProfAvail = isProfAvailableAt(currentProf.disponibilidade, dialog.dia, dialog.horario, dialog.turno);

          // Check professor occupancy
          const otherAlocForProf = alocacoes.find(
            (a) => {
              if (a.id !== dialog.existing?.id && a.professorId === currentProf.id && a.diaSemana === dialog.dia && a.horario === dialog.horario) {
                const aTurno = turmas.find((tx) => tx.id === a.turmaId)?.turno || "manha";
                return aTurno === dialog.turno;
              }
              return false;
            }
          );

          // Check weekly load (allocated hours vs matrix previsto)
          const allocatedCount = alocacoes.filter(
            (a) => a.id !== dialog.existing?.id && a.professorId === currentProf.id && a.turmaId === t.id && a.disciplinaId === d.id
          ).length;
          const isLimitExceeded = allocatedCount >= matrixItem.aulasPorSemana;

          let viavel = true;
          let motivoBloqueio = "";

          if (!isProfAvail) {
            viavel = false;
            motivoBloqueio = "Professor indisponível na agenda";
          } else if (otherAlocForProf) {
            const outT = turmas.find((tx) => tx.id === otherAlocForProf.turmaId);
            viavel = false;
            motivoBloqueio = `Prof. já ocupado com a turma ${outT?.nome ?? "?"}`;
          } else if (otherAlocForTurma) {
            const outD = disciplinas.find((dx) => dx.id === otherAlocForTurma.disciplinaId);
            viavel = false;
            motivoBloqueio = `Turma já possui aula de ${outD?.abreviacao ?? "?"}`;
          } else if (isLimitExceeded) {
            viavel = false;
            motivoBloqueio = `Carga semanal atingida (${allocatedCount}/${matrixItem.aulasPorSemana}h)`;
          }

          results.push({
            turma: t,
            disciplina: d,
            planningItem: {
              disciplinaId: dId,
              turmaId: t.id,
              aulasPorSemana: matrixItem.aulasPorSemana,
              quantidadeAulas: matrixItem.aulasPorSemana,
            },
            viavel,
            motivoBloqueio,
          });
        }
      }
    }

    return results;
  }, [dialog.open, dialog.dia, dialog.horario, dialog.turno, dialog.existing, viewMode, currentProf, alocacoes, turmas, disciplinas, matriz, ignorarFiltroPlanejamento]);

  const manhaSlots = useMemo(() => generateTimeSlotsForTurno(config, "manha"), [config]);
  const tardeSlots = useMemo(() => {
    if (config.habilitarTarde || activeShifts.includes("tarde")) {
      return generateTimeSlotsForTurno(config, "tarde");
    }
    return [];
  }, [config, activeShifts]);

  const noiteSlots = useMemo(() => {
    if (config.habilitarNoite || activeShifts.includes("noite")) {
      return generateTimeSlotsForTurno(config, "noite");
    }
    return [];
  }, [config, activeShifts]);

  const showManha = activeShifts.includes("manha");
  const showTarde = activeShifts.includes("tarde");
  const showNoite = activeShifts.includes("noite");

  function getCellForShift(dia: string, horario: number, turno: "manha" | "tarde" | "noite"): Alocacao | null {
    if (!selectedId) return null;
    if (viewMode === "turma") {
      return alocacoes.find((a) => a.turmaId === selectedId && a.diaSemana === dia && a.horario === horario) ?? null;
    }
    return alocacoes.find((a) =>
      a.professorId === selectedId &&
      a.diaSemana === dia &&
      a.horario === horario &&
      (turmaMap.get(a.turmaId)?.turno ?? "manha") === turno
    ) ?? null;
  }

  function openDialog(dia: string, horario: number, turno: "manha" | "tarde" | "noite", existing: Alocacao | null) {
    if (!editMode) {
      setEditMode(true);
    }
    setDialog({ open: true, dia, horario, turno, existing });
    
    let discId = existing?.disciplinaId ?? (selectedPending?.disciplinaId) ?? (showPossibleSlots ? intelDiscId : "") ?? "";
    if (!discId && viewMode === "turma" && selectedId) {
      const pendingForTurma = remainingLessons.find((item: PendingLessonItem) => item.turma.id === selectedId);
      if (pendingForTurma) {
        discId = pendingForTurma.disciplina.id;
      } else {
        const classDisc = filteredDisciplinas[0]?.id;
        if (classDisc) {
          discId = classDisc;
        }
      }
    }
    setEditDiscId(discId);

    let profId = "";
    if (existing?.professorId) {
      profId = existing.professorId;
    } else if (viewMode === "professor") {
      profId = selectedId;
    } else {
      const targetTurmaId = existing?.turmaId ?? (viewMode === "turma" ? selectedId : selectedPending?.turmaId) ?? "";
      if (targetTurmaId && discId) {
        const planProf = professores.find(p => 
          (p.planejamento || []).some(item => item.turmaId === targetTurmaId && item.disciplinaId === discId)
        );
        profId = planProf?.id ?? "";
      }
      if (!profId) {
        profId = showPossibleSlots ? intelProfId : "";
      }
    }
    setEditProfId(profId);

    let turmaId = "";
    if (existing?.turmaId) {
      turmaId = existing.turmaId;
    } else if (viewMode === "turma") {
      turmaId = selectedId;
    } else if (selectedPending?.turmaId) {
      const pendingTurma = turmas.find(t => t.id === selectedPending.turmaId);
      if (pendingTurma && pendingTurma.turno === turno) {
        turmaId = selectedPending.turmaId;
      }
    } else {
      // Find a class from the professor's planning that matches this shift and discipline
      const matchingPlan = (professores.find(p => p.id === profId)?.planejamento || []).find(p => {
        if (discId && p.disciplinaId !== discId) return false;
        const t = turmas.find(x => x.id === p.turmaId);
        return t && t.turno === turno;
      });
      if (matchingPlan) {
        turmaId = matchingPlan.turmaId;
      } else {
        turmaId = showPossibleSlots ? stateIntelTurmaId : "";
      }
    }
    setEditTurmaId(turmaId);

    setDialogConflictError(null);
    setIgnorarFiltroPlanejamento(false);
  }

  function pruneExcessAllocations() {
    const resultado = corrigirExcessos(alocacoes, professores, matriz);
    if (resultado.removidas > 0) {
      setAlocacoes(resultado.alocacoes);
      toast({
        title: "Excessos Corrigidos",
        description: `Removidas ${resultado.removidas} aula(s) excedente(s) que superavam a carga horária permitida.`,
      });
    } else {
      toast({
        title: "Grade em Conformidade",
        description: "Não foram encontradas aulas excedentes na grade semanal.",
      });
    }
  }

  function checkDialogConflicts(profId: string, discId: string, currentTurmaId: string): string | null {
    if (!profId || !discId || !currentTurmaId) return null;

    const prof = professores.find(p => p.id === profId);
    if (prof) {
      const alocacoesParaValidar = dialog.existing
        ? alocacoes.filter(a => a.id !== dialog.existing!.id)
        : alocacoes;
      const validacao = validarAlocacao(prof, currentTurmaId, discId, alocacoesParaValidar);
      if (!validacao.permitido) {
        return validacao.motivo || "Limite semanal excedido";
      }
    }

    const validation = verificarSlotViavelComMotivo(
      alocacoes,
      professores,
      disciplinas,
      turmas,
      matriz,
      config,
      profId,
      currentTurmaId,
      discId,
      dialog.dia,
      dialog.horario,
      undefined,
      dialog.existing?.id
    );

    if (!validation.viavel) {
      return validation.motivo || "Conflito identificado";
    }

    return null;
  }

  function saveDialog() {
    if (!editDiscId || !editProfId) return;

    const targetTurmaId = viewMode === "turma" ? selectedId : editTurmaId;
    if (!targetTurmaId) {
      setDialogConflictError("Por favor, selecione uma turma.");
      return;
    }

    const conflictMsg = checkDialogConflicts(editProfId, editDiscId, targetTurmaId);
    if (conflictMsg) {
      setDialogConflictError(`Salvamento bloqueado por conflitos/inviabilidades: ${conflictMsg}`);
      return;
    }
    setDialogConflictError(null);

    setAlocacoes((prev) => {
      const filtered = dialog.existing
        ? prev.filter((a) => a.id !== dialog.existing!.id)
        : prev.filter((a) => {
            const matchesEntity = viewMode === "turma" 
              ? a.turmaId === selectedId 
              : a.professorId === selectedId;
            
            if (matchesEntity && a.diaSemana === dialog.dia && a.horario === dialog.horario) {
              if (viewMode === "professor") {
                const aTurno = turmas.find((t) => t.id === a.turmaId)?.turno ?? "manha";
                return aTurno !== dialog.turno; // Keep if different shift
              }
              return false; // Filter out for class view
            }
            return true; // Keep everything else
          });
      return [...filtered, {
        id: dialog.existing?.id ?? generateId(),
        turmaId: targetTurmaId,
        disciplinaId: editDiscId,
        professorId: editProfId,
        diaSemana: dialog.dia,
        horario: dialog.horario,
      }];
    });
    setDialog((d) => ({ ...d, open: false }));
    toast({
      title: "Horário Alocado",
      description: "A aula foi alocada e validada com sucesso.",
    });
  }

  function deleteAlocacao(aloc: Alocacao) {
    setAlocacoes((prev) => prev.filter((a) => a.id !== aloc.id));
    setDialog((d) => ({ ...d, open: false }));
    toast({
      title: "Alocação Removida",
      description: "O horário foi liberado de forma limpa.",
    });
  }

  function handleDragStart(aloc: Alocacao) { dragSrcRef.current = aloc; }

  function handleDrop(dia: string, horario: number, turno: "manha" | "tarde" | "noite") {
    const src = dragSrcRef.current;
    if (!src) return;
    setDragOverKey(null);
    const destAloc = getCellForShift(dia, horario, turno);

    // Validate moving src to destination
    const validationSrc = verificarSlotViavelComMotivo(
      alocacoes,
      professores,
      disciplinas,
      turmas,
      matriz,
      config,
      src.professorId,
      src.turmaId,
      src.disciplinaId,
      dia,
      horario,
      undefined,
      src.id
    );

    if (!validationSrc.viavel) {
      toast({
        title: "Movimentação Bloqueada",
        description: `Esta aula não pode ser alocada aqui: ${validationSrc.motivo}`,
        variant: "destructive",
      });
      dragSrcRef.current = null;
      return;
    }

    // Validate destAloc back to source
    if (destAloc) {
      const validationDest = verificarSlotViavelComMotivo(
        alocacoes,
        professores,
        disciplinas,
        turmas,
        matriz,
        config,
        destAloc.professorId,
        destAloc.turmaId,
        destAloc.disciplinaId,
        src.diaSemana,
        src.horario,
        undefined,
        destAloc.id
      );

      if (!validationDest.viavel) {
        toast({
          title: "Troca Impatível",
          description: `A aula que já estava aqui não pode ir para a origem: ${validationDest.motivo}`,
          variant: "destructive",
        });
        dragSrcRef.current = null;
        return;
      }
    }

    setAlocacoes((prev) => {
      let updated = prev.filter((a) => a.id !== src.id);
      if (destAloc) {
        updated = updated.filter((a) => a.id !== destAloc.id);
        updated.push({ ...destAloc, diaSemana: src.diaSemana, horario: src.horario });
      }
      updated.push({ ...src, diaSemana: dia, horario });
      return updated;
    });

    if (isLearningEnabled()) {
      const newAction: HistoricoAprendizado = {
        id: generateId(),
        professorId: src.professorId,
        turmaId: src.turmaId,
        disciplinaId: src.disciplinaId,
        diaSemana: dia,
        horario: horario,
        operacao: 'insercao',
        justificativa: `Troca manual de ${src.diaSemana} - ${src.horario}º horário para ${dia} - ${horario}º horário.`,
        timestamp: new Date().toISOString(),
        tenant_id: 'default'
      };
      
      const updatedHistorico = [...historico, newAction];
      setHistorico(updatedHistorico);
      
      const novosPadroes = analisarAjustesManuais(updatedHistorico, turmas, professores);
      salvarPadroesManuais(novosPadroes);
    }

    dragSrcRef.current = null;
    toast({
      title: "Horário Atualizado",
      description: "A aula foi realocada.",
    });
  }

  function getIntelCellDetails(dia: string, horario: number, turno: "manha" | "tarde" | "noite") {
    if (!editMode || !intelProfId || !intelTurmaId || !intelDiscId) return null;

    const targetProf = professores.find(p => p.id === intelProfId);
    const targetTurma = turmas.find(t => t.id === intelTurmaId);
    const targetDisc = disciplinas.find(d => d.id === intelDiscId);

    if (!targetProf || !targetTurma || !targetDisc) return null;

    // Shift check
    if (targetTurma.turno !== turno) return null;

    const analysis = verificarSlotViavelComMotivo(
      alocacoes,
      professores,
      disciplinas,
      turmas,
      matriz,
      config,
      intelProfId,
      intelTurmaId,
      intelDiscId,
      dia,
      horario,
      undefined,
      undefined
    );

    const allocatedWeekly = alocacoes.filter(
      (a) => a.turmaId === intelTurmaId && a.disciplinaId === intelDiscId && a.professorId === intelProfId
    ).length;
    
    const planningItem = targetProf.planejamento?.find(
      (p) => p.turmaId === intelTurmaId && p.disciplinaId === intelDiscId
    );
    const plannedWeekly = Number(planningItem?.aulasPorSemana !== undefined ? planningItem.aulasPorSemana : planningItem?.quantidadeAulas) || 0;
    const isLimitReachedWeekly = allocatedWeekly >= plannedWeekly;

    let status: "available" | "alert" | "conflict" | "unavailable" = "available";
    let statusLabel = "🟢 Disponível";
    let statusColor = "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400";
    let statusText = "Disponível";
    let dot = "🟢";

    if (analysis.viavel) {
      if (isLimitReachedWeekly) {
        status = "alert";
        statusLabel = "🟡 Disponível com alerta";
        statusColor = "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400";
        statusText = "Alerta (Planejado Excedido)";
        dot = "🟡";
      } else {
        status = "available";
        statusLabel = "🟢 Disponível";
        statusColor = "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400";
        statusText = "Disponível";
        dot = "🟢";
      }
    } else {
      const motiveLower = (analysis.motivo || "").toLowerCase();
      if (
        motiveLower.includes("indisponibilidade") ||
        motiveLower.includes("bloqueado") ||
        motiveLower.includes("folga") ||
        motiveLower.includes("indisponível")
      ) {
        status = "unavailable";
        statusLabel = "⚫ Indisponível";
        statusColor = "bg-slate-400/10 dark:bg-slate-900/10 border-slate-300 dark:border-slate-800 text-slate-500 dark:text-slate-400";
        statusText = "Bloqueio Professor";
        dot = "⚫";
      } else {
        status = "conflict";
        statusLabel = "🔴 Conflito";
        statusColor = "bg-red-500/10 border-red-500/30 text-red-750 dark:text-red-400";
        statusText = "Conflito Ativo";
        dot = "🔴";
      }
    }

    return {
      analysis,
      status,
      statusLabel,
      statusColor,
      statusText,
      dot,
      plannedWeekly,
      allocatedWeekly,
      isLimitReachedWeekly
    };
  }

  function getTooltipText(dia: string, horario: number, turno: "manha" | "tarde" | "noite") {
    if (!intelProfId || !intelTurmaId || !intelDiscId) return "Selecione as opções no painel para analisar.";

    const targetProf = professores.find(p => p.id === intelProfId);
    const targetTurma = turmas.find(t => t.id === intelTurmaId);
    const targetDisc = disciplinas.find(d => d.id === intelDiscId);

    if (!targetProf || !targetTurma || !targetDisc) return "";

    const analysis = verificarSlotViavelComMotivo(
      alocacoes,
      professores,
      disciplinas,
      turmas,
      matriz,
      config,
      intelProfId,
      intelTurmaId,
      intelDiscId,
      dia,
      horario,
      undefined,
      undefined
    );

    const isProfAvailable = isProfAvailableAt(targetProf.disponibilidade, dia, horario, targetTurma.turno);
    const isTurmaFree = !alocacoes.some(a => a.turmaId === intelTurmaId && a.diaSemana === dia && a.horario === horario);
    const isDiscPermitted = matriz.some(m => m.turmaId === intelTurmaId && m.disciplinaId === intelDiscId);

    const conflictCell = alocacoes.find(a => {
      if (a.professorId !== intelProfId || a.diaSemana !== dia || a.horario !== horario) return false;
      const aTurno = turmas.find(t => t.id === a.turmaId)?.turno || "manha";
      return aTurno === targetTurma.turno;
    });
    const conflictText = conflictCell 
      ? `Sim: Ocupado com ${turmaMap.get(conflictCell.turmaId)?.nome ?? conflictCell.turmaId} (${disciplinas.find(d => d.id === conflictCell.disciplinaId)?.nome})` 
      : "Nenhum";

    return `ANÁLISE DE SLOT:
• Disponibilidade do Professor: ${isProfAvailable ? "🟢 DISPONÍVEL" : "⚫ INDISPONÍVEL"}
• Disponibilidade da Turma: ${isTurmaFree ? "🟢 LIVRE" : "🔴 OCUPADA"}
• Disponibilidade da Disciplina: ${isDiscPermitted ? "🟢 PERMITIDA" : "🔴 ESTÁ FORA DA MATRIZ"}
• Conflitos Detectados: ${conflictText}
• Motivos de Rejeição: ${analysis.viavel ? "Nenhum (Permitido)" : `🔴 ${analysis.motivo}`}`;
  }

  const selectorList = viewMode === "turma" ? turmas : professores;
  const selectorLabel = (item: typeof selectorList[0]) =>
    "nome" in item ? item.nome : (item as (typeof professores)[0]).nomeCompleto;

  const filteredProfs = editDiscId ? professores.filter((p) => p.disciplinas.includes(editDiscId)) : professores;

  const filteredDisciplinas = useMemo(() => {
    if (viewMode === "professor" && currentProf) {
      const res = disciplinas.filter((d) => currentProf.disciplinas.includes(d.id));
      return res.length > 0 ? res : disciplinas;
    }
    if (viewMode === "turma" && currentTurma) {
      const res = disciplinas.filter((d) => matriz.some((m) => m.turmaId === currentTurma.id && m.disciplinaId === d.id));
      return res.length > 0 ? res : disciplinas;
    }
    return disciplinas;
  }, [viewMode, currentProf, currentTurma, disciplinas, matriz]);

  const filteredTurmas = useMemo(() => {
    if (editDiscId) {
      return turmas.filter((t) => matriz.some((m) => m.turmaId === t.id && m.disciplinaId === editDiscId));
    }
    return turmas;
  }, [editDiscId, turmas, matriz]);

  const dialogFilteredTurmas = useMemo(() => {
    if (!dialog.open || !editDiscId) return [];
    
    // Always restrict to the current slot's turn
    const sameTurnoTurmas = turmas.filter((t) => t.turno === dialog.turno);
    
    if (viewMode === "professor" && currentProf) {
      if (!ignorarFiltroPlanejamento) {
        // Only show classes from the professor's planning for this discipline
        const planned = sameTurnoTurmas.filter((t) =>
          (currentProf.planejamento || []).some(
            (p) => p.turmaId === t.id && p.disciplinaId === editDiscId
          )
        );
        if (planned.length > 0) return planned;
      }
      
      // Fallback: Show all classes in this shift that have the discipline in their matrix
      return sameTurnoTurmas.filter((t) =>
        matriz.some((m) => m.turmaId === t.id && m.disciplinaId === editDiscId)
      );
    }
    
    // In "turma" view, just return classes with the discipline in their matrix
    const res = sameTurnoTurmas.filter((t) =>
      matriz.some((m) => m.turmaId === t.id && m.disciplinaId === editDiscId)
    );
    return res.length > 0 ? res : sameTurnoTurmas;
  }, [dialog.open, dialog.turno, editDiscId, viewMode, currentProf, ignorarFiltroPlanejamento, turmas, matriz]);

  const dialogFilteredProfs = useMemo(() => {
    if (!dialog.open || !editDiscId) return [];
    
    const capableProfs = professores.filter((p) => p.disciplinas.includes(editDiscId));
    const pool = capableProfs.length > 0 ? capableProfs : professores;
    
    if (viewMode === "turma" && currentTurma) {
      if (!ignorarFiltroPlanejamento) {
        // Only show professors who have a planning item for this class and discipline
        const planned = pool.filter((p) =>
          (p.planejamento || []).some(
            (pl) => pl.turmaId === currentTurma.id && pl.disciplinaId === editDiscId
          )
        );
        if (planned.length > 0) return planned;
      }
    }
    
    return pool;
  }, [dialog.open, editDiscId, viewMode, currentTurma, ignorarFiltroPlanejamento, professores]);

  // ── sub-table renderer ──────────────────────────────────────────────────────
  function renderShiftTable(turno: "manha" | "tarde" | "noite", slots: ReturnType<typeof generateTimeSlotsForTurno>) {
    const isManha = turno === "manha";
    const isNoite = turno === "noite";
    const periodColor = isNoite
      ? "text-purple-600 dark:text-purple-400"
      : "text-blue-600 dark:text-blue-400";

    return (
      <div key={turno}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" data-testid={`grade-table-${turno}`}>
            <thead>
              <tr className="bg-muted">
                <th className="text-left p-3 font-semibold text-muted-foreground border-b border-border min-w-24">
                  Horário
                </th>
                {DIAS.map((d) => (
                  <th key={d} className="text-center p-3 font-semibold text-muted-foreground border-b border-border">
                    {DIA_LABELS[d]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slots.map((slot, idx) => {
                if (slot.isBreak) {
                  return (
                    <tr key={`break-${idx}`} className="bg-amber-50 dark:bg-amber-950/30">
                      <td colSpan={6} className="text-center p-2 text-xs text-amber-700 dark:text-amber-300 font-medium border-b border-border">
                        Intervalo — {slot.start} às {slot.end}
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr key={`${turno}-${slot.period}`} className="border-b border-border/50">
                    <td className="p-3 border-r border-border/30">
                      <p className={`font-semibold text-xs ${periodColor}`}>
                        {slot.period}º Horário
                      </p>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">
                        {slot.start} – {slot.end}
                      </p>
                    </td>
                    {DIAS.map((dia) => {
                      const aloc  = getCellForShift(dia, slot.period, turno);
                      const disc  = aloc ? disciplinas.find((d) => d.id === aloc.disciplinaId) : null;
                      const prof  = aloc ? professores.find((p) => p.id === aloc.professorId) : null;
                      const turma = aloc ? turmaMap.get(aloc.turmaId) : null;
                      const cellKey = `${turno}-${dia}-${slot.period}`;
                      const isDragOver = dragOverKey === cellKey;

                      // Intelligent highlights & checks
                      const intelDetails = getIntelCellDetails(dia, slot.period, turno);
                      const isHighlightActive = showPossibleSlots && intelProfId && intelTurmaId && intelDiscId;
                      const isCellValid = intelDetails?.analysis?.viavel === true;

                      const profCell = getProfessorCellDetails(dia, slot.period, turno);

                      const isSelectedCell = dialog.open && dialog.dia === dia && dialog.horario === slot.period && dialog.turno === turno;
                      const isBlinking = blinkCellKey === cellKey;

                      // Focus Mode styles and traffic light colors
                      let focoClass = "";
                      let isSlotGreen = false;
                      let isSlotYellow = false;
                      let isSlotRed = false;

                      if (isHighlightActive) {
                        if (aloc) {
                          if (aloc.disciplinaId !== intelDiscId) {
                            // Do not dim or hide occupied classes; keep the full static grid visible and interactive like a normal timetable
                            focoClass = "opacity-100 transition-all duration-200";
                          }
                        } else {
                          if (isCellValid) {
                            // Yellow condition: weekly limit reached OR consecutive slot issues (same day but not adjacent)
                            const temAulaNoDia = alocacoes.some(a => a.turmaId === intelTurmaId && a.disciplinaId === intelDiscId && a.diaSemana === dia);
                            const temAulaConsecutiva = temAulaNoDia && alocacoes.some(a => a.turmaId === intelTurmaId && a.disciplinaId === intelDiscId && a.diaSemana === dia && Math.abs(a.horario - slot.period) === 1);
                            const isLimitReached = intelDetails?.isLimitReachedWeekly === true;
                            
                            if (isLimitReached || (temAulaNoDia && !temAulaConsecutiva)) {
                              isSlotYellow = true;
                              focoClass = "bg-amber-500/15 border-2 border-amber-500 text-amber-900 dark:text-amber-300 dark:bg-amber-950/40 opacity-100 scale-[1.01] shadow-sm z-10 rounded-md";
                            } else {
                              isSlotGreen = true;
                              focoClass = "bg-emerald-500/20 border-2 border-emerald-500 text-emerald-900 dark:text-emerald-300 dark:bg-emerald-950/45 opacity-100 scale-[1.02] shadow-md z-10 rounded-md animate-pulse";
                            }
                          } else {
                            isSlotRed = true;
                            focoClass = "bg-rose-500/5 border border-dashed border-rose-500/25 text-rose-500/50 dark:bg-rose-950/20 opacity-75 rounded-md cursor-not-allowed";
                          }
                        }
                      }

                      return (
                        <td
                          key={dia}
                          id={`cell-${turno}-${dia}-${slot.period}`}
                          className={`p-1.5 text-center border-r border-border/20 last:border-r-0 transition-all relative rounded-md
                            ${selectedId ? "cursor-pointer" : ""}
                            ${isSelectedCell ? "ring-4 ring-primary ring-offset-2 animate-pulse bg-primary/10 shadow-lg z-20" : ""}
                            ${isBlinking ? "ring-4 ring-indigo-500 bg-indigo-500/35 scale-105 shadow-xl animate-pulse z-30 font-bold border-2 border-indigo-600" : ""}
                            ${isDragOver ? "bg-primary/10 ring-2 ring-inset ring-primary/40" : ""}
                            ${focoClass}
                          `}
                          data-testid={`cell-${turno}-${dia}-${slot.period}`}
                          onClick={() => {
                            if (selectedId) {
                              openDialog(dia, slot.period, turno, aloc);
                            }
                          }}
                          onMouseEnter={() => {
                            setHoveredAnalysisCell({ dia, horario: slot.period, turno });
                          }}
                          onDragOver={(e) => { if (!editMode) return; e.preventDefault(); setDragOverKey(cellKey); }}
                          onDragLeave={() => setDragOverKey(null)}
                          onDrop={(e) => { e.preventDefault(); handleDrop(dia, slot.period, turno); }}
                          title={getTooltipText(dia, slot.period, turno)}
                        >
                          {aloc && disc ? (
                            <div
                              draggable={editMode && !aloc.isLocked}
                              onDragStart={() => { if (!aloc.isLocked) handleDragStart(aloc); }}
                              onClick={(e) => { e.stopPropagation(); openDialog(dia, slot.period, turno, aloc); }}
                              className={`rounded-md px-2 py-1.5 h-full group relative transition-all duration-200 hover:scale-[1.02] shadow-sm
                                ${editMode && !aloc.isLocked ? "cursor-grab active:cursor-grabbing hover:shadow-md" : ""}
                                ${aloc.isLocked ? "ring-1 ring-amber-400/60 dark:ring-amber-600/60" : ""}
                              `}
                              style={{ 
                                backgroundColor: viewMode === "professor" ? "#2563eb10" : disc.cor + "20", 
                                borderLeft: viewMode === "professor" ? "3px solid #3b82f6" : `3px solid ${disc.cor}` 
                              }}
                            >
                              {aloc.isLocked && (
                                <Lock className="w-2.5 h-2.5 absolute top-1 left-1 text-amber-600 dark:text-amber-400 no-print" />
                              )}
                              {editMode && !aloc.isLocked && (
                                <GripVertical className="w-3 h-3 absolute top-1 right-1 opacity-0 group-hover:opacity-40 text-muted-foreground transition-opacity no-print" />
                              )}
                              <p className={`font-bold text-xs ${aloc.isLocked ? "pl-3" : ""}`} style={{ color: viewMode === "professor" ? "#2563eb" : disc.cor }}>{disc.abreviacao}</p>
                              <p className="text-[11px] text-muted-foreground print:text-gray-600 truncate">{disc.nome}</p>
                              {viewMode === "turma" && prof && (
                                <p className="text-[10px] text-muted-foreground/70 print:text-gray-500 mt-0.5">
                                  {prof.nomeCompleto.split(" ")[0]}
                                </p>
                              )}
                              {viewMode === "professor" && turma && (
                                <p className="text-[10px] text-muted-foreground/70 print:text-gray-500 mt-0.5">{turma.nome}</p>
                              )}
                            </div>
                          ) : (
                            <div 
                              className="rounded-md p-2 h-full min-h-[56px] text-left flex flex-col justify-between border border-dashed border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/45 hover:bg-slate-500/[0.02] hover:border-slate-400/50 transition-all duration-200 select-none cursor-pointer group/empty"
                            >
                              <div className="flex items-center justify-between w-full">
                                <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 group-hover/empty:text-slate-650 transition-colors">
                                  (vazio)
                                </span>
                                <Plus className="w-3 h-3 text-slate-400 opacity-0 group-hover/empty:opacity-100 transition-all shrink-0" />
                              </div>
                              <p className="text-[9px] text-slate-400 font-medium mt-1.5 opacity-0 group-hover/empty:opacity-100 transition-opacity">
                                Clique para alocar
                              </p>
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3 no-print">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Grade de Horários</h1>
          <p className="text-muted-foreground mt-1">
            {editMode ? "Clique numa célula para editar · Arraste para mover" : "Visualize a grade semanal completa"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/grade-completa">
            <Button variant="outline" data-testid="button-grade-completa">
              <LayoutGrid className="w-4 h-4 mr-2" />
              Horário Completo
            </Button>
          </Link>
          <Button
            variant={editMode ? "default" : "outline"}
            onClick={() => setEditMode((v) => !v)}
            data-testid="button-toggle-edit"
          >
            {editMode ? <><Eye className="w-4 h-4 mr-2" />Visualizar</> : <><Pencil className="w-4 h-4 mr-2" />Editar Grade</>}
          </Button>
          <Button variant="outline" onClick={() => window.print()} data-testid="button-print">
            <Printer className="w-4 h-4 mr-2" />
            Imprimir
          </Button>
          <Button
            variant="outline"
            onClick={() => setAuditoriaOpen(true)}
            className="border-blue-200 text-blue-700 hover:bg-blue-50 dark:border-blue-900/50 dark:text-blue-400 dark:hover:bg-blue-950/30"
          >
            <Search className="w-4 h-4 mr-2" />
            Auditoria
          </Button>
          <Button
            variant="outline"
            onClick={verificarIntegridade}
            className="border-green-200 text-green-700 hover:bg-green-50 dark:border-green-900/50 dark:text-green-400 dark:hover:bg-green-950/30"
          >
            <CheckCircle2 className="w-4 h-4 mr-2" />
            Integridade Docente
          </Button>
          <Button
            variant="outline"
            onClick={executarPredicaoGrade}
            className="border-blue-200 text-blue-700 hover:bg-blue-50 dark:border-blue-900/50 dark:text-blue-400 dark:hover:bg-blue-950/30 font-bold"
          >
            <Brain className="w-4 h-4 mr-2 animate-pulse text-blue-600 dark:text-blue-400" />
            Predição Ativa
          </Button>
        </div>
      </div>

      {mostrarPredicao && relatorioPredicao && (
        <div className="mb-4 no-print animate-fade-in">
          <PredicaoPanel 
            relatorio={relatorioPredicao} 
            onClose={() => setMostrarPredicao(false)} 
            onApplyCorrections={aplicarCorrecoesPreventivas}
          />
        </div>
      )}

      {mostrarPainelIntegridade && relatorioIntegridade && (
        <div className="mb-4 no-print">
          <IntegridadePanel 
            relatorio={relatorioIntegridade} 
            onRegenerar={regenerarComCorrecao} 
            onFechar={() => setMostrarPainelIntegridade(false)} 
          />
        </div>
      )}


      {editMode && (
        <div className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-300 bg-amber-500/10 rounded-lg px-4 py-2.5 border border-amber-500/30 no-print">
          <Pencil className="w-3.5 h-3.5 shrink-0" />
          <span>
            <strong className="text-foreground">Modo edição ativo:</strong> selecione uma disciplina pendente no painel lateral "Assistente de Alocação" e clique ou arraste para alocar nos slots verdes recomendados.
          </span>
        </div>
      )}

      {/* Top horizontal pending status panel removed as requested */}

      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center no-print">
        <Tabs value={viewMode} onValueChange={(v) => { setViewMode(v as ViewMode); setSelectedId(""); }}>
          <TabsList>
            <TabsTrigger value="turma" data-testid="tab-por-turma">Por Turma</TabsTrigger>
            <TabsTrigger value="professor" data-testid="tab-por-professor">Por Professor</TabsTrigger>
          </TabsList>
        </Tabs>

        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger className="w-56" data-testid="select-grade-entity">
            <SelectValue placeholder={viewMode === "turma" ? "Selecionar turma..." : "Selecionar professor..."} />
          </SelectTrigger>
          <SelectContent>
            {selectorList.map((item) => {
              const isProf = "nomeCompleto" in item;
              const label = selectorLabel(item);
              const turno = !isProf && "turno" in item ? (item as { turno: string }).turno : null;
              return (
                <SelectItem key={item.id} value={item.id}>
                  <span className="flex items-center gap-2">
                    {turno === "manha" && <Sun className="w-3 h-3 text-blue-500" />}
                    {turno === "tarde" && <Sunset className="w-3 h-3 text-blue-500" />}
                    {turno === "noite" && <Moon className="w-3 h-3 text-purple-500" />}
                    {label}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {!selectedId ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center text-muted-foreground">
            <Grid3x3 className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="font-medium">Selecione uma {viewMode === "turma" ? "turma" : "professor"} para visualizar a grade</p>
          </CardContent>
        </Card>
      ) : (
        <div className={`grid grid-cols-1 ${(editMode || viewMode === "turma") ? "lg:grid-cols-4" : ""} gap-6`}>
          <div className={(editMode || viewMode === "turma") ? "lg:col-span-3 space-y-6" : "space-y-6"}>
            {showManha && (
              <Card className="print-container overflow-hidden">
                <CardHeader className="pb-3 border-b border-blue-100 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20">
                  <div className="hidden print:block text-center mb-3 pb-3 border-b">
                    <p className="text-base font-bold uppercase tracking-wide">{nomeEscola}</p>
                    <p className="text-xs text-gray-600 mt-0.5">Grade de Horários — Matutino</p>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Sun className="w-4 h-4 text-blue-500" />
                      {viewMode === "turma" ? `Turma: ${currentTurma?.nome}` : `Professor: ${currentProf?.nomeCompleto}`}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 border-0 text-xs">
                        <Sun className="w-3 h-3 mr-1" />Matutino
                      </Badge>
                      {editMode && (
                        <Badge variant="secondary" className="text-xs no-print">
                          <Pencil className="w-2.5 h-2.5 mr-1" />Editando
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {renderShiftTable("manha", manhaSlots)}
                </CardContent>
              </Card>
            )}

            {showTarde && (
              <Card className="print-container overflow-hidden">
                <CardHeader className="pb-3 border-b border-blue-100 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20">
                  <div className="hidden print:block text-center mb-3 pb-3 border-b">
                    <p className="text-base font-bold uppercase tracking-wide">{nomeEscola}</p>
                    <p className="text-xs text-gray-600 mt-0.5">Grade de Horários — Vespertino</p>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Sunset className="w-4 h-4 text-blue-500" />
                      {viewMode === "turma" ? `Turma: ${currentTurma?.nome}` : `Professor: ${currentProf?.nomeCompleto}`}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 border-0 text-xs">
                        <Sunset className="w-3 h-3 mr-1" />Vespertino
                      </Badge>
                      {editMode && (
                        <Badge variant="secondary" className="text-xs no-print">
                          <Pencil className="w-2.5 h-2.5 mr-1" />Editando
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {!config.habilitarTarde && (
                    <div className="flex items-center justify-between gap-4 p-4 bg-blue-500/10 text-blue-800 dark:text-blue-300 border-b border-blue-200/50 dark:border-blue-900/50 text-xs no-print">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-blue-500 shrink-0" />
                        <span>
                          O <strong>turno vespertino</strong> está desativado nas configurações globais de horários. Ative-o para que as grades semanais completas o incluam.
                        </span>
                      </div>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        className="bg-background text-blue-700 dark:text-blue-300 border-blue-300 hover:bg-blue-50 h-7 text-[11px] shrink-0"
                        onClick={() => {
                          setConfig(prev => ({ ...prev, habilitarTarde: true }));
                          toast({ title: "Turno Vespertino ativado com sucesso!" });
                        }}
                      >
                        Ativar Turno
                      </Button>
                    </div>
                  )}
                  {renderShiftTable("tarde", tardeSlots)}
                </CardContent>
              </Card>
            )}

            {showNoite && (
              <Card className="print-container overflow-hidden">
                <CardHeader className="pb-3 border-b border-purple-100 dark:border-purple-900 bg-purple-50/50 dark:bg-purple-950/20">
                  <div className="hidden print:block text-center mb-3 pb-3 border-b">
                    <p className="text-base font-bold uppercase tracking-wide">{nomeEscola}</p>
                    <p className="text-xs text-gray-600 mt-0.5">Grade de Horários — Noturno</p>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Moon className="w-4 h-4 text-purple-500" />
                      {viewMode === "turma" ? `Turma: ${currentTurma?.nome}` : `Professor: ${currentProf?.nomeCompleto}`}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 border-0 text-xs">
                        <Moon className="w-3 h-3 mr-1" />Noturno
                      </Badge>
                      {editMode && (
                        <Badge variant="secondary" className="text-xs no-print">
                          <Pencil className="w-2.5 h-2.5 mr-1" />Editando
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {!config.habilitarNoite && (
                    <div className="flex items-center justify-between gap-4 p-4 bg-purple-500/10 text-purple-800 dark:text-purple-300 border-b border-purple-200/50 dark:border-purple-900/50 text-xs no-print">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-purple-500 shrink-0" />
                        <span>
                          O <strong>turno noturno</strong> está desativado nas configurações globais de horários. Ative-o para que as grades semanais completas o incluam.
                        </span>
                      </div>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        className="bg-background text-purple-700 dark:text-purple-300 border-purple-300 hover:bg-purple-50 h-7 text-[11px] shrink-0"
                        onClick={() => {
                          setConfig(prev => ({ ...prev, habilitarNoite: true }));
                          toast({ title: "Turno Noturno ativado com sucesso!" });
                        }}
                      >
                        Ativar Turno
                      </Button>
                    </div>
                  )}
                  {renderShiftTable("noite", noiteSlots)}
                </CardContent>
              </Card>
            )}
          </div>

          {viewMode === "turma" ? (
            <div className="space-y-6 no-print font-sans">
              <div className="sticky top-6">
                {selectedId ? (
                  <TurmaCompletionSidebar
                    mode="turma"
                    selectedId={selectedId}
                    activeDiscId={intelDiscId}
                    selectedEmptySlot={selectedEmptySlot}
                    onClearEmptySlot={() => {
                      setSelectedEmptySlot(null);
                      setIntelDiscId("");
                      setStateIntelProfId("");
                      setShowPossibleSlots(false);
                    }}
                    onActiveDiscChange={(discId, profId, tId) => {
                      setIntelDiscId(discId);
                      setStateIntelProfId(profId);
                      if (tId) setStateIntelTurmaId(tId);
                      setShowPossibleSlots(true);
                    }}
                    onSelectSuggestion={handleSelectSuggestion}
                    onDirectAllocate={handleDirectAllocate}
                    showPossibleSlots={showPossibleSlots}
                    onTogglePossibleSlots={() => setShowPossibleSlots(!showPossibleSlots)}
                    onClearGrade={() => {
                      if (confirm("Tem certeza que deseja LIMPAR todas as aulas mutáveis desta grade? Apenas as aulas trancadas (🔒) serão preservadas.")) {
                        setAlocacoes((prev) => prev.filter((a) => a.isLocked));
                        toast({
                          title: "Grade Limpa",
                          description: "Todas as alocações mutáveis foram limpas com sucesso!"
                        });
                      }
                    }}
                    onPruneExcess={pruneExcessAllocations}
                  />
                ) : (
                  <Card className="border border-indigo-100 dark:border-indigo-950/40 p-6 text-center space-y-3 shadow-sm bg-card text-card-foreground">
                    <LayoutGrid className="w-8 h-8 text-indigo-400 mx-auto opacity-75" />
                    <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">Selecione uma Turma</h4>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Selecione uma turma no menu superior para visualizar o progresso de carga horária e obter sugestões de alocação inteligentes.
                    </p>
                  </Card>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-6 no-print font-sans">
              <div className="sticky top-6">
                {selectedId ? (
                  <TurmaCompletionSidebar
                    mode="professor"
                    selectedId={selectedId}
                    activeDiscId={intelDiscId}
                    activeTurmaId={stateIntelTurmaId}
                    selectedEmptySlot={selectedEmptySlot}
                    onClearEmptySlot={() => {
                      setSelectedEmptySlot(null);
                      setIntelDiscId("");
                      setStateIntelProfId("");
                      setShowPossibleSlots(false);
                    }}
                    onActiveDiscChange={(discId, profId, tId) => {
                      setIntelDiscId(discId);
                      setStateIntelProfId(profId);
                      if (tId) {
                        setStateIntelTurmaId(tId);
                      }
                      setShowPossibleSlots(true);
                    }}
                    onSelectSuggestion={handleSelectSuggestion}
                    onDirectAllocate={handleDirectAllocate}
                    showPossibleSlots={showPossibleSlots}
                    onTogglePossibleSlots={() => setShowPossibleSlots(!showPossibleSlots)}
                    onClearGrade={() => {
                      if (confirm("Tem certeza que deseja LIMPAR todas as aulas mutáveis desta grade? Apenas as aulas trancadas (🔒) serão preservadas.")) {
                        setAlocacoes((prev) => prev.filter((a) => a.isLocked));
                        toast({
                          title: "Grade Limpa",
                          description: "Todas as alocações mutáveis foram limpas com sucesso!"
                        });
                      }
                    }}
                    onPruneExcess={pruneExcessAllocations}
                  />
                ) : (
                  <Card className="border border-indigo-100 dark:border-indigo-950/40 p-6 text-center space-y-3 shadow-sm bg-card text-card-foreground">
                    <User className="w-8 h-8 text-indigo-400 mx-auto opacity-75" />
                    <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">Selecione um Professor</h4>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Selecione um professor no menu superior para visualizar o progresso de carga horária e obter sugestões de alocação inteligentes.
                    </p>
                  </Card>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {disciplinas.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {disciplinas.map((d) => (
            <div key={d.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.cor }} />
              {d.nome}
            </div>
          ))}
        </div>
      )}

      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
        }
      `}</style>
      <AnimatePresence>
        {dialog.open && (
          <>
            {/* Soft, non-blocking, transparent backdrop to keep the grid perfectly visible */}
            <motion.div
              key="drawer-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDialog((d) => ({ ...d, open: false }))}
              className="fixed inset-0 bg-slate-950/15 backdrop-blur-[0.5px] z-40 no-print cursor-pointer"
            />

            {/* Sliding Panel */}
            <motion.div
              key="drawer-content"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 26, stiffness: 220 }}
              className="fixed top-0 right-0 bottom-0 w-full sm:w-[460px] max-w-full bg-background border-l border-border shadow-2xl z-50 flex flex-col no-print h-full overflow-hidden"
            >
              {/* Drawer Header */}
              <div className="p-5 border-b border-border flex items-center justify-between bg-muted/30">
                <div>
                  <h3 className="font-bold text-base text-foreground flex items-center gap-2">
                    <Pencil className="w-4 h-4 text-primary" />
                    {dialog.existing ? "Editar Aula" : "Adicionar Aula"}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-foreground bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                      {DIA_LABELS[dialog.dia]}
                    </span>
                    <span>—</span>
                    <span className="font-semibold text-foreground bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                      {dialog.horario}º Horário
                    </span>
                    <span>·</span>
                    <span className={`font-semibold px-1.5 py-0.5 rounded ${
                      dialog.turno === "noite" 
                        ? "bg-purple-100 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400" 
                        : dialog.turno === "manha" 
                          ? "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400" 
                          : "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400"
                    }`}>
                      {dialog.turno === "noite" ? "Noturno" : dialog.turno === "manha" ? "Matutino" : "Vespertino"}
                    </span>
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full h-8 w-8 hover:bg-muted"
                  onClick={() => setDialog((d) => ({ ...d, open: false }))}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              {/* Drawer Body */}
              <div className="p-5 flex-1 overflow-y-auto space-y-5">
                {/* Show Fixed Entity Context */}
                {viewMode === "turma" && currentTurma && (
                  <div className="text-xs font-semibold px-2.5 py-1.5 bg-blue-500/10 text-blue-700 dark:text-blue-400 rounded-md border border-blue-200/30 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shrink-0" />
                    Grade da Turma: <span className="text-foreground font-bold">{currentTurma.nome}</span>
                  </div>
                )}
                {viewMode === "professor" && currentProf && (
                  <div className="text-xs font-semibold px-2.5 py-1.5 bg-violet-500/10 text-violet-700 dark:text-violet-400 rounded-md border border-violet-200/30 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-violet-500 animate-pulse shrink-0" />
                    Grade do Professor: <span className="text-foreground font-bold">{currentProf.nomeCompleto}</span>
                  </div>
                )}

                {/* Disciplina Selection */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Disciplina</Label>
                  <Select 
                    value={editDiscId || undefined} 
                    onValueChange={(v) => { 
                      setEditDiscId(v); 
                      if (viewMode === "turma") {
                        setEditProfId(""); 
                      }
                      setDialogConflictError(null); 
                    }}
                  >
                    <SelectTrigger className="h-10 text-xs" data-testid="dialog-select-disciplina">
                      <SelectValue placeholder="Selecionar disciplina..." />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredDisciplinas.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.cor }} />
                            {d.nome}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Custom Field Based on View Mode */}
                {viewMode === "turma" ? (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Professor</Label>
                    <Select value={editProfId || undefined} onValueChange={(v) => { setEditProfId(v); setDialogConflictError(null); }} disabled={!editDiscId}>
                      <SelectTrigger className="h-10 text-xs" data-testid="dialog-select-professor">
                        <SelectValue placeholder={editDiscId ? "Selecionar professor..." : "Escolha a disciplina primeiro"} />
                      </SelectTrigger>
                      <SelectContent>
                        {dialogFilteredProfs.length === 0 ? (
                          <SelectItem value="_none" disabled>Nenhum professor habilitado</SelectItem>
                        ) : (
                          dialogFilteredProfs.map((p) => (
                            <SelectItem key={p.id} value={p.id} className="text-xs">{p.nomeCompleto}</SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    {editDiscId && dialogFilteredProfs.length === 0 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        Nenhum professor cadastrado ou elegível no planejamento para esta disciplina.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Turma</Label>
                    <Select value={editTurmaId || undefined} onValueChange={(v) => { setEditTurmaId(v); setDialogConflictError(null); }} disabled={!editDiscId}>
                      <SelectTrigger className="h-10 text-xs" data-testid="dialog-select-turma">
                        <SelectValue placeholder={editDiscId ? "Selecionar turma..." : "Escolha a disciplina primeiro"} />
                      </SelectTrigger>
                      <SelectContent>
                        {dialogFilteredTurmas.length === 0 ? (
                          <SelectItem value="_none" disabled>Nenhuma turma habilitada</SelectItem>
                        ) : (
                          dialogFilteredTurmas.map((t) => (
                            <SelectItem key={t.id} value={t.id} className="text-xs">
                              {t.nome} ({t.turno === "manha" ? "Matutino" : t.turno === "tarde" ? "Vespertino" : "Noturno"})
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    {editDiscId && dialogFilteredTurmas.length === 0 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        Nenhuma turma com esta disciplina em sua matriz curricular para este turno.
                      </p>
                    )}
                  </div>
                )}

                {/* Exceptional / Ignored Planning Toggle Switch */}
                {editDiscId && (
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2 bg-slate-100/50 dark:bg-zinc-900/40 p-2.5 rounded-lg border border-border/60">
                      <input
                        type="checkbox"
                        id="toggle-ignorar-planejamento"
                        checked={ignorarFiltroPlanejamento}
                        onChange={(e) => {
                          setIgnorarFiltroPlanejamento(e.target.checked);
                          setDialogConflictError(null);
                        }}
                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer accent-blue-600"
                      />
                      <Label 
                        htmlFor="toggle-ignorar-planejamento" 
                        className="text-xs font-semibold text-foreground cursor-pointer select-none flex-1"
                      >
                        {viewMode === "turma" 
                          ? "Ignorar filtro de planejamento (Mostrar todos os profs)" 
                          : "Ignorar filtro de planejamento (Mostrar todas as turmas)"
                        }
                      </Label>
                    </div>

                    {ignorarFiltroPlanejamento && (
                      <div className="bg-amber-500/10 text-amber-800 dark:text-amber-400 border border-amber-200/40 text-[11px] p-2.5 rounded-lg flex items-center gap-1.5 font-medium leading-relaxed">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <span>Atenção: Modo Excepcional ativo. Alocando fora do planejamento original de contrato.</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Unified Diagnostic & Suggestions Section (Unified UX!) */}
                <div className="space-y-4 pt-2">
                  <div className="rounded-xl border border-border bg-slate-50/50 dark:bg-zinc-950/20 p-4 space-y-3">
                    <div className="flex items-center justify-between border-b border-border/50 pb-2">
                      <h4 className="font-bold text-xs text-foreground inline-flex items-center gap-1.5 uppercase tracking-wide">
                        <Sparkles className="w-3.5 h-3.5 text-violet-500 animate-pulse shrink-0" />
                        Viabilidade & Diagnóstico Real-time
                      </h4>
                      <Badge variant="outline" className="text-[10px] uppercase font-mono py-0.5 tracking-wider">
                        Verificando
                      </Badge>
                    </div>

                    {!analysisResult ? (
                      <p className="text-muted-foreground text-center py-2 text-[11px] leading-relaxed">
                        {realTimeAnalysis?.message || "Selecione os campos acima para ativar as verificações em tempo real."}
                      </p>
                    ) : (
                      <div className="space-y-3 text-xs">
                        {/* Live checks list */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {/* Agenda availability check */}
                          <div className={`p-2.5 rounded-lg border flex flex-col justify-between ${
                            !analysisResult.isProfAvailable 
                              ? "border-red-200 bg-red-500/[0.04] text-red-950 dark:border-red-950/40 dark:bg-red-950/10 dark:text-red-300" 
                              : "border-emerald-200 bg-emerald-500/[0.04] text-emerald-950 dark:border-emerald-950/40 dark:bg-emerald-950/10 dark:text-emerald-300"
                          }`}>
                            <span className="text-[10px] uppercase font-bold tracking-tight text-muted-foreground">Disponibilidade Geral</span>
                            <div className="flex items-center gap-1.5 font-semibold mt-1">
                              {!analysisResult.isProfAvailable ? (
                                <>
                                  <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                                  <span>Indisponível (Agenda)</span>
                                </>
                              ) : (
                                <>
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                  <span>Disponível</span>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Professor freedom check */}
                          <div className={`p-2.5 rounded-lg border flex flex-col justify-between ${
                            analysisResult.otherAlocForProf
                              ? "border-amber-200 bg-amber-500/[0.04] text-amber-950 dark:border-amber-950/40 dark:bg-amber-950/10 dark:text-amber-300"
                              : "border-emerald-200 bg-emerald-500/[0.04] text-emerald-950 dark:border-emerald-950/40 dark:bg-emerald-950/10 dark:text-emerald-300"
                          }`}>
                            <span className="text-[10px] uppercase font-bold tracking-tight text-muted-foreground">Ocupação Professor</span>
                            <div className="flex items-center gap-1.5 font-semibold mt-1">
                              {analysisResult.otherAlocForProf ? (
                                <>
                                  <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                  <span className="truncate">Ocupado em {turmaMap.get(analysisResult.otherAlocForProf.turmaId)?.nome ?? "outra turma"}</span>
                                </>
                              ) : (
                                <>
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                  <span>Livre</span>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Class occupation check */}
                          <div className={`p-2.5 rounded-lg border flex flex-col justify-between ${
                            analysisResult.otherAlocForTurma 
                              ? "border-red-200 bg-red-500/[0.04] text-red-950 dark:border-red-950/40 dark:bg-red-950/10 dark:text-red-300" 
                              : "border-emerald-200 bg-emerald-500/[0.04] text-emerald-950 dark:border-emerald-950/40 dark:bg-emerald-950/10 dark:text-emerald-300"
                          }`}>
                            <span className="text-[10px] uppercase font-bold tracking-tight text-muted-foreground">Ocupação da Turma</span>
                            <div className="flex items-center gap-1.5 font-semibold mt-1">
                              {analysisResult.otherAlocForTurma ? (
                                <>
                                  <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                                  <span className="truncate">Ocupada ({disciplinas.find(d => d.id === analysisResult!.otherAlocForTurma?.disciplinaId)?.abreviacao})</span>
                                </>
                              ) : (
                                <>
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                  <span>Livre</span>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Curricular matrix authorization check */}
                          <div className={`p-2.5 rounded-lg border flex flex-col justify-between ${
                            !analysisResult.isDiscInMatrix 
                              ? "border-red-200 bg-red-500/[0.04] text-red-950 dark:border-red-950/40 dark:bg-red-950/10 dark:text-red-300" 
                              : "border-emerald-200 bg-emerald-500/[0.04] text-emerald-950 dark:border-emerald-950/40 dark:bg-emerald-950/10 dark:text-emerald-300"
                          }`}>
                            <span className="text-[10px] uppercase font-bold tracking-tight text-muted-foreground">Matriz Curricular</span>
                            <div className="flex items-center gap-1.5 font-semibold mt-1">
                              {!analysisResult.isDiscInMatrix ? (
                                <>
                                  <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                                  <span>Fora da Matriz</span>
                                </>
                              ) : (
                                <>
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                  <span>Autorizado</span>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Weekly workload limits check */}
                          <div className={`p-2.5 rounded-lg border flex flex-col justify-between ${
                            analysisResult.isLimitExceeded 
                              ? "border-amber-200 bg-amber-500/[0.04] text-amber-950 dark:border-amber-950/40 dark:bg-amber-950/10 dark:text-amber-300" 
                              : "border-emerald-200 bg-emerald-500/[0.04] text-emerald-950 dark:border-emerald-950/40 dark:bg-emerald-950/10 dark:text-emerald-300"
                          }`}>
                            <span className="text-[10px] uppercase font-bold tracking-tight text-muted-foreground">Horas Planejadas</span>
                            <div className="flex items-center gap-1.5 font-semibold mt-1">
                              {analysisResult.isLimitExceeded ? (
                                <>
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                  <span className="truncate flex-1">Limite Excedido ({analysisResult.allocatedWeekly}/{analysisResult.plannedWeekly})</span>
                                </>
                              ) : (
                                <>
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                  <span>OK ({analysisResult.allocatedWeekly}/{analysisResult.plannedWeekly})</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Summary Outcome */}
                        <div className={`p-3 rounded-lg border flex items-start gap-2.5 transition-all ${
                          analysisResult.verification!.viavel 
                            ? "border-emerald-200/50 bg-emerald-500/10 text-emerald-950 dark:border-emerald-900/30 dark:bg-emerald-950/20 dark:text-emerald-300" 
                            : "border-red-200/50 bg-red-500/10 text-red-950 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-300"
                        }`}>
                          {analysisResult.verification!.viavel ? (
                            <>
                              <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                              <div>
                                <p className="font-bold text-[11px] uppercase tracking-wide text-emerald-800 dark:text-emerald-300">Viável para Alocação</p>
                                <p className="text-[10px] opacity-80 leading-snug mt-0.5">As regras de entrosamento estão totalmente válidas para este slot.</p>
                              </div>
                            </>
                          ) : (
                            <>
                              <AlertOctagon className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                              <div>
                                <p className="font-bold text-[11px] uppercase tracking-wide text-red-800 dark:text-red-300">Choque ou Inviabilidade Detectada</p>
                                <p className="text-[10px] opacity-90 leading-tight mt-0.5 font-semibold">{analysisResult.verification!.motivo}</p>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Suggestions Section */}
                {viewMode === "professor" && currentProf && compativeisForSlot.length > 0 && (
                  <div className="space-y-2 p-4 rounded-xl border border-emerald-200 bg-emerald-500/[0.04] dark:border-emerald-950/30">
                    <p className="text-xs font-bold text-emerald-800 dark:text-emerald-400 flex items-center gap-1.5 uppercase tracking-wide">
                      <Sparkles className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      Sugestões de Alocação Rápida
                    </p>
                    <div className="grid grid-cols-1 gap-2 pt-1">
                      {compativeisForSlot.map((item, idx) => (
                        <Button
                          key={idx}
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditDiscId(item.disciplina.id);
                            setEditTurmaId(item.turma.id);
                            setEditProfId(currentProf.id);
                            
                            setTimeout(() => {
                              setAlocacoes((prev) => {
                                const filtered = dialog.existing
                                  ? prev.filter((a) => a.id !== dialog.existing!.id)
                                  : prev.filter((a) => !(
                                      a.professorId === currentProf.id &&
                                      a.diaSemana === dialog.dia &&
                                      a.horario === dialog.horario
                                    ));
                                return [...filtered, {
                                  id: dialog.existing?.id ?? generateId(),
                                  turmaId: item.turma.id,
                                  disciplinaId: item.disciplina.id,
                                  professorId: currentProf.id,
                                  diaSemana: dialog.dia,
                                  horario: dialog.horario,
                                  isLocked: false
                                }];
                              });
                              setDialog((d) => ({ ...d, open: false }));
                              toast({
                                title: "Alocação Realizada!",
                                description: `${item.disciplina.abreviacao} alocada na turma ${item.turma.nome} para o prof. ${currentProf.nomeCompleto}.`,
                              });
                            }, 50);
                          }}
                          className="h-10 justify-start text-left px-3 bg-card hover:bg-emerald-500/10 hover:text-emerald-900 border-dashed border-emerald-200 hover:border-emerald-500 transition-colors w-full"
                          disabled={!item.viavel}
                        >
                          <div className="flex items-center justify-between w-full text-xs">
                            <div className="flex items-center gap-2 overflow-hidden">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.disciplina.cor }} />
                              <span className="font-bold text-foreground shrink-0">{item.turma.nome}</span>
                              <span className="opacity-70 shrink-0">—</span>
                              <span className="font-medium text-muted-foreground truncate">{item.disciplina.nome}</span>
                            </div>
                            <Badge variant="secondary" className="bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-bold border-0 text-[10px] ml-2 shrink-0">
                              Faltam {(Number(item.planningItem.aulasPorSemana !== undefined ? item.planningItem.aulasPorSemana : item.planningItem.quantidadeAulas) || 0) - (alocacoes.filter(a => a.professorId === currentProf.id && a.turmaId === item.turma.id && a.disciplinaId === item.disciplina.id).length)}h
                            </Badge>
                          </div>
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {viewMode === "professor" && currentProf && compativeisForSlot.length === 0 && (
                  <div className="p-4 rounded-xl border border-dashed border-red-200 bg-red-500/[0.01] text-xs space-y-1.5 text-muted-foreground">
                    <p className="font-bold text-red-700 dark:text-red-400 flex items-center gap-1.5 uppercase tracking-wide">
                      <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                      Nenhuma sugestão elegível no planejamento
                    </p>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      Motivos prováveis:
                      <br />• O professor não possui turmas ou contrato planejados para o turno {dialog.turno === "manha" ? "Matutino" : dialog.turno === "tarde" ? "Vespertino" : "Noturno"}.
                      <br />• Todas as turmas elegíveis do planejamento original já estão ocupadas ou com carga completa neste horário.
                    </p>
                    <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 mt-2">
                      💡 Dica: Ative a opção acima "Ignorar filtro de planejamento" para visualizar e alocar outras turmas compatíveis da matriz curricular neste turno.
                    </p>
                  </div>
                )}

                {dialogConflictError && (
                  <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3 py-3 flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-red-700 dark:text-red-300 font-medium leading-relaxed">{dialogConflictError}</p>
                  </div>
                )}

                {dialog.existing?.isLocked && (
                  <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2.5 flex items-center gap-2.5">
                    <Lock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <p className="text-xs text-amber-800 dark:text-amber-300 font-medium">Aula travada — definida como Horário Fixo no professor</p>
                  </div>
                )}
              </div>

              {/* Drawer Footer */}
              <div className="p-4 border-t border-border bg-muted/20 flex flex-col gap-2">
                <div className="flex gap-2">
                  <Button 
                    className="flex-1"
                    onClick={saveDialog} 
                    disabled={!editDiscId || !editProfId || !!dialog.existing?.isLocked} 
                    data-testid="dialog-button-save"
                  >
                    Salvar Alocação
                  </Button>
                  <Button 
                    variant="outline" 
                    className="flex-1"
                    onClick={() => setDialog((d) => ({ ...d, open: false }))}
                  >
                    Cancelar
                  </Button>
                </div>
                
                <div className="flex gap-2 justify-between">
                  {dialog.existing && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-9 text-xs"
                      onClick={() => {
                        setAlocacoes((prev) =>
                          prev.map((a) =>
                            a.id === dialog.existing!.id ? { ...a, isLocked: !a.isLocked } : a
                          )
                        );
                        setDialog((d) => ({ ...d, open: false }));
                      }}
                    >
                      {dialog.existing.isLocked ? (
                        <><Unlock className="w-3.5 h-3.5 mr-1.5" />Destravar Aula</>
                      ) : (
                        <><Lock className="w-3.5 h-3.5 mr-1.5" />Travar Horário</>
                      )}
                    </Button>
                  )}
                  {dialog.existing && !dialog.existing.isLocked && (
                    <Button 
                      variant="destructive" 
                      size="sm" 
                      className="flex-1 h-9 text-xs"
                      onClick={() => deleteAlocacao(dialog.existing!)} 
                      data-testid="dialog-button-delete"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                      Remover Aula
                    </Button>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AuditoriaModal 
        open={auditoriaOpen} 
        onClose={() => setAuditoriaOpen(false)} 
        turmas={turmas}
        disciplinas={disciplinas}
        professores={professores}
        matriz={matriz}
        alocacoes={alocacoes}
        setAlocacoes={setAlocacoes}
      />

      <progress.FeedbackProgress />
    </div>
  );
}
