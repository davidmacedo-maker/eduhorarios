import { useState, useEffect, useRef } from "react";
import { Bell, CheckCircle, AlertTriangle, UserX, Clock, X } from "lucide-react";
import { useTurmas, useDisciplinas, useProfessores, useAlocacoes } from "@/store/index";
import { detectConflicts, type Conflito } from "@/lib/schedule-utils";
import { useMatrizCurricular } from "@/store/index";
import { Button } from "@/components/ui/button";

const TIPO_CONFIG = {
  professor_duplo: {
    icon: UserX,
    label: "Professor duplo",
    bg: "bg-red-50 dark:bg-red-950",
    border: "border-red-200 dark:border-red-800",
    text: "text-red-700 dark:text-red-300",
    badge: "text-red-600 dark:text-red-400",
  },
  disponibilidade: {
    icon: Clock,
    label: "Disponibilidade",
    bg: "bg-amber-50 dark:bg-amber-950",
    border: "border-amber-200 dark:border-amber-800",
    text: "text-amber-700 dark:text-amber-300",
    badge: "text-amber-600 dark:text-amber-400",
  },
  turma_dupla: {
    icon: AlertTriangle,
    label: "Turma duplicada",
    bg: "bg-red-50 dark:bg-red-950",
    border: "border-red-200 dark:border-red-800",
    text: "text-red-700 dark:text-red-300",
    badge: "text-red-600 dark:text-red-400",
  },
  carga_excedida: {
    icon: AlertTriangle,
    label: "Carga não alocada",
    bg: "bg-orange-50 dark:bg-orange-950",
    border: "border-orange-200 dark:border-orange-800",
    text: "text-orange-700 dark:text-orange-300",
    badge: "text-orange-600 dark:text-orange-400",
  },
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const [turmas] = useTurmas();
  const [disciplinas] = useDisciplinas();
  const [professores] = useProfessores();
  const [alocacoes] = useAlocacoes();
  const [matriz] = useMatrizCurricular();

  const allConflitos = detectConflicts(alocacoes, professores, disciplinas, turmas, matriz);

  const conflitos = allConflitos.filter((c) => !dismissed.has(conflitKey(c)));

  function conflitKey(c: Conflito) {
    return `${c.tipo}::${c.descricao}`;
  }

  function dismiss(c: Conflito) {
    setDismissed((prev) => new Set([...prev, conflitKey(c)]));
  }

  function dismissAll() {
    setDismissed(new Set(allConflitos.map(conflitKey)));
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const count = conflitos.length;
  const hasConflitos = count > 0;

  return (
    <div className="relative">
      <Button
        ref={buttonRef}
        variant="ghost"
        size="icon"
        onClick={() => setOpen((v) => !v)}
        title="Notificações de conflitos"
        className="relative"
        data-testid="button-notifications"
      >
        <Bell className="w-4 h-4" />
        {hasConflitos && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none px-1">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Button>

      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-10 w-80 max-h-[480px] overflow-y-auto rounded-xl border border-border bg-card shadow-xl z-50 flex flex-col"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-card z-10">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-muted-foreground" />
              <span className="font-semibold text-sm">Conflitos de Horário</span>
              {hasConflitos && (
                <span className="text-xs bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-300 font-bold px-1.5 py-0.5 rounded-full">
                  {count}
                </span>
              )}
            </div>
            {hasConflitos && (
              <button
                onClick={dismissAll}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Dispensar todos
              </button>
            )}
          </div>

          <div className="flex flex-col gap-2 p-3">
            {!hasConflitos ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <CheckCircle className="w-10 h-10 text-green-500" />
                <p className="font-medium text-sm text-green-600 dark:text-green-400">
                  Nenhum conflito detectado
                </p>
                <p className="text-xs text-muted-foreground">
                  Todos os horários estão corretos.
                </p>
              </div>
            ) : (
              conflitos.map((c, i) => {
                const cfg = TIPO_CONFIG[c.tipo as keyof typeof TIPO_CONFIG];
                const Icon = cfg.icon;
                return (
                  <div
                    key={i}
                    className={`flex items-start gap-3 rounded-lg border p-3 ${cfg.bg} ${cfg.border}`}
                  >
                    <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${cfg.badge}`} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-[10px] font-semibold uppercase tracking-wide mb-0.5 ${cfg.badge}`}>
                        {cfg.label}
                      </p>
                      <p className={`text-xs leading-snug ${cfg.text}`}>{c.descricao}</p>
                    </div>
                    <button
                      onClick={() => dismiss(c)}
                      className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
                      title="Dispensar"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
