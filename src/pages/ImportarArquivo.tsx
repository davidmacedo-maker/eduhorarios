import { useState, useRef, useCallback, useMemo } from "react";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import {
  useProfessores,
  useDisciplinas,
  useTurmas,
  useAlocacoes,
  useMatrizCurricular,
  useConfiguracaoHorarios,
  generateId,
} from "@/store";
import type { Professor, Disciplina, Turma, Alocacao, MatrizCurricular, ConfiguracaoHorarios, Disponibilidade } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  FileJson,
  Upload,
  X,
  Save,
  Eye,
  Pencil,
  RefreshCw,
  Info,
  Loader2,
  Files,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCEPTED_TYPES = [".pdf", ".xlsx", ".xls", ".csv", ".json"];
const MAX_FILE_MB = 10;

const DIAS_MAP: Record<string, string> = {
  segunda: "segunda", "segunda-feira": "segunda", seg: "segunda", mon: "segunda", "2": "segunda",
  terça: "terca", "terça-feira": "terca", ter: "terca", tue: "terca", "3": "terca",
  quarta: "quarta", "quarta-feira": "quarta", qua: "quarta", wed: "quarta", "4": "quarta",
  quinta: "quinta", "quinta-feira": "quinta", qui: "quinta", thu: "quinta", "5": "quinta",
  sexta: "sexta", "sexta-feira": "sexta", sex: "sexta", fri: "sexta", "6": "sexta",
};

const TURNO_MAP: Record<string, string> = {
  manhã: "manha", manha: "manha", morning: "manha", m: "manha", "1": "manha",
  tarde: "tarde", afternoon: "tarde", t: "tarde", "2": "tarde",
  noite: "noite", night: "noite", n: "noite", "3": "noite",
};

function detectTurnoFromTurmaName(nome: string): "manha" | "tarde" | "noite" | null {
  const n = nome.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/[-_\s.](m|mat|manha|matutino)(\s|$)/.test(n) || /\bmatutino\b|\bmanha\b/.test(n)) return "manha";
  if (/[-_\s.](v|ves|tard|tarde|vespertino)(\s|$)/.test(n) || /\bvespertino\b|\btarde\b/.test(n)) return "tarde";
  if (/[-_\s.](n|not|noit|noite|noturno)(\s|$)/.test(n) || /\bnoturno\b|\bnoite\b/.test(n)) return "noite";
  return null;
}

const CORES = [
  "#3B82F6","#22C55E","#F97316","#A855F7","#EF4444",
  "#0EA5E9","#F59E0B","#10B981","#EC4899","#6366F1",
  "#14B8A6","#F43F5E","#8B5CF6","#84CC16","#06B6D4",
];

const DIAS_ORDER = ["segunda", "terca", "quarta", "quinta", "sexta"];

// ─── Types ────────────────────────────────────────────────────────────────────

type ParseStep = "idle" | "reading" | "parsing" | "review" | "done" | "error";
type FileStatus = "pending" | "processing" | "done" | "error";

interface RawRow {
  professor?: string;
  disciplina?: string;
  turma?: string;
  dia?: string;
  horario?: string | number;
  turno?: string;
  masp?: string;
  cargo?: string;
}

interface ParsedData {
  professores: Professor[];
  disciplinas: Disciplina[];
  turmas: Turma[];
  alocacoes: Alocacao[];
  matriz: MatrizCurricular[];
  config?: ConfiguracaoHorarios;
  raw: RawRow[];
  format: string;
  pdfText?: string;
}

interface FileEntry {
  file: File;
  status: FileStatus;
  turnoDetected: "manha" | "tarde" | "noite" | null;
  turnoOverride?: "manha" | "tarde" | "noite";
  result?: ParsedData;
  error?: string;
}

interface Conflict {
  tipo: "professor" | "turma" | "disciplina" | "alocacao";
  descricao: string;
  severity: "warning" | "info";
}

// ─── Turno detection from filename ────────────────────────────────────────────

function detectTurnoFromFilename(name: string): "manha" | "tarde" | "noite" | null {
  const n = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/matutino|manha|manha|morning/.test(n)) return "manha";
  if (/vespertino|tarde|afternoon/.test(n)) return "tarde";
  if (/noturno|noite|night/.test(n)) return "noite";
  return null;
}

function turnoLabel(t: "manha" | "tarde" | "noite"): string {
  return t === "manha" ? "Matutino" : t === "tarde" ? "Vespertino" : "Noturno";
}

function applyTurnoToData(data: ParsedData, turno: "manha" | "tarde" | "noite"): ParsedData {
  return {
    ...data,
    turmas: data.turmas.map(t => ({ ...t, turno: turno as Turma["turno"] })),
  };
}

// ─── Merge multiple ParsedData into one ──────────────────────────────────────

function mergeMultipleResults(
  entries: { data: ParsedData; turno: "manha" | "tarde" | "noite" | null; filename: string }[]
): ParsedData {
  if (entries.length === 0) {
    return { professores: [], disciplinas: [], turmas: [], alocacoes: [], matriz: [], raw: [], format: "multi" };
  }
  if (entries.length === 1) {
    const e = entries[0];
    return e.turno ? applyTurnoToData(e.data, e.turno) : e.data;
  }

  const processed = entries.map(e => ({
    ...e,
    data: e.turno ? applyTurnoToData(e.data, e.turno) : e.data,
  }));

  const profMap   = new Map<string, Professor>();
  const discMap   = new Map<string, Disciplina>();
  const turmaMap  = new Map<string, Turma>();
  const profIdRemap  = new Map<string, string>();
  const discIdRemap  = new Map<string, string>();
  const turmaIdRemap = new Map<string, string>();

  for (const { data: pd } of processed) {
    for (const p of pd.professores) {
      const key = p.nomeCompleto.toLowerCase().trim();
      if (!profMap.has(key)) {
        profMap.set(key, { ...p, disciplinas: [...p.disciplinas], turmas: [...p.turmas] });
        profIdRemap.set(p.id, p.id);
      } else {
        profIdRemap.set(p.id, profMap.get(key)!.id);
      }
    }
    for (const d of pd.disciplinas) {
      const key = d.nome.toLowerCase().trim();
      if (!discMap.has(key)) {
        discMap.set(key, { ...d });
        discIdRemap.set(d.id, d.id);
      } else {
        discIdRemap.set(d.id, discMap.get(key)!.id);
      }
    }
    for (const t of pd.turmas) {
      // Key includes turno so "6A Matutino" and "6A Vespertino" are NOT deduplicated
      const key = `${t.nome.toLowerCase().trim()}|${t.turno ?? "manha"}`;
      if (!turmaMap.has(key)) {
        turmaMap.set(key, { ...t });
        turmaIdRemap.set(t.id, t.id);
      } else {
        turmaIdRemap.set(t.id, turmaMap.get(key)!.id);
      }
    }
  }

  const mergedAlocs: Alocacao[] = [];
  const mergedMatriz: MatrizCurricular[] = [];

  for (const { data: pd } of processed) {
    for (const a of pd.alocacoes) {
      const profId  = profIdRemap.get(a.professorId)  ?? a.professorId;
      const discId  = discIdRemap.get(a.disciplinaId) ?? a.disciplinaId;
      const turmaId = turmaIdRemap.get(a.turmaId)     ?? a.turmaId;
      const dup = mergedAlocs.some(ea =>
        ea.professorId === profId && ea.turmaId === turmaId &&
        ea.disciplinaId === discId && ea.diaSemana === a.diaSemana && ea.horario === a.horario
      );
      if (!dup) {
        mergedAlocs.push({ id: generateId(), professorId: profId, disciplinaId: discId, turmaId, diaSemana: a.diaSemana, horario: a.horario });
        const prof = [...profMap.values()].find(p => p.id === profId);
        if (prof) {
          if (!prof.disciplinas.includes(discId)) prof.disciplinas.push(discId);
          if (!prof.turmas.includes(turmaId))     prof.turmas.push(turmaId);
        }
      }
    }
    for (const m of pd.matriz) {
      const discId  = discIdRemap.get(m.disciplinaId) ?? m.disciplinaId;
      const turmaId = turmaIdRemap.get(m.turmaId)     ?? m.turmaId;
      if (!mergedMatriz.some(em => em.turmaId === turmaId && em.disciplinaId === discId)) {
        mergedMatriz.push({ turmaId, disciplinaId: discId, aulasPorSemana: m.aulasPorSemana });
      }
    }
  }

  const allTurmas = Array.from(turmaMap.values());
  const hasTarde  = allTurmas.some(t => t.turno === "tarde");
  const hasNoite  = allTurmas.some(t => t.turno === "noite");

  // Identify which config belongs to each turno
  const manhaEntry = processed.find(e => e.data.turmas.some(t => t.turno === "manha") || (!e.data.turmas.some(t => t.turno === "tarde") && !e.data.turmas.some(t => t.turno === "noite")));
  const tardeEntry = processed.find(e => e.data.turmas.some(t => t.turno === "tarde"));
  const manhaConfig = manhaEntry?.data.config;
  const tardeConfig = tardeEntry?.data.config;

  let mergedConfig: ConfiguracaoHorarios | undefined;
  if (manhaConfig || tardeConfig) {
    const base = manhaConfig ?? tardeConfig!;
    mergedConfig = {
      ...base,
      habilitarTarde: hasTarde || hasNoite,
      ...(tardeConfig && (hasTarde || hasNoite) ? {
        horarioInicialTarde:          tardeConfig.horarioInicialTarde          ?? tardeConfig.horarioInicial          ?? "13:00",
        quantidadeHorariosPorDiaTarde: tardeConfig.quantidadeHorariosPorDiaTarde ?? tardeConfig.quantidadeHorariosPorDia ?? 5,
        duracaoAulaMinutosTarde:       tardeConfig.duracaoAulaMinutosTarde       ?? tardeConfig.duracaoAulaMinutos       ?? 50,
        possuiIntervaloTarde:          tardeConfig.possuiIntervaloTarde          ?? tardeConfig.possuiIntervalo          ?? true,
        horarioIntervaloTarde:         tardeConfig.horarioIntervaloTarde         ?? tardeConfig.horarioIntervalo         ?? 3,
        duracaoIntervaloMinutosTarde:  tardeConfig.duracaoIntervaloMinutosTarde  ?? tardeConfig.duracaoIntervaloMinutos  ?? 15,
      } : {}),
    };
  }

  return {
    professores: Array.from(profMap.values()),
    disciplinas: Array.from(discMap.values()),
    turmas: allTurmas,
    alocacoes: mergedAlocs,
    matriz: mergedMatriz,
    raw: [],
    format: "multi",
    config: mergedConfig,
  };
}

// ─── Column detector ──────────────────────────────────────────────────────────

function detectColumns(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((h, i) => {
    const hn = h.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    if (!map.professor && /^(professor|prof\b|docente|nome do prof|nome)/.test(hn)) map.professor = i;
    else if (!map.disciplina && /^(disciplina|disc\b|materia|subject|componente)/.test(hn)) map.disciplina = i;
    else if (!map.turma && /^(turma|classe|class\b|turno\/turma)/.test(hn)) map.turma = i;
    else if (!map.turno && /^(turno|periodo|manha|tarde|noite)/.test(hn)) map.turno = i;
    else if (!map.dia && /^(dia|semana|weekday|dia da semana)/.test(hn)) map.dia = i;
    else if (!map.horario && /^(horario|hora\b|aula\b|slot|periodo|order)/.test(hn)) map.horario = i;
    else if (!map.masp && /^(masp|matricula|registro|id)/.test(hn)) map.masp = i;
    else if (!map.cargo && /^(cargo|vinculo|funcao|tipo)/.test(hn)) map.cargo = i;
  });
  return map;
}

// ─── Convert raw rows to entities ─────────────────────────────────────────────

