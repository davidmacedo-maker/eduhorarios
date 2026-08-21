import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  useTurmas, useProfessores, useDisciplinas, useAlocacoes,
  useConfiguracaoHorarios, useRegistrosPonto, useNomeEscola, useCodigoEscola, generateId,
  storageKey, getUserId,
} from "../store";
import { mapFromDbRegistroPonto, mapToDbRegistroPonto, fetchRegistrosPonto, upsertRegistrosPonto, deleteRegistrosPonto } from "@/lib/apiSync";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Printer, ClipboardList, Zap, Check, Trash2, Undo2, Redo2, Eraser } from "lucide-react";
import { useToast } from "../hooks/use-toast";
import type { Alocacao, RegistroPonto } from "../types";

const MESES_ABREV = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const MESES = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
];
const JS_DAY_NOME = ["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"];
const JS_DAY_KEY  = ["domingo","segunda","terca","quarta","quinta","sexta","sabado"];
const IS_WEEKEND  = (d: number) => d === 0 || d === 6;

function getDays(year: number, month: number): Date[] {
  const days: Date[] = [];
  const d = new Date(year, month - 1, 1);
  while (d.getMonth() === month - 1) { days.push(new Date(d)); d.setDate(d.getDate() + 1); }
  return days;
}
function toISO(d: Date) { return d.toISOString().slice(0, 10); }

const cellBase = "border border-black align-middle text-center text-black transition-colors";
const thBase   = "border border-black bg-slate-100/80 print:bg-white text-center align-middle font-semibold text-black tracking-tight font-sans";

// ── Feriados Nacionais Brasileiros ────────────────────────────────────────────
const FERIADOS_FIXOS = new Set([
  "01-01","04-21","05-01","09-07","10-12","11-02","11-15","11-20","12-25",
]);
function easterDate(y: number): Date {
  const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4;
  const f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3);
  const h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4;
  const l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const mo=Math.floor((h+l-7*m+114)/31),da=((h+l-7*m+114)%31)+1;
  return new Date(y,mo-1,da);
}

function getFeriadoNacionalNome(date: Date): string | undefined {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const fKey = `${mm}-${dd}`;

  if (fKey === "01-01") return "Confraternização Universal";
  if (fKey === "04-21") return "Tiradentes";
  if (fKey === "05-01") return "Dia do Trabalho";
  if (fKey === "09-07") return "Independência do Brasil";
  if (fKey === "10-12") return "Nossa Senhora Aparecida";
  if (fKey === "11-02") return "Finados";
  if (fKey === "11-15") return "Proclamação da República";
  if (fKey === "11-20") return "Dia Nacional de Zumbi e da Consciência Negra";
  if (fKey === "12-25") return "Natal";

  const y = date.getFullYear();
  const e = easterDate(y);
  const fmt = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const add = (d: Date, n: number) => {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  };

  const pSexta = fmt(add(e, -2));
  const pCarnavalSeg = fmt(add(e, -48));
  const pCarnavalTer = fmt(add(e, -47));
  const pCorpus = fmt(add(e, 60));

  if (fKey === pSexta) return "Sexta-feira Santa";
  if (fKey === pCarnavalSeg) return "Segunda-feira de Carnaval";
  if (fKey === pCarnavalTer) return "Carnaval";
  if (fKey === pCorpus) return "Corpus Christi";

  return undefined;
}

function isFeriadoNacional(date: Date): boolean {
  return getFeriadoNacionalNome(date) !== undefined;
}
const FALTA_TOKENS = new Set(["f","falta","0","x","a","ausente","-"]);
const derivePresente = (v: string) => v.trim().length > 0 && !FALTA_TOKENS.has(v.trim().toLowerCase());

interface SimboloInfo { cor: string; bgCls: string; textCls: string; descricao: string; }
const SIMBOLO_MAPA: Record<string, SimboloInfo> = {
  // ── Seção 2: Símbolos Especiais nos Horários ──
  "@":  { cor: "#16a34a", bgCls: "bg-green-100",  textCls: "text-green-700",  descricao: "Reunião Pedagógica Coletiva" },
  "&":  { cor: "#7c3aed", bgCls: "bg-purple-100", textCls: "text-purple-700", descricao: "Cumprimento de Carga Horária Extraclasse" },
  "CC": { cor: "#7c3aed", bgCls: "bg-purple-100", textCls: "text-purple-700", descricao: "Conselho de Classe Extra-turno" },
  "!":  { cor: "#ea580c", bgCls: "bg-orange-100", textCls: "text-orange-600", descricao: "Coordenação do Novo Ensino Médio" },
  // ── Seção 1: Observações (abreviações) ──
  "F":  { cor: "#64748b", bgCls: "bg-slate-100",  textCls: "text-slate-600",  descricao: "Feriado" },
  "RP": { cor: "#16a34a", bgCls: "bg-green-100",  textCls: "text-green-700",  descricao: "Reunião Pedagógica" },
  "PE": { cor: "#0284c7", bgCls: "bg-sky-100",    textCls: "text-sky-700",    descricao: "Planejamento Escolar" },
  "PF": { cor: "#d97706", bgCls: "bg-amber-100",  textCls: "text-amber-700",  descricao: "Ponto Facultativo" },
  "EE": { cor: "#0891b2", bgCls: "bg-cyan-100",   textCls: "text-cyan-700",   descricao: "Evento Escolar" },
  "SL": { cor: "#2563eb", bgCls: "bg-blue-100",   textCls: "text-blue-700",   descricao: "Sábado Letivo" },
  "RE": { cor: "#f43f5e", bgCls: "bg-rose-50",     textCls: "text-rose-700",   descricao: "Recesso Escolar" },
};
const SIMBOLOS_ESPECIAIS_KEYS = ["&", "!"] as const;
const PRESET_SIMBOLO: Record<string, string> = {
  "Feriado":            "F",
  "Reunião Pedagógica": "RP",
  "Planejamento Escolar": "PE",
  "Ponto Facultativo":  "PF",
  "Evento Escolar":     "EE",
  "Sábado Letivo":      "SL",
  "Reunião Pedagógica Coletiva": "@",
  "Conselho de Classe": "CC",
  "Recesso Escolar":    "RE",
};
function isEventWithoutObservations(text: string, simbol: string | null): boolean {
  const s = (simbol || "").toUpperCase();
  if (["F", "PF", "EE", "SL", "@", "CC", "RE"].includes(s)) {
    return true;
  }
  const norm = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const standardTerms = [
    "feriado",
    "ponto facultativo",
    "evento escolar",
    "sabado letivo",
    "sábado letivo",
    "reunião pedagógica coletiva",
    "reuniao pedagogica coletiva",
    "conselho de classe",
    "recesso escolar"
  ];
  return standardTerms.includes(norm) || ["f", "pf", "ee", "sl", "@", "cc", "re"].includes(norm);
}
function getSimInfo(v: string): SimboloInfo | null {
  const t = v.trim();
  return SIMBOLO_MAPA[t] ?? SIMBOLO_MAPA[t.toUpperCase()] ?? null;
}

function partitionCols(weights: number[], targets: number[]): number[] {
  const n = targets.length;
  const total = weights.length;
  if (total <= n) {
    const spans = Array(n).fill(1);
    let sum = n;
    while (sum > total) {
      for (let i = n - 1; i >= 0 && sum > total; i--) {
        if (spans[i] > 1) {
          spans[i]--;
          sum--;
        }
      }
      break;
    }
    return spans;
  }

  const sumTargets = targets.reduce((a, b) => a + b, 0);
  let remaining = total;
  const spans: number[] = [];

  for (let i = 0; i < n - 1; i++) {
    const targetVal = (targets[i] / sumTargets) * total;
    const allocated = Math.max(1, Math.round(targetVal));
    spans.push(allocated);
    remaining -= allocated;
  }
  spans.push(remaining);

  while (spans[n - 1] < 1) {
    let stolen = false;
    for (let i = 0; i < n - 1; i++) {
      if (spans[i] > 1) {
        spans[i]--;
        spans[n - 1]++;
        stolen = true;
        break;
      }
    }
    if (!stolen) break;
  }

  return spans;
}

const QUICK_PRESETS = [
  "Feriado",
  "Ponto Facultativo",
  "Evento Escolar",
  "Sábado Letivo",
  "Reunião Pedagógica Coletiva",
  "Conselho de Classe",
  "Recesso Escolar",
];

