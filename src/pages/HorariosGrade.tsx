import { useMemo, useState } from "react";
import { useTurmas, useProfessores, useDisciplinas, useAlocacoes, useConfiguracaoHorarios } from "@/store";
import { generateTimeSlotsForTurno, detectConflicts } from "@/lib/schedule-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, CheckCircle2, Sun, Sunset, Moon, CalendarDays, XCircle } from "lucide-react";
import { Link } from "wouter";
import type { Alocacao, Turma } from "@/types";

const DIAS = ["segunda", "terca", "quarta", "quinta", "sexta"] as const;
type Dia = typeof DIAS[number];

const DIA_LABELS: Record<Dia, string> = {
  segunda: "Segunda-feira",
  terca: "Terça-feira",
  quarta: "Quarta-feira",
  quinta: "Quinta-feira",
  sexta: "Sexta-feira",
};

const DIA_SHORT: Record<Dia, string> = {
  segunda: "Seg", terca: "Ter", quarta: "Qua", quinta: "Qui", sexta: "Sex",
};

type CellStatus = "empty" | "ok" | "conflict" | "blocked";

export default function HorariosGrade() {
  const [turmas]      = useTurmas();
  const [professores] = useProfessores();
  const [disciplinas] = useDisciplinas();
  const [alocacoes]   = useAlocacoes();
  const [config]      = useConfiguracaoHorarios();

  const [diaSelecionado, setDiaSelecionado] = useState<Dia | "todos">("todos");
  const [conflitoDismissed, setConflitoDismissed] = useState(false);
  const [expandConflicts, setExpandConflicts] = useState(false);

  const turmaMap = useMemo(() => new Map(turmas.map((t) => [t.id, t])), [turmas]);
  const discMap  = useMemo(() => new Map(disciplinas.map((d) => [d.id, d])), [disciplinas]);
  const profMap  = useMemo(() => new Map(professores.map((p) => [p.id, p])), [professores]);
  const matriz = useMemo(() => [] as never[], []);

  const conflitos = useMemo(
    () => detectConflicts(alocacoes, professores, disciplinas, turmas, matriz),
    [alocacoes, professores, disciplinas, turmas, matriz]
  );

  const manhaSlots = useMemo(() => generateTimeSlotsForTurno(config, "manha"), [config]);
  const tardeSlots = useMemo(
    () => (config.habilitarTarde ? generateTimeSlotsForTurno(config, "tarde") : []),
    [config]
  );
  const noiteSlots = useMemo(
    () => (config.habilitarNoite ? generateTimeSlotsForTurno(config, "noite") : []),
    [config]
  );

  const manhaTurmas = useMemo(
    () => [...turmas].filter((t) => !t.turno || t.turno === "manha").sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [turmas]
  );
  const tardeTurmas = useMemo(
    () => [...turmas].filter((t) => t.turno === "tarde").sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [turmas]
  );
  const noiteTurmas = useMemo(
    () => [...turmas].filter((t) => t.turno === "noite").sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [turmas]
  );

  const hasTarde = config.habilitarTarde && tardeTurmas.length > 0;
  const hasNoite = config.habilitarNoite && noiteTurmas.length > 0;

  const diasToShow: Dia[] = diaSelecionado === "todos" ? [...DIAS] : [diaSelecionado];

  // ── Cell logic ─────────────────────────────────────────────────────────────
  function getAlocacoesForCell(turmaId: string, dia: Dia, horario: number): Alocacao[] {
    return alocacoes.filter(
      (a) => a.turmaId === turmaId && a.diaSemana === dia && a.horario === horario
    );
  }

  function getCellStatus(turmaId: string, dia: Dia, horario: number): CellStatus {
    const cellAlocs = getAlocacoesForCell(turmaId, dia, horario);
    if (cellAlocs.length === 0) return "empty";

    const hasConflict = conflitos.some(
      (c) =>
        c.dia === dia &&
        c.horario === horario &&
        (c.turmaId === turmaId || cellAlocs.some((a) => a.professorId === c.professorId))
    );

    return hasConflict ? "conflict" : "ok";
  }

  function cellBg(status: CellStatus): string {
    switch (status) {
      case "ok":       return "bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800";
      case "conflict": return "bg-red-50 dark:bg-red-950/50 border border-red-300 dark:border-red-700";
      case "blocked":  return "bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700";
      default:         return "bg-muted/20 border border-transparent";
    }
  }

  // ── Grid section (per shift) ───────────────────────────────────────────────
  function ShiftSection({
    turno,
    turmaList,
    slots,
    dia,
  }: {
    turno: "manha" | "tarde" | "noite";
    turmaList: Turma[];
    slots: ReturnType<typeof generateTimeSlotsForTurno>;
    dia: Dia;
  }) {
    const isManha = turno === "manha";
    const isNoite = turno === "noite";
    const periods = slots.filter((s) => !s.isBreak);
    const breakSlot = slots.find((s) => s.isBreak);
    const breakAfter = isNoite
      ? (config.possuiIntervaloNoite ? config.horarioIntervaloNoite : null)
      : isManha
        ? (config.possuiIntervalo ? config.horarioIntervalo : null)
        : (config.possuiIntervaloTarde ? config.horarioIntervaloTarde : null);

    if (turmaList.length === 0) return null;

    const borderColor = isNoite
      ? "border-purple-200 dark:border-purple-900"
      : "border-blue-200 dark:border-blue-900";
    const headerBg = isNoite
      ? "bg-purple-700 text-white"
      : "bg-blue-600 text-white";
    const rowBg = isNoite
      ? "bg-purple-50 dark:bg-purple-950/40"
      : "bg-blue-50 dark:bg-blue-950/40";
    const periodColor = isNoite
      ? "text-purple-600 dark:text-purple-400"
      : "text-blue-600 dark:text-blue-400";

    return (
      <div className={`rounded-lg overflow-hidden border ${borderColor}`}>
        {/* Shift header */}
        <div className={`flex items-center gap-2 px-4 py-2 ${headerBg}`}>
          {isNoite ? <Moon className="w-4 h-4" /> : isManha ? <Sun className="w-4 h-4" /> : <Sunset className="w-4 h-4" />}
          <span className="font-bold text-sm uppercase tracking-wide">
            {isNoite ? "Noturno" : isManha ? "Matutino" : "Vespertino"}
          </span>
          <span className="ml-auto text-xs opacity-80">
            {slots.filter((s) => !s.isBreak).at(0)?.start} – {slots.filter((s) => !s.isBreak).at(-1)?.end}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs min-w-[400px]">
            <thead>
              <tr className={rowBg}>
                <th className="text-left px-3 py-2 font-semibold text-muted-foreground border-b border-border w-28">
                  Horário
                </th>
                {turmaList.map((t) => (
                  <th key={t.id} className="text-center px-2 py-2 font-semibold text-muted-foreground border-b border-border">
                    {t.nome}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.map((slot, idx) => {
                const showBreak = breakAfter !== null && idx > 0 && periods[idx - 1].period === breakAfter;
                return (
                  <tr key={`${turno}-${dia}-${slot.period}`} className={`border-b border-border/40 hover:bg-muted/10 transition-colors${showBreak && breakSlot ? " border-t-2 border-t-amber-200 dark:border-t-amber-800" : ""}`}>
                      <td className="px-3 py-2 border-r border-border/30 whitespace-nowrap">
                        {showBreak && breakSlot && (
                          <p className="text-[9px] text-amber-600 dark:text-amber-400 italic mb-0.5">
                            ☕ Intervalo {breakSlot.start}–{breakSlot.end}
                          </p>
                        )}
                        <p className={`font-bold text-[11px] ${periodColor}`}>
                          {slot.period}º Horário
                        </p>
                        <p className="font-mono text-[10px] text-muted-foreground">{slot.start} – {slot.end}</p>
                      </td>
                      {turmaList.map((turma) => {
                        const cellAlocs = getAlocacoesForCell(turma.id, dia, slot.period);
                        const status = getCellStatus(turma.id, dia, slot.period);

                        return (
                          <td key={turma.id} className="px-1.5 py-1.5 border-r border-border/20 last:border-r-0">
                            {cellAlocs.length === 0 ? (
                              <div className="h-12 rounded flex items-center justify-center text-muted-foreground/30 text-[10px] bg-muted/10">
                                —
                              </div>
                            ) : (
                              cellAlocs.map((aloc) => {
                                const disc = discMap.get(aloc.disciplinaId);
                                const prof = profMap.get(aloc.professorId);
                                return (
                                  <div
                                    key={aloc.id}
                                    className={`rounded px-2 py-1.5 ${cellBg(status)} relative`}
                                    title={
                                      status === "conflict"
                                        ? conflitos.find((c) => c.dia === dia && c.horario === slot.period && (c.turmaId === turma.id || aloc.professorId === c.professorId))?.descricao
                                        : undefined
                                    }
                                  >
                                    {status === "conflict" && (
                                      <AlertTriangle className="w-2.5 h-2.5 text-red-500 absolute top-1 right-1" />
                                    )}
                                    {status === "ok" && (
                                      <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500 absolute top-1 right-1 opacity-60" />
                                    )}
                                    <p
                                      className="font-bold text-[11px] leading-tight"
                                      style={{ color: disc?.cor ?? "currentColor" }}
                                    >
                                      {disc?.abreviacao ?? "?"}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground leading-tight truncate">
                                      {prof?.nomeCompleto.split(" ")[0] ?? "?"}
                                    </p>
                                    <p className="text-[9px] text-muted-foreground/60 leading-tight truncate">
                                      {turma.nome}
                                    </p>
                                  </div>
                                );
                              })
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

  const conflitosCount = conflitos.length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <CalendarDays className="w-6 h-6 text-primary" />
            Horários
          </h1>
          <p className="text-muted-foreground mt-1">
            Grade semanal completa — matutino, vespertino e noturno
          </p>
        </div>
        <div className="flex items-center gap-2">
          {conflitosCount > 0 && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="w-3 h-3" />
              {conflitosCount} conflito{conflitosCount > 1 ? "s" : ""}
            </Badge>
          )}
          {conflitosCount === 0 && (
            <Badge variant="outline" className="gap-1 border-emerald-300 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="w-3 h-3" />
              Sem conflitos
            </Badge>
          )}
        </div>
      </div>

      {/* Conflict panel */}
      {conflitosCount > 0 && !conflitoDismissed && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-red-700 dark:text-red-300 font-semibold text-sm">
              <AlertTriangle className="w-4 h-4" />
              {conflitosCount} conflito{conflitosCount > 1 ? "s" : ""} detectado{conflitosCount > 1 ? "s" : ""}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900"
                onClick={() => setExpandConflicts((v) => !v)}
              >
                {expandConflicts ? "Ocultar" : "Ver todos"}
              </Button>
              <button
                onClick={() => setConflitoDismissed(true)}
                className="text-red-400 hover:text-red-600 transition-colors"
                aria-label="Fechar"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </div>
          </div>
          <ul className="space-y-1">
            {(expandConflicts ? conflitos : conflitos.slice(0, 3)).map((c, i) => (
              <li key={i} className="text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
                <span className="mt-0.5 shrink-0">•</span>
                <span>{c.descricao}</span>
              </li>
            ))}
            {!expandConflicts && conflitosCount > 3 && (
              <li className="text-xs text-red-500 dark:text-red-400 mt-1">
                + {conflitosCount - 3} outros conflitos
                <button
                  className="ml-1 underline"
                  onClick={() => setExpandConflicts(true)}
                >
                  Ver todos
                </button>
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/50 dark:border-emerald-800 inline-block" />
          <CheckCircle2 className="w-3 h-3 text-emerald-500" />
          Disponível / OK
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded border border-red-300 bg-red-50 dark:bg-red-950/50 dark:border-red-700 inline-block" />
          <AlertTriangle className="w-3 h-3 text-red-500" />
          Conflito detectado
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded border border-gray-200 bg-muted/10 dark:border-gray-700 inline-block" />
          Vazio
        </div>
      </div>

      {/* Day tabs */}
      <Tabs value={diaSelecionado} onValueChange={(v) => setDiaSelecionado(v as typeof diaSelecionado)}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="todos" className="text-xs">Toda a Semana</TabsTrigger>
          {DIAS.map((d) => (
            <TabsTrigger key={d} value={d} className="text-xs">
              {DIA_SHORT[d]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Days */}
      {diasToShow.map((dia) => (
        <div key={dia} className="space-y-3">
          {/* Day label (only shown when "Toda a Semana") */}
          {diaSelecionado === "todos" && (
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <h2 className="text-sm font-bold text-foreground uppercase tracking-widest">
                {DIA_LABELS[dia]}
              </h2>
              <div className="h-px flex-1 bg-border" />
            </div>
          )}
          {diaSelecionado !== "todos" && (
            <h2 className="text-lg font-bold text-foreground">{DIA_LABELS[dia]}</h2>
          )}

          {/* MATUTINO */}
          <ShiftSection
            turno="manha"
            turmaList={manhaTurmas}
            slots={manhaSlots}
            dia={dia}
          />

          {/* VESPERTINO */}
          {hasTarde && (
            <ShiftSection
              turno="tarde"
              turmaList={tardeTurmas}
              slots={tardeSlots}
              dia={dia}
            />
          )}

          {!hasTarde && tardeTurmas.length > 0 && (
            <div className="rounded-lg border border-dashed border-blue-200 dark:border-blue-900 p-4 text-center text-sm text-muted-foreground">
              <Sunset className="w-5 h-5 mx-auto mb-1 text-blue-400" />
              Turno vespertino desactivado.{" "}
              <Link href="/horarios">
                <span className="text-primary underline cursor-pointer">Activar em Configuração de Horários</span>
              </Link>
            </div>
          )}

          {/* NOTURNO */}
          {hasNoite && (
            <ShiftSection
              turno="noite"
              turmaList={noiteTurmas}
              slots={noiteSlots}
              dia={dia}
            />
          )}

          {!hasNoite && noiteTurmas.length > 0 && (
            <div className="rounded-lg border border-dashed border-purple-200 dark:border-purple-900 p-4 text-center text-sm text-muted-foreground">
              <Moon className="w-5 h-5 mx-auto mb-1 text-purple-400" />
              Turno noturno desactivado.{" "}
              <Link href="/horarios">
                <span className="text-primary underline cursor-pointer">Activar em Configuração de Horários</span>
              </Link>
            </div>
          )}
        </div>
      ))}

      {turmas.length === 0 && (
        <div className="rounded-lg border border-dashed py-20 text-center text-muted-foreground">
          <CalendarDays className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="font-medium">Nenhuma turma cadastrada</p>
          <p className="text-sm mt-1">
            <Link href="/turmas">
              <span className="text-primary underline cursor-pointer">Cadastre turmas</span>
            </Link>{" "}
            para ver a grade de horários.
          </p>
        </div>
      )}
    </div>
  );
}
