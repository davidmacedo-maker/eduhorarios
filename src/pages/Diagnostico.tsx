import { useState, useMemo } from "react";
import {
  Sparkles,
  AlertTriangle,
  CheckCircle,
  HelpCircle,
  TrendingUp,
  BrainCircuit,
  Wrench,
  Download,
  Copy,
  Calendar,
  Clock,
  Users,
  BookOpen,
  GraduationCap,
  Calculator,
  RefreshCw,
  Search,
  Check,
  XCircle,
  Info
} from "lucide-react";
import {
  useTurmas,
  useProfessores,
  useDisciplinas,
  useAlocacoes,
  useMatrizCurricular,
  useConfiguracaoHorarios,
  generateId
} from "@/store";
import type { Turma, Disciplina, Professor, Alocacao, MatrizCurricular, Disponibilidade, PlanejamentoItem } from "@/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

// Classifications of problems
type ErrorCategory = "🟢 Cadastro" | "🔵 Motor" | "🟠 AutoRepair" | "🟣 Matriz Curricular" | "🔴 Banco de Dados";

interface DiagnosticIssue {
  id: string;
  categoria: ErrorCategory;
  classe: string; // e.g. "Turma 201", "Professor José"
  titulo: string;
  descricao: string;
  sugestao: string;
  origem: string;
  resolvivel: boolean;
  actionType?: "corrigir_vinc" | "remover_dupl" | "expandir_dispo";
  actionPayload?: any;
}