function buildEntities(rows: RawRow[], existingAno: number): ParsedData {
  const profMap  = new Map<string, Professor>();
  const discMap  = new Map<string, Disciplina>();
  const turmaMap = new Map<string, Turma>();
  const alocacoes: Alocacao[] = [];
  const matriz: MatrizCurricular[] = [];
  let colorIdx = 0;

  for (const row of rows) {
    const profNome  = row.professor?.trim();
    const discNome  = row.disciplina?.trim();
    const turmaNome = row.turma?.trim();
    const diaRaw    = row.dia?.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const horarioRaw = row.horario;
    const turnoRaw  = row.turno?.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const masp      = row.masp?.trim();

    if (!profNome && !discNome && !turmaNome) continue;

    let disc: Disciplina | undefined;
    if (discNome) {
      disc = discMap.get(discNome);
      if (!disc) {
        disc = {
          id: generateId(), nome: discNome,
          abreviacao: discNome.split(/\s+/).map(w => w[0]?.toUpperCase() ?? "").join("").slice(0, 5) || discNome.slice(0, 5).toUpperCase(),
          cor: CORES[colorIdx++ % CORES.length], cargaHorariaSemanal: 2,
        };
        discMap.set(discNome, disc);
      }
    }

    let prof: Professor | undefined;
    if (profNome) {
      prof = profMap.get(profNome);
      if (!prof) {
        const DEFAULT_DISP_HOURS = [1, 2, 3, 4, 5, 6, 11, 12, 13, 14, 15, 16, 21, 22, 23, 24];
        const DEFAULT_DISP = Object.fromEntries(DIAS_ORDER.map(d => [d, DEFAULT_DISP_HOURS]));
        prof = {
          id: generateId(), nomeCompleto: profNome, masp: masp || undefined,
          tipoVinculo: (row.cargo?.toLowerCase().includes("efetivo") ? "efetivo" : row.cargo?.toLowerCase().includes("designado") ? "designado" : undefined),
          disciplinas: [], turmas: [], disponibilidade: DEFAULT_DISP, cargaHorariaMaximaSemanal: 20,
        };
        profMap.set(profNome, prof);
      }
      if (disc && !prof.disciplinas.includes(disc.id)) prof.disciplinas.push(disc.id);
    }

    let turma: Turma | undefined;
    if (turmaNome) {
      turma = turmaMap.get(turmaNome);
      if (!turma) {
        const turnoNorm = turnoRaw
          ? (TURNO_MAP[turnoRaw] ?? detectTurnoFromTurmaName(turmaNome) ?? "manha")
          : (detectTurnoFromTurmaName(turmaNome) ?? "manha");
        turma = {
          id: generateId(), nome: turmaNome, turno: turnoNorm as "manha" | "tarde" | "noite",
          serie: turmaNome.replace(/\s*-\s*T\w+$/, "").replace(/\s*turma\s*\w+$/i, "").trim() || turmaNome,
          anoLetivo: existingAno, observacoes: "",
        };
        turmaMap.set(turmaNome, turma);
      }
      if (prof && !prof.turmas.includes(turma.id)) prof.turmas.push(turma.id);
    }

    const dia     = diaRaw ? (DIAS_MAP[diaRaw] ?? null) : null;
    const horario = horarioRaw != null ? parseInt(String(horarioRaw)) : null;
    if (prof && disc && turma && dia && horario && horario >= 1 && horario <= 10) {
      const exists = alocacoes.some(a =>
        a.professorId === prof!.id && a.turmaId === turma!.id &&
        a.disciplinaId === disc!.id && a.diaSemana === dia && a.horario === horario
      );
      if (!exists) {
        alocacoes.push({ id: generateId(), turmaId: turma.id, disciplinaId: disc.id, professorId: prof.id, diaSemana: dia, horario });
      }
    }

    if (disc && turma) {
      if (!matriz.some(m => m.turmaId === turma!.id && m.disciplinaId === disc!.id)) {
        matriz.push({ turmaId: turma.id, disciplinaId: disc.id, aulasPorSemana: 1 });
      } else {
        const idx = matriz.findIndex(m => m.turmaId === turma!.id && m.disciplinaId === disc!.id);
        matriz[idx] = { ...matriz[idx], aulasPorSemana: matriz[idx].aulasPorSemana + 1 };
      }
    }
  }

  // Populate planning for each generated professor profile
  for (const prof of profMap.values()) {
    const planItems: any[] = [];
    const seenPairs = new Set<string>();

    alocacoes.forEach(a => {
      if (a.professorId === prof.id) {
        const pairKey = `${a.turmaId}|${a.disciplinaId}`;
        if (!seenPairs.has(pairKey)) {
          seenPairs.add(pairKey);
          const mItem = matriz.find(m => m.turmaId === a.turmaId && m.disciplinaId === a.disciplinaId);
          const numAulas = mItem ? mItem.aulasPorSemana : 1;
          planItems.push({
            disciplinaId: a.disciplinaId,
            turmaId: a.turmaId,
            aulasPorSemana: numAulas,
            quantidadeAulas: numAulas
          });
        }
      }
    });
    prof.planejamento = planItems;
  }

  return {
    professores: Array.from(profMap.values()),
    disciplinas: Array.from(discMap.values()),
    turmas: Array.from(turmaMap.values()),
    alocacoes, matriz, raw: rows, format: "tabular",
  };
}

// ─── Excel / CSV parser ───────────────────────────────────────────────────────

function parseSheetData(data: unknown[][], format: string): ParsedData & { raw: RawRow[] } {
  if (data.length < 2) return { professores: [], disciplinas: [], turmas: [], alocacoes: [], matriz: [], raw: [], format };

  const headers = data[0].map(String);
  const colMap  = detectColumns(headers);
  const rows: RawRow[] = [];

  for (let i = 1; i < data.length; i++) {
    const r = data[i] as unknown[];
    if (!r.some(v => v !== null && v !== undefined && v !== "")) continue;
    rows.push({
      professor:  colMap.professor  !== undefined ? String(r[colMap.professor]  ?? "").trim() || undefined : undefined,
      disciplina: colMap.disciplina !== undefined ? String(r[colMap.disciplina] ?? "").trim() || undefined : undefined,
      turma:      colMap.turma      !== undefined ? String(r[colMap.turma]      ?? "").trim() || undefined : undefined,
      dia:        colMap.dia        !== undefined ? String(r[colMap.dia]        ?? "").trim() || undefined : undefined,
      horario:    colMap.horario    !== undefined ? r[colMap.horario] as string | number      || undefined : undefined,
      turno:      colMap.turno      !== undefined ? String(r[colMap.turno]      ?? "").trim() || undefined : undefined,
      masp:       colMap.masp       !== undefined ? String(r[colMap.masp]       ?? "").trim() || undefined : undefined,
      cargo:      colMap.cargo      !== undefined ? String(r[colMap.cargo]      ?? "").trim() || undefined : undefined,
    });
  }

  const result = buildEntities(rows, new Date().getFullYear());
  return { ...result, raw: rows, format };
}

// ─── PDF helpers ──────────────────────────────────────────────────────────────

function extractPdfTextFromBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const raw = Array.from(bytes, b => String.fromCharCode(b)).join("");
  const collected: string[] = [];

  const streamRe = /stream\r?\n([\s\S]*?)\nendstream/g;
  let sm: RegExpExecArray | null;
  while ((sm = streamRe.exec(raw)) !== null) {
    const stream = sm[1];
    const btEtRe = /BT([\s\S]*?)ET/g;
    let bm: RegExpExecArray | null;
    while ((bm = btEtRe.exec(stream)) !== null) {
      const block = bm[1];
      const parts: string[] = [];
      const litRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
      let lm: RegExpExecArray | null;
      while ((lm = litRe.exec(block)) !== null) {
        const s = lm[1].replace(/\\n/g,"\n").replace(/\\r/g,"\r").replace(/\\t/g,"\t").replace(/\\\\/g,"\\").replace(/\\\(/g,"(").replace(/\\\)/g,")");
        if (s.trim()) parts.push(s.trim());
      }
      const arrRe = /\[([\s\S]*?)\]\s*TJ/g;
      let am: RegExpExecArray | null;
      while ((am = arrRe.exec(block)) !== null) {
        const inner = am[1];
        const arrLitRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
        let al: RegExpExecArray | null;
        while ((al = arrLitRe.exec(inner)) !== null) {
          const s = al[1].replace(/\\\(/g,"(").replace(/\\\)/g,")").replace(/\\\\/g,"\\");
          if (s.trim()) parts.push(s.trim());
        }
      }
      if (parts.length > 0) collected.push(parts.join(" "));
    }
  }

  if (collected.length === 0) {
    return raw.replace(/[^\x20-\x7E\n]/g," ").split("\n").map(l => l.trim()).filter(l => l.length > 3 && /[A-Za-z]/.test(l)).join("\n");
  }
  return collected.join("\n");
}

function parseScheduleGrid(text: string): RawRow[] {
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim();
  const DIAS_GRID: Record<string,string> = {
    "segunda":"segunda","segunda-feira":"segunda","terca":"terca","terca-feira":"terca","terça":"terca","terca-f":"terca",
    "quarta":"quarta","quarta-feira":"quarta","quinta":"quinta","quinta-feira":"quinta","sexta":"sexta","sexta-feira":"sexta",
  };

  const rows: RawRow[] = [];
  let currentDia = "";
  let turmaHeaders: string[] = [];
  let horarioSeq = 0;

  for (const line of text.split(/\n/).map(l => l.trim()).filter(Boolean)) {
    const n = norm(line);
    const diaKey = Object.keys(DIAS_GRID).find(k => n === k || n.startsWith(k));
    if (diaKey) { currentDia = DIAS_GRID[diaKey]; horarioSeq = 0; turmaHeaders = []; continue; }
    if (/^#/.test(line) || /^[\s#\d]+$/.test(line)) {
      turmaHeaders = line.replace(/^#/,"").trim().split(/\s+/).filter(t => /^\d+$/.test(t)); continue;
    }
    const timeMatch = line.match(/^(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})(.*)/);
    if (timeMatch && currentDia) {
      horarioSeq++;
      const cells = timeMatch[3].trim().split(/\s{2,}|\t/).map(c => c.trim()).filter(Boolean);
      cells.forEach((cell, idx) => {
        const turma = turmaHeaders[idx]; if (!turma) return;
        const sep = cell.lastIndexOf(" / "); if (sep === -1) return;
        const disc = cell.slice(0, sep).trim(); const professor = cell.slice(sep + 3).trim();
        if (!disc || !professor) return;
        if (!rows.some(r => r.turma === turma && r.dia === currentDia && r.horario === horarioSeq && r.disciplina === disc)) {
          rows.push({ disciplina: disc, professor, turma, dia: currentDia, horario: horarioSeq });
        }
      });
      continue;
    }
    if (currentDia && turmaHeaders.length > 0 && horarioSeq > 0 && line.includes(" / ")) {
      const cells = line.split(/\s{2,}|\t/).map(c => c.trim()).filter(Boolean);
      if (cells.some(c => c.includes(" / "))) {
        cells.forEach((cell, idx) => {
          const turma = turmaHeaders[idx]; if (!turma) return;
          const sep = cell.lastIndexOf(" / "); if (sep === -1) return;
          const disc = cell.slice(0, sep).trim(); const professor = cell.slice(sep + 3).trim();
          if (!disc || !professor) return;
          if (!rows.some(r => r.turma === turma && r.dia === currentDia && r.horario === horarioSeq && r.disciplina === disc)) {
            rows.push({ disciplina: disc, professor, turma, dia: currentDia, horario: horarioSeq });
          }
        });
      }
    }
  }
  return rows;
}

function pdfTextToRows(text: string): RawRow[] {
  const rows: RawRow[] = [];
  for (const line of text.split(/\n+/).map(l => l.trim()).filter(Boolean)) {
    const parts = line.split(/\s{2,}|\t/).map(p => p.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const row: RawRow = {};
    for (const part of parts) {
      const lower = part.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
      const dia = DIAS_MAP[lower] ?? DIAS_MAP[lower.split(/[\s-]/)[0]];
      if (dia) { row.dia = dia; continue; }
      const turno = TURNO_MAP[lower];
      if (turno) { row.turno = turno; continue; }
      if (/^\d+[ºa°]?$/.test(part)) { const n = parseInt(part); if (n >= 1 && n <= 10) { row.horario = n; continue; } }
      if (part.length > 2 && /[A-Za-z]/.test(part)) {
        if (!row.professor) row.professor = part;
        else if (!row.disciplina) row.disciplina = part;
        else if (!row.turma) row.turma = part;
      }
    }
    if (row.professor || row.disciplina || row.turma) rows.push(row);
  }
  return rows;
}

// ─── Conflict detector ────────────────────────────────────────────────────────

function detectConflicts(
  parsed: ParsedData,
  existingProfs: Professor[],
  existingTurmas: Turma[],
  existingDiscs: Disciplina[],
  existingAlocs: Alocacao[],
): Conflict[] {
  const conflicts: Conflict[] = [];

  parsed.professores.forEach(p => {
    if (existingProfs.find(ep => ep.nomeCompleto.toLowerCase() === p.nomeCompleto.toLowerCase()))
      conflicts.push({ tipo: "professor", descricao: `Professor "${p.nomeCompleto}" já existe (será ignorado duplicado)`, severity: "warning" });
  });
  parsed.turmas.forEach(t => {
    if (existingTurmas.find(et => et.nome.toLowerCase() === t.nome.toLowerCase()))
      conflicts.push({ tipo: "turma", descricao: `Turma "${t.nome}" já existe (será ignorada)`, severity: "warning" });
  });
  parsed.disciplinas.forEach(d => {
    if (existingDiscs.find(ed => ed.nome.toLowerCase() === d.nome.toLowerCase()))
      conflicts.push({ tipo: "disciplina", descricao: `Disciplina "${d.nome}" já existe (será ignorada)`, severity: "info" });
  });

  const dupAlocs = parsed.alocacoes.filter(a => {
    const profNome = parsed.professores.find(p => p.id === a.professorId)?.nomeCompleto;
    const existProf = existingProfs.find(ep => ep.nomeCompleto.toLowerCase() === profNome?.toLowerCase());
    if (!existProf) return false;
    return existingAlocs.some(ea => ea.professorId === existProf.id && ea.diaSemana === a.diaSemana && ea.horario === a.horario);
  });
  if (dupAlocs.length > 0)
    conflicts.push({ tipo: "alocacao", descricao: `${dupAlocs.length} alocação(ões) já existem e serão ignoradas`, severity: "warning" });

  return conflicts;
}

// ─── File icon helper ─────────────────────────────────────────────────────────

function FileIcon({ ext }: { ext: string }) {
  if (ext === "pdf")  return <FileText       className="w-5 h-5 text-red-500"   />;
  if (ext === "json") return <FileJson       className="w-5 h-5 text-blue-500"  />;
  return                     <FileSpreadsheet className="w-5 h-5 text-green-600" />;
}

// ─── Per-file parsers (return ParsedData, no side-effects) ───────────────────

async function parseCSVFile(f: File): Promise<ParsedData> {
  const text = await f.text();
  const result = Papa.parse(text, { header: false, skipEmptyLines: true, dynamicTyping: true });
  return parseSheetData(result.data as unknown[][], "csv");
}

async function parseExcelFile(f: File): Promise<ParsedData> {
  const buf = await f.arrayBuffer();
  const wb  = XLSX.read(buf, { type: "array", cellDates: true });
  let bestSheet: unknown[][] = [];
  for (const sheetName of wb.SheetNames) {
    const arr = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, defval: "" });
    if (arr.length > bestSheet.length) bestSheet = arr;
  }
  return parseSheetData(bestSheet, "excel");
}

async function parsePDFFile(f: File): Promise<ParsedData> {
  const buf  = await f.arrayBuffer();
  const text = extractPdfTextFromBuffer(buf);
  const gridRows = parseScheduleGrid(text);
  if (gridRows.length > 0) {
    const result = buildEntities(gridRows, new Date().getFullYear());
    return { ...result, raw: gridRows, format: "pdf", pdfText: text };
  }
  const rows = pdfTextToRows(text);
  const result = buildEntities(rows, new Date().getFullYear());
  return { ...result, raw: rows, format: "pdf", pdfText: text };
}

