import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Archive, Download, Upload, FileJson, FileSpreadsheet, Trash2, Info, CheckCircle2, AlertTriangle, RefreshCw, Database } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useProfessores, useConfiguracaoHorarios, useAlocacoes, useTurmas, useDisciplinas, storageKey, storePrefix } from "@/store";
import type { RegistroPonto, Alocacao } from "@/types";

const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const DIAS_SEMANA = ["segunda","terca","quarta","quinta","sexta","sabado"];
const DIAS_LABEL: Record<string,string> = { segunda:"Seg",terca:"Ter",quarta:"Qua",quinta:"Qui",sexta:"Sex",sabado:"Sáb" };

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const d = new Date(year, month - 1, 1);
  while (d.getMonth() === month - 1) { days.push(new Date(d)); d.setDate(d.getDate() + 1); }
  return days;
}

function getAllEduKeys(): string[] {
  const prefix = storePrefix();
  const fullPrefix = prefix + "edu_";
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(fullPrefix)) keys.push(k);
  }
  return keys.sort();
}

function getStorageStats() {
  const keys = getAllEduKeys();
  let totalBytes = 0;
  const cats = { config: 0, ponto: 0, estrutura: 0 };
  for (const k of keys) {
    const v = localStorage.getItem(k) ?? "";
    totalBytes += k.length + v.length;
    if (k.includes("ponto") || k.includes("assin") || k.includes("resumo") || k.includes("obs") || k.includes("extra")) cats.ponto += v.length;
    else if (k === storageKey("edu_turmas") || k === storageKey("edu_disciplinas") || k === storageKey("edu_professores") || k === storageKey("edu_alocacoes") || k === storageKey("edu_config") || k === storageKey("edu_matriz")) cats.estrutura += v.length;
    else cats.config += v.length;
  }
  return { keys: keys.length, totalBytes, cats };
}

function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