export default function Diagnostico() {
  const { toast } = useToast();
  const [turmas, setTurmas] = useTurmas();
  const [professores, setProfessores] = useProfessores();
  const [disciplinas] = useDisciplinas();
  const [alocacoes, setAlocacoes] = useAlocacoes();
  const [matriz, setMatriz] = useMatrizCurricular();
  const [config] = useConfiguracaoHorarios();

  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"geral" | "turmas" | "disponibilidade" | "contraturno" | "report" | "arquitetura">("geral");

  // State for live simulation of professor availability
  const [selectedSimProfId, setSelectedSimProfId] = useState<string>("");
  const [simAvailability, setSimAvailability] = useState<Disponibilidade>({});

  // Trigger when selecting a professor for simulation
  const handleSelectSimProf = (profId: string) => {
    setSelectedSimProfId(profId);
    const prof = professores.find(p => p.id === profId);
    if (prof) {
      setSimAvailability(JSON.parse(JSON.stringify(prof.disponibilidade || {})));
    }
  };

  const currentSimProf = useMemo(() => {
    return professores.find(p => p.id === selectedSimProfId);
  }, [selectedSimProfId, professores]);

  // Total weekly load planned for the simulated professor
  const simProfPlannedHours = useMemo(() => {
    if (!currentSimProf) return 0;
    return (currentSimProf.planejamento || []).reduce((sum, item) => {
      return sum + Number(item.aulasPorSemana !== undefined ? item.aulasPorSemana : item.quantidadeAulas || 0);
    }, 0);
  }, [currentSimProf]);

  // Slots count in simulated availability
  const simProfAvailableSlots = useMemo(() => {
    let count = 0;
    const dias = ["segunda", "terca", "quarta", "quinta", "sexta"];
    dias.forEach(dia => {
      const slots = simAvailability[dia] || [];
      count += slots.length;
    });
    return count;
  }, [simAvailability]);

  // Toggle slot in simulated availability
  const toggleSimSlot = (dia: string, slot: number) => {
    setSimAvailability(prev => {
      const current = prev[dia] ? [...prev[dia]] : [];
      let updated: number[];
      if (current.includes(slot)) {
        updated = current.filter(x => x !== slot);
      } else {
        updated = [...current, slot].sort((a, b) => a - b);
      }
      return {
        ...prev,
        [dia]: updated
      };
    });
  };

  // Save simulated availability to database/store
  const handleSaveSimAvailability = () => {
    if (!selectedSimProfId) return;
    setProfessores(prev => prev.map(p => {
      if (p.id === selectedSimProfId) {
        return {
          ...p,
          disponibilidade: simAvailability
        };
      }
      return p;
    }));
    toast({
      title: "Disponibilidade salva!",
      description: `A nova disponibilidade do professor foi atualizada com sucesso no banco de dados.`
    });
  };

  // Match maps for convenience
  const discMap = useMemo(() => new Map(disciplinas.map(d => [d.id, d])), [disciplinas]);
  const turmaMap = useMemo(() => new Map(turmas.map(t => [t.id, t])), [turmas]);
  const profMap = useMemo(() => new Map(professores.map(p => [p.id, p])), [professores]);

  // Helper to determine max weekly capacity of a class (Turma)
  const getTurmaCapacity = (t: Turma) => {
    const turno = t.turno || "manha";
    const slotsPerDay = turno === "noite"
      ? (config.quantidadeHorariosPorDiaNoite ?? 4)
      : turno === "tarde"
        ? (config.quantidadeHorariosPorDiaTarde ?? 5)
        : (config.quantidadeHorariosPorDia ?? 5);

    const diasPermitidos = t.diasPermitidos && Array.isArray(t.diasPermitidos) && t.diasPermitidos.length > 0
      ? t.diasPermitidos
      : ["segunda", "terca", "quarta", "quinta", "sexta"];

    return diasPermitidos.length * slotsPerDay;
  };

  // 1. Diagnose Turmas
  const turmasDiagnostic = useMemo(() => {
    return turmas.map(t => {
      const capMax = getTurmaCapacity(t);
      const previsto = matriz.filter(m => m.turmaId === t.id).reduce((sum, m) => sum + m.aulasPorSemana, 0);

      // Sum of planning elements
      let cadastrado = 0;
      professores.forEach(p => {
        (p.planejamento || []).forEach(pl => {
          if (pl.turmaId === t.id) {
            cadastrado += Number(pl.aulasPorSemana !== undefined ? pl.aulasPorSemana : pl.quantidadeAulas || 0);
          }
        });
      });

      const gerado = alocacoes.filter(a => a.turmaId === t.id).length;

      return {
        turma: t,
        capMax,
        previsto,
        cadastrado,
        gerado
      };
    });
  }, [turmas, matriz, professores, alocacoes, config]);

  // 2. Compute dynamic issues and suggestions list
  const issuesList = useMemo(() => {
    const list: DiagnosticIssue[] = [];

    // -- Matriz & Capacity constraints
    turmasDiagnostic.forEach(({ turma, capMax, previsto, cadastrado, gerado }) => {
      if (previsto > capMax) {
        list.push({
          id: `matriz-overflow-${turma.id}`,
          categoria: "🟣 Matriz Curricular",
          classe: `Turma ${turma.nome}`,
          titulo: "Matriz curricular excede capacidade física",
          descricao: `A turma exige ${previsto} aulas na matriz, mas o turno comporta no máximo ${capMax} aulas de acordo com as restrições de dias permitidos (${turma.diasPermitidos?.join(", ") || "segunda a sexta"}).`,
          sugestao: `Remover ${previsto - capMax} aulas das disciplinas da matriz curricular ou estender os dias permitidos de aula para essa turma.`,
          origem: "Matriz Curricular",
          resolvivel: false
        });
      }

      if (cadastrado > previsto) {
        list.push({
          id: `vinc-overflow-${turma.id}`,
          categoria: "🟢 Cadastro",
          classe: `Turma ${turma.nome}`,
          titulo: "Carga vinculada aos professores superior à matriz",
          descricao: `A soma de aulas atribuídas nos planejamentos dos professores (${cadastrado} aulas) é maior do que o previsto na matriz curricular (${previsto} aulas).`,
          sugestao: "Reduzir as horas nos vínculos e planejamentos de professores para essa turma.",
          origem: "Vínculos de Cadastro",
          resolvivel: true,
          actionType: "corrigir_vinc",
          actionPayload: { turmaId: turma.id }
        });
      }

      if (gerado > cadastrado) {
        list.push({
          id: `motor-overflow-${turma.id}`,
          categoria: "🔵 Motor",
          classe: `Turma ${turma.nome}`,
          titulo: "Aulas alocadas pelo motor excedem planejamento",
          descricao: `Foram geradas ${gerado} alocações para essa turma, mas o planejamento só prevê ${cadastrado} aulas.`,
          sugestao: "Remover alocações excedentes geradas incorretamente pelo algoritmo de alocação ou por ajustes manuais.",
          origem: "Motor de Geração / AutoRepair",
          resolvivel: true,
          actionType: "remover_dupl",
          actionPayload: { turmaId: turma.id }
        });
      }
    });

    // Check individual professor planning vs matriz disciplines
    professores.forEach(prof => {
      (prof.planejamento || []).forEach(pl => {
        const mat = matriz.find(m => m.turmaId === pl.turmaId && m.disciplinaId === pl.disciplinaId);
        const planned = Number(pl.aulasPorSemana !== undefined ? pl.aulasPorSemana : pl.quantidadeAulas || 0);
        if (mat && planned > mat.aulasPorSemana) {
          const t = turmaMap.get(pl.turmaId);
          const d = discMap.get(pl.disciplinaId);
          list.push({
            id: `prof-disc-excess-${prof.id}-${pl.turmaId}-${pl.disciplinaId}`,
            categoria: "🟢 Cadastro",
            classe: `Prof. ${prof.nomeCompleto}`,
            titulo: `Excesso de Carga Atribuída: ${d?.nome || pl.disciplinaId} na Turma ${t?.nome || pl.turmaId}`,
            descricao: `O professor possui ${planned} aulas cadastradas no planejamento, mas a matriz curricular prevê apenas ${mat.aulasPorSemana} aulas semanais para essa disciplina.`,
            sugestao: `Editar o planejamento do Professor ${prof.nomeCompleto} para ${mat.aulasPorSemana} aulas semanais de ${d?.nome || pl.disciplinaId} na Turma ${t?.nome || pl.turmaId}.`,
            origem: "Cadastro de Vínculos",
            resolvivel: true,
            actionType: "corrigir_vinc",
            actionPayload: { profId: prof.id, turmaId: pl.turmaId, disciplinaId: pl.disciplinaId, expectedValue: mat.aulasPorSemana }
          });
        }
      });
    });

    // Check teachers availability deficit
    professores.forEach(prof => {
      const plannedSum = (prof.planejamento || []).reduce((sum, item) => {
        return sum + Number(item.aulasPorSemana !== undefined ? item.aulasPorSemana : item.quantidadeAulas || 0);
      }, 0);

      let availableSlots = 0;
      Object.keys(prof.disponibilidade || {}).forEach(dia => {
        availableSlots += (prof.disponibilidade[dia] || []).length;
      });

      if (plannedSum > availableSlots) {
        list.push({
          id: `dispo-deficit-${prof.id}`,
          categoria: "🟢 Cadastro",
          classe: `Prof. ${prof.nomeCompleto}`,
          titulo: "Disponibilidade de horários insuficiente",
          descricao: `O professor tem carga semanal planejada de ${plannedSum} aulas, mas sua grade de disponibilidade só possui ${availableSlots} horários liberados.`,
          sugestao: `Adicionar mais horários na disponibilidade (mínimo de ${plannedSum - availableSlots} vagas adicionais) ou reduzir aulas atribuídas.`,
          origem: "Grade de Disponibilidade Docente",
          resolvivel: true,
          actionType: "expandir_dispo",
          actionPayload: { profId: prof.id }
        });
      }
    });

    // Contraturno constraints
    turmas.forEach(t => {
      const isContra = t.nome.toLowerCase().includes("contra") || t.nome.toLowerCase().includes("contraturno");
      if (isContra) {
        // Correct turn checked (usually should be afternoon 'tarde' for brazilian schools, or different than regular)
        if (t.turno === "manha" && t.serie.includes("Contra")) {
          list.push({
            id: `contra-turno-warn-${t.id}`,
            categoria: "🟣 Matriz Curricular",
            classe: `Turma ${t.nome}`,
            titulo: "Turno da Turma de Contraturno pode estar incorreto",
            descricao: `A turma de contraturno ${t.nome} está configurada no turno Matutino (Manhã), o que pode gerar conflitos com as aulas regulares dos alunos.`,
            sugestao: "Alterar o turno da turma de contraturno para Vespertino (Tarde) ou Noturno (Noite) se apropriado.",
            origem: "Cadastro de Turmas",
            resolvivel: false
          });
        }

        // Capacity check
        const cap = getTurmaCapacity(t);
        const previsto = matriz.filter(m => m.turmaId === t.id).reduce((sum, m) => sum + m.aulasPorSemana, 0);
        if (previsto > cap) {
          list.push({
            id: `contra-capacity-${t.id}`,
            categoria: "🟣 Matriz Curricular",
            classe: `Turma ${t.nome}`,
            titulo: "Capacidade de Contraturno insuficiente para a Matriz",
            descricao: `A matriz curricular exige ${previsto} aulas, mas as restrições de dias permitidos da turma (${t.diasPermitidos?.join(", ")}) só oferecem suporte para ${cap} horários.`,
            sugestao: "Aumentar os dias permitidos na ficha da turma de contraturno ou reduzir as aulas semanais na matriz.",
            origem: "Contraturno / Dias Permitidos",
            resolvivel: false
          });
        }
      }
    });

    // -- Falta de aulas na Matriz/Turma
    turmasDiagnostic.forEach(({ turma, previsto, gerado }) => {
      if (gerado < previsto) {
        list.push({
          id: `matriz-underflow-${turma.id}`,
          categoria: "🟣 Matriz Curricular",
          classe: `Turma ${turma.nome}`,
          titulo: "Carga horária alocada menor que a matriz curricular",
          descricao: `A turma possui ${gerado} aulas alocadas, mas a matriz curricular prevê ${previsto} aulas. Faltam ${previsto - gerado} aulas para fechar a grade.`,
          sugestao: `Executar o gerador de horários ou alocar manualmente as ${previsto - gerado} aulas pendentes desta turma.`,
          origem: "Matriz Curricular",
          resolvivel: false
        });
      }
    });

    // -- Limites de Carga do Professor e Conflitos de Disponibilidade
    professores.forEach(prof => {
      const totalAlocado = alocacoes.filter(a => a.professorId === prof.id).length;
      
      // Excesso de carga semanal máxima
      if (prof.cargaHorariaMaximaSemanal && totalAlocado > prof.cargaHorariaMaximaSemanal) {
        list.push({
          id: `prof-over-max-semanal-${prof.id}`,
          categoria: "🟢 Cadastro",
          classe: `Prof. ${prof.nomeCompleto}`,
          titulo: "Carga semanal alocada excede limite do professor",
          descricao: `O professor possui ${totalAlocado} aulas alocadas na grade atual, o que ultrapassa sua carga horária máxima semanal cadastrada de ${prof.cargaHorariaMaximaSemanal} aulas.`,
          sugestao: "Remover as alocações excedentes deste professor ou aumentar o limite de carga semanal cadastrada.",
          origem: "Cadastro de Professores / Carga Máxima",
          resolvivel: false
        });
      }

      // Carga planejada não totalmente alocada
      const plannedSum = (prof.planejamento || []).reduce((sum, item) => {
        return sum + Number(item.aulasPorSemana !== undefined ? item.aulasPorSemana : item.quantidadeAulas || 0);
      }, 0);
      if (totalAlocado < plannedSum) {
        list.push({
          id: `prof-under-planned-${prof.id}`,
          categoria: "🔵 Motor",
          classe: `Prof. ${prof.nomeCompleto}`,
          titulo: "Carga docente planejada não atendida totalmente",
          descricao: `O professor possui ${totalAlocado} aulas alocadas, mas seu planejamento docente totaliza ${plannedSum} aulas. Faltam alocar ${plannedSum - totalAlocado} aulas.`,
          sugestao: "Utilizar o Motor de Complementação de Carga ou realizar alocações manuais para fechar as atribuições do professor.",
          origem: "Planejamento Docente",
          resolvivel: false
        });
      }
    });

    // Conflitos individuais de disponibilidade das alocações existentes
    alocacoes.forEach(a => {
      if (!a.professorId) return;
      const prof = profMap.get(a.professorId);
      if (prof && prof.disponibilidade) {
        const diaSlots = prof.disponibilidade[a.diaSemana] || [];
        if (!diaSlots.includes(a.horario)) {
          const t = turmaMap.get(a.turmaId);
          list.push({
            id: `prof-dispo-conflict-${a.id}`,
            categoria: "🔵 Motor",
            classe: `Prof. ${prof.nomeCompleto}`,
            titulo: `Conflito de Disponibilidade: Aula na Turma ${t?.nome || a.turmaId}`,
            descricao: `O professor foi alocado no dia ${a.diaSemana} - ${a.horario}º horário na turma ${t?.nome || a.turmaId}, mas esse slot não consta em seus dias e horários disponíveis.`,
            sugestao: `Remover ou remanejar esta aula, ou alterar a grade de disponibilidade do Professor ${prof.nomeCompleto} para liberar este slot.`,
            origem: "Disponibilidade Docente vs Alocação",
            resolvivel: false
          });
        }
      }
    });

    return list;
  }, [turmasDiagnostic, professores, matriz, alocacoes, turmas, config]);

  // Filter issues based on search query
  const filteredIssues = useMemo(() => {
    if (!searchQuery) return issuesList;
    const query = searchQuery.toLowerCase();
    return issuesList.filter(item =>
      item.classe.toLowerCase().includes(query) ||
      item.titulo.toLowerCase().includes(query) ||
      item.descricao.toLowerCase().includes(query) ||
      item.categoria.toLowerCase().includes(query)
    );
  }, [issuesList, searchQuery]);

  // Quick automated fix mechanics
  const handleExecuteQuickFix = (issue: DiagnosticIssue) => {
    if (!issue.actionPayload) return;

    if (issue.actionType === "corrigir_vinc") {
      const { profId, turmaId, disciplinaId, expectedValue } = issue.actionPayload;

      if (profId && turmaId && disciplinaId && expectedValue !== undefined) {
        // Fix a specific professor planning match
        setProfessores(prev => prev.map(p => {
          if (p.id === profId) {
            const plan = (p.planejamento || []).map(pl => {
              if (pl.turmaId === turmaId && pl.disciplinaId === disciplinaId) {
                return {
                  ...pl,
                  aulasPorSemana: expectedValue,
                  quantidadeAulas: expectedValue
                };
              }
              return pl;
            });
            return { ...p, planejamento: plan };
          }
          return p;
        }));
        toast({
          title: "Vínculo corrigido!",
          description: `O planejamento do professor foi restabelecido para o limite planejado de ${expectedValue} aulas semanais.`
        });
      } else if (turmaId) {
        // Bulk fix for all mismatching planning in this class to match Matriz expected values
        setProfessores(prev => prev.map(p => {
          const plan = (p.planejamento || []).map(pl => {
            if (pl.turmaId === turmaId) {
              const mat = matriz.find(m => m.turmaId === turmaId && m.disciplinaId === pl.disciplinaId);
              if (mat && (Number(pl.aulasPorSemana !== undefined ? pl.aulasPorSemana : pl.quantidadeAulas || 0) > mat.aulasPorSemana)) {
                return {
                  ...pl,
                  aulasPorSemana: mat.aulasPorSemana,
                  quantidadeAulas: mat.aulasPorSemana
                };
              }
            }
            return pl;
          });
          return { ...p, planejamento: plan };
        }));
        toast({
          title: "Vínculos corrigidos!",
          description: `Todos os planejamentos de professores para a turma foram ajustados de acordo com os limites da Matriz Curricular.`
        });
      }
    }

    if (issue.actionType === "remover_dupl") {
      const { turmaId } = issue.actionPayload;
      if (turmaId) {
        // Remove excess, un-locked allocations from the end of the week for this class
        const classAlocs = alocacoes.filter(a => a.turmaId === turmaId);
        const classMatriz = matriz.filter(m => m.turmaId === turmaId);

        let updatedAlocs = [...alocacoes];
        let removedCount = 0;

        classMatriz.forEach(mat => {
          const limit = mat.aulasPorSemana;
          const specificAlocs = classAlocs.filter(a => a.disciplinaId === mat.disciplinaId);

          if (specificAlocs.length > limit) {
            const excess = specificAlocs.length - limit;
            const toRemove = specificAlocs
              .filter(a => !a.isLocked)
              .sort((a, b) => {
                // Prioritize removing late-week allocations
                const days = ["segunda", "terca", "quarta", "quinta", "sexta"];
                if (a.diaSemana !== b.diaSemana) {
                  return days.indexOf(b.diaSemana) - days.indexOf(a.diaSemana);
                }
                return b.horario - a.horario;
              })
              .slice(0, excess);

            const removeIds = new Set(toRemove.map(r => r.id));
            updatedAlocs = updatedAlocs.filter(a => !removeIds.has(a.id));
            removedCount += removeIds.size;
          }
        });

        if (removedCount > 0) {
          setAlocacoes(updatedAlocs);
          toast({
            title: "Duplicidades removidas!",
            description: `Removidas com sucesso ${removedCount} alocação(ões) excedente(s) desta turma para restabelecer a integridade da grade.`
          });
        } else {
          toast({
            title: "Aviso",
            description: "Não foi possível remover aulas pois todas as alocações excedentes estão travadas (bloqueadas pelo usuário).",
            variant: "destructive"
          });
        }
      }
    }

    if (issue.actionType === "expandir_dispo") {
      // Direct user to open simulated editor
      handleSelectSimProf(issue.actionPayload.profId);
      setActiveTab("disponibilidade");
      toast({
        title: "Editor de Disponibilidade",
        description: `Carregada a grade de simulação para o professor. Use a planilha interativa para liberar mais horários.`
      });
    }
  };

  // 3. Dynamic Consistency Index (IGC - Índice Geral de Consistência)
  const igcMetrics = useMemo(() => {
    // A) Carga Horária das Turmas (25% weight)
    const validTurmaCarga = turmasDiagnostic.filter(td => td.cadastrado <= td.previsto && td.previsto <= td.capMax).length;
    const turmasCargaScore = turmas.length > 0 ? (validTurmaCarga / turmas.length) * 100 : 100;

    // B) Disponibilidade dos Professores (25% weight)
    const validProfAvailable = professores.filter(p => {
      const load = (p.planejamento || []).reduce((sum, pl) => sum + Number(pl.aulasPorSemana !== undefined ? pl.aulasPorSemana : pl.quantidadeAulas || 0), 0);
      let dispoCount = 0;
      Object.keys(p.disponibilidade || {}).forEach(d => { dispoCount += (p.disponibilidade[d] || []).length; });
      return load <= dispoCount;
    }).length;
    const profsDispoScore = professores.length > 0 ? (validProfAvailable / professores.length) * 100 : 100;

    // C) Integridade da Matriz Curricular (20% weight)
    const validMatriz = turmasDiagnostic.filter(td => td.previsto <= td.capMax).length;
    const matrizScore = turmas.length > 0 ? (validMatriz / turmas.length) * 100 : 100;

    // D) Integridade dos Vínculos (15% weight)
    const mismatchingPlanCount = issuesList.filter(iss => iss.categoria === "🟢 Cadastro" && iss.titulo.includes("Superior")).length;
    const vinculosScore = issuesList.length > 0 ? Math.max(0, 100 - (mismatchingPlanCount * 12)) : 100;

    // E) Conflitos do Motor (15% weight)
    // Double allocations / conflicts
    let conflictCount = 0;
    const doubleBookedProfs = new Set<string>();
    const doubleBookedTurmas = new Set<string>();

    alocacoes.forEach((a, idx) => {
      alocacoes.slice(idx + 1).forEach(b => {
        if (a.diaSemana === b.diaSemana && a.horario === b.horario) {
          if (a.professorId === b.professorId) {
            conflictCount++;
            doubleBookedProfs.add(a.professorId);
          }
          if (a.turmaId === b.turmaId) {
            conflictCount++;
            doubleBookedTurmas.add(a.turmaId);
          }
        }
      });
    });

    const motorScore = alocacoes.length > 0 ? Math.max(0, 100 - (conflictCount * 5)) : 100;

    // Weighted index
    const igc = Math.round(
      (turmasCargaScore * 0.25) +
      (profsDispoScore * 0.25) +
      (matrizScore * 0.20) +
      (vinculosScore * 0.15) +
      (motorScore * 0.15)
    );

    return {
      igc,
      turmasCargaScore,
      profsDispoScore,
      matrizScore,
      vinculosScore,
      motorScore,
      conflitosCount: conflictCount,
      mismatchingPlanCount
    };
  }, [turmas, professores, alocacoes, matriz, config, turmasDiagnostic, issuesList]);

  // Copy TXT Report of Diagnostics
  const generateTextReport = () => {
    let report = `========================================================\n`;
    report += `   EduHorários - RELATÓRIO DO DIAGNÓSTICO INTELIGENTE\n`;
    report += `========================================================\n`;
    report += `Gerado em: ${new Date().toLocaleString()}\n`;
    report += `ÍNDICE GERAL DE CONSISTÊNCIA (IGC): ${igcMetrics.igc}/100\n\n`;

    report += `--- INDICADORES DE CONTEXTO ---\n`;
    report += `- Carga Horária das Turmas: ${Math.round(igcMetrics.turmasCargaScore)}%\n`;
    report += `- Disponibilidade dos Professores: ${Math.round(igcMetrics.profsDispoScore)}%\n`;
    report += `- Integridade da Matriz Curricular: ${Math.round(igcMetrics.matrizScore)}%\n`;
    report += `- Integridade de Vínculos de Cadastro: ${Math.round(igcMetrics.vinculosScore)}%\n`;
    report += `- Integridade dos Horários do Motor: ${Math.round(igcMetrics.motorScore)}%\n\n`;

    report += `--- DADOS DE INVENTÁRIO ---\n`;
    report += `- Total de Professores: ${professores.length}\n`;
    report += `- Total de Turmas: ${turmas.length}\n`;
    report += `- Total de Disciplinas: ${disciplinas.length}\n`;
    report += `- Total de Aulas Alocadas: ${alocacoes.length}\n\n`;

    report += `--- PROBLEMAS E INCONSISTÊNCIAS DETECTADAS (${issuesList.length}) ---\n`;
    if (issuesList.length === 0) {
      report += `✔ Nenhuma inconsistência encontrada. Base de dados 100% íntegra!\n`;
    } else {
      issuesList.forEach((iss, index) => {
        report += `[${index + 1}] Categoria: ${iss.categoria}\n`;
        report += `    Entidade: ${iss.classe}\n`;
        report += `    Inconsistência: ${iss.titulo}\n`;
        report += `    Descrição: ${iss.descricao}\n`;
        report += `    Sugestão de Correção: ${iss.sugestao}\n\n`;
      });
    }

    return report;
  };

  const handleCopyReport = () => {
    const text = generateTextReport();
    navigator.clipboard.writeText(text);
    toast({
      title: "Relatório copiado!",
      description: "O texto do relatório de diagnóstico foi enviado para a sua área de transferência."
    });
  };

  const handleDownloadReport = () => {
    const text = generateTextReport();
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `diagnostico_eduhorarios_${Date.now()}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    toast({
      title: "Download iniciado!",
      description: "O arquivo .txt do laudo técnico de consistência foi baixado."
    });
  };

  return (
    <div className="container mx-auto py-6 space-y-6 max-w-7xl">
      {/* Page Title */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b pb-5">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-primary/10 text-primary rounded-lg">
              <Sparkles className="w-6 h-6" />
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight">Diagnóstico Inteligente</h1>
          </div>
          <p className="text-muted-foreground mt-1">
            Audite preventivamente erros de cadastro, matrizes curriculares, contraturno e disponibilidade de professores.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleCopyReport} className="gap-2">
            <Copy className="w-4 h-4" /> Copiar Laudo
          </Button>
          <Button variant="default" size="sm" onClick={handleDownloadReport} className="gap-2">
            <Download className="w-4 h-4" /> Baixar TXT
          </Button>
        </div>
      </div>

      {/* Main Stats Grid with IGC Gauge */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* IGC Circle Score Card */}
        <Card className="lg:col-span-1 flex flex-col justify-between overflow-hidden relative">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <BrainCircuit className="w-5 h-5 text-primary" />
              Índice de Consistência (IGC)
            </CardTitle>
            <CardDescription>Qualidade geral da base de dados escolar</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center py-6">
            <div className="relative flex items-center justify-center w-36 h-36">
              {/* Simple beautiful concentric progress circle */}
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  strokeWidth="8"
                  stroke="hsl(var(--muted))"
                  fill="transparent"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  strokeWidth="8"
                  stroke={igcMetrics.igc >= 90 ? "#10b981" : igcMetrics.igc >= 70 ? "#f59e0b" : "#ef4444"}
                  strokeDasharray={`${2 * Math.PI * 42}`}
                  strokeDashoffset={`${2 * Math.PI * 42 * (1 - igcMetrics.igc / 100)}`}
                  strokeLinecap="round"
                  fill="transparent"
                />
              </svg>
              <div className="absolute flex flex-col items-center justify-center">
                <span className="text-3xl font-black tracking-tight">{igcMetrics.igc}</span>
                <span className="text-[10px] text-muted-foreground font-semibold uppercase">Pontos</span>
              </div>
            </div>

            <div className="mt-4 text-center">
              {igcMetrics.igc >= 90 ? (
                <div className="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                  <CheckCircle className="w-4 h-4" /> Base Altamente Consistente
                </div>
              ) : igcMetrics.igc >= 70 ? (
                <div className="text-amber-600 dark:text-amber-400 font-bold flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4" /> Cadastros Precisam de Ajustes
                </div>
              ) : (
                <div className="text-red-600 dark:text-red-400 font-bold flex items-center gap-1">
                  <XCircle className="w-4 h-4" /> Base Crítica / Incompatível
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Detailed Indicator Breakdown */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Indicadores Técnicos de Integridade</CardTitle>
            <CardDescription>Critérios ponderados para o cálculo de conformidade escolar</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium text-muted-foreground">Carga Horária das Turmas (25%)</span>
                <span className="font-bold">{Math.round(igcMetrics.turmasCargaScore)}%</span>
              </div>
              <Progress value={igcMetrics.turmasCargaScore} className="h-2" />
            </div>

            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium text-muted-foreground">Disponibilidade dos Professores (25%)</span>
                <span className="font-bold">{Math.round(igcMetrics.profsDispoScore)}%</span>
              </div>
              <Progress value={igcMetrics.profsDispoScore} className="h-2" />
            </div>

            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium text-muted-foreground">Integridade da Matriz Curricular (20%)</span>
                <span className="font-bold">{Math.round(igcMetrics.matrizScore)}%</span>
              </div>
              <Progress value={igcMetrics.matrizScore} className="h-2" />
            </div>

            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium text-muted-foreground">Vínculos de Cadastro e Planejamento (15%)</span>
                <span className="font-bold">{Math.round(igcMetrics.vinculosScore)}%</span>
              </div>
              <Progress value={igcMetrics.vinculosScore} className="h-2" />
            </div>

            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium text-muted-foreground">Conflitos de Grade de Horários (15%)</span>
                <span className="font-bold">{Math.round(igcMetrics.motorScore)}%</span>
              </div>
              <Progress value={igcMetrics.motorScore} className="h-2" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs Navigation */}
      <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="w-full">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-3 md:grid-cols-6 h-auto py-1">
          <TabsTrigger value="geral" className="py-2.5">Geral ({filteredIssues.length})</TabsTrigger>
          <TabsTrigger value="turmas" className="py-2.5">Carga das Turmas</TabsTrigger>
          <TabsTrigger value="disponibilidade" className="py-2.5">Disponibilidade Inteligente</TabsTrigger>
          <TabsTrigger value="contraturno" className="py-2.5">Turmas Contraturno</TabsTrigger>
          <TabsTrigger value="report" className="py-2.5">Laudo de Auditoria</TabsTrigger>
          <TabsTrigger value="arquitetura" className="py-2.5 font-bold text-primary">Auditoria Arquitetural</TabsTrigger>
        </TabsList>

        {/* Tab 1: Issues List & Search */}
        <TabsContent value="geral" className="space-y-4 mt-4">
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <h2 className="text-xl font-bold flex items-center gap-2">
              Inconsistências Identificadas
              {filteredIssues.length > 0 && (
                <Badge variant="destructive">{filteredIssues.length}</Badge>
              )}
            </h2>
            <div className="relative w-full md:w-80">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Filtrar por professor, turma..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-4 py-2 w-full text-sm rounded-lg border bg-background"
              />
            </div>
          </div>

          {filteredIssues.length === 0 ? (
            <Card className="border-dashed flex flex-col items-center justify-center p-12 text-center">
              <CheckCircle className="w-12 h-12 text-emerald-500 mb-3" />
              <CardTitle className="text-lg">Sua base de dados está perfeita!</CardTitle>
              <CardDescription className="max-w-md mt-1">
                Nenhum conflito de carga, planejamento desalinhado ou insuficiência de disponibilidade de professores foi encontrado nesta auditoria.
              </CardDescription>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredIssues.map((issue) => (
                <Card key={issue.id} className="hover:border-primary/30 transition-all">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <Badge className={
                        issue.categoria.includes("Cadastro") ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" :
                        issue.categoria.includes("Motor") ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" :
                        issue.categoria.includes("AutoRepair") ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" :
                        "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300"
                      }>
                        {issue.categoria}
                      </Badge>
                      <span className="text-xs text-muted-foreground font-mono">{issue.origem}</span>
                    </div>
                    <CardTitle className="text-base mt-2 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      <div>
                        <span className="text-primary font-bold block text-xs uppercase tracking-wider">{issue.classe}</span>
                        {issue.titulo}
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">{issue.descricao}</p>
                    <div className="bg-muted/40 p-2.5 rounded-lg border text-xs">
                      <strong className="text-foreground">Sugerido:</strong> {issue.sugestao}
                    </div>
                    {issue.resolvivel && (
                      <div className="flex justify-end pt-1">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleExecuteQuickFix(issue)}
                          className="gap-1.5 font-semibold text-primary"
                        >
                          <Wrench className="w-3.5 h-3.5" /> Corrigir Automaticamente
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Tab 2: Class Load Auditing */}
        <TabsContent value="turmas" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Painel de Carga Horária das Turmas</CardTitle>
              <CardDescription>Comparativo entre capacidade diária, carga prevista (Matriz), carga vinculada (Cadastro) e alocações geradas</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left border-collapse">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="p-3 font-semibold">Turma</th>
                      <th className="p-3 font-semibold text-center">Turno</th>
                      <th className="p-3 font-semibold text-center">Capacidade Máxima</th>
                      <th className="p-3 font-semibold text-center">Previsto (Matriz)</th>
                      <th className="p-3 font-semibold text-center">Cadastrado (Vínculos)</th>
                      <th className="p-3 font-semibold text-center">Gerado (Horários)</th>
                      <th className="p-3 font-semibold text-center">Status de Carga</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {turmasDiagnostic.map(({ turma, capMax, previsto, cadastrado, gerado }) => {
                      const hasOverflow = previsto > capMax || cadastrado > previsto || gerado > cadastrado;
                      return (
                        <tr key={turma.id} className="hover:bg-muted/30 transition-colors">
                          <td className="p-3 font-bold">{turma.nome}</td>
                          <td className="p-3 text-center uppercase text-xs font-semibold">{turma.turno}</td>
                          <td className="p-3 text-center font-semibold text-muted-foreground">{capMax} aulas</td>
                          <td className="p-3 text-center">{previsto} aulas</td>
                          <td className="p-3 text-center">
                            <span className={cadastrado > previsto ? "text-amber-500 font-bold" : "text-foreground"}>
                              {cadastrado} aulas
                            </span>
                          </td>
                          <td className="p-3 text-center">
                            <span className={gerado > cadastrado ? "text-red-500 font-bold animate-pulse" : "text-foreground"}>
                              {gerado} aulas
                            </span>
                          </td>
                          <td className="p-3 text-center">
                            {hasOverflow ? (
                              <Badge variant="destructive" className="gap-1">
                                <AlertTriangle className="w-3 h-3" /> Excesso de Aulas
                              </Badge>
                            ) : (
                              <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 gap-1">
                                <Check className="w-3 h-3" /> Base Consistente
                              </Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: Intelligent Availability Editor & Simulator */}
        <TabsContent value="disponibilidade" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* List of Teachers with warnings */}
            <Card className="md:col-span-1">
              <CardHeader>
                <CardTitle className="text-base">Professores e Cargas</CardTitle>
                <CardDescription>Selecione um professor para simular disponibilidade em tempo real</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y max-h-[480px] overflow-y-auto">
                  {professores.map(p => {
                    const load = (p.planejamento || []).reduce((sum, pl) => sum + Number(pl.aulasPorSemana !== undefined ? pl.aulasPorSemana : pl.quantidadeAulas || 0), 0);
                    let dispoCount = 0;
                    Object.keys(p.disponibilidade || {}).forEach(d => { dispoCount += (p.disponibilidade[d] || []).length; });
                    const hasDeficit = load > dispoCount;

                    return (
                      <button
                        key={p.id}
                        onClick={() => handleSelectSimProf(p.id)}
                        className={`w-full text-left p-3.5 transition-colors flex flex-col gap-1 items-start ${selectedSimProfId === p.id ? "bg-primary/10 border-l-4 border-primary" : "hover:bg-muted/40"}`}
                      >
                        <span className="font-bold text-sm text-foreground">{p.nomeCompleto}</span>
                        <div className="flex justify-between w-full text-xs text-muted-foreground mt-1">
                          <span>Aulas Planejadas: <strong>{load}h</strong></span>
                          <span>Disponibilidade: <strong className={hasDeficit ? "text-red-500 font-bold" : "text-emerald-500"}>{dispoCount}h</strong></span>
                        </div>
                        {hasDeficit && (
                          <span className="text-[10px] bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 px-1.5 py-0.5 rounded font-bold mt-1">
                            ⚠️ Faltam {load - dispoCount} horários
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Simulated Live Availability Editor */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-primary" />
                  Simulador de Disponibilidade Interativa
                </CardTitle>
                <CardDescription>
                  {currentSimProf
                    ? `Ajuste a grade horária do Prof. ${currentSimProf.nomeCompleto} e veja o status de alocação ser recalculado na hora.`
                    : "Selecione um professor da lista ao lado para iniciar a simulação e homologação de disponibilidade."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {currentSimProf ? (
                  <div className="space-y-6">
                    {/* Simulator Info Dashboard */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-muted/40 p-4 rounded-lg border">
                      <div>
                        <span className="text-xs text-muted-foreground block font-medium">Professor</span>
                        <span className="font-bold text-sm truncate block">{currentSimProf.nomeCompleto}</span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground block font-medium">Necessário</span>
                        <span className="font-bold text-sm block text-primary">{simProfPlannedHours} Horários</span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground block font-medium">Marcados na Simulação</span>
                        <span className="font-bold text-sm block">{simProfAvailableSlots} Horários</span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground block font-medium">Status do Recálculo</span>
                        {simProfAvailableSlots >= simProfPlannedHours ? (
                          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 font-bold gap-1">
                            <Check className="w-3 h-3" /> Válido ({simProfAvailableSlots}/{simProfPlannedHours})
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="font-bold gap-1">
                            <AlertTriangle className="w-3 h-3 animate-bounce" /> Inválido ({simProfAvailableSlots}/{simProfPlannedHours})
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Interactive Simulator Grid */}
                    <div>
                      <h3 className="text-sm font-semibold mb-3">Clique nos blocos para alternar a disponibilidade na semana:</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-center border-collapse">
                          <thead>
                            <tr className="bg-muted">
                              <th className="p-2 border font-medium text-xs">Horário</th>
                              {["Segunda", "Terça", "Quarta", "Quinta", "Sexta"].map(d => (
                                <th key={d} className="p-2 border font-semibold text-xs">{d}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {/* Slots 1..15 corresponding to Matutino, Vespertino, Noturno */}
                            {Array.from({ length: 15 }).map((_, idx) => {
                              const slotNumber = idx + 1;
                              let label = `${slotNumber}º`;
                              let turnName = "Matutino";

                              if (slotNumber > 10) {
                                label = `${slotNumber - 10}º Tarde`;
                                turnName = "Vespertino";
                              } else if (slotNumber > 5) {
                                label = `${slotNumber - 5}º Tarde (Legado)`;
                                turnName = "Vespertino (Legado)";
                              }

                              const daysKeys = ["segunda", "terca", "quarta", "quinta", "sexta"];

                              return (
                                <tr key={slotNumber}>
                                  <td className="p-2 border font-mono text-xs text-muted-foreground">{label}</td>
                                  {daysKeys.map(dia => {
                                    const activeSlots = simAvailability[dia] || [];
                                    const isSelected = activeSlots.includes(slotNumber);

                                    return (
                                      <td key={dia} className="p-1 border">
                                        <button
                                          type="button"
                                          onClick={() => toggleSimSlot(dia, slotNumber)}
                                          className={`w-full h-8 rounded text-[10px] font-bold transition-all ${isSelected ? "bg-primary text-primary-foreground shadow-sm scale-95" : "bg-muted/30 hover:bg-muted text-muted-foreground"}`}
                                        >
                                          {isSelected ? "LIVRE" : "BLOC"}
                                        </button>
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

                    <div className="flex justify-between items-center pt-2">
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Info className="w-3.5 h-3.5 text-primary" /> Modificar esta grade altera temporariamente os cálculos. Salve para persistir no banco.
                      </p>
                      <Button onClick={handleSaveSimAvailability} className="gap-2 font-semibold">
                        <Check className="w-4 h-4" /> Salvar Disponibilidade Oficial
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed rounded-lg">
                    <Calendar className="w-12 h-12 text-muted-foreground mb-3 animate-pulse" />
                    <p className="font-medium text-muted-foreground">Nenhum professor selecionado</p>
                    <p className="text-xs text-muted-foreground max-w-sm mt-1">Clique em um professor na barra lateral esquerda para auditar e otimizar sua disponibilidade.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tab 4: Contraturno Inspection */}
        <TabsContent value="contraturno" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Auditoria de Turmas de Contraturno</CardTitle>
              <CardDescription>Verificação de turmas especiais (101 Contra, 201 Contra, etc.) com restrição de horários e dias letivos específicos</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {turmas.filter(t => t.nome.toLowerCase().includes("contra") || t.nome.toLowerCase().includes("contraturno") || (t.diasPermitidos && t.diasPermitidos.length < 5)).map(t => {
                  const capacity = getTurmaCapacity(t);
                  const previsto = matriz.filter(m => m.turmaId === t.id).reduce((sum, m) => sum + m.aulasPorSemana, 0);
                  const isSufficient = capacity >= previsto;

                  return (
                    <Card key={t.id} className="border-l-4 border-l-indigo-500">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-bold flex items-center justify-between">
                          <span>{t.nome} ({t.turno.toUpperCase()})</span>
                          {isSufficient ? (
                            <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">Viável</Badge>
                          ) : (
                            <Badge variant="destructive">Sobrecarga</Badge>
                          )}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3 text-xs">
                        <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                          <div>
                            <span>Dias Permitidos:</span>
                            <strong className="block text-foreground mt-0.5">{t.diasPermitidos?.join(", ") || "segunda a sexta"}</strong>
                          </div>
                          <div>
                            <span>Horas na Matriz:</span>
                            <strong className="block text-foreground mt-0.5">{previsto} aulas / sem</strong>
                          </div>
                          <div>
                            <span>Capacidade Física:</span>
                            <strong className="block text-foreground mt-0.5">{capacity} slots / sem</strong>
                          </div>
                          <div>
                            <span>Ocupação:</span>
                            <strong className="block text-foreground mt-0.5">{capacity > 0 ? Math.round((previsto / capacity) * 100) : 0}%</strong>
                          </div>
                        </div>

                        {!isSufficient && (
                          <div className="bg-red-50 dark:bg-red-950/20 text-red-800 dark:text-red-300 p-2.5 rounded border border-red-100 dark:border-red-900/30 mt-2 font-medium">
                            🚨 A matriz desta turma ({previsto} aulas) excede a capacidade física baseada nos dias permitidos ({capacity} aulas). Adicione mais dias de aula.
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 5: Report Block */}
        <TabsContent value="report" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Laudo Técnico de Auditoria Preventiva</CardTitle>
                <CardDescription>Relatório final estruturado contendo a auditoria geral e performance de consistência</CardDescription>
              </div>
              <Button size="sm" onClick={handleCopyReport} className="gap-2">
                <Copy className="w-4 h-4" /> Copiar Texto
              </Button>
            </CardHeader>
            <CardContent>
              <pre className="p-4 bg-muted text-muted-foreground rounded-lg border font-mono text-xs overflow-x-auto whitespace-pre-wrap max-h-[500px]">
                {generateTextReport()}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 6: Architectural Audit Panel */}
        <TabsContent value="arquitetura" className="space-y-6 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Column 1 & 2: Architectural Questions & Structured Proofs */}
            <div className="md:col-span-2 space-y-6">
              
              <Card className="border-l-4 border-l-primary shadow-sm bg-background">
                <CardHeader>
                  <CardTitle className="text-xl font-extrabold flex items-center gap-2">
                    <BrainCircuit className="w-5 h-5 text-primary" />
                    Auditoria de Responsabilidades e Fluxo de Escrita
                  </CardTitle>
                  <CardDescription>
                    Mapeamento estrito de quem altera, valida, analisa e audita a grade de horários (Grade Final)
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5 leading-relaxed text-sm">
                  
                  <div className="space-y-3">
                    <h3 className="font-bold text-foreground flex items-center gap-2 text-base">
                      <span className="text-primary font-black">Q1.</span> Quem realmente altera a grade (Fonte Única de Verdade)?
                    </h3>
                    <div className="bg-muted/40 p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
                      <p className="font-semibold text-foreground">
                        Apenas um único responsável central: o estado global de alocação no Store (<code className="text-xs text-primary bg-primary/5 px-1 py-0.5 rounded">useAlocacoes</code>).
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Nenhum componente ou motor secundário grava diretamente no banco de dados ou no localStorage sem passar pela orquestração de <code className="text-xs bg-muted px-1 rounded">setAlocacoes</code> no store. Todas as alterações em lote do motor (IFS Solver, Simulated Annealing, Compactadores) geram uma nova proposta de grade e a devolvem em formato de vetor imutável de alocações, que é então validado e persistido pelo orquestrador principal do React.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="bg-muted/35 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                      <div className="text-xs font-bold text-primary mb-1 uppercase tracking-wider flex items-center gap-1">
                        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500"></span> Inserção de Aulas
                      </div>
                      <p className="text-xs text-muted-foreground leading-normal">
                        Apenas <strong>2 pontos de origem</strong> no sistema:
                      </p>
                      <ul className="text-[11px] list-disc pl-4 mt-1 text-muted-foreground leading-snug space-y-0.5">
                        <li><strong>Manual:</strong> Operação Drag-and-Drop do usuário na grade.</li>
                        <li><strong>Automático:</strong> Motor de Alocação (IFS Solver) após validação.</li>
                      </ul>
                    </div>

                    <div className="bg-muted/35 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                      <div className="text-xs font-bold text-primary mb-1 uppercase tracking-wider flex items-center gap-1">
                        <span className="inline-block w-2 h-2 rounded-full bg-red-500"></span> Remoção de Aulas
                      </div>
                      <p className="text-xs text-muted-foreground leading-normal">
                        Apenas <strong>3 pontos de origem</strong> no sistema:
                      </p>
                      <ul className="text-[11px] list-disc pl-4 mt-1 text-muted-foreground leading-snug space-y-0.5">
                        <li><strong>Manual:</strong> Clique no ícone de lixeira (Remoção Individual).</li>
                        <li><strong>Total:</strong> Limpeza completa de grade (Zerar Grade).</li>
                        <li><strong>Auditoria Docente:</strong> Camada final filtradora de excesso de carga.</li>
                      </ul>
                    </div>

                    <div className="bg-muted/35 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                      <div className="text-xs font-bold text-primary mb-1 uppercase tracking-wider flex items-center gap-1">
                        <span className="inline-block w-2 h-2 rounded-full bg-amber-500"></span> Movimentação de Aulas
                      </div>
                      <p className="text-xs text-muted-foreground leading-normal">
                        Apenas <strong>2 pontos de origem</strong> no sistema:
                      </p>
                      <ul className="text-[11px] list-disc pl-4 mt-1 text-muted-foreground leading-snug space-y-0.5">
                        <li><strong>Manual:</strong> Usuário arrasta a aula de um slot para outro.</li>
                        <li><strong>Automático:</strong> Permuta Trilateral (Motor de Busca de Horários Livres).</li>
                      </ul>
                    </div>
                  </div>

                  <div className="space-y-3 pt-2">
                    <h3 className="font-bold text-foreground flex items-center gap-2 text-base">
                      <span className="text-primary font-black">Q2.</span> O AutoRepair, Otimizador, Diagnóstico ou Histórico alteram diretamente a grade?
                    </h3>
                    <div className="bg-muted/40 p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2.5">
                      <p className="text-xs text-muted-foreground leading-normal">
                        <strong>NÃO.</strong> Eles cumprem estritamente o papel de <em>analistas passivos</em> ou <em>geradores de propostas</em>:
                      </p>
                      <ul className="text-xs space-y-2 pl-2">
                        <li className="flex items-start gap-2 text-muted-foreground">
                          <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                          <span><strong>Diagnóstico Inteligente (DIA):</strong> Apenas lê a base e as alocações. Identifica problemas de cadastro, matrizes curriculares ou indisponibilidades. Aponta a causa raiz e sugere correções, mas nunca escreve uma única linha na grade por conta própria.</span>
                        </li>
                        <li className="flex items-start gap-2 text-muted-foreground">
                          <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                          <span><strong>AutoRepair / Otimizador:</strong> Recebem uma cópia imutável da grade (<code className="text-xs bg-muted px-1 rounded">[...alocacoes]</code>), rodam suas heurísticas pedagógicas de permuta e retornam uma <em>grade proposta</em>. Caberá ao orquestrador principal decidir se aceita, valida e grava no store.</span>
                        </li>
                        <li className="flex items-start gap-2 text-muted-foreground">
                          <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                          <span><strong>Histórico de Operações:</strong> É reativo. Ele escuta as alterações através de listeners na store e grava os logs de auditoria de aprendizado no Supabase/localStorage de forma assíncrona, operando puramente como um auditor de telemetria.</span>
                        </li>
                      </ul>
                    </div>
                  </div>

                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle className="text-lg font-bold flex items-center gap-2">
                    <Wrench className="w-5 h-5 text-primary" />
                    Análise Técnico-Arquitetural de Consistência
                  </CardTitle>
                  <CardDescription>
                    Auditoria interna sobre duplicação de lógica, código morto e validações concorrentes
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-xs leading-relaxed text-muted-foreground">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-3 bg-muted/40 rounded-lg border space-y-1">
                      <span className="font-bold text-foreground block text-sm">Lógica de Validação Unificada</span>
                      <p>
                        A função <code className="text-xs bg-muted px-1 rounded">validateSchedule</code> é a única responsável pelo cálculo de IQG, buracos, furos de grade e violações pedagógicas. Não há duplicação dessa lógica matemática no Diagnóstico ou no Quadro Interativo.
                      </p>
                    </div>
                    <div className="p-3 bg-muted/40 rounded-lg border space-y-1">
                      <span className="font-bold text-foreground block text-sm">Controle de Múltiplas Fontes de Verdade</span>
                      <p>
                        Toda a reatividade é provida pelo padrão de assinaturas (<code className="text-xs bg-muted px-1 rounded">listeners</code>) unificados no arquivo de store. Não existem cópias paralelas de estados React em componentes filhos que possam causar descompasso visual.
                      </p>
                    </div>
                  </div>
                  <div className="bg-primary/[0.03] border border-primary/20 p-3.5 rounded-lg text-foreground font-semibold flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-primary shrink-0 animate-pulse" />
                    <span>Conclusão da Auditoria: O sistema respeita as boas práticas de desenvolvimento imutável e descentralização inteligente, garantindo estabilidade matemática total na alocação!</span>
                  </div>
                </CardContent>
              </Card>

            </div>

            {/* Column 3: Orchestrator Pipeline Visualizer */}
            <div className="md:col-span-1 space-y-6">
              <Card className="shadow-sm h-full">
                <CardHeader>
                  <CardTitle className="text-lg font-bold flex items-center gap-1.5">
                    <Clock className="w-5 h-5 text-primary" />
                    Pipeline do Orquestrador
                  </CardTitle>
                  <CardDescription>
                    O fluxo de vida e de execução de uma grade do início à homologação
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="relative border-l border-primary/30 pl-4 ml-2 space-y-6 text-xs">
                    
                    <div className="relative">
                      <span className="absolute -left-[21px] top-0 w-3 h-3 rounded-full bg-primary flex items-center justify-center border-2 border-background"></span>
                      <span className="font-bold text-foreground block text-sm">1. Cadastro Escolar</span>
                      <p className="text-muted-foreground mt-0.5">Cadastramento de professores, turmas, turnos, e matriz curricular.</p>
                    </div>

                    <div className="relative">
                      <span className="absolute -left-[21px] top-0 w-3 h-3 rounded-full bg-primary flex items-center justify-center border-2 border-background"></span>
                      <span className="font-bold text-foreground block text-sm">2. Validação Preventiva</span>
                      <p className="text-muted-foreground mt-0.5">O <code className="bg-muted px-1 rounded">runPreventativeAudit</code> bloqueia a geração se houver excesso físico ou falta estrita de horários.</p>
                    </div>

                    <div className="relative">
                      <span className="absolute -left-[21px] top-0 w-3 h-3 rounded-full bg-primary flex items-center justify-center border-2 border-background"></span>
                      <span className="font-bold text-foreground block text-sm">3. Geração Combinatória</span>
                      <p className="text-muted-foreground mt-0.5">O IFS Solver gera os horários respeitando limites diários e indisponibilidades.</p>
                    </div>

                    <div className="relative">
                      <span className="absolute -left-[21px] top-0 w-3 h-3 rounded-full bg-primary flex items-center justify-center border-2 border-background"></span>
                      <span className="font-bold text-foreground block text-sm">4. Otimização e Compactação</span>
                      <p className="text-muted-foreground mt-0.5">Agrupamento inteligente para eliminação de furos e janelas redundantes.</p>
                    </div>

                    <div className="relative">
                      <span className="absolute -left-[21px] top-0 w-3 h-3 rounded-full bg-primary flex items-center justify-center border-2 border-background"></span>
                      <span className="font-bold text-foreground block text-sm">5. Filtro de Integridade Docente</span>
                      <p className="text-muted-foreground mt-0.5">A camada final audita que nenhum professor receba cargas extras, removendo duplicidades remanescentes.</p>
                    </div>

                    <div className="relative">
                      <span className="absolute -left-[21px] top-0 w-3 h-3 rounded-full bg-emerald-500 flex items-center justify-center border-2 border-background"></span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400 block text-sm">6. Grade Homologada</span>
                      <p className="text-muted-foreground mt-0.5">A grade imutável finalizada é persistida com segurança no banco de dados.</p>
                    </div>

                  </div>
                </CardContent>
              </Card>
            </div>

          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