function parseSimulationJSON(obj: any): ParsedData {
  const pgmName = String(obj.matriz ?? "Matriz de Simulação");
  const anoLetivo = Number(obj.ano_letivo ?? new Date().getFullYear());
  
  // Parse turmas
  const parsedTurmas: Turma[] = [];
  const rawTurmas = Array.isArray(obj.turmas) ? obj.turmas : [];
  const turmaCodeToId: Record<string, string> = {};
  
  rawTurmas.forEach((t: any) => {
    const rawTurno = String(t.turno ?? "").toLowerCase();
    let turno: "manha" | "tarde" | "noite" = "manha";
    if (rawTurno.includes("tarde") || rawTurno.includes("vespertino") || rawTurno === "tarde") turno = "tarde";
    else if (rawTurno.includes("noite") || rawTurno.includes("noturno") || rawTurno === "noite") turno = "noite";
    
    const id = generateId();
    if (t.codigo) {
      turmaCodeToId[String(t.codigo).trim().toUpperCase()] = id;
    }
    const tNome = String(t.nome ?? t.codigo ?? "Turma");
    turmaCodeToId[tNome.trim().toUpperCase()] = id;

    parsedTurmas.push({
      id,
      nome: tNome,
      turno,
      serie: String(t.codigo ?? t.nome ?? "Turma"),
      anoLetivo,
      observacoes: `Matriz: ${pgmName}${t.sala ? ` - Sala: ${t.sala}` : ""}${t.vagas ? ` - Vagas: ${t.vagas}` : ""}`,
    });
  });

  // Parse componentes curriculares
  const parsedDisciplinas: Disciplina[] = [];
  const parsedMatriz: MatrizCurricular[] = [];
  
  const rawComps = Array.isArray(obj.componentes_curriculares) ? obj.componentes_curriculares : [];
  let colorIdx = 0;
  const discNameToId: Record<string, string> = {};

  rawComps.forEach((comp: any) => {
    const discNome = String(comp.disciplina ?? "").trim();
    if (!discNome) return;
    
    const aulasSemanais = Number(comp.aulas_semanais ?? 1);
    
    // Create Disciplina
    const discId = generateId();
    discNameToId[discNome.toUpperCase()] = discId;

    const discAbrev = discNome
      .split(/\s+/)
      .map((w: string) => w[0]?.toUpperCase() ?? "")
      .join("")
      .slice(0, 5) || discNome.slice(0, 5).toUpperCase();
      
    parsedDisciplinas.push({
      id: discId,
      nome: discNome,
      abreviacao: discAbrev,
      cor: CORES[colorIdx++ % CORES.length],
      cargaHorariaSemanal: aulasSemanais,
    });

    // Create Matriz for each matching/eligible turma
    parsedTurmas.forEach((turma) => {
      parsedMatriz.push({
        turmaId: turma.id,
        disciplinaId: discId,
        aulasPorSemana: aulasSemanais,
      });
    });
  });

  const parsedProfessores: Professor[] = [];

  // Helper to map time ranges to slots
  function mapTimeRangesToSlots(ranges: string[]): number[] {
    const slots: number[] = [];
    
    const morningSlots = [
      { id: 1, start: 420, end: 470 }, // 07:00 - 07:50
      { id: 2, start: 470, end: 520 }, // 07:50 - 08:40
      { id: 3, start: 520, end: 570 }, // 08:40 - 09:30
      { id: 4, start: 570, end: 620 }, // 09:30 - 10:20
      { id: 5, start: 620, end: 670 }, // 10:20 - 11:10
      { id: 6, start: 670, end: 720 }, // 11:10 - 12:00
    ];
    
    const afternoonSlots = [
      { id: 11, start: 780, end: 830 }, // 13:00 - 13:50
      { id: 12, start: 830, end: 880 }, // 13:50 - 14:40
      { id: 13, start: 880, end: 930 }, // 14:40 - 15:30
      { id: 14, start: 930, end: 980 }, // 15:30 - 16:20
      { id: 15, start: 980, end: 1030 }, // 16:20 - 17:10
      { id: 16, start: 1030, end: 1080 }, // 17:10 - 18:00
    ];
    
    const nightSlots = [
      { id: 21, start: 1140, end: 1185 }, // 19:00 - 19:45
      { id: 22, start: 1185, end: 1230 }, // 19:45 - 20:30
      { id: 23, start: 1230, end: 1275 }, // 20:30 - 21:15
      { id: 24, start: 1275, end: 1320 }, // 21:15 - 22:00
    ];

    const allSlots = [...morningSlots, ...afternoonSlots, ...nightSlots];

    function toMin(t: string): number {
      const parts = t.trim().split(":");
      if (parts.length < 2) return 0;
      return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    }

    ranges.forEach(range => {
      if (/^\d+$/.test(range.trim())) {
        slots.push(parseInt(range.trim(), 10));
        return;
      }
      const parts = range.split("-");
      if (parts.length < 2) return;
      const startMin = toMin(parts[0]);
      const endMin = toMin(parts[1]);
      
      allSlots.forEach(s => {
        const overlapStart = Math.max(startMin, s.start);
        const overlapEnd = Math.min(endMin, s.end);
        if (overlapEnd - overlapStart >= 15) {
          if (!slots.includes(s.id)) {
            slots.push(s.id);
          }
        }
      });
    });

    return slots;
  }

  // If there's an explicit "professores" list (simular_alocacao_completa)
  if (Array.isArray(obj.professores) && obj.professores.length > 0) {
    const profIdMap: Record<string, string> = {};

    obj.professores.forEach((p: any) => {
      const profId = String(p.id ?? generateId());
      profIdMap[profId] = profId;

      const disp: Disponibilidade = {};
      const rawDisp = p.disponibilidade || {};
      
      const dayKeys = ["segunda", "terca", "quarta", "quinta", "sexta", "sabado", "domingo"];
      dayKeys.forEach(d => {
        const possibleKeys = [
          d,
          d.toUpperCase(),
          d.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
          d.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
        ];
        let foundRanges: string[] = [];
        for (const k of possibleKeys) {
          if (Array.isArray(rawDisp[k])) {
            foundRanges = rawDisp[k].map(String);
            break;
          }
        }
        if (foundRanges.length > 0) {
          disp[d] = mapTimeRangesToSlots(foundRanges);
        } else {
          disp[d] = [];
        }
      });

      const profDisciplines: string[] = [];
      const rawProfDiscs = Array.isArray(p.disciplinas) ? p.disciplinas : [];
      rawProfDiscs.forEach((dName: any) => {
        const dId = discNameToId[String(dName).trim().toUpperCase()];
        if (dId) {
          profDisciplines.push(dId);
        }
      });

      parsedProfessores.push({
        id: profId,
        nomeCompleto: String(p.nome ?? p.nomeCompleto ?? "Professor"),
        masp: String(p.masp ?? p.id ?? ""),
        dataAdmissao: p.admissao ?? p.dataAdmissao,
        cargo: p.cargo,
        disciplinas: profDisciplines,
        turmas: [],
        disponibilidade: disp,
        cargaHorariaMaximaSemanal: Number(p.carga_horaria_maxima ?? p.cargaHorariaMaximaSemanal ?? 40),
        planejamento: [],
      });
    });

    // Link turmas and planejamento items based on componentes_curriculares
    rawComps.forEach((comp: any) => {
      const discNome = String(comp.disciplina ?? "").trim();
      const discId = discNameToId[discNome.toUpperCase()];
      if (!discId) return;

      const aulasSemanais = Number(comp.aulas_semanais ?? 1);
      const assignedProfIds = Array.isArray(comp.professores) ? comp.professores.map(String) : [];

      assignedProfIds.forEach((origId: string) => {
        const resolvedId = profIdMap[origId];
        const teacher = parsedProfessores.find(tp => tp.id === resolvedId);
        if (teacher) {
          if (!teacher.disciplinas.includes(discId)) {
            teacher.disciplinas.push(discId);
          }
          
          parsedTurmas.forEach((turma) => {
            const hasAssignment = true;
            if (hasAssignment) {
              if (!teacher.turmas.includes(turma.id)) {
                teacher.turmas.push(turma.id);
              }
              if (!teacher.planejamento) {
                teacher.planejamento = [];
              }
              teacher.planejamento.push({
                disciplinaId: discId,
                turmaId: turma.id,
                aulasPorSemana: aulasSemanais,
                quantidadeAulas: aulasSemanais,
              });
            }
          });
        }
      });
    });

  } else {
    // Generate N professors based on "professores_disponiveis"
    rawComps.forEach((comp: any) => {
      const discNome = String(comp.disciplina ?? "").trim();
      const discId = discNameToId[discNome.toUpperCase()];
      if (!discId) return;

      const aulasSemanais = Number(comp.aulas_semanais ?? 1);
      const numProfs = Math.max(1, Number(comp.professores_disponiveis ?? 1));
      const prefHorario = String(comp.preferencia_horario ?? "flexivel").toLowerCase();
      
      let dispHours = [1, 2, 3, 4, 5, 6, 11, 12, 13, 14, 15, 16, 21, 22, 23, 24];
      if (prefHorario === "manha") {
        dispHours = [1, 2, 3, 4, 5, 6];
      } else if (prefHorario === "tarde") {
        dispHours = [11, 12, 13, 14, 15, 16];
      } else if (prefHorario === "noite") {
        dispHours = [21, 22, 23, 24];
      }

      const defaultDisp = Object.fromEntries(
        ["segunda", "terca", "quarta", "quinta", "sexta"].map(d => [d, dispHours])
      );

      const profsForThisComp: Professor[] = [];

      for (let i = 1; i <= numProfs; i++) {
        const suffix = numProfs > 1 ? ` ${String.fromCharCode(64 + i)}` : "";
        const profId = generateId();
        const prof: Professor = {
          id: profId,
          nomeCompleto: `Prof. ${discNome}${suffix}`,
          disciplinas: [discId],
          turmas: [],
          disponibilidade: defaultDisp,
          cargaHorariaMaximaSemanal: aulasSemanais * parsedTurmas.length,
          planejamento: [],
        };
        parsedProfessores.push(prof);
        profsForThisComp.push(prof);
      }

      parsedTurmas.forEach((turma, idx) => {
        let selectedProf = profsForThisComp[idx % profsForThisComp.length];
        
        if (!selectedProf.turmas.includes(turma.id)) {
          selectedProf.turmas.push(turma.id);
        }
        if (!selectedProf.planejamento) {
          selectedProf.planejamento = [];
        }
        selectedProf.planejamento.push({
          disciplinaId: discId,
          turmaId: turma.id,
          aulasPorSemana: aulasSemanais,
          quantidadeAulas: aulasSemanais,
        });
      });
    });
  }

  // Simulation parameters
  const params = obj.parametros_simulacao || {};
  const aulasPorDia = Number(params.aulas_por_dia ?? 6);
  let duracaoAula = Number(params.duracao_aula ?? 50);
  let intervalo = Number(params.intervalo ?? 10);

  if (Array.isArray(params.horarios) && params.horarios.length > 0) {
    const firstHorario = String(params.horarios[0]);
    const parts = firstHorario.split("-");
    if (parts.length === 2) {
      function toMin(t: string): number {
        const p = t.trim().split(":");
        if (p.length < 2) return 0;
        return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
      }
      const startMin = toMin(parts[0]);
      const endMin = toMin(parts[1]);
      if (endMin > startMin) {
        duracaoAula = endMin - startMin;
      }
    }
  }

  const hasTarde = parsedTurmas.some(t => t.turno === "tarde");
  const hasNoite = parsedTurmas.some(t => t.turno === "noite");

  const simConfig: ConfiguracaoHorarios = {
    quantidadeHorariosPorDia: aulasPorDia,
    duracaoAulaMinutos: duracaoAula,
    horarioInicial: "07:00",
    possuiIntervalo: true,
    horarioIntervalo: 3,
    duracaoIntervaloMinutos: intervalo,
    
    habilitarTarde: hasTarde || hasNoite,
    horarioInicialTarde: "13:00",
    quantidadeHorariosPorDiaTarde: aulasPorDia,
    duracaoAulaMinutosTarde: duracaoAula,
    possuiIntervaloTarde: true,
    horarioIntervaloTarde: 3,
    duracaoIntervaloMinutosTarde: intervalo,

    habilitarNoite: hasNoite,
    horarioInicialNoite: "19:00",
    quantidadeHorariosPorDiaNoite: Math.min(aulasPorDia, 4),
    duracaoAulaMinutosNoite: duracaoAula,
    possuiIntervaloNoite: false,
    horarioIntervaloNoite: 2,
    duracaoIntervaloMinutosNoite: 0,
  };

  return {
    professores: parsedProfessores,
    disciplinas: parsedDisciplinas,
    turmas: parsedTurmas,
    alocacoes: [],
    matriz: parsedMatriz,
    config: simConfig,
    raw: [],
    format: "json-simulation",
  };
}

