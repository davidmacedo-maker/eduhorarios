import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "motion/react";
import {
  useTurmas,
  useDisciplinas,
  useMatrizCurricular,
  useProfessores,
  useAlocacoes,
  useConfiguracaoHorarios,
  useHistoricoAprendizado,
  useNomeEscola,
  useCodigoEscola,
  storageKey,
  getUserId
} from "@/store";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Trash2,
  ShieldAlert,
  Wrench,
  Database,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Layers,
  Users,
  BookOpen,
  GraduationCap,
  Calendar,
  Sparkles,
  Search
} from "lucide-react";

interface AuditResult {
  valido: boolean;
  professoresComTurmasOrfas: { profId: string; profNome: string; turmasOrfas: string[] }[];
  professoresComDisciplinasOrfas: { profId: string; profNome: string; disciplinasOrfas: string[] }[];
  planejamentosOrfaos: { profId: string; profNome: string; turmaId: string; disciplinaId: string; aulas: number }[];
  matrizesOrfas: { turmaId: string; disciplinaId: string; aulas: number; motivo: string }[];
  alocacoesOrfas: { alocId: string; diaSemana: string; horario: number; turmaId: string; disciplinaId: string; professorId: string; motivo: string }[];
}

export default function Manutencao() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // Load state hooks
  const [turmas, setTurmas] = useTurmas();
  const [disciplinas, setDisciplinas] = useDisciplinas();
  const [professores, setProfessores] = useProfessores();
  const [alocacoes, setAlocacoes] = useAlocacoes();
  const [matriz, setMatriz] = useMatrizCurricular();
  const [config, setConfig] = useConfiguracaoHorarios();
  const [historico, setHistorico] = useHistoricoAprendizado();
  const [nomeEscola, setNomeEscola] = useNomeEscola();
  const [codigoEscola, setCodigoEscola] = useCodigoEscola();

  // Local Undo Memory State
  const [previousData, setPreviousData] = useState<Record<string, any>>({});

  // Modals state
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    moduleId: string;
    title: string;
    message: string;
    requiresTypedPhrase: boolean;
  }>({
    open: false,
    moduleId: "",
    title: "",
    message: "",
    requiresTypedPhrase: false
  });

  const [typedPhrase, setTypedPhrase] = useState("");
  const [audit, setAudit] = useState<AuditResult>({
    valido: true,
    professoresComTurmasOrfas: [],
    professoresComDisciplinasOrfas: [],
    planejamentosOrfaos: [],
    matrizesOrfas: [],
    alocacoesOrfas: []
  });

  // Local prefix for stores
  const storePrefix = (): string => {
    const uid = getUserId();
    return uid === "local" ? "" : `${uid}_`;
  };

  // Integrity Audit scan
  const runIntegrityAudit = useCallback((
    tList = turmas,
    dList = disciplinas,
    pList = professores,
    aList = alocacoes,
    mList = matriz
  ): AuditResult => {
    const tMap = new Map(tList.map(t => [t.id, t]));
    const dMap = new Map(dList.map(d => [d.id, d]));
    const pMap = new Map(pList.map(p => [p.id, p]));

    const professoresComTurmasOrfas: AuditResult["professoresComTurmasOrfas"] = [];
    const professoresComDisciplinasOrfas: AuditResult["professoresComDisciplinasOrfas"] = [];
    const planejamentosOrfaos: AuditResult["planejamentosOrfaos"] = [];
    const matrizesOrfas: AuditResult["matrizesOrfas"] = [];
    const alocacoesOrfas: AuditResult["alocacoesOrfas"] = [];

    // Scan professores
    pList.forEach(p => {
      const turmasOrfas = (p.turmas || []).filter(tid => !tMap.has(tid));
      if (turmasOrfas.length > 0) {
        professoresComTurmasOrfas.push({ profId: p.id, profNome: p.nomeCompleto, turmasOrfas });
      }

      const disciplinasOrfas = (p.disciplinas || []).filter(did => !dMap.has(did));
      if (disciplinasOrfas.length > 0) {
        professoresComDisciplinasOrfas.push({ profId: p.id, profNome: p.nomeCompleto, disciplinasOrfas });
      }

      const plan = p.planejamento || [];
      plan.forEach(item => {
        const hasTurma = tMap.has(item.turmaId);
        const hasDisc = dMap.has(item.disciplinaId);
        if (!hasTurma || !hasDisc) {
          planejamentosOrfaos.push({
            profId: p.id,
            profNome: p.nomeCompleto,
            turmaId: item.turmaId,
            disciplinaId: item.disciplinaId,
            aulas: item.aulasPorSemana || item.quantidadeAulas || 0
          });
        }
      });
    });

    // Scan matriz
    mList.forEach(item => {
      const hasTurma = tMap.has(item.turmaId);
      const hasDisc = dMap.has(item.disciplinaId);
      if (!hasTurma || !hasDisc) {
        let motivo = "";
        if (!hasTurma && !hasDisc) motivo = "Turma e Disciplina inexistentes";
        else if (!hasTurma) motivo = `Turma inexistente (ID: ${item.turmaId})`;
        else motivo = `Disciplina inexistente (ID: ${item.disciplinaId})`;

        matrizesOrfas.push({
          turmaId: item.turmaId,
          disciplinaId: item.disciplinaId,
          aulas: item.aulasPorSemana || 0,
          motivo
        });
      }
    });

    // Scan alocacoes
    aList.forEach(item => {
      const hasTurma = tMap.has(item.turmaId);
      const hasDisc = dMap.has(item.disciplinaId);
      const hasProf = item.professorId ? pMap.has(item.professorId) : true;

      if (!hasTurma || !hasDisc || !hasProf) {
        let motivo = "";
        if (!hasTurma) motivo = "Turma inexistente";
        else if (!hasDisc) motivo = "Disciplina inexistente";
        else motivo = "Professor inexistente";

        alocacoesOrfas.push({
          alocId: item.id,
          diaSemana: item.diaSemana,
          horario: item.horario,
          turmaId: item.turmaId,
          disciplinaId: item.disciplinaId,
          professorId: item.professorId || "",
          motivo
        });
      }
    });

    const valido =
      professoresComTurmasOrfas.length === 0 &&
      professoresComDisciplinasOrfas.length === 0 &&
      planejamentosOrfaos.length === 0 &&
      matrizesOrfas.length === 0 &&
      alocacoesOrfas.length === 0;

    return {
      valido,
      professoresComTurmasOrfas,
      professoresComDisciplinasOrfas,
      planejamentosOrfaos,
      matrizesOrfas,
      alocacoesOrfas
    };
  }, [turmas, disciplinas, professores, alocacoes, matriz]);

  useEffect(() => {
    setAudit(runIntegrityAudit());
  }, [runIntegrityAudit, turmas, disciplinas, professores, alocacoes, matriz]);

  // Repair/Auto-correct Inconsistencies
  const handleAutoRepair = () => {
    const currentAudit = runIntegrityAudit();
    if (currentAudit.valido) {
      toast({
        title: "Base de Dados Consistente",
        description: "Nenhuma inconsistência ou registro órfão foi encontrado para reparo."
      });
      return;
    }

    const tMap = new Map(turmas.map(t => [t.id, t]));
    const dMap = new Map(disciplinas.map(d => [d.id, d]));
    const pMap = new Map(professores.map(p => [p.id, p]));

    // 1. Fix Professores
    const fixedProfs = professores.map(p => {
      const filteredTurmas = (p.turmas || []).filter(tid => tMap.has(tid));
      const filteredDiscs = (p.disciplinas || []).filter(did => dMap.has(did));
      const filteredPlan = (p.planejamento || []).filter(item => tMap.has(item.turmaId) && dMap.has(item.disciplinaId));

      return {
        ...p,
        turmas: filteredTurmas,
        disciplinas: filteredDiscs,
        planejamento: filteredPlan
      };
    });

    // 2. Fix Matriz
    const fixedMatriz = matriz.filter(item => tMap.has(item.turmaId) && dMap.has(item.disciplinaId));

    // 3. Fix Alocacoes
    const fixedAlocs = alocacoes.filter(item => {
      const hasTurma = tMap.has(item.turmaId);
      const hasDisc = dMap.has(item.disciplinaId);
      if (!hasTurma || !hasDisc) return false;
      return true;
    }).map(item => {
      if (item.professorId && !pMap.has(item.professorId)) {
        return { ...item, professorId: "" };
      }
      return item;
    });

    // Save all to store
    setProfessores(fixedProfs);
    setMatriz(fixedMatriz);
    setAlocacoes(fixedAlocs);

    toast({
      title: "Reparo Concluído!",
      description: "Todos os registros órfãos e inconsistências de relacionamento foram reparados com sucesso.",
    });
  };

  // Trigger Confirmation Modal
  const requestCleanup = (
    moduleId: string,
    title: string,
    message: string,
    requiresTypedPhrase = false
  ) => {
    setConfirmModal({
      open: true,
      moduleId,
      title,
      message,
      requiresTypedPhrase
    });
    setTypedPhrase("");
  };

  // Execute actual cleaning logic (WITHOUT automatic safety backup/file download)
  const executeCleanup = () => {
    const { moduleId } = confirmModal;
    setConfirmModal(prev => ({ ...prev, open: false }));

    // Generate local backup for immediate Undo inside the state
    const backup: Record<string, any> = {};
    const prefix = storePrefix();
    
    switch (moduleId) {
      case "professores":
        backup.professores = professores;
        backup.alocacoes = alocacoes;
        break;
      case "turmas":
        backup.turmas = turmas;
        backup.alocacoes = alocacoes;
        backup.matriz = matriz;
        backup.professores = professores;
        break;
      case "disciplinas":
        backup.disciplinas = disciplinas;
        backup.alocacoes = alocacoes;
        backup.matriz = matriz;
        backup.professores = professores;
        break;
      case "matriz":
        backup.matriz = matriz;
        break;
      case "grade":
        backup.alocacoes = alocacoes;
        backup.snapshotsKey = `${prefix}edu_grade_snapshots`;
        backup.archiveKey = `${prefix}edu_grade_snapshots_archive`;
        backup.snapshots = localStorage.getItem(`${prefix}edu_grade_snapshots`);
        backup.archive = localStorage.getItem(`${prefix}edu_grade_snapshots_archive`);
        backup.traces = localStorage.getItem("decision_traces");
        backup.runs = localStorage.getItem("edu_learning_runs");
        break;
      case "experiencia":
        backup.historico = historico;
        backup.experiencias = localStorage.getItem("mbig_banco_experiencias_v3");
        backup.conflitos = localStorage.getItem("mbig_memoria_conflitos_v3");
        backup.padroes = localStorage.getItem("mbig_padroes_manuais_v3");
        backup.hall = localStorage.getItem("mbig_hall_da_fama");
        backup.solucoes = localStorage.getItem("mbig_banco_solucoes_ouro");
        backup.mbea = localStorage.getItem("mbea_banco_solucoes");
        break;
      case "diagnosticos":
        backup.traces = localStorage.getItem("decision_traces");
        backup.runs = localStorage.getItem("edu_learning_runs");
        break;
      case "cache": {
        backup.alocacoes = alocacoes;
        backup.historico = historico;
        const keysToKeep = [
          "edu_theme",
          "eduhorarios_modo_local",
          "edu_escola_nome",
          "edu_escola_codigo",
          "edu_cleanup_backups"
        ];
        const lsBackup: Record<string, string> = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key) continue;
          const isAuth = key.includes("-auth-token") || key.includes("supabase.auth") || key.includes("sb-");
          const isKeep = keysToKeep.some(k => key === k || key === storageKey(k));
          if (!isAuth && !isKeep) {
            lsBackup[key] = localStorage.getItem(key) || "";
          }
        }
        backup.localStorageBackup = lsBackup;
        break;
      }
      case "reset_completo": {
        backup.turmas = turmas;
        backup.disciplinas = disciplinas;
        backup.professores = professores;
        backup.alocacoes = alocacoes;
        backup.matriz = matriz;
        backup.historico = historico;
        backup.nomeEscola = nomeEscola;
        backup.codigoEscola = codigoEscola;
        break;
      }
      default:
        break;
    }

    setPreviousData(prev => ({
      ...prev,
      [moduleId]: backup
    }));

    // Perform actual clearing
    switch (moduleId) {
      case "professores": {
        setProfessores([]);
        const clearedAlocs = alocacoes.map(a => ({ ...a, professorId: "" }));
        setAlocacoes(clearedAlocs);

        toast({
          title: "Professores Limpos!",
          description: "Os cadastros e planejamentos foram removidos. O botão 'Desfazer' está ativo.",
        });
        break;
      }
      case "turmas": {
        setTurmas([]);
        setAlocacoes([]);
        setMatriz([]);
        const updatedProfs = professores.map(p => ({
          ...p,
          turmas: [],
          planejamento: []
        }));
        setProfessores(updatedProfs);

        toast({
          title: "Turmas Limpas!",
          description: "As turmas, matrizes curriculares e suas alocações foram removidas. O botão 'Desfazer' está ativo.",
        });
        break;
      }
      case "disciplinas": {
        setDisciplinas([]);
        setAlocacoes([]);
        setMatriz([]);
        const updatedProfs = professores.map(p => ({
          ...p,
          disciplinas: [],
          planejamento: []
        }));
        setProfessores(updatedProfs);

        toast({
          title: "Disciplinas Limpas!",
          description: "As disciplinas, matrizes e suas alocações correspondentes foram removidas. O botão 'Desfazer' está ativo.",
        });
        break;
      }
      case "matriz": {
        setMatriz([]);
        toast({
          title: "Matriz Curricular Limpa!",
          description: "Toda a configuração de matrizes e carga horária das turmas foi reiniciada. O botão 'Desfazer' está ativo.",
        });
        break;
      }
      case "grade": {
        setAlocacoes([]);
        localStorage.removeItem(`${prefix}edu_grade_snapshots`);
        localStorage.removeItem(`${prefix}edu_grade_snapshots_archive`);
        localStorage.removeItem("decision_traces");
        localStorage.removeItem("edu_learning_runs");

        toast({
          title: "Grade de Horários Limpa!",
          description: "A grade de alocações e histórico de snaps foram limpos. O botão 'Desfazer' está ativo.",
        });
        break;
      }
      case "experiencia": {
        localStorage.removeItem("mbig_banco_experiencias_v3");
        localStorage.removeItem("mbig_memoria_conflitos_v3");
        localStorage.removeItem("mbig_padroes_manuais_v3");
        localStorage.removeItem("mbig_hall_da_fama");
        localStorage.removeItem("mbig_banco_solucoes_ouro");
        localStorage.removeItem("mbea_banco_solucoes");
        setHistorico([]);

        toast({
          title: "Banco de Experiência Limpo!",
          description: "As memórias de conflito, soluções ouro e aprendizado ativo foram reiniciados. O botão 'Desfazer' está ativo.",
        });
        break;
      }
      case "diagnosticos": {
        localStorage.removeItem("decision_traces");
        localStorage.removeItem("edu_learning_runs");
        toast({
          title: "Diagnósticos Limpos!",
          description: "Os relatórios de telemetria foram limpos. O botão 'Desfazer' está ativo.",
        });
        break;
      }
      case "cache": {
        const keysToKeep = [
          "edu_theme",
          "eduhorarios_modo_local",
          "edu_escola_nome",
          "edu_escola_codigo",
          "edu_cleanup_backups"
        ];
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (!key) continue;

          const isAuth = key.includes("-auth-token") || key.includes("supabase.auth") || key.includes("sb-");
          const isKeep = keysToKeep.some(k => key === k || key === storageKey(k));

          if (!isAuth && !isKeep) {
            localStorage.removeItem(key);
          }
        }

        setAlocacoes([]);
        setHistorico([]);

        toast({
          title: "Cache Limpo!",
          description: "Os arquivos temporários e de log foram apagados do navegador. O botão 'Desfazer' está ativo.",
        });
        break;
      }
      case "reset_completo": {
        const keysToKeep = ["eduhorarios_modo_local", "edu_theme", "edu_cleanup_backups"];
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (!key) continue;

          const isAuth = key.includes("-auth-token") || key.includes("supabase.auth") || key.includes("sb-");
          const isKeep = keysToKeep.some(k => key === k);

          if (!isAuth && !isKeep) {
            localStorage.removeItem(key);
          }
        }

        setTurmas([]);
        setDisciplinas([]);
        setProfessores([]);
        setAlocacoes([]);
        setMatriz([]);
        setHistorico([]);
        setNomeEscola("Escola Municipal");
        setCodigoEscola("");

        toast({
          title: "Reset Geral Concluído!",
          description: "Absolutamente todas as tabelas foram reiniciadas no sistema. O botão 'Desfazer' está ativo.",
        });
        break;
      }
      default:
        break;
    }
  };

  // Perform instant Undo of deleted data
  const executeUndo = (moduleId: string) => {
    const data = previousData[moduleId];
    if (!data) {
      toast({
        title: "Nada para desfazer",
        description: "Não há dados salvos para desfazer a exclusão neste momento.",
        variant: "destructive"
      });
      return;
    }

    switch (moduleId) {
      case "professores":
        setProfessores(data.professores);
        setAlocacoes(data.alocacoes);
        break;
      case "turmas":
        setTurmas(data.turmas);
        setAlocacoes(data.alocacoes);
        setMatriz(data.matriz);
        setProfessores(data.professores);
        break;
      case "disciplinas":
        setDisciplinas(data.disciplinas);
        setAlocacoes(data.alocacoes);
        setMatriz(data.matriz);
        setProfessores(data.professores);
        break;
      case "matriz":
        setMatriz(data.matriz);
        break;
      case "grade":
        setAlocacoes(data.alocacoes);
        if (data.snapshots) localStorage.setItem(data.snapshotsKey, data.snapshots);
        if (data.archive) localStorage.setItem(data.archiveKey, data.archive);
        if (data.traces) localStorage.setItem("decision_traces", data.traces);
        if (data.runs) localStorage.setItem("edu_learning_runs", data.runs);
        break;
      case "experiencia":
        setHistorico(data.historico);
        if (data.experiencias) localStorage.setItem("mbig_banco_experiencias_v3", data.experiencias);
        if (data.conflitos) localStorage.setItem("mbig_memoria_conflitos_v3", data.conflitos);
        if (data.padroes) localStorage.setItem("mbig_padroes_manuais_v3", data.padroes);
        if (data.hall) localStorage.setItem("mbig_hall_da_fama", data.hall);
        if (data.solucoes) localStorage.setItem("mbig_banco_solucoes_ouro", data.solucoes);
        if (data.mbea) localStorage.setItem("mbea_banco_solucoes", data.mbea);
        break;
      case "diagnosticos":
        if (data.traces) localStorage.setItem("decision_traces", data.traces);
        if (data.runs) localStorage.setItem("edu_learning_runs", data.runs);
        break;
      case "cache":
        setAlocacoes(data.alocacoes);
        setHistorico(data.historico);
        if (data.localStorageBackup) {
          Object.entries(data.localStorageBackup).forEach(([k, v]) => {
            localStorage.setItem(k, v as string);
          });
        }
        break;
      case "reset_completo":
        setTurmas(data.turmas);
        setDisciplinas(data.disciplinas);
        setProfessores(data.professores);
        setAlocacoes(data.alocacoes);
        setMatriz(data.matriz);
        setHistorico(data.historico);
        setNomeEscola(data.nomeEscola);
        setCodigoEscola(data.codigoEscola);
        break;
      default:
        break;
    }

    // Clear previous data for this module after undoing
    setPreviousData(prev => {
      const copy = { ...prev };
      delete copy[moduleId];
      return copy;
    });

    toast({
      title: "Ação Desfeita!",
      description: "Os dados apagados foram restaurados com sucesso.",
    });
  };

  return (
    <div className="container mx-auto p-6 space-y-8" id="manutencao-container">
      {/* Header section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-5">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs font-mono font-semibold bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20">
              Administração
            </Badge>
          </div>
          <h1 className="text-3xl font-sans font-semibold tracking-tight text-foreground mt-1">
            Manutenção e Limpeza do Sistema
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Painel administrativo para redefinição estrutural do EduHorários, limpeza seletiva de tabelas e auditoria estrutural local.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="gap-2 text-xs"
            onClick={handleAutoRepair}
          >
            <Wrench className="h-3.5 w-3.5 text-amber-500" />
            Corrigir Vínculos Órfãos Locais
          </Button>
        </div>
      </div>

      {/* Alerta de Backup Preventivo */}
      <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-400 text-sm leading-relaxed flex items-start gap-3 shadow-sm">
        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-500 mt-0.5 animate-pulse" />
        <div className="space-y-1">
          <span className="font-bold block text-sm">⚠️ ATENÇÃO: Faça um backup manual antes de qualquer limpeza</span>
          <p className="text-xs opacity-95">
            As ações abaixo removem permanentemente os dados da tabela correspondente. Para maior segurança, 
            <strong> recomendamos fortemente que você realize a exportação de um backup manual na aba Exportar antes de confirmar</strong> qualquer operação.
          </p>
        </div>
      </div>

      {/* Two-column dashboard content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left/Middle Column: Selective Cleaning Panels */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="shadow-sm border-slate-200 dark:border-slate-800">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-sans font-semibold text-foreground flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-red-500" />
                Módulos de Limpeza Seletiva
              </CardTitle>
              <CardDescription>
                Selecione qual tabela do sistema deseja redefinir. Um botão de desfazer estará disponível ao lado de cada campo após a exclusão.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {/* 1. PROFESSORES */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between p-5 gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-900/10 transition-colors">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
                        <GraduationCap className="h-4 w-4" />
                      </div>
                      <h3 className="text-sm font-semibold text-foreground">Professores</h3>
                      <Badge variant="secondary" className="text-[10px] font-mono">
                        {professores.length} registros
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground max-w-md">
                      Apaga os professores, planejamentos, disponibilidades e desvincula as aulas atribuídas a eles na grade.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 self-start sm:self-center">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="gap-1.5 text-xs font-medium"
                      onClick={() => requestCleanup(
                        "professores",
                        "Limpar Professores",
                        "Esta ação apagará todos os professores cadastrados, seus calendários de disponibilidade, suas restrições e planejamentos individuais de aula. As aulas alocadas na grade atual que pertencem a estes professores continuarão na grade, mas passarão a ficar sem professor associado (vagas em aberto).",
                        false
                      )}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Limpar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs font-medium border-slate-200 dark:border-slate-800"
                      disabled={!previousData["professores"]}
                      onClick={() => executeUndo("professores")}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Desfazer
                    </Button>
                  </div>
                </div>

                {/* 2. TURMAS */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between p-5 gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-900/10 transition-colors">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400">
                        <Users className="h-4 w-4" />
                      </div>
                      <h3 className="text-sm font-semibold text-foreground">Turmas</h3>
                      <Badge variant="secondary" className="text-[10px] font-mono">
                        {turmas.length} registros
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground max-w-md">
                      Remove o cadastro das turmas, sua grade de horários, sua matriz curricular associada e referências em professores.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 self-start sm:self-center">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="gap-1.5 text-xs font-medium"
                      onClick={() => requestCleanup(
                        "turmas",
                        "Limpar Turmas",
                        "Esta ação apagará todas as turmas cadastradas, toda a matriz curricular destas turmas e removerá completamente qualquer aula desta turma que esteja alocada na grade atual. Os professores também terão as referências a estas turmas apagadas de seus cadastros e planejamentos.",
                        false
                      )}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Limpar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs font-medium border-slate-200 dark:border-slate-800"
                      disabled={!previousData["turmas"]}
                      onClick={() => executeUndo("turmas")}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Desfazer
                    </Button>
                  </div>
                </div>

                {/* 3. DISCIPLINAS */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between p-5 gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-900/10 transition-colors">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded bg-green-500/10 text-green-600 dark:text-green-400">
                        <BookOpen className="h-4 w-4" />
                      </div>
                      <h3 className="text-sm font-semibold text-foreground">Disciplinas</h3>
                      <Badge variant="secondary" className="text-[10px] font-mono">
                        {disciplinas.length} registros
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground max-w-md">
                      Remove as disciplinas cadastradas, limpando as relações correspondentes na matriz, no planejamento e na grade de horários.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 self-start sm:self-center">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="gap-1.5 text-xs font-medium"
                      onClick={() => requestCleanup(
                        "disciplinas",
                        "Limpar Disciplinas",
                        "Esta ação removerá todas as disciplinas, apagando-as também da matriz das turmas e removendo qualquer aula alocada na grade atual pertencente a estas disciplinas. Professores perderão as habilitações e planejamentos destas disciplinas.",
                        false
                      )}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Limpar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs font-medium border-slate-200 dark:border-slate-800"
                      disabled={!previousData["disciplinas"]}
                      onClick={() => executeUndo("disciplinas")}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Desfazer
                    </Button>
                  </div>
                </div>

                {/* 4. MATRIZ CURRICULAR */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between p-5 gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-900/10 transition-colors">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400">
                        <Layers className="h-4 w-4" />
                      </div>
                      <h3 className="text-sm font-semibold text-foreground">Matriz Curricular</h3>
                      <Badge variant="secondary" className="text-[10px] font-mono">
                        {matriz.length} itens
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground max-w-md">
                      Reseta a carga horária semanal definida por turma e por disciplina. Mantém turmas e disciplinas cadastradas.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 self-start sm:self-center">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="gap-1.5 text-xs font-medium"
                      onClick={() => requestCleanup(
                        "matriz",
                        "Limpar Matriz Curricular",
                        "Esta ação limpará toda a carga horária de aulas planejadas por turma e disciplina. As turmas e disciplinas continuarão cadastradas, mas suas matrizes de planejamento serão redefinidas para zero.",
                        false
                      )}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Limpar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs font-medium border-slate-200 dark:border-slate-800"
                      disabled={!previousData["matriz"]}
                      onClick={() => executeUndo("matriz")}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Desfazer
                    </Button>
                  </div>
                </div>

                {/* 5. GRADE DE HORARIOS */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between p-5 gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-900/10 transition-colors">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                        <Calendar className="h-4 w-4" />
                      </div>
                      <h3 className="text-sm font-semibold text-foreground">Grade de Horários (Alocações)</h3>
                      <Badge variant="secondary" className="text-[10px] font-mono">
                        {alocacoes.length} aulas alocadas
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground max-w-md">
                      Redefine a grade atual de aulas. Apaga o histórico de backups internos da grade e os logs de decisões do motor.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 self-start sm:self-center">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="gap-1.5 text-xs font-medium"
                      onClick={() => requestCleanup(
                        "grade",
                        "Limpar Grade de Horários",
                        "Esta ação removerá permanentemente todas as alocações da grade atual, deixando o calendário de aulas vazio. Também serão excluídos os snapshots internos salvos no histórico da grade e os logs das últimas decisões de alocação do motor de inteligência.",
                        false
                      )}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Limpar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs font-medium border-slate-200 dark:border-slate-800"
                      disabled={!previousData["grade"]}
                      onClick={() => executeUndo("grade")}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Desfazer
                    </Button>
                  </div>
                </div>

                {/* 6. BANCO DE EXPERIENCIA */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between p-5 gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-900/10 transition-colors">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded bg-pink-500/10 text-pink-600 dark:text-pink-400">
                        <Sparkles className="h-4 w-4" />
                      </div>
                      <h3 className="text-sm font-semibold text-foreground">Banco de Experiência (Aprendizado)</h3>
                      <Badge variant="secondary" className="text-[10px] font-mono">
                        AI Memory
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground max-w-md">
                      Apaga a memória de aprendizado ativo do motor (soluções ouro, padrões recorrentes, e histórico de tentativas).
                    </p>
                  </div>
                  <div className="flex items-center gap-2 self-start sm:self-center">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="gap-1.5 text-xs font-medium"
                      onClick={() => requestCleanup(
                        "experiencia",
                        "Limpar Banco de Experiência",
                        "Esta ação limpará toda a base de aprendizado acumulado do motor matemático inteligente (padrões de ajustes de conflitos, soluções de ouro salvas e hall da fama de grades). O motor voltará ao comportamento de alocação básico padrão.",
                        false
                      )}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Limpar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs font-medium border-slate-200 dark:border-slate-800"
                      disabled={!previousData["experiencia"]}
                      onClick={() => executeUndo("experiencia")}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Desfazer
                    </Button>
                  </div>
                </div>

                {/* 7. DIAGNOSTICOS */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between p-5 gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-900/10 transition-colors">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded bg-orange-500/10 text-orange-600 dark:text-orange-400">
                        <Search className="h-4 w-4" />
                      </div>
                      <h3 className="text-sm font-semibold text-foreground">Diagnósticos e Relatórios</h3>
                      <Badge variant="secondary" className="text-[10px] font-mono">
                        Telemetria
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground max-w-md">
                      Limpa os logs, relatórios, indicadores e cache de telemetria gerados durante as auditorias preventivas.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 self-start sm:self-center">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="gap-1.5 text-xs font-medium"
                      onClick={() => requestCleanup(
                        "diagnosticos",
                        "Limpar Diagnósticos",
                        "Esta ação limpará o cache local dos relatórios de auditorias anteriores, diagnósticos de incompatibilidade e logs de telemetria.",
                        false
                      )}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Limpar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs font-medium border-slate-200 dark:border-slate-800"
                      disabled={!previousData["diagnosticos"]}
                      onClick={() => executeUndo("diagnosticos")}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Desfazer
                    </Button>
                  </div>
                </div>

                {/* 8. CACHE */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between p-5 gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-900/10 transition-colors">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded bg-slate-500/10 text-slate-600 dark:text-slate-400">
                        <Database className="h-4 w-4" />
                      </div>
                      <h3 className="text-sm font-semibold text-foreground">Limpar Cache</h3>
                      <Badge variant="secondary" className="text-[10px] font-mono">
                        Navegador
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground max-w-md">
                      Apaga chaves temporárias, snapshots auxiliares e preferências visuais. Preserva sessões de login e a estrutura da escola.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 self-start sm:self-center">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="gap-1.5 text-xs font-medium"
                      onClick={() => requestCleanup(
                        "cache",
                        "Limpar Cache Geral",
                        "Esta ação limpará arquivos de log e dados temporários do navegador relativos ao aplicativo, mas preservará o seu cadastro de turmas, professores, disciplinas e o seu login ativo.",
                        false
                      )}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Limpar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs font-medium border-slate-200 dark:border-slate-800"
                      disabled={!previousData["cache"]}
                      onClick={() => executeUndo("cache")}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Desfazer
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Reset Geral */}
          <Card className="border-red-200 dark:border-red-900/40 bg-red-50/10 dark:bg-red-950/5 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-red-600 dark:text-red-400 animate-pulse" />
                <CardTitle className="text-lg font-sans font-semibold text-red-600 dark:text-red-400">
                  Reset Geral (Redefinir Sistema Completo)
                </CardTitle>
              </div>
              <CardDescription className="text-red-700/80 dark:text-red-300/80">
                Ação altamente crítica. Apaga todos os cadastros e dados, redefinindo o EduHorários para a configuração padrão de fábrica.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-red-800/80 dark:text-red-300/70 max-w-xl leading-relaxed">
                Esta ação apagará absolutamente todos os registros de turmas, professores, disciplinas, alocações de horários, logs de aprendizado, nome da escola e registros de ponto. Requer a confirmação por escrito da frase de segurança para ser executada.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="destructive"
                  className="bg-red-600 hover:bg-red-700 dark:bg-red-800 dark:hover:bg-red-900 gap-2 text-xs font-semibold"
                  onClick={() => requestCleanup(
                    "reset_completo",
                    "RESET GERAL - APAGAR TODOS OS CADASTROS",
                    "Esta ação apagará de forma irreversível todos os dados inseridos, incluindo cadastros de turmas, professores, disciplinas, alocações, configurações de horários e históricos de ponto. O sistema retornará ao estado de uma escola recém-criada. Para confirmar, digite exatamente a frase de segurança abaixo.",
                    true
                  )}
                >
                  <ShieldAlert className="h-4 w-4" />
                  Apagar Todos os Cadastros (Reset Geral)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs font-semibold border-red-200 hover:bg-red-100/50"
                  disabled={!previousData["reset_completo"]}
                  onClick={() => executeUndo("reset_completo")}
                >
                  <RotateCcw className="h-3.5 w-3.5 text-red-600" />
                  Desfazer Reset
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Local Integrity Audit Scan Card */}
        <div className="space-y-6">
          <Card className="shadow-sm">
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base font-sans font-semibold text-foreground flex items-center justify-between">
                <span>Auditoria de Integridade</span>
                {audit.valido ? (
                  <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white font-mono gap-1 text-[10px] py-0.5">
                    <CheckCircle2 className="h-3 w-3" /> Integra
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="font-mono gap-1 text-[10px] py-0.5 animate-pulse">
                    <AlertTriangle className="h-3 w-3" /> Inconsistente
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Varredura estrutural da base de dados pós-limpeza para evitar registros órfãos ou inconsistências de integridade.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              {audit.valido ? (
                <div className="flex flex-col items-center justify-center py-6 text-center space-y-3">
                  <div className="h-12 w-12 rounded-full bg-emerald-100 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">100% Livre de Órfãos</h4>
                    <p className="text-xs text-muted-foreground mt-1 px-4">
                      Todas as chaves estrangeiras, turmas, professores e vínculos estão perfeitamente consistentes na base. Pronto para uso!
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-3 bg-amber-500/10 text-amber-800 dark:text-amber-400 rounded-lg flex gap-2.5 items-start">
                    <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <h4 className="text-xs font-bold">Inconsistências Identificadas</h4>
                      <p className="text-[11px] leading-relaxed opacity-90">
                        Foram detectados vínculos quebrados que podem causar travamentos ou comportamentos anômalos nas grades. Use o reparador automático para corrigi-los.
                      </p>
                    </div>
                  </div>

                  {/* Audit details breakdown */}
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {audit.professoresComTurmasOrfas.map((p, idx) => (
                      <div key={idx} className="p-2 border rounded text-xs bg-slate-50 dark:bg-slate-900/40">
                        <p className="font-semibold text-foreground truncate">{p.profNome}</p>
                        <p className="text-[10px] text-red-500 font-mono mt-0.5">
                          ⚠️ Turma(s) órfã(s): {p.turmasOrfas.join(", ")}
                        </p>
                      </div>
                    ))}

                    {audit.professoresComDisciplinasOrfas.map((p, idx) => (
                      <div key={idx} className="p-2 border rounded text-xs bg-slate-50 dark:bg-slate-900/40">
                        <p className="font-semibold text-foreground truncate">{p.profNome}</p>
                        <p className="text-[10px] text-red-500 font-mono mt-0.5">
                          ⚠️ Disc(s) órfã(s): {p.disciplinasOrfas.join(", ")}
                        </p>
                      </div>
                    ))}

                    {audit.planejamentosOrfaos.map((pl, idx) => (
                      <div key={idx} className="p-2 border rounded text-xs bg-slate-50 dark:bg-slate-900/40">
                        <p className="font-semibold text-foreground truncate">{pl.profNome}</p>
                        <p className="text-[10px] text-amber-600 font-mono mt-0.5">
                          ⚠️ Planejamento órfão: Turma {pl.turmaId} · Disc {pl.disciplinaId} ({pl.aulas} aulas)
                        </p>
                      </div>
                    ))}

                    {audit.matrizesOrfas.map((m, idx) => (
                      <div key={idx} className="p-2 border rounded text-xs bg-slate-50 dark:bg-slate-900/40">
                        <p className="font-semibold text-amber-700 dark:text-amber-400">Matriz Curricular</p>
                        <p className="text-[10px] text-red-500 font-mono mt-0.5">
                          ⚠️ {m.motivo} ({m.aulas} aulas/sem)
                        </p>
                      </div>
                    ))}

                    {audit.alocacoesOrfas.map((al, idx) => (
                      <div key={idx} className="p-2 border rounded text-xs bg-slate-50 dark:bg-slate-900/40">
                        <p className="font-semibold text-slate-700 dark:text-slate-350">Aula Alocada (Grade)</p>
                        <p className="text-[10px] text-red-500 font-mono mt-0.5">
                          ⚠️ {al.diaSemana.toUpperCase()} {al.horario}º · {al.motivo} (ID: {al.alocId.slice(0,6)})
                        </p>
                      </div>
                    ))}
                  </div>

                  <Button
                    variant="outline"
                    className="w-full gap-2 text-xs font-semibold hover:bg-slate-100"
                    onClick={handleAutoRepair}
                  >
                    <Wrench className="h-3.5 w-3.5 text-amber-500" />
                    Auto-Corrigir e Reparar Base
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {confirmModal.open && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="bg-background border border-slate-200 dark:border-slate-800 rounded-xl max-w-lg w-full shadow-2xl overflow-hidden"
              id="confirm-modal-box"
            >
              <div className="p-6 space-y-4">
                <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                  <AlertTriangle className="h-6 w-6" />
                  <h3 className="text-lg font-sans font-semibold">
                    {confirmModal.title}
                  </h3>
                </div>

                <p className="text-sm text-muted-foreground leading-relaxed">
                  {confirmModal.message}
                </p>

                <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-400 rounded-lg text-xs leading-relaxed font-medium">
                  ⚠️ ATENÇÃO: Esta operação é altamente crítica e limpará seus dados. 
                  Certifique-se de que realmente deseja prosseguir e faça um backup de segurança manual antes se houver dados importantes.
                </div>

                {confirmModal.requiresTypedPhrase && (
                  <div className="space-y-2 pt-2 border-t">
                    <label className="text-xs font-bold text-foreground">
                      Para confirmar, digite exatamente a frase abaixo:
                    </label>
                    <div className="p-2 bg-slate-100 dark:bg-slate-900 text-center font-mono text-sm font-semibold text-red-500 tracking-wide border rounded select-all">
                      APAGAR TODOS OS DADOS
                    </div>
                    <input
                      type="text"
                      className="w-full p-2 border rounded font-sans text-sm focus:ring-1 focus:ring-red-500 bg-background"
                      placeholder="Digite a frase de segurança aqui"
                      value={typedPhrase}
                      onChange={(e) => setTypedPhrase(e.target.value)}
                    />
                  </div>
                )}
              </div>

              <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/40 border-t flex items-center justify-end gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs font-semibold"
                  onClick={() => setConfirmModal(prev => ({ ...prev, open: false }))}
                >
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="text-xs font-semibold bg-red-600 hover:bg-red-700"
                  disabled={confirmModal.requiresTypedPhrase && typedPhrase !== "APAGAR TODOS OS DADOS"}
                  onClick={executeCleanup}
                >
                  Confirmar Exclusão
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
