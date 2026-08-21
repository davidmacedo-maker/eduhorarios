import React from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  ArrowRight, 
  Check, 
  MoveHorizontal,
  Workflow,
  HelpCircle,
  TrendingUp,
  Clock
} from "lucide-react";
import type { SolucaoCascata } from "@/lib/cascade-move-engine";
import { formatarDia } from "@/lib/utils";

interface CascataVisualizerProps {
  solucao: SolucaoCascata;
  onExecutar: () => void;
  onFechar: () => void;
  id?: string;
}

export function CascataVisualizer({ solucao, onExecutar, onFechar, id = "cascata-visualizer" }: CascataVisualizerProps) {
  if (!solucao) return null;

  const isSolucaoViavel = solucao.sucesso;
  const totalPassos = solucao.movimentos.length;

  const getIconePasso = (tipo: string) => {
    switch (tipo) {
      case "alocar":
        return <Check className="w-4 h-4 text-emerald-500" />;
      case "mover":
        return <MoveHorizontal className="w-4 h-4 text-blue-500" />;
      default:
        return <ArrowRight className="w-4 h-4 text-slate-500" />;
    }
  };

  const getCorPasso = (nivel: number) => {
    switch (nivel) {
      case 0:
        return "bg-emerald-50/50 border-emerald-100 hover:bg-emerald-50 text-emerald-950";
      case 1:
        return "bg-blue-50/50 border-blue-100 hover:bg-blue-50 text-blue-950";
      case 2:
        return "bg-violet-50/50 border-violet-100 hover:bg-violet-50 text-violet-950";
      case 3:
        return "bg-amber-50/50 border-amber-100 hover:bg-amber-50 text-amber-950";
      default:
        return "bg-slate-50/50 border-slate-100 hover:bg-slate-50 text-slate-950";
    }
  };

  return (
    <Card id={id} className="border-2 border-violet-400 max-w-2xl overflow-hidden shadow-lg transition-all duration-300">
      <CardHeader className="bg-gradient-to-r from-violet-50 to-indigo-50 border-b border-violet-100 p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-violet-600 rounded-lg text-white">
              <Workflow className="w-5 h-5" />
            </div>
            <div>
              <CardTitle className="text-lg font-bold text-violet-950 flex items-center gap-2">
                Estratégia de Xadrez (Movimentos em Cascata)
              </CardTitle>
              <CardDescription className="text-violet-700 font-medium">
                Resolução automática de impasses por deslocamento em cadeia
              </CardDescription>
            </div>
          </div>
          <span className="text-xs font-bold bg-violet-200 text-violet-800 px-2.5 py-1 rounded-full uppercase tracking-wider">
            Profundidade: {solucao.profundidade}
          </span>
        </div>
      </CardHeader>

      <CardContent className="p-6 space-y-6">
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-slate-50/80 p-3 rounded-xl border border-slate-100 text-center transition-all hover:shadow-sm">
            <div className="text-2xl font-black text-violet-600">
              {totalPassos}
            </div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mt-1">Movimentos</div>
          </div>
          <div className="bg-slate-50/80 p-3 rounded-xl border border-slate-100 text-center transition-all hover:shadow-sm">
            <div className="text-2xl font-black text-blue-600">
              {solucao.analise.aulasRealocadas}
            </div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mt-1">Remanejamentos</div>
          </div>
          <div className="bg-slate-50/80 p-3 rounded-xl border border-slate-100 text-center transition-all hover:shadow-sm">
            <div className="text-2xl font-black text-emerald-600">
              +{solucao.analise.impactoIQG}
            </div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mt-1">Impacto IQG</div>
          </div>
        </div>

        <div className={`p-4 rounded-xl border flex items-start gap-3 transition-colors ${
          isSolucaoViavel 
            ? "bg-emerald-50/80 border-emerald-100 text-emerald-800" 
            : "bg-red-50/80 border-red-100 text-red-800"
        }`}>
          <div className="mt-0.5">
            {isSolucaoViavel ? (
              <Check className="w-5 h-5 text-emerald-600" />
            ) : (
              <HelpCircle className="w-5 h-5 text-red-600" />
            )}
          </div>
          <div>
            <p className="text-sm font-semibold">
              {isSolucaoViavel ? "Simulação de Conflito Resolvida!" : "Simulação Indisponível"}
            </p>
            <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
              {solucao.mensagem}
            </p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">🎯 Alocação Solicitada originalmente:</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-700">
            <span className="font-semibold text-slate-900">{solucao.alvoOriginal.professorNome}</span>
            <span className="text-slate-400">•</span>
            <span className="text-slate-600">{solucao.alvoOriginal.disciplinaNome}</span>
            <span className="text-slate-400">•</span>
            <span className="bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded text-xs font-semibold text-indigo-700">
              Turma {solucao.alvoOriginal.turmaNome}
            </span>
            <span className="text-slate-400">•</span>
            <span className="font-medium text-indigo-900">
              {formatarDia(solucao.alvoOriginal.diaDesejado)} — {solucao.alvoOriginal.horarioDesejado}º horário
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">📋 Passos Operacionais da Cascata:</p>
          
          <div className="space-y-2">
            {solucao.movimentos.map((m, idx) => (
              <div
                key={m.id}
                className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 p-3 rounded-xl border transition-all ${getCorPasso(m.nivel)}`}
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center font-bold text-xs shadow-sm border border-slate-100">
                    {idx + 1}
                  </div>
                  <div className="p-1 bg-white rounded shadow-sm">
                    {getIconePasso(m.tipo)}
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-900 truncate">
                    {m.professorNome}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {m.disciplinaNome} — <span className="font-medium">Turma {m.turmaNome}</span>
                  </p>
                </div>

                <div className="flex items-center gap-2 sm:justify-end text-xs font-semibold text-slate-700 bg-white/80 px-2.5 py-1 rounded-lg border border-slate-100/50">
                  {m.tipo === "mover" ? (
                    <>
                      <span className="text-slate-500">{formatarDia(m.deDia || "")} ({m.deHorario}º)</span>
                      <ArrowRight className="w-3.5 h-3.5 text-violet-500" />
                      <span className="text-violet-700 font-bold">{formatarDia(m.paraDia)} ({m.paraHorario}º)</span>
                    </>
                  ) : (
                    <span className="text-emerald-700 font-bold">
                      Alocar em {formatarDia(m.paraDia)} ({m.paraHorario}º)
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-violet-50/40 border border-violet-100/50 space-y-2">
          <p className="text-[10px] font-black uppercase tracking-wider text-violet-500 flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" /> Análise de Impacto Preventivo
          </p>
          <ul className="text-xs text-slate-600 space-y-1.5 leading-relaxed">
            <li>
              • <strong className="text-slate-800">Conflitos sanados:</strong> {solucao.analise.conflitosResolvidos.join(", ")}
            </li>
            <li>
              • <strong className="text-slate-800">Professores impactados:</strong> {solucao.analise.professoresAfetados.join(", ")}
            </li>
            <li>
              • <strong className="text-slate-800">Compacidade da Grade:</strong> Realocação mantém o índice de compactação atual, reduzindo janelas indesejadas.
            </li>
          </ul>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <Button
            variant="ghost"
            onClick={onFechar}
            className="text-slate-600 hover:bg-slate-100 hover:text-slate-900 rounded-lg text-xs"
          >
            Cancelar
          </Button>
          {isSolucaoViavel && (
            <Button
              onClick={onExecutar}
              className="bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-5 text-xs font-semibold shadow-md shadow-violet-200 transition-all active:scale-[0.98]"
            >
              <Check className="w-4 h-4 mr-1.5" />
              Executar Movimentos
            </Button>
          )}
        </div>

        <div className="flex items-center justify-between text-[10px] text-slate-400 border-t border-slate-100 pt-4">
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> Processamento instantâneo em {solucao.tempoExecucao}ms
          </span>
          <span>Modelo de Heurísticas Cascata Ativo</span>
        </div>
      </CardContent>
    </Card>
  );
}
