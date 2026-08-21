import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useProfessores, useDisciplinas, useTurmas, useAlocacoes, generateId, useConfiguracaoHorarios, useMatrizCurricular } from "@/store";
import { professoresDbService } from "@/lib/database/professores.service";
import type { Professor, Alocacao, PlanejamentoItem } from "@/types";
import { runAllocation } from "@/lib/schedule-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, GraduationCap, CalendarDays, Lock, AlertTriangle, Check, Sparkles, Wand2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

const DIAS = ["segunda", "terca", "quarta", "quinta", "sexta"] as const;
const DIA_LABELS: Record<string, string> = { segunda: "Seg", terca: "Ter", quarta: "Qua", quinta: "Qui", sexta: "Sex" };

const professorSchema = z.object({
  nomeCompleto: z.string()
    .refine(
      v => v.trim().length > 0,
      "Informe o nome completo do professor."
    ),
  masp: z.string().optional(),
  cargo: z.string().optional(),
  dataAdmissao: z.string()
    .optional()
    .refine(
      (val) => !val || /^(0[1-9]|[1-9][0-9])$/.test(val),
      "Formato inválido. Use somente duas posições, ex: 01, 02, 03"
    ),
  tipoVinculo: z.enum(["efetivo", "designado", ""]).optional(),
  disciplinas: z.array(z.string()),
  turmas: z.array(z.string()),
  cargaHorariaMaximaSemanal: z.coerce.number().min(1).max(60),
});

type ProfForm = z.infer<typeof professorSchema>;

const DIA_LABELS_FULL: Record<string, string> = {
  segunda: "Segunda",
  terca: "Terça",
  quarta: "Quarta",
  quinta: "Quinta",
  sexta: "Sexta",
};

