import { useEffect, useState } from "react";
import { Menu, Sun, Moon, Database, LogOut, User, ShieldAlert, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";
import { NotificationBell } from "./NotificationBell";
import { useLocation } from "wouter";
import { storageKey } from "@/store";
import { AuthService, UserProfile } from "@/services/AuthService";
import { useRealtimeStatus } from "@/lib/realtimeSync";

interface NavbarProps {
  onMenuClick: () => void;
}

function useSaveIndicator() {
  const [lastSaved, setLastSaved] = useState<Date | null>(() => {
    const raw = localStorage.getItem(storageKey("edu_last_saved"));
    return raw ? new Date(raw) : null;
  });

  useEffect(() => {
    const id = setInterval(() => {
      const raw = localStorage.getItem(storageKey("edu_last_saved"));
      if (raw) setLastSaved(new Date(raw));
    }, 3000);
    return () => clearInterval(id);
  }, []);

  function formatTime(d: Date) {
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  return lastSaved ? `Sincronizado às ${formatTime(lastSaved)}` : "Sincronizado";
}

export function Navbar({ onMenuClick }: NavbarProps) {
  const { theme, toggleTheme } = useTheme();
  const saveLabel = useSaveIndicator();
  const realtimeStatus = useRealtimeStatus();
  const [, setLocation] = useLocation();
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    AuthService.getCurrentProfile().then(profile => {
      setCurrentUser(profile);
    });
    AuthService.isSuperAdmin().then(setIsSuperAdmin);
  }, []);

  async function handleLogout() {
    await AuthService.logout();
    setLocation("/login");
  }

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      const raw = localStorage.getItem(storageKey("edu_last_saved"));
      if (!raw) return;
      const diff = Date.now() - new Date(raw).getTime();
      if (diff < 5000) return;
      e.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  return (
    <header
      data-print-hide="true"
      className="h-14 border-b border-border bg-card flex items-center justify-between px-4 shrink-0 no-print"
    >
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={onMenuClick}
        data-testid="button-menu-toggle"
      >
        <Menu className="w-5 h-5" />
      </Button>

      <div className="flex items-center gap-3 ml-auto">
        <span className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground" title="Persistência ativa no Supabase">
          <Database className="w-3.5 h-3.5 text-emerald-500" />
          {saveLabel}
        </span>

        {/* Realtime Live Status Indicator */}
        <span
          className={`hidden sm:flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border transition-all ${
            realtimeStatus === "connected"
              ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
              : realtimeStatus === "connecting"
              ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800"
              : "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700"
          }`}
          title={`Status Realtime: ${realtimeStatus}`}
        >
          <Radio className={`w-3 h-3 ${realtimeStatus === "connected" ? "text-emerald-500 animate-pulse" : ""}`} />
          {realtimeStatus === "connected"
            ? "Tempo Real Ativo"
            : realtimeStatus === "connecting"
            ? "Reconectando..."
            : "Offline"}
        </span>
        {currentUser && (
          <span className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground border-l pl-3 border-border">
            <User className="w-3.5 h-3.5" />
            <span className="max-w-[140px] truncate">{currentUser.email || currentUser.nome_completo}</span>
          </span>
        )}
        {isSuperAdmin && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setLocation("/master-control")}
            className="h-8 px-2.5 text-xs font-bold border-indigo-200 dark:border-indigo-800 bg-indigo-50/70 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-600 hover:text-white dark:hover:bg-indigo-600 dark:hover:text-white transition-all shadow-sm"
            title="Acessar Central Master Control"
          >
            <ShieldAlert className="w-3.5 h-3.5 mr-1 text-indigo-600 dark:text-indigo-400" />
            <span className="hidden md:inline">Master Control</span>
          </Button>
        )}
        <NotificationBell />
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          data-testid="button-theme-toggle"
          title={theme === "light" ? "Ativar modo escuro" : "Ativar modo claro"}
        >
          {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
        </Button>
        {currentUser && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleLogout}
            title="Terminar sessão"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        )}
      </div>
    </header>
  );
}