export default function App() {
  const [turmas]                  = useTurmas();
  const [professores]             = useProfessores();
  const [disciplinas]             = useDisciplinas();
  const [alocacoes]               = useAlocacoes();
  const [config]                  = useConfiguracaoHorarios();
  const [registros, setRegistros] = useRegistrosPonto();
  const [nomeEscola]              = useNomeEscola();
  const [codigoEscola]            = useCodigoEscola();
  const { toast }                 = useToast();

  const now  = new Date();
  const [profId, setProfId] = useState(() => professores[0]?.id ?? "");
  const [discId, setDiscId] = useState("__todas__");
  const [month, setMonth]   = useState(now.getMonth() + 1);
  const [year,  setYear]    = useState(now.getFullYear());

  const [quickText,    setQuickText]    = useState("");
  const [quickDay,     setQuickDay]     = useState("");
  const [quickDow,     setQuickDow]     = useState<number[]>([]);
  const [quickSlots,   setQuickSlots]   = useState<string[]>(["todos"]);
  const [quickMonths,  setQuickMonths]  = useState<number[]>([now.getMonth() + 1]);
  const [quickApplied, setQuickApplied] = useState(false);
  const quickInputRef = useRef<HTMLInputElement>(null);

  const [specSymbol,  setSpecSymbol]  = useState<string>("&");
  const [specDay,     setSpecDay]     = useState<string>("todos");
  const [specDow,     setSpecDow]     = useState<number[]>([]);
  const [specSlots,   setSpecSlots]   = useState<string[]>(["todos"]);
  const [specApplied,  setSpecApplied]  = useState(false);
  const [specMonths,   setSpecMonths]   = useState<number[]>([month]);

  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);

  const obsRef = useRef<HTMLTextAreaElement>(null);

  function toggleQuickDow(dow: number) {
    setQuickDow(prev => prev.includes(dow) ? prev.filter(d => d !== dow) : [...prev, dow]);
    setQuickDay("todos");
  }
  function toggleQuickSlot(val: string) {
    if (val === "todos") { setQuickSlots(["todos"]); return; }
    setQuickSlots(prev => {
      const without = prev.filter(s => s !== "todos" && s !== val);
      const next = prev.includes(val) ? without : [...without, val];
      return next.length === 0 ? ["todos"] : next;
    });
  }

  function toggleQuickMonth(m: number) {
    setQuickMonths(prev => prev.includes(m)
      ? prev.length > 1 ? prev.filter(x => x !== m) : prev
      : [...prev, m]);
  }

  function toggleSpecDow(dow: number) {
    setSpecDow(prev => prev.includes(dow) ? prev.filter(d => d !== dow) : [...prev, dow]);
    setSpecDay("todos");
  }

  function toggleSpecMonth(m: number) {
    setSpecMonths(prev => prev.includes(m)
      ? prev.length > 1 ? prev.filter(x => x !== m) : prev
      : [...prev, m]);
  }

  function toggleSpecSlot(val: string) {
    if (val === "todos") { setSpecSlots(["todos"]); return; }
    setSpecSlots(prev => {
      const without = prev.filter(s => s !== "todos" && s !== val);
      const next = prev.includes(val) ? without : [...without, val];
      return next.length === 0 ? ["todos"] : next;
    });
  }

  // ── Undo / Redo ──────────────────────────────────────────────────────────────
  const registrosRef  = useRef<RegistroPonto[]>(registros);
  registrosRef.current = registros;
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // ── Escalar .a4-sheet na impressão (manual ou auto) ───────────────────────
  useEffect(() => {
    const beforePrint = () => {
      const el = document.querySelector('.a4-sheet') as HTMLElement | null;
      if (!el) return;
      const table = el.querySelector('table');
      if (!table) return;
      (el.style as any).zoom = '';
      const pxPerMm  = 3.7795;
      const contentH = table.scrollHeight;
      const availH   = 269 * pxPerMm;  // 297mm - 28mm (A4 height minus top 1.4cm and bottom 1.4cm)
      const availW   = 181 * pxPerMm;  // 210mm - 29mm (A4 width minus left 1.7cm and right 1.2cm)
      const scaleH   = availH / contentH;
      const scaleW   = availW / table.scrollWidth;
      let autoScale  = Math.min(scaleH, scaleW, 1);
      if (autoScale < 0.62) autoScale = 0.62; // Keep baseline scaling to minimum 62% to prevent any bottom footer/resumo clipping while keeping legible
      if (autoScale < 0.999) {
        (el.style as any).zoom = autoScale.toFixed(4);
      }
    };
    const afterPrint = () => {
      const el = document.querySelector('.a4-sheet') as HTMLElement | null;
      if (el) (el.style as any).zoom = '';
    };
    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', afterPrint);
    return () => {
    };
  }, []);

  function clearAllRegistros() {
    if (!confirm("Limpar todos os registros do mês para este professor? Esta ação pode ser desfeita.")) return;
    saveToHistory(registrosRef.current);
    const profAlocIds = new Set(profAlocs.map(a => a.id));
    const daysSet = new Set(days.map(d => toISO(d)));
    setRegistros(prev => prev.filter(r => !(profAlocIds.has(r.alocacaoId) && daysSet.has(r.data))));
    saveExtra({});
    setAssinMap({});

    async function clearCloud() {
      const uid = getUserId();
      if (!uid || uid === "local") return;

      if (profAlocIds.size > 0) {
        const alocIdsArray = Array.from(profAlocIds).map(id => id.startsWith(`${uid}_`) ? id : `${uid}_${id}`);
        const daysArray = Array.from(daysSet);
        await deleteRegistrosPonto({ alocacao_ids: alocIdsArray, datas: daysArray }, uid);
      }

      const extraPrefix = `extra_symbol:${profId}:${year}:${month}:`;
      const assinPrefix = `assin:${profId}:${year}:${month}:`;
      await deleteRegistrosPonto({ observacao_prefixes: [extraPrefix, assinPrefix] }, uid);
    }
    clearCloud();
    toast({ title: "Registros limpos", description: "Use Desfazer para reverter." });
  }

  const [assinMap, setAssinMap] = useState<Record<string,string>>({});
  const [extraSimbolos, setExtraSimbolos] = useState<Record<string,string>>({});
  const [obs, setObs] = useState("");
  const obsHistoryRef = useRef<string[]>([]);
  type ResumoFields = { presenca: string; faltas: string; licenca: string; freq: string; obsResumo: string };
  const [resumo, setResumo] = useState<ResumoFields>({ presenca: "", faltas: "", licenca: "", freq: "", obsResumo: "" });

  useEffect(() => {
    async function loadData() {
      const uid = getUserId();
      if (!uid || uid === "local") return;

      const data = await fetchRegistrosPonto(uid);

      if (data && data.length > 0) {
        const regularRegs: RegistroPonto[] = [];
        const loadedExtras: Record<string, string> = {};
        const loadedAssin: Record<string, string> = {};
        let loadedObs = "";
        let loadedResumo = { presenca: "", faltas: "", licenca: "", freq: "", obsResumo: "" };

        const extraPrefix = `extra_symbol:${profId}:${year}:${month}:`;
        const assinPrefix = `assin:${profId}:${year}:${month}:`;
        const obsPrefix = `obs_shared:${year}:${month}`;
        const resumoPrefix = `resumo:${profId}:${year}:${month}`;

        data.forEach((row: any) => {
          if (row.alocacao_id) {
            regularRegs.push(mapFromDbRegistroPonto(row));
          } else if (row.observacao) {
            if (row.observacao.startsWith(extraPrefix)) {
              const key = row.observacao.slice(extraPrefix.length);
              loadedExtras[key] = row.valor || "";
            } else if (row.observacao.startsWith(assinPrefix)) {
              const dayNum = row.observacao.slice(assinPrefix.length);
              loadedAssin[dayNum] = row.valor || "";
            } else if (row.observacao === obsPrefix) {
              loadedObs = row.valor || "";
            } else if (row.observacao === resumoPrefix) {
              try {
                loadedResumo = JSON.parse(row.valor || "null") ?? { presenca: "", faltas: "", licenca: "", freq: "", obsResumo: "" };
              } catch {
                loadedResumo = { presenca: "", faltas: "", licenca: "", freq: "", obsResumo: "" };
              }
            }
          }
        });

        setRegistros(regularRegs);
        setExtraSimbolos(loadedExtras);
        setObs(loadedObs);
        setAssinMap(loadedAssin);
        setResumo(loadedResumo);
        obsHistoryRef.current = [];
      }
    }

    loadData();
  }, [profId, year, month, setRegistros]);

  const saveAssin = async (dayNum: number, value: string) => {
    const next = { ...assinMap, [String(dayNum)]: value };
    setAssinMap(next);

    const uid = getUserId();
    if (!uid || uid === "local") return;

    const rowId = `${uid}_assin_${profId}_${year}_${month}_${dayNum}`;
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;

    if (value === "") {
      await deleteRegistrosPonto({ ids: [rowId] }, uid);
    } else {
      await upsertRegistrosPonto([{
        id: rowId,
        alocacao_id: null,
        data: dateStr,
        presente: true,
        valor: value,
        observacao: `assin:${profId}:${year}:${month}:${dayNum}`,
      }], uid);
    }
  };

  const saveExtra = async (next: Record<string, string>) => {
    setExtraSimbolos(next);

    const uid = getUserId();
    if (!uid || uid === "local") return;

    const prefix = `extra_symbol:${profId}:${year}:${month}:`;
    await deleteRegistrosPonto({ observacao_prefix: prefix }, uid);

    const rows = Object.entries(next).map(([key, val]) => {
      const dateStr = key.split("_")[0];
      const rowId = `${uid}_extra_${profId}_${year}_${month}_${key}`;
      return {
        id: rowId,
        alocacao_id: null,
        data: dateStr,
        presente: true,
        valor: val,
        observacao: `${prefix}${key}`,
      };
    });

    if (rows.length > 0) {
      await upsertRegistrosPonto(rows, uid);
    }
  };

  const removeExtra = (k: string) => {
    const next = { ...extraSimbolos };
    delete next[k];
    saveExtra(next);
  };

  const handleObsChange = async (v: string, skipHistory = false) => {
    if (!skipHistory) {
      saveToHistory(registrosRef.current, "Alteração de Observações");
    }
    obsHistoryRef.current = [...obsHistoryRef.current.slice(-29), obs];
    setObs(v);

    const uid = getUserId();
    if (!uid || uid === "local") return;

    const rowId = `${uid}_obs_shared_${year}_${month}`;
    const dateStr = `${year}-${String(month).padStart(2, '0')}-01`;

    if (v === "") {
      await deleteRegistrosPonto({ ids: [rowId] }, uid);
    } else {
      await upsertRegistrosPonto([{
        id: rowId,
        alocacao_id: null,
        data: dateStr,
        presente: true,
        valor: v,
        observacao: `obs_shared:${year}:${month}`,
      }], uid);
    }
  };

  const saveResumo = async (patch: Partial<ResumoFields>) => {
    saveToHistory(registrosRef.current, "Alteração do Resumo Mensal");
    const next = { ...resumo, ...patch };
    setResumo(next);

    const uid = getUserId();
    if (!uid || uid === "local") return;

    const rowId = `${uid}_resumo_${profId}_${year}_${month}`;
    const dateStr = `${year}-${String(month).padStart(2, '0')}-01`;

    await upsertRegistrosPonto([{
      id: rowId,
      alocacao_id: null,
      data: dateStr,
      presente: true,
      valor: JSON.stringify(next),
      observacao: `resumo:${profId}:${year}:${month}`,
    }], uid);
  };

  // ── Unified History & Undo/Redo Engine ──────────────────────────────────────
  interface HistoryEntry {
    registros: RegistroPonto[];
    extraSimbolos: Record<string, string>;
    obs: string;
    assinMap: Record<string, string>;
    resumo: ResumoFields;
    metadata?: {
      description?: string;
    };
  }

  const undoStackRef  = useRef<HistoryEntry[]>([]);
  const redoStackRef  = useRef<HistoryEntry[]>([]);
  
  const extraSimbolosRef = useRef<Record<string, string>>(extraSimbolos);
  extraSimbolosRef.current = extraSimbolos;

  const obsValRef = useRef<string>(obs);
  obsValRef.current = obs;

  const assinMapRef = useRef<Record<string, string>>(assinMap);
  assinMapRef.current = assinMap;

  const resumoRef = useRef<ResumoFields>(resumo);
  resumoRef.current = resumo;

  useEffect(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    setCanUndo(false);
    setCanRedo(false);
  }, [profId, year, month]);

  function saveToHistory(snapshot?: RegistroPonto[], description?: string) {
    const entry: HistoryEntry = {
      registros: snapshot || registrosRef.current,
      extraSimbolos: { ...extraSimbolosRef.current },
      obs: obsValRef.current,
      assinMap: { ...assinMapRef.current },
      resumo: { ...resumoRef.current },
      metadata: { description },
    };
    undoStackRef.current = [...undoStackRef.current.slice(-29), entry];
    redoStackRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }

  const saveToHistoryRef = useRef(saveToHistory);
  saveToHistoryRef.current = saveToHistory;

  async function applyHistoryState(entry: HistoryEntry) {
    setRegistros(entry.registros);
    setExtraSimbolos(entry.extraSimbolos);
    setObs(entry.obs);
    setAssinMap(entry.assinMap);
    setResumo(entry.resumo);

    try {
      const uid = getUserId();
      if (!uid || uid === "local") return;

      // 1. Delete regular registers
      const profAlocIds = new Set(profAlocs.map(a => a.id));
      const daysSet = new Set(days.map(d => toISO(d)));
      if (profAlocIds.size > 0) {
        const alocIdsArray = Array.from(profAlocIds).map(id => id.startsWith(`${uid}_`) ? id : `${uid}_${id}`);
        const daysArray = Array.from(daysSet);
        await deleteRegistrosPonto({ alocacao_ids: alocIdsArray, datas: daysArray }, uid);
      }

      // 2. Delete monthly extras, signatures, obs, summary
      const extraPrefix = `extra_symbol:${profId}:${year}:${month}:`;
      const assinPrefix = `assin:${profId}:${year}:${month}:`;
      await deleteRegistrosPonto({
        observacao_prefixes: [extraPrefix, assinPrefix, `obs_shared:${year}:${month}`, `resumo:${profId}:${year}:${month}`]
      }, uid);

      // 3. Write recovered rows
      const rowsToInsert: any[] = [];

      entry.registros.forEach((r) => {
        const rawAlocId = r.alocacaoId;
        const fullAlocId = rawAlocId.startsWith(`${uid}_`) ? rawAlocId : `${uid}_${rawAlocId}`;
        const rowId = r.id.startsWith(`${uid}_`) ? r.id : `${uid}_${r.id}`;
        rowsToInsert.push({
          id: rowId,
          alocacao_id: fullAlocId,
          data: r.data,
          presente: r.presente,
          valor: r.valor || null,
          observacao: null,
          user_id: uid
        });
      });

      Object.entries(entry.extraSimbolos).forEach(([key, val]) => {
        const dateStr = key.split("_")[0];
        const rowId = `${uid}_extra_${profId}_${year}_${month}_${key}`;
        rowsToInsert.push({
          id: rowId,
          alocacao_id: null,
          data: dateStr,
          presente: true,
          valor: val,
          observacao: `${extraPrefix}${key}`,
          user_id: uid
        });
      });

      Object.entries(entry.assinMap).forEach(([dayNum, val]) => {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
        const rowId = `${uid}_assin_${profId}_${year}_${month}_${dayNum}`;
        rowsToInsert.push({
          id: rowId,
          alocacao_id: null,
          data: dateStr,
          presente: true,
          valor: val,
          observacao: `${assinPrefix}${dayNum}`,
          user_id: uid
        });
      });

      if (entry.obs !== "") {
        const rowId = `${uid}_obs_shared_${year}_${month}`;
        const dateStr = `${year}-${String(month).padStart(2, '0')}-01`;
        rowsToInsert.push({
          id: rowId,
          alocacao_id: null,
          data: dateStr,
          presente: true,
          valor: entry.obs,
          observacao: `obs_shared:${year}:${month}`,
          user_id: uid
        });
      }

      const summaryRowId = `${uid}_resumo_${profId}_${year}_${month}`;
      const firstDateStr = `${year}-${String(month).padStart(2, '0')}-01`;
      rowsToInsert.push({
        id: summaryRowId,
        alocacao_id: null,
        data: firstDateStr,
        presente: true,
        valor: JSON.stringify(entry.resumo),
        observacao: `resumo:${profId}:${year}:${month}`,
        user_id: uid
      });

      if (rowsToInsert.length > 0) {
        await upsertRegistrosPonto(rowsToInsert, uid);
      }
    } catch (err) {
      console.error("Failed to sync restored history state to cloud:", err);
    }
  }

  function undoAction() {
    if (undoStackRef.current.length === 0) return;
    const prev = undoStackRef.current[undoStackRef.current.length - 1];
    
    const currentEntry: HistoryEntry = {
      registros: registrosRef.current,
      extraSimbolos: { ...extraSimbolosRef.current },
      obs: obsValRef.current,
      assinMap: { ...assinMapRef.current },
      resumo: { ...resumoRef.current },
      metadata: { description: prev.metadata?.description },
    };

    redoStackRef.current = [currentEntry, ...redoStackRef.current.slice(0, 29)];
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    
    applyHistoryState(prev);

    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(true);
    
    toast({
      title: "Desfeito",
      description: prev.metadata?.description ? `${prev.metadata.description} revertido.` : "Grelha restaurada.",
    });
  }

  function _redoAction() {
    if (redoStackRef.current.length === 0) return;
    const next = redoStackRef.current[0];
    
    const currentEntry: HistoryEntry = {
      registros: registrosRef.current,
      extraSimbolos: { ...extraSimbolosRef.current },
      obs: obsValRef.current,
      assinMap: { ...assinMapRef.current },
      resumo: { ...resumoRef.current },
      metadata: { description: next.metadata?.description },
    };

    undoStackRef.current = [...undoStackRef.current.slice(-29), currentEntry];
    redoStackRef.current = redoStackRef.current.slice(1);
    
    applyHistoryState(next);

    setCanUndo(true);
    setCanRedo(redoStackRef.current.length > 0);
    
    toast({
      title: "Refeito",
      description: next.metadata?.description ? `${next.metadata.description} reaplicado.` : "Grelha refeita.",
    });
  }

  useEffect(() => {
    const el = obsRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [obs]);
  const undoObs = () => {
    undoAction();
  };

  const prof     = useMemo(() => professores.find(p => p.id === profId), [professores, profId]);
  const turmaMap = useMemo(() => new Map(turmas.map(t => [t.id, t])), [turmas]);
  const discMap  = useMemo(() => new Map(disciplinas.map(d => [d.id, d])), [disciplinas]);

  const manhaQtd  = Number(config?.quantidadeHorariosPorDia ?? 6);
  const tardeQtd  = Number(config?.quantidadeHorariosPorDiaTarde ?? 5);
  const noiteQtd  = Number(config?.quantidadeHorariosPorDiaNoite ?? 4);

  const displayNoiteQtd = noiteQtd;
  const totalCols = 2 + manhaQtd + tardeQtd + noiteQtd + 1;

  const colWeights = useMemo(() => {
    return [
      2.71, // Dias
      7.57, // Semana
      ...Array(manhaQtd + tardeQtd + noiteQtd).fill(3.57), // Aulas
      22.86 // Assinatura
    ];
  }, [manhaQtd, tardeQtd, noiteQtd]);

  const [cMes, cAno, cTurno, cAdm] = useMemo(() => {
    return partitionCols(colWeights, [20, 15, 30, 35]);
  }, [colWeights]);

  const [cNome, cMasp] = useMemo(() => {
    return partitionCols(colWeights, [75, 25]);
  }, [colWeights]);

  const [cMateria, cCargo] = useMemo(() => {
    return partitionCols(colWeights, [75, 25]);
  }, [colWeights]);

  const profAlocs = useMemo(() => {
    let a = alocacoes.filter(x => x.professorId === profId);
    if (discId !== "__todas__") a = a.filter(x => x.disciplinaId === discId);
    return a;
  }, [alocacoes, profId, discId]);

  const alocIdx = useMemo(() => {
    const m = new Map<string, Alocacao>();
    for (const a of profAlocs) {
      const turno = turmaMap.get(a.turmaId)?.turno ?? "manha";
      m.set(`${a.diaSemana}-${turno}-${a.horario}`, a);
    }
    return m;
  }, [profAlocs, turmaMap]);

  const regIdx = useMemo(() => {
    const m = new Map<string, RegistroPonto>();
    for (const r of registros) m.set(`${r.alocacaoId}-${r.data}`, r);
    return m;
  }, [registros]);

  const lookupAloc = useCallback((date: Date, horario: number, turno: "manha" | "tarde" | "noite"): Alocacao | null =>
    alocIdx.get(`${JS_DAY_KEY[date.getDay()]}-${turno}-${horario}`) ?? null,
  [alocIdx]);

  const lookupReg = useCallback((alocId: string | null, dateStr: string): RegistroPonto | null => {
    if (!alocId) return null;
    return regIdx.get(`${alocId}-${dateStr}`) ?? null;
  }, [regIdx]);

  const updateReg = useCallback(async (aloc: Alocacao, dateStr: string, valor: string) => {
    saveToHistoryRef.current(registrosRef.current);
    try {
      const uid = getUserId();
      const fullAlocId = uid !== "local" && !aloc.id.startsWith(`${uid}_`) ? `${uid}_${aloc.id}` : aloc.id;

      if (valor === "") {
        if (uid !== "local") {
          await deleteRegistrosPonto({ alocacao_ids: [fullAlocId], datas: [dateStr] }, uid);
        }
        setRegistros(prev => prev.filter(r => !(r.alocacaoId === aloc.id && r.data === dateStr)));
        return;
      }

      const presente = derivePresente(valor);
      const rowId = `${uid !== "local" ? uid + "_" : ""}${generateId()}`;

      if (uid !== "local") {
        await upsertRegistrosPonto([{
          id: rowId,
          alocacao_id: fullAlocId,
          data: dateStr,
          presente,
          valor,
          observacao: null,
          user_id: uid
        }], uid);
      }

      setRegistros(prev => {
        const ex = prev.find(r => r.alocacaoId === aloc.id && r.data === dateStr);
        if (ex) return prev.map(r => r.id === ex.id ? { ...r, valor, presente } : r);
        const internalId = rowId.startsWith(`${uid}_`) ? rowId.slice(uid.length + 1) : rowId;
        return [...prev, { id: internalId, alocacaoId: aloc.id, data: dateStr, presente, valor }];
      });
    } catch (err) {
      console.error("Error updating register pointing on cloud:", err);
    }
  }, [setRegistros]);

  const days = useMemo(() => getDays(year, month), [year, month]);

  const materiaLabel = discId !== "__todas__"
    ? (discMap.get(discId)?.nome ?? "")
    : (prof?.disciplinas.map(id => discMap.get(id)?.nome).filter(Boolean).join(" / ") ?? "");

  const turnoLabel = (() => {
    const m = profAlocs.filter(a => { const tr = turmaMap.get(a.turmaId)?.turno; return !tr || tr === "manha"; }).length;
    const t = profAlocs.filter(a => turmaMap.get(a.turmaId)?.turno === "tarde").length;
    const n = profAlocs.filter(a => turmaMap.get(a.turmaId)?.turno === "noite").length;
    if (m > 0 && t > 0 && n > 0) return "Manhã/Tarde/Noite";
    if (m > 0 && t > 0) return "Manhã/Tarde";
    if (m > 0 && n > 0) return "Manhã/Noite";
    if (t > 0 && n > 0) return "Tarde/Noite";
    if (n > 0) return "Noite";
    if (t > 0) return "Tarde";
    return "Manhã";
  })();

  const turnoAbrev = (() => {
    const parts = [];
    const lower = (turnoLabel || "").toLowerCase();
    if (lower.includes("manhã")) parts.push("M");
    if (lower.includes("tarde")) parts.push("V");
    if (lower.includes("noite")) parts.push("N");
    return parts.length > 0 ? parts.join("/") : "M";
  })();

  const numAulasSemana = new Set(profAlocs.map(a => `${a.diaSemana}-${a.horario}`)).size;
  const cargoLabel     = prof?.tipoVinculo === "efetivo" ? "PEB" : prof?.tipoVinculo === "designado" ? "PEB-D" : "PEB";
  const vinculoLabel   = prof?.tipoVinculo === "efetivo" ? "Efetivo" : prof?.tipoVinculo === "designado" ? "Designado" : "";
  const emptyRows      = Math.max(0, 31 - days.length);

  const slotTurmaMap = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const a of profAlocs) {
      const turno = turmaMap.get(a.turmaId)?.turno ?? "manha";
      const key = `${turno}-${a.horario}`;
      const s = m.get(key) ?? new Set<string>();
      s.add(turmaMap.get(a.turmaId)?.nome ?? "");
      m.set(key, s);
    }
    return m;
  }, [profAlocs, turmaMap]);

  function abrevTurma(nome: string): string {
    const m = nome.match(/(\d+)[ºo°]?\s*(?:ano\s+)?([A-Z]?)/i);
    if (m) return `${m[1]}º${m[2]}`;
    return nome.length <= 5 ? nome : nome.slice(0, 5);
  }

  function formatDateBR(s?: string): string {
    if (!s) return "—";
    const parts = s.split("-");
    if (parts.length !== 3) return s;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  function applyQuickFill() {
    if (!quickText.trim()) return;
    if (quickDow.length === 0 && (quickDay === "" || quickDay === "todos")) {
      toast({ title: "Selecione um dia", description: "Escolha um ou mais dias da semana ou uma data específica.", variant: "destructive" });
      return;
    }
    const text     = quickText.trim();
    saveToHistory(registrosRef.current, `Preenchimento rápido: ${text}`);
    const simbol   = PRESET_SIMBOLO[text] ?? null;
    const desc     = simbol ? (SIMBOLO_MAPA[simbol]?.descricao ?? text) : text;
    const prefix   = simbol ? `${simbol} ` : "";
    const allSlots = quickSlots.includes("todos");
    const selectedCodes = allSlots
      ? [
          ...Array.from({ length: manhaQtd }, (_, i) => `m${i + 1}`),
          ...Array.from({ length: tardeQtd  }, (_, i) => `t${i + 1}`),
          ...Array.from({ length: noiteQtd  }, (_, i) => `n${i + 1}`),
        ]
      : quickSlots;
    const slotSuffix = allSlots ? "" : ` (${selectedCodes.map(s => s.startsWith("m") ? `${s.slice(1)}ªM` : s.startsWith("t") ? `${s.slice(1)}ªV` : `${s.slice(1)}ªN`).join(", ")})`;

    const DOW_LABEL = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
    let allRegs = [...registrosRef.current];
    const obsLines: string[] = [];

    const isSpecialAllProfs = simbol ? ["F", "PF", "EE", "SL", "@", "CC", "RE"].includes(simbol) : false;

    for (const m of quickMonths) {
      const mDays = getDays(year, m);
      let targetDays: Date[];
      let obsLine = "";

      if (quickDow.length > 0) {
        targetDays = mDays.filter(d => quickDow.includes(d.getDay()));
        const dowLabels = quickDow.map(d => DOW_LABEL[d]).join(", ");
        obsLine = `${prefix}${desc}${slotSuffix} — ${dowLabels} de ${MESES[m - 1]}/${year}`;
      } else if (quickDay === "todos") {
        targetDays = mDays.filter(d => !IS_WEEKEND(d.getDay()));
        obsLine = `${prefix}${desc}${slotSuffix} — dias úteis de ${MESES[m - 1]}/${year}`;
      } else {
        const d = mDays.find(d => d.getDate() === Number(quickDay));
        if (!d) continue;
        targetDays = [d];
        const dayName = JS_DAY_NOME[d.getDay()];
        obsLine = `Dia ${String(d.getDate()).padStart(2, "0")}/${String(m).padStart(2, "0")} (${dayName}): ${prefix}${desc}${slotSuffix}`;
        if (m === month && (IS_WEEKEND(d.getDay()) || isFeriadoNacional(d))) saveAssin(d.getDate(), "");
      }
      if (targetDays.length === 0) continue;

      if (simbol) {
        for (const d of targetDays) {
          const dk = JS_DAY_KEY[d.getDay()];
          const ds = toISO(d);
          let dayAlocs = (isSpecialAllProfs ? alocacoes : profAlocs).filter(a => a.diaSemana === dk);
          if (!allSlots) {
            dayAlocs = dayAlocs.filter(a => selectedCodes.some(s => {
              const turno = s.startsWith("m") ? "manha" : s.startsWith("t") ? "tarde" : "noite";
              const num   = Number(s.slice(1));
              return a.horario === num && (turmaMap.get(a.turmaId)?.turno ?? "manha") === turno;
            }));
          }
          for (const aloc of dayAlocs) {
            const ex = allRegs.find(r => r.alocacaoId === aloc.id && r.data === ds);
            if (ex) allRegs = allRegs.map(r => r.id === ex.id ? { ...r, valor: simbol, presente: true } : r);
            else    allRegs = [...allRegs, { id: generateId(), alocacaoId: aloc.id, data: ds, presente: true, valor: simbol }];
          }
        }

        if (isSpecialAllProfs) {
          for (const p of professores) {
            let extras: Record<string, string> = (p.id === profId && m === month) ? { ...extraSimbolos } : {};

            const pAlocs = alocacoes.filter(x => x.professorId === p.id);
            for (const d of targetDays) {
              if (IS_WEEKEND(d.getDay()) || isFeriadoNacional(d)) continue;
              const ds = toISO(d);
              const dk = JS_DAY_KEY[d.getDay()];
              for (const s of selectedCodes) {
                const turno = s.startsWith("m") ? "manha" as const : s.startsWith("t") ? "tarde" as const : "noite" as const;
                const num   = Number(s.slice(1));
                const hasAloc = pAlocs.some(a => a.diaSemana === dk && a.horario === num && (turmaMap.get(a.turmaId)?.turno ?? "manha") === turno);
                if (!hasAloc) extras[`${ds}_${num}_${turno}`] = simbol;
              }
            }
            if (p.id === profId && m === month) setExtraSimbolos(extras);

            let mAssin: Record<string, string> = (p.id === profId && m === month) ? { ...assinMap } : {};
            for (const d of targetDays) {
              mAssin[String(d.getDate())] = text.toUpperCase();
            }
            if (p.id === profId && m === month) setAssinMap(mAssin);
          }
        } else {
          let extras: Record<string, string> = (m === month) ? { ...extraSimbolos } : {};
          for (const d of targetDays) {
            if (IS_WEEKEND(d.getDay()) || isFeriadoNacional(d)) continue;
            const ds = toISO(d);
            const dk = JS_DAY_KEY[d.getDay()];
            for (const s of selectedCodes) {
              const turno = s.startsWith("m") ? "manha" as const : s.startsWith("t") ? "tarde" as const : "noite" as const;
              const num   = Number(s.slice(1));
              const hasAloc = profAlocs.some(a => a.diaSemana === dk && a.horario === num && (turmaMap.get(a.turmaId)?.turno ?? "manha") === turno);
              if (!hasAloc) extras[`${ds}_${num}_${turno}`] = simbol;
            }
          }
          if (m === month) setExtraSimbolos(extras);

          let mAssin: Record<string, string> = (m === month) ? { ...assinMap } : {};
          for (const d of targetDays) {
            mAssin[String(d.getDate())] = text.toUpperCase();
          }
          if (m === month) setAssinMap(mAssin);
        }
      }
      if (!isEventWithoutObservations(text, simbol)) {
        obsLines.push(obsLine);
      }
    }

    if (simbol) setRegistros(allRegs);

    const append = obsLines.join("\n");
    if (append) {
      handleObsChange(obs ? `${obs}\n${append}` : append, true);
    }

    async function saveQuickFillToCloudBulk() {
      const uid = getUserId();
      if (!uid || uid === "local") return;

      const rows: any[] = [];
      
      if (simbol) {
        allRegs.forEach(r => {
          const rawAlocId = r.alocacaoId;
          const fullAlocId = rawAlocId.startsWith(`${uid}_`) ? rawAlocId : `${uid}_${rawAlocId}`;
          const rowId = r.id.startsWith(`${uid}_`) ? r.id : `${uid}_${r.id}`;
          rows.push({
            id: rowId,
            alocacao_id: fullAlocId,
            data: r.data,
            presente: r.presente,
            valor: r.valor || null,
            observacao: null,
            user_id: uid
          });
        });
      }

      for (const m of quickMonths) {
        if (isSpecialAllProfs) {
          for (const p of professores) {
            let extras: Record<string, string> = {};
            if (p.id === profId && m === month) extras = { ...extraSimbolos };

            const pAlocs = alocacoes.filter(x => x.professorId === p.id);
            const mDays = getDays(year, m);
            let targetDays = quickDow.length > 0
              ? mDays.filter(d => quickDow.includes(d.getDay()))
              : quickDay === "todos"
                ? mDays.filter(d => !IS_WEEKEND(d.getDay()))
                : mDays.filter(d => d.getDate() === Number(quickDay));

            for (const d of targetDays) {
              if (IS_WEEKEND(d.getDay()) || isFeriadoNacional(d)) continue;
              const ds = toISO(d);
              const dk = JS_DAY_KEY[d.getDay()];
              for (const s of selectedCodes) {
                const turno = s.startsWith("m") ? "manha" as const : s.startsWith("t") ? "tarde" as const : "noite" as const;
                const num   = Number(s.slice(1));
                const hasAloc = pAlocs.some(a => a.diaSemana === dk && a.horario === num && (turmaMap.get(a.turmaId)?.turno ?? "manha") === turno);
                if (!hasAloc) extras[`${ds}_${num}_${turno}`] = simbol;
              }
            }

            const extraPrefix = `extra_symbol:${p.id}:${year}:${m}:`;
            Object.entries(extras).forEach(([key, val]) => {
              const dateStr = key.split("_")[0];
              const rowId = `${uid}_extra_${p.id}_${year}_${m}_${key}`;
              rows.push({
                id: rowId,
                alocacao_id: null,
                data: dateStr,
                presente: true,
                valor: val,
                observacao: `${extraPrefix}${key}`,
                user_id: uid
              });
            });

            let mAssin: Record<string, string> = {};
            if (p.id === profId && m === month) mAssin = { ...assinMap };
            for (const d of targetDays) {
              mAssin[String(d.getDate())] = text.toUpperCase();
            }

            const assinPrefix = `assin:${p.id}:${year}:${m}:`;
            Object.entries(mAssin).forEach(([dayNum, val]) => {
              const dateStr = `${year}-${String(m).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
              const rowId = `${uid}_assin_${p.id}_${year}_${m}_${dayNum}`;
              rows.push({
                id: rowId,
                alocacao_id: null,
                data: dateStr,
                presente: true,
                valor: val,
                observacao: `${assinPrefix}${dayNum}`,
                user_id: uid
              });
            });
          }
        } else {
          let extras: Record<string, string> = m === month ? { ...extraSimbolos } : {};
          const mDays = getDays(year, m);
          let targetDays = quickDow.length > 0
            ? mDays.filter(d => quickDow.includes(d.getDay()))
            : quickDay === "todos"
              ? mDays.filter(d => !IS_WEEKEND(d.getDay()))
              : mDays.filter(d => d.getDate() === Number(quickDay));

          for (const d of targetDays) {
            if (IS_WEEKEND(d.getDay()) || isFeriadoNacional(d)) continue;
            const ds = toISO(d);
            const dk = JS_DAY_KEY[d.getDay()];
            for (const s of selectedCodes) {
              const turno = s.startsWith("m") ? "manha" as const : s.startsWith("t") ? "tarde" as const : "noite" as const;
              const num   = Number(s.slice(1));
              const hasAloc = profAlocs.some(a => a.diaSemana === dk && a.horario === num && (turmaMap.get(a.turmaId)?.turno ?? "manha") === turno);
              if (!hasAloc) extras[`${ds}_${num}_${turno}`] = simbol;
            }
          }

          const extraPrefix = `extra_symbol:${profId}:${year}:${m}:`;
          Object.entries(extras).forEach(([key, val]) => {
            const dateStr = key.split("_")[0];
            const rowId = `${uid}_extra_${profId}_${year}_${m}_${key}`;
            rows.push({
              id: rowId,
              alocacao_id: null,
              data: dateStr,
              presente: true,
              valor: val,
              observacao: `${extraPrefix}${key}`,
              user_id: uid
            });
          });

          let mAssin: Record<string, string> = m === month ? { ...assinMap } : {};
          for (const d of targetDays) {
            mAssin[String(d.getDate())] = text.toUpperCase();
          }

          const assinPrefix = `assin:${profId}:${year}:${m}:`;
          Object.entries(mAssin).forEach(([dayNum, val]) => {
            const dateStr = `${year}-${String(m).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
            const rowId = `${uid}_assin_${profId}_${year}_${m}_${dayNum}`;
            rows.push({
              id: rowId,
              alocacao_id: null,
              data: dateStr,
              presente: true,
              valor: val,
              observacao: `${assinPrefix}${dayNum}`,
              user_id: uid
            });
          });
        }
      }

      if (rows.length > 0) {
        await upsertRegistrosPonto(rows, uid);
      }
    }
    saveQuickFillToCloudBulk();
    setQuickApplied(true);
    setTimeout(() => setQuickApplied(false), 1500);
    toast({ title: "Preenchimento aplicado", description: `${quickMonths.map(m => MESES_ABREV[m - 1]).join(", ")}` });
  }

  function applySpecialSymbol() {
    const symbol   = specSymbol;
    const info     = SIMBOLO_MAPA[symbol];
    saveToHistory(registrosRef.current, `Aplicação do símbolo: ${info?.descricao ?? symbol}`);
    const restless = info?.descricao ?? symbol;
    const allSlots = specSlots.includes("todos");
    const selectedCodes = allSlots
      ? [
          ...Array.from({ length: manhaQtd }, (_, i) => `m${i + 1}`),
          ...Array.from({ length: tardeQtd  }, (_, i) => `t${i + 1}`),
          ...Array.from({ length: noiteQtd  }, (_, i) => `n${i + 1}`),
        ]
      : specSlots;
    const slotLabel = allSlots
      ? "todos os horários"
      : selectedCodes.map(s => s.startsWith("m") ? `${s.slice(1)}ª M` : s.startsWith("t") ? `${s.slice(1)}ª V` : `${s.slice(1)}ª N`).join(", ");

    const isSpecialAllProfs = ["F", "PF", "EE", "SL", "@", "CC", "RE"].includes(symbol);

    function slotsForDay(d: Date): Alocacao[] {
      const dk = JS_DAY_KEY[d.getDay()];
      const base = (isSpecialAllProfs ? alocacoes : profAlocs).filter(a => a.diaSemana === dk);
      if (allSlots) return base;
      return base.filter(a => selectedCodes.some(s => {
        const turno = s.startsWith("m") ? "manha" : s.startsWith("t") ? "tarde" : "noite";
        const num   = Number(s.slice(1));
        return a.horario === num && (turmaMap.get(a.turmaId)?.turno ?? "manha") === turno;
      }));
    }

    let allRegs = [...registrosRef.current];
    const obsLines: string[] = [];
    const DOW_LABEL = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];

    for (const m of specMonths) {
      const mDays = getDays(year, m);
      let targetDays: Date[];
      let obsLine = "";

      if (specDow.length > 0) {
        targetDays = mDays.filter(d => specDow.includes(d.getDay()));
        const dowLabels = specDow.map(d => DOW_LABEL[d]).join(", ");
        obsLine = `${symbol} ${info?.descricao ?? symbol} — ${dowLabels} (${slotLabel}) — ${MESES[m-1]}/${year}`;
      } else if (specDay === "todos") {
        targetDays = mDays.filter(d => !IS_WEEKEND(d.getDay()));
        obsLine = `${symbol} ${info?.descricao ?? symbol} — dias úteis (${slotLabel}) — ${MESES[m-1]}/${year}`;
      } else {
        const d = mDays.find(d => d.getDate() === Number(specDay));
        if (!d) continue;
        targetDays = [d];
        const dayName = JS_DAY_NOME[d.getDay()];
        obsLine = `Dia ${String(d.getDate()).padStart(2,"0")}/${String(m).padStart(2,"0")} (${dayName}): ${symbol} ${info?.descricao ?? symbol} — ${slotLabel}`;
      }
      if (targetDays.length === 0) continue;

      for (const d of targetDays) {
        const ds = toISO(d);
        for (const aloc of slotsForDay(d)) {
          const ex = allRegs.find(r => r.alocacaoId === aloc.id && r.data === ds);
          if (ex) allRegs = allRegs.map(r => r.id === ex.id ? { ...r, valor: symbol, presente: true } : r);
          else    allRegs = [...allRegs, { id: generateId(), alocacaoId: aloc.id, data: ds, presente: true, valor: symbol }];
        }
      }

      if (isSpecialAllProfs) {
        for (const p of professores) {
          let extras: Record<string, string> = (p.id === profId && m === month) ? { ...extraSimbolos } : {};

          const pAlocs = alocacoes.filter(x => x.professorId === p.id);
          for (const d of targetDays) {
            if (IS_WEEKEND(d.getDay()) || isFeriadoNacional(d)) continue;
            const ds = toISO(d);
            const dk = JS_DAY_KEY[d.getDay()];
            for (const s of selectedCodes) {
              const turno = s.startsWith("m") ? "manha" as const : s.startsWith("t") ? "tarde" as const : "noite" as const;
              const num   = Number(s.slice(1));
              const hasAloc = pAlocs.some(
                a => a.diaSemana === dk && a.horario === num
                  && (turmaMap.get(a.turmaId)?.turno ?? "manha") === turno
              );
              if (!hasAloc) extras[`${ds}_${num}_${turno}`] = symbol;
            }
          }
          if (p.id === profId && m === month) setExtraSimbolos(extras);

          let mAssin: Record<string, string> = (p.id === profId && m === month) ? { ...assinMap } : {};
          for (const d of targetDays) {
            mAssin[String(d.getDate())] = restless.toUpperCase();
          }
          if (p.id === profId && m === month) setAssinMap(mAssin);
        }
      } else {
        let extras: Record<string, string> = (m === month) ? { ...extraSimbolos } : {};

        for (const d of targetDays) {
          if (IS_WEEKEND(d.getDay()) || isFeriadoNacional(d)) continue;
          const ds = toISO(d);
          const dk = JS_DAY_KEY[d.getDay()];
          for (const s of selectedCodes) {
            const turno = s.startsWith("m") ? "manha" as const : s.startsWith("t") ? "tarde" as const : "noite" as const;
            const num   = Number(s.slice(1));
            const hasAloc = profAlocs.some(
              a => a.diaSemana === dk && a.horario === num
                && (turmaMap.get(a.turmaId)?.turno ?? "manha") === turno
            );
            if (!hasAloc) extras[`${ds}_${num}_${turno}`] = symbol;
          }
        }
        if (m === month) setExtraSimbolos(extras);

        let mAssin: Record<string, string> = (m === month) ? { ...assinMap } : {};
        for (const d of targetDays) {
          mAssin[String(d.getDate())] = restless.toUpperCase();
        }
        if (m === month) setAssinMap(mAssin);
      }

      if (!isEventWithoutObservations(restless, symbol)) {
        obsLines.push(obsLine);
      }
    }

    setRegistros(allRegs);

    if (obsLines.length > 0) {
      const append = obsLines.join("\n");
      handleObsChange(obs ? `${obs}\n${append}` : append, true);
    }

    async function saveSpecialSymbolToCloudBulk() {
      const uid = getUserId();
      if (!uid || uid === "local") return;

      const rows: any[] = [];
      
      allRegs.forEach(r => {
        const rawAlocId = r.alocacaoId;
        const fullAlocId = rawAlocId.startsWith(`${uid}_`) ? rawAlocId : `${uid}_${rawAlocId}`;
        const rowId = r.id.startsWith(`${uid}_`) ? r.id : `${uid}_${r.id}`;
        rows.push({
          id: rowId,
          alocacao_id: fullAlocId,
          data: r.data,
          presente: r.presente,
          valor: r.valor || null,
          observacao: null,
          user_id: uid
        });
      });

      for (const m of specMonths) {
        if (isSpecialAllProfs) {
          for (const p of professores) {
            let extras: Record<string, string> = {};
            if (p.id === profId && m === month) extras = { ...extraSimbolos };

            const pAlocs = alocacoes.filter(x => x.professorId === p.id);
            const mDays = getDays(year, m);
            let targetDays = specDow.length > 0
              ? mDays.filter(d => specDow.includes(d.getDay()))
              : specDay === "todos"
                ? mDays.filter(d => !IS_WEEKEND(d.getDay()))
                : mDays.filter(d => d.getDate() === Number(specDay));

            for (const d of targetDays) {
              if (IS_WEEKEND(d.getDay()) || isFeriadoNacional(d)) continue;
              const ds = toISO(d);
              const dk = JS_DAY_KEY[d.getDay()];
              for (const s of selectedCodes) {
                const turno = s.startsWith("m") ? "manha" as const : s.startsWith("t") ? "tarde" as const : "noite" as const;
                const num   = Number(s.slice(1));
                const hasAloc = pAlocs.some(a => a.diaSemana === dk && a.horario === num && (turmaMap.get(a.turmaId)?.turno ?? "manha") === turno);
                if (!hasAloc) extras[`${ds}_${num}_${turno}`] = symbol;
              }
            }

            const extraPrefix = `extra_symbol:${p.id}:${year}:${m}:`;
            Object.entries(extras).forEach(([key, val]) => {
              const dateStr = key.split("_")[0];
              const rowId = `${uid}_extra_${p.id}_${year}_${m}_${key}`;
              rows.push({
                id: rowId,
                alocacao_id: null,
                data: dateStr,
                presente: true,
                valor: val,
                observacao: `${extraPrefix}${key}`,
                user_id: uid
              });
            });

            let mAssin: Record<string, string> = {};
            if (p.id === profId && m === month) mAssin = { ...assinMap };
            for (const d of targetDays) {
              mAssin[String(d.getDate())] = restless.toUpperCase();
            }

            const assinPrefix = `assin:${p.id}:${year}:${m}:`;
            Object.entries(mAssin).forEach(([dayNum, val]) => {
              const dateStr = `${year}-${String(m).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
              const rowId = `${uid}_assin_${p.id}_${year}_${m}_${dayNum}`;
              rows.push({
                id: rowId,
                alocacao_id: null,
                data: dateStr,
                presente: true,
                valor: val,
                observacao: `${assinPrefix}${dayNum}`,
                user_id: uid
              });
            });
          }
        } else {
          let extras: Record<string, string> = m === month ? { ...extraSimbolos } : {};
          const mDays = getDays(year, m);
          let targetDays = specDow.length > 0
            ? mDays.filter(d => specDow.includes(d.getDay()))
            : specDay === "todos"
              ? mDays.filter(d => !IS_WEEKEND(d.getDay()))
              : mDays.filter(d => d.getDate() === Number(specDay));

          for (const d of targetDays) {
            if (IS_WEEKEND(d.getDay()) || isFeriadoNacional(d)) continue;
            const ds = toISO(d);
            const dk = JS_DAY_KEY[d.getDay()];
            for (const s of selectedCodes) {
              const turno = s.startsWith("m") ? "manha" as const : s.startsWith("t") ? "tarde" as const : "noite" as const;
              const num   = Number(s.slice(1));
              const hasAloc = profAlocs.some(a => a.diaSemana === dk && a.horario === num && (turmaMap.get(a.turmaId)?.turno ?? "manha") === turno);
              if (!hasAloc) extras[`${ds}_${num}_${turno}`] = symbol;
            }
          }

          const extraPrefix = `extra_symbol:${profId}:${year}:${m}:`;
          Object.entries(extras).forEach(([key, val]) => {
            const dateStr = key.split("_")[0];
            const rowId = `${uid}_extra_${profId}_${year}_${m}_${key}`;
            rows.push({
              id: rowId,
              alocacao_id: null,
              data: dateStr,
              presente: true,
              valor: val,
              observacao: `${extraPrefix}${key}`,
              user_id: uid
            });
          });

          let mAssin: Record<string, string> = m === month ? { ...assinMap } : {};
          for (const d of targetDays) {
            mAssin[String(d.getDate())] = restless.toUpperCase();
          }

          const assinPrefix = `assin:${profId}:${year}:${m}:`;
          Object.entries(mAssin).forEach(([dayNum, val]) => {
            const dateStr = `${year}-${String(m).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
            const rowId = `${uid}_assin_${profId}_${year}_${m}_${dayNum}`;
            rows.push({
              id: rowId,
              alocacao_id: null,
              data: dateStr,
              presente: true,
              valor: val,
              observacao: `${assinPrefix}${dayNum}`,
              user_id: uid
            });
          });
        }
      }

      if (rows.length > 0) {
        await upsertRegistrosPonto(rows, uid);
      }
    }
    saveSpecialSymbolToCloudBulk();

    setSpecApplied(true);
    setTimeout(() => setSpecApplied(false), 1500);
    toast({
      title: "Símbolo aplicado",
      description: `${symbol} — ${info?.descricao ?? symbol} — ${specMonths.map(m => MESES_ABREV[m-1]).join(", ")}`,
    });
  }

  function clearSpecialSymbols() {
    saveToHistory(registrosRef.current);
    const allSlotsClear = specSlots.includes("todos");
    const selectedCodes = allSlotsClear
      ? [
          ...Array.from({ length: manhaQtd }, (_, i) => `m${i + 1}`),
          ...Array.from({ length: tardeQtd  }, (_, i) => `t${i + 1}`),
          ...Array.from({ length: noiteQtd  }, (_, i) => `n${i + 1}`),
        ]
      : specSlots;

    let allRegs = [...registrosRef.current];

    async function syncClearLocalAndCloud() {
      const uid = getUserId();
      if (!uid || uid === "local") return;

      const extraDeletions: string[] = [];

      for (const m of specMonths) {
        const mDays = getDays(year, m);
        const targetDays = specDow.length > 0
          ? mDays.filter(d => specDow.includes(d.getDay()))
          : specDay === "todos"
            ? mDays.filter(d => !IS_WEEKEND(d.getDay()))
            : mDays.filter(d => d.getDate() === Number(specDay));

        if (targetDays.length === 0) continue;

        let extras: Record<string, string> = (m === month) ? { ...extraSimbolos } : {};
        for (const d of targetDays) {
          const ds = toISO(d);
          for (const s of selectedCodes) {
            const turno = s.startsWith("m") ? "manha" : s.startsWith("t") ? "tarde" : "noite";
            const num   = Number(s.slice(1));
            const key = `${ds}_${num}_${turno}`;
            if (extras[key]) {
              delete extras[key];
              extraDeletions.push(`${uid}_extra_${profId}_${year}_${m}_${key}`);
            }
          }
        }
        if (m === month) setExtraSimbolos(extras);

        const targetSet = new Set(targetDays.map(d => toISO(d)));
        allRegs = allRegs.map(r => {
          if (!targetSet.has(r.data)) return r;
          const aloc = profAlocs.find(a => a.id === r.alocacaoId);
          if (!aloc) return r;
          const d = targetDays.find(d => toISO(d) === r.data)!;
          const dk = JS_DAY_KEY[d.getDay()];
          if (aloc.diaSemana !== dk) return r;
          const matches = selectedCodes.some(s => {
            const turno = s.startsWith("m") ? "manha" : s.startsWith("t") ? "tarde" : "noite";
            const num   = Number(s.slice(1));
            return aloc.horario === num && (turmaMap.get(aloc.turmaId)?.turno ?? "manha") === turno;
          });
          return matches ? { ...r, valor: undefined, presente: false } : r;
        });
      }

      setRegistros(allRegs);

      // Deletions database-side
      if (extraDeletions.length > 0) {
        await deleteRegistrosPonto({ ids: extraDeletions }, uid);
      }

      // Sync remaining registrations
      const rowsToUpsert: any[] = [];
      allRegs.forEach(r => {
        const rawAlocId = r.alocacaoId;
        const fullAlocId = rawAlocId.startsWith(`${uid}_`) ? rawAlocId : `${uid}_${rawAlocId}`;
        const rowId = r.id.startsWith(`${uid}_`) ? r.id : `${uid}_${r.id}`;
        rowsToUpsert.push({
          id: rowId,
          alocacao_id: fullAlocId,
          data: r.data,
          presente: r.presente,
          valor: r.valor || null,
          observacao: null,
          user_id: uid
        });
      });

      if (rowsToUpsert.length > 0) {
        await upsertRegistrosPonto(rowsToUpsert, uid);
      }
    }

    syncClearLocalAndCloud();
    toast({ title: "Símbolos removidos", description: `Meses: ${specMonths.map(m => MESES_ABREV[m-1]).join(", ")}` });
  }

  async function handlePrintProfs(profsToPrint: typeof professores) {
    if (isGeneratingPdf) return;
    setIsGeneratingPdf(true);

    const printScale = 80;
    const printMarginLeft = 12.5;
    const printMarginRight = 12.5;
    const printMarginTop = 10;
    const printMarginBottom = 10;

    try {
      function abrevT(nome: string): string {
        const m = nome.match(/(\d+)[ºo°]?\s*(?:ano\s+)?([A-Z]?)/i);
        return m ? `${m[1]}º${m[2]}` : nome.slice(0, 5);
      }
      function fmtDate(s?: string) {
        if (!s) return "—";
        const p = s.split("-"); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s;
      }

      const profDocs = profsToPrint.map((p) => {
        const profIdx = professores.findIndex(x => x.id === p.id);
        const pAlocs = alocacoes.filter(a => a.professorId === p.id);
        const days   = getDays(year, month);

        function slotLabel(turno: "manha" | "tarde" | "noite", horario: number) {
          const names = new Set(
            pAlocs
              .filter(a => a.horario === horario && (turmaMap.get(a.turmaId)?.turno ?? "manha") === turno)
              .map(a => abrevT(turmaMap.get(a.turmaId)?.nome ?? ""))
          );
          return Array.from(names).join("/");
        }
        const pNoiteQtd = Number(config?.quantidadeHorariosPorDiaNoite ?? 4);

        const pTotalCols = 2 + manhaQtd + tardeQtd + pNoiteQtd + 1;
        const pHalf  = Math.ceil(pTotalCols / 2);
        const pHalf2 = Math.floor(pTotalCols / 2);
        
        const pColWeights = [
          2.71, // Dias
          7.57, // Semana
          ...Array(manhaQtd + tardeQtd + pNoiteQtd).fill(3.57), // Aulas
          22.86 // Assinatura
        ];

        const [cMes, cAno, cTurno, cAdm] = partitionCols(pColWeights, [20, 15, 30, 35]);
        const [cNome, cMasp] = partitionCols(pColWeights, [75, 25]);
        const [cMateria, cCargo] = partitionCols(pColWeights, [75, 25]);
        
        const pTotalSlots = manhaQtd + tardeQtd + pNoiteQtd;
        const daysPct = 2.71;
        const semPct = 7.57;
        const assPct = 22.86;
        const pSlotPct = 3.57;

        const pColGroupHTML = [
          `<col style="width: ${daysPct}%" />`,
          `<col style="width: ${semPct}%" />`,
          ...Array.from({ length: manhaQtd }, () => `<col style="width: ${pSlotPct}%" />`),
          ...Array.from({ length: tardeQtd }, () => `<col style="width: ${pSlotPct}%" />`),
          ...Array.from({ length: pNoiteQtd }, () => `<col style="width: ${pSlotPct}%" />`),
          `<col style="width: ${assPct}%" />`
        ].join("");

        const TH = `style="text-align:center;background:#f8fafc;font-weight:600;color:#000000;vertical-align:middle;padding:6px 4px;border:1px solid #000000"`;

        const mH1 = manhaQtd  > 0 ? `<td colspan="${manhaQtd}"  ${TH}>Matutino</td>`  : "";
        const tH1 = tardeQtd  > 0 ? `<td colspan="${tardeQtd}"  ${TH}>Vespertino</td>` : "";
        const nH1 = pNoiteQtd > 0 ? `<td colspan="${pNoiteQtd}" ${TH}>Noturno</td>`    : "";
        const mH2 = Array.from({length: manhaQtd}, (_, i) =>
          `<td ${TH} style="text-align:center;background:white;font-weight:bold;font-size:12px;vertical-align:middle">${i+1}ª<br>aula</td>`).join("");
        const tH2 = Array.from({length: tardeQtd}, (_, i) =>
          `<td ${TH} style="text-align:center;background:white;font-weight:bold;font-size:12px;vertical-align:middle">${i+1}ª<br>aula</td>`).join("");
        const nH2 = Array.from({length: pNoiteQtd}, (_, i) =>
          `<td ${TH} style="text-align:center;background:white;font-weight:bold;font-size:12px;vertical-align:middle">${i+1}ª<br>aula</td>`).join("");

        const pAssinData = (() => { try { return JSON.parse(localStorage.getItem(storageKey(`edu_ponto_assin_${p.id}_${year}_${month}`)) ?? "{}") ?? {}; } catch { return {} as Record<string,string>; } })();
        const pExtraData: Record<string,string> = (() => { try { return JSON.parse(localStorage.getItem(storageKey(`edu_ponto_extra_${p.id}_${year}_${month}`)) ?? "{}") ?? {}; } catch { return {}; } })();
        
        const turnoLbl = (() => {
          const m = pAlocs.filter(a => { const tr = turmaMap.get(a.turmaId)?.turno; return !tr || tr === "manha"; }).length;
          const t = pAlocs.filter(a => turmaMap.get(a.turmaId)?.turno === "tarde").length;
          const n = pAlocs.filter(a => turmaMap.get(a.turmaId)?.turno === "noite").length;
          if (m > 0 && t > 0 && n > 0) return "Manhã/Tarde/Noite";
          if (m > 0 && t > 0) return "Manhã/Tarde";
          if (m > 0 && n > 0) return "Manhã/Noite";
          if (t > 0 && n > 0) return "Tarde/Noite";
          if (n > 0) return "Noite";
          if (t > 0) return "Tarde";
          return "Manhã";
        })();

        const turnoAbrev = (() => {
          const parts = [];
          const lower = (turnoLbl || "").toLowerCase();
          if (lower.includes("manhã")) parts.push("M");
          if (lower.includes("tarde")) parts.push("V");
          if (lower.includes("noite")) parts.push("N");
          return parts.length > 0 ? parts.join("/") : "M";
        })();

        function satCellHtml(day: Date, horario: number, turno: string): string {
          const hasEv = pAssinData[String(day.getDate())] !== undefined;
          if (day.getDay() === 6 && hasEv) {
            const ds = toISO(day);
            const satSym = Object.entries(pExtraData).find(([k]) => k.startsWith(`${ds}_`))?.[1] ?? "SL";
            const symColors: Record<string,string> = { "@":"#16a34a","SL":"#2563eb","F":"#64748b","RP":"#16a34a","PE":"#0284c7","PF":"#d97706","EE":"#0891b2","CC":"#7c3aed","&":"#7c3aed","!":"#ea580c","RE":"#f43f5e" };
            const symBg:     Record<string,string> = { "@":"#dcfce7","SL":"#dbeafe","F":"#f1f5f9","RP":"#dcfce7","PE":"#e0f2fe","PF":"#fef3c7","EE":"#cffafe","CC":"#ede9fe","&":"#ede9fe","!":"#fff7ed","RE":"#fff1f2" };
            const clr = symColors[satSym] ?? "#16a34a";
            const bg  = symBg[satSym]    ?? "#dcfce7";
            return `<td style="text-align:center;vertical-align:middle;background:${bg};font-weight:bold;color:${clr}">${satSym}</td>`;
          }
          return `<td style="text-align:center;vertical-align:middle;color:#000000;background:#eeeeee;font-size:8px">***</td>`;
        }
        
        const rows = days.map(day => {
          const we  = IS_WEEKEND(day.getDay());
          const ds  = toISO(day);
          const dk  = JS_DAY_KEY[day.getDay()];
          const fer = isFeriadoNacional(day);
          const wS  = (we || fer) ? `style="background:${fer && !we ? "#fff7ed" : "#eeeeee"}"` : "";
          const mCells = Array.from({length: manhaQtd}, (_, i) => {
            if (we) return satCellHtml(day, i+1, "manha");
            if (fer) return `<td style="text-align:center;vertical-align:middle;background:#fff7ed;font-weight:bold;color:#c2410c;font-size:10px">*</td>`;
            const a = pAlocs.find(x => x.diaSemana === dk && x.horario === i+1 && (turmaMap.get(x.turmaId)?.turno ?? "manha") === "manha");
            if (!a) {
              const extraK = `${ds}_${i+1}_manha`;
              const extraSym = pExtraData[extraK];
              if (extraSym) {
                return `<td style="text-align:center;vertical-align:middle;padding:1px 1px"><div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0;line-height:1"><span style="font-size:9.5pt;font-weight:bold;color:#000000">${extraSym}</span></div></td>`;
              }
              return `<td style="background:white;text-align:center;vertical-align:middle;font-weight:bold;color:#000000;font-size:13px">*</td>`;
            }
            const r = registros.find(x => x.alocacaoId === a.id && x.data === ds);
            const tn = abrevT(turmaMap.get(a.turmaId)?.nome ?? "");
            const mark = !r ? "" : (r.valor ?? (r.presente ? "✓" : "F"));
            const isSym = getSimInfo(mark) !== null;
            if (isSym) {
              return `<td style="text-align:center;vertical-align:middle;padding:1px 1px"><div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0;line-height:1"><span style="font-size:9.5pt;font-weight:bold;color:#000000">${mark}</span></div></td>`;
            }
            const markHtml = mark ? `<span style="font-size:9pt;font-weight:bold;line-height:1;margin-top:0.5px;color:#000000">${mark}</span>` : "";
            return `<td style="text-align:center;vertical-align:middle;padding:1px 1px"><div style="display:flex;flex-direction:column;align-items:center;padding:0;line-height:1.1"><span style="font-size:8.5pt;font-weight:bold;color:#000000;line-height:1.1">${tn}</span>${markHtml}</div></td>`;
          }).join("");
          const tCells = Array.from({length: tardeQtd}, (_, i) => {
            if (we) return satCellHtml(day, i+1, "tarde");
            if (fer) return `<td style="text-align:center;vertical-align:middle;background:#fff7ed;font-weight:bold;color:#c2410c;font-size:10px">*</td>`;
            const a = pAlocs.find(x => x.diaSemana === dk && x.horario === i+1 && turmaMap.get(x.turmaId)?.turno === "tarde");
            if (!a) {
              const extraK = `${ds}_${i+1}_tarde`;
              const extraSym = pExtraData[extraK];
              if (extraSym) {
                return `<td style="text-align:center;vertical-align:middle;padding:1px 1px"><div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0;line-height:1"><span style="font-size:9.5pt;font-weight:bold;color:#000000">${extraSym}</span></div></td>`;
              }
              return `<td style="background:white;text-align:center;vertical-align:middle;font-weight:bold;color:#000000;font-size:13px">*</td>`;
            }
            const r = registros.find(x => x.alocacaoId === a.id && x.data === ds);
            const tn = abrevT(turmaMap.get(a.turmaId)?.nome ?? "");
            const mark = !r ? "" : (r.valor ?? (r.presente ? "✓" : "F"));
            const isSym = getSimInfo(mark) !== null;
            if (isSym) {
              return `<td style="text-align:center;vertical-align:middle;padding:1px 1px"><div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0;line-height:1"><span style="font-size:9.5pt;font-weight:bold;color:#000000">${mark}</span></div></td>`;
            }
            const markHtml = mark ? `<span style="font-size:9pt;font-weight:bold;line-height:1;margin-top:0.5px;color:#000000">${mark}</span>` : "";
            return `<td style="text-align:center;vertical-align:middle;padding:1px 1px"><div style="display:flex;flex-direction:column;align-items:center;padding:0;line-height:1.1"><span style="font-size:8.5pt;font-weight:bold;color:#000000;line-height:1.1">${tn}</span>${markHtml}</div></td>`;
          }).join("");
          const nCells = Array.from({length: pNoiteQtd}, (_, i) => {
            if (we) return satCellHtml(day, i+1, "noite");
            if (fer) return `<td style="text-align:center;vertical-align:middle;background:#fff7ed;font-weight:bold;color:#c2410c;font-size:10px">*</td>`;
            const a = pAlocs.find(x => x.diaSemana === dk && x.horario === i+1 && turmaMap.get(x.turmaId)?.turno === "noite");
            if (!a) {
              const extraK = `${ds}_${i+1}_noite`;
              const extraSym = pExtraData[extraK];
              if (extraSym) {
                return `<td style="text-align:center;vertical-align:middle;padding:1px 1px"><div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0;line-height:1"><span style="font-size:9.5pt;font-weight:bold;color:#000000">${extraSym}</span></div></td>`;
              }
              return `<td style="background:white;text-align:center;vertical-align:middle;font-weight:bold;color:#000000;font-size:13px">*</td>`;
            }
            const r = registros.find(x => x.alocacaoId === a.id && x.data === ds);
            const tn = abrevT(turmaMap.get(a.turmaId)?.nome ?? "");
            const mark = !r ? "" : (r.valor ?? (r.presente ? "✓" : "F"));
            const isSym = getSimInfo(mark) !== null;
            if (isSym) {
              return `<td style="text-align:center;vertical-align:middle;padding:1px 1px"><div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0;line-height:1"><span style="font-size:9.5pt;font-weight:bold;color:#000000">${mark}</span></div></td>`;
            }
            const markHtml = mark ? `<span style="font-size:9pt;font-weight:bold;line-height:1;margin-top:0.5px;color:#000000">${mark}</span>` : "";
            return `<td style="text-align:center;vertical-align:middle;padding:1px 1px"><div style="display:flex;flex-direction:column;align-items:center;padding:0;line-height:1.1"><span style="font-size:8.5pt;font-weight:bold;color:#000000;line-height:1.1">${tn}</span>${markHtml}</div></td>`;
          }).join("");
          const dayName = JS_DAY_NOME[day.getDay()];
          const assinOverride = pAssinData[String(day.getDate())];
          const hName = getFeriadoNacionalNome(day);
          const assinTxt = assinOverride !== undefined ? assinOverride
            : we ? "********" : hName ? `FERIADO - ${hName}` : "&nbsp;";
          const assinStyle = (we || fer) && assinOverride === undefined
            ? "text-align:center;vertical-align:middle;font-weight:bold;" + (fer && !we ? "color:#c2410c;" : "color:#000000;")
            : "text-align:center;vertical-align:middle;padding-left:8px;padding-right:8px;";
          return `<tr class="ponto-data-row" ${wS}>
            <td style="text-align:center;vertical-align:middle;font-weight:bold;color:#000000;${we?"background:#eeeeee":fer?"background:#fff7ed":""}">${day.getDate()}</td>
            <td style="text-align:center;vertical-align:middle;${we?"background:#eeeeee;font-weight:600;color:#000000":fer?"background:#fff7ed;color:#c2410c;font-weight:600":""}">${dayName}</td>
            ${mCells}${tCells}${nCells}
            <td style="${assinStyle}${we?"background:#eeeeee":fer&&!we?"background:#fff7ed":""}">${assinTxt}</td>
          </tr>`;
        }).join("");

        const emptyRowsHTML = Array.from({length: Math.max(0, 31 - days.length)}, (_, i) =>
          `<tr class="ponto-data-row" style="background:white;color:#000000">
            <td style="text-align:center;vertical-align:middle;color:#000000;font-weight:bold">${days.length+i+1}</td>
            <td style="color:#000000;text-align:center;vertical-align:middle;font-weight:bold;font-size:12px">***</td>
            ${Array.from({length: manhaQtd+tardeQtd+pNoiteQtd}, () => `<td style="text-align:center;vertical-align:middle;font-weight:bold;font-size:12px;color:#000000">***</td>`).join("")}
            <td style="text-align:center;vertical-align:middle;font-weight:bold;font-size:12px;color:#000000">********</td>
          </tr>`).join("");

        const turnoColspan = Math.max(1, manhaQtd + tardeQtd + pNoiteQtd - 4);
        const obsColText = (() => { const o = localStorage.getItem(storageKey(`edu_ponto_obs_shared_${year}_${month}`)); return o ?? ""; })();

        const materias  = p.disciplinas.map(id => discMap.get(id)?.nome).filter(Boolean).join(" / ");
        const numAulas  = new Set(pAlocs.map(a => `${a.diaSemana}-${a.horario}`)).size;
        const cargo     = p.cargo || (p.tipoVinculo === "efetivo" ? "PEB" : p.tipoVinculo === "designado" ? "PEB-D" : "PEB");
        const vinculo   = p.tipoVinculo === "efetivo" ? " - Efetiva" : p.tipoVinculo === "designado" ? " - Designada" : "";

        return `<table class="ponto-tabela" style="table-layout:fixed; width:100%; border-collapse:collapse; color:#000000; border:2px solid #000000">
          <colgroup>${pColGroupHTML}</colgroup>
          <tbody>
            <tr class="ponto-header-row titulo"><td colspan="${pTotalCols}" style="text-align:center;font-weight:bold;font-size:11px;padding:3.5px;border:2px solid #000000;text-transform:uppercase;background:#f8fafc;color:#000000">
              PONTO DOS PROFESSORES — ${nomeEscola.toUpperCase()}${codigoEscola ? ` — CÓDIGO: ${codigoEscola}` : ""}
            </td></tr>
            <tr class="ponto-header-sub">
              <td colspan="${pTotalCols-1}" style="text-align:center;font-weight:bold;font-size:10px;border:1px solid #000000;text-transform:uppercase;padding:2.5px;color:#000000">ENSINO FUNDAMENTAL E MÉDIO</td>
              <td style="text-align:center;font-weight:bold;border:1px solid #000000;white-space:nowrap;font-size:9px;padding:2.5px;color:#000000">Nº ${profIdx+1}</td>
            </tr>
            <tr class="ponto-header-blank" style="height:6px"><td colspan="${pTotalCols}" style="border:none;height:6px;background:white"></td></tr>
            <tr class="ponto-info-row">
              <td colspan="${cMes}" style="padding:2.5px 5px;border:1px solid #000000;color:#000000;font-size:9.5px"><b>MÊS:</b> ${MESES[month-1]}</td>
              <td colspan="${cAno}" style="padding:2.5px 5px;border:1px solid #000000;color:#000000;font-size:9.5px"><b>ANO:</b> ${year}</td>
              <td colspan="${cTurno}" style="padding:2.5px 5px;border:1px solid #000000;color:#000000;font-size:9.5px"><b>TURNO:</b> ${turnoLbl}</td>
              <td colspan="${cAdm}" style="white-space:nowrap;padding:2.5px 5px;border:1px solid #000000;color:#000000;font-size:9.5px"><b>Admissão:</b> ${fmtDate(p.dataAdmissao)}</td>
            </tr>
            <tr class="ponto-info-row">
              <td colspan="${cNome}" style="padding:2.5px 5px;border:1px solid #000000;color:#000000;font-size:9.5px"><b>NOME:</b> ${p.nomeCompleto.toUpperCase()}</td>
              <td colspan="${cMasp}" style="padding:2.5px 5px;border:1px solid #000000;color:#000000;font-size:9.5px"><b>MASP</b> ${p.masp ?? "—"}</td>
            </tr>
            <tr class="ponto-info-row">
              <td colspan="${cMateria}" style="padding:2.5px 5px;border:1px solid #000000;color:#000000;font-size:9.5px"><b>MATÉRIA:</b> ${materias}${vinculo} &nbsp;&nbsp;&nbsp;<b>Nº de aulas:</b> ${numAulas}</td>
              <td colspan="${cCargo}" style="padding:2.5px 5px;border:1px solid #000000;color:#000000;font-size:9.5px"><b>Cargo:</b> ${cargo}</td>
            </tr>
            <tr class="ponto-colunas-row">
              <td rowspan="2" ${TH}><span style="writing-mode:vertical-rl;transform:rotate(180deg);display:inline-block">Dias</span></td>
              <td rowspan="2" ${TH}><span style="writing-mode:vertical-rl;transform:rotate(180deg);display:inline-block">Semana</span></td>
              ${mH1}${tH1}${nH1}
              <td rowspan="2" ${TH}>Assinatura</td>
            </tr>
            <tr class="ponto-colunas-sub-row">${mH2}${tH2}${nH2}</tr>
            ${rows}${emptyRowsHTML}
            <tr class="ponto-legenda-row"><td colspan="${pTotalCols}" style="border:1px solid #000000;padding:4px 8px;background:white;text-align:left;white-space:normal">
              <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-start;gap:6px 12px;font-size:8.5px;line-height:1.2;letter-spacing:0.01em;white-space:normal;word-break:break-word">
                <span style="font-weight:bold;text-transform:uppercase;letter-spacing:0.03em;color:#000000;margin-right:2px">Legenda:</span>
                ${Object.entries(SIMBOLO_MAPA).map(([sym,info]) =>
                  `<span style="color:#000000;white-space:nowrap;display:inline-block"><b style="color:${info.cor};font-size:8.5px">${sym}</b> = ${info.descricao}</span>`
                ).join("")}
                <span style="color:#000000;white-space:nowrap;display:inline-block"><b style="color:#ea580c;font-size:8.5px">*</b> = Feriado Nacional</span>
              </div>
            </td></tr>
            <tr class="ponto-observacoes-row"><td colspan="${pTotalCols}" style="border:1px solid #000000;padding:2px 4px;background:white;text-align:left">
              <b style="font-size:8.5px;color:#000000">Observações:</b><br>
              ${obsColText ? `<span style="font-size:8.5px;white-space:pre-wrap;line-height:1.2;color:#000000;display:block;margin-bottom:4px">${obsColText}</span>` : ""}
              <div class="print-only-obs-lines" style="display:flex;flex-direction:column;width:100%;gap:10px;padding-top:4px;padding-bottom:2px">
                <div style="border-bottom:1px solid #000000;width:100%;height:1px"></div>
                <div style="border-bottom:1px solid #000000;width:100%;height:1px"></div>
                <div style="border-bottom:1px solid #000000;width:100%;height:1px"></div>
                <div style="border-bottom:1px solid #000000;width:100%;height:1px"></div>
              </div>
            </td></tr>
            <tr class="ponto-assinatura-diretor-row"><td colspan="${pTotalCols}" style="border:1px solid #000000;padding:3px 8px;font-weight:600;font-size:10px;color:#000000;background:#f8fafc;height:10mm;vertical-align:middle;text-align:left">
              Assinatura do Diretor:&nbsp;&nbsp;___________________________________________
            </td></tr>
            <tr class="ponto-resumo-header-row"><td colspan="${pTotalCols}" style="text-align:center;background:#f8fafc;font-weight:bold;font-size:10px;border:1px solid #000000;text-transform:uppercase;padding:3px 8px;color:#000000">RESUMO MENSAL</td></tr>
            ${(() => {
              const rk = `edu_ponto_resumo_${p.id}_${year}_${month}`;
              let r: Record<string,string> = {};
              try { r = JSON.parse(localStorage.getItem(rk) ?? "{}") ?? {}; } catch { r = {}; }
              const vPresenca = r.presenca ?? "";
              const vFaltas   = r.faltas   ?? "";
              const vLicenca  = r.licenca  ?? "";
              const vFreq     = r.freq     ?? "";
              return `
            <tr class="ponto-resumo-item-row" style="height:17.5pt">
              <td colspan="${pHalf}" style="height:17.5pt;padding:2px 8px;font-size:9.5px;color:#000000;text-align:left;vertical-align:middle"><b>PRESENÇA:</b> ${vPresenca}</td>
              <td colspan="${pHalf2}" style="height:17.5pt;padding:2px 8px;font-size:9.5px;color:#000000;text-align:left;vertical-align:middle"><b>FALTAS:</b> ${vFaltas}</td>
            </tr>
            <tr class="ponto-resumo-item-row" style="height:17.5pt">
              <td colspan="${pTotalCols}" style="height:17.5pt;padding:2px 8px;font-size:9.5px;color:#000000;text-align:left;vertical-align:middle"><b>LICENÇA:</b> ${vLicenca.replace(/\n/g,'<br>')}</td>
            </tr>
            <tr class="ponto-resumo-item-row" style="height:17.5pt">
              <td colspan="${pTotalCols}" style="height:17.5pt;padding:2px 8px;font-size:9.5px;color:#000000;text-align:left;vertical-align:middle"><b>FREQUÊNCIA:</b> ${vFreq}</td>
            </tr>
            `;
            })()}
          </tbody>
        </table>`;
      });

      const win = window.open("", "_blank", "width=1000,height=800");
      if (!win) {
        toast({
          title: "Bloqueador de pop-ups ativo",
          description: "Por favor, ative a permissão de pop-ups neste navegador para abrir a página de impressão.",
          variant: "destructive"
        });
        return;
      }

      win.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Livro de Ponto — ${MESES[month-1]} ${year}</title>
  <style>
    @media print {
      body {
        background-color: #ffffff !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
    }
    @page { 
      size: A4 portrait; 
      margin-top: ${printMarginTop}mm; 
      margin-left: ${printMarginLeft}mm; 
      margin-bottom: ${printMarginBottom}mm; 
      margin-right: ${printMarginRight}mm; 
    }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { background: white !important; background-color: white !important; margin: 0; padding: 0; width: 100%; }
    body { font-family: Arial, sans-serif; margin: 0; color: black; font-size: 8.5pt; }
    table { border-collapse: collapse; width: 100%; }
    td { border: 1px solid #000; padding: 1.5px 3px; vertical-align: middle; }
    .prof {
      page-break-after: always;
      break-after: page;
      page-break-inside: avoid;
      break-inside: avoid;
      width: 100%;
      height: 277mm;
      box-sizing: border-box;
      padding: 0;
      overflow: visible;
      zoom: ${printScale}%;
    }
    .prof:last-child { page-break-after: auto; break-after: auto; }
    .prof table { width: 100% !important; table-layout: fixed !important; border-collapse: collapse !important; }
    .prof tr.ponto-data-row { height: 15.5pt !important; }
    .prof tr.ponto-data-row td { height: 15.5pt !important; padding: 0.5px 1.5px !important; }
    .prof tr.ponto-observacoes-row { height: 13mm !important; }
    .prof tr.ponto-observacoes-row td { height: 13mm !important; }
    .prof tr.ponto-data-row td:nth-child(1) { padding-left: 0 !important; padding-right: 0 !important; }
    .prof tr.ponto-data-row td:nth-child(2) { padding-left: 1px !important; padding-right: 1px !important; }
    
    /* ── EXCLUSIVE PRINT FONT ADJUSTMENTS ── */
    .prof,
    .prof table,
    .prof td,
    .prof th,
    .prof span,
    .prof div,
    .prof b,
    .prof input,
    .prof textarea {
      font-size: 8.5pt !important;
    }
    
    /* Exception 1: Column "dias" */
    .ponto-colunas-row td:first-child,
    .ponto-colunas-row td:first-child span,
    .ponto-data-row td:first-child,
    .ponto-data-row td:first-child span,
    .ponto-data-row td:first-child b,
    .ponto-data-row td:first-child div {
      font-size: 7.5pt !important;
    }
    
    /* Exception 2: Title and Resumo header which must be 12 */
    .ponto-header-row td,
    .ponto-header-sub td,
    .ponto-resumo-header-row td {
      font-size: 11pt !important;
    }

    /* Padding & formatting */
    .ponto-header-row td { font-weight: bold !important; padding: 3px !important; }
    .ponto-header-sub td { font-weight: bold !important; padding: 2px !important; }
    .ponto-info-row td { padding: 2px 4px !important; }
    .ponto-colunas-row td, .ponto-colunas-sub-row td { font-weight: bold !important; }
    .ponto-resumo-header-row td { font-weight: bold !important; padding: 3px !important; }
    .ponto-resumo-item-row { height: 15.5pt !important; }
    .ponto-resumo-item-row td { height: 15.5pt !important; padding: 2px 4px !important; }
    
    /* Comfortable height for signature fields */
    .ponto-assinatura-diretor-row td {
      font-size: 8.5pt !important;
      font-weight: 600 !important;
      height: 7mm !important;
      padding: 2px 4px !important;
      vertical-align: middle !important;
    }
  </style>
</head>
<body>
  ${profDocs.map(html => `<div class="prof">${html}</div>`).join("")}
  <script>
    window.onload = function() {
      // Tempo estratégico para assegurar renderização de fontes e escala antes da chamada
      setTimeout(function() { 
        window.print(); 
      }, 350);
    };
  <\/script>
</body>
</html>`);
      win.document.close();
      toast({ title: "Caixa de impressão aberta", description: "O diálogo de impressão do navegador foi carregado com sucesso." });
    } catch (err) {
      console.error("Erro ao imprimir:", err);
      toast({ title: "Erro na impressão", description: "Ocorreu um erro ao estruturar o arquivo de impressão.", variant: "destructive" });
    } finally {
      setIsGeneratingPdf(false);
    }
  }

  function handlePrintAll() {
    handlePrintProfs(professores);
  }

  function handlePrintSingle() {
    const p = professores.find(x => x.id === profId);
    if (p) {
      handlePrintProfs([p]);
    }
  }

  function renderSlotCell(day: Date, horario: number, turno: "manha" | "tarde" | "noite", key: string) {
    const weekend = IS_WEEKEND(day.getDay());
    if (weekend) {
      const hasEvent = assinMap[String(day.getDate())] !== undefined;
      if (day.getDay() === 6 && hasEvent) {
        const dateStr = toISO(day);
        const satSym = (Object.entries(extraSimbolos)
          .find(([k]) => k.startsWith(`${dateStr}_`))?.[1] as string) ?? null;
        const satInfo = satSym ? SIMBOLO_MAPA[satSym] : null;
        return (
          <td key={key} className={`${cellBase} text-center select-none vertical-middle ${satInfo?.bgCls ?? "bg-green-100"} print:bg-white`}>
            <span className={`text-[13px] font-bold select-none ${satInfo?.textCls ?? "text-green-700"} print:text-black`}>
              {satSym ?? "SL"}
            </span>
          </td>
        );
      }
      return (
        <td key={key} className={`${cellBase} text-center text-black print:text-black text-[12px] bg-gray-200 print:bg-gray-200 vertical-middle select-none`}>***</td>
      );
    }
    if (isFeriadoNacional(day)) return (
      <td key={key} className={`${cellBase} text-center bg-orange-50 print:bg-white vertical-middle select-none`}>
        <span className="text-[13px] font-bold text-orange-400 print:text-gray-500 select-none">*</span>
      </td>
    );
    const aloc    = lookupAloc(day, horario, turno);
    const dateStr = toISO(day);
    const reg     = lookupReg(aloc?.id ?? null, dateStr);
    if (!aloc) {
      const extraK   = `${dateStr}_${horario}_${turno}`;
      const extraSym = extraSimbolos[extraK];
      if (!extraSym) return (
        <td key={key} className={`${cellBase} bg-white text-center text-black font-bold text-[13px] vertical-middle select-none`}>
          *
        </td>
      );
      const eInfo = SIMBOLO_MAPA[extraSym];
      return (
        <td
          key={key}
          className={`${cellBase} text-center cursor-pointer vertical-middle ${eInfo?.bgCls ?? "bg-purple-100"} print:bg-white`}
          title="Clique para remover"
          onClick={() => removeExtra(extraK)}
        >
          <span className={`text-[13px] font-bold select-none ${eInfo?.textCls ?? "text-purple-700"} print:text-black`}>
            {extraSym}
          </span>
        </td>
      );
    }
    const currentVal = reg?.valor ?? (reg?.presente === true ? "✓" : reg?.presente === false ? "F" : "");
    const simInfo    = getSimInfo(currentVal);
    const isFalta    = !simInfo && currentVal !== "" && FALTA_TOKENS.has(currentVal.trim().toLowerCase());
    const turmaNome  = turmaMap.get(aloc.turmaId)?.nome ?? "";
    const turmaAbr   = abrevTurma(turmaNome);
    const tdBg = simInfo    ? `${simInfo.bgCls} print:bg-white`
               : isFalta    ? "bg-red-50 print:bg-white"
               : currentVal ? "bg-green-50 print:bg-white"
                            : "bg-white hover:bg-blue-50/30";
    const inputTxt = simInfo    ? `${simInfo.textCls} print:text-black`
                   : isFalta    ? "text-red-700 print:text-black"
                   : currentVal ? "text-green-800 print:text-black"
                                : "text-gray-300";
    return (
      <td key={key} className={`${cellBase} text-center p-0 transition-colors vertical-middle ${tdBg}`}>
        <div className="flex flex-col items-center justify-center leading-none py-1 gap-0.5">
          {!simInfo && (
            <span className="text-[12px] font-bold text-black print:text-black leading-none select-none">{turmaAbr}</span>
          )}
          <input
            type="text"
            value={currentVal}
            onChange={e => updateReg(aloc, dateStr, e.target.value)}
            className={`w-full text-center text-[12px] font-bold leading-none bg-transparent border-none outline-none min-w-0 ${inputTxt}`}
            placeholder="·"
            title={`${turmaNome}`}
          />
        </div>
      </td>
    );
  }

  return (
    <div className="flex gap-4 pb-8 items-start">

      {/* ══ Sidebar de Preenchimento Rápido (fixa) ═══════════════════════════ */}
      <aside className="no-print sticky top-4 w-72 shrink-0 rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-3 max-h-[calc(100vh-5rem)] overflow-y-auto">

        {/* ── Seção 1: Observações partilhadas ─────────────────────────── */}
        <div>
          <p className="text-xs font-semibold text-primary flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5" />
            Observações
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Partilhado · todos os professores · mês atual
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {QUICK_PRESETS.map(preset => {
            const sym  = PRESET_SIMBOLO[preset];
            const info = sym ? SIMBOLO_MAPA[sym] : null;
            const active = quickText === preset;
            return (
              <button
                key={preset}
                type="button"
                onClick={() => { setQuickText(preset); quickInputRef.current?.focus(); }}
                className={`text-xs px-2 py-0.5 rounded-full border transition-colors flex items-center gap-1
                  ${active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-muted text-foreground"}`}
              >
                {sym && (
                  <span
                    style={active ? {} : { color: info?.cor }}
                    className="font-bold text-[10px]"
                  >
                    {sym}
                  </span>
                )}
                {preset}
              </button>
            );
          })}
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Texto personalizado</label>
          <Input
            ref={quickInputRef}
            value={quickText}
            onChange={e => setQuickText(e.target.value)}
            placeholder="Ex: Reunião, Evento cultural…"
            className="h-8 text-xs w-full"
            onKeyDown={e => { if (e.key === "Enter") applyQuickFill(); }}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Dia</label>
          <div className="flex flex-wrap gap-1">
            {([{label:"Seg",dow:1},{label:"Ter",dow:2},{label:"Qua",dow:3},{label:"Qui",dow:4},{label:"Sex",dow:5},{label:"Sáb",dow:6}] as const).map(({label,dow}) => (
              <button
                key={dow}
                type="button"
                onClick={() => toggleQuickDow(dow)}
                className={`text-[10px] px-2 py-0.5 rounded-full border font-medium transition-colors
                  ${quickDow.includes(dow)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-muted text-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <Select
            value={quickDow.length > 0 ? "" : quickDay}
            onValueChange={v => { setQuickDow([]); setQuickDay(v); }}
          >
            <SelectTrigger className="h-7 text-xs w-full mt-1"><SelectValue placeholder="Data específica…" /></SelectTrigger>
            <SelectContent className="max-h-60 overflow-y-auto">
              {days.filter(d => d.getDay() !== 0).map(d => (
                <SelectItem key={d.getDate()} value={String(d.getDate())}>
                  Dia {d.getDate()} — {JS_DAY_NOME[d.getDay()]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Horários</label>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => toggleQuickSlot("todos")}
              className={`text-[10px] px-2 py-0.5 rounded-full border font-medium transition-colors
                ${quickSlots.includes("todos")
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-muted text-foreground"}`}
            >
              Todos
            </button>
            {manhaQtd > 0 && Array.from({ length: manhaQtd }, (_, i) => {
              const val = `m${i + 1}`;
              const active = quickSlots.includes(val);
              return (
                <button key={val} type="button" onClick={() => toggleQuickSlot(val)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border font-medium transition-colors
                    ${active ? "bg-blue-600 text-white border-blue-600" : "bg-background border-border hover:bg-muted text-foreground"}`}
                  title={`${i + 1}ª aula — Matutino`}
                >
                  {i + 1}ªM
                </button>
              );
            })}
            {tardeQtd > 0 && Array.from({ length: tardeQtd }, (_, i) => {
              const val = `t${i + 1}`;
              const active = quickSlots.includes(val);
              return (
                <button key={val} type="button" onClick={() => toggleQuickSlot(val)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border font-medium transition-colors
                    ${active ? "bg-orange-500 text-white border-orange-500" : "bg-background border-border hover:bg-muted text-foreground"}`}
                  title={`${i + 1}ª aula — Vespertino`}
                >
                  {i + 1}ªV
                </button>
              );
            })}
            {displayNoiteQtd > 0 && Array.from({ length: displayNoiteQtd }, (_, i) => {
              const val = `n${i + 1}`;
              const active = quickSlots.includes(val);
              return (
                <button key={val} type="button" onClick={() => toggleQuickSlot(val)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border font-medium transition-colors
                    ${active ? "bg-purple-600 text-white border-purple-600" : "bg-background border-border hover:bg-muted text-foreground"}`}
                  title={`${i + 1}ª aula — Noturno`}
                >
                  {i + 1}ªN
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Meses</label>
          <div className="flex flex-wrap gap-1">
            {MESES_ABREV.map((label, i) => {
              const m = i + 1;
              const active = quickMonths.includes(m);
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => toggleQuickMonth(m)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border font-medium transition-colors
                    ${active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border hover:bg-muted text-foreground"}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex gap-2">
          <Button size="sm" className="h-8 gap-1.5 flex-1" onClick={applyQuickFill} disabled={!quickText.trim()}>
            {quickApplied ? <><Check className="w-3.5 h-3.5" />Aplicado!</> : <><Zap className="w-3.5 h-3.5" />Aplicar</>}
          </Button>
          <Button size="sm" variant="outline" className="h-8 gap-1" title="Desfazer alteração nas Observações" aria-label="Desfazer observações" onClick={undoObs} disabled={!canUndo}>
            <Undo2 className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" variant="outline" className="h-8 gap-1 text-destructive border-destructive/40 hover:bg-destructive/10" title="Limpar campo" onClick={() => { handleObsChange(""); toast({ title: "Campo limpo" }); }} disabled={!obs}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>

        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Adiciona texto ao campo <em>Observações</em>. Use <strong>↩</strong> para desfazer ou <strong>🗑</strong> para limpar.
        </p>

        {/* ── Seção 2: Símbolos Especiais ───────────────────────────────── */}
        <div className="border-t-2 border-purple-200 pt-3 space-y-2">
          <div>
            <p className="text-xs font-semibold text-purple-700 flex items-center gap-1.5">
              <span className="font-bold">§</span>
              Símbolos Especiais nos Horários
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Individual · professor selecionado · meses escolhidos abaixo
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Símbolo</label>
            <Select value={specSymbol} onValueChange={setSpecSymbol}>
              <SelectTrigger className="h-8 text-xs w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SIMBOLOS_ESPECIAIS_KEYS.map(sym => {
                  const info = SIMBOLO_MAPA[sym];
                  return (
                    <SelectItem key={sym} value={sym}>
                      <span style={{ color: info.cor }} className="font-bold mr-1">{sym}</span>
                      <span className="text-xs text-muted-foreground">= {info.descricao}</span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Dia</label>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => { setSpecDow([]); setSpecDay("todos"); }}
                className={`text-[10px] px-2 py-0.5 rounded-full border font-medium transition-colors
                  ${specDow.length === 0
                    ? "bg-purple-600 text-white border-purple-600"
                    : "bg-background border-border hover:bg-muted text-foreground"}`}
              >
                Todos
              </button>
              {([{label:"Seg",dow:1},{label:"Ter",dow:2},{label:"Qua",dow:3},{label:"Qui",dow:4},{label:"Sex",dow:5},{label:"Sáb",dow:6}] as const).map(({label,dow}) => (
                <button
                  key={dow}
                  type="button"
                  onClick={() => toggleSpecDow(dow)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border font-medium transition-colors
                    ${specDow.includes(dow)
                      ? "bg-purple-600 text-white border-purple-600"
                      : "bg-background border-border hover:bg-muted text-foreground"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Horários</label>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => toggleSpecSlot("todos")}
                className={`text-[10px] px-2 py-0.5 rounded-full border font-medium transition-colors
                  ${specSlots.includes("todos")
                    ? "bg-purple-600 text-white border-purple-600"
                    : "bg-background border-border hover:bg-muted text-foreground"}`}
              >
                Todos
              </button>
              {manhaQtd > 0 && Array.from({ length: manhaQtd }, (_, i) => {
                const val = `m${i+1}`;
                const active = specSlots.includes(val);
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => toggleSpecSlot(val)}
                    className={`text-[10px] px-2 py-0.5 rounded-full border font-medium transition-colors
                      ${active
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-background border-border hover:bg-muted text-foreground"}`}
                    title={`${i+1}ª aula — Matutino`}
                  >
                    {i+1}ªM
                  </button>
                );
              })}
              {tardeQtd > 0 && Array.from({ length: tardeQtd }, (_, i) => {
                const val = `t${i+1}`;
                const active = specSlots.includes(val);
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => toggleSpecSlot(val)}
                    className={`text-[10px] px-2 py-0.5 rounded-full border font-medium transition-colors
                      ${active
                        ? "bg-orange-500 text-white border-orange-500"
                        : "bg-background border-border hover:bg-muted text-foreground"}`}
                    title={`${i+1}ª aula — Vespertino`}
                  >
                    {i+1}ªV
                  </button>
                );
              })}
              {displayNoiteQtd > 0 && Array.from({ length: displayNoiteQtd }, (_, i) => {
                const val = `n${i+1}`;
                const active = specSlots.includes(val);
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => toggleSpecSlot(val)}
                    className={`text-[10px] px-2 py-0.5 rounded-full border font-medium transition-colors
                      ${active
                        ? "bg-purple-600 text-white border-purple-600"
                        : "bg-background border-border hover:bg-muted text-foreground"}`}
                    title={`${i+1}ª aula — Noturno`}
                  >
                    {i+1}ªN
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Meses</label>
            <div className="flex flex-wrap gap-1">
              {MESES_ABREV.map((label, i) => {
                const m = i + 1;
                const active = specMonths.includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => toggleSpecMonth(m)}
                    className={`text-[10px] px-2 py-0.5 rounded-full border font-medium transition-colors
                      ${active
                        ? "bg-purple-600 text-white border-purple-600"
                        : "bg-background border-border hover:bg-muted text-foreground"}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-8 flex-1 gap-1.5 bg-purple-600 hover:bg-purple-700 text-white"
              onClick={applySpecialSymbol}
            >
              {specApplied
                ? <><Check className="w-3.5 h-3.5" />Aplicado!</>
                : <><Zap className="w-3.5 h-3.5" />Aplicar</>}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1 text-destructive border-destructive/40 hover:bg-destructive/10"
              onClick={clearSpecialSymbols}
              title="Limpar símbolos das células selecionadas"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Preenche as células selecionadas. O botão <span className="text-destructive">✕</span> remove os símbolos do dia/horário escolhido.
          </p>
        </div>
      </aside>

      {/* ══ Conteúdo principal ═══════════════════════════════════════════════ */}
      <div className="flex-1 min-w-0 space-y-4">

      {/* ── Controles (ecrã apenas) ─────────────────────────────────────────── */}
      <div className="no-print flex items-center gap-2 flex-wrap pb-3 border-b border-border">
        <ClipboardList className="w-5 h-5 text-primary shrink-0" />
        <h1 className="text-lg font-bold">Livro de Ponto</h1>
        <div className="flex gap-2 ml-auto flex-wrap items-center">
          <Select value={profId} onValueChange={v => { setProfId(v); setDiscId("__todas__"); }}>
            <SelectTrigger className="w-52 h-8 text-xs"><SelectValue placeholder="Professor" /></SelectTrigger>
            <SelectContent>
              {professores.map(p => <SelectItem key={p.id} value={p.id}>{p.nomeCompleto}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={discId} onValueChange={setDiscId}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Disciplina" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__todas__">Todas as disciplinas</SelectItem>
              {prof?.disciplinas.map(id => discMap.get(id)).filter(Boolean).map(d => (
                <SelectItem key={d!.id} value={d!.id}>{d!.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(month)} onValueChange={v => setMonth(Number(v))}>
            <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MESES.map((m, i) => <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
            <SelectTrigger className="w-20 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[2024, 2025, 2026, 2027, 2028].map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10" onClick={clearAllRegistros} title="Limpar todos os registros do mês">
            <Eraser className="w-3.5 h-3.5" />Limpar
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={undoAction} disabled={!canUndo} title="Desfazer última alteração na grelha" aria-label="Desfazer grelha">
            <Undo2 className="w-3.5 h-3.5" />Desfazer
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={_redoAction} disabled={!canRedo} title="Refazer última alteração na grelha" aria-label="Refazer grelha">
            <Redo2 className="w-3.5 h-3.5" />Refazer
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={handlePrintSingle}>
            <Printer className="w-3.5 h-3.5" />Imprimir
          </Button>
          <Button size="sm" className="h-8 gap-1.5" onClick={handlePrintAll}>
            <Printer className="w-3.5 h-3.5" />Imprimir Todos
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1 print:hidden">
          <span className="font-semibold">Dica:</span> no diálogo de impressão do browser, desmarque <span className="italic">"Cabeçalhos e rodapés"</span> para remover a data/hora e o URL automáticos do browser.
        </p>
      </div>

      {/* ── Instruções de Configuração para Impressão no Chrome ──────────────── */}
      <div className="no-print bg-amber-50/70 border border-amber-200 rounded-lg p-4 space-y-3 shadow-xs">
        <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
          <Printer className="w-4 h-4 text-amber-700" />
          <span>Como Configurar a Impressão no seu Navegador (Layout Perfeito)</span>
        </div>
        
        <p className="text-xs text-amber-800 leading-relaxed">
          Para garantir que as Folhas de Ponto sejam impressas sem cortes, perfeitamente centralizadas e com o tamanho ideal no papel A4, configure as opções abaixo no diálogo de impressão. <strong>Ajuste os valores de acordo com o comportamento específico do seu navegador ou modelo de impressora:</strong>
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
          {/* Margens */}
          <div className="bg-white/80 p-2.5 rounded border border-amber-100 space-y-1">
            <span className="text-[11px] font-bold text-amber-900 block font-mono">1. MARGENS</span>
            <span className="text-[11px] text-amber-800 block">
              Mude de "Padrão" para <strong>Personalizadas</strong> ou ajuste de acordo com seu navegador:
            </span>
            <ul className="text-[10px] text-amber-700 pl-4 list-disc space-y-0.5">
              <li>Laterais (Esq/Dir): <strong>12,5 mm</strong> (ou padrão do navegador)</li>
              <li>Verticais (Sup/Inf): <strong>10 mm</strong></li>
            </ul>
          </div>

          {/* Escala */}
          <div className="bg-white/80 p-2.5 rounded border border-amber-100 space-y-1">
            <span className="text-[11px] font-bold text-amber-900 block font-mono">2. ESCALA</span>
            <span className="text-[11px] text-amber-800 block">
              Mude de "Padrão" para <strong>Personalizada</strong> e insira o valor:
            </span>
            <div className="text-[13px] font-bold text-amber-800 mt-0.5 pl-1">
              80%
            </div>
            <p className="text-[9px] text-amber-600 leading-tight">
              Ajuste para mais ou para menos conforme necessário no seu navegador para centralização perfeita.
            </p>
          </div>

          {/* Opções de Elementos */}
          <div className="bg-white/80 p-2.5 rounded border border-amber-100 space-y-1">
            <span className="text-[11px] font-bold text-amber-900 block font-mono">3. OUTRAS OPÇÕES</span>
            <ul className="text-[10px] text-amber-700 pl-4 list-disc space-y-0.5 pt-0.5">
              <li><strong className="text-red-700">Desmarque:</strong> "Cabeçalhos e rodapés" (evita textos automáticos do navegador)</li>
              <li><strong className="text-emerald-700">Marque:</strong> "Gráficos de segundo plano" (ativa as cores de preenchimento)</li>
            </ul>
          </div>

          {/* Destino */}
          <div className="bg-white/80 p-2.5 rounded border border-amber-100 space-y-1">
            <span className="text-[11px] font-bold text-amber-900 block font-mono">4. FORMATO & DESTINO</span>
            <span className="text-[11px] text-amber-800 block">
              Imprima diretamente na impressora ou escolha <strong>Salvar como PDF</strong>.
            </span>
            <p className="text-[9px] text-amber-600 leading-normal mt-1">
              O layout é preparado para o tamanho <strong>A4 Retrato (A4 portrait)</strong>.
            </p>
          </div>
        </div>
      </div>

      {/* ── Documento oficial (proporções A4) ────────────────────────────────── */}
      <div className="overflow-x-auto">
        {(() => {
          const totalSlots = manhaQtd + tardeQtd + noiteQtd;
            // Dias 2.71% + Semana 7.57% + Assinatura 22.86% + Aulas 3.57%
          const daysPct = 2.71;
          const semPct = 7.57;
          const assPct = 22.86;
          const slotPct = 3.57;
          const tableFontSize = totalSlots >= 9 ? "13px" : totalSlots >= 7 ? "14px" : "15px";
          return (
        <div className="a4-sheet mx-auto bg-white shadow-md print:shadow-none" style={{ width: "210mm", minHeight: "297mm", padding: "1.9cm 1.2cm 1.9cm 1.7cm", boxSizing: "border-box" }}>
        <table className="border-collapse w-full" style={{ tableLayout: "fixed", fontSize: tableFontSize }}>
          <colgroup>{[
            <col key="dias" style={{ width: `${daysPct}%` }} />,
            <col key="sem"  style={{ width: `${semPct}%` }} />,
            ...Array.from({ length: manhaQtd }, (_, i) => <col key={`m${i}`} style={{ width: `${slotPct}%` }} />),
            ...Array.from({ length: tardeQtd }, (_, i) => <col key={`t${i}`} style={{ width: `${slotPct}%` }} />),
            ...Array.from({ length: noiteQtd }, (_, i) => <col key={`n${i}`} style={{ width: `${slotPct}%` }} />),
            <col key="ass" style={{ width: `${assPct}%` }} />,
          ]}</colgroup>

          <tbody>
            {/* ── TÍTULO ─────────────────────────────────────────────────── */}
            <tr className="ponto-header-row titulo">
              <td colSpan={totalCols} className="border-2 border-black text-center font-bold text-[13px] py-1.5 uppercase tracking-wide bg-slate-50/50 text-black vertical-middle" style={{ padding: "6px 4px" }}>
                PONTO DOS PROFESSORES — {nomeEscola.toUpperCase()}{codigoEscola ? ` — CÓDIGO: ${codigoEscola}` : ""}
              </td>
            </tr>
            <tr className="ponto-header-sub">
              <td colSpan={totalCols - 1} className="border border-black text-center font-bold text-[12px] py-1 uppercase bg-white text-black vertical-middle" style={{ padding: "4px" }}>
                ENSINO FUNDAMENTAL E MÉDIO
              </td>
              <td className="border border-black text-center font-bold py-1 bg-white whitespace-nowrap text-[11px] text-black vertical-middle" style={{ padding: "4px" }}>
                {(() => {
                  const idx = professores.findIndex(p => p.id === profId);
                  const n   = idx >= 0 ? idx + 1 : 1;
                  return `Nº ${n}`;
                })()}
              </td>
            </tr>

            {/* ── LINHA EM BRANCO ────────────────────────────────────────── */}
            <tr className="ponto-header-blank" style={{ height: "6px" }}>
              <td colSpan={totalCols} style={{ border: "none", height: "6px", backgroundColor: "white" }}></td>
            </tr>

            {/* ── MÊS | ANO | TURNO | ADMISSÃO ───────────────────────────── */}
            <tr className="ponto-info-row">
              <td colSpan={cMes} className={`${cellBase} px-2 py-1 bg-white text-left vertical-middle`} style={{ padding: "5px 8px" }}>
                <span className="font-bold font-sans">MÊS:</span> {MESES[month - 1]}
              </td>
              <td colSpan={cAno} className={`${cellBase} px-2 py-1 bg-white text-left vertical-middle`} style={{ padding: "5px 8px" }}>
                <span className="font-bold font-sans">ANO:</span> {year}
              </td>
              <td colSpan={cTurno} className={`${cellBase} px-2 py-1 bg-white text-left vertical-middle`} style={{ padding: "5px 8px" }}>
                <span className="font-bold font-sans">TURNO:</span> {turnoLabel}
              </td>
              <td colSpan={cAdm} className={`${cellBase} px-2 py-1 bg-white whitespace-nowrap text-left vertical-middle`} style={{ padding: "5px 8px" }}>
                <span className="font-bold font-sans">Admissão:</span> {formatDateBR(prof?.dataAdmissao)}
              </td>
            </tr>

            {/* ── NOME | MASP ─────────────────────────────────────────────── */}
            <tr className="ponto-info-row">
              <td colSpan={cNome} className={`${cellBase} px-2 py-1 bg-white text-left vertical-middle`} style={{ padding: "5px 8px" }}>
                <span className="font-bold font-sans">NOME:</span> {prof?.nomeCompleto?.toUpperCase() ?? "—"}
              </td>
              <td colSpan={cMasp} className={`${cellBase} px-2 py-1 bg-white text-left vertical-middle`} style={{ padding: "5px 8px" }}>
                <span className="font-bold font-sans">MASP</span> {prof?.masp ?? "—"}
              </td>
            </tr>

            {/* ── MATÉRIA | Nº AULAS | CARGO ─────────────────────────────── */}
            <tr className="ponto-info-row">
              <td colSpan={cMateria} className={`${cellBase} px-2 py-1 bg-white text-left vertical-middle`} style={{ padding: "5px 8px" }}>
                <span className="font-bold font-sans">MATÉRIA:</span> {materiaLabel}{vinculoLabel ? ` – ${vinculoLabel}` : ""}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span className="font-bold font-sans">Nº de aulas:</span> {numAulasSemana}
              </td>
              <td colSpan={cCargo} className={`${cellBase} px-2 py-1 bg-white text-left vertical-middle`} style={{ padding: "5px 8px" }}>
                <span className="font-bold font-sans">Cargo:</span> {prof?.cargo || (prof?.tipoVinculo === "efetivo" ? "PEB" : prof?.tipoVinculo === "designado" ? "PEB-D" : "PEB")}
              </td>
            </tr>

            {/* ── CABEÇALHO DA TABELA (2 linhas) ──────────────────────────── */}
            <tr className="ponto-colunas-row">
              <td rowSpan={2} className={`${thBase} text-[14px] vertical-middle`} style={{ padding: "6px 4px" }}><span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", display: "inline-block" }}>Dias</span></td>
              <td rowSpan={2} className={`${thBase} text-[14px] vertical-middle`} style={{ padding: "6px 4px" }}><span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", display: "inline-block" }}>Semana</span></td>
              {manhaQtd > 0 && <td colSpan={manhaQtd} className={`${thBase} py-1 vertical-middle`} style={{ padding: "4px" }}>Matutino</td>}
              {tardeQtd > 0 && <td colSpan={tardeQtd} className={`${thBase} py-1 vertical-middle`} style={{ padding: "4px" }}>Vespertino</td>}
              {noiteQtd > 0 && <td colSpan={noiteQtd} className={`${thBase} py-1 vertical-middle`} style={{ padding: "4px" }}>Noturno</td>}
              <td rowSpan={2} className={`${thBase} text-[14px] vertical-middle`} style={{ padding: "6px 4px" }}>Assinatura</td>
            </tr>
            <tr className="ponto-colunas-sub-row">
              {Array.from({ length: manhaQtd }, (_, i) => (
                <td key={`mh${i}`} className={`${thBase} text-[13px] leading-tight vertical-middle`} style={{ padding: "4px 2px" }}>{i + 1}ª<br />aula</td>
              ))}
              {Array.from({ length: tardeQtd }, (_, i) => (
                <td key={`th${i}`} className={`${thBase} text-[13px] leading-tight vertical-middle`} style={{ padding: "4px 2px" }}>{i + 1}ª<br />aula</td>
              ))}
              {Array.from({ length: noiteQtd }, (_, i) => (
                <td key={`nh${i}`} className={`${thBase} text-[13px] leading-tight vertical-middle`} style={{ padding: "4px 2px" }}>{i + 1}ª<br />aula</td>
              ))}
            </tr>

            {/* ── DIAS DO MÊS ─────────────────────────────────────────────── */}
            {days.map((day, dayIdx) => {
              const weekend = IS_WEEKEND(day.getDay());
              const wCls    = weekend ? "bg-gray-200 print:bg-gray-200" : "bg-white";
              const dateStr = toISO(day);
              return (
                <tr key={dateStr} className={`ponto-data-row ${weekend ? "bg-gray-200" : "bg-white hover:bg-blue-50/20"}`} style={{ height: "17.5pt" }}>
                  <td className={`${cellBase} text-center font-bold vertical-middle ${wCls}`} style={{ padding: "3px 0px" }}>{day.getDate()}</td>
                  <td className={`${cellBase} text-center vertical-middle ${wCls} ${weekend ? "text-black font-semibold" : "text-black font-medium"}`} style={{ padding: "3px 1px" }}>
                    {JS_DAY_NOME[day.getDay()]}
                  </td>
                  {Array.from({ length: manhaQtd }, (_, i) => renderSlotCell(day, i + 1, "manha", `${dateStr}-m${i + 1}`))}
                  {Array.from({ length: tardeQtd }, (_, i) => renderSlotCell(day, i + 1, "tarde", `${dateStr}-t${i + 1}`))}
                  {Array.from({ length: noiteQtd }, (_, i) => renderSlotCell(day, i + 1, "noite", `${dateStr}-n${i + 1}`))}
                  {(() => {
                    const hName      = getFeriadoNacionalNome(day);
                    const feriado    = hName !== undefined;
                    const dayKey     = String(day.getDate());
                    const override   = assinMap[dayKey];
                    const hasOverride = override !== undefined;
                    const autoText   = weekend ? "********" : hName ? `FERIADO - ${hName}` : "";
                    const displayText = hasOverride ? override : autoText;
                    const isFixed    = (weekend || feriado) && !hasOverride;
                    return (
                      <td className={`${cellBase} ${wCls} ${feriado && !weekend ? "bg-orange-50 print:bg-white" : ""} p-0 vertical-middle text-center`}>
                        {isFixed ? (
                          <div className="flex items-center justify-center h-full px-2">
                            <span className={`text-[13px] font-bold text-center select-none ${
                              feriado ? "text-orange-600 print:text-orange-600" : "text-black print:text-black"
                            }`}>{displayText}</span>
                          </div>
                        ) : (
                          <input
                            type="text"
                            value={displayText}
                            onChange={e => saveAssin(day.getDate(), e.target.value)}
                            className="w-full bg-transparent border-none outline-none text-[13px] px-2 text-center focus:bg-blue-50/20 vertical-middle"
                          />
                        )}
                      </td>
                    );
                  })()}
                </tr>
              );
            })}

            {/* ── LINHAS VAZIAS (até 31) ───────────────────────────────────── */}
            {Array.from({ length: emptyRows }, (_, i) => (
              <tr key={`emp${i}`} className="ponto-data-row bg-white" style={{ height: "17.5pt" }}>
                <td className={`${cellBase} text-center font-bold text-black vertical-middle`} style={{ padding: "3px 0px" }}>{days.length + i + 1}</td>
                <td className={`${cellBase} text-center text-black font-bold text-[13px] vertical-middle select-none`} style={{ padding: "3px 1px" }}>***</td>
                {Array.from({ length: manhaQtd + tardeQtd + noiteQtd }, (_, j) => (
                  <td key={j} className={`${cellBase} text-center text-black font-bold text-[14px] vertical-middle select-none`}>***</td>
                ))}
                <td className={`${cellBase} text-center text-black font-bold text-[13px] vertical-middle select-none`}>********</td>
              </tr>
            ))}

            {/* ── LEGENDA DE SÍMBOLOS ──────────────────────────────────────── */}
            <tr className="ponto-legenda-row">
              <td colSpan={totalCols} className={`${cellBase} bg-white text-left vertical-middle`} style={{ padding: "5px 8px" }}>
                <div className="flex flex-wrap items-center justify-start gap-x-5 gap-y-1.5" style={{ fontSize: "8.5px", letterSpacing: "0.02em", whiteSpace: "normal", wordBreak: "break-word" }}>
                  <span className="font-bold text-black uppercase tracking-widest mr-1" style={{ fontSize: "8.5px" }}>Legenda:</span>
                  {Object.entries(SIMBOLO_MAPA).map(([sym, info]) => (
                    <span key={sym} className="flex items-center gap-1 font-medium text-black whitespace-nowrap" style={{ fontSize: "8.5px", display: "inline-flex" }}>
                      <strong style={{ color: info.cor, fontSize: "9px" }} className="font-bold">{sym}</strong>
                      <span>= {info.descricao}</span>
                    </span>
                  ))}
                  <span className="flex items-center gap-1 font-medium text-black whitespace-nowrap" style={{ fontSize: "8.5px", display: "inline-flex" }}>
                    <strong style={{ color: "#ea580c", fontSize: "9px" }} className="font-bold">*</strong>
                    <span>= Feriado Nacional</span>
                  </span>
                </div>
              </td>
            </tr>

            {/* ── PUBLICAÇÕES, LICENÇAS E OUTROS ───────────────────────────── */}
            <tr className="ponto-observacoes-row" style={{ height: "15.0mm" }}>
              <td colSpan={totalCols} className={`${cellBase} px-2 py-1 bg-white text-left vertical-middle`} style={{ padding: "5px 8px", height: "15.0mm" }}>
                <div className="text-[9px] font-bold text-black mb-0.5">Observações:</div>
                <textarea
                  ref={obsRef}
                  className="w-full text-[9px] leading-snug resize-none border-0 outline-none bg-transparent placeholder:text-gray-400 text-black break-words whitespace-pre-wrap"
                  style={{ minHeight: "28px", height: "auto", overflowY: "hidden" }}
                  placeholder=""
                  value={obs}
                  onChange={e => handleObsChange(e.target.value)}
                />
                <div className="hidden print:flex flex-col w-full mt-1" style={{ gap: "8px", paddingTop: "4px", paddingBottom: "2px" }}>
                  <div className="border-b border-black h-[1px] w-full"></div>
                  <div className="border-b border-black h-[1px] w-full"></div>
                  <div className="border-b border-black h-[1px] w-full"></div>
                  <div className="border-b border-black h-[1px] w-full"></div>
                </div>
              </td>
            </tr>

            {/* ── ASSINATURA DO DIRETOR ────────────────────────────────────── */}
            <tr className="ponto-assinatura-diretor-row">
              <td colSpan={totalCols} className="border-2 border-black bg-[#fcfdfe] py-2 px-3 font-semibold text-[11px] text-black text-left vertical-middle" style={{ padding: "6.5px 8px" }}>
                Assinatura do Diretor:&nbsp;&nbsp;___________________________________________
              </td>
            </tr>

            {/* ── RESUMO MENSAL ────────────────────────────────────────────── */}
            <tr className="ponto-resumo-header-row">
              <td colSpan={totalCols} className="border-2 border-black bg-slate-100 print:bg-white text-center font-bold py-1.5 px-3 text-[12px] uppercase tracking-wider text-black vertical-middle" style={{ padding: "5px 8px" }}>
                RESUMO MENSAL
              </td>
            </tr>
            {/* Linha 1: PRESENÇA | LICENÇA (lado a lado) */}
            <tr className="ponto-resumo-item-row" style={{ height: "17.5pt" }}>
              <td colSpan={Math.ceil(totalCols / 4)} className={`${cellBase} px-2 py-1 bg-white text-left vertical-middle`} style={{ padding: "4px 8px", height: "17.5pt" }}>
                <span className="font-bold">PRESENÇA:</span>&nbsp;
                <input
                  type="text"
                  value={resumo.presenca}
                  onChange={e => saveResumo({ presenca: e.target.value })}
                  className="print:hidden underline font-semibold bg-transparent border-none outline-none w-16 text-left text-current"
                />
                <span className="hidden print:inline underline font-semibold">{resumo.presenca}</span>
              </td>
              <td colSpan={totalCols - Math.ceil(totalCols / 4)} className={`${cellBase} px-2 py-1 bg-white text-left vertical-middle`} style={{ padding: "4px 8px", height: "17.5pt" }}>
                <span className="font-bold">LICENÇA:</span>&nbsp;
                <textarea
                  value={resumo.licenca}
                  onChange={e => saveResumo({ licenca: e.target.value })}
                  rows={1}
                  className="print:hidden underline font-semibold bg-transparent border-none outline-none w-full resize-none text-current text-[10px] align-top text-left"
                  placeholder=""
                />
                <span className="hidden print:inline underline font-semibold whitespace-pre-wrap">{resumo.licenca}</span>
              </td>
            </tr>
            {/* Linha 2: FALTAS | FREQUÊNCIA */}
            <tr className="ponto-resumo-item-row" style={{ height: "17.5pt" }}>
              <td colSpan={Math.ceil(totalCols / 4)} className={`${cellBase} px-2 py-1 bg-white text-left vertical-middle`} style={{ padding: "4px 8px", height: "17.5pt" }}>
                <span className="font-bold">FALTAS:</span>&nbsp;
                <input
                  type="text"
                  value={resumo.faltas}
                  onChange={e => saveResumo({ faltas: e.target.value })}
                  className="print:hidden underline font-semibold bg-transparent border-none outline-none w-16 text-left text-current"
                />
                <span className="hidden print:inline underline font-semibold">{resumo.faltas}</span>
              </td>
              <td colSpan={totalCols - Math.ceil(totalCols / 4)} className={`${cellBase} px-2 py-1 bg-white text-left vertical-middle`} style={{ padding: "4px 8px", height: "17.5pt" }}>
                <span className="font-bold">FREQUÊNCIA:</span>&nbsp;
                <input
                  type="text"
                  value={resumo.freq}
                  onChange={e => saveResumo({ freq: e.target.value })}
                  className="print:hidden underline font-semibold bg-transparent border-none outline-none w-24 text-left text-current"
                />
                <span className="hidden print:inline underline font-semibold">{resumo.freq}</span>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
          ); /* /a4-sheet */
        })()}
      </div>

      <style>{`
        /* ── ON SCREEN FONT SIZE STYLES ── */
        .a4-sheet,
        .a4-sheet table,
        .a4-sheet td,
        .a4-sheet th,
        .a4-sheet span,
        .a4-sheet div,
        .a4-sheet b,
        .a4-sheet input,
        .a4-sheet textarea {
          font-size: 10px !important;
        }
        
        /* Exception 1: Column "dias" */
        .a4-sheet .ponto-colunas-row td:first-child,
        .a4-sheet .ponto-colunas-row td:first-child span,
        .a4-sheet .ponto-data-row td:first-child,
        .a4-sheet .ponto-data-row td:first-child span,
        .a4-sheet .ponto-data-row td:first-child b,
        .a4-sheet .ponto-data-row td:first-child div {
          font-size: 9px !important;
        }
        
        /* Exception 2: Title and Resumo header which must be 12 */
        .a4-sheet .ponto-header-row td,
        .a4-sheet .ponto-header-sub td,
        .a4-sheet .ponto-resumo-header-row td {
          font-size: 12px !important;
        }

        .a4-sheet .ponto-header-row td { font-weight: bold !important; padding: 4px !important; }
        .a4-sheet .ponto-header-sub td { font-weight: bold !important; padding: 3px !important; }
        .a4-sheet .ponto-info-row td { padding: 3px 5px !important; }
        .a4-sheet .ponto-colunas-row td, .a4-sheet .ponto-colunas-sub-row td { font-weight: bold !important; }
        .a4-sheet .ponto-resumo-header-row td { font-weight: bold !important; padding: 3.5px !important; }
        .a4-sheet .ponto-resumo-item-row { height: 17.5pt !important; }
        .a4-sheet .ponto-resumo-item-row td { height: 17.5pt !important; padding: 2.5px 4px !important; }

        @media print {
          @page { size: A4 portrait; margin-top: 1.4cm; margin-bottom: 1.4cm; margin-left: 1.7cm; margin-right: 1.2cm; }
          .no-print { display: none !important; }
          html, body {
            background: white !important;
            background-color: white !important;
            margin: 0 !important;
            padding: 0 !important;
            height: auto !important;
            min-height: 0 !important;
            overflow: visible !important;
          }
          body > div, body > div > div,
          #root, #root > div, #root > div > div,
          main, main > div, .overflow-x-auto {
            background: white !important;
            background-color: white !important;
            box-shadow: none !important;
            height: auto !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
          }
          .a4-sheet {
            background: white !important;
            background-color: white !important;
            width: 100% !important;
            height: 269mm !important;
            min-height: 0 !important;
            padding: 0 !important;
            box-sizing: border-box !important;
            box-shadow: none !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            display: block !important;
            overflow: hidden !important;
          }
          .a4-sheet table {
            width: 100% !important;
            table-layout: fixed !important;
            border-collapse: collapse !important;
          }
          td, th { padding: 1.5px 3px !important; vertical-align: middle !important; text-align: center !important; }
          textarea { resize: none !important; border: none !important; outline: none !important; overflow: hidden !important; }
          input[type="text"] { border: none !important; outline: none !important; background: transparent !important; }
          
          .ponto-data-row {
            height: 17.5pt !important;
          }
          .ponto-data-row td {
            height: 17.5pt !important;
            padding: 1px 1.5px !important;
          }
          .ponto-observacoes-row {
            height: 15.0mm !important;
          }
          .ponto-observacoes-row td {
            height: 15.0mm !important;
          }
          .ponto-data-row td:nth-child(1) {
            padding-left: 0 !important;
            padding-right: 0 !important;
          }
          .ponto-data-row td:nth-child(2) {
            padding-left: 1px !important;
            padding-right: 1px !important;
          }
          
          /* ── EXCLUSIVE PRINT FONT ADJUSTMENTS ── */
          .a4-sheet,
          .a4-sheet table,
          .a4-sheet td,
          .a4-sheet th,
          .a4-sheet span,
          .a4-sheet div,
          .a4-sheet b,
          .a4-sheet input,
          .a4-sheet textarea {
            font-size: 10pt !important;
          }
          
          /* Exception 1: Column "dias" */
          .a4-sheet .ponto-colunas-row td:first-child,
          .a4-sheet .ponto-colunas-row td:first-child span,
          .a4-sheet .ponto-data-row td:first-child,
          .a4-sheet .ponto-data-row td:first-child span,
          .a4-sheet .ponto-data-row td:first-child b,
          .a4-sheet .ponto-data-row td:first-child div {
            font-size: 9pt !important;
          }
          
          /* Exception 2: Title and Resumo header which must be 12 */
          .a4-sheet .ponto-header-row td,
          .a4-sheet .ponto-header-sub td,
          .a4-sheet .ponto-resumo-header-row td {
            font-size: 12pt !important;
          }

          /* Padding & formatting */
          .ponto-header-row td { font-weight: bold !important; padding: 4px !important; }
          .ponto-header-sub td { font-weight: bold !important; padding: 3px !important; }
          .ponto-info-row td { padding: 3px 5px !important; }
          .ponto-colunas-row td, .ponto-colunas-sub-row td { font-weight: bold !important; }
          .ponto-resumo-header-row td { font-weight: bold !important; padding: 3.5px !important; }
          .ponto-resumo-item-row { height: 17.5pt !important; }
          .ponto-resumo-item-row td { height: 17.5pt !important; padding: 2.5px 4px !important; }
          
          /* Comfortable height for signature fields */
          .ponto-assinatura-diretor-row td {
            font-size: 10pt !important;
            font-weight: 600 !important;
            height: 9mm !important;
            padding: 4px 8px !important;
            vertical-align: middle !important;
          }
        }
        .a4-sheet { box-sizing: border-box; }
      `}</style>
      </div>
    </div>
  );
}
