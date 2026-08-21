import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, CheckCircle, AlertTriangle, Brain, X, ShieldAlert } from 'lucide-react';
import type { RelatorioPreditivo } from '@/lib/predictive-validator';

interface PredicaoPanelProps {
  relatorio: RelatorioPreditivo;
  onClose: () => void;
  onApplyCorrections?: () => void;
}

export function PredicaoPanel({ relatorio, onClose, onApplyCorrections }: PredicaoPanelProps) {
  const cores = {
    critico: "border-red-500 bg-red-50 dark:bg-red-950/20 dark:border-red-900",
    alto: "border-orange-500 bg-orange-50 dark:bg-amber-950/20 dark:border-amber-900",
    medio: "border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20 dark:border-yellow-900",
    baixo: "border-green-500 bg-green-50 dark:bg-green-950/20 dark:border-green-900"
  };

  const textCores = {
    critico: "text-red-700 dark:text-red-400",
    alto: "text-orange-700 dark:text-orange-400",
    medio: "text-yellow-700 dark:text-yellow-400",
    baixo: "text-green-700 dark:text-green-400"
  };

  const icones = {
    critico: <AlertCircle className="w-5 h-5 text-red-500" />,
    alto: <AlertTriangle className="w-5 h-5 text-orange-500" />,
    medio: <AlertTriangle className="w-5 h-5 text-yellow-500" />,
    baixo: <CheckCircle className="w-5 h-5 text-green-500" />
  };

  const hasIssues = relatorio.criticos > 0 || relatorio.altos > 0 || relatorio.medios > 0;

  return (
    <Card className="border-2 border-blue-400 dark:border-blue-900 shadow-lg">
      <CardHeader className="bg-blue-50 dark:bg-blue-950/25 border-b border-blue-100 dark:border-blue-900/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-6 h-6 text-blue-600 dark:text-blue-400 animate-pulse" />
            <CardTitle className="text-blue-900 dark:text-blue-100 text-lg font-bold flex items-center gap-1.5">
              <span>Motor de Predição Ativa e Prevenção de Conflitos</span>
            </CardTitle>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 text-blue-900 dark:text-blue-100">
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-4">
        {/* KPI Dashboard Grid */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-red-50 dark:bg-red-950/35 p-3 rounded-lg border border-red-100 dark:border-red-900/40 text-center">
            <div className="text-2xl font-black text-red-600 dark:text-red-400">{relatorio.criticos}</div>
            <div className="text-xs font-semibold text-red-700 dark:text-red-400 mt-1">Críticos</div>
          </div>
          <div className="bg-orange-50 dark:bg-orange-950/35 p-3 rounded-lg border border-orange-100 dark:border-orange-900/40 text-center">
            <div className="text-2xl font-black text-orange-600 dark:text-orange-400">{relatorio.altos}</div>
            <div className="text-xs font-semibold text-orange-700 dark:text-orange-400 mt-1">Alto Risco</div>
          </div>
          <div className="bg-yellow-50 dark:bg-yellow-950/35 p-3 rounded-lg border border-yellow-100 dark:border-yellow-900/40 text-center">
            <div className="text-2xl font-black text-yellow-600 dark:text-yellow-400">{relatorio.medios}</div>
            <div className="text-xs font-semibold text-yellow-700 dark:text-yellow-400 mt-1">Médio Risco</div>
          </div>
          <div className="bg-green-50 dark:bg-green-950/35 p-3 rounded-lg border border-green-100 dark:border-green-900/40 text-center">
            <div className="text-2xl font-black text-green-600 dark:text-green-400">{relatorio.baixos}</div>
            <div className="text-xs font-semibold text-green-700 dark:text-green-400 mt-1">Baixo Risco</div>
          </div>
          <div className="bg-blue-50 dark:bg-blue-950/35 p-3 rounded-lg border border-blue-100 dark:border-blue-900/40 col-span-2 md:col-span-1 text-center flex flex-col justify-center">
            <div className="text-2xl font-black text-blue-600 dark:text-blue-400">{relatorio.totalAnalisados}</div>
            <div className="text-xs font-semibold text-blue-700 dark:text-blue-400 mt-1">Total Analisado</div>
          </div>
        </div>

        {/* Global Recommendations Banner */}
        {relatorio.recomendacoesGerais.length > 0 && (
          <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-lg p-3.5">
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 mb-2">
              <ShieldAlert className="w-4 h-4 text-slate-500" />
              Diretrizes Preditivas Consolidadas
            </h4>
            <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-350 list-none pl-0">
              {relatorio.recomendacoesGerais.map((rec, idx) => (
                <li key={idx} className="flex items-start gap-1.5">
                  <span className="text-blue-500 font-bold">•</span>
                  <span>{rec}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* List of Issues Filtered to show warnings/criticals */}
        {hasIssues ? (
          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Detalhamento dos Riscos de Alocação</p>
            {relatorio.predicoes
              .filter(p => p.risco !== "baixo")
              .map((pred, idx) => (
                <div 
                  key={idx} 
                  className={`border-l-4 p-3 rounded-r-lg shadow-xs transition-colors ${cores[pred.risco]}`}
                >
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {icones[pred.risco]}
                        <span className="font-bold text-sm text-slate-950 dark:text-slate-50">{pred.professorNome}</span>
                        <span className="text-xs bg-slate-200/60 dark:bg-slate-800/80 px-2 py-0.5 rounded text-slate-700 dark:text-slate-300">
                          {pred.disciplinaNome}
                        </span>
                        <span className="text-xs bg-slate-200/60 dark:bg-slate-800/80 px-2 py-0.5 rounded text-slate-700 dark:text-slate-300">
                          {pred.turmaNome}
                        </span>
                      </div>
                      <div className="text-xs space-y-1 pl-6">
                        {pred.analise.map((linha, i) => (
                          <p key={i} className="text-slate-700 dark:text-slate-300">{linha}</p>
                        ))}
                      </div>
                      <div className="pl-6 pt-1">
                        <span className="text-xs font-semibold text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-2 py-1 rounded">
                          Recomendação: {pred.recomendacao}
                        </span>
                      </div>
                    </div>

                    <div className="text-left md:text-right shrink-0 pl-6 md:pl-0">
                      <div className={`text-xs font-bold uppercase ${textCores[pred.risco]}`}>
                        {pred.predicaoAlocacao}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Planejado: <span className="font-semibold">{pred.planejado}</span> | Alocado: <span className="font-semibold">{pred.alocadoAtual}</span>
                      </div>
                      <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500 mt-0.5">
                        Prob. Excesso: {pred.probabilidadeExcesso.toFixed(0)}%
                      </div>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center space-y-2">
            <CheckCircle className="w-12 h-12 text-green-500" />
            <h4 className="text-base font-bold text-slate-900 dark:text-slate-100">Grade Perfeitamente Balanceada!</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md">
              O motor preditivo não detectou nenhuma probabilidade de excesso de carga ou slots insuficientes. Suas configurações atuais estão ideais para gerar ou continuar editando.
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-150 dark:border-slate-800">
          <Button 
            variant="outline" 
            size="sm"
            onClick={onClose}
          >
            Fechar Diagnóstico
          </Button>
          {relatorio.criticos > 0 && onApplyCorrections && (
            <Button 
              variant="destructive"
              size="sm"
              onClick={onApplyCorrections}
              className="bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800 text-white"
            >
              Aplicar Correções Preventivas
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