export default function Professores() {
  const [professores, setProfessores] = useProfessores();
  const [config] = useConfiguracaoHorarios();
  const [disciplinas] = useDisciplinas();
  const [turmas] = useTurmas();
  const [alocacoes, setAlocacoes] = useAlocacoes();
  const [matriz] = useMatrizCurricular();
  const [modalOpen, setModalOpen] = useState(false);
  const [activeProfId, setActiveProfId] = useState<string | null>(null);
  const [alocacoesSnapshot, setAlocacoesSnapshot] = useState<Alocacao[]>([]);
  const isSubmittedRef = useRef(false);

  const [editingProf, setEditingProf] = useState<Professor | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Professor | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [massReleaseOpen, setMassReleaseOpen] = useState(false);
  const [massOptimizeOpen, setMassOptimizeOpen] = useState(false);
  const [disponibilidade, setDisponibilidade] = useState<Record<string, number[]>>({});
  const [planejamentoItems, setPlanejamentoItems] = useState<PlanejamentoItem[]>([]);
  const [search, setSearch] = useState("");
  const [fixoDisc, setFixoDisc] = useState("");
  const [fixoTurma, setFixoTurma] = useState("");
  const [fixoDia, setFixoDia] = useState("");
  const [fixoHorario, setFixoHorario] = useState("");
  const { toast } = useToast();

  const [formTab, setFormTab] = useState("dados-gerais");
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [dragMode, setDragMode] = useState<"add" | "remove" | null>(null);

  // Carregar dados oficiais de Professores do Supabase ao montar a página
  useEffect(() => {
    async function carregarProfessoresSupabase() {
      try {
        const dados = await professoresDbService.listar();
        if (dados && dados.length > 0) {
          setProfessores(dados);
        }
      } catch (err) {
        console.warn("Aviso ao carregar professores do Supabase:", err);
      }
    }
    carregarProfessoresSupabase();
  }, []);

  const form = useForm<ProfForm>({
    resolver: zodResolver(professorSchema),
    mode: "onSubmit",
    reValidateMode: "onBlur",
    defaultValues: { nomeCompleto: "", masp: "", cargo: "", dataAdmissao: "", tipoVinculo: "", disciplinas: [], turmas: [], cargaHorariaMaximaSemanal: 20 },
  });

  const selectedDiscs = form.watch("disciplinas") ?? [];
  const selectedTurmas = form.watch("turmas") ?? [];

  useEffect(() => {
    if (!modalOpen) return;
    const planDiscs = (planejamentoItems || []).map((x) => x.disciplinaId).filter(Boolean);
    const planTurmas = (planejamentoItems || []).map((x) => x.turmaId).filter(Boolean);

    const currentDiscs = form.getValues("disciplinas") ?? [];
    const currentTurmas = form.getValues("turmas") ?? [];

    const missingDiscs = planDiscs.filter((d) => !currentDiscs.includes(d));
    const missingTurmas = planTurmas.filter((t) => !currentTurmas.includes(t));

    if (missingDiscs.length > 0 || missingTurmas.length > 0) {
      const newDiscs = Array.from(new Set([...currentDiscs, ...planDiscs]));
      const newTurmas = Array.from(new Set([...currentTurmas, ...planTurmas]));
      form.setValue("disciplinas", newDiscs);
      form.setValue("turmas", newTurmas);
    }
  }, [planejamentoItems, modalOpen, form]);

  const maxPeriods = Math.max(
    config.quantidadeHorariosPorDia ?? 6,
    config.habilitarTarde ? (config.quantidadeHorariosPorDiaTarde ?? 0) : 0,
    config.habilitarNoite ? (config.quantidadeHorariosPorDiaNoite ?? 0) : 0
  );

  const totalActivePeriods = (
    (config.quantidadeHorariosPorDia ?? 6) +
    (config.habilitarTarde ? (config.quantidadeHorariosPorDiaTarde ?? 5) : 0) +
    (config.habilitarNoite ? (config.quantidadeHorariosPorDiaNoite ?? 4) : 0)
  );

  const totalAvailableSlots = DIAS.reduce((sum, dia) => sum + (disponibilidade[dia]?.length || 0), 0);
  const is100PercentUnavailable = totalAvailableSlots === 0;

  function openCreate() {
    isSubmittedRef.current = false;
    setFormTab("dados-gerais");
    form.reset({ nomeCompleto: "", masp: "", cargo: "", dataAdmissao: "", tipoVinculo: "", disciplinas: [], turmas: [], cargaHorariaMaximaSemanal: 20 });
    const allDays: Record<string, number[]> = {};
    DIAS.forEach((d) => {
      const slots = [];
      const qManha = config.quantidadeHorariosPorDia ?? 6;
      for (let i = 1; i <= qManha; i++) {
        slots.push(i);
      }
      if (config.habilitarTarde) {
        const qTarde = config.quantidadeHorariosPorDiaTarde ?? 5;
        for (let i = 1; i <= qTarde; i++) {
          slots.push(i + 10);
        }
      }
      if (config.habilitarNoite) {
        const qNoite = config.quantidadeHorariosPorDiaNoite ?? 4;
        for (let i = 1; i <= qNoite; i++) {
          slots.push(i + 20);
        }
      }
      allDays[d] = slots;
    });
    setDisponibilidade(allDays);
    setPlanejamentoItems([]);
    setEditingProf(null);
    const newId = generateId();
    setActiveProfId(newId);
    setAlocacoesSnapshot(alocacoes);
    setModalOpen(true);
  }

  function openEdit(prof: Professor) {
    isSubmittedRef.current = false;
    setFormTab("dados-gerais");
    let normalizedPlan: PlanejamentoItem[] = [];
    if (Array.isArray(prof.planejamento)) {
      normalizedPlan = prof.planejamento.map((item: any) => {
        const rawAulas = item.aulasPorSemana !== undefined ? item.aulasPorSemana : item.quantidadeAulas;
        const parsedVal = Number(rawAulas) || 0;
        return {
          disciplinaId: item.disciplinaId || "",
          turmaId: item.turmaId || "",
          aulasPorSemana: parsedVal,
          quantidadeAulas: parsedVal,
          maximoAulasPorDia: item.maximoAulasPorDia !== undefined && item.maximoAulasPorDia !== null ? Number(item.maximoAulasPorDia) : undefined,
          maximoConsecutivas: item.maximoConsecutivas !== undefined && item.maximoConsecutivas !== null ? Number(item.maximoConsecutivas) : undefined,
          exigeGeminacao: !!item.exigeGeminacao,
          prioridade: item.prioridade || undefined,
        };
      });
    } else if (prof.planejamento && typeof prof.planejamento === "object") {
      normalizedPlan = Object.entries(prof.planejamento).map(([disciplinaId, aulas]) => {
        const parsedVal = Number(aulas) || 0;
        return {
          disciplinaId,
          turmaId: prof.turmas?.[0] || "",
          aulasPorSemana: parsedVal,
          quantidadeAulas: parsedVal,
          maximoAulasPorDia: undefined,
          maximoConsecutivas: undefined,
          exigeGeminacao: false,
          prioridade: undefined,
        };
      }).filter(item => item.aulasPorSemana > 0);
    }

    const planDiscs = normalizedPlan.map(x => x.disciplinaId).filter(Boolean);
    const planTurmas = normalizedPlan.map(x => x.turmaId).filter(Boolean);
    const combinedDiscs = Array.from(new Set([...(prof.disciplinas ?? []), ...planDiscs]));
    const combinedTurmas = Array.from(new Set([...(prof.turmas ?? []), ...planTurmas]));

    form.reset({
      nomeCompleto: prof.nomeCompleto,
      masp: prof.masp ?? "",
      cargo: prof.cargo ?? "",
      dataAdmissao: prof.dataAdmissao ?? "",
      tipoVinculo: prof.tipoVinculo ?? "",
      disciplinas: combinedDiscs,
      turmas: combinedTurmas,
      cargaHorariaMaximaSemanal: prof.cargaHorariaMaximaSemanal ?? 20,
    });
    setDisponibilidade(
      prof.disponibilidade != null && typeof prof.disponibilidade === "object"
        ? prof.disponibilidade
        : {}
    );
    setPlanejamentoItems(normalizedPlan);
    setEditingProf(prof);
    setActiveProfId(prof.id);
    setAlocacoesSnapshot(alocacoes);
    setModalOpen(true);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let editId = params.get("edit");
    const sessionEditId = sessionStorage.getItem("edit_professor_id");
    if (sessionEditId) {
      editId = sessionEditId;
    }

    if (editId && professores.length > 0 && !modalOpen) {
      const found = professores.find((p) => p.id === editId);
      if (found) {
        sessionStorage.removeItem("edit_professor_id");
        if (window.location.search) {
          const cleanUrl = window.location.origin + window.location.pathname;
          window.history.replaceState({}, document.title, cleanUrl);
        }
        openEdit(found);
      }
    }
  }, [professores, modalOpen]);

  useEffect(() => {
    const handleMouseUp = () => {
      setIsMouseDown(false);
      setDragMode(null);
    };
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  function handleCloseModal(open: boolean) {
    if (!open) {
      if (!isSubmittedRef.current) {
        setAlocacoes(alocacoesSnapshot);
      }
      setActiveProfId(null);
    }
    setModalOpen(open);
  }

  function toggleDisponibilidade(dia: string, horario: number) {
    setDisponibilidade((prev) => {
      const current = (prev[dia] ?? []).map(Number);
      if (current.includes(horario)) {
        return { ...prev, [dia]: current.filter((h) => h !== horario) };
      }
      return { ...prev, [dia]: [...current, horario].sort((a, b) => a - b) };
    });
  }

  function toggleDisponibilidadeTo(dia: string, horario: number, makeAvailable: boolean) {
    setDisponibilidade((prev) => {
      const current = (prev[dia] ?? []).map(Number);
      const exists = current.includes(horario);
      if (makeAvailable) {
        if (exists) return prev;
        return { ...prev, [dia]: [...current, horario].sort((a, b) => a - b) };
      } else {
        if (!exists) return prev;
        return { ...prev, [dia]: current.filter((h) => h !== horario) };
      }
    });
  }

  function fillAllDisponibilidade() {
    const fullDispo: Record<string, number[]> = {};
    const maxManha = config.quantidadeHorariosPorDia ?? 6;
    const maxTarde = config.quantidadeHorariosPorDiaTarde ?? 5;
    const maxNoite = config.quantidadeHorariosPorDiaNoite ?? 4;

    DIAS.forEach((dia) => {
      const hours: number[] = [];
      for (let h = 1; h <= maxManha; h++) hours.push(h);
      if (config.habilitarTarde) {
        for (let h = 1; h <= maxTarde; h++) hours.push(h + 10);
      }
      if (config.habilitarNoite) {
        for (let h = 1; h <= maxNoite; h++) hours.push(h + 20);
      }
      fullDispo[dia] = hours;
    });

    setDisponibilidade(fullDispo);
  }

  function optimizeParameters() {
    // 1. Resolve disciplines and turmas configured in the planning list
    const discIds = form.getValues("disciplinas") ?? [];
    const tIds = form.getValues("turmas") ?? [];

    let initializedPlan = [...planejamentoItems];

    // If planning list is empty, initialize it using the matrix matching selected disciplines and turmas
    if (initializedPlan.length === 0) {
      const newItems: PlanejamentoItem[] = [];
      discIds.forEach((dId) => {
        tIds.forEach((tId) => {
          const match = matriz.find((m) => m.disciplinaId === dId && m.turmaId === tId);
          if (match) {
            newItems.push({
              disciplinaId: dId,
              turmaId: tId,
              aulasPorSemana: match.aulasPorSemana,
              quantidadeAulas: match.aulasPorSemana,
            });
          }
        });
      });
      initializedPlan = newItems;
    }

    // Apply fine-grained parameter updates
    let count5 = 0;
    let count4 = 0;

    const optimized = initializedPlan.map((item) => {
      const tObj = turmas.find((t) => t.id === item.turmaId);
      const is101 = tObj && (tObj.nome.includes("101") || tObj.nome === "101" || tObj.id === "turma_4");
      const numAulas = Number(item.aulasPorSemana) || 0;

      if (numAulas === 5) {
        count5++;
        return {
          ...item,
          maximoAulasPorDia: 2,
          maximoConsecutivas: 2,
          exigeGeminacao: false,
          prioridade: "media" as const,
        };
      } else if (numAulas === 4 || is101) {
        count4++;
        return {
          ...item,
          maximoAulasPorDia: 2,
          maximoConsecutivas: 2,
          exigeGeminacao: false,
          prioridade: "media" as const,
        };
      }
      return item;
    });

    setPlanejamentoItems(optimized);

    // 2. Disponibilidade por Turno (Matutino vs Vespertino)
    const updatedDispo = { ...disponibilidade };
    
    // Check which shifts are present in the optimized planning
    const hasManha = optimized.some((item) => {
      const tObj = turmas.find((t) => t.id === item.turmaId);
      return tObj && tObj.turno === "manha";
    });

    const hasTarde = optimized.some((item) => {
      const tObj = turmas.find((t) => t.id === item.turmaId);
      return tObj && tObj.turno === "tarde";
    });

    DIAS.forEach((dia) => {
      const hours: number[] = [];
      // Matutino (Manhã): 1..config.quantidadeHorariosPorDia
      if (hasManha) {
        for (let h = 1; h <= (config.quantidadeHorariosPorDia ?? 6); h++) {
          hours.push(h);
        }
      }
      // Vespertino (Tarde): 11..(10 + config.quantidadeHorariosPorDiaTarde)
      if (hasTarde) {
        const maxTarde = config.quantidadeHorariosPorDiaTarde ?? 5;
        for (let h = 1; h <= maxTarde; h++) {
          hours.push(h + 10);
        }
      }
      // Block the rest or unused slots to prevent gaps ('janelas')
      updatedDispo[dia] = hours;
    });

    setDisponibilidade(updatedDispo);
  }

  function renderAvailabilityTable(turno: "manha" | "tarde" | "noite", length: number, offset: number) {
    return (
      <Table className="select-none">
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead className="w-[130px] text-center font-bold">Horário</TableHead>
            {DIAS.map((dia) => {
              const isWeekend = (dia as string) === "sabado" || (dia as string) === "domingo";
              return (
                <TableHead key={dia} className={`text-center font-bold capitalize ${isWeekend ? "text-amber-600 bg-amber-500/10 dark:bg-amber-950/30 border-amber-200/50" : ""}`}>
                  {DIA_LABELS_FULL[dia]}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length }).map((_, slotIdx) => {
            const hNum = slotIdx + 1;
            const actualHour = hNum + offset;
            return (
              <TableRow key={hNum} className="hover:bg-muted/20">
                <TableCell className="font-semibold text-center bg-muted/15 text-xs text-muted-foreground">
                  {hNum}º {turno === "manha" ? "Manhã" : turno === "tarde" ? "Tarde" : "Noite"}
                </TableCell>
                {DIAS.map((dia) => {
                  const isWeekend = (dia as string) === "sabado" || (dia as string) === "domingo";
                  const isAvail = (disponibilidade[dia] ?? []).map(Number).includes(actualHour);
                  return (
                    <TableCell 
                      key={dia} 
                      className={`p-2 text-center ${isWeekend ? "bg-amber-500/5 dark:bg-amber-950/5" : ""}`}
                    >
                      <Button
                        type="button"
                        variant={isAvail ? "default" : "outline"}
                        size="sm"
                        className={`w-full text-xs h-8 transition-all cursor-pointer ${
                          isAvail 
                            ? "bg-emerald-600 hover:bg-emerald-700 text-white border-2 border-emerald-400 dark:border-emerald-500 shadow-sm font-semibold" 
                            : "text-muted-foreground hover:bg-muted border-2 border-slate-300 dark:border-slate-700 hover:border-neutral-400 dark:hover:border-neutral-500 bg-background"
                        }`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          const nextMode = isAvail ? "remove" : "add";
                          setDragMode(nextMode);
                          setIsMouseDown(true);
                          toggleDisponibilidadeTo(dia, actualHour, nextMode === "add");
                        }}
                        onMouseEnter={() => {
                          if (isMouseDown && dragMode) {
                            toggleDisponibilidadeTo(dia, actualHour, dragMode === "add");
                          }
                        }}
                        onClick={() => {
                          // Standard click fallback
                          if (!dragMode) {
                            toggleDisponibilidade(dia, actualHour);
                          }
                        }}
                      >
                        {isAvail ? "Livre" : "Indisponível"}
                      </Button>
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    );
  }

  async function confirmLimpeza() {
    const emptyDispo: Record<string, number[]> = {};
    DIAS.forEach((d) => {
      emptyDispo[d] = [];
    });
    setDisponibilidade(emptyDispo);

    if (editingProf && activeProfId) {
      const updatedProf: Professor = {
        ...editingProf,
        disponibilidade: emptyDispo,
      };
      setProfessores((prev) =>
        prev.map((p) => (p.id === editingProf.id ? updatedProf : p))
      );
    }

    setClearConfirmOpen(false);
  }

  async function confirmMassRelease() {
    const fullDispo: Record<string, number[]> = {};
    const qManha = config.quantidadeHorariosPorDia ?? 6;
    const slots: number[] = [];
    for (let i = 1; i <= qManha; i++) {
      slots.push(i);
    }
    if (config.habilitarTarde) {
      const qTarde = config.quantidadeHorariosPorDiaTarde ?? 5;
      for (let i = 1; i <= qTarde; i++) {
        slots.push(i + 10);
      }
    }
    if (config.habilitarNoite) {
      const qNoite = config.quantidadeHorariosPorDiaNoite ?? 4;
      for (let i = 1; i <= qNoite; i++) {
        slots.push(i + 20);
      }
    }
    DIAS.forEach((d) => {
      fullDispo[d] = [...slots];
    });

    const updatedProfessores = (professores ?? []).map((prof) => ({
      ...prof,
      disponibilidade: { ...fullDispo },
    }));

    try {
      await professoresDbService.salvarLote(updatedProfessores);
      setProfessores(updatedProfessores);
      toast({
        title: "Disponibilidades liberadas! 📅",
        description: `Todas as disponibilidades para todos os ${updatedProfessores.length} professores foram salvas no Supabase.`,
      });
    } catch (err) {
      console.error("Erro ao salvar disponibilidades em lote:", err);
      setProfessores(updatedProfessores);
    }
    setMassReleaseOpen(false);
  }

  async function confirmMassOptimize() {
    let count5Total = 0;
    let count4Total = 0;

    const updatedProfessores = (professores ?? []).map((prof) => {
      const discIds = prof.disciplinas ?? [];
      const tIds = prof.turmas ?? [];

      let initializedPlan = [...(prof.planejamento || [])];

      // If planning list is empty, initialize it using the matrix matching selected disciplines and turmas
      if (initializedPlan.length === 0) {
        const newItems: PlanejamentoItem[] = [];
        discIds.forEach((dId) => {
          tIds.forEach((tId) => {
            const match = matriz.find((m) => m.disciplinaId === dId && m.turmaId === tId);
            if (match) {
              newItems.push({
                disciplinaId: dId,
                turmaId: tId,
                aulasPorSemana: match.aulasPorSemana,
                quantidadeAulas: match.aulasPorSemana,
              });
            }
          });
        });
        initializedPlan = newItems;
      }

      // Apply fine-grained parameter updates
      const optimized = initializedPlan.map((item) => {
        const tObj = turmas.find((t) => t.id === item.turmaId);
        const is101 = tObj && (tObj.nome.includes("101") || tObj.nome === "101" || tObj.id === "turma_4");
        const numAulas = Number(item.aulasPorSemana) || 0;

        if (numAulas === 5) {
          count5Total++;
          return {
            ...item,
            maximoAulasPorDia: 2,
            maximoConsecutivas: 2,
            exigeGeminacao: false,
            prioridade: "media" as const,
          };
        } else if (numAulas === 4 || is101) {
          count4Total++;
          return {
            ...item,
            maximoAulasPorDia: 2,
            maximoConsecutivas: 2,
            exigeGeminacao: false,
            prioridade: "media" as const,
          };
        }
        return item;
      });

      // 2. Disponibilidade por Turno (Matutino vs Vespertino)
      const updatedDispo: Record<string, number[]> = {};
      
      // Check which shifts are present in the optimized planning
      const hasManha = optimized.some((item) => {
        const tObj = turmas.find((t) => t.id === item.turmaId);
        return tObj && tObj.turno === "manha";
      });

      const hasTarde = optimized.some((item) => {
        const tObj = turmas.find((t) => t.id === item.turmaId);
        return tObj && tObj.turno === "tarde";
      });

      // Se não houver nada mapeado ainda, assume manhã/tarde conforme as turmas do prof
      let actualManha = hasManha;
      let actualTarde = hasTarde;
      if (!actualManha && !actualTarde) {
        actualManha = tIds.some((tId) => {
          const tObj = turmas.find((t) => t.id === tId);
          return tObj && tObj.turno === "manha";
        });
        actualTarde = tIds.some((tId) => {
          const tObj = turmas.find((t) => t.id === tId);
          return tObj && tObj.turno === "tarde";
        });
      }

      if (!actualManha && !actualTarde) {
        actualManha = true; // manha por padrão
      }

      DIAS.forEach((dia) => {
        const hours: number[] = [];
        // Matutino (Manhã)
        if (actualManha) {
          for (let h = 1; h <= (config.quantidadeHorariosPorDia ?? 6); h++) {
            hours.push(h);
          }
        }
        // Vespertino (Tarde)
        if (actualTarde) {
          const maxTarde = config.quantidadeHorariosPorDiaTarde ?? 5;
          for (let h = 1; h <= maxTarde; h++) {
            hours.push(h + 10);
          }
        }
        updatedDispo[dia] = hours;
      });

      return {
        ...prof,
        planejamento: optimized,
        disponibilidade: updatedDispo,
      };
    });

    try {
      await professoresDbService.salvarLote(updatedProfessores);
      setProfessores(updatedProfessores);
      toast({
        title: "Parâmetros Otimizados para Todos os Professores! ⚡",
        description: `Otimizado e salvo no Supabase para ${updatedProfessores.length} professores.`,
      });
    } catch (err) {
      console.error("Erro ao otimizar professores no banco:", err);
      setProfessores(updatedProfessores);
    }
    setMassOptimizeOpen(false);
  }

  async function onSubmit(data: ProfForm) {
    // Check for duplicate professor registration (by name or masp)
    const nomeNormalizado = data.nomeCompleto.trim().toLowerCase();
    const existeNome = (professores ?? []).some((p) => {
      if (editingProf && p.id === editingProf.id) return false;
      return p.nomeCompleto.trim().toLowerCase() === nomeNormalizado;
    });

    const maspNormalizado = data.masp?.trim();
    const existeMasp = maspNormalizado && (professores ?? []).some((p) => {
      if (editingProf && p.id === editingProf.id) return false;
      return p.masp?.trim() === maspNormalizado;
    });

    if (existeNome || existeMasp) {
      toast({
        title: "Cadastro Bloqueado",
        description: "Este professor já está cadastrado no sistema.",
        variant: "destructive",
      });
      return;
    }

    // Check for exact duplicate planning items (same Turma + same Disciplina)
    const seenCombos = new Set<string>();
    const hasDuplicates = (planejamentoItems || []).some((item) => {
      if (!item.disciplinaId || !item.turmaId) return false;
      const key = `${item.turmaId}|${item.disciplinaId}`;
      if (seenCombos.has(key)) return true;
      seenCombos.add(key);
      return false;
    });

    if (hasDuplicates) {
      toast({
        title: "Vínculo Duplicado",
        description: "Este professor já está vinculado a esta turma e disciplina.",
        variant: "destructive",
      });
      return;
    }

    const cleanData = {
      ...data,
      disciplinas: data.disciplinas ?? [],
      turmas: data.turmas ?? [],
      masp: data.masp || undefined,
      cargo: data.cargo || undefined,
      dataAdmissao: data.dataAdmissao || undefined,
      tipoVinculo: (data.tipoVinculo === "efetivo" || data.tipoVinculo === "designado")
        ? data.tipoVinculo
        : undefined,
    };

    const profId = activeProfId || generateId();

    const validPlanejamento = (planejamentoItems || []).filter(
      (item) => item.disciplinaId && item.turmaId && (Number(item.aulasPorSemana) > 0 || Number(item.quantidadeAulas) > 0)
    );

    // Auto-synchronize checked disciplines/turmas with planning items if they are missing
    const planningDisciplinas = Array.from(new Set(validPlanejamento.map(item => item.disciplinaId)));
    const planningTurmas = Array.from(new Set(validPlanejamento.map(item => item.turmaId)));

    cleanData.disciplinas = Array.from(new Set([...cleanData.disciplinas, ...planningDisciplinas]));
    cleanData.turmas = Array.from(new Set([...cleanData.turmas, ...planningTurmas]));

    const filteredPlanejamento = validPlanejamento.map((item) => {
      const rawVal = item.aulasPorSemana !== undefined ? item.aulasPorSemana : item.quantidadeAulas;
      const numVal = Number(rawVal) || 0;
      return {
        disciplinaId: item.disciplinaId,
        turmaId: item.turmaId,
        aulasPorSemana: numVal,
        quantidadeAulas: numVal,
        maximoAulasPorDia: item.maximoAulasPorDia !== undefined && item.maximoAulasPorDia !== null && item.maximoAulasPorDia > 0 ? Number(item.maximoAulasPorDia) : undefined,
        maximoConsecutivas: item.maximoConsecutivas !== undefined && item.maximoConsecutivas !== null && item.maximoConsecutivas > 0 ? Number(item.maximoConsecutivas) : undefined,
        exigeGeminacao: !!item.exigeGeminacao,
        prioridade: item.prioridade || undefined,
      };
    });

    const normalizedDispo: Record<string, number[]> = {};
    Object.entries(disponibilidade || {}).forEach(([dia, list]) => {
      normalizedDispo[dia] = (list ?? []).map(Number).sort((a, b) => a - b);
    });

    const newProf: Professor = { 
      id: profId, 
      ...cleanData, 
      disponibilidade: normalizedDispo,
      planejamento: filteredPlanejamento
    };

    // AUDIT LOG AS EXPLICITLY REQUESTED IN THE PDF PATHWAY
    console.log("=== CADASTRO PROFESSOR -> PERSISTÊNCIA (GRAVAÇÃO LOCALSTORAGE / CLOUD) ===");
    console.log("JSON do Professor Completo:", JSON.stringify(newProf, null, 2));
    console.log("Linhas de Planejamento de Aulas:");
    filteredPlanejamento.forEach((line, idx) => {
      console.log(`Linha ${idx + 1}:`, JSON.stringify({
        disciplinaId: line.disciplinaId,
        turmaId: line.turmaId,
        quantidadeAulas: line.quantidadeAulas
      }, null, 2));
    });
    console.log("=========================================================================");

    try {
      await professoresDbService.salvar(newProf);
    } catch (err) {
      console.error("Erro ao salvar professor no Supabase:", err);
    }

    if (editingProf) {
      setProfessores((prev) =>
        prev.map((p) => (p.id === editingProf.id ? newProf : p))
      );
    } else {
      setProfessores((prev) => [...prev, newProf]);
      setEditingProf(newProf);
    }

    const updatedProfessors = professores.map((p) => (p.id === profId ? newProf : p));
    if (!updatedProfessors.some(p => p.id === profId)) {
      updatedProfessors.push(newProf);
    }

    // Run the official allocation algorithm to securely schedule all classes
    const lockedAll = alocacoes.filter((a) => a.isLocked);
    const allocationResult = runAllocation(
      turmas,
      disciplinas,
      updatedProfessors,
      matriz,
      config,
      lockedAll
    );

    const novasAlocacoes = allocationResult.alocacoes;

    setAlocacoes(novasAlocacoes);
    setAlocacoesSnapshot(novasAlocacoes);

    // Show detailed feedback toast of exactly which classes were successfully recalculated
    const profAllocations = novasAlocacoes.filter((a) => a.professorId === profId);
    const allocSummaryMap = profAllocations.reduce((acc, a) => {
      const key = `${a.turmaId}-${a.disciplinaId}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const summaryParts = Object.entries(allocSummaryMap).map(([key, count]) => {
      const [tId, dId] = key.split("-");
      const tNome = turmas.find(x => String(x.id).trim() === String(tId).trim())?.nome || tId;
      const dNome = disciplinas.find(x => String(x.id).trim() === String(dId).trim())?.nome || dId;
      return `${dNome} na ${tNome} (${count}ª)`;
    });

    const isEdit = !!editingProf;
    const totalPlanClasses = filteredPlanejamento.reduce((sum, item) => sum + (Number(item.aulasPorSemana) || 0), 0);
    const totalAulasAtribuidas = profAllocations.length;

    if (totalPlanClasses > 0) {
      if (totalAulasAtribuidas === 0) {
        // Scenario B: Saving professor details succeeded, but automatic allocation failed completely
        toast({
          title: "Alterações salvas com falha de alocação",
          description: "Os dados e a disponibilidade do professor foram salvos no banco de dados. No entanto, NENHUMA aula do planejamento pôde ser alocada automaticamente devido a conflitos de horários ou falta de disponibilidade de turmas.",
          variant: "destructive",
        });
      } else if (totalAulasAtribuidas < totalPlanClasses) {
        // Scenario C: Saving succeeded, but only part of the classes could be automatically allocated
        toast({
          title: "Alterações salvas com alocação parcial",
          description: `Os dados e a disponibilidade do professor foram salvos no banco de dados. Porém, apenas ${totalAulasAtribuidas} das ${totalPlanClasses} aulas planejadas foram alocadas automaticamente (${summaryParts.join(", ")}). O restante possui conflitos de horários ou restrições de disponibilidade do professor.`,
          variant: "destructive",
        });
      } else {
        // Scenario A: Real Success! All planned classes successfully allocated
        toast({
          title: isEdit ? "Professor atualizado com sucesso!" : "Professor cadastrado com sucesso!",
          description: `Todas as ${totalPlanClasses} aulas planejadas foram recalculadas e alocadas com sucesso: ${summaryParts.join(", ")}.`,
        });
      }
    } else {
      // Scenario A (no planned classes): Real Success of saving the professor which has 0 classes
      toast({
        title: isEdit ? "Professor atualizado com sucesso!" : "Professor cadastrado com sucesso!",
        description: "Os dados do professor foram salvos com sucesso.",
      });
    }

    isSubmittedRef.current = true;
    setModalOpen(false); // Always close the modal to prevent saving ambiguity and reversion bugs
  }

  async function confirmDelete() {
    if (!deleteTarget) return;

    try {
      await professoresDbService.excluir(deleteTarget.id);
      setProfessores((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      setAlocacoes((prev) => prev.filter((a) => a.professorId !== deleteTarget.id));
      toast({ title: "Professor excluído com sucesso", variant: "destructive" });
    } catch (err) {
      console.error("Erro ao excluir professor do banco:", err);
      toast({ title: "Erro ao excluir professor", variant: "destructive" });
    }
    setDeleteTarget(null);
  }

  function addHorarioFixo() {
    if (!fixoDisc || !fixoTurma || !fixoDia || !fixoHorario || !activeProfId) return;
    const hNum = Number(fixoHorario);

    const targetTurma = turmas.find(t => t.id === fixoTurma);
    const targetTurno = targetTurma?.turno ?? "manha";

    const conflito = alocacoes.find((a) => {
      if (a.diaSemana !== fixoDia || a.horario !== hNum) return false;
      if (a.turmaId === fixoTurma) return true;
      if (a.professorId === activeProfId) {
        const aTurma = turmas.find(t => t.id === a.turmaId);
        const aTurno = aTurma?.turno ?? "manha";
        return aTurno === targetTurno;
      }
      return false;
    });

    if (conflito) {
      const profConflito = professores.find((p) => String(p.id).trim() === String(conflito.professorId).trim());
      const discConflito = disciplinas.find((d) => String(d.id).trim() === String(conflito.disciplinaId).trim());
      const turmaConflito = turmas.find((t) => String(t.id).trim() === String(conflito.turmaId).trim());

      toast({
        title: "Conflito detectado!",
        description: `Esse horário já está ocupado por ${profConflito?.nomeCompleto || "outro professor"} na disciplina de ${discConflito?.nome || "Matéria"} para a turma ${turmaConflito?.nome || "Turma"}.`,
        variant: "destructive"
      });
      return;
    }

    setAlocacoes((prev) => [
      ...prev,
      {
        id: generateId(),
        turmaId: fixoTurma,
        disciplinaId: fixoDisc,
        professorId: activeProfId,
        diaSemana: fixoDia,
        horario: hNum,
        isLocked: true,
      },
    ]);
    // Mantém as últimas opções selecionadas conforme solicitado pelo usuário
    toast({ title: "Horário fixado na grade!" });
  }

  function removeHorarioFixo(id: string) {
    setAlocacoes((prev) => prev.filter((a) => a.id !== id));
    toast({ title: "Horário removido" });
  }

  const filtered = (professores ?? []).filter((p) => p.nomeCompleto.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Professores</h1>
          <p className="text-muted-foreground mt-1">Gerencie o corpo docente e suas disponibilidades</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Button variant="outline" onClick={() => setMassOptimizeOpen(true)} className="border-sky-500 text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/30">
            <Sparkles className="w-4 h-4 mr-2" /> Otimizar Parâmetros de Todos
          </Button>
          <Button variant="outline" onClick={() => setMassReleaseOpen(true)} className="border-amber-500 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30">
            <CalendarDays className="w-4 h-4 mr-2" /> Liberar Todos os Dias
          </Button>
          <Button onClick={openCreate} data-testid="button-novo-professor">
            <Plus className="w-4 h-4 mr-2" /> Novo Professor
          </Button>
        </div>
      </div>

      <div className="flex items-center max-w-sm">
        <Input
          placeholder="Buscar professor por nome..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full"
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((prof) => {
          return (
            <Card key={prof.id} className="hover:shadow-md transition-shadow relative overflow-hidden group">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-lg font-bold leading-tight group-hover:text-primary transition-colors">
                      {prof.nomeCompleto}
                    </CardTitle>
                    {prof.masp && (
                      <p className="text-xs text-muted-foreground">MASP: {prof.masp}</p>
                    )}
                    {prof.cargo && (
                      <p className="text-xs text-muted-foreground">Cargo: {prof.cargo}</p>
                    )}
                    {prof.dataAdmissao && (
                      <p className="text-xs text-muted-foreground">Admissão: {prof.dataAdmissao}</p>
                    )}
                  </div>
                  <div className="flex gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground hover:text-foreground" onClick={() => openEdit(prof)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground hover:text-destructive" onClick={() => setDeleteTarget(prof)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="grid grid-cols-3 gap-2 text-xs border-y py-2 border-border/50 bg-muted/30 -mx-6 px-6">
                  <div>
                    <span className="text-muted-foreground block text-[10px] truncate">Vínculo</span>
                    <span className="font-semibold text-foreground capitalize truncate block">{prof.tipoVinculo || "Não informado"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[10px] truncate">Carga Máx.</span>
                    <span className="font-semibold text-foreground block">{prof.cargaHorariaMaximaSemanal}h</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[10px] truncate">Alocadas</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400 block">
                      {alocacoes.filter((a) => a.professorId === prof.id).length} aulas
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                    <GraduationCap className="w-3.5 h-3.5" /> Disciplinas ({prof.disciplinas?.length || 0})
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {prof.disciplinas?.map((dId) => {
                      const d = disciplinas.find((x) => x.id === dId);
                      return <Badge key={dId} variant="secondary" className="text-[11px] font-normal">{d?.nome || dId}</Badge>;
                    })}
                    {(!prof.disciplinas || prof.disciplinas.length === 0) && <span className="text-xs text-muted-foreground italic">Nenhuma</span>}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                    <CalendarDays className="w-3.5 h-3.5" /> Turmas Atendidas ({prof.turmas?.length || 0})
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {prof.turmas?.map((tId) => {
                      const t = turmas.find((x) => x.id === tId);
                      return <Badge key={tId} variant="outline" className="text-[11px] font-normal bg-background">{t?.nome || tId}</Badge>;
                    })}
                    {(!prof.turmas || prof.turmas.length === 0) && <span className="text-xs text-muted-foreground italic">Nenhuma</span>}
                  </div>
                </div>

                {prof.planejamento && Array.isArray(prof.planejamento) && prof.planejamento.length > 0 && (
                  <div className="space-y-1.5 pb-1">
                    <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                      <GraduationCap className="w-3.5 h-3.5 text-primary" /> Planejamento de Aulas
                    </span>
                    <div className="flex flex-col gap-1 bg-muted/40 rounded-md p-2 border border-muted-foreground/5 max-h-40 overflow-y-auto">
                      {prof.planejamento
                        .filter((item) => item.disciplinaId && item.turmaId && item.aulasPorSemana > 0)
                        .map((item, idx) => {
                          const d = disciplinas.find((x) => x.id === item.disciplinaId);
                          const t = turmas.find((x) => x.id === item.turmaId);
                          return (
                            <div key={idx} className="flex justify-between items-center text-xs text-foreground">
                              <span className="truncate max-w-[170px]">
                                {d?.nome || item.disciplinaId} <span className="text-[10px] text-muted-foreground">({t?.nome || item.turmaId})</span>
                              </span>
                              <span className="font-semibold bg-background border px-1.5 py-0.5 rounded text-[11px] text-primary whitespace-nowrap flex flex-wrap items-center gap-1">
                                <span>{item.aulasPorSemana} {item.aulasPorSemana === 1 ? "aula" : "aulas"}</span>
                                {item.maximoAulasPorDia !== undefined && item.maximoAulasPorDia > 0 && (
                                  <span className="text-[9px] text-muted-foreground font-normal bg-muted px-1 rounded-sm">
                                    máx {item.maximoAulasPorDia}/dia
                                  </span>
                                )}
                                {item.maximoConsecutivas !== undefined && item.maximoConsecutivas > 0 && (
                                  <span className="text-[9px] text-muted-foreground font-normal bg-muted px-1 rounded-sm">
                                    c. máx {item.maximoConsecutivas}
                                  </span>
                                )}
                                {item.exigeGeminacao && (
                                  <span className="text-[9px] text-green-600 bg-green-500/10 font-semibold px-1 rounded-sm">
                                    geminadas
                                  </span>
                                )}
                                {item.prioridade && item.prioridade !== "media" && (
                                  <span className={`text-[9px] font-semibold px-1 rounded-sm ${
                                    item.prioridade === "alta" ? "text-amber-600 bg-amber-500/10" : "text-gray-500 bg-gray-500/10"
                                  }`}>
                                    prio: {item.prioridade}
                                  </span>
                                )}
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}

                <div className="pt-1">
                  <span className="text-xs font-semibold text-muted-foreground block mb-1.5">Disponibilidade Semanal:</span>
                  <div className="grid grid-cols-5 gap-1 text-center">
                    {DIAS.map((dia) => {
                      const count = prof.disponibilidade?.[dia]?.length || 0;
                      return (
                        <Tooltip key={dia}>
                          <TooltipTrigger asChild>
                            <div className={`p-1 rounded text-xs transition-colors ${count === totalActivePeriods ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium" : count > 0 ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-muted text-muted-foreground opacity-40"}`}>
                              {DIA_LABELS[dia]}
                              <span className="block text-[10px] opacity-70">{count}/{totalActivePeriods}</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent><p className="capitalize">{dia}: {count} de {totalActivePeriods} livres</p></TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {filtered.length === 0 && (
          <div className="col-span-full rounded-lg border border-dashed py-12 text-center text-muted-foreground">
            Nenhum professor encontrado.
          </div>
        )}
      </div>

      {/* Modal Criar / Editar */}
      <Dialog open={modalOpen} onOpenChange={handleCloseModal}>
        <DialogContent className="!left-0 !top-0 !translate-x-0 !translate-y-0 w-screen h-screen max-w-none max-h-none rounded-none border-none p-0 flex flex-col bg-background">
          {/* Header Fixo */}
          <div className="border-b bg-background/95 backdrop-blur-md sticky top-0 z-10 py-4 px-6 shrink-0">
            <div className="max-w-5xl mx-auto flex items-center justify-between">
              <DialogTitle className="text-xl font-bold flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                {editingProf ? `Editar Professor: ${editingProf.nomeCompleto}` : "Cadastrar Novo Professor"}
              </DialogTitle>
              <Button variant="ghost" size="sm" onClick={() => handleCloseModal(false)} className="h-8 text-muted-foreground hover:text-foreground">
                ✕ Fechar
              </Button>
            </div>
          </div>

          {/* Área de Conteúdo Rolável */}
          <div className="flex-1 overflow-y-auto min-h-0 bg-slate-50/40 dark:bg-slate-900/10">
            <div className="max-w-5xl mx-auto w-full px-6 py-6">
              <Form {...form}>
                <form onSubmit={(e) => e.preventDefault()} className="space-y-6">
                  
                  <Tabs value={formTab} onValueChange={setFormTab} className="w-full bg-white dark:bg-slate-950 border rounded-xl shadow-sm overflow-hidden">
                    <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 bg-slate-50 dark:bg-slate-900/60 p-1 border-b rounded-none h-auto gap-1">
                      <TabsTrigger value="dados-gerais" className="py-3 text-xs font-bold uppercase tracking-wider data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-xs transition-all">
                        Dados Gerais
                      </TabsTrigger>
                      <TabsTrigger value="turmas-disciplinas" className="py-3 text-xs font-bold uppercase tracking-wider data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-xs transition-all">
                        Turmas e Disciplinas
                      </TabsTrigger>
                      <TabsTrigger value="disponibilidade" className="py-3 text-xs font-bold uppercase tracking-wider data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-xs transition-all">
                        Disponibilidade
                      </TabsTrigger>
                      <TabsTrigger value="aulas-fixas" className="py-3 text-xs font-bold uppercase tracking-wider data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-xs transition-all">
                        Aulas Fixas
                      </TabsTrigger>
                    </TabsList>

                    {/* 1. DADOS GERAIS */}
                    <TabsContent value="dados-gerais" className="p-6 space-y-6 mt-0">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <FormField control={form.control} name="nomeCompleto" render={({ field }) => (
                          <FormItem className="md:col-span-2">
                            <FormLabel className="font-semibold text-slate-800 dark:text-slate-200">Nome Completo *</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="Ex: Lucas Silva"
                                {...field}
                                onBlur={(e) => {
                                  field.onBlur();
                                  const val = e.target.value?.trim();
                                  if (!val) {
                                    form.trigger("nomeCompleto");
                                  } else if (form.formState.errors.nomeCompleto) {
                                    form.trigger("nomeCompleto");
                                  }
                                }}
                                data-testid="input-nome-professor"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />

                        <FormField control={form.control} name="masp" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="font-semibold text-slate-800 dark:text-slate-200">MASP</FormLabel>
                            <FormControl><Input placeholder="Ex: 1234567-8" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />

                        <FormField control={form.control} name="dataAdmissao" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="font-semibold text-slate-800 dark:text-slate-200">Admissão</FormLabel>
                            <FormControl><Input placeholder="Ex: 01, 02, 03" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />

                        <FormField control={form.control} name="tipoVinculo" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="font-semibold text-slate-800 dark:text-slate-200">Tipo de Vínculo</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Selecione..." />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="efetivo">Efetivo</SelectItem>
                                <SelectItem value="designado">Designado</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )} />

                        <FormField control={form.control} name="cargo" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="font-semibold text-slate-800 dark:text-slate-200">Cargo</FormLabel>
                            <FormControl><Input placeholder="Ex: PEB" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />

                        <FormField control={form.control} name="cargaHorariaMaximaSemanal" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="font-semibold text-slate-800 dark:text-slate-200">Carga Horária Máx Semanal (aulas) *</FormLabel>
                            <FormControl><Input type="number" min={1} max={60} {...field} data-testid="input-carga-horaria" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                    </TabsContent>

                    {/* 2. TURMAS E DISCIPLINAS */}
                    <TabsContent value="turmas-disciplinas" className="p-6 space-y-6 mt-0">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-4">
                        <FormField control={form.control} name="disciplinas" render={() => (
                          <FormItem className="space-y-2">
                            <FormLabel className="text-sm font-semibold text-slate-800 dark:text-slate-200">Disciplinas Habilitadas</FormLabel>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto border p-3 rounded-md bg-muted/10">
                              {disciplinas.map((d) => (
                                <FormField key={d.id} control={form.control} name="disciplinas" render={({ field }) => (
                                  <FormItem className="flex flex-row items-start space-x-2 space-y-0">
                                    <FormControl>
                                      <Checkbox
                                        checked={(field.value ?? []).includes(d.id)}
                                        onCheckedChange={(checked) => {
                                          return checked
                                            ? field.onChange([...(field.value ?? []), d.id])
                                            : field.onChange((field.value ?? []).filter((value) => value !== d.id));
                                        }}
                                      />
                                    </FormControl>
                                    <FormLabel className="text-sm font-normal cursor-pointer select-none">{d.nome}</FormLabel>
                                  </FormItem>
                                )} />
                              ))}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )} />

                        <FormField control={form.control} name="turmas" render={() => (
                          <FormItem className="space-y-2">
                            <FormLabel className="text-sm font-semibold text-slate-800 dark:text-slate-200">Turmas Vinculadas</FormLabel>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto border p-3 rounded-md bg-muted/10">
                              {turmas.map((t) => (
                                <FormField key={t.id} control={form.control} name="turmas" render={({ field }) => (
                                  <FormItem className="flex flex-row items-start space-x-2 space-y-0">
                                    <FormControl>
                                      <Checkbox
                                        checked={(field.value ?? []).includes(t.id)}
                                        onCheckedChange={(checked) => {
                                          return checked
                                            ? field.onChange([...(field.value ?? []), t.id])
                                            : field.onChange((field.value ?? []).filter((value) => value !== t.id));
                                        }}
                                      />
                                    </FormControl>
                                    <FormLabel className="text-sm font-normal cursor-pointer select-none">{t.nome} ({t.turno})</FormLabel>
                                  </FormItem>
                                )} />
                              ))}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>

                      {/* DISTRIBUIÇÃO DE AULAS POR TURMA */}
                      <div className="border-t pt-6 space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-bold text-foreground flex items-center gap-1.5 uppercase tracking-wider">
                              <GraduationCap className="w-5 h-5 text-primary" />
                              Distribuição de Aulas por Turma
                            </h3>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Atribua as turmas e disciplinas para este professor e a quantidade de aulas correspondente.
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1 border-dashed"
                            onClick={() => {
                              setPlanejamentoItems((prev) => [
                                ...prev,
                                { disciplinaId: "", turmaId: "", aulasPorSemana: 1 }
                              ]);
                            }}
                          >
                            <Plus className="w-4 h-4" />
                            Nova atribuição
                          </Button>
                        </div>

                        {/* PAINEL DE VALIDAÇÃO */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-muted/30 p-4 border rounded-lg">
                          <div className="space-y-0.5 bg-background p-3 rounded-md border text-center sm:text-left">
                            <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block">Carga horária disponível</span>
                            <span className="text-base font-extrabold text-foreground">{form.watch("cargaHorariaMaximaSemanal") || 0} aulas</span>
                          </div>
                          <div className="space-y-0.5 bg-background p-3 rounded-md border text-center sm:text-left">
                            <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block">Carga horária atribuída</span>
                            <span className="text-base font-extrabold text-primary">
                              {planejamentoItems.reduce((sum, item) => sum + (Number(item.aulasPorSemana) || 0), 0)} aulas
                            </span>
                          </div>
                          {(() => {
                            const maxSemanal = Number(form.watch("cargaHorariaMaximaSemanal")) || 0;
                            const totalAtribuido = planejamentoItems.reduce((sum, item) => sum + (Number(item.aulasPorSemana) || 0), 0);
                            const saldoVal = maxSemanal - totalAtribuido;
                            
                            let bgClass = "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20";
                            if (saldoVal === 0) bgClass = "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20";
                            if (saldoVal < 0) bgClass = "bg-destructive/10 text-destructive border-destructive/20";

                            return (
                              <div className={`space-y-0.5 p-3 rounded-md border text-center sm:text-left ${bgClass}`}>
                                <span className="text-[10px] uppercase font-bold tracking-wider block opacity-85">Saldo disponível</span>
                                <span className="text-base font-extrabold">{saldoVal} aulas</span>
                              </div>
                            );
                          })()}
                        </div>

                        {/* TABELA DE ATRIBUIÇÕES */}
                        {selectedDiscs.length === 0 || selectedTurmas.length === 0 ? (
                          <div className="text-xs text-muted-foreground italic p-4 text-center border-dashed border-2 rounded-lg bg-muted/10 font-medium">
                            Selecione disciplinas e turmas habilitadas acima para habilitar o planejamento.
                          </div>
                        ) : planejamentoItems.length === 0 ? (
                          <div className="text-xs text-muted-foreground italic p-6 text-center border-dashed border-2 rounded-lg bg-muted/10 font-medium space-y-2">
                            <div>Nenhuma distribuição cadastrada.</div>
                            <Button
                              type="button"
                              variant="link"
                              size="sm"
                              className="text-primary font-semibold"
                              onClick={() => {
                                setPlanejamentoItems([{ disciplinaId: "", turmaId: "", aulasPorSemana: 1 }]);
                              }}
                            >
                              Clique para adicionar a primeira atribuição
                            </Button>
                          </div>
                        ) : (
                          <div className="border rounded-md bg-background overflow-hidden">
                            <Table>
                              <TableHeader className="bg-muted/50">
                                <TableRow>
                                  <TableHead className="font-semibold text-xs py-2.5">Turma</TableHead>
                                  <TableHead className="font-semibold text-xs py-2.5">Disciplina</TableHead>
                                  <TableHead className="font-semibold text-xs py-2.5">Turno</TableHead>
                                  <TableHead className="font-semibold text-xs py-2.5 w-[100px]">Aulas/Semana</TableHead>
                                  <TableHead className="font-semibold text-xs py-2.5 w-[105px]">Máx./Dia</TableHead>
                                  <TableHead className="font-semibold text-xs py-2.5 w-[105px]">Máx. Consec.</TableHead>
                                  <TableHead className="font-semibold text-xs py-2.5 w-[80px] text-center">Geminação</TableHead>
                                  <TableHead className="font-semibold text-xs py-2.5 w-[100px]">Prioridade</TableHead>
                                  <TableHead className="py-2.5 w-[50px]"></TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {planejamentoItems.map((item, idx) => {
                                  return (
                                    <TableRow key={idx} className="hover:bg-muted/10">
                                      <TableCell className="py-2">
                                        <Select
                                          value={item.turmaId}
                                          onValueChange={(val) => {
                                            const otherItems = (planejamentoItems || []).filter((_, i) => i !== idx);
                                            const isDup = otherItems.some(it => it.disciplinaId === item.disciplinaId && it.turmaId === val && item.disciplinaId && val);
                                            if (isDup) {
                                              const tName = turmas.find(t => t.id === val)?.nome || val;
                                              const dName = disciplinas.find(d => d.id === item.disciplinaId)?.nome || item.disciplinaId;
                                              toast({
                                                title: "⚠ Alocação já cadastrada.",
                                                description: `Este professor já está vinculado à disciplina ${dName} na turma ${tName}. Escolha outra disciplina ou outra turma.`,
                                                variant: "destructive"
                                              });
                                              return;
                                            }
                                            setPlanejamentoItems((prev) => {
                                              const updated = [...prev];
                                              updated[idx] = { ...updated[idx], turmaId: val };
                                              return updated;
                                            });
                                          }}
                                        >
                                          <SelectTrigger className="h-8 max-w-[140px]">
                                            <SelectValue placeholder="Selecione..." />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {selectedTurmas.map((tId) => {
                                              const t = turmas.find((x) => x.id === tId);
                                              return (
                                                <SelectItem key={tId} value={tId}>
                                                  {t ? `${t.nome} (${t.turno})` : tId}
                                                </SelectItem>
                                              );
                                            })}
                                          </SelectContent>
                                        </Select>
                                      </TableCell>
                                      <TableCell className="py-2">
                                        <Select
                                          value={item.disciplinaId}
                                          onValueChange={(val) => {
                                            const otherItems = (planejamentoItems || []).filter((_, i) => i !== idx);
                                            const isDup = otherItems.some(it => it.disciplinaId === val && it.turmaId === item.turmaId && val && item.turmaId);
                                            if (isDup) {
                                              const tName = turmas.find(t => t.id === item.turmaId)?.nome || item.turmaId;
                                              const dName = disciplinas.find(d => d.id === val)?.nome || val;
                                              toast({
                                                title: "⚠ Alocação já cadastrada.",
                                                description: `Este professor já está vinculado à disciplina ${dName} na turma ${tName}. Escolha outra disciplina ou outra turma.`,
                                                variant: "destructive"
                                              });
                                              return;
                                            }
                                            setPlanejamentoItems((prev) => {
                                              const updated = [...prev];
                                              updated[idx] = { ...updated[idx], disciplinaId: val };
                                              return updated;
                                            });
                                          }}
                                        >
                                          <SelectTrigger className="h-8 max-w-[140px]">
                                            <SelectValue placeholder="Selecione..." />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {selectedDiscs.map((dId) => {
                                              const disc = disciplinas.find((d) => d.id === dId);
                                              return (
                                                <SelectItem key={dId} value={dId}>
                                                  {disc ? disc.nome : dId}
                                                </SelectItem>
                                              );
                                            })}
                                          </SelectContent>
                                        </Select>
                                      </TableCell>
                                      <TableCell className="py-2">
                                        {(() => {
                                          const tObj = turmas.find((t) => t.id === item.turmaId);
                                          if (!tObj) return <span className="text-muted-foreground text-[10px] italic">Selecione turma...</span>;
                                          const turnLabel = tObj.turno === "manha" ? "Matutino" : tObj.turno === "tarde" ? "Vespertino" : "Noturno";
                                          const colorClass = tObj.turno === "manha" ? "bg-blue-500/10 text-blue-600 border border-blue-500/20"
                                                           : tObj.turno === "tarde" ? "bg-amber-500/10 text-amber-600 border border-amber-500/20"
                                                           : "bg-purple-500/10 text-purple-600 border border-purple-500/20";
                                          return (
                                            <div className={`px-2 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider inline-block ${colorClass}`}>
                                              {turnLabel}
                                            </div>
                                          );
                                        })()}
                                      </TableCell>
                                      <TableCell className="py-1">
                                        <Input
                                          type="number"
                                          min={1}
                                          max={60}
                                          className="h-8 w-20 text-center font-medium"
                                          value={item.aulasPorSemana || ""}
                                          placeholder="0"
                                          onChange={(e) => {
                                            const val = Math.max(0, parseInt(e.target.value) || 0);
                                            setPlanejamentoItems((prev) => {
                                              const updated = [...prev];
                                              updated[idx] = { ...updated[idx], aulasPorSemana: val };
                                              return updated;
                                            });
                                          }}
                                        />
                                      </TableCell>
                                      <TableCell className="py-1">
                                        <Input
                                          type="number"
                                          min={1}
                                          max={10}
                                          className="h-8 w-16 text-center font-medium"
                                          value={item.maximoAulasPorDia !== undefined ? item.maximoAulasPorDia : ""}
                                          placeholder="Lim"
                                          onChange={(e) => {
                                            const rawVal = e.target.value;
                                            const val = rawVal === "" ? undefined : Math.max(1, parseInt(rawVal) || 1);
                                            setPlanejamentoItems((prev) => {
                                              const updated = [...prev];
                                              updated[idx] = { ...updated[idx], maximoAulasPorDia: val };
                                              return updated;
                                            });
                                          }}
                                        />
                                      </TableCell>
                                      <TableCell className="py-1">
                                        <Input
                                          type="number"
                                          min={1}
                                          max={10}
                                          className="h-8 w-16 text-center font-medium"
                                          value={item.maximoConsecutivas !== undefined ? item.maximoConsecutivas : ""}
                                          placeholder="2"
                                          onChange={(e) => {
                                            const rawVal = e.target.value;
                                            const val = rawVal === "" ? undefined : Math.max(1, parseInt(rawVal) || 1);
                                            setPlanejamentoItems((prev) => {
                                              const updated = [...prev];
                                              updated[idx] = { ...updated[idx], maximoConsecutivas: val };
                                              return updated;
                                            });
                                          }}
                                        />
                                      </TableCell>
                                      <TableCell className="py-1 text-center">
                                        <input
                                          type="checkbox"
                                          checked={item.exigeGeminacao ?? false}
                                          onChange={(e) => {
                                            setPlanejamentoItems((prev) => {
                                              const updated = [...prev];
                                              updated[idx] = { ...updated[idx], exigeGeminacao: e.target.checked };
                                              return updated;
                                            });
                                          }}
                                          className="w-4 h-4 accent-primary rounded border-gray-300 focus:ring-primary inline-block cursor-pointer align-middle"
                                        />
                                      </TableCell>
                                      <TableCell className="py-1">
                                        <Select
                                          value={item.prioridade || "media"}
                                          onValueChange={(val: any) => {
                                            setPlanejamentoItems((prev) => {
                                              const updated = [...prev];
                                              updated[idx] = { ...updated[idx], prioridade: val };
                                              return updated;
                                            });
                                          }}
                                        >
                                          <SelectTrigger className="h-8 max-w-[85px] text-xs">
                                            <SelectValue placeholder="Média" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="alta">Alta</SelectItem>
                                            <SelectItem value="media">Média</SelectItem>
                                            <SelectItem value="baixa">Baixa</SelectItem>
                                          </SelectContent>
                                        </Select>
                                      </TableCell>
                                      <TableCell className="py-1 text-right">
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon"
                                          className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                          onClick={() => {
                                            setPlanejamentoItems((prev) => prev.filter((_, i) => i !== idx));
                                          }}
                                        >
                                          <Trash2 className="w-4 h-4" />
                                        </Button>
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </div>
                    </TabsContent>

                    {/* 3. DISPONIBILIDADE */}
                    <TabsContent value="disponibilidade" className="p-6 space-y-6 mt-0" onMouseLeave={() => { setIsMouseDown(false); setDragMode(null); }}>
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-bold text-foreground flex items-center gap-1.5 uppercase tracking-wider">
                            Disponibilidade de Horários
                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25 ml-2 font-semibold font-mono">
                              {totalAvailableSlots} livres
                            </Badge>
                          </h3>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Arraste ou clique para definir os horários disponíveis para alocação.
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 border-emerald-500/20 hover:border-emerald-500 h-8 gap-1"
                            onClick={fillAllDisponibilidade}
                          >
                            <Check className="w-3.5 h-3.5" />
                            Marcar Todos como Livres
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:bg-destructive/10 border-destructive/20 hover:border-destructive/40 h-8 gap-1"
                            onClick={() => setClearConfirmOpen(true)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Limpar Todos os Horários
                          </Button>
                        </div>
                      </div>

                      <div className="border rounded-md overflow-hidden bg-background">
                        <Tabs defaultValue="manha" className="w-full">
                          <TabsList className="grid w-full grid-cols-1 md:grid-cols-3 bg-muted/60 p-1 border-b rounded-none h-auto">
                            <TabsTrigger value="manha" className="py-2 text-xs font-semibold gap-1.5">
                              🌅 Matutino (Manhã)
                            </TabsTrigger>
                            {config.habilitarTarde && (
                              <TabsTrigger value="tarde" className="py-2 text-xs font-semibold gap-1.5">
                                ☀️ Vespertino (Tarde)
                              </TabsTrigger>
                            )}
                            {config.habilitarNoite && (
                              <TabsTrigger value="noite" className="py-2 text-xs font-semibold gap-1.5">
                                🌙 Noturno (Noite)
                              </TabsTrigger>
                            )}
                          </TabsList>

                          <TabsContent value="manha" className="mt-0">
                            {renderAvailabilityTable("manha", config.quantidadeHorariosPorDia ?? 6, 0)}
                          </TabsContent>
                          
                          {config.habilitarTarde && (
                            <TabsContent value="tarde" className="mt-0">
                              {renderAvailabilityTable("tarde", config.quantidadeHorariosPorDiaTarde ?? 5, 10)}
                            </TabsContent>
                          )}
                          
                          {config.habilitarNoite && (
                            <TabsContent value="noite" className="mt-0">
                              {renderAvailabilityTable("noite", config.quantidadeHorariosPorDiaNoite ?? 4, 20)}
                            </TabsContent>
                          )}
                        </Tabs>
                      </div>

                      {is100PercentUnavailable && (
                        <div className="flex items-center gap-2 p-3 text-sm text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md">
                          <AlertTriangle className="w-4 h-4 shrink-0" />
                          <span>Este professor não possui nenhum horário disponível para alocação de aulas.</span>
                        </div>
                      )}
                    </TabsContent>

                    {/* 4. AULAS FIXAS */}
                    <TabsContent value="aulas-fixas" className="p-6 space-y-6 mt-0">
                      <div>
                        <h3 className="text-sm font-bold text-foreground flex items-center gap-1.5 uppercase tracking-wider">
                          <Lock className="w-4 h-4 text-amber-500" /> Aulas Fixadas
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Configure aulas que devem ocorrer sempre em horários específicos.
                        </p>
                      </div>

                      {activeProfId && (
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end bg-muted/30 p-3 rounded-md border">
                            <div className="space-y-1">
                              <label className="text-xs font-semibold">Disciplina</label>
                              <Select value={fixoDisc} onValueChange={setFixoDisc}>
                                <SelectTrigger className="bg-background h-9"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                                <SelectContent>
                                  {selectedDiscs.map((id) => (
                                    <SelectItem key={id} value={id}>{disciplinas.find((d) => d.id === id)?.nome || id}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="space-y-1">
                              <label className="text-xs font-semibold">Turma</label>
                              <Select value={fixoTurma} onValueChange={setFixoTurma}>
                                <SelectTrigger className="bg-background h-9"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                                <SelectContent>
                                  {selectedTurmas.map((id) => (
                                    <SelectItem key={id} value={id}>{turmas.find((t) => t.id === id)?.nome || id}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="space-y-1">
                              <label className="text-xs font-semibold">Dia</label>
                              <Select value={fixoDia} onValueChange={setFixoDia}>
                                <SelectTrigger className="bg-background h-9"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                                <SelectContent>
                                  {DIAS.map((d) => (<SelectItem key={d} value={d} className="capitalize">{DIA_LABELS_FULL[d]}</SelectItem>))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="space-y-1">
                              <label className="text-xs font-semibold">Horário</label>
                              <Select value={fixoHorario} onValueChange={setFixoHorario}>
                                <SelectTrigger className="bg-background h-9"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                                <SelectContent>
                                  {(() => {
                                    const selectedFixoTurmaObj = turmas.find((t) => t.id === fixoTurma);
                                    const fixoTurmaTurno = selectedFixoTurmaObj?.turno ?? "manha";
                                    const fixoTurmaMaxHorarios = fixoTurmaTurno === "noite"
                                      ? (config.quantidadeHorariosPorDiaNoite ?? 4)
                                      : fixoTurmaTurno === "tarde"
                                        ? (config.quantidadeHorariosPorDiaTarde ?? 5)
                                        : (config.quantidadeHorariosPorDia ?? 6);
                                    const fixoTurmaTurnoLabel = fixoTurmaTurno === "manha" ? "Manhã" : fixoTurmaTurno === "tarde" ? "Tarde" : "Noite";
                                    
                                    return Array.from({ length: fixoTurmaMaxHorarios }).map((_, i) => (
                                      <SelectItem key={i + 1} value={String(i + 1)}>
                                        {i + 1}º Horário ({fixoTurmaTurnoLabel})
                                      </SelectItem>
                                    ));
                                  })()}
                                </SelectContent>
                              </Select>
                            </div>

                            <Button type="button" onClick={addHorarioFixo} className="w-full h-9">Fixar Horário</Button>
                          </div>

                          {/* Lista de Aulas Fixadas Atuais */}
                          <div className="border rounded-md max-h-44 overflow-y-auto bg-background">
                            <Table>
                              <TableHeader className="bg-muted/40">
                                <TableRow>
                                  <TableHead>Turma</TableHead>
                                  <TableHead>Disciplina</TableHead>
                                  <TableHead>Dia</TableHead>
                                  <TableHead>Horário</TableHead>
                                  <TableHead className="w-[80px] text-center">Ações</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {alocacoes.filter((a) => a.professorId === activeProfId).map((aloc) => {
                                  const t = turmas.find((x) => x.id === aloc.turmaId);
                                  const d = disciplinas.find((x) => x.id === aloc.disciplinaId);
                                  return (
                                    <TableRow key={aloc.id}>
                                      <TableCell className="font-medium">{t?.nome || aloc.turmaId}</TableCell>
                                      <TableCell>{d?.nome || aloc.disciplinaId}</TableCell>
                                      <TableCell className="capitalize">{DIA_LABELS_FULL[aloc.diaSemana] || aloc.diaSemana}</TableCell>
                                      <TableCell>{aloc.horario}º Horário {t?.turno ? `(${t.turno === "manha" ? "Manhã" : t.turno === "tarde" ? "Tarde" : "Noite"})` : ""}</TableCell>
                                      <TableCell className="text-center">
                                        <Button type="button" variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-destructive" onClick={() => removeHorarioFixo(aloc.id)}>
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </Button>
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                                {alocacoes.filter((a) => a.professorId === activeProfId).length === 0 && (
                                  <TableRow>
                                    <TableCell colSpan={5} className="text-center py-4 text-xs text-muted-foreground italic">Nenhuma aula fixada na grade para este professor ainda.</TableCell>
                                  </TableRow>
                                )}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>

                </form>
              </Form>
            </div>
          </div>

          {/* Rodapé Fixo */}
          <div className="border-t bg-background/95 backdrop-blur-md sticky bottom-0 z-10 py-4 px-6 shrink-0">
            <div className="max-w-5xl mx-auto flex items-center justify-between">
              <Button type="button" variant="outline" onClick={() => handleCloseModal(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                data-testid="button-submit-professor"
                className="px-6 font-semibold"
                onClick={() =>
                  form.handleSubmit(onSubmit, (errors) => {
                    const msgs = Object.values(errors).map((e) => e?.message).filter(Boolean);
                    toast({
                      title: "Campos obrigatórios em falta",
                      description: msgs[0] as string || "Preencha todos os campos obrigatórios.",
                      variant: "destructive",
                    });
                  })()
                }
              >
                {editingProf ? "Salvar Professor" : "Cadastrar Professor"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Professor</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir <strong>{deleteTarget?.nomeCompleto}</strong>? Todas as suas alocações de aula serão removidas da grade.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmar Limpeza */}
      <AlertDialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive flex items-center gap-1.5 font-bold">
              ATENÇÃO!
            </AlertDialogTitle>
            <AlertDialogDescription asChild className="space-y-3 text-foreground">
              <div className="space-y-3 text-foreground">
                <p>Esta ação marcará TODOS os horários do professor como indisponíveis.</p>
                <p>Isso poderá impedir a geração automática da grade e remover restrições já configuradas.</p>
                <p className="font-semibold">Deseja realmente continuar?</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmLimpeza} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Confirmar Limpeza
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmar Liberação em Massa */}
      <AlertDialog open={massReleaseOpen} onOpenChange={setMassReleaseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-amber-600 dark:text-amber-400 flex items-center gap-1.5 font-bold">
              <CalendarDays className="w-5 h-5 mr-1 text-amber-500" /> Liberar Todos os Dias e Horários?
            </AlertDialogTitle>
            <AlertDialogDescription asChild className="space-y-3 text-foreground">
              <div className="space-y-3 text-foreground">
                <p>Esta ação alterará a disponibilidade de <strong>TODOS os professores ({professores.length})</strong> para <strong>100% livre</strong>.</p>
                <p>Todos os dias úteis (Segunda a Sexta) e todos os turnos ativados (Manhã, Tarde e Noite) serão disponibilizados de uma só vez para alocação.</p>
                <p className="font-semibold text-amber-600 dark:text-amber-500">As configurações de horários anteriores de cada docente serão substituídas. Deseja prosseguir?</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmMassRelease} className="bg-amber-600 hover:bg-amber-700 text-white dark:bg-amber-500 dark:hover:bg-amber-600">
              Confirmar Liberação
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmar Otimização em Massa */}
      <AlertDialog open={massOptimizeOpen} onOpenChange={setMassOptimizeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sky-600 dark:text-sky-400 flex items-center gap-1.5 font-bold">
              <Sparkles className="w-5 h-5 mr-1 text-sky-500" /> Otimizar Parâmetros de Todos os Professores?
            </AlertDialogTitle>
            <AlertDialogDescription asChild className="space-y-3 text-foreground font-medium">
              <div className="space-y-3 text-foreground font-medium">
                <p>Esta ação executará o assistente de ajuste de restrições pedagógicas para <strong>TODOS os professores ({professores.length})</strong>.</p>
                <p>O algoritmo irá automaticamente:</p>
                <ul className="list-disc pl-5 space-y-1 text-xs text-muted-foreground font-normal">
                  <li>Configurar limites diários e de consecutivas de acordo com a carga horária de cada professor (ex. máx. 2 aulas seguidas/dia para cargas de 4 ou 5 horizontes).</li>
                  <li>Habilitar e calibrar restrições especiais para turmas críticas como a 101.</li>
                  <li>Bloquear automaticamente turnos livres não utilizados (evitando que ocorram janelas ou buracos vazios na grade).</li>
                </ul>
                <p className="font-semibold text-sky-600 dark:text-sky-500">Deseja prosseguir com a otimização global em lote?</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmMassOptimize} className="bg-sky-600 hover:bg-sky-700 text-white dark:bg-sky-500 dark:hover:bg-sky-600">
              Confirmar Otimização
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
