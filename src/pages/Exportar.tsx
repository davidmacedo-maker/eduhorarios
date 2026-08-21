import { useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import * as XLSX from "xlsx";
import { useTurmas, useProfessores, useDisciplinas, useAlocacoes, useConfiguracaoHorarios, useMatrizCurricular, storageKey } from "@/store";
import { generateTimeSlots } from "@/lib/schedule-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Download, Upload, FileJson, FileSpreadsheet, FileText,
  CheckCircle2, AlertTriangle, ExternalLink, Zap, Sparkles,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { 
  syncTurmas, 
  syncDisciplinas, 
  syncMatriz, 
  syncProfessores, 
  syncAlocacoes, 
  syncConfig 
} from "@/lib/apiSync";
import type { Turma, Disciplina, Professor, Alocacao, MatrizCurricular, ConfiguracaoHorarios } from "@/types";

const DIAS = ["segunda", "terca", "quarta", "quinta", "sexta"] as const;
const DIA_LABELS: Record<string, string> = {
  segunda: "Segunda", terca: "Terça", quarta: "Quarta", quinta: "Quinta", sexta: "Sexta",
};
const DIA_LABELS_FULL: Record<string, string> = {
  segunda: "Segunda-feira", terca: "Terça-feira", quarta: "Quarta-feira",
  quinta: "Quinta-feira", sexta: "Sexta-feira",
};

const CORES = ["#3B82F6","#22C55E","#F97316","#A855F7","#EF4444",
               "#0EA5E9","#F59E0B","#10B981","#EC4899","#6366F1","#14B8A6"];

function parseTurmaNome(raw: string): { nome: string; serie: string } {
  if (raw.length === 2) {
    return { nome: `${raw[0]}º Ano - T${raw[1]}`, serie: `${raw[0]}º Ano` };
  }
  if (raw.length === 3) {
    const labels: Record<string, string> = { "10": "1º EM", "20": "2º EM", "30": "3º EM" };
    const label = labels[raw.slice(0, 2)] ?? `${raw.slice(0, 2)}º`;
    return { nome: `${label} - T${raw[2]}`, serie: label };
  }
  return { nome: raw, serie: raw };
}

interface ExternalBackupProf { id: string; nome: string; disc: string; }
interface ExternalBackupCell { id: string; nome: string; disc: string; }
interface ExternalBackup {
  profs: ExternalBackupProf[];
  turmas: string[];
  grade: Record<string, Record<string, Record<string, ExternalBackupCell>>>;
  config?: { inicio?: string; duracao?: number; qtd?: number; intPos?: number; intDur?: number };
}

function convertExternalBackup(raw: ExternalBackup): {
  turmas: Turma[]; disciplinas: Disciplina[]; professores: Professor[];
  alocacoes: Alocacao[]; matriz: MatrizCurricular[]; config: ConfiguracaoHorarios;
  stats: { turmas: number; disciplinas: number; professores: number; alocacoes: number };
} {
  const DIA_MAP = ["segunda", "terca", "quarta", "quinta", "sexta"];
  const discSet: Record<string, string> = {};
  const discAbrevs = [...new Set(raw.profs.map((p) => p.disc))].sort();
  discAbrevs.forEach((abbrev, i) => { discSet[abbrev] = `disc_${i + 1}`; });
  const disciplinas: Disciplina[] = discAbrevs.map((abbrev, i) => ({
    id: `disc_${i + 1}`, nome: abbrev,
    abreviacao: abbrev.replace(/\.$/, "").replace("/", "-").slice(0, 6),
    cor: CORES[i % CORES.length], cargaHorariaSemanal: 3,
  }));
  const profByNome: Record<string, { id: string; nomeCompleto: string; disciplinas: string[]; turmas: string[] }> = {};
  const profIdMap: Record<string, string> = {};
  raw.profs.forEach((p) => {
    if (!profByNome[p.nome]) {
      profByNome[p.nome] = { id: `prof_${Object.keys(profByNome).length + 1}`, nomeCompleto: p.nome.charAt(0) + p.nome.slice(1).toLowerCase(), disciplinas: [], turmas: [] };
    }
    const discId = discSet[p.disc];
    if (discId && !profByNome[p.nome].disciplinas.includes(discId)) profByNome[p.nome].disciplinas.push(discId);
    profIdMap[p.id] = profByNome[p.nome].id;
  });
  const DEFAULT_DISP = Object.fromEntries(DIA_MAP.map((d) => [d, [1, 2, 3, 4, 5, 6]]));
  const professores: Professor[] = Object.values(profByNome).map((v) => ({ ...v, turmas: [], disponibilidade: DEFAULT_DISP, cargaHorariaMaximaSemanal: 20 }));
  const turmaIdMap: Record<string, string> = {};
  const turmas: Turma[] = raw.turmas.map((t, i) => {
    const { nome, serie } = parseTurmaNome(t);
    turmaIdMap[t] = `turma_${i + 1}`;
    return { id: `turma_${i + 1}`, nome, turno: "manha", serie, anoLetivo: new Date().getFullYear(), observacoes: "" };
  });
  const alocacoes: Alocacao[] = [];
  let alocId = 0;
  for (const [turmaRaw, periods] of Object.entries(raw.grade)) {
    const turmaId = turmaIdMap[turmaRaw];
    if (!turmaId) continue;
    for (const [periodStr, days] of Object.entries(periods)) {
      const horario = parseInt(periodStr) + 1;
      for (const [dayStr, cell] of Object.entries(days)) {
        const dayIdx = parseInt(dayStr);
        if (dayIdx >= DIA_MAP.length) continue;
        const profNewId = profIdMap[cell.id];
        const discId = discSet[cell.disc];
        if (!profNewId || !discId) continue;
        alocacoes.push({ id: `aloc_${++alocId}`, turmaId, disciplinaId: discId, professorId: profNewId, diaSemana: DIA_MAP[dayIdx], horario });
      }
    }
  }
  alocacoes.forEach((a) => {
    const p = professores.find((pr) => pr.id === a.professorId);
    if (p && !p.turmas.includes(a.turmaId)) p.turmas.push(a.turmaId);
  });
  const seen = new Set<string>();
  const matriz: MatrizCurricular[] = [];
  alocacoes.forEach((a) => {
    const key = `${a.turmaId}-${a.disciplinaId}`;
    if (!seen.has(key)) { seen.add(key); matriz.push({ turmaId: a.turmaId, disciplinaId: a.disciplinaId, aulasPorSemana: 3 }); }
  });
  const cfg = raw.config ?? {};
  const hasTarde = turmas.some(t => t.turno === "tarde");
  const config: ConfiguracaoHorarios = {
    quantidadeHorariosPorDia: cfg.qtd ?? 5, duracaoAulaMinutos: cfg.duracao ?? 50,
    horarioInicial: cfg.inicio ?? "07:00", possuiIntervalo: true,
    horarioIntervalo: cfg.intPos ?? 3, duracaoIntervaloMinutos: cfg.intDur ?? 15,
    habilitarTarde: hasTarde,
    horarioInicialTarde: "12:00",
    quantidadeHorariosPorDiaTarde: 5,
    duracaoAulaMinutosTarde: 50,
    possuiIntervaloTarde: true,
    horarioIntervaloTarde: 3,
    duracaoIntervaloMinutosTarde: 15,
    habilitarNoite: false,
    horarioInicialNoite: "19:00",
    quantidadeHorariosPorDiaNoite: 4,
    duracaoAulaMinutosNoite: 50,
    possuiIntervaloNoite: false,
    horarioIntervaloNoite: 2,
    duracaoIntervaloMinutosNoite: 15,
  };
  return { turmas, disciplinas, professores, alocacoes, matriz, config,
    stats: { turmas: turmas.length, disciplinas: disciplinas.length, professores: professores.length, alocacoes: alocacoes.length } };
}

// ── Parser do Cronos Horário (.xls) ──────────────────────────────────────────
const CRONOS_DIA_MAP: Record<string, string> = {
  "segunda-feira": "segunda", "terca-feira": "terca", "terça-feira": "terca",
  "quarta-feira": "quarta",   "quinta-feira": "quinta", "sexta-feira": "sexta",
};
const DISC_COLORS = [
  "#4f46e5","#16a34a","#dc2626","#ea580c","#0284c7",
  "#7c3aed","#db2777","#0891b2","#65a30d","#d97706",
  "#0f766e","#9333ea","#c2410c","#1d4ed8","#15803d",
];

function parseCronosXls(wb: ReturnType<typeof XLSX.read>): {
  turmas: Turma[]; disciplinas: Disciplina[]; professores: Professor[];
  alocacoes: Alocacao[]; config: ConfiguracaoHorarios; matriz: MatrizCurricular[];
  escola: string; turno: string;
  stats: Record<string, number>;
} {
  let idC = 1;
  const newId = () => `cron${idC++}`;
  let colorIdx = 0;
  const nextColor = () => DISC_COLORS[colorIdx++ % DISC_COLORS.length];

  const afterSemi  = (s: string) => { const i = s.lastIndexOf(";"); return i >= 0 ? s.slice(i + 1) : s; };
  const afterBrace = (s: string) => { const i = s.lastIndexOf("}"); return i >= 0 ? s.slice(i + 1) : s; };
  const titleCase  = (s: string) => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  const minutesBetween = (t1: string, t2: string) => {
    const [h1, m1] = t1.split(":").map(Number);
    const [h2, m2] = t2.split(":").map(Number);
    return (h2 * 60 + m2) - (h1 * 60 + m1);
  };

  // Sheet 1 → escola + turno
  let escola = "Escola";
  let turnoGlobal: "manha" | "tarde" = "manha";
  const rows1 = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  if (rows1[4]?.[0]) escola = String(rows1[4][0]).trim();
  if (rows1[5]?.[0]) {
    const t = String(rows1[5][0]).toLowerCase();
    if (t.includes("vespertino")) turnoGlobal = "tarde";
  }

  const discMap  = new Map<string, Disciplina>();
  const profMap  = new Map<string, Professor>();
  const turmaMap = new Map<string, Turma>();
  const alocList: Alocacao[] = [];
  const matrizMap = new Map<string, MatrizCurricular & { count: number }>();

  let currentDay  = "segunda";
  let totalSlots  = 5;
  let horarioInicio = "07:00";
  let duracaoMin  = 50;
  let hasIntervalo = true;
  let intervaloApos = 3;
  let intervDurMin  = 15;

  for (let si = 1; si < wb.SheetNames.length; si++) {
    const sheet = wb.Sheets[wb.SheetNames[si]];
    const rows  = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" });
    const first = String(rows[0]?.[0] ?? "");

    if (first.includes("arrayDias")) {
      currentDay = CRONOS_DIA_MAP[afterSemi(first).trim().toLowerCase()] ?? "segunda";
      const slots: string[] = [];
      for (let r = 3; r <= 7; r++) {
        const s = afterSemi(String(rows[r]?.[0] ?? "")).trim();
        if (/\d{2}:\d{2}\s*-\s*\d{2}:\d{2}/.test(s)) slots.push(s);
      }
      if (slots.length > 0) {
        totalSlots    = slots.length;
        horarioInicio = slots[0].split(/\s*-\s*/)[0].trim();
        try { duracaoMin = minutesBetween(slots[0].split(/\s*-\s*/)[0].trim(), slots[0].split(/\s*-\s*/)[1].trim()); } catch { /**/ }
        hasIntervalo  = false;
        intervaloApos = totalSlots;
        for (let i = 1; i < slots.length; i++) {
          const prevEnd  = slots[i - 1].split(/\s*-\s*/)[1].trim();
          const curStart = slots[i].split(/\s*-\s*/)[0].trim();
          if (prevEnd !== curStart) {
            hasIntervalo  = true;
            intervaloApos = i;
            intervDurMin  = minutesBetween(prevEnd, curStart);
            break;
          }
        }
      }
      continue;
    }

    if (first.includes("arrayTurmas")) {
      const turmaNome = afterSemi(first).trim();
      if (!turmaNome) continue;
      if (!turmaMap.has(turmaNome)) {
        turmaMap.set(turmaNome, { id: newId(), nome: turmaNome, turno: turnoGlobal, serie: "", anoLetivo: new Date().getFullYear() });
      }
      const turma = turmaMap.get(turmaNome)!;

      for (let r = 1; r <= totalSlots; r++) {
        const cell = String(rows[r]?.[0] ?? "").trim();
        if (!cell || cell === " ") continue;

        let discFull = "";
        let discAbrev = "";
        let profName  = "";

        // Extrair nome completo da 1ª cláusula document.write
        const fullM = cell.match(/document\.write\("([^"]+)"\)\s*;\s*\}\s*else\s*\{/);
        if (fullM) {
          const parts = fullM[1].split(/\s*\/\s*/);
          if (parts.length >= 2) { discFull = parts[0].trim(); profName = parts.slice(1).join("/").trim(); }
        }
        // Abreviação da cláusula else
        const abrevM = cell.match(/\}else\s*\{[^}]*document\.write\("([^"]+)"\)/);
        if (abrevM) discAbrev = abrevM[1].split(/\s*\/\s*/)[0].trim();
        // Fallback: texto após último "}"
        if (!discFull) {
          const fb = afterBrace(cell).trim();
          const parts = fb.split(/\s*\/\s*/);
          if (parts.length >= 2) { discAbrev = parts[0].trim(); discFull = parts[0].trim(); profName = parts.slice(1).join("/").trim(); }
        }
        if (!discAbrev) discAbrev = discFull;
        if (!discFull || !profName) continue;

        const discKey = discFull.toUpperCase();
        if (!discMap.has(discKey)) {
          discMap.set(discKey, { id: newId(), nome: titleCase(discFull), abreviacao: discAbrev.slice(0, 8).toUpperCase(), cor: nextColor(), cargaHorariaSemanal: 0 });
        }
        const disc = discMap.get(discKey)!;

        const profKey = profName.toUpperCase();
        if (!profMap.has(profKey)) {
          profMap.set(profKey, { id: newId(), nomeCompleto: titleCase(profName), disciplinas: [], turmas: [], disponibilidade: {}, cargaHorariaMaximaSemanal: 40 });
        }
        const prof = profMap.get(profKey)!;
        if (!prof.disciplinas.includes(disc.id)) prof.disciplinas.push(disc.id);

        alocList.push({ id: newId(), turmaId: turma.id, disciplinaId: disc.id, professorId: prof.id, diaSemana: currentDay, horario: r });

        const mk = `${turma.id}-${disc.id}`;
        if (!matrizMap.has(mk)) matrizMap.set(mk, { turmaId: turma.id, disciplinaId: disc.id, aulasPorSemana: 0, count: 0 });
        matrizMap.get(mk)!.aulasPorSemana++;
      }
    }
  }

  const configOut: ConfiguracaoHorarios = {
    quantidadeHorariosPorDia: totalSlots, duracaoAulaMinutos: duracaoMin,
    horarioInicial: turnoGlobal === "tarde" ? "07:00" : horarioInicio,
    possuiIntervalo: hasIntervalo,
    horarioIntervalo: intervaloApos, duracaoIntervaloMinutos: hasIntervalo ? intervDurMin : 15,
    habilitarTarde: turnoGlobal === "tarde",
    horarioInicialTarde: turnoGlobal === "tarde" ? horarioInicio : "12:00",
    quantidadeHorariosPorDiaTarde: turnoGlobal === "tarde" ? totalSlots : 5,
    duracaoAulaMinutosTarde: turnoGlobal === "tarde" ? duracaoMin : 50,
    possuiIntervaloTarde: turnoGlobal === "tarde" ? hasIntervalo : true,
    horarioIntervaloTarde: turnoGlobal === "tarde" ? intervaloApos : 3,
    duracaoIntervaloMinutosTarde: turnoGlobal === "tarde" ? (hasIntervalo ? intervDurMin : 15) : 15,
    habilitarNoite: false,
    horarioInicialNoite: "19:00",
    quantidadeHorariosPorDiaNoite: 4,
    duracaoAulaMinutosNoite: 50,
    possuiIntervaloNoite: false,
    horarioIntervaloNoite: 2,
    duracaoIntervaloMinutosNoite: 15,
  };

  const turmas       = Array.from(turmaMap.values());
  const disciplinas  = Array.from(discMap.values());
  const professores  = Array.from(profMap.values());
  const matrizArr    = Array.from(matrizMap.values()).map(({ count: _c, ...rest }) => rest);

  return {
    turmas, disciplinas, professores, alocacoes: alocList, config: configOut, matriz: matrizArr,
    escola, turno: turnoGlobal,
    stats: { turmas: turmas.length, disciplinas: disciplinas.length, professores: professores.length, alocacoes: alocList.length },
  };
}

