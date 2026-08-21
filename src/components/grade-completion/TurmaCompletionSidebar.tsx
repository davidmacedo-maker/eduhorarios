import React, { useMemo, useEffect, useState } from "react";
import { 
  useRemainingLessons, 
  useSuggestedSlots 
} from "./hooks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useTurmas, useProfessores, useDisciplinas, useAlocacoes, useConfiguracaoHorarios, useMatrizCurricular } from "@/store";
import { CascadeMoveEngine, SolucaoCascata } from "@/lib/cascade-move-engine";
import { CascataVisualizer } from "../CascataVisualizer";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { 
  Sparkles, 
  CheckCircle2, 
  AlertTriangle, 
  User, 
  ArrowRight,
  Clock,
  BookOpen,
  Sliders,
  Trash2,
  ArrowLeft,
  X,
  Check
} from "lucide-react";

interface TurmaCompletionSidebarProps {
  mode?: "turma" | "professor";
  turmaId?: string; // Legacy prop
  selectedId?: string; // Unified identifier
  activeDiscId: string | null;
  activeTurmaId?: string | null; // Selected class under professor mode
  onActiveDiscChange: (discId: string, profId: string, turmaId?: string) => void;
  onSelectSuggestion: (s: any) => void;
  onDirectAllocate: (
    dia: string,
    horario: number,
    turno: "manha" | "tarde" | "noite",
    turmaId: string,
    profId: string,
    discId: string
  ) => void;
  showPossibleSlots?: boolean;
  onTogglePossibleSlots?: () => void;
  onClearGrade?: () => void;
  onPruneExcess?: () => void;
  selectedEmptySlot?: { dia: string; horario: number; turno: "manha" | "tarde" | "noite"; turmaId: string } | null;
  onClearEmptySlot?: () => void;
}