async function parseJSONFile(f: File): Promise<ParsedData> {
  const text = await f.text();
  const raw  = JSON.parse(text) as unknown;

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;

    // Format Simulation: "acao": "simular_alocacao" or "simular_alocacao_completa"
    if (obj.acao === "simular_alocacao" || obj.acao === "simular_alocacao_completa") {
      return parseSimulationJSON(obj);
    }

    // Format A: native backup  { version, exportedAt, data: { turmas, ... } }
    if (obj.data && typeof obj.data === "object") {
      const d = obj.data as Record<string, unknown>;
      if (Array.isArray(d.turmas)) {
        return {
          professores: Array.isArray(d.professores) ? d.professores as Professor[] : [],
          disciplinas: Array.isArray(d.disciplinas) ? d.disciplinas as Disciplina[] : [],
          turmas:      Array.isArray(d.turmas)      ? d.turmas      as Turma[]      : [],
          alocacoes:   Array.isArray(d.alocacoes)   ? d.alocacoes   as Alocacao[]   : [],
          matriz:      Array.isArray(d.matriz)      ? d.matriz      as MatrizCurricular[] : [],
          config: d.config && typeof d.config === "object" ? d.config as ConfiguracaoHorarios : undefined,
          raw: [], format: "json-native",
        };
      }
    }

    // Format B: direct  { professores, disciplinas, turmas, alocacoes, matriz, config }
    // (generated by EduHorários converters and Cronos export tools)
    if (Array.isArray(obj.turmas)) {
      return {
        professores: Array.isArray(obj.professores) ? obj.professores as Professor[] : [],
        disciplinas: Array.isArray(obj.disciplinas) ? obj.disciplinas as Disciplina[] : [],
        turmas:      obj.turmas as Turma[],
        alocacoes:   Array.isArray(obj.alocacoes)   ? obj.alocacoes   as Alocacao[]   : [],
        matriz:      Array.isArray(obj.matriz)      ? obj.matriz      as MatrizCurricular[] : [],
        config: obj.config && typeof obj.config === "object" ? obj.config as ConfiguracaoHorarios : undefined,
        raw: [], format: "json-native",
      };
    }
  }

  let array: Record<string, unknown>[] = [];
  if (Array.isArray(raw)) {
    array = raw.filter(item => typeof item === "object" && item !== null) as Record<string, unknown>[];
  } else if (raw && typeof raw === "object") {
    for (const val of Object.values(raw as Record<string, unknown>)) {
      if (Array.isArray(val) && val.length > array.length && val[0] && typeof val[0] === "object")
        array = val as Record<string, unknown>[];
    }
  }
  if (array.length === 0) throw new Error("Nenhum array de dados encontrado.");

  const headers = Object.keys(array[0]);
  const grid: unknown[][] = [
    headers,
    ...array.map(obj => headers.map(h => {
      const v = obj[h];
      return v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    })),
  ];
  return parseSheetData(grid, "json");
}