export default function Exportar() {
  const [turmas] = useTurmas();
  const [professores] = useProfessores();
  const [disciplinas] = useDisciplinas();
  const [alocacoes] = useAlocacoes();
  const [config] = useConfiguracaoHorarios();
  const [matriz] = useMatrizCurricular();
  const jsonFileInputRef   = useRef<HTMLInputElement>(null);
  const excelFileInputRef  = useRef<HTMLInputElement>(null);
  const cronosFileInputRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview]     = useState<{ stats: Record<string, number>; converted: ReturnType<typeof convertExternalBackup> } | null>(null);
  const [cronosPreview, setCronosPreview]     = useState<ReturnType<typeof parseCronosXls> | null>(null);
  const { toast } = useToast();
  const [, navigate] = useLocation();

  // ── PDF ──────────────────────────────────────────────────────────────────
  function handleExportPDF() {
    navigate("/grade-completa?autoprint=1");
  }

  // ── JSON ─────────────────────────────────────────────────────────────────
  function exportJSON() {
    const backup = {
      version: "2",
      exportedAt: new Date().toISOString(),
      data: { turmas, disciplinas, professores, alocacoes, config, matriz },
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `eduhorarios-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "JSON exportado com sucesso" });
    setTimeout(() => navigate("/"), 1500);
  }

  // ── EXCEL EXPORT ─────────────────────────────────────────────────────────
  function exportExcel() {
    const wb = XLSX.utils.book_new();
    const timeSlots = generateTimeSlots(config);
    const periods = timeSlots.filter((s) => !s.isBreak);
    const safeSheet = (name: string) => name.replace(/[\/\\*\[\]?:]/g, "").slice(0, 31);
    const colWidths = [{ wch: 16 }, ...DIAS.map(() => ({ wch: 24 }))];

    // Sheet per turma
    const turmasSorted = [...turmas].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    for (const turma of turmasSorted) {
      const rows: string[][] = [
        ["Horário", ...DIAS.map((d) => DIA_LABELS_FULL[d])],
      ];
      for (const slot of periods) {
        const row: string[] = [`${slot.start} – ${slot.end}`];
        for (const dia of DIAS) {
          const aloc = alocacoes.find(
            (a) => a.turmaId === turma.id && a.diaSemana === dia && a.horario === slot.period
          );
          if (aloc) {
            const disc = disciplinas.find((d) => d.id === aloc.disciplinaId);
            const prof = professores.find((p) => p.id === aloc.professorId);
            row.push(`${disc?.abreviacao ?? "?"} — ${prof?.nomeCompleto ?? "?"}`);
          } else {
            row.push("");
          }
        }
        rows.push(row);
      }
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = colWidths;
      XLSX.utils.book_append_sheet(wb, ws, safeSheet(turma.nome));
    }

    // Sheet per professor
    const profsSorted = [...professores].sort((a, b) => a.nomeCompleto.localeCompare(b.nomeCompleto, "pt-BR"));
    for (const prof of profsSorted) {
      const profAlocs = alocacoes.filter((a) => a.professorId === prof.id);
      if (profAlocs.length === 0) continue;
      const rows: string[][] = [
        ["Horário", ...DIAS.map((d) => DIA_LABELS_FULL[d])],
      ];
      for (const slot of periods) {
        const row: string[] = [`${slot.start} – ${slot.end}`];
        for (const dia of DIAS) {
          const aloc = profAlocs.find((a) => a.diaSemana === dia && a.horario === slot.period);
          if (aloc) {
            const turma = turmas.find((t) => t.id === aloc.turmaId);
            const disc = disciplinas.find((d) => d.id === aloc.disciplinaId);
            row.push(`${turma?.nome ?? "?"} (${disc?.abreviacao ?? "?"})`);
          } else {
            row.push("");
          }
        }
        rows.push(row);
      }
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = colWidths;
      const sheetName = safeSheet(prof.nomeCompleto.split(" ").slice(0, 2).join(" "));
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    // Hidden data sheet for round-trip import
    const backup = {
      version: "2",
      exportedAt: new Date().toISOString(),
      data: { turmas, disciplinas, professores, alocacoes, config, matriz },
    };
    const dataWs = XLSX.utils.aoa_to_sheet([[JSON.stringify(backup)]]);
    XLSX.utils.book_append_sheet(wb, dataWs, "_EduDados_");

    XLSX.writeFile(wb, `eduhorarios-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast({ title: "Excel exportado com sucesso", description: `${turmasSorted.length} turmas + ${profsSorted.filter(p => alocacoes.some(a => a.professorId === p.id)).length} professores` });
    setTimeout(() => navigate("/"), 1500);
  }

  // ── APPLY IMPORT ─────────────────────────────────────────────────────────
  async function applyImport(data: { turmas?: Turma[]; disciplinas?: Disciplina[]; professores?: Professor[]; alocacoes?: Alocacao[]; config?: ConfiguracaoHorarios; matriz?: MatrizCurricular[] }) {
    // 1. Salvar os dados localmente no LocalStorage primeiro
    if (data.turmas)      localStorage.setItem(storageKey("edu_turmas"),      JSON.stringify(data.turmas));
    if (data.disciplinas) localStorage.setItem(storageKey("edu_disciplinas"),  JSON.stringify(data.disciplinas));
    if (data.professores) localStorage.setItem(storageKey("edu_professores"),  JSON.stringify(data.professores));
    if (data.alocacoes)   localStorage.setItem(storageKey("edu_alocacoes"),    JSON.stringify(data.alocacoes));
    if (data.matriz)      localStorage.setItem(storageKey("edu_matriz"),       JSON.stringify(data.matriz));

    // Ativa automaticamente o turno da tarde se alguma turma importada exigir
    const hasTarde = data.turmas?.some(t => t.turno === "tarde") ?? false;
    let configFinal = data.config;
    if (data.config) {
      configFinal = {
        ...data.config,
        habilitarTarde: data.config.habilitarTarde || hasTarde,
      };
      localStorage.setItem(storageKey("edu_config"), JSON.stringify(configFinal));
    }

    localStorage.setItem(storageKey("edu_initialized"), "true");

    // 2. Sincronizar dados importados
    try {
      await Promise.all([
        data.turmas ? syncTurmas(data.turmas) : Promise.resolve(),
        data.disciplinas ? syncDisciplinas(data.disciplinas) : Promise.resolve(),
        data.matriz ? syncMatriz(data.matriz) : Promise.resolve(),
        data.professores ? syncProfessores(data.professores) : Promise.resolve(),
        data.alocacoes ? syncAlocacoes(data.alocacoes) : Promise.resolve(),
        configFinal ? syncConfig(configFinal) : Promise.resolve()
      ]);
    } catch (err) {
      console.error("Falha ao sincronizar dados importados:", err);
    }

    setImportPreview(null);
    toast({ title: "Dados importados com sucesso!", description: hasTarde && !(data.config?.habilitarTarde) ? "Turno vespertino ativado automaticamente." : undefined });
    setTimeout(() => { navigate("/"); window.location.reload(); }, 1200);
  }

  // ── JSON IMPORT ───────────────────────────────────────────────────────────
  function handleImportJSON(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        if (parsed.data && parsed.data.turmas) {
          applyImport(parsed.data);
          return;
        }
        if (parsed.profs && parsed.turmas && parsed.grade) {
          const converted = convertExternalBackup(parsed as ExternalBackup);
          setImportPreview({ stats: converted.stats, converted });
          return;
        }
        throw new Error("Formato não reconhecido");
      } catch (err) {
        toast({ title: "Erro ao ler o arquivo", description: err instanceof Error ? err.message : "Arquivo inválido.", variant: "destructive" });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  // ── CRONOS XLS IMPORT ────────────────────────────────────────────────────
  function handleImportCronos(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result as ArrayBuffer, { type: "array" });
        if (!wb.SheetNames.some((n) => wb.Sheets[n] && XLSX.utils.sheet_to_json<string[]>(wb.Sheets[n], { header: 1, defval: "" })[0]?.[0]?.includes?.("arrayDias"))) {
          throw new Error("Este arquivo não parece ser um export do Cronos Horário.");
        }
        const result = parseCronosXls(wb);
        if (result.alocacoes.length === 0 && result.turmas.length === 0) {
          throw new Error("Nenhuma alocação encontrada. Verifique se o arquivo XLS é do Cronos Horário.");
        }
        setCronosPreview(result);
      } catch (err) {
        toast({ title: "Erro ao ler arquivo Cronos", description: err instanceof Error ? err.message : "Arquivo inválido.", variant: "destructive" });
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  }

  function applyCronosImport() {
    if (!cronosPreview) return;
    applyImport({
      turmas:       cronosPreview.turmas,
      disciplinas:  cronosPreview.disciplinas,
      professores:  cronosPreview.professores,
      alocacoes:    cronosPreview.alocacoes,
      config:       cronosPreview.config,
      matriz:       cronosPreview.matriz,
    });
    localStorage.setItem(storageKey("edu_escola_nome"), cronosPreview.escola);
    setCronosPreview(null);
  }

  // ── EXCEL IMPORT ──────────────────────────────────────────────────────────
  function handleImportExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result as ArrayBuffer, { type: "array" });
        const dataSheet = wb.Sheets["_EduDados_"];
        if (dataSheet) {
          const cellValue = dataSheet["A1"]?.v;
          if (typeof cellValue === "string") {
            const parsed = JSON.parse(cellValue);
            if (parsed.data && parsed.data.turmas) {
              applyImport(parsed.data);
              return;
            }
          }
        }
        throw new Error("Arquivo Excel não reconhecido. Use um arquivo gerado pelo EduHorários.");
      } catch (err) {
        toast({ title: "Erro ao ler o arquivo Excel", description: err instanceof Error ? err.message : "Arquivo inválido.", variant: "destructive" });
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  }

  const timeSlots = generateTimeSlots(config);
  const periods = Array.from({ length: config.quantidadeHorariosPorDia }, (_, i) => i + 1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Exportar / Importar</h1>
        <p className="text-muted-foreground mt-1">Exporte, importe ou faça backup dos dados</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">

        {/* ── EXPORTAR ── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Download className="w-4 h-4" />
              Exportar
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button className="w-full justify-start" variant="outline" onClick={handleExportPDF} data-testid="button-export-pdf">
              <FileText className="w-4 h-4 mr-2 text-red-500" />
              Exportar PDF (Horário Completo)
            </Button>
            <Button className="w-full justify-start" variant="outline" onClick={exportExcel} data-testid="button-export-excel">
              <FileSpreadsheet className="w-4 h-4 mr-2 text-green-600" />
              Exportar Excel (.xlsx)
            </Button>
            <Button className="w-full justify-start" variant="outline" onClick={exportJSON} data-testid="button-export-json">
              <FileJson className="w-4 h-4 mr-2 text-blue-500" />
              Exportar JSON (Backup Completo)
            </Button>
            <Separator className="my-1" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              <strong>PDF:</strong> abre o horário completo pronto para imprimir ou salvar como PDF.<br />
              <strong>Excel:</strong> gera um ficheiro .xlsx com uma folha por turma e por professor.<br />
              <strong>JSON:</strong> backup completo de todos os dados para restauração posterior.
            </p>
          </CardContent>
        </Card>

        {/* ── IMPORTAR ── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Upload className="w-4 h-4" />
              Importar / Simulador
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              className="w-full justify-start" variant="outline"
              onClick={() => excelFileInputRef.current?.click()}
              data-testid="button-import-excel"
            >
              <FileSpreadsheet className="w-4 h-4 mr-2 text-green-600" />
              Importar Excel (.xlsx)
            </Button>
            <Button
              className="w-full justify-start" variant="outline"
              onClick={() => jsonFileInputRef.current?.click()}
              data-testid="button-import-json"
            >
              <FileJson className="w-4 h-4 mr-2 text-blue-500" />
              Importar JSON (Backup)
            </Button>
            <Button
              className="w-full justify-start bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900 hover:bg-blue-100 dark:hover:bg-blue-950/40" 
              variant="outline"
              asChild
            >
              <Link href="/importar">
                <span className="flex items-center gap-2 cursor-pointer w-full">
                  <Sparkles className="w-4 h-4 text-blue-500 shrink-0" />
                  Importação de Matriz & Simulação JSON
                </span>
              </Link>
            </Button>
            <input ref={jsonFileInputRef}    type="file" accept=".json"       className="hidden" onChange={handleImportJSON} />
            <input ref={excelFileInputRef}   type="file" accept=".xlsx,.xls"  className="hidden" onChange={handleImportExcel} />
            <Separator className="my-1" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              <strong>Excel:</strong> apenas ficheiros exportados pelo EduHorários.<br />
              <strong>JSON:</strong> aceita backup nativo ou ficheiros de backup externos.<br />
              <strong>Simulação:</strong> cole códigos JSON para gerar turmas e professores automaticamente.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Import preview panel */}
      {importPreview && (
        <Card className="border-amber-300 dark:border-amber-700 bg-amber-50/40 dark:bg-amber-950/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              Confirmar Importação
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Os dados abaixo serão importados, <strong>substituindo todos os dados atuais</strong>. Revise e confirme.
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                { label: "Turmas", value: importPreview.stats.turmas },
                { label: "Disciplinas", value: importPreview.stats.disciplinas },
                { label: "Professores", value: importPreview.stats.professores },
                { label: "Alocações na grade", value: importPreview.stats.alocacoes },
              ].map((s) => (
                <Badge key={s.label} variant="secondary" className="text-sm px-3 py-1">
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 text-green-600" />
                  {s.value} {s.label}
                </Badge>
              ))}
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <p><strong>Turmas:</strong> {importPreview.converted.turmas.map((t) => t.nome).join(", ")}</p>
              <p><strong>Professores:</strong> {importPreview.converted.professores.map((p) => p.nomeCompleto).join(", ")}</p>
              <p><strong>Disciplinas:</strong> {importPreview.converted.disciplinas.map((d) => d.nome).join(", ")}</p>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => applyImport(importPreview.converted)}>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Confirmar Importação
              </Button>
              <Button variant="outline" onClick={() => setImportPreview(null)}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Print-only grids (hidden on screen, visible when printing via window.print()) */}
      <div className="print-only hidden">
        {turmas.map((turma) => {
          const turmaAlocacoes = alocacoes.filter((a) => a.turmaId === turma.id);
          return (
            <div key={turma.id} className="print-break-inside-avoid mb-8">
              <h2 className="text-lg font-bold mb-2">Grade de Horários — {turma.nome}</h2>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="border border-gray-300 p-2 text-left bg-gray-50">Horário</th>
                    {DIAS.map((d) => (
                      <th key={d} className="border border-gray-300 p-2 text-center bg-gray-50">{DIA_LABELS[d]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {timeSlots.map((slot, idx) => {
                    if (slot.isBreak) {
                      return (
                        <tr key={`break-${idx}`}>
                          <td colSpan={6} className="border border-gray-300 p-1 text-center text-xs bg-gray-50 text-gray-500">
                            Intervalo — {slot.start} às {slot.end}
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={slot.period}>
                        <td className="border border-gray-300 p-2">
                          <p className="font-semibold">{slot.period}º</p>
                          <p className="text-xs text-gray-500">{slot.start}–{slot.end}</p>
                        </td>
                        {DIAS.map((dia) => {
                          const aloc = turmaAlocacoes.find((a) => a.diaSemana === dia && a.horario === slot.period);
                          const disc = aloc ? disciplinas.find((d) => d.id === aloc.disciplinaId) : null;
                          const prof = aloc ? professores.find((p) => p.id === aloc.professorId) : null;
                          return (
                            <td key={dia} className="border border-gray-300 p-2 text-center">
                              {disc ? (
                                <div>
                                  <p className="font-bold text-xs">{disc.abreviacao}</p>
                                  <p className="text-[10px] text-gray-600">{prof?.nomeCompleto.split(" ")[0]}</p>
                                </div>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}

        {professores.map((prof) => {
          const profAlocacoes = alocacoes.filter((a) => a.professorId === prof.id);
          if (profAlocacoes.length === 0) return null;
          return (
            <div key={prof.id} className="print-break-inside-avoid mb-8">
              <h2 className="text-lg font-bold mb-2">Horário do Professor — {prof.nomeCompleto}</h2>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="border border-gray-300 p-2 text-left bg-gray-50">Horário</th>
                    {DIAS.map((d) => (
                      <th key={d} className="border border-gray-300 p-2 text-center bg-gray-50">{DIA_LABELS[d]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {periods.map((h) => {
                    const slot = timeSlots.find((s) => !s.isBreak && s.period === h);
                    return (
                      <tr key={h}>
                        <td className="border border-gray-300 p-2">
                          <p className="font-semibold">{h}º</p>
                          {slot && <p className="text-xs text-gray-500">{slot.start}–{slot.end}</p>}
                        </td>
                        {DIAS.map((dia) => {
                          const aloc = profAlocacoes.find((a) => a.diaSemana === dia && a.horario === h);
                          const disc = aloc ? disciplinas.find((d) => d.id === aloc.disciplinaId) : null;
                          const turma = aloc ? turmas.find((t) => t.id === aloc.turmaId) : null;
                          return (
                            <td key={dia} className="border border-gray-300 p-2 text-center">
                              {disc && turma ? (
                                <div>
                                  <p className="font-bold text-xs">{disc.abreviacao}</p>
                                  <p className="text-[10px] text-gray-600">{turma.nome}</p>
                                </div>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