export default function ArquivoAnual() {
  const [professores] = useProfessores();
  const [alocacoes]   = useAlocacoes();
  const [turmas]      = useTurmas();
  const [disciplinas] = useDisciplinas();
  const [config]      = useConfiguracaoHorarios();
  const { toast } = useToast();
  const restoreRef = useRef<HTMLInputElement>(null);

  const [stats, setStats] = useState(() => getStorageStats());
  const [restorePreview, setRestorePreview] = useState<{ keys: number; exportedAt: string } | null>(null);
  const [pendingRestore, setPendingRestore]  = useState<Record<string, unknown> | null>(null);
  const [selectedYear,  setSelectedYear]  = useState(new Date().getFullYear());
  const [selectedProf,  setSelectedProf]  = useState<string>("__todos__");

  function refreshStats() { setStats(getStorageStats()); }

  // ── Backup Completo (JSON) ──────────────────────────────────────────────────
  function exportBackupCompleto() {
    const payload: Record<string, unknown> = {
      _meta: {
        type: "backup-completo",
        version: "full-v1",
        exportedAt: new Date().toISOString(),
        app: "EduHorários",
        description: "Backup completo restaurável — inclui horários, professores, turmas e todos os dados do Livro de Ponto",
      },
    };
    const pfx = storePrefix();
    for (const key of getAllEduKeys()) {
      const strippedKey = pfx && key.startsWith(pfx) ? key.slice(pfx.length) : key;
      try { payload[strippedKey] = JSON.parse(localStorage.getItem(key) ?? "null"); }
      catch { payload[strippedKey] = localStorage.getItem(key); }
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `eduhorarios-backup-completo-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Backup completo exportado", description: `${getAllEduKeys().length} chaves salvas.` });
  }

  // ── Restaurar Backup ────────────────────────────────────────────────────────
  function handleRestoreFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string) as Record<string, unknown>;
        const meta = parsed["_meta"] as Record<string,string> | undefined;
        if (!meta || meta.type !== "backup-completo") {
          throw new Error("Este arquivo não é um backup completo do EduHorários.\nUse a opção de importar JSON no menu Exportar / Importar.");
        }
        const eduKeys = Object.keys(parsed).filter(k => k.startsWith("edu_"));
        if (eduKeys.length === 0) throw new Error("Nenhum dado encontrado no backup.");
        setRestorePreview({ keys: eduKeys.length, exportedAt: meta.exportedAt ?? "desconhecido" });
        setPendingRestore(parsed);
      } catch (err) {
        toast({ title: "Erro ao ler backup", description: err instanceof Error ? err.message : "Arquivo inválido.", variant: "destructive" });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function confirmRestore() {
    if (!pendingRestore) return;
    const pfx = storePrefix();
    const eduKeys = Object.keys(pendingRestore).filter(k => k.startsWith("edu_"));
    for (const key of eduKeys) {
      const val = pendingRestore[key];
      localStorage.setItem(pfx + key, typeof val === "string" ? val : JSON.stringify(val));
    }
    localStorage.setItem(storageKey("edu_initialized"), "true");
    toast({ title: "Backup restaurado!", description: `${eduKeys.length} chaves restauradas. Recarregando…` });
    setPendingRestore(null);
    setRestorePreview(null);
    setTimeout(() => window.location.reload(), 1200);
  }

  // ── Excel — Livro de Ponto ──────────────────────────────────────────────────
  function exportPontoExcel() {
    const wb = XLSX.utils.book_new();
    const profsFiltro = selectedProf === "__todos__"
      ? professores
      : professores.filter(p => p.id === selectedProf);
    const safeSheet = (n: string) => n.replace(/[\/\\*\[\]?:]/g,"").slice(0,31);

    let sheetCount = 0;
    for (const prof of profsFiltro) {
      const profAlocs: Alocacao[] = alocacoes.filter(a => a.professorId === prof.id);
      for (let month = 1; month <= 12; month++) {
        const regKey   = storageKey(`edu_registros_ponto`);
        const obsKey   = storageKey(`edu_ponto_obs_${prof.id}_${selectedYear}_${month}`);
        const assinKey = storageKey(`edu_ponto_assin_${prof.id}_${selectedYear}_${month}`);
        const extraKey = storageKey(`edu_ponto_extra_${prof.id}_${selectedYear}_${month}`);
        const resumoKey= storageKey(`edu_ponto_resumo_${prof.id}_${selectedYear}_${month}`);

        let regs: RegistroPonto[] = [];
        try { regs = JSON.parse(localStorage.getItem(regKey) ?? "[]"); } catch { regs = []; }
        const obs    = localStorage.getItem(obsKey) ?? "";
        const obs2   = (() => { try { const r = JSON.parse(localStorage.getItem(resumoKey)??"{}"); return r.obs ?? ""; } catch { return ""; } })();

        const days    = getDaysInMonth(selectedYear, month);
        const dayMap  = new Map<string, Date>(days.map(d => [toISO(d), d]));

        const rowsWithData = days.filter(d => {
          const ds = toISO(d);
          const dayOfWeek = d.getDay();
          if (dayOfWeek === 0) return false;
          const dayKey = ["domingo","segunda","terca","quarta","quinta","sexta","sabado"][dayOfWeek];
          return profAlocs.some(a => a.diaSemana === dayKey) || regs.some(r => r.data === ds);
        });
        if (rowsWithData.length === 0 && !obs && !obs2) continue;

        const header = ["Dia","Data","Dia Semana","Turma","Horário","Valor","Disciplina"];
        const rows: (string|number)[][] = [header];
        for (const d of days) {
          if (d.getDay() === 0) continue;
          const ds = toISO(d);
          const dowLabel = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"][d.getDay()];
          const dayAlocs = profAlocs.filter(a => {
            const dkMap: Record<number,string> = {1:"segunda",2:"terca",3:"quarta",4:"quinta",5:"sexta",6:"sabado"};
            return a.diaSemana === dkMap[d.getDay()];
          });
          if (dayAlocs.length === 0) {
            rows.push([d.getDate(), ds, dowLabel, "", "", "", ""]);
          } else {
            for (const aloc of dayAlocs) {
              const reg = regs.find(r => r.alocacaoId === aloc.id && r.data === ds);
              const turma = turmas.find(t => t.id === aloc.turmaId);
              const disc  = disciplinas.find(d2 => d2.id === aloc.disciplinaId);
              const val   = reg?.valor ?? (reg?.presente === true ? "P" : reg?.presente === false ? "F" : "");
              rows.push([d.getDate(), ds, dowLabel, turma?.nome ?? "", aloc.horario, val, disc?.abreviacao ?? ""]);
            }
          }
        }
        if (obs)  rows.push(["","","","","","Obs:", obs]);
        if (obs2) rows.push(["","","","","","Resumo:", obs2]);

        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws["!cols"] = [{wch:4},{wch:12},{wch:8},{wch:16},{wch:8},{wch:8},{wch:12}];
        const firstNameParts = prof.nomeCompleto.split(" ");
        const nameShort = firstNameParts.length >= 2 ? `${firstNameParts[0]} ${firstNameParts[firstNameParts.length-1]}` : prof.nomeCompleto;
        const sheetName = safeSheet(`${nameShort.slice(0,14)} ${MESES[month-1].slice(0,3)}`);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
        sheetCount++;
      }
    }

    if (sheetCount === 0) {
      toast({ title: "Nenhum dado de ponto encontrado", description: "Sem registros para o professor/ano selecionado.", variant: "destructive" });
      return;
    }
    const profLabel = selectedProf === "__todos__" ? "todos" : professores.find(p=>p.id===selectedProf)?.nomeCompleto.split(" ")[0] ?? "prof";
    XLSX.writeFile(wb, `livro-ponto-${profLabel}-${selectedYear}.xlsx`);
    toast({ title: "Excel exportado!", description: `${sheetCount} folha(s) geradas.` });
  }

  // ── Limpar dados de ponto ───────────────────────────────────────────────────
  function clearPontoData() {
    const keys = getAllEduKeys().filter(k =>
      k.includes("_ponto_") || k.includes("_assin_") || k.includes("_resumo_") || k.includes("_obs_") || k.includes("_extra_")
    );
    // Keep only the main registros key; remove per-prof per-month keys
    const toRemove = keys.filter(k => k !== storageKey("edu_registros_ponto"));
    for (const k of toRemove) localStorage.removeItem(k);
    // Clear main registros too
    localStorage.setItem(storageKey("edu_registros_ponto"), "[]");
    refreshStats();
    toast({ title: "Dados de ponto limpos", description: `${toRemove.length + 1} entradas removidas.` });
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex items-center gap-3">
        <Archive className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-xl font-bold">Arquivar Livro de Ponto</h1>
          <p className="text-sm text-muted-foreground">Backup completo, restauração e exportação do Livro de Ponto</p>
        </div>
      </div>

      {/* ── Armazenamento ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Database className="w-4 h-4 text-blue-500" />Dados Armazenados</CardTitle>
          <CardDescription>Resumo dos dados salvos localmente no navegador</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 text-sm">
            <div className="flex flex-col items-center bg-blue-50 dark:bg-blue-950/30 rounded-lg px-4 py-2 min-w-[100px]">
              <span className="text-2xl font-bold text-blue-600">{stats.keys}</span>
              <span className="text-[11px] text-muted-foreground">entradas</span>
            </div>
            <div className="flex flex-col items-center bg-green-50 dark:bg-green-950/30 rounded-lg px-4 py-2 min-w-[100px]">
              <span className="text-2xl font-bold text-green-600">{fmtBytes(stats.cats.estrutura)}</span>
              <span className="text-[11px] text-muted-foreground">estrutura</span>
            </div>
            <div className="flex flex-col items-center bg-purple-50 dark:bg-purple-950/30 rounded-lg px-4 py-2 min-w-[100px]">
              <span className="text-2xl font-bold text-purple-600">{fmtBytes(stats.cats.ponto)}</span>
              <span className="text-[11px] text-muted-foreground">livro de ponto</span>
            </div>
            <div className="flex flex-col items-center bg-gray-50 dark:bg-gray-900/30 rounded-lg px-4 py-2 min-w-[100px]">
              <span className="text-2xl font-bold text-gray-600">{fmtBytes(stats.totalBytes)}</span>
              <span className="text-[11px] text-muted-foreground">total</span>
            </div>
            <Button variant="outline" size="sm" className="self-center" onClick={refreshStats}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />Atualizar
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* ── Backup Completo ────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2"><FileJson className="w-4 h-4 text-amber-500" />Backup Completo (JSON)</CardTitle>
            <CardDescription>Exporta <strong>todos</strong> os dados — horários, turmas, professores, Livro de Ponto, assinaturas e observações.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="bg-amber-50 dark:bg-amber-950/30 rounded-md p-3 text-xs text-amber-800 dark:text-amber-200 flex gap-2">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Recomendado como backup principal. Permite restaurar o sistema com todos os dados do ano letivo.</span>
            </div>
            <Button className="w-full gap-2" onClick={exportBackupCompleto}>
              <Download className="w-4 h-4" />
              Exportar Backup Completo
            </Button>

            <Separator />

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Restaurar Backup</p>
              {restorePreview ? (
                <div className="space-y-2">
                  <div className="bg-green-50 dark:bg-green-950/30 rounded-md p-3 text-xs space-y-1">
                    <div className="flex items-center gap-1.5 text-green-700 dark:text-green-300 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Backup válido encontrado
                    </div>
                    <p><strong>{restorePreview.keys}</strong> entradas para restaurar</p>
                    <p>Exportado em: {new Date(restorePreview.exportedAt).toLocaleString("pt-BR")}</p>
                  </div>
                  <div className="bg-red-50 dark:bg-red-950/30 rounded-md p-2 text-xs text-red-700 dark:text-red-300 flex gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>Isso <strong>substituirá todos os dados atuais</strong>. Esta ação não pode ser desfeita.</span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="destructive" size="sm" className="flex-1" onClick={confirmRestore}>
                      Confirmar Restauração
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => { setRestorePreview(null); setPendingRestore(null); }}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <input ref={restoreRef} type="file" accept=".json" className="hidden" onChange={handleRestoreFile} />
                  <Button variant="outline" className="w-full gap-2" onClick={() => restoreRef.current?.click()}>
                    <Upload className="w-4 h-4" />
                    Selecionar arquivo de backup…
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Excel do Livro de Ponto ─────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2"><FileSpreadsheet className="w-4 h-4 text-green-600" />Exportar Livro de Ponto (Excel)</CardTitle>
            <CardDescription>Gera uma planilha com os registros mensais de frequência por professor.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Ano</label>
                <select
                  value={selectedYear}
                  onChange={e => setSelectedYear(Number(e.target.value))}
                  className="w-full h-8 text-xs rounded-md border border-input bg-background px-2 focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {[2024,2025,2026,2027,2028].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Professor</label>
                <select
                  value={selectedProf}
                  onChange={e => setSelectedProf(e.target.value)}
                  className="w-full h-8 text-xs rounded-md border border-input bg-background px-2 focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="__todos__">Todos</option>
                  {professores.map(p => <option key={p.id} value={p.id}>{p.nomeCompleto}</option>)}
                </select>
              </div>
            </div>
            <div className="bg-green-50 dark:bg-green-950/30 rounded-md p-3 text-xs text-green-800 dark:text-green-200 flex gap-2">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Gera uma aba por professor/mês com todos os registros de frequência, símbolos e observações.</span>
            </div>
            <Button className="w-full gap-2 bg-green-600 hover:bg-green-700 text-white" onClick={exportPontoExcel}>
              <Download className="w-4 h-4" />
              Exportar Ponto em Excel
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* ── Manutenção ──────────────────────────────────────────────────────────── */}
      <Card className="border-destructive/20">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2 text-destructive"><Trash2 className="w-4 h-4" />Manutenção / Início de Novo Ano</CardTitle>
          <CardDescription>Use estas opções ao <strong>fechar o ano letivo</strong>. Faça um backup completo antes de limpar.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="bg-red-50 dark:bg-red-950/30 rounded-md p-3 text-xs text-red-700 dark:text-red-300 flex gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span><strong>Atenção:</strong> As ações abaixo são irreversíveis. Exporte o backup completo antes de prosseguir.</span>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              size="sm"
              className="gap-2 text-destructive border-destructive/40 hover:bg-destructive/10"
              onClick={() => {
                if (confirm("Limpar TODOS os dados do Livro de Ponto (registros, assinaturas, observações)?\n\nEsta ação não pode ser desfeita.")) {
                  clearPontoData();
                }
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Limpar Dados de Ponto
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            A estrutura do sistema (turmas, professores, alocações) é mantida. Apenas os registros de frequência e observações são removidos.
          </p>
        </CardContent>
      </Card>

      {/* ── Legenda de formatos ─────────────────────────────────────────────────── */}
      <Card className="bg-muted/30">
        <CardContent className="pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Guia de Formatos</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            {[
              { icon: <FileJson className="w-4 h-4 text-amber-500"/>, label: "JSON — Backup", desc: "Arquivo oficial restaurável. Recomendado para arquivamento anual e migração entre computadores." },
              { icon: <FileSpreadsheet className="w-4 h-4 text-green-600"/>, label: "Excel — Integração", desc: "Ideal para relatórios administrativos, análise de frequência e integração com outros sistemas." },
              { icon: <Badge variant="outline" className="text-[10px] px-1.5">PDF</Badge>, label: "PDF — Impressão", desc: "Para arquivamento oficial físico e assinaturas. Use o botão Imprimir Todos no Livro de Ponto." },
            ].map((item, i) => (
              <div key={i} className="flex gap-2">
                <div className="mt-0.5">{item.icon}</div>
                <div>
                  <p className="font-semibold">{item.label}</p>
                  <p className="text-muted-foreground">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