export function TurmaCompletionSidebar({
  mode = "turma",
  turmaId,
  selectedId,
  activeDiscId,
  activeTurmaId,
  onActiveDiscChange,
  onSelectSuggestion,
  onDirectAllocate,
  showPossibleSlots,
  onTogglePossibleSlots,
  onClearGrade,
  onPruneExcess,
  selectedEmptySlot,
  onClearEmptySlot,
}: TurmaCompletionSidebarProps) {
  const DIA_LABELS: Record<string, string> = {
    segunda: "Segunda",
    terca: "Terça",
    quarta: "Quarta",
    quinta: "Quinta",
    sexta: "Sexta",
  };

  const remainingLessons = useRemainingLessons();
  const [turmasList] = useTurmas();
  const [professoresList] = useProfessores();
  const [disciplinasList] = useDisciplinas();
  const [alocacoes, setAlocacoes] = useAlocacoes();
  const [config] = useConfiguracaoHorarios();
  const [matriz] = useMatrizCurricular();

  // State to hold active cascade solution to display in the modal
  const [selectedCascadeSolution, setSelectedCascadeSolution] = useState<SolucaoCascata | null>(null);
  const [cascadeModalOpen, setCascadeModalOpen] = useState(false);

  // Wizard state variables for clicked empty cell flow
  const [wizardDiscId, setWizardDiscId] = useState<string | null>(null);
  const [wizardProfId, setWizardProfId] = useState<string | null>(null);

  // Reset wizard state on empty slot change
  useEffect(() => {
    setWizardDiscId(null);
    setWizardProfId(null);
  }, [selectedEmptySlot]);

  // Determine the primary selected entity ID (either from selectedId or legacy turmaId)
  const entityId = selectedId || turmaId || "";

  // Fetch the active object depending on mode
  const currentTurmaObj = useMemo(() => {
    return mode === "turma" ? turmasList.find((t) => t.id === entityId) : null;
  }, [turmasList, entityId, mode]);

  const currentProfObj = useMemo(() => {
    return mode === "professor" ? professoresList.find((p) => p.id === entityId) : null;
  }, [professoresList, entityId, mode]);

  // Filter lessons for the current selected class (turma) or professor
  const entityLessons = useMemo(() => {
    if (mode === "professor") {
      return remainingLessons.filter((item) => item.professor.id === entityId);
    } else {
      return remainingLessons.filter((item) => item.turma.id === entityId);
    }
  }, [remainingLessons, entityId, mode]);

  // Separate pending (remaining > 0) lessons - Ordered by highest remaining first
  const pendingLessons = useMemo(() => {
    return entityLessons
      .filter((item) => item.restante > 0)
      .sort((a, b) => b.restante - a.restante);
  }, [entityLessons]);

  // Set the first pending lesson as active by default if none is chosen or current is no longer pending
  const activeLesson = useMemo(() => {
    if (mode === "professor") {
      if (activeDiscId && activeTurmaId) {
        const found = pendingLessons.find(
          (l) => l.disciplina.id === activeDiscId && l.turma.id === activeTurmaId
        );
        if (found) return found;
      } else if (activeDiscId) {
        const found = pendingLessons.find((l) => l.disciplina.id === activeDiscId);
        if (found) return found;
      }
    } else {
      if (activeDiscId) {
        const found = pendingLessons.find((l) => l.disciplina.id === activeDiscId);
        if (found) return found;
      }
    }
    return pendingLessons[0] || null;
  }, [pendingLessons, activeDiscId, activeTurmaId, mode]);

  // Auto update active lesson back to grade parent state
  useEffect(() => {
    if (activeLesson) {
      if (mode === "professor") {
        const isDifferent = activeLesson.disciplina.id !== activeDiscId || activeLesson.turma.id !== activeTurmaId;
        if (isDifferent) {
          onActiveDiscChange(activeLesson.disciplina.id, activeLesson.professor.id, activeLesson.turma.id);
        }
      } else {
        const isDifferent = activeLesson.disciplina.id !== activeDiscId;
        if (isDifferent) {
          onActiveDiscChange(activeLesson.disciplina.id, activeLesson.professor.id, activeLesson.turma.id);
        }
      }
    }
  }, [activeLesson, activeDiscId, activeTurmaId, onActiveDiscChange, mode]);

  // Fetch suggestions for the active pending lesson
  const suggestions = useSuggestedSlots(
    activeLesson?.professor?.id,
    activeLesson?.turma?.id,
    activeLesson?.disciplina?.id,
    activeLesson?.turma?.turno
  );

  // Find chess-strategy cascade solutions for the active lesson
  const cascadeSolutions = useMemo(() => {
    if (!activeLesson?.professor?.id || !activeLesson?.turma?.id || !activeLesson?.disciplina?.id) return [];

    const engine = new CascadeMoveEngine(
      alocacoes,
      professoresList,
      turmasList,
      disciplinasList,
      matriz,
      config
    );

    const solutionsList: SolucaoCascata[] = [];
    const DIAS = ["segunda", "terca", "quarta", "quinta", "sexta"];
    const turno = activeLesson.turma.turno;
    let totalSlots = 5;
    if (turno === "tarde") totalSlots = config.quantidadeHorariosPorDiaTarde || 5;
    else if (turno === "noite") totalSlots = config.quantidadeHorariosPorDiaNoite || 4;
    else totalSlots = config.quantidadeHorariosPorDia || 6;

    for (const dia of DIAS) {
      for (let h = 1; h <= totalSlots; h++) {
        // Only run cascade move engine if a direct slot is NOT already fully free and compatible
        const hasDirectSug = suggestions.some(s => s.dia === dia && s.horario === h);
        if (hasDirectSug) continue;

        const result = engine.encontrarSolucaoCascata(
          activeLesson.professor.id,
          activeLesson.turma.id,
          activeLesson.disciplina.id,
          dia,
          h
        );

        if (result.viavel && result.melhorSolucao) {
          solutionsList.push(result.melhorSolucao);
        }
      }
    }

    // Sort solutions by least depth (fewer movements first)
    return solutionsList.sort((a, b) => a.profundidade - b.profundidade);
  }, [activeLesson, alocacoes, professoresList, turmasList, disciplinasList, matriz, config, suggestions]);

  // Stats
  const totalPlanned = useMemo(() => entityLessons.reduce((acc, item) => acc + item.planejado, 0), [entityLessons]);
  const totalAllocated = useMemo(() => entityLessons.reduce((acc, item) => acc + item.alocado, 0), [entityLessons]);
  const totalRemaining = useMemo(() => Math.max(0, totalPlanned - totalAllocated), [totalPlanned, totalAllocated]);
  const percentage = useMemo(() => (totalPlanned > 0 ? Math.round((totalAllocated / totalPlanned) * 100) : 100), [totalPlanned, totalAllocated]);

  // Disciplines the professor teaches (for secondary heading label)
  const profDisciplinesNames = useMemo(() => {
    if (mode !== "professor" || !currentProfObj) return "";
    const names = Array.from(new Set(entityLessons.map((item) => item.disciplina.nome)));
    return names.length > 0 ? names.join(", ") : "Sem disciplinas";
  }, [entityLessons, currentProfObj, mode]);

  // Next Best Action (Recomendação Inteligente)
  const nextBestAction = useMemo(() => {
    if (pendingLessons.length === 0) return null;
    const targetLesson = activeLesson || pendingLessons[0];
    return {
      lesson: targetLesson,
      bestSlot: suggestions && suggestions.length > 0 ? suggestions[0] : null,
    };
  }, [pendingLessons, activeLesson, suggestions]);

  // We check if an empty slot is selected:
  if (selectedEmptySlot) {
    const wizardStep = !wizardDiscId ? "select_discipline" : !wizardProfId ? "select_professor" : "awaiting_click";

    // Determine the subject emoji
    const getEmoji = (name: string, index: number) => {
      const normalized = name.toLowerCase();
      if (normalized.includes("matemát")) return "📘";
      if (normalized.includes("portug") || normalized.includes("língua") || normalized.includes("lingua")) return "📗";
      if (normalized.includes("ciênc") || normalized.includes("quím") || normalized.includes("fís") || normalized.includes("biol")) return "orange_book"; // We can use emoji
      const emojis = ["📘", "📗", "📙", "📕"];
      return emojis[index % emojis.length];
    };

    // Calculate which professors are habilitados for selected discipline
    const wizardProfessors = (() => {
      if (!wizardDiscId) return [];
      // 1. Find planned professors for this class and discipline
      const plannedProfs = professoresList.filter((p) =>
        p.disciplinas.includes(wizardDiscId) &&
        (p.planejamento || []).some(
          (pl) => pl.turmaId === selectedEmptySlot.turmaId && pl.disciplinaId === wizardDiscId
        )
      );
      if (plannedProfs.length > 0) return plannedProfs;

      // 2. Fallback to any professor who can teach this discipline and is linked to the class
      const classProfs = [...professoresList].filter((p) =>
        p.disciplinas.includes(wizardDiscId) && p.turmas.includes(selectedEmptySlot.turmaId)
      );
      if (classProfs.length > 0) return classProfs;

      // 3. Absolute fallback to any professor who teaches this discipline
      return professoresList.filter((p) => p.disciplinas.includes(wizardDiscId));
    })();

    const targetTurmaName = currentTurmaObj?.nome ?? "Turma";
    const targetDiaLabel = DIA_LABELS[selectedEmptySlot.dia] ?? selectedEmptySlot.dia;
    const targetSlotLabel = `${selectedEmptySlot.horario}º Horário (${selectedEmptySlot.turno === "manha" ? "Manhã" : selectedEmptySlot.turno === "tarde" ? "Tarde" : "Noite"})`;

    return (
      <div className="space-y-4 no-print font-sans">
        <Card className="border-2 border-indigo-200 dark:border-indigo-950 shadow-lg flex flex-col overflow-hidden bg-card text-card-foreground">
          <CardHeader className="pb-3 border-b border-indigo-100 dark:border-indigo-950 bg-gradient-to-r from-indigo-100/10 via-indigo-50/5 to-transparent dark:from-indigo-950/10 flex flex-row items-center justify-between">
            <div className="flex-1 min-w-0 pr-2">
              <CardTitle className="text-xs font-black uppercase tracking-wider text-indigo-950 dark:text-indigo-400">
                🧙‍♂️ Assistente de Alocação Rápida
              </CardTitle>
              <CardDescription className="text-[10px] text-muted-foreground mt-0.5 truncate">
                {targetTurmaName} • {targetDiaLabel}, {targetSlotLabel}
              </CardDescription>
            </div>
            {onClearEmptySlot && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onClearEmptySlot}
                className="h-6 w-6 rounded-full hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600 transition-colors shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            {/* PROGRESS WIZARD INDICATOR */}
            <div className="flex items-center justify-between pb-2 border-b border-border/50 text-[10px] font-bold text-muted-foreground">
              <span className={wizardStep === "select_discipline" ? "text-indigo-600 dark:text-indigo-400" : ""}>
                1. Disciplina
              </span>
              <span className="text-border">/</span>
              <span className={wizardStep === "select_professor" ? "text-indigo-600 dark:text-indigo-400" : ""}>
                2. Professor
              </span>
              <span className="text-border">/</span>
              <span className={wizardStep === "awaiting_click" ? "text-indigo-600 dark:text-indigo-400" : ""}>
                3. Alocar
              </span>
            </div>

            {/* STEP 1: SELECT DISCIPLINE */}
            {wizardStep === "select_discipline" && (
              <div className="space-y-3">
                <div className="text-[11px] font-semibold text-foreground flex items-center justify-between">
                  <span>Faltam alocar nesta turma:</span>
                  <Badge variant="outline" className="bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-950 text-[10px]">
                    {pendingLessons.length} {pendingLessons.length === 1 ? "pendente" : "pendentes"}
                  </Badge>
                </div>

                {pendingLessons.length === 0 ? (
                  <div className="text-center py-6 text-xs text-muted-foreground">
                    🎉 Não há disciplinas pendentes para alocar nesta turma!
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
                    {pendingLessons.map((item, idx) => (
                      <button
                        key={item.id}
                        onClick={() => {
                          setWizardDiscId(item.disciplina.id);
                        }}
                        className="w-full p-3 text-left rounded-xl border border-border bg-card hover:bg-indigo-500/[0.04] hover:border-indigo-300 dark:hover:border-indigo-800 transition-all flex items-center justify-between group shadow-sm active:scale-[0.98]"
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <span className="text-base shrink-0">{getEmoji(item.disciplina.nome, idx)}</span>
                          <div className="space-y-0.5 min-w-0 flex-1">
                            <span className="font-bold text-foreground block text-xs truncate">
                              {item.disciplina.nome}
                            </span>
                            <span className="text-[10px] text-muted-foreground block truncate">
                              Professor original: {item.professor.nomeCompleto}
                            </span>
                          </div>
                        </div>
                        <Badge variant="outline" className="bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 border-indigo-100 dark:border-indigo-950 font-bold text-[10px] ml-2 shrink-0">
                          {item.restante} {item.restante === 1 ? "aula" : "aulas"}
                        </Badge>
                      </button>
                    ))}
                  </div>
                )}
                <div className="pt-2 text-[10px] text-muted-foreground italic text-center">
                  👉 Clique em uma disciplina para avançar.
                </div>
              </div>
            )}

            {/* STEP 2: SELECT PROFESSOR */}
            {wizardStep === "select_professor" && wizardDiscId && (
              <div className="space-y-3">
                <div className="flex items-center gap-1.5 text-xs text-indigo-950 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/20 p-2 rounded-lg border border-indigo-100/50 dark:border-indigo-950/50">
                  <span className="text-sm shrink-0">
                    {getEmoji(disciplinasList.find((d) => d.id === wizardDiscId)?.nome ?? "", 0)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="font-bold text-xs block truncate">
                      {disciplinasList.find((d) => d.id === wizardDiscId)?.nome}
                    </span>
                    <span className="text-[10px] text-muted-foreground block">
                      Selecione um professor habilitado abaixo:
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px] shrink-0"
                    onClick={() => {
                      setWizardDiscId(null);
                      setWizardProfId(null);
                      onActiveDiscChange("", "", "");
                    }}
                  >
                    Alterar
                  </Button>
                </div>

                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {wizardProfessors.length === 0 ? (
                    <div className="text-center py-6 text-xs text-muted-foreground border border-dashed rounded-lg">
                      Nenhum professor habilitado encontrado.
                    </div>
                  ) : (
                    wizardProfessors.map((p) => {
                      return (
                        <button
                          key={p.id}
                          onClick={() => {
                            setWizardProfId(p.id);
                            // Highlight possible slots immediately on grid
                            onActiveDiscChange(wizardDiscId, p.id, selectedEmptySlot.turmaId);
                            if (onTogglePossibleSlots && !showPossibleSlots) {
                              onTogglePossibleSlots();
                            }
                          }}
                          className="w-full p-3 text-left rounded-xl border border-border bg-card hover:bg-indigo-500/[0.04] hover:border-indigo-300 dark:hover:border-indigo-800 transition-all flex items-center justify-between group shadow-sm active:scale-[0.98]"
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <div className="w-7 h-7 rounded-full bg-indigo-50 dark:bg-indigo-950/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-extrabold text-[10px] shrink-0 border border-indigo-100 dark:border-indigo-900">
                              {p.nomeCompleto.split(" ").map(n => n[0]).slice(0, 2).join("")}
                            </div>
                            <div className="space-y-0.5 min-w-0 flex-1">
                              <span className="font-bold text-foreground block text-xs truncate">
                                {p.nomeCompleto}
                              </span>
                              <span className="text-[10px] text-muted-foreground block truncate">
                                {p.cargo || (p.masp ? `MASP: ${p.masp}` : "Professor")}
                              </span>
                            </div>
                          </div>
                          <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-indigo-600 transition-colors ml-2 shrink-0" />
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs h-9"
                    onClick={() => {
                      setWizardDiscId(null);
                      setWizardProfId(null);
                      onActiveDiscChange("", "", "");
                    }}
                  >
                    <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Voltar
                  </Button>
                </div>
              </div>
            )}

            {/* STEP 3: FOCUS HIGH-LIGHT AND ACTION AWAIT */}
            {wizardStep === "awaiting_click" && wizardDiscId && wizardProfId && (
              <div className="space-y-4">
                <div className="flex flex-col gap-1.5 p-3 rounded-lg border border-indigo-100/60 dark:border-indigo-950/50 bg-indigo-500/[0.02]">
                  <div className="flex items-center gap-2">
                    <span className="text-base shrink-0">
                      {getEmoji(disciplinasList.find((d) => d.id === wizardDiscId)?.nome ?? "", 0)}
                    </span>
                    <span className="font-bold text-xs text-foreground truncate">
                      {disciplinasList.find((d) => d.id === wizardDiscId)?.nome}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <User className="w-3 h-3 text-indigo-500 shrink-0" />
                    <span className="truncate">{professoresList.find((p) => p.id === wizardProfId)?.nomeCompleto}</span>
                  </div>
                </div>

                <div className="space-y-3 text-center py-5 px-3 border border-dashed rounded-xl bg-emerald-500/[0.03] border-emerald-500/20">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto text-emerald-600 dark:text-emerald-400">
                    <Sparkles className="w-5 h-5 animate-bounce" />
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-xs font-black text-emerald-800 dark:text-emerald-400 uppercase tracking-wide">
                      Análise Inteligente Ativa!
                    </h4>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      Destaques ativados! O sistema calculou o impacto no IQG para cada célula livre da tabela de horários.
                    </p>
                    <div className="p-2.5 bg-emerald-500/10 rounded-lg text-emerald-800 dark:text-emerald-400 font-extrabold border border-emerald-500/20 text-[11px] mt-2 leading-tight">
                      👈 Clique em qualquer horário destacado em VERDE ou AMARELO na grade de horários para alocar!
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs h-9"
                    onClick={() => {
                      setWizardProfId(null);
                      onActiveDiscChange("", "", "");
                    }}
                  >
                    <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Voltar
                  </Button>
                  {onClearEmptySlot && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 h-9"
                      onClick={onClearEmptySlot}
                    >
                      <X className="w-3.5 h-3.5 mr-1" /> Fechar
                    </Button>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* CARD 1: ASSISTENTE DE ALOCAÇÃO */}
      <Card className="border border-indigo-100 dark:border-indigo-950/40 shadow-md flex flex-col overflow-hidden bg-card text-card-foreground">
        <CardHeader className="pb-3 border-b border-indigo-50 dark:border-indigo-950 bg-gradient-to-r from-indigo-50/20 via-white to-transparent dark:from-indigo-950/10 flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-500 animate-pulse shrink-0" />
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-indigo-950 dark:text-indigo-400">
              {mode === "professor" ? "Assistente de Alocação - Professor" : "Assistente de Alocação"}
            </CardTitle>
          </div>
          <CardDescription className="text-[11px] text-muted-foreground leading-relaxed">
            Assistente inteligente para alocação rápida e sem conflitos.
          </CardDescription>
        </CardHeader>

        {/* Progress header for the class or professor */}
        <div className="px-4 py-4 bg-indigo-500/[0.02] border-b border-muted space-y-3">
          <div className="grid grid-cols-2 gap-2 text-xs border-b pb-2">
            <div className="overflow-hidden">
              <span className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider block">
                📊 {mode === "professor" ? "Progresso do Professor" : "Progresso da Turma"}
              </span>
              {mode === "professor" ? (
                <div className="truncate mt-1">
                  <span className="font-extrabold text-foreground text-sm block truncate" title={currentProfObj?.nomeCompleto}>
                    {currentProfObj?.nomeCompleto || "Carregando..."}
                  </span>
                  <span className="text-[10px] text-muted-foreground block truncate" title={profDisciplinesNames}>
                    {profDisciplinesNames}
                  </span>
                </div>
              ) : (
                <span className="font-extrabold text-foreground text-sm truncate block mt-1">
                  {currentTurmaObj?.nome || "Carregando..."}
                </span>
              )}
            </div>
            <div className="text-right shrink-0">
              <span className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider block">Concluído</span>
              <span className="font-extrabold text-indigo-700 dark:text-indigo-400 text-sm block mt-1">
                {percentage}%
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1 text-center py-1">
            <div className="bg-slate-500/5 p-1.5 rounded">
              <span className="text-[9px] text-muted-foreground block font-medium">Previstas</span>
              <span className="font-extrabold text-xs text-foreground">{totalPlanned}h</span>
            </div>
            <div className="bg-indigo-500/5 p-1.5 rounded">
              <span className="text-[9px] text-indigo-600 dark:text-indigo-400 block font-medium">Alocadas</span>
              <span className="font-extrabold text-xs text-indigo-600 dark:text-indigo-400">{totalAllocated}h</span>
            </div>
            <div className="bg-rose-500/5 p-1.5 rounded">
              <span className="text-[9px] text-rose-600 dark:text-rose-400 block font-medium">Restam</span>
              <span className="font-extrabold text-xs text-rose-600 dark:text-rose-400">{totalRemaining}h</span>
            </div>
          </div>

          <div className="w-full bg-slate-100 dark:bg-slate-900 rounded-full h-2 overflow-hidden border p-0.5">
            <div 
              className="bg-indigo-600 dark:bg-indigo-500 h-full rounded-full transition-all duration-700 ease-out" 
              style={{ width: `${percentage}%` }}
            />
          </div>
        </div>

        <div className="flex-1 p-4 space-y-4 max-h-[500px] overflow-y-auto">
          {/* PENDING LESSONS SECTION */}
          <div className="space-y-3">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              📚 {mode === "professor" ? "Turmas Pendentes de Alocação" : "Disciplinas Pendentes"}
            </h4>
            
            {pendingLessons.length === 0 ? (
              <div className="text-center py-8 px-4 border border-dashed rounded-xl bg-emerald-500/[0.04] border-emerald-500/30 space-y-3">
                <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-bold text-emerald-800 dark:text-emerald-400">Tudo Alocado!</p>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Parabéns, esta {mode === "professor" ? "agenda de professor" : "grade de turma"} está 100% concluída.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1 scrollbar-thin">
                {pendingLessons.map((item, idx) => {
                  const isActive = mode === "professor" 
                    ? activeDiscId === item.disciplina.id && activeTurmaId === item.turma.id
                    : activeDiscId === item.disciplina.id;
                  
                  const getEmoji = (name: string, index: number) => {
                    const normalized = name.toLowerCase();
                    if (normalized.includes("matemát")) return "📘";
                    if (normalized.includes("portug") || normalized.includes("língua") || normalized.includes("lingua")) return "📗";
                    if (normalized.includes("ciênc") || normalized.includes("quím") || normalized.includes("fís") || normalized.includes("biol")) return "📙";
                    if (normalized.includes("histó") || normalized.includes("geogr") || normalized.includes("art") || normalized.includes("filos") || normalized.includes("sociol")) return "📕";
                    const emojis = ["📘", "📗", "📙", "📕"];
                    return emojis[index % emojis.length];
                  };

                  return (
                    <button
                      key={item.id}
                      onClick={() => onActiveDiscChange(item.disciplina.id, item.professor.id, item.turma.id)}
                      className={`w-full p-3 text-left rounded-lg border text-xs transition-all relative flex flex-col gap-1.5 ${
                        isActive
                          ? "border-indigo-500 bg-indigo-500/[0.06] shadow-sm ring-1 ring-indigo-500/30 font-semibold"
                          : "border-border hover:border-indigo-300 dark:hover:border-indigo-900 bg-card hover:bg-indigo-500/[0.01]"
                      }`}
                    >
                      {/* Emoji + Title */}
                      <div className="flex items-center justify-between gap-1 w-full">
                        <div className="flex items-center gap-1.5 overflow-hidden">
                          <span className="text-sm shrink-0">
                            {mode === "professor" ? "🏫" : getEmoji(item.disciplina.nome, idx)}
                          </span>
                          <span className="font-extrabold text-foreground text-xs truncate">
                            {mode === "professor" ? item.turma.nome : item.disciplina.nome}
                          </span>
                        </div>
                        <Badge variant="secondary" className="bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-0 text-[9px] font-bold px-1.5 py-0.5 shrink-0">
                          -{item.restante}h
                        </Badge>
                      </div>

                      {/* Content Details */}
                      <div className="space-y-0.5 text-[10px] text-muted-foreground pl-5 border-l border-indigo-100 dark:border-indigo-900/40 w-full">
                        {mode === "professor" ? (
                          <p className="truncate">
                            <strong className="text-foreground/80 font-medium">Disciplina:</strong> {item.disciplina.nome}
                          </p>
                        ) : (
                          <p className="truncate">
                            <strong className="text-foreground/80 font-medium">Professor:</strong> {item.professor.nomeCompleto}
                          </p>
                        )}
                        <p>
                          <strong className="text-foreground/80 font-medium">Carga prevista:</strong> {item.planejado} {item.planejado === 1 ? "aula" : "aulas"}
                        </p>
                        <p>
                          <strong className="text-foreground/80 font-medium">Carga alocada:</strong> {item.alocado} {item.alocado === 1 ? "aula" : "aulas"}
                        </p>
                        <p className="text-rose-600 dark:text-rose-400 font-semibold flex items-center gap-1 mt-1">
                          <span>✅ Faltam:</span> 
                          <span className="underline decoration-wavy decoration-rose-500/50">{item.restante} {item.restante === 1 ? "aula" : "aulas"}</span>
                        </p>
                      </div>

                      <div className="flex items-center justify-between mt-1 text-[10px] text-indigo-600 dark:text-indigo-400 pt-1 border-t border-dashed border-slate-100 dark:border-slate-900/50 w-full pl-5">
                        <span>{mode === "professor" ? "Clique para destacar grade" : "Clique para ativar modo foco"}</span>
                        <ArrowRight className="w-3 h-3 shrink-0" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* PRÓXIMA MELHOR AÇÃO (RECOMENDAÇÃO INTELIGENTE) */}
          {nextBestAction && nextBestAction.bestSlot && (
            <div className="p-3 border border-indigo-100 dark:border-indigo-950 bg-gradient-to-br from-indigo-50/10 to-slate-50 dark:from-slate-950 dark:to-indigo-950/10 rounded-xl space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-indigo-700 dark:text-indigo-400 flex items-center gap-1">
                  💡 Sugestão do Próximo Melhor Horário
                </span>
                <Badge variant="outline" className="text-[8px] bg-indigo-500/10 border-indigo-200/50 text-indigo-700 dark:text-indigo-400 font-extrabold px-1.5 py-0.2 shrink-0">
                  IQG 98%
                </Badge>
              </div>

              <div className="space-y-1">
                <h5 className="text-xs font-bold text-foreground">
                  Sugerido: {nextBestAction.lesson.disciplina.nome} ({nextBestAction.lesson.turma.nome})
                </h5>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Faltam alocar <strong className="text-foreground">{nextBestAction.lesson.restante} aulas</strong>. O melhor horário sem conflitos identificado pelo motor é:
                </p>
                <div className="flex items-center gap-1.5 text-xs text-indigo-900 dark:text-indigo-300 font-bold bg-indigo-500/5 p-2 rounded-lg border border-indigo-500/10 mt-1.5">
                  <Clock className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                  <span>{DIA_LABELS[nextBestAction.bestSlot.dia]}, {nextBestAction.bestSlot.horario}º Horário</span>
                </div>
              </div>

              <Button
                size="sm"
                className="w-full font-bold text-xs bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm flex items-center justify-center gap-1 h-8 mt-1"
                onClick={() => {
                  // Focus on the recommendation lesson first
                  onActiveDiscChange(nextBestAction.lesson.disciplina.id, nextBestAction.lesson.professor.id, nextBestAction.lesson.turma.id);
                  // Trigger visual suggestion highlight & scrolling
                  onSelectSuggestion(nextBestAction.bestSlot);
                }}
              >
                <ArrowRight className="w-3.5 h-3.5" />
                Ir para melhor horário
              </Button>
            </div>
          )}

          {/* RECENTLY FILTERED SUGGESTIONS SLOTS (ONLY IF ACTIVE LESSON EXISTS AND HAS SLOTS) */}
          {activeLesson && suggestions.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-dashed">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3 text-indigo-500" />
                Outras Opções Compatíveis:
              </h4>

              <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-1 scrollbar-thin">
                {suggestions.slice(1, 4).map((suggestion, idx) => (
                  <div
                    key={idx}
                    className="p-2 border border-border rounded-lg flex items-center justify-between gap-3 bg-card"
                  >
                    <div className="space-y-0.5">
                      <span className="text-[10px] font-bold capitalize text-foreground block">
                        {DIA_LABELS[suggestion.dia]}, {suggestion.horario}º H
                      </span>
                      <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-bold block">
                        Sem Conflitos
                      </span>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      className="font-bold text-[10px] h-7 px-2 shrink-0"
                      onClick={() => {
                        onDirectAllocate(
                          suggestion.dia,
                          suggestion.horario,
                          suggestion.turno,
                          activeLesson.turma.id,
                          activeLesson.professor.id,
                          activeLesson.disciplina.id
                        );
                        onSelectSuggestion(suggestion);
                      }}
                    >
                      Alocar
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ESTRATÉGIA DE XADREZ: CASCADE SUGGESTIONS */}
          {activeLesson && cascadeSolutions.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-dashed">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-amber-500 animate-pulse" />
                Estratégias de Xadrez (Cascata):
              </h4>
              <p className="text-[9px] text-muted-foreground leading-snug">
                Soluções inteligentes resolvendo conflitos em cadeia de forma automatizada:
              </p>

              <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-1 scrollbar-thin">
                {cascadeSolutions.slice(0, 3).map((solution, idx) => (
                  <div
                    key={idx}
                    className="p-2 border border-amber-200/50 dark:border-amber-950/40 rounded-lg flex items-center justify-between gap-3 bg-amber-50/20 dark:bg-amber-950/10"
                  >
                    <div className="space-y-0.5">
                      <span className="text-[10px] font-bold capitalize text-amber-800 dark:text-amber-300 block">
                        Alocar {DIA_LABELS[solution.movimentos[0].paraDia]}, {solution.movimentos[0].paraHorario}º H
                      </span>
                      <span className="text-[9px] text-amber-600 dark:text-amber-400 font-medium block">
                        Cadeia de {solution.profundidade} {solution.profundidade === 1 ? "movimento" : "movimentos"} • Impacto IQG: +{solution.analise.impactoIQG}
                      </span>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      className="border-amber-200 hover:bg-amber-100 dark:border-amber-950 dark:hover:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-bold text-[10px] h-7 px-2 shrink-0"
                      onClick={() => {
                        setSelectedCascadeSolution(solution);
                        setCascadeModalOpen(true);
                      }}
                    >
                      Analisar
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* CARD 2: PAINEL INTELIGENTE */}
      <Card className="border border-indigo-100 dark:border-indigo-950/40 shadow-md overflow-hidden bg-card text-card-foreground">
        <CardHeader className="pb-3 border-b border-indigo-50 dark:border-indigo-950 bg-gradient-to-r from-indigo-50/20 via-white to-transparent dark:from-indigo-950/10 flex flex-row items-center gap-2">
          <Sliders className="w-4 h-4 text-indigo-500 shrink-0" />
          <CardTitle className="text-sm font-bold uppercase tracking-wider text-indigo-950 dark:text-indigo-400">
            Painel Inteligente
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          <div className="space-y-2 text-xs text-muted-foreground bg-indigo-500/[0.02] p-3 rounded-lg border border-indigo-100/40">
            <div className="flex justify-between items-center py-0.5 border-b border-slate-100 dark:border-slate-800 pb-1.5">
              <span className="font-semibold text-[10px] uppercase text-slate-500">Turma</span>
              <span className="font-bold text-foreground text-right max-w-[150px] truncate">
                {activeLesson?.turma.nome || currentTurmaObj?.nome || "Sem Seleção"}
              </span>
            </div>
            <div className="flex justify-between items-center py-0.5 border-b border-slate-100 dark:border-slate-800 py-1.5">
              <span className="font-semibold text-[10px] uppercase text-slate-500">Disciplina</span>
              <span className="font-bold text-foreground text-right max-w-[150px] truncate flex items-center gap-1.5 justify-end">
                {activeLesson ? (
                  <>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: activeLesson.disciplina.cor }} />
                    {activeLesson.disciplina.nome}
                  </>
                ) : "Concluído"}
              </span>
            </div>
            <div className="flex justify-between items-center py-0.5 pt-1.5">
              <span className="font-semibold text-[10px] uppercase text-slate-500">Professor</span>
              <span className="font-bold text-foreground text-right max-w-[150px] truncate">
                {activeLesson?.professor.nomeCompleto || currentProfObj?.nomeCompleto || "Sem Seleção"}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Button
              variant={showPossibleSlots ? "default" : "outline"}
              size="sm"
              onClick={onTogglePossibleSlots}
              className="w-full h-8 text-xs font-bold flex items-center justify-center gap-1.5"
            >
              <Sliders className="w-3.5 h-3.5" />
              {showPossibleSlots ? "Esconder Grelha Estática" : "Mostrar Slots Possíveis"}
            </Button>

            {onClearGrade && (
              <Button
                variant="outline"
                size="sm"
                onClick={onClearGrade}
                className="w-full h-8 text-xs font-bold text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/25 border-rose-200 hover:border-rose-300 dark:border-rose-900/50 flex items-center justify-center gap-1.5 animate-none"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Limpar Grade
              </Button>
            )}

            {onPruneExcess && (
              <Button
                variant="outline"
                size="sm"
                onClick={onPruneExcess}
                className="w-full h-8 text-xs font-bold text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/25 border-amber-200 hover:border-amber-300 dark:border-amber-900/50 flex items-center justify-center gap-1.5"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                Remover Aulas Excedentes
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* DIALOG FOR CASCADE VISUALIZER */}
      <Dialog open={cascadeModalOpen} onOpenChange={setCascadeModalOpen}>
        <DialogContent className="sm:max-w-[550px] p-0 overflow-hidden bg-background border border-border">
          <DialogTitle className="sr-only">Visualização de Movimentações em Cascata</DialogTitle>
          {selectedCascadeSolution && (
            <CascataVisualizer
              solucao={selectedCascadeSolution}
              onFechar={() => {
                setCascadeModalOpen(false);
                setSelectedCascadeSolution(null);
              }}
              onExecutar={() => {
                // Instantiate engine and execute solution
                const engine = new CascadeMoveEngine(
                  alocacoes,
                  professoresList,
                  turmasList,
                  disciplinasList,
                  matriz,
                  config
                );
                
                const res = engine.executarSolucao(selectedCascadeSolution);
                if (res.sucesso) {
                  setAlocacoes(res.alocacoes);
                }
                setCascadeModalOpen(false);
                setSelectedCascadeSolution(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
