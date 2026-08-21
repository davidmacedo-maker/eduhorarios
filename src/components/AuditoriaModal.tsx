import { executarAuditoria, corrigirExcessos } from "@/lib/audit-engine";
import { downloadAuditReport } from "@/lib/export-utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Trash2, FileText, FileSpreadsheet } from "lucide-react";
import type { Turma, Disciplina, Professor, MatrizCurricular, Alocacao } from "@/types";

export interface AuditoriaModalProps {
  open: boolean;
  onClose: () => void;
  turmas: Turma[];
  disciplinas: Disciplina[];
  professores: Professor[];
  matriz: MatrizCurricular[];
  alocacoes: Alocacao[];
  setAlocacoes: (alocs: Alocacao[]) => void;
}

export function AuditoriaModal({ 
  open, 
  onClose,
  turmas,
  disciplinas,
  professores,
  matriz,
  alocacoes,
  setAlocacoes
}: AuditoriaModalProps) {
  const { toast } = useToast();
  const auditoria = executarAuditoria(turmas, disciplinas, professores, matriz, alocacoes);
  
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>🔍 Relatório de Auditoria de Carga Horária</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Resumo */}
          <div className="grid grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">Total Planejado</p>
                <p className="text-2xl font-bold">{auditoria.resumo.totalPlanejado}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">Total Alocado</p>
                <p className="text-2xl font-bold">{auditoria.resumo.totalAlocado}</p>
              </CardContent>
            </Card>
            <Card className="border-red-200">
              <CardContent className="p-4">
                <p className="text-sm text-red-600 font-semibold">Em Excesso</p>
                <p className="text-2xl font-bold text-red-600">{auditoria.resumo.totalExcesso}</p>
              </CardContent>
            </Card>
            <Card className="border-amber-200">
              <CardContent className="p-4">
                <p className="text-sm text-amber-600 font-semibold">Faltando</p>
                <p className="text-2xl font-bold text-amber-600">{auditoria.resumo.totalFaltante}</p>
              </CardContent>
            </Card>
          </div>

          {/* Detalhes por Professor */}
          <div className="space-y-2">
            <h3 className="font-semibold text-lg">Inconsistências Identificadas</h3>
            <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
              {auditoria.professores.filter(p => p.alerta).length === 0 ? (
                <div className="p-8 text-center border rounded-lg bg-green-50/50 border-green-100">
                  <p className="text-green-700 font-medium">✨ Nenhuma inconsistência encontrada!</p>
                  <p className="text-sm text-green-600 mt-1">Todas as alocações estão em perfeita conformidade com o planejamento.</p>
                </div>
              ) : (
                auditoria.professores.filter(p => p.alerta).map((item, idx) => (
                  <div key={idx} className={`p-3 rounded-lg border ${
                    item.status === 'excesso' ? 'border-red-200 bg-red-50/50' :
                    item.status === 'incompleta' ? 'border-amber-200 bg-amber-50/50' :
                    'border-green-200 bg-green-50/50'
                  }`}>
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-semibold text-gray-900">{item.professorNome}</p>
                        <p className="text-sm text-muted-foreground">
                          {item.disciplinaNome} — {item.turmaNome} ({item.turno.toUpperCase()})
                        </p>
                      </div>
                      <div className="text-right flex flex-col items-end gap-1">
                        <p className="text-sm font-medium">
                          {item.alocado} / {item.planejado} aulas
                        </p>
                        {item.excesso > 0 && (
                          <Badge variant="destructive">+{item.excesso} excesso</Badge>
                        )}
                        {item.faltam > 0 && (
                          <Badge variant="outline" className="border-amber-500 text-amber-700 font-bold bg-amber-50">
                            -{item.faltam} faltam
                          </Badge>
                        )}
                      </div>
                    </div>
                    {item.alerta && (
                      <p className="text-xs mt-2 text-gray-600 font-mono bg-white/80 p-1.5 rounded border">
                        {item.alerta}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Logs */}
          <div className="space-y-1">
            <h4 className="font-semibold text-sm">Logs do Processo</h4>
            <div className="bg-muted p-3 rounded-lg max-h-32 overflow-y-auto font-mono text-[11px] leading-relaxed">
              {auditoria.logs.map((log, lIdx) => (
                <div key={lIdx} className="whitespace-pre-wrap">{log}</div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-2 justify-between items-center w-full">
          <div className="flex gap-2 w-full sm:w-auto justify-start">
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => downloadAuditReport(auditoria, "txt")}
            >
              <FileText className="w-4 h-4 mr-2" />
              Exportar Texto
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => downloadAuditReport(auditoria, "csv")}
            >
              <FileSpreadsheet className="w-4 h-4 mr-2" />
              Exportar CSV
            </Button>
          </div>
          <div className="flex gap-2 w-full sm:w-auto justify-end">
            <Button variant="outline" onClick={onClose}>Fechar</Button>
            {auditoria.resumo.totalExcesso > 0 && (
              <Button 
                variant="destructive"
                onClick={() => {
                  const resultado = corrigirExcessos(alocacoes, professores, matriz);
                  setAlocacoes(resultado.alocacoes);
                  toast({
                    title: "Excessos Corrigidos",
                    description: `${resultado.removidas} aula(s) em excesso foram removida(s).`,
                  });
                  onClose();
                }}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Remover Excessos ({auditoria.resumo.totalExcesso})
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
