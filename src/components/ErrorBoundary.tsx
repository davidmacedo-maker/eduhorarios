import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RotateCcw, Home, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary capturou um erro fatal:", error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReset = () => {
    // Clear potentially toxic state data from localStorage that might be causing crash on boot
    try {
      const keys = ["eduhorarios_alocacoes", "eduhorarios_configuracao"];
      keys.forEach((k) => localStorage.removeItem(k));
    } catch (e) {
      console.error(e);
    }
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.href = "/";
  };

  private handleDownloadDebug = () => {
    try {
      const debugData = {
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString(),
        error: this.state.error?.message || "",
        stack: this.state.error?.stack || "",
        errorInfo: this.state.errorInfo?.componentStack || "",
        localStorage: { ...localStorage },
      };
      const blob = new Blob([JSON.stringify(debugData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `eduhorarios-debug-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Não foi possível gerar o arquivo de diagnóstico.");
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div id="error-boundary-screen" className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-6 text-slate-800 dark:text-slate-100">
          <div className="w-full max-w-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl p-8 flex flex-col items-center text-center">
            <div className="h-16 w-16 rounded-full bg-red-100 dark:bg-red-950/50 flex items-center justify-center text-red-600 dark:text-red-400 mb-6">
              <AlertTriangle className="h-10 w-10" />
            </div>

            <h1 className="text-2xl font-bold tracking-tight mb-2">Ops! Ocorreu um erro inesperado</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mb-6">
              Lamentamos o inconveniente. Para evitar perda de dados ou congelamento total, nossa barreira de segurança isolou a falha com sucesso.
            </p>

            {this.state.error && (
              <div className="w-full text-left bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-4 font-mono text-xs overflow-auto max-h-48 mb-6 text-red-600 dark:text-red-400">
                <span className="font-bold">Mensagem:</span> {this.state.error.message}
                {this.state.error.stack && (
                  <div className="mt-2 text-[10px] text-slate-400 dark:text-slate-500">
                    {this.state.error.stack.split("\n").slice(0, 4).join("\n")}
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 w-full justify-center">
              <Button id="btn-err-retry" variant="outline" className="flex items-center gap-2" onClick={() => window.location.reload()}>
                <RotateCcw className="h-4 w-4" /> RECARREGAR PÁGINA
              </Button>
              <Button id="btn-err-debug" variant="outline" className="flex items-center gap-2 text-blue-600 dark:text-blue-400" onClick={this.handleDownloadDebug}>
                <Download className="h-4 w-4" /> SALVAR DIAGNÓSTICO
              </Button>
              <Button id="btn-err-reset" variant="destructive" className="flex items-center gap-2" onClick={this.handleReset}>
                <Home className="h-4 w-4" /> LIMPAR CACHE & VOLTAR
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
export default ErrorBoundary;
