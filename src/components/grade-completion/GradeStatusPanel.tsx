import React from "react";
import { useRemainingLessons, type PendingLessonItem } from "./hooks";

interface GradeStatusPanelProps {
  onSelectSubject: (item: PendingLessonItem | null) => void;
  selectedSubject: PendingLessonItem | null;
}

export function GradeStatusPanel({ onSelectSubject, selectedSubject }: GradeStatusPanelProps) {
  const pending = useRemainingLessons();

  // Show only pending subjects (restante > 0)
  const pendingOnly = pending.filter((p) => p.restante > 0);

  if (pendingOnly.length === 0) {
    return null;
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-sm no-print space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-black uppercase tracking-wider text-muted-foreground">
          Carga Horária Restante por Disciplina
        </h3>
        <p className="text-[11px] text-muted-foreground font-medium">
          Clique em uma disciplina para filtrar possíveis slots na grade
        </p>
      </div>

      <div className="flex items-center gap-3 overflow-x-auto pb-1 scrollbar-thin">
        {pendingOnly.slice(0, 10).map((item) => {
          const isSelected = selectedSubject?.id === item.id;
          
          // Compute visual progress string like ████░░░░
          const total = item.planejado;
          const done = item.alocado;
          const blocksCount = Math.max(0, done);
          const dotsCount = Math.max(0, item.restante);
          const blocksStr = "█".repeat(blocksCount);
          const dotsStr = "░".repeat(dotsCount);

          return (
            <button
              key={item.id}
              onClick={() => onSelectSubject(isSelected ? null : item)}
              className={`flex-shrink-0 p-2 rounded-lg border transition-all text-left flex flex-col justify-between min-w-[140px] ${
                isSelected
                  ? "border-primary bg-primary/5 text-primary shadow-sm"
                  : "border-border hover:border-border-80 bg-background/50 hover:bg-background"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold truncate max-w-[90px]" style={{ color: item.disciplina.cor }}>
                  {item.disciplina.nome}
                </span>
                <span className="text-[10px] font-black font-mono">
                  {item.restante}
                </span>
              </div>

              <div className="text-[10px] font-mono leading-none tracking-tight text-slate-400 mt-1 flex items-center justify-between">
                <span className="truncate max-w-[80px]">{blocksStr}{dotsStr}</span>
                <span className="text-[9px] text-muted-foreground/80 font-bold ml-1">
                  {done}/{total}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
