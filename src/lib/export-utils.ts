import type { RelatorioAuditoria } from "./audit-engine";

/**
 * Exporta o relatório de auditoria em formato CSV
 */
export function exportAuditToCSV(relatorio: RelatorioAuditoria): string {
  const headers = [
    "Professor",
    "Turma",
    "Disciplina",
    "Planejado",
    "Alocado",
    "Status",
    "Alerta"
  ];

  const rows = relatorio.professores.map(p => [
    p.professorNome,
    p.turmaNome,
    p.disciplinaNome,
    p.planejado.toString(),
    p.alocado.toString(),
    p.status,
    p.alerta || "OK"
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(val => `"${val.replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  return csvContent;
}

/**
 * Exporta o relatório de auditoria em formato texto simples
 */
export function exportAuditToText(relatorio: RelatorioAuditoria): string {
  let text = "RELATÓRIO DE AUDITORIA DE CARGA HORÁRIA\n";
  text += "=".repeat(50) + "\n\n";
  text += `Data: ${new Date().toLocaleDateString()}\n`;
  text += `Total Planejado: ${relatorio.resumo.totalPlanejado} aulas\n`;
  text += `Total Alocado: ${relatorio.resumo.totalAlocado} aulas\n`;
  text += `Total em Excesso: ${relatorio.resumo.totalExcesso} aulas\n`;
  text += `Total Faltante: ${relatorio.resumo.totalFaltante} aulas\n\n`;
  text += "-".repeat(50) + "\n\n";

  relatorio.professores.forEach(p => {
    text += `${p.professorNome} | ${p.turmaNome} | ${p.disciplinaNome}\n`;
    text += `  Planejado: ${p.planejado} | Alocado: ${p.alocado} | Status: ${p.status}\n`;
    if (p.alerta) text += `  ⚠️ ${p.alerta}\n`;
    text += "\n";
  });

  return text;
}

/**
 * Baixa um arquivo de texto com o relatório
 */
export function downloadAuditReport(relatorio: RelatorioAuditoria, format: "csv" | "txt" = "txt") {
  const content = format === "csv" 
    ? exportAuditToCSV(relatorio) 
    : exportAuditToText(relatorio);
  
  const blob = new Blob([content], { 
    type: format === "csv" ? "text/csv;charset=utf-8;" : "text/plain;charset=utf-8;" 
  });
  
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `auditoria-${new Date().toISOString().slice(0,10)}.${format}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
