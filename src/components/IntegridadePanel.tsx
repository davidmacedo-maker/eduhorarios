/**
 * IntegridadePanel.tsx
 * ──────────────────────────────────────────────────────────────
 * Painel de exibição do relatório de integridade docente
 * Mostra professores com excesso, aulas removidas e feedback
 */

import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, CheckCircle, Download, RefreshCw } from 'lucide-react';
import type { RelatorioIntegridade } from '@/lib/integrity-validator';
import { formatarRelatorioIntegridade } from '@/lib/integrity-validator';
import { gerarFeedbackParaGerador } from '@/lib/feedback-engine';

interface IntegridadePanelProps {
  relatorio: RelatorioIntegridade | null;
  onRegenerar?: () => void;
  onFechar?: () => void;
}

export function IntegridadePanel({ relatorio, onRegenerar, onFechar }: IntegridadePanelProps) {
  if (!relatorio) {
    return null;
  }

  const feedback = relatorio ? gerarFeedbackParaGerador(relatorio) : null;
  const temExcesso = relatorio.professoresComExcesso.length > 0;

  const handleExport = () => {
    if (!relatorio) return;
    const texto = formatarRelatorioIntegridade(relatorio);
    const blob = new Blob([texto], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `relatorio-integridade-${new Date().toISOString().slice(0,10)}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <Card className={`border-2 ${temExcesso ? 'border-red-400' : 'border-green-400'}`}>
      <CardHeader className={`${temExcesso ? 'bg-red-50 dark:bg-red-950/20' : 'bg-green-50 dark:bg-green-950/20'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {temExcesso ? (
              <AlertCircle className="w-6 h-6 text-red-500" />
            ) : (
              <CheckCircle className="w-6 h-6 text-green-500" />
            )}
            <CardTitle>
              {temExcesso ? '⚠️ Correção de Integridade Aplicada' : '✅ Integridade Confirmada'}
            </CardTitle>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="w-4 h-4 mr-2" />
              Exportar
            </Button>
            {temExcesso && onRegenerar && (
              <Button variant="default" size="sm" onClick={onRegenerar}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Regenerar
              </Button>
            )}
            {onFechar && (
              <Button variant="outline" size="sm" onClick={onFechar}>
                Fechar
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4">
        {temExcesso ? (
          <>
            <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg p-3 mb-4">
              <p className="text-sm text-red-700 dark:text-red-400">
                <strong>{relatorio.totalAulasRemovidas} aula(s) removida(s)</strong> de{' '}
                <strong>{relatorio.professoresComExcesso.length} professor(es)</strong> com excesso de carga.
              </p>
            </div>

            <div className="space-y-3 max-h-60 overflow-y-auto">
              {relatorio.professoresComExcesso.map((excesso, idx) => (
                <div key={idx} className="border-l-4 border-red-400 pl-3 py-2 bg-gray-50 dark:bg-slate-900 rounded-r">
                  <p className="font-medium">{excesso.professorNome}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {excesso.disciplinaNome} - {excesso.turmaNome}
                  </p>
                  <p className="text-sm">
                    Planejado: <span className="font-medium">{excesso.planejado}</span> |{' '}
                    Alocado: <span className="font-medium text-red-600 dark:text-red-450">{excesso.alocado}</span> |{' '}
                    Excesso: <span className="font-medium text-red-600 dark:text-red-450">-{excesso.excesso}</span>
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Aulas removidas: {excesso.alocacoesExcedentes.map(a => 
                      `${a.diaSemana.toUpperCase()} ${a.horario}º`
                    ).join(', ')}
                  </p>
                </div>
              ))}
            </div>

            {feedback && (
              <div className="mt-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-lg p-3">
                <p className="text-sm font-medium text-blue-700 dark:text-blue-400 mb-1">💡 Feedback para o Motor</p>
                <p className="text-sm text-blue-600 dark:text-blue-300">{feedback.mensagemConsolidada}</p>
                {feedback.instrucoes.map((inst, idx) => (
                  <div key={idx} className="text-sm text-blue-600 dark:text-blue-300 mt-1">
                    • {inst.mensagem}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center py-6">
            <div className="text-center">
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-2" />
              <p className="text-lg font-medium text-green-700 dark:text-green-400">Todas as cargas estão dentro do planejado</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">{relatorio.alocacoesCorrigidas.length} aulas verificadas</p>
            </div>
          </div>
        )}
      </CardContent>

      <CardFooter className={`${temExcesso ? 'bg-red-50 dark:bg-red-950/10' : 'bg-green-50 dark:bg-green-950/10'} border-t`}>
        <div className="flex justify-between w-full text-sm">
          <span className="text-gray-600 dark:text-gray-450">
            Total de professores analisados: {relatorio.professoresComExcesso.length}
          </span>
          <span className="text-gray-600 dark:text-gray-450">
            {temExcesso ? '⚠️ Correção necessária' : '✅ Aprovado'}
          </span>
        </div>
      </CardFooter>
    </Card>
  );
}