async function parseSingleFile(f: File): Promise<ParsedData> {
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "csv")                  return parseCSVFile(f);
  if (ext === "xlsx" || ext === "xls") return parseExcelFile(f);
  if (ext === "pdf")                  return parsePDFFile(f);
  if (ext === "json")                 return parseJSONFile(f);
  throw new Error(`Formato não suportado: .${ext}`);
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function ImportarArquivo() {
  const [professores, setProfessores] = useProfessores();
  const [disciplinas, setDisciplinas] = useDisciplinas();
  const [turmas, setTurmas] = useTurmas();
  const [alocacoes, setAlocacoes] = useAlocacoes();
  const [, setMatriz] = useMatrizCurricular();
  const [config, setConfig] = useConfiguracaoHorarios();
  const { toast } = useToast();

  const [step, setStep]             = useState<ParseStep>("idle");
  const [progress, setProgress]     = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [error, setError]           = useState<string | null>(null);
  const [parsed, setParsed]         = useState<ParsedData | null>(null);
  const [conflicts, setConflicts]   = useState<Conflict[]>([]);
  const [dragging, setDragging]     = useState(false);
  const [pdfText, setPdfText]       = useState<string>("");
  const [activeTab, setActiveTab]   = useState("professores");
  const fileRef = useRef<HTMLInputElement>(null);

  const [pasteJson, setPasteJson]   = useState("");
  const [isPasteOpen, setIsPasteOpen] = useState(false);

  const [localParsed, setLocalParsed] = useState<ParsedData | null>(null);
  const [fileResults, setFileResults] = useState<{ data: ParsedData; filename: string }[]>([]);
  const data = localParsed ?? parsed;

  function handlePasteJsonSubmit() {
    try {
      const obj = JSON.parse(pasteJson);
      if (obj && typeof obj === "object" && (obj.acao === "simular_alocacao" || obj.acao === "simular_alocacao_completa")) {
        setStep("reading");
        setProgress(50);
        setProgressMsg("Processando JSON de simulação...");
        setTimeout(() => {
          try {
            const result = parseSimulationJSON(obj);
            finalize(result);
            toast({
              title: "Simulação de Alocação Processada!",
              description: "A matriz e os parâmetros da simulação foram carregados. Revise-os abaixo."
            });
          } catch (e: any) {
            setError("Erro ao interpretar dados do JSON: " + e.message);
            setStep("error");
          }
        }, 500);
      } else {
        setError("O JSON colado não está no formato correto de simulação (requer campo 'acao' como 'simular_alocacao' ou 'simular_alocacao_completa').");
      }
    } catch (err: any) {
      setError("Erro de Sintaxe no JSON: " + err.message);
    }
  }

  type ShiftDraft = {
    horarioInicial: string;
    quantidade: number;
    duracao: number;
    possuiIntervalo: boolean;
    aulaIntervalo: number;
    duracaoIntervalo: number;
  };

  const [shiftDraft, setShiftDraft] = useState<{
    manha: ShiftDraft;
    tarde: ShiftDraft;
    noite: ShiftDraft;
  }>(() => ({
    manha: { horarioInicial: config.horarioInicial, quantidade: config.quantidadeHorariosPorDia, duracao: config.duracaoAulaMinutos, possuiIntervalo: config.possuiIntervalo, aulaIntervalo: config.horarioIntervalo, duracaoIntervalo: config.duracaoIntervaloMinutos },
    tarde: { horarioInicial: config.horarioInicialTarde, quantidade: config.quantidadeHorariosPorDiaTarde, duracao: config.duracaoAulaMinutosTarde, possuiIntervalo: config.possuiIntervaloTarde, aulaIntervalo: config.horarioIntervaloTarde, duracaoIntervalo: config.duracaoIntervaloMinutosTarde },
    noite: { horarioInicial: config.horarioInicialNoite, quantidade: config.quantidadeHorariosPorDiaNoite, duracao: config.duracaoAulaMinutosNoite, possuiIntervalo: config.possuiIntervaloNoite, aulaIntervalo: config.horarioIntervaloNoite, duracaoIntervalo: config.duracaoIntervaloMinutosNoite },
  }));

  function resetShiftDraftFromConfig(cfg: ConfiguracaoHorarios, imported?: Partial<ConfiguracaoHorarios>) {
    setShiftDraft({
      manha: {
        horarioInicial:   imported?.horarioInicial              ?? cfg.horarioInicial,
        quantidade:       imported?.quantidadeHorariosPorDia    ?? cfg.quantidadeHorariosPorDia,
        duracao:          imported?.duracaoAulaMinutos          ?? cfg.duracaoAulaMinutos,
        possuiIntervalo:  imported?.possuiIntervalo             ?? cfg.possuiIntervalo,
        aulaIntervalo:    imported?.horarioIntervalo            ?? cfg.horarioIntervalo,
        duracaoIntervalo: imported?.duracaoIntervaloMinutos     ?? cfg.duracaoIntervaloMinutos,
      },
      tarde: {
        horarioInicial:   imported?.horarioInicialTarde              ?? cfg.horarioInicialTarde,
        quantidade:       imported?.quantidadeHorariosPorDiaTarde    ?? cfg.quantidadeHorariosPorDiaTarde,
        duracao:          imported?.duracaoAulaMinutosTarde          ?? cfg.duracaoAulaMinutosTarde,
        possuiIntervalo:  imported?.possuiIntervaloTarde             ?? cfg.possuiIntervaloTarde,
        aulaIntervalo:    imported?.horarioIntervaloTarde            ?? cfg.horarioIntervaloTarde,
        duracaoIntervalo: imported?.duracaoIntervaloMinutosTarde     ?? cfg.duracaoIntervaloMinutosTarde,
      },
      noite: {
        horarioInicial:   imported?.horarioInicialNoite              ?? cfg.horarioInicialNoite,
        quantidade:       imported?.quantidadeHorariosPorDiaNoite    ?? cfg.quantidadeHorariosPorDiaNoite,
        duracao:          imported?.duracaoAulaMinutosNoite          ?? cfg.duracaoAulaMinutosNoite,
        possuiIntervalo:  imported?.possuiIntervaloNoite             ?? cfg.possuiIntervaloNoite,
        aulaIntervalo:    imported?.horarioIntervaloNoite            ?? cfg.horarioIntervaloNoite,
        duracaoIntervalo: imported?.duracaoIntervaloMinutosNoite     ?? cfg.duracaoIntervaloMinutosNoite,
      },
    });
  }

  function updateShiftDraft(turno: "manha" | "tarde" | "noite", field: keyof ShiftDraft, value: string | number | boolean) {
    setShiftDraft(prev => ({ ...prev, [turno]: { ...prev[turno], [field]: value } }));
  }

  function effectiveTurno(entry: FileEntry): "manha" | "tarde" | "noite" | null {
    return entry.turnoOverride ?? entry.turnoDetected;
  }

  function handleTurnoChange(index: number, newTurno: "manha" | "tarde" | "noite") {
    const updatedEntries = fileEntries.map((e, i) =>
      i === index ? { ...e, turnoOverride: newTurno } : e
    );
    setFileEntries(updatedEntries);
    if (fileResults.length === 0) return;
    const mergeInputs = fileResults.map((r, i) => ({
      data: r.data,
      turno: (i === index ? newTurno : effectiveTurno(updatedEntries[i])) as "manha" | "tarde" | "noite" | null,
      filename: r.filename,
    }));
    const merged = mergeMultipleResults(mergeInputs);
    const cs = detectConflicts(merged, professores, turmas, disciplinas, alocacoes);
    setConflicts(cs);
    setParsed(merged);
    setLocalParsed(merged);
  }

  // ── Drag & drop handlers ────────────────────────────────────────────────────
  const onDragOver  = (e: React.DragEvent) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length > 0) handleFiles(dropped);
  }, []);
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length > 0) handleFiles(selected);
    e.target.value = "";
  };

  // ── File validation ─────────────────────────────────────────────────────────
  function validateFile(f: File): string | null {
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["pdf", "xlsx", "xls", "csv", "json"].includes(ext))
      return `Formato não suportado: .${ext}. Use PDF, XLSX, XLS, CSV ou JSON.`;
    if (f.size > MAX_FILE_MB * 1024 * 1024)
      return `"${f.name}" é muito grande (máximo ${MAX_FILE_MB}MB).`;
    return null;
  }

  // ── Main entry point ────────────────────────────────────────────────────────
  async function handleFiles(selected: File[]) {
    const valid: File[] = [];
    const errs: string[] = [];
    for (const f of selected) {
      const e = validateFile(f);
      if (e) errs.push(e); else valid.push(f);
    }
    if (valid.length === 0) { setError(errs[0] ?? "Nenhum arquivo válido selecionado."); return; }

    const entries: FileEntry[] = valid.map(f => ({
      file: f, status: "pending", turnoDetected: detectTurnoFromFilename(f.name),
    }));
    setFileEntries(entries);
    setError(errs.length > 0 ? `${errs.length} arquivo(s) ignorado(s): ${errs.join("; ")}` : null);
    setParsed(null);
    setLocalParsed(null);
    setConflicts([]);
    setPdfText("");
    setStep("reading");
    setProgress(0);

    await processAllFiles(valid, entries);
  }

  // ── Sequential file processing ──────────────────────────────────────────────
  async function processAllFiles(filesToProcess: File[], initialEntries: FileEntry[]) {
    const results: { data: ParsedData; turno: "manha" | "tarde" | "noite" | null; filename: string }[] = [];
    const entries = [...initialEntries];

    for (let i = 0; i < filesToProcess.length; i++) {
      const f = filesToProcess[i];
      entries[i] = { ...entries[i], status: "processing" };
      setFileEntries([...entries]);
      setProgressMsg(filesToProcess.length > 1
        ? `Arquivo ${i + 1} de ${filesToProcess.length}: ${f.name}`
        : `Lendo ${f.name}...`
      );
      setProgress(Math.round((i / filesToProcess.length) * 75));

      try {
        const result = await parseSingleFile(f);
        const turno  = entries[i].turnoDetected;
        results.push({ data: result, turno, filename: f.name });
        if (result.pdfText) setPdfText(prev => prev ? `${prev}\n\n— ${f.name} —\n${result.pdfText}` : result.pdfText!);
        entries[i] = { ...entries[i], status: "done", result };
      } catch (err) {
        entries[i] = { ...entries[i], status: "error", error: err instanceof Error ? err.message : "Erro desconhecido" };
        if (filesToProcess.length === 1) {
          setError(`Erro ao processar: ${entries[i].error}`);
          setStep("error");
          setFileEntries([...entries]);
          return;
        }
      }
      setFileEntries([...entries]);
    }

    if (results.length === 0) {
      setError("Nenhum arquivo pôde ser processado com sucesso.");
      setStep("error");
      return;
    }

    setProgress(90);
    setProgressMsg(results.length > 1 ? `Unindo dados de ${results.length} arquivos...` : "Detectando conflitos...");

    setFileResults(results.map(r => ({ data: r.data, filename: r.filename })));
    const merged = mergeMultipleResults(results);
    finalize(merged);
  }

  // ── Finalize after all parsing ──────────────────────────────────────────────
  function finalize(result: ParsedData) {
    setProgress(100);
    setProgressMsg("Concluído!");
    const cs = detectConflicts(result, professores, turmas, disciplinas, alocacoes);
    setConflicts(cs);
    setParsed(result);
    setLocalParsed(result);
    setStep("review");
    // Pass the imported config so shift draft is pre-populated with the file's actual start times
    resetShiftDraftFromConfig(config, result.config ?? undefined);
    const hasTarde = result.turmas.some(t => t.turno === "tarde");
    const hasNoite = result.turmas.some(t => t.turno === "noite");
    setActiveTab(hasTarde || hasNoite ? "turnos" : "professores");
  }

  // ── Inline edits ────────────────────────────────────────────────────────────
  function updateProf(id: string, field: keyof Professor, value: unknown) {
    setLocalParsed(prev => prev ? { ...prev, professores: prev.professores.map(p => p.id === id ? { ...p, [field]: value } : p) } : prev);
  }
  function removeProf(id: string) {
    setLocalParsed(prev => prev ? { ...prev, professores: prev.professores.filter(p => p.id !== id), alocacoes: prev.alocacoes.filter(a => a.professorId !== id) } : prev);
  }
  function removeTurma(id: string) {
    setLocalParsed(prev => prev ? { ...prev, turmas: prev.turmas.filter(t => t.id !== id), alocacoes: prev.alocacoes.filter(a => a.turmaId !== id) } : prev);
  }
  function removeDisc(id: string) {
    setLocalParsed(prev => prev ? { ...prev, disciplinas: prev.disciplinas.filter(d => d.id !== id), alocacoes: prev.alocacoes.filter(a => a.disciplinaId !== id) } : prev);
  }
  function updateTurmaField(id: string, field: keyof Turma, value: unknown) {
    setLocalParsed(prev => prev ? { ...prev, turmas: prev.turmas.map(t => t.id === id ? { ...t, [field]: value } : t) } : prev);
  }

  // ── Import (save to localStorage) ──────────────────────────────────────────
  function handleImport() {
    if (!data) return;
    let addedProfs = 0, addedTurmas = 0, addedDiscs = 0, addedAlocs = 0;

    const profIdMap  = new Map<string, string>();
    const discIdMap  = new Map<string, string>();
    const turmaIdMap = new Map<string, string>();
    data.professores.forEach(p => { const ex = professores.find(ep => ep.nomeCompleto.toLowerCase() === p.nomeCompleto.toLowerCase()); profIdMap.set(p.id, ex?.id ?? p.id); });
    data.disciplinas.forEach(d => { const ex = disciplinas.find(ed => ed.nome.toLowerCase() === d.nome.toLowerCase()); discIdMap.set(d.id, ex?.id ?? d.id); });
    // Turma ID mapping also uses nome + turno to avoid cross-shift merging
    data.turmas.forEach(t => {
      const ex = turmas.find(et =>
        et.nome.toLowerCase() === t.nome.toLowerCase() &&
        (et.turno ?? "manha") === (t.turno ?? "manha")
      );
      turmaIdMap.set(t.id, ex?.id ?? t.id);
    });

    // Merge existing and new professors together with updated planning arrays
    setProfessores(prev => {
      // Create merged list of professors
      const mergedList = prev.map(ep => {
        const impProf = data.professores.find(
          ip => ip.nomeCompleto.toLowerCase() === ep.nomeCompleto.toLowerCase()
        );
        if (!impProf) return ep;

        const mergedDiscs = Array.from(new Set([
          ...(ep.disciplinas || []),
          ...(impProf.disciplinas || []).map(id => discIdMap.get(id) || id)
        ]));

        const mergedTurmas = Array.from(new Set([
          ...(ep.turmas || []),
          ...(impProf.turmas || []).map(id => turmaIdMap.get(id) || id)
        ]));

        const mergedPlan = [...(ep.planejamento || [])];
        const impPlan = (impProf.planejamento || []).map(item => ({
          disciplinaId: discIdMap.get(item.disciplinaId) || item.disciplinaId,
          turmaId: turmaIdMap.get(item.turmaId) || item.turmaId,
          aulasPorSemana: item.aulasPorSemana,
          quantidadeAulas: item.quantidadeAulas,
          maximoAulasPorDia: item.maximoAulasPorDia
        }));

        impPlan.forEach(newItem => {
          const idx = mergedPlan.findIndex(
            em => em.turmaId === newItem.turmaId && em.disciplinaId === newItem.disciplinaId
          );
          if (idx === -1) {
            mergedPlan.push(newItem);
          } else {
            mergedPlan[idx] = {
              ...mergedPlan[idx],
              aulasPorSemana: newItem.aulasPorSemana,
              quantidadeAulas: newItem.quantidadeAulas
            };
          }
        });

        return {
          ...ep,
          disciplinas: mergedDiscs,
          turmas: mergedTurmas,
          planejamento: mergedPlan
        };
      });

      // Append new professors
      const newProfs = data.professores
        .filter(ip => !prev.some(ep => ep.nomeCompleto.toLowerCase() === ip.nomeCompleto.toLowerCase()))
        .map(ip => {
          const mappedPlan = (ip.planejamento || []).map(item => ({
            disciplinaId: discIdMap.get(item.disciplinaId) || item.disciplinaId,
            turmaId: turmaIdMap.get(item.turmaId) || item.turmaId,
            aulasPorSemana: item.aulasPorSemana,
            quantidadeAulas: item.quantidadeAulas,
            maximoAulasPorDia: item.maximoAulasPorDia
          }));
          return {
            ...ip,
            disciplinas: (ip.disciplinas || []).map(id => discIdMap.get(id) || id),
            turmas: (ip.turmas || []).map(id => turmaIdMap.get(id) || id),
            planejamento: mappedPlan
          };
        });

      addedProfs = newProfs.length;
      return [...mergedList, ...newProfs];
    });

    const newDiscs = data.disciplinas.filter(
      d => !disciplinas.some(ed => ed.nome.toLowerCase() === d.nome.toLowerCase())
    );
    if (newDiscs.length > 0) { setDisciplinas(prev => [...prev, ...newDiscs]); addedDiscs = newDiscs.length; }

    // Turma dedup uses nome + turno — "6A Matutino" and "6A Vespertino" are separate turmas
    const newTurmas = data.turmas.filter(
      t => !turmas.some(et =>
        et.nome.toLowerCase() === t.nome.toLowerCase() &&
        (et.turno ?? "manha") === (t.turno ?? "manha")
      )
    );
    if (newTurmas.length > 0) { setTurmas(prev => [...prev, ...newTurmas]); addedTurmas = newTurmas.length; }

    const newAlocs = data.alocacoes
      .map(a => ({
        ...a,
        professorId:  profIdMap.get(a.professorId)  ?? a.professorId,
        disciplinaId: discIdMap.get(a.disciplinaId) ?? a.disciplinaId,
        turmaId:      turmaIdMap.get(a.turmaId)     ?? a.turmaId,
      }))
      .filter(a => !alocacoes.some(ea =>
        ea.professorId === a.professorId && ea.turmaId === a.turmaId &&
        ea.disciplinaId === a.disciplinaId && ea.diaSemana === a.diaSemana && ea.horario === a.horario
      ));
    if (newAlocs.length > 0) { setAlocacoes(prev => [...prev, ...newAlocs]); addedAlocs = newAlocs.length; }

    const newMatriz = data.matriz.map(m => ({
      ...m,
      turmaId:      turmaIdMap.get(m.turmaId)     ?? m.turmaId,
      disciplinaId: discIdMap.get(m.disciplinaId) ?? m.disciplinaId,
    }));
    setMatriz(prev => {
      const merged = [...prev];
      for (const nm of newMatriz) {
        if (!merged.some(em => em.turmaId === nm.turmaId && em.disciplinaId === nm.disciplinaId)) merged.push(nm);
      }
      return merged;
    });

    const importedHasManha = data.turmas.some(t => !t.turno || t.turno === "manha");
    const importedHasTarde = data.turmas.some(t => t.turno === "tarde");
    const importedHasNoite = data.turmas.some(t => t.turno === "noite");
    const allHasTarde = importedHasTarde || turmas.some(t => t.turno === "tarde");
    const allHasNoite = importedHasNoite || turmas.some(t => t.turno === "noite");

    // Apply shift-draft values (pre-populated from imported file's config in finalize())
    // then fall back to direct data.config fields for any gaps.
    const ic: Partial<ConfiguracaoHorarios> = data.config ?? {};
    setConfig(prev => ({
      ...prev,
      // ── Matutino ──────────────────────────────────────────────────────────
      ...(importedHasManha ? {
        horarioInicial:           shiftDraft.manha.horarioInicial,
        quantidadeHorariosPorDia: shiftDraft.manha.quantidade,
        duracaoAulaMinutos:       shiftDraft.manha.duracao,
        possuiIntervalo:          shiftDraft.manha.possuiIntervalo,
        horarioIntervalo:         shiftDraft.manha.aulaIntervalo,
        duracaoIntervaloMinutos:  shiftDraft.manha.duracaoIntervalo,
      } : {}),
      // ── Vespertino ────────────────────────────────────────────────────────
      habilitarTarde: prev.habilitarTarde || allHasTarde,
      ...(importedHasTarde ? {
        horarioInicialTarde:           shiftDraft.tarde.horarioInicial,
        quantidadeHorariosPorDiaTarde: shiftDraft.tarde.quantidade,
        duracaoAulaMinutosTarde:       shiftDraft.tarde.duracao,
        possuiIntervaloTarde:          shiftDraft.tarde.possuiIntervalo,
        horarioIntervaloTarde:         shiftDraft.tarde.aulaIntervalo,
        duracaoIntervaloMinutosTarde:  shiftDraft.tarde.duracaoIntervalo,
      } : {}),
      // ── Noturno ───────────────────────────────────────────────────────────
      habilitarNoite: prev.habilitarNoite || allHasNoite,
      ...(importedHasNoite ? {
        horarioInicialNoite:           shiftDraft.noite.horarioInicial,
        quantidadeHorariosPorDiaNoite: shiftDraft.noite.quantidade,
        duracaoAulaMinutosNoite:       shiftDraft.noite.duracao,
        possuiIntervaloNoite:          shiftDraft.noite.possuiIntervalo,
        horarioIntervaloNoite:         shiftDraft.noite.aulaIntervalo,
        duracaoIntervaloMinutosNoite:  shiftDraft.noite.duracaoIntervalo,
      } : {}),
      // ── Direct config overrides from imported file (fills any gaps left by shiftDraft) ──
      ...(ic.horarioInicial              !== undefined && !importedHasManha  ? { horarioInicial:              ic.horarioInicial as string }              : {}),
      ...(ic.habilitarTarde                                                   ? { habilitarTarde: true }                                                  : {}),
      ...(ic.horarioInicialTarde         !== undefined && !importedHasTarde  ? { horarioInicialTarde:         ic.horarioInicialTarde as string }         : {}),
      ...(ic.quantidadeHorariosPorDiaTarde !== undefined && !importedHasTarde ? { quantidadeHorariosPorDiaTarde: ic.quantidadeHorariosPorDiaTarde as number } : {}),
      ...(ic.duracaoAulaMinutosTarde     !== undefined && !importedHasTarde  ? { duracaoAulaMinutosTarde:     ic.duracaoAulaMinutosTarde as number }     : {}),
      ...(ic.habilitarNoite                                                   ? { habilitarNoite: true }                                                  : {}),
      ...(ic.horarioInicialNoite         !== undefined && !importedHasNoite  ? { horarioInicialNoite:         ic.horarioInicialNoite as string }         : {}),
      ...(ic.quantidadeHorariosPorDiaNoite !== undefined && !importedHasNoite ? { quantidadeHorariosPorDiaNoite: ic.quantidadeHorariosPorDiaNoite as number } : {}),
      ...(ic.duracaoAulaMinutosNoite     !== undefined && !importedHasNoite  ? { duracaoAulaMinutosNoite:     ic.duracaoAulaMinutosNoite as number }     : {}),
    }));

    const autoMsg = [
      importedHasTarde && !config.habilitarTarde ? "Turno vespertino ativado." : "",
      importedHasNoite && !config.habilitarNoite ? "Turno noturno ativado." : "",
    ].filter(Boolean).join(" ");

    setStep("done");
    toast({
      title: "Importação concluída!",
      description: `${addedProfs} prof. | ${addedDiscs} disc. | ${addedTurmas} turmas | ${addedAlocs} alocações adicionadas.${autoMsg ? " | " + autoMsg : ""}`,
    });
  }

  // ── Reset ───────────────────────────────────────────────────────────────────
  function reset() {
    setStep("idle");
    setFileEntries([]);
    setFileResults([]);
    setError(null);
    setParsed(null);
    setLocalParsed(null);
    setConflicts([]);
    setProgress(0);
    setPdfText("");
    setProgressMsg("");
  }

  // ── Summary counts ──────────────────────────────────────────────────────────
  const counts = useMemo(() => ({
    profs:  data?.professores.length ?? 0,
    discs:  data?.disciplinas.length ?? 0,
    turmas: data?.turmas.length ?? 0,
    alocs:  data?.alocacoes.length ?? 0,
  }), [data]);

  const DIAS_PT: Record<string,string> = { segunda:"Segunda", terca:"Terça", quarta:"Quarta", quinta:"Quinta", sexta:"Sexta" };

  const isMulti  = fileEntries.length > 1;
  const hasFiles = fileEntries.length > 0;

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Importar Arquivo</h1>
          <p className="text-muted-foreground mt-1">Importe um ou vários arquivos de horário em PDF, Excel, CSV ou JSON</p>
        </div>
        {step !== "idle" && (
          <Button variant="outline" size="sm" onClick={reset}>
            <RefreshCw className="w-4 h-4 mr-1.5" />
            Novo Arquivo
          </Button>
        )}
      </div>

      {/* Format info */}
      {step === "idle" && (
        <Card className="border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30">
          <CardContent className="pt-4 pb-4">
            <div className="flex gap-2 items-start">
              <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <div className="text-xs text-blue-800 dark:text-blue-300 space-y-1">
                <p className="font-semibold">Importação simples ou múltipla — turnos detectados automaticamente</p>
                <p><strong>Múltiplos arquivos:</strong> Selecione <em>Horario_Matutino.xlsx</em> e <em>Horario_Vespertino.xlsx</em> ao mesmo tempo. O sistema detecta o turno pelo nome do ficheiro e une tudo automaticamente.</p>
                <p><strong>Excel / CSV:</strong> Colunas com cabeçalhos como <em>Professor, Disciplina, Turma, Dia, Horário, Turno</em>.</p>
                <p><strong>JSON:</strong> Listas de alocações ou backups nativos do EduHorários.</p>
                <p><strong>PDF:</strong> O texto é extraído e analisado; resultados variam conforme o layout.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upload zone */}
      {step === "idle" && (
        <>
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            className={[
              "flex flex-col items-center justify-center gap-4 border-2 border-dashed rounded-xl cursor-pointer transition-all min-h-[200px] p-8 select-none",
              dragging
                ? "border-primary bg-primary/5 scale-[1.01]"
                : "border-border hover:border-primary/50 hover:bg-muted/30",
            ].join(" ")}
          >
            <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-colors ${dragging ? "bg-primary/10" : "bg-muted"}`}>
              {dragging
                ? <Files className="w-8 h-8 text-primary" />
                : <Upload className="w-8 h-8 text-muted-foreground" />
              }
            </div>
            <div className="text-center">
              <p className="font-semibold text-foreground">
                {dragging ? "Solte os arquivos aqui" : "Arraste e solte um ou mais arquivos"}
              </p>
              <p className="text-sm text-muted-foreground mt-1">PDF, XLSX, XLS, CSV ou JSON — máximo {MAX_FILE_MB}MB por arquivo</p>
              <p className="text-xs text-muted-foreground mt-0.5">Você pode selecionar o matutino e vespertino ao mesmo tempo</p>
            </div>
            <div className="flex gap-2 flex-wrap justify-center">
              {["PDF", "XLSX", "XLS", "CSV", "JSON"].map(f => (
                <Badge key={f} variant="outline" className="text-xs">{f}</Badge>
              ))}
            </div>
          </div>
          <input ref={fileRef} type="file" accept={ACCEPTED_TYPES.join(",")} multiple className="hidden" onChange={onFileChange} />

          {/* Paste JSON Card */}
          <Card className="mt-4 border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                <FileJson className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                Simulação de Alocação / Matriz por JSON
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Se você tem o código JSON de simulação (como fornecido pelo gerador ou assistente), cole-o abaixo para criar instantaneamente as disciplinas, turmas e professores correspondentes para o simulador.
              </p>
              <textarea
                id="json-paster-textarea"
                placeholder='{ "acao": "simular_alocacao", "matriz": "Minha Escola 2026", ... }'
                className="w-full h-32 p-3 font-mono text-xs border border-input rounded-lg bg-muted/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring text-foreground"
                value={pasteJson}
                onChange={(e) => setPasteJson(e.target.value)}
              />
              <div className="flex flex-col gap-2">
                <div className="flex gap-2 flex-wrap">
                  <Button
                    id="btn-load-simulation-example"
                    variant="outline"
                    size="sm"
                    className="text-xs h-8 flex-1 sm:flex-initial"
                    onClick={() => {
                      const sample = {
                        acao: "simular_alocacao",
                        matriz: "2761 - PGM - ENSINO REGULAR - ENSINO MÉDIO - 2026",
                        ano_letivo: 2026,
                        turno: "Tarde",
                        turmas: [
                          { nome: "3º Ano A - Regular", turno: "Tarde" },
                          { nome: "3º Ano B - Regular", turno: "Tarde" }
                        ],
                        componentes_curriculares: [
                          { disciplina: "Língua Portuguesa", aulas_semanais: 4, professores_disponiveis: 1, preferencia_horario: "tarde" },
                          { disciplina: "Matemática", aulas_semanais: 4, professores_disponiveis: 1, preferencia_horario: "tarde" },
                          { disciplina: "Física", aulas_semanais: 2, professores_disponiveis: 1, preferencia_horario: "tarde" },
                          { disciplina: "Química", aulas_semanais: 2, professores_disponiveis: 1, preferencia_horario: "tarde" },
                          { disciplina: "Biologia", aulas_semanais: 2, professores_disponiveis: 1, preferencia_horario: "tarde" },
                          { disciplina: "História", aulas_semanais: 2, professores_disponiveis: 1, preferencia_horario: "tarde" },
                          { disciplina: "Geografia", aulas_semanais: 2, professores_disponiveis: 1, preferencia_horario: "tarde" },
                          { disciplina: "Educação Física", aulas_semanais: 1, professores_disponiveis: 1, preferencia_horario: "tarde" },
                          { disciplina: "Artes", aulas_semanais: 1, professores_disponiveis: 1, preferencia_horario: "tarde" }
                        ],
                        parametros_simulacao: {
                          aulas_por_dia: 5,
                          duracao_aula: 50,
                          intervalo: 10
                        }
                      };
                      setPasteJson(JSON.stringify(sample, null, 2));
                    }}
                  >
                    Carregar Exemplo Simples
                  </Button>

                  <Button
                    id="btn-load-complex-simulation-scenario"
                    variant="outline"
                    size="sm"
                    className="text-xs h-8 bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/20 dark:border-blue-900 dark:text-blue-300 dark:hover:bg-blue-950/40 flex-1 sm:flex-initial font-medium"
                    onClick={() => {
                      const complexScenario = {
                        acao: "simular_alocacao_completa",
                        matriz: "Rede Escolar Integrada - Matrizes 2755 (1º EM) e 2761 (3º EM) com Anos Iniciais/Finais",
                        ano_letivo: 2026,
                        turmas: [
                          // Anos Iniciais: 1º ao 3º Tarde (Vespertino) - 2 turmas de cada
                          { codigo: "1A_AI", nome: "1º Ano A - Anos Iniciais", turno: "tarde", sala: "Sala 101" },
                          { codigo: "1B_AI", nome: "1º Ano B - Anos Iniciais", turno: "tarde", sala: "Sala 102" },
                          { codigo: "2A_AI", nome: "2º Ano A - Anos Iniciais", turno: "tarde", sala: "Sala 103" },
                          { codigo: "2B_AI", nome: "2º Ano B - Anos Iniciais", turno: "tarde", sala: "Sala 104" },
                          { codigo: "3A_AI", nome: "3º Ano A - Anos Iniciais", turno: "tarde", sala: "Sala 105" },
                          { codigo: "3B_AI", nome: "3º Ano B - Anos Iniciais", turno: "tarde", sala: "Sala 106" },
                          
                          // Anos Iniciais: 4º e 5º Manhã (Matutino) - 2 turmas de cada
                          { codigo: "4A_AI", nome: "4º Ano A - Anos Iniciais", turno: "manha", sala: "Sala 101" },
                          { codigo: "4B_AI", nome: "4º Ano B - Anos Iniciais", turno: "manha", sala: "Sala 102" },
                          { codigo: "5A_AI", nome: "5º Ano A - Anos Iniciais", turno: "manha", sala: "Sala 103" },
                          { codigo: "5B_AI", nome: "5º Ano B - Anos Iniciais", turno: "manha", sala: "Sala 104" },

                          // Anos Finais: 6º ao 7º Tarde (Vespertino) - 2 turmas de cada
                          { codigo: "6A_AF", nome: "6º Ano A - Anos Finais", turno: "tarde", sala: "Sala 201" },
                          { codigo: "6B_AF", nome: "6º Ano B - Anos Finais", turno: "tarde", sala: "Sala 202" },
                          { codigo: "7A_AF", nome: "7º Ano A - Anos Finais", turno: "tarde", sala: "Sala 203" },
                          { codigo: "7B_AF", nome: "7º Ano B - Anos Finais", turno: "tarde", sala: "Sala 204" },

                          // Anos Finais: 8º e 9º Manhã (Matutino) - 2 turmas de cada
                          { codigo: "8A_AF", nome: "8º Ano A - Anos Finais", turno: "manha", sala: "Sala 201" },
                          { codigo: "8B_AF", nome: "8º Ano B - Anos Finais", turno: "manha", sala: "Sala 202" },
                          { codigo: "9A_AF", nome: "9º Ano A - Anos Finais", turno: "manha", sala: "Sala 203" },
                          { codigo: "9B_AF", nome: "9º Ano B - Anos Finais", turno: "manha", sala: "Sala 204" },

                          // Ensino Médio: 1º e 3º Anos Manhã (Matutino) - 2 turmas de cada
                          { codigo: "1A_EM", nome: "1º EM A (Matriz 2755)", turno: "manha", sala: "Laboratório 1" },
                          { codigo: "1B_EM", nome: "1º EM B (Matriz 2755)", turno: "manha", sala: "Laboratório 2" },
                          { codigo: "3A_EM", nome: "3º EM A (Matriz 2761)", turno: "manha", sala: "Auditório A" },
                          { codigo: "3B_EM", nome: "3º EM B (Matriz 2761)", turno: "manha", sala: "Auditório B" }
                        ],
                        professores: [
                          // Regentes para os Anos Iniciais (Tarde e Manhã)
                          { id: "PROF_REG_T1", nome: "Profa. Cláudia Silva (Regente Tarde)", cargo: "PEB1A", carga_horaria_maxima: 40, disciplinas: ["REGÊNCIA DE CLASSE - INICIAIS"], disponibilidade: { "SEGUNDA": ["13:00-17:00"], "TERÇA": ["13:00-17:00"], "QUARTA": ["13:00-17:00"], "QUINTA": ["13:00-17:00"], "SEXTA": ["13:00-17:00"] } },
                          { id: "PROF_REG_T2", nome: "Profa. Eliane Souza (Regente Tarde)", cargo: "PEB1A", carga_horaria_maxima: 40, disciplinas: ["REGÊNCIA DE CLASSE - INICIAIS"], disponibilidade: { "SEGUNDA": ["13:00-17:00"], "TERÇA": ["13:00-17:00"], "QUARTA": ["13:00-17:00"], "QUINTA": ["13:00-17:00"], "SEXTA": ["13:00-17:00"] } },
                          { id: "PROF_REG_M1", nome: "Profa. Sônia Regina (Regente Manhã)", cargo: "PEB1A", carga_horaria_maxima: 40, disciplinas: ["REGÊNCIA DE CLASSE - INICIAIS"], disponibilidade: { "SEGUNDA": ["07:30-11:30"], "TERÇA": ["07:30-11:30"], "QUARTA": ["07:30-11:30"], "QUINTA": ["07:30-11:30"], "SEXTA": ["07:30-11:30"] } },
                          { id: "PROF_REG_M2", nome: "Profa. Patrícia Lima (Regente Manhã)", cargo: "PEB1A", carga_horaria_maxima: 40, disciplinas: ["REGÊNCIA DE CLASSE - INICIAIS"], disponibilidade: { "SEGUNDA": ["07:30-11:30"], "TERÇA": ["07:30-11:30"], "QUARTA": ["07:30-11:30"], "QUINTA": ["07:30-11:30"], "SEXTA": ["07:30-11:30"] } },
                          
                          // Professores de Áreas Comuns para Anos Finais / Ensino Médio
                          { id: "PROF_PORT_M", nome: "Prof. Roberto Mendes (Português Manhã)", cargo: "PEB1A", carga_horaria_maxima: 40, disciplinas: ["LÍNGUA PORTUGUESA", "ARTE"], disponibilidade: { "SEGUNDA": ["07:30-11:30"], "TERÇA": ["07:30-11:30"], "QUARTA": ["07:30-11:30"], "QUINTA": ["07:30-11:30"], "SEXTA": ["07:30-11:30"] } },
                          { id: "PROF_PORT_T", nome: "Profa. Regina Duarte (Português Tarde)", cargo: "PEB1A", carga_horaria_maxima: 40, disciplinas: ["LÍNGUA PORTUGUESA", "LÍNGUA INGLESA"], disponibilidade: { "SEGUNDA": ["13:00-17:00"], "TERÇA": ["13:00-17:00"], "QUARTA": ["13:00-17:00"], "QUINTA": ["13:00-17:00"], "SEXTA": ["13:00-17:00"] } },
                          { id: "PROF_MAT_M", nome: "Profa. Juliana Rocha (Matemática Manhã)", cargo: "PEB1A", carga_horaria_maxima: 40, disciplinas: ["MATEMÁTICA", "EDUCAÇÃO DIGITAL"], disponibilidade: { "SEGUNDA": ["07:30-11:30"], "TERÇA": ["07:30-11:30"], "QUARTA": ["07:30-11:30"], "QUINTA": ["07:30-11:30"], "SEXTA": ["07:30-11:30"] } },
                          { id: "PROF_MAT_T", nome: "Prof. Marcos Paulo (Matemática Tarde)", cargo: "PEB1A", carga_horaria_maxima: 40, disciplinas: ["MATEMÁTICA"], disponibilidade: { "SEGUNDA": ["13:00-17:00"], "TERÇA": ["13:00-17:00"], "QUARTA": ["13:00-17:00"], "QUINTA": ["13:00-17:00"], "SEXTA": ["13:00-17:00"] } },
                          
                          // Ciências e Biologia/Química/Física
                          { id: "PROF_CIEN_M", nome: "Profa. Mariana Santos (Biologia/Química)", cargo: "PEB1A", carga_horaria_maxima: 40, disciplinas: ["BIOLOGIA", "QUÍMICA", "CIÊNCIAS"], disponibilidade: { "SEGUNDA": ["07:30-11:30"], "TERÇA": ["07:30-11:30"], "QUARTA": ["07:30-11:30"], "QUINTA": ["07:30-11:30"], "SEXTA": ["07:30-11:30"] } },
                          { id: "PROF_FIS_M", nome: "Prof. Carlos Alberto (Física)", cargo: "PEB1A", carga_horaria_maxima: 40, disciplinas: ["FÍSICA"], disponibilidade: { "SEGUNDA": ["07:30-11:30"], "TERÇA": ["07:30-11:30"], "QUARTA": ["07:30-11:30"], "QUINTA": ["07:30-11:30"], "SEXTA": ["07:30-11:30"] } },
                          { id: "PROF_HUM_M", nome: "Prof. João Pedro (História/Filosofia/Sociologia)", cargo: "PEB1A", carga_horaria_maxima: 40, disciplinas: ["HISTÓRIA", "FILOSOFIA", "SOCIOLOGIA"], disponibilidade: { "SEGUNDA": ["07:30-11:30"], "TERÇA": ["07:30-11:30"], "QUARTA": ["07:30-11:30"], "QUINTA": ["07:30-11:30"], "SEXTA": ["07:30-11:30"] } },
                          { id: "PROF_GEO_M", nome: "Profa. Ana Paula (Geografia)", cargo: "PEB1A", carga_horaria_maxima: 40, disciplinas: ["GEOGRAFIA"], disponibilidade: { "SEGUNDA": ["07:30-11:30"], "TERÇA": ["07:30-11:30"], "QUARTA": ["07:30-11:30"], "QUINTA": ["07:30-11:30"], "SEXTA": ["07:30-11:30"] } },
                          { id: "PROF_EF_GERAL", nome: "Prof. Fernando Souza (Ed. Física Geral)", cargo: "PEB1A", carga_horaria_maxima: 40, disciplinas: ["EDUCAÇÃO FÍSICA"], disponibilidade: { "SEGUNDA": ["07:30-17:00"], "TERÇA": ["07:30-17:00"], "QUARTA": ["07:30-17:00"], "QUINTA": ["07:30-17:00"], "SEXTA": ["07:30-17:00"] } },

                          // Professores de Humanas e Ciências da Natureza para Anos Finais (Tarde)
                          { id: "PROF_HUM_T", nome: "Prof. Bruno Corrêa (História/Geografia)", cargo: "PEB1A", carga_horaria_maxima: 40, disciplinas: ["HISTÓRIA", "GEOGRAFIA"], disponibilidade: { "SEGUNDA": ["13:00-17:00"], "TERÇA": ["13:00-17:00"], "QUARTA": ["13:00-17:00"], "QUINTA": ["13:00-17:00"], "SEXTA": ["13:00-17:00"] } },
                          { id: "PROF_CIEN_T", nome: "Profa. Amanda Lima (Ciências)", cargo: "PEB1A", carga_horaria_maxima: 40, disciplinas: ["CIÊNCIAS"], disponibilidade: { "SEGUNDA": ["13:00-17:00"], "TERÇA": ["13:00-17:00"], "QUARTA": ["13:00-17:00"], "QUINTA": ["13:00-17:00"], "SEXTA": ["13:00-17:00"] } },

                          // PROFESSORES DOS ITINERÁRIOS DO ENSINO MÉDIO (Disponibilidade APENAS Segunda e Terça à TARDE!)
                          { id: "PROF_ITIN_1", nome: "Prof. Arthur Pendragon (Itinerários Matemáticos)", cargo: "PEB1A", carga_horaria_maxima: 20, disciplinas: ["CONEXÕES MATEMÁTICAS", "PROJETO INTEGRADOR: SOLUÇÕES MATEMÁTICAS"], disponibilidade: { "SEGUNDA": ["13:00-17:00"], "TERÇA": ["13:00-17:00"], "QUARTA": [], "QUINTA": [], "SEXTA": [] } },
                          { id: "PROF_ITIN_2", nome: "Profa. Beatriz Ramos (Itinerários de Linguagens/Sociais)", cargo: "PEB1A", carga_horaria_maxima: 20, disciplinas: ["LEITURA E PROTAGONISMO", "PROJETO INTEGRADOR: INTERVENÇÃO CIDADÃ"], disponibilidade: { "SEGUNDA": ["13:00-17:00"], "TERÇA": ["13:00-17:00"], "QUARTA": [], "QUINTA": [], "SEXTA": [] } }
                        ],
                        componentes_curriculares: [
                          // ── MATRIZ 1º ANO ENSINO MÉDIO (Matriz 2755) ──
                          // Itinerários (Tarde, Segunda/Terça)
                          { disciplina: "CONEXÕES MATEMÁTICAS", aulas_semanais: 3, professores: ["PROF_ITIN_1"], preferencia_horario: "tarde", turmas: ["1A_EM", "1B_EM"] },
                          { disciplina: "LEITURA E PROTAGONISMO", aulas_semanais: 3, professores: ["PROF_ITIN_2"], preferencia_horario: "tarde", turmas: ["1A_EM", "1B_EM"] },
                          // Comuns (Manhã)
                          { disciplina: "BIOLOGIA", aulas_semanais: 2, professores: ["PROF_CIEN_M"], preferencia_horario: "manha", turmas: ["1A_EM", "1B_EM"] },
                          { disciplina: "FÍSICA", aulas_semanais: 2, professores: ["PROF_FIS_M"], preferencia_horario: "manha", turmas: ["1A_EM", "1B_EM"] },
                          { disciplina: "QUÍMICA", aulas_semanais: 2, professores: ["PROF_CIEN_M"], preferencia_horario: "manha", turmas: ["1A_EM", "1B_EM"] },
                          { disciplina: "FILOSOFIA", aulas_semanais: 1, professores: ["PROF_HUM_M"], preferencia_horario: "manha", turmas: ["1A_EM", "1B_EM"] },
                          { disciplina: "GEOGRAFIA", aulas_semanais: 2, professores: ["PROF_GEO_M"], preferencia_horario: "manha", turmas: ["1A_EM", "1B_EM"] },
                          { disciplina: "HISTÓRIA", aulas_semanais: 1, professores: ["PROF_HUM_M"], preferencia_horario: "manha", turmas: ["1A_EM", "1B_EM"] },
                          { disciplina: "SOCIOLOGIA", aulas_semanais: 1, professores: ["PROF_HUM_M"], preferencia_horario: "manha", turmas: ["1A_EM", "1B_EM"] },
                          { disciplina: "EDUCAÇÃO DIGITAL", aulas_semanais: 1, professores: ["PROF_MAT_M"], preferencia_horario: "manha", turmas: ["1A_EM", "1B_EM"] },
                          { disciplina: "ARTE", aulas_semanais: 1, professores: ["PROF_PORT_M"], preferencia_horario: "manha", turmas: ["1A_EM", "1B_EM"] },
                          { disciplina: "EDUCAÇÃO FÍSICA", aulas_semanais: 2, professores: ["PROF_EF_GERAL"], preferencia_horario: "manha", turmas: ["1A_EM", "1B_EM"] },
                          { disciplina: "LÍNGUA INGLESA", aulas_semanais: 1, professores: ["PROF_PORT_M"], preferencia_horario: "manha", turmas: ["1A_EM", "1B_EM"] },
                          { disciplina: "LÍNGUA PORTUGUESA", aulas_semanais: 4, professores: ["PROF_PORT_M"], preferencia_horario: "manha", turmas: ["1A_EM", "1B_EM"] },
                          { disciplina: "MATEMÁTICA", aulas_semanais: 4, professores: ["PROF_MAT_M"], preferencia_horario: "manha", turmas: ["1A_EM", "1B_EM"] },

                          // ── MATRIZ 3º ANO ENSINO MÉDIO (Matriz 2761) ──
                          // Itinerários (Tarde, Segunda/Terça)
                          { disciplina: "PROJETO INTEGRADOR: INTERVENÇÃO CIDADÃ", aulas_semanais: 3, professores: ["PROF_ITIN_2"], preferencia_horario: "tarde", turmas: ["3A_EM", "3B_EM"] },
                          { disciplina: "PROJETO INTEGRADOR: SOLUÇÕES MATEMÁTICAS", aulas_semanais: 3, professores: ["PROF_ITIN_1"], preferencia_horario: "tarde", turmas: ["3A_EM", "3B_EM"] },
                          // Comuns (Manhã)
                          { disciplina: "BIOLOGIA", aulas_semanais: 2, professores: ["PROF_CIEN_M"], preferencia_horario: "manha", turmas: ["3A_EM", "3B_EM"] },
                          { disciplina: "FÍSICA", aulas_semanais: 1, professores: ["PROF_FIS_M"], preferencia_horario: "manha", turmas: ["3A_EM", "3B_EM"] },
                          { disciplina: "QUÍMICA", aulas_semanais: 1, professores: ["PROF_CIEN_M"], preferencia_horario: "manha", turmas: ["3A_EM", "3B_EM"] },
                          { disciplina: "FILOSOFIA", aulas_semanais: 1, professores: ["PROF_HUM_M"], preferencia_horario: "manha", turmas: ["3A_EM", "3B_EM"] },
                          { disciplina: "GEOGRAFIA", aulas_semanais: 2, professores: ["PROF_GEO_M"], preferencia_horario: "manha", turmas: ["3A_EM", "3B_EM"] },
                          { disciplina: "HISTÓRIA", aulas_semanais: 2, professores: ["PROF_HUM_M"], preferencia_horario: "manha", turmas: ["3A_EM", "3B_EM"] },
                          { disciplina: "SOCIOLOGIA", aulas_semanais: 1, professores: ["PROF_HUM_M"], preferencia_horario: "manha", turmas: ["3A_EM", "3B_EM"] },
                          { disciplina: "EDUCAÇÃO DIGITAL", aulas_semanais: 1, professores: ["PROF_MAT_M"], preferencia_horario: "manha", turmas: ["3A_EM", "3B_EM"] },
                          { disciplina: "ARTE", aulas_semanais: 1, professores: ["PROF_PORT_M"], preferencia_horario: "manha", turmas: ["3A_EM", "3B_EM"] },
                          { disciplina: "EDUCAÇÃO FÍSICA", aulas_semanais: 1, professores: ["PROF_EF_GERAL"], preferencia_horario: "manha", turmas: ["3A_EM", "3B_EM"] },
                          { disciplina: "LÍNGUA INGLESA", aulas_semanais: 1, professores: ["PROF_PORT_M"], preferencia_horario: "manha", turmas: ["3A_EM", "3B_EM"] },
                          { disciplina: "LÍNGUA PORTUGUESA", aulas_semanais: 5, professores: ["PROF_PORT_M"], preferencia_horario: "manha", turmas: ["3A_EM", "3B_EM"] },
                          { disciplina: "MATEMÁTICA", aulas_semanais: 5, professores: ["PROF_MAT_M"], preferencia_horario: "manha", turmas: ["3A_EM", "3B_EM"] },

                          // ── MATRIZ ANOS INICIAIS REGÊNCIA DE CLASSE ──
                          { disciplina: "REGÊNCIA DE CLASSE - INICIAIS", aulas_semanais: 25, professores: ["PROF_REG_T1", "PROF_REG_T2", "PROF_REG_M1", "PROF_REG_M2"], preferencia_horario: "flexivel", turmas: ["1A_AI", "1B_AI", "2A_AI", "2B_AI", "3A_AI", "3B_AI", "4A_AI", "4B_AI", "5A_AI", "5B_AI"] },

                          // ── MATRIZ ANOS FINAIS (6º ao 9º) ──
                          { disciplina: "LÍNGUA PORTUGUESA", aulas_semanais: 5, professores: ["PROF_PORT_M", "PROF_PORT_T"], preferencia_horario: "flexivel", turmas: ["6A_AF", "6B_AF", "7A_AF", "7B_AF", "8A_AF", "8B_AF", "9A_AF", "9B_AF"] },
                          { disciplina: "MATEMÁTICA", aulas_semanais: 5, professores: ["PROF_MAT_M", "PROF_MAT_T"], preferencia_horario: "flexivel", turmas: ["6A_AF", "6B_AF", "7A_AF", "7B_AF", "8A_AF", "8B_AF", "9A_AF", "9B_AF"] },
                          { disciplina: "HISTÓRIA", aulas_semanais: 3, professores: ["PROF_HUM_M", "PROF_HUM_T"], preferencia_horario: "flexivel", turmas: ["6A_AF", "6B_AF", "7A_AF", "7B_AF", "8A_AF", "8B_AF", "9A_AF", "9B_AF"] },
                          { disciplina: "GEOGRAFIA", aulas_semanais: 3, professores: ["PROF_GEO_M", "PROF_HUM_T"], preferencia_horario: "flexivel", turmas: ["6A_AF", "6B_AF", "7A_AF", "7B_AF", "8A_AF", "8B_AF", "9A_AF", "9B_AF"] },
                          { disciplina: "CIÊNCIAS", aulas_semanais: 3, professores: ["PROF_CIEN_M", "PROF_CIEN_T"], preferencia_horario: "flexivel", turmas: ["6A_AF", "6B_AF", "7A_AF", "7B_AF", "8A_AF", "8B_AF", "9A_AF", "9B_AF"] },
                          { disciplina: "LÍNGUA INGLESA", aulas_semanais: 2, professores: ["PROF_PORT_M", "PROF_PORT_T"], preferencia_horario: "flexivel", turmas: ["6A_AF", "6B_AF", "7A_AF", "7B_AF", "8A_AF", "8B_AF", "9A_AF", "9B_AF"] },
                          { disciplina: "ARTE", aulas_semanais: 2, professores: ["PROF_PORT_M", "PROF_PORT_T"], preferencia_horario: "flexivel", turmas: ["6A_AF", "6B_AF", "7A_AF", "7B_AF", "8A_AF", "8B_AF", "9A_AF", "9B_AF"] },
                          { disciplina: "EDUCAÇÃO FÍSICA", aulas_semanais: 2, professores: ["PROF_EF_GERAL"], preferencia_horario: "flexivel", turmas: ["6A_AF", "6B_AF", "7A_AF", "7B_AF", "8A_AF", "8B_AF", "9A_AF", "9B_AF"] }
                        ],
                        parametros_simulacao: {
                          aulas_por_dia: 5,
                          duracao_aula: 50,
                          intervalo: 10
                        }
                      };
                      setPasteJson(JSON.stringify(complexScenario, null, 2));
                    }}
                  >
                    Carregar Cenário de Rede Complexo (Solicitado)
                  </Button>
                </div>

                <div className="flex justify-end items-center">
                  <Button
                    id="btn-process-pasted-json"
                    size="sm"
                    className="text-xs bg-blue-600 hover:bg-blue-700 text-white h-8"
                    onClick={handlePasteJsonSubmit}
                    disabled={!pasteJson.trim()}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                    Processar JSON
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Error state */}
      {error && (
        <Card className="border-destructive bg-destructive/5">
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="ghost" size="icon" className="ml-auto" onClick={reset}><X className="w-4 h-4" /></Button>
          </CardContent>
        </Card>
      )}

      {/* File list — shown during processing and review */}
      {hasFiles && step !== "idle" && (
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Files className="w-4 h-4" />
              {isMulti ? `${fileEntries.length} arquivos selecionados` : "Arquivo selecionado"}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {fileEntries.map((entry, i) => (
              <div key={i} className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
                <FileIcon ext={entry.file.name.split(".").pop()?.toLowerCase() ?? ""} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{entry.file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(entry.file.size / 1024).toFixed(1)} KB
                    {step !== "review" && entry.turnoDetected && (
                      <span className="ml-2 text-blue-600 dark:text-blue-400 font-medium">
                        · {turnoLabel(entry.turnoDetected)} detectado
                      </span>
                    )}
                    {entry.error && <span className="ml-2 text-destructive">{entry.error}</span>}
                  </p>
                </div>
                {step === "review" && (
                  <Select
                    value={entry.turnoOverride ?? entry.turnoDetected ?? ""}
                    onValueChange={v => handleTurnoChange(i, v as "manha" | "tarde" | "noite")}
                  >
                    <SelectTrigger className="h-7 text-xs w-[120px] shrink-0">
                      <SelectValue placeholder="Turno…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manha">☀ Matutino</SelectItem>
                      <SelectItem value="tarde">🌤 Vespertino</SelectItem>
                      <SelectItem value="noite">🌙 Noturno</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <Badge
                  variant={entry.status === "done" ? "default" : entry.status === "error" ? "destructive" : entry.status === "processing" ? "secondary" : "outline"}
                  className="shrink-0 text-xs"
                >
                  {entry.status === "done" ? "✓ Processado"
                    : entry.status === "error" ? "Erro"
                    : entry.status === "processing"
                      ? <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Processando</span>
                      : "Aguardando"}
                </Badge>
              </div>
            ))}

            {/* Summary badges after all done */}
            {step === "review" && (
              <div className="flex gap-2 flex-wrap pt-1 border-t border-border mt-2">
                <Badge variant="secondary">{counts.profs} Professor{counts.profs !== 1 ? "es" : ""}</Badge>
                <Badge variant="secondary">{counts.discs} Disciplina{counts.discs !== 1 ? "s" : ""}</Badge>
                <Badge variant="secondary">{counts.turmas} Turma{counts.turmas !== 1 ? "s" : ""}</Badge>
                <Badge variant="secondary">{counts.alocs} Alocaç{counts.alocs !== 1 ? "ões" : "ão"}</Badge>
                {data?.format === "multi" && (
                  <Badge variant="outline" className="text-xs text-blue-600 border-blue-300">
                    <Files className="w-3 h-3 mr-1" />Dados unidos
                  </Badge>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Progress bar */}
      {(step === "reading" || step === "parsing") && (
        <Card>
          <CardContent className="pt-5 pb-5 space-y-3">
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-muted-foreground">{progressMsg}</p>
          </CardContent>
        </Card>
      )}

      {/* Conflicts */}
      {step === "review" && conflicts.length > 0 && (
        <Card className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-amber-800 dark:text-amber-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {conflicts.length} conflito{conflicts.length !== 1 ? "s" : ""} detectado{conflicts.length !== 1 ? "s" : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-1">
            {conflicts.map((c, i) => (
              <div key={i} className={`text-xs flex items-start gap-2 ${c.severity === "warning" ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground"}`}>
                <span className="shrink-0 mt-0.5">{c.severity === "warning" ? "⚠" : "ℹ"}</span>
                <span>{c.descricao}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* PDF text preview */}
      {step === "review" && pdfText && (
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Eye className="w-4 h-4" />
              Texto Extraído do PDF
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <pre className="text-xs bg-muted/40 rounded p-3 overflow-auto max-h-40 whitespace-pre-wrap font-mono leading-relaxed">
              {pdfText.slice(0, 2000)}{pdfText.length > 2000 ? "\n\n[... texto truncado ...]" : ""}
            </pre>
            {counts.profs === 0 && counts.turmas === 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-2 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                Não foi possível extrair dados estruturados deste PDF. Tente exportar como Excel ou CSV para melhor resultado.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Data review tables */}
      {step === "review" && data && (
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Pencil className="w-4 h-4" />
              Revisar e editar dados detectados
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="mb-4 w-full flex-wrap h-auto gap-1">
                <TabsTrigger value="turnos"      className="flex-1 text-xs">⚙ Turnos</TabsTrigger>
                <TabsTrigger value="professores" className="flex-1 text-xs">Professores ({counts.profs})</TabsTrigger>
                <TabsTrigger value="disciplinas" className="flex-1 text-xs">Disciplinas ({counts.discs})</TabsTrigger>
                <TabsTrigger value="turmas"      className="flex-1 text-xs">Turmas ({counts.turmas})</TabsTrigger>
                <TabsTrigger value="alocacoes"   className="flex-1 text-xs">Alocações ({counts.alocs})</TabsTrigger>
              </TabsList>

              {/* ── Turnos & Configurações ── */}
              <TabsContent value="turnos">
                {(() => {
                  const detManha = data.turmas.some(t => !t.turno || t.turno === "manha");
                  const detTarde = data.turmas.some(t => t.turno === "tarde");
                  const detNoite = data.turmas.some(t => t.turno === "noite");
                  const ctManha  = data.turmas.filter(t => !t.turno || t.turno === "manha").length;
                  const ctTarde  = data.turmas.filter(t => t.turno === "tarde").length;
                  const ctNoite  = data.turmas.filter(t => t.turno === "noite").length;
                  const ShiftBlock = ({ turno, label, emoji, color, count, present }: {
                    turno: "manha" | "tarde" | "noite"; label: string; emoji: string;
                    color: string; count: number; present: boolean;
                  }) => {
                    const draft = shiftDraft[turno];
                    return (
                      <div className={`rounded-lg border p-3 space-y-2 ${present ? color : "border-border bg-muted/20 opacity-50"}`}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold">{emoji} {label}</span>
                          <Badge variant="secondary" className="text-[10px]">{count} turma{count !== 1 ? "s" : ""}</Badge>
                          {!present && <span className="text-[10px] text-muted-foreground ml-auto">Não detectado neste arquivo</span>}
                          {present && turno !== "manha" && <span className="text-[10px] text-green-600 dark:text-green-400 ml-auto font-medium">✓ Será ativado automaticamente</span>}
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-0.5">Início</label>
                            <Input type="time" value={draft.horarioInicial} disabled={!present}
                              onChange={e => updateShiftDraft(turno, "horarioInicial", e.target.value)}
                              className="h-7 text-xs" />
                          </div>
                          <div>
                            <label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-0.5">Qtd. aulas/dia</label>
                            <Input type="number" min={1} max={12} value={draft.quantidade} disabled={!present}
                              onChange={e => updateShiftDraft(turno, "quantidade", Math.max(1, Math.min(12, Number(e.target.value))))}
                              className="h-7 text-xs" />
                          </div>
                          <div>
                            <label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-0.5">Duração (min)</label>
                            <Input type="number" min={20} max={120} value={draft.duracao} disabled={!present}
                              onChange={e => updateShiftDraft(turno, "duracao", Math.max(20, Math.min(120, Number(e.target.value))))}
                              className="h-7 text-xs" />
                          </div>
                        </div>
                        {present && (
                          <p className="text-[10px] text-muted-foreground">
                            Término estimado: {(() => {
                              const [h, m] = draft.horarioInicial.split(":").map(Number);
                              const total = h * 60 + m + draft.quantidade * draft.duracao + (draft.possuiIntervalo ? draft.duracaoIntervalo : 0);
                              return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
                            })()}
                          </p>
                        )}
                      </div>
                    );
                  };
                  return (
                    <div className="space-y-3">
                      <p className="text-xs text-muted-foreground">Configure os horários de cada turno. Os valores abaixo serão salvos ao importar.</p>
                      <ShiftBlock turno="manha" label="Matutino" emoji="☀" color="border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30" count={ctManha} present={detManha} />
                      <ShiftBlock turno="tarde" label="Vespertino" emoji="🌤" color="border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/30" count={ctTarde} present={detTarde} />
                      <ShiftBlock turno="noite" label="Noturno" emoji="🌙" color="border-purple-200 bg-purple-50 dark:border-purple-900 dark:bg-purple-950/30" count={ctNoite} present={detNoite} />
                      {!detManha && !detTarde && !detNoite && (
                        <p className="text-sm text-muted-foreground text-center py-6">Nenhum turno detectado — verifique o turno das turmas na aba "Turmas".</p>
                      )}
                    </div>
                  );
                })()}
              </TabsContent>

              {/* Professores */}
              <TabsContent value="professores">
                {data.professores.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">Nenhum professor detectado</p>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-[1fr_120px_120px_32px] gap-2 px-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      <span>Nome Completo</span><span>MASP</span><span>Vínculo</span><span></span>
                    </div>
                    {data.professores.map(p => (
                      <div key={p.id} className="grid grid-cols-[1fr_120px_120px_32px] gap-2 items-center bg-muted/30 rounded px-2 py-1.5">
                        <Input value={p.nomeCompleto} onChange={e => updateProf(p.id, "nomeCompleto", e.target.value)} className="h-7 text-xs" />
                        <Input value={p.masp ?? ""} onChange={e => updateProf(p.id, "masp", e.target.value || undefined)} placeholder="MASP" className="h-7 text-xs" />
                        <Select value={p.tipoVinculo ?? "—"} onValueChange={v => updateProf(p.id, "tipoVinculo", v === "—" ? undefined : v)}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="—">—</SelectItem>
                            <SelectItem value="efetivo">Efetivo</SelectItem>
                            <SelectItem value="designado">Designado</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeProf(p.id)}>
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Disciplinas */}
              <TabsContent value="disciplinas">
                {data.disciplinas.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">Nenhuma disciplina detectada</p>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-[1fr_80px_32px] gap-2 px-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      <span>Nome</span><span>Abrev.</span><span></span>
                    </div>
                    {data.disciplinas.map(d => (
                      <div key={d.id} className="grid grid-cols-[1fr_80px_32px] gap-2 items-center bg-muted/30 rounded px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full shrink-0" style={{ background: d.cor }} />
                          <span className="text-xs">{d.nome}</span>
                        </div>
                        <span className="text-xs font-mono text-muted-foreground">{d.abreviacao}</span>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeDisc(d.id)}>
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Turmas */}
              <TabsContent value="turmas">
                {data.turmas.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">Nenhuma turma detectada</p>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-[1fr_130px_32px] gap-2 px-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      <span>Nome da Turma</span><span>Turno</span><span></span>
                    </div>
                    {data.turmas.map(t => (
                      <div key={t.id} className="grid grid-cols-[1fr_130px_32px] gap-2 items-center bg-muted/30 rounded px-2 py-1.5">
                        <span className="text-xs truncate">{t.nome}</span>
                        <Select value={t.turno} onValueChange={v => updateTurmaField(t.id, "turno", v)}>
                          <SelectTrigger className={`h-7 text-xs ${t.turno === "tarde" ? "border-orange-300 text-orange-700 dark:text-orange-300" : t.turno === "noite" ? "border-purple-300 text-purple-700 dark:text-purple-300" : "border-blue-300 text-blue-700 dark:text-blue-300"}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="manha">☀ Manhã</SelectItem>
                            <SelectItem value="tarde">🌤 Tarde</SelectItem>
                            <SelectItem value="noite">🌙 Noite</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeTurma(t.id)}>
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Alocações */}
              <TabsContent value="alocacoes">
                {data.alocacoes.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">Nenhuma alocação detectada</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b text-muted-foreground">
                          <th className="text-left py-1.5 pr-3 font-medium">Professor</th>
                          <th className="text-left py-1.5 pr-3 font-medium">Disciplina</th>
                          <th className="text-left py-1.5 pr-3 font-medium">Turma</th>
                          <th className="text-left py-1.5 pr-3 font-medium">Dia</th>
                          <th className="text-left py-1.5 font-medium">Horário</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.alocacoes.slice(0, 50).map(a => {
                          const prof  = data.professores.find(p => p.id === a.professorId);
                          const disc  = data.disciplinas.find(d => d.id === a.disciplinaId);
                          const turma = data.turmas.find(t => t.id === a.turmaId);
                          return (
                            <tr key={a.id} className="border-b border-border/40 hover:bg-muted/20">
                              <td className="py-1 pr-3 truncate max-w-[140px]">{prof?.nomeCompleto ?? "—"}</td>
                              <td className="py-1 pr-3 truncate max-w-[120px]">{disc?.nome ?? "—"}</td>
                              <td className="py-1 pr-3">{turma?.nome ?? "—"}</td>
                              <td className="py-1 pr-3">{DIAS_PT[a.diaSemana] ?? a.diaSemana}</td>
                              <td className="py-1">{a.horario}ª aula</td>
                            </tr>
                          );
                        })}
                        {data.alocacoes.length > 50 && (
                          <tr><td colSpan={5} className="py-2 text-center text-muted-foreground">... e mais {data.alocacoes.length - 50} alocações</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      {/* Import actions */}
      {step === "review" && (
        <div className="flex items-center gap-3 justify-end">
          <Button variant="outline" onClick={reset}>
            <X className="w-4 h-4 mr-1.5" />
            Cancelar
          </Button>
          <Button
            onClick={handleImport}
            disabled={counts.profs === 0 && counts.turmas === 0 && counts.discs === 0}
            className="min-w-[140px]"
          >
            <Save className="w-4 h-4 mr-1.5" />
            Confirmar e Importar
          </Button>
        </div>
      )}

      {/* Done state */}
      {step === "done" && (
        <Card className="border-green-300 bg-green-50 dark:border-green-900 dark:bg-green-950/30">
          <CardContent className="pt-5 pb-5 text-center space-y-3">
            <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto" />
            <p className="font-semibold text-green-800 dark:text-green-300">Importação realizada com sucesso!</p>
            <p className="text-sm text-green-700 dark:text-green-400">Os dados foram adicionados ao sistema. Acesse Professores, Turmas ou Grade para conferir.</p>
            <Button onClick={reset} variant="outline" className="mt-2">
              <Upload className="w-4 h-4 mr-1.5" />
              Importar mais arquivos
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
