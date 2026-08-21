import { useState, useRef } from "react";
import Papa from "papaparse";
import { useLocation } from "wouter";
import {
  useTurmas,
  useProfessores,
  useDisciplinas,
  useAlocacoes,
  useMatrizCurricular,
  useHorarios,
  mergeHorarios,
  generateId,
} from "@/store";
import type { Turma, Professor, Disciplina, Alocacao, MatrizCurricular, HorarioRaw, BancoDeDados } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Upload, Save, X, FileText, CheckCircle2, AlertTriangle, Database, Info, Download, Play,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── Mapas de normalização ──────────────────────────────────────────────────

const DIAS_MAP: Record<string, string> = {
  segunda: "segunda", "segunda-feira": "segunda", seg: "segunda", mon: "segunda", "2": "segunda",
  terca: "terca", "terca-feira": "terca", terça: "terca", "terça-feira": "terca",
  ter: "terca", tue: "terca", "3": "terca",
  quarta: "quarta", "quarta-feira": "quarta", qua: "quarta", wed: "quarta", "4": "quarta",
  quinta: "quinta", "quinta-feira": "quinta", qui: "quinta", thu: "quinta", "5": "quinta",
  sexta: "sexta", "sexta-feira": "sexta", sex: "sexta", fri: "sexta", "6": "sexta",
};

const TURNO_MAP: Record<string, "manha" | "tarde" | "noite"> = {
  manhã: "manha", manha: "manha", matutino: "manha", morning: "manha", m: "manha", "1": "manha",
  tarde: "tarde", vespertino: "tarde", afternoon: "tarde", t: "tarde", "2": "tarde",
  noite: "noite", noturno: "noite", night: "noite", n: "noite", "3": "noite",
};

const DIAS_PT: Record<string, string> = {
  segunda: "Segunda", terca: "Terça", quarta: "Quarta", quinta: "Quinta", sexta: "Sexta",
};

const CORES = [
  "#3B82F6","#22C55E","#F97316","#A855F7","#EF4444",
  "#0EA5E9","#F59E0B","#10B981","#EC4899","#6366F1","#14B8A6",
];

function norm(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

// ─── Tipos ──────────────────────────────────────────────────────────────────

interface CsvRow {
  turno?: string;
  turma?: string;
  disciplina?: string;
  professor?: string;
  dia?: string;
  aula?: string | number;
  horario_inicio?: string; // coluna do CSV: horario_inicio
  horario_fim?: string;    // coluna do CSV: horario_fim
  masp?: string;
  cargo?: string;
  [key: string]: string | number | undefined;
}

interface PreviewRow {
  idUnico: string;
  turno: string;
  turma: string;
  disciplina: string;
  professor: string;
  dia: string;
  aula: string;
  status: "novo" | "duplicado";
}

interface SaveResult {
  inseridos: number;
  duplicados: number;
  turmasNovas: number;
  profsNovos: number;
  discsNovas: number;
}

// ─── Detector de colunas ────────────────────────────────────────────────────

function detectColKey(headers: string[], patterns: RegExp[]): string | undefined {
  return headers.find(h => patterns.some(p => p.test(norm(h))));
}

function mapRow(raw: Record<string, string>, headers: string[]): CsvRow {
  const colTurno      = detectColKey(headers, [/^turno/, /^periodo/]);
  const colTurma      = detectColKey(headers, [/^turma/, /^classe/, /^class/]);
  const colDisciplina = detectColKey(headers, [/^disc/, /^materia/, /^componente/, /^subject/]);
  const colProfessor  = detectColKey(headers, [/^prof/, /^docente/, /^nome/]);
  const colDia        = detectColKey(headers, [/^dia/, /^semana/, /^weekday/]);
  const colAula       = detectColKey(headers, [/^aula/, /^horario(?!_)/, /^hora\b/, /^slot/, /^order/]);
  const colInicio     = detectColKey(headers, [/^horario_inicio/, /^inicio/, /^hora_inicio/, /^start/]);
  const colFim        = detectColKey(headers, [/^horario_fim/, /^fim/, /^hora_fim/, /^end/]);
  const colMasp       = detectColKey(headers, [/^masp/, /^matric/, /^registro/]);
  const colCargo      = detectColKey(headers, [/^cargo/, /^vinculo/, /^funcao/, /^tipo/]);

  return {
    turno:           colTurno      ? raw[colTurno]     ?.trim() : undefined,
    turma:           colTurma      ? raw[colTurma]     ?.trim() : undefined,
    disciplina:      colDisciplina ? raw[colDisciplina]?.trim() : undefined,
    professor:       colProfessor  ? raw[colProfessor] ?.trim() : undefined,
    dia:             colDia        ? raw[colDia]       ?.trim() : undefined,
    aula:            colAula       ? raw[colAula]      ?.trim() : undefined,
    horario_inicio:  colInicio     ? raw[colInicio]    ?.trim() : undefined,
    horario_fim:     colFim        ? raw[colFim]       ?.trim() : undefined,
    masp:            colMasp       ? raw[colMasp]      ?.trim() : undefined,
    cargo:           colCargo      ? raw[colCargo]     ?.trim() : undefined,
  };
}

// ─── Componente principal ────────────────────────────────────────────────────

export default function ImportadorCSV() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [turmas,      setTurmas]      = useTurmas();
  const [professores, setProfessores] = useProfessores();
  const [disciplinas, setDisciplinas] = useDisciplinas();
  const [alocacoes,   setAlocacoes]   = useAlocacoes();
  const [matriz,      setMatriz]      = useMatrizCurricular();
  const [horarios,    setHorarios]    = useHorarios();

  const [csvRows,   setCsvRows]   = useState<CsvRow[]>([]);
  const [preview,   setPreview]   = useState<PreviewRow[]>([]);
  const [fileName,  setFileName]  = useState("");
  const [result,    setResult]    = useState<SaveResult | null>(null);
  const [error,     setError]     = useState("");

  // ─── Leitura do arquivo ────────────────────────────────────────────────────

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError("");
    setResult(null);

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0 && results.data.length === 0) {
          setError("Erro ao ler o arquivo CSV. Verifique o formato.");
          return;
        }
        const headers = results.meta.fields ?? [];
        const rows = results.data.map(r => mapRow(r, headers));
        setCsvRows(rows);
        buildPreview(rows);
      },
      error: (err) => setError("Erro ao processar CSV: " + err.message),
    });

    // limpa input para permitir re-upload do mesmo arquivo
    e.target.value = "";
  }

  function downloadMockCSV(exNum: number) {
    const csvContent = exNum === 1 ? CRONOS_MOCK_1 : CRONOS_MOCK_2;
    const name = exNum === 1 ? "cronos_escola_padre_almir_manha.csv" : "cronos_escola_americo_rene_tarde.csv";
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", name);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({
      title: "Download iniciado!",
      description: `O arquivo ${name} foi baixado com sucesso. Você pode usá-lo para testar o envio manual do CSV.`
    });
  }

  function loadMockCronos(exNum: number) {
    const csvContent = exNum === 1 ? CRONOS_MOCK_1 : CRONOS_MOCK_2;
    const name = exNum === 1 ? "cronos_escola_padre_almir_manha.csv" : "cronos_escola_americo_rene_tarde.csv";
    
    setFileName(name);
    setError("");
    setResult(null);

    Papa.parse<Record<string, string>>(csvContent, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0 && results.data.length === 0) {
          setError("Erro ao ler o arquivo CSV simulado.");
          return;
        }
        const headers = results.meta.fields ?? [];
        const rows = results.data.map(r => mapRow(r, headers));
        setCsvRows(rows);
        buildPreview(rows);
        toast({
          title: "Horário Cronos Carregado!",
          description: `Os dados do Exemplo ${exNum} foram carregados na pré-visualização. Clique em 'Salvar no Banco de Dados' para concluir.`
        });
      },
      error: (err: any) => setError("Erro ao processar CSV de teste: " + err.message),
    });
  }

  function turnoLabel(t: string): string {
    return t === "manha" ? "Matutino" : t === "tarde" ? "Vespertino" : "Noturno";
  }

  function buildPreview(rows: CsvRow[]) {
    // Verifica duplicatas tanto nas alocações existentes quanto no banco hierárquico
    const existingAlocs = new Set(alocacoes.map(a => {
      const t = turmas.find(t => t.id === a.turmaId);
      return `${t?.turno ?? ""}_${t?.nome ?? ""}_${a.diaSemana}_${a.horario}`;
    }));

    const seen = new Set<string>();
    const rows2: PreviewRow[] = [];

    for (const item of rows) {
      const turnoNorm = item.turno ? (TURNO_MAP[norm(item.turno)] ?? "manha") : "manha";
      const turmaVal  = item.turma || "";
      const dia       = item.dia   ? (DIAS_MAP[norm(item.dia)] ?? "") : "";
      const aulaNum   = item.aula != null ? parseInt(String(item.aula)) : 0;

      if (!turmaVal || !dia || !aulaNum) continue;

      const label      = turnoLabel(turnoNorm);
      // Chave interna (sem turno — turno é a "pasta" pai)
      const idRegistro = `${dia}_${turmaVal}_${aulaNum}`.replace(/[.#$[\]\s]/g, "_");
      // Chave de controlo de duplicatas no banco hierárquico
      const hierKey    = `${label}/${idRegistro}`;

      const jaNoAloc  = existingAlocs.has(`${turnoNorm}_${turmaVal}_${dia}_${aulaNum}`);
      const jaNoHier  = !!horarios[label]?.[idRegistro];
      const duplicado = seen.has(hierKey) || jaNoAloc || jaNoHier;
      seen.add(hierKey);

      rows2.push({
        idUnico:   idRegistro,
        turno:     label,
        turma:     turmaVal,
        disciplina: item.disciplina || "—",
        professor:  item.professor  || "—",
        dia:        DIAS_PT[dia] ?? dia,
        aula:       String(aulaNum),
        status:     duplicado ? "duplicado" : "novo",
      });
    }

    setPreview(rows2);
  }

  // ─── Salvar no banco de dados (localStorage) ───────────────────────────────

  function handleSave() {
    if (csvRows.length === 0) {
      toast({ title: "Selecione um arquivo CSV primeiro.", variant: "destructive" });
      return;
    }

    const novaTurmaMap   = new Map<string, Turma>(turmas.map(t => [t.nome + "|" + t.turno, t]));
    const novaProfMap    = new Map<string, Professor>(professores.map(p => [p.nomeCompleto, p]));
    const novaDiscMap    = new Map<string, Disciplina>(disciplinas.map(d => [d.nome, d]));
    const novasAlocacoes: Alocacao[] = [...alocacoes];
    const novaMatriz: MatrizCurricular[] = [...matriz];

    let inseridos   = 0;
    let duplicados  = 0;
    let colorIdx    = disciplinas.length % CORES.length;
    // Estrutura hierárquica: { "Matutino": { "dia_turma_aula": HorarioRaw } }
    // Espelha Firebase /horarios/TURNO/idRegistro — turnos nunca se sobrescrevem
    const novosHorarios: BancoDeDados = {};

    const DEFAULT_DISP_HOURS = [1, 2, 3, 4, 5, 6, 11, 12, 13, 14, 15, 16, 21, 22, 23, 24];
    const DEFAULT_DISP = Object.fromEntries(
      ["segunda","terca","quarta","quinta","sexta"].map(d => [d, DEFAULT_DISP_HOURS])
    );

    for (const item of csvRows) {
      const turnoNorm  = item.turno ? (TURNO_MAP[norm(item.turno)] ?? "manha") : "manha";
      const turmaNome  = item.turma?.trim() || "";
      const discNome   = item.disciplina?.trim() || "";
      const profNome   = item.professor?.trim() || "";
      const diaNorm    = item.dia ? (DIAS_MAP[norm(item.dia)] ?? "") : "";
      const aulaNum    = item.aula != null ? parseInt(String(item.aula)) : 0;

      if (!turmaNome || !diaNorm || !aulaNum || aulaNum < 1 || aulaNum > 10) continue;

      // Turma
      const turmaKey = turmaNome + "|" + turnoNorm;
      if (!novaTurmaMap.has(turmaKey)) {
        novaTurmaMap.set(turmaKey, {
          id: generateId(),
          nome: turmaNome,
          turno: turnoNorm,
          serie: turmaNome.replace(/[-_]\w+$/, "").trim() || turmaNome,
          anoLetivo: new Date().getFullYear(),
          observacoes: "",
        });
      }
      const turma = novaTurmaMap.get(turmaKey)!;

      // Disciplina
      let disc: Disciplina | undefined;
      if (discNome) {
        if (!novaDiscMap.has(discNome)) {
          novaDiscMap.set(discNome, {
            id: generateId(),
            nome: discNome,
            abreviacao: discNome.split(/\s+/).map(w => w[0]?.toUpperCase() ?? "").join("").slice(0, 5) || discNome.slice(0, 5).toUpperCase(),
            cor: CORES[colorIdx++ % CORES.length],
            cargaHorariaSemanal: 2,
          });
        }
        disc = novaDiscMap.get(discNome);
      }

      // Professor
      let prof: Professor | undefined;
      if (profNome) {
        if (!novaProfMap.has(profNome)) {
          novaProfMap.set(profNome, {
            id: generateId(),
            nomeCompleto: profNome,
            masp: item.masp || undefined,
            tipoVinculo: item.cargo
              ? (norm(String(item.cargo)).includes("efetivo") ? "efetivo" : norm(String(item.cargo)).includes("designado") ? "designado" : undefined)
              : undefined,
            disciplinas: [],
            turmas: [],
            disponibilidade: DEFAULT_DISP,
            cargaHorariaMaximaSemanal: 20,
          });
        }
        prof = novaProfMap.get(profNome);
        if (prof && disc && !prof.disciplinas.includes(disc.id)) prof.disciplinas.push(disc.id);
        if (prof && !prof.turmas.includes(turma.id))             prof.turmas.push(turma.id);
      }

      // Estrutura hierárquica: turno é a "pasta", idRegistro é a chave interna
      // Equivale a: updates[`/horarios/${turno}/${idRegistro}`] = item  (Firebase)
      const label      = turnoLabel(turnoNorm);
      const idRegistro = `${diaNorm}_${turmaNome}_${aulaNum}`.replace(/[.#$[\]\s]/g, "_");

      // Já existe nesta pasta de turno?
      const jaNoHier  = !!horarios[label]?.[idRegistro];
      const jaNoAloc  = novasAlocacoes.some(a => {
        const t = novaTurmaMap.get(turmaNome + "|" + turnoNorm);
        return t && a.turmaId === t.id && a.diaSemana === diaNorm && a.horario === aulaNum;
      });

      if (jaNoHier || jaNoAloc) {
        duplicados++;
        continue;
      }

      novasAlocacoes.push({
        id: generateId(),
        turmaId:      turma.id,
        disciplinaId: disc?.id ?? generateId(),
        professorId:  prof?.id ?? generateId(),
        diaSemana:    diaNorm,
        horario:      aulaNum,
      });

      // Salva na pasta do turno — Matutino nunca sobrescreve Vespertino
      if (!novosHorarios[label]) novosHorarios[label] = {};
      novosHorarios[label][idRegistro] = {
        id:             idRegistro,
        turno:          label,
        turma:          turmaNome,
        disciplina:     discNome  || "",
        professor:      profNome  || "",
        dia:            diaNorm,
        aula:           aulaNum,
        horarioInicio:  item.horario_inicio || undefined,
        horarioFim:     item.horario_fim    || undefined,
        masp:           item.masp           || undefined,
        cargo:          item.cargo ? String(item.cargo) : undefined,
        importadoEm:    new Date().toISOString(),
      };
      inseridos++;

      // Matriz curricular
      if (disc) {
        if (!novaMatriz.some(m => m.turmaId === turma.id && m.disciplinaId === disc!.id)) {
          novaMatriz.push({ turmaId: turma.id, disciplinaId: disc.id, aulasPorSemana: 1 });
        } else {
          const idx = novaMatriz.findIndex(m => m.turmaId === turma.id && m.disciplinaId === disc!.id);
          novaMatriz[idx] = { ...novaMatriz[idx], aulasPorSemana: novaMatriz[idx].aulasPorSemana + 1 };
        }
      }
    }

    // Preencher o planejamento (planejamento) de cada professor com base na matriz curricular e alocações
    for (const prof of novaProfMap.values()) {
      const planItems: any[] = [];
      const seenPairs = new Set<string>();

      novasAlocacoes.forEach(a => {
        if (a.professorId === prof.id) {
          const pairKey = `${a.turmaId}|${a.disciplinaId}`;
          if (!seenPairs.has(pairKey)) {
            seenPairs.add(pairKey);
            const mItem = novaMatriz.find(m => m.turmaId === a.turmaId && m.disciplinaId === a.disciplinaId);
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

    const turmasNovas    = [...novaTurmaMap.values()].filter(t => !turmas.find(e => e.id === t.id)).length;
    const profsNovos     = [...novaProfMap.values()].filter(p => !professores.find(e => e.id === p.id)).length;
    const discsNovas     = [...novaDiscMap.values()].filter(d => !disciplinas.find(e => e.id === d.id)).length;

    setTurmas([...novaTurmaMap.values()]);
    setProfessores([...novaProfMap.values()]);
    setDisciplinas([...novaDiscMap.values()]);
    setAlocacoes(novasAlocacoes);
    setMatriz(novaMatriz);

    // ── edu_horarios hierárquico: merge por turno (lógica dos snippets) ──────
    // Equivale a: update(ref(db), updates) do Firebase
    // Cada turno fica na sua "pasta" — Matutino nunca sobrescreve Vespertino
    // mergeHorarios faz: { ...existentes[turno], ...novos[turno] } por pasta
    const horariosAtualizados = mergeHorarios(horarios, novosHorarios);
    setHorarios(horariosAtualizados);

    setResult({ inseridos, duplicados, turmasNovas, profsNovos, discsNovas });
    setCsvRows([]);
    setPreview([]);
    setFileName("");

    toast({ title: "Importação CSV concluída!", description: `${inseridos} alocações adicionadas ao Banco de Dados.` });
    setTimeout(() => navigate("/"), 2000);
  }

  function reset() {
    setCsvRows([]);
    setPreview([]);
    setFileName("");
    setError("");
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const novosCount      = preview.filter(r => r.status === "novo").length;
  const duplicadosCount = preview.filter(r => r.status === "duplicado").length;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Importador CSV</h1>
        <p className="text-muted-foreground mt-1">
          Importe horários via arquivo CSV — os dados novos são somados ao Banco de Dados sem apagar os existentes.
        </p>
      </div>

      {/* Instruções de formato */}
      <Card className="border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30">
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm flex items-center gap-2 text-blue-800 dark:text-blue-300">
            <Info className="w-4 h-4" />
            Formato esperado do CSV
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-blue-700 dark:text-blue-400 space-y-1 pb-4">
          <p>O arquivo deve ter cabeçalho na 1ª linha. Colunas reconhecidas (nomes flexíveis):</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 mt-1 font-mono">
            <span><strong>Turno</strong> — Manhã / Tarde / Noite</span>
            <span><strong>Turma</strong> — ex: 6A, 7B, 8C</span>
            <span><strong>Disciplina</strong> — nome da matéria</span>
            <span><strong>Professor</strong> — nome completo</span>
            <span><strong>Dia</strong> — Segunda, Terça… ou número</span>
            <span><strong>Aula</strong> (ou Horário) — número 1–10</span>
            <span><strong>MASP</strong> — matrícula (opcional)</span>
            <span><strong>Cargo</strong> — efetivo / designado (opcional)</span>
          </div>
        </CardContent>
      </Card>

      {/* Simulador de Integração Cronos */}
      {!result && (
        <Card className="border-emerald-200 bg-emerald-50/50 dark:border-emerald-950 dark:bg-emerald-950/10">
          <CardHeader className="pb-3 pt-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-emerald-800 dark:text-emerald-400">
              <Database className="w-4 h-4 text-emerald-600" />
              🔌 Simulação de Integração Cronos — Testar com Horários Prontos
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pb-4">
            <p className="text-xs text-emerald-700 dark:text-emerald-300">
              O Cronos é um sistema de horários escolares amplamente utilizado.
              Preparamos dois horários reais completos e prontos de teste para você validar o sistema com apenas um clique!
              Você de forma prática pode <strong>Baixar o arquivo .csv</strong> ou clicar em <strong>Carregar Direto no Sistema</strong> para colocá-lo na grade de pré-visualização.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Exemplo 1 */}
              <div className="bg-background border rounded-lg p-3 flex flex-col justify-between space-y-3 shadow-xs dark:bg-muted/20">
                <div>
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-[10px] bg-cyan-50 dark:bg-cyan-950 text-cyan-700 dark:text-cyan-300 border-cyan-200">
                      Turno: Matutino
                    </Badge>
                    <Badge className="text-[10px] bg-emerald-600 hover:bg-emerald-600 text-white">75 Aulas</Badge>
                  </div>
                  <h3 className="font-semibold text-sm mt-2 text-foreground">Exemplo 1: E.E. Padre Almir</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Ideal para testar horários matutinos do Ensino Médio (turmas 101, 201 e 301). Professores reais com restrições, vínculos e MASP definidos.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => downloadMockCSV(1)}>
                    <Download className="w-3.5 h-3.5 mr-1" />
                    Baixar CSV
                  </Button>
                  <Button size="sm" className="flex-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => loadMockCronos(1)}>
                    <Play className="w-3.5 h-3.5 mr-1 fill-current" />
                    Carregar Direto
                  </Button>
                </div>
              </div>

              {/* Exemplo 2 */}
              <div className="bg-background border rounded-lg p-3 flex flex-col justify-between space-y-3 shadow-xs dark:bg-muted/20">
                <div>
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-[10px] bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200">
                      Turno: Vespertino
                    </Badge>
                    <Badge className="text-[10px] bg-emerald-600 hover:bg-emerald-600 text-white">75 Aulas</Badge>
                  </div>
                  <h3 className="font-semibold text-sm mt-2 text-foreground">Exemplo 2: E.E. Américo Renê</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Ideal para testar o período da tarde no Ensino Fundamental (turmas 6º A, 7º B e 8º C). Ótimo para ver a flexibilização e o painel de conflitos.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => downloadMockCSV(2)}>
                    <Download className="w-3.5 h-3.5 mr-1" />
                    Baixar CSV
                  </Button>
                  <Button size="sm" className="flex-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => loadMockCronos(2)}>
                    <Play className="w-3.5 h-3.5 mr-1 fill-current" />
                    Carregar Direto
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upload */}
      {!result && (
        <Card>
          <CardContent className="pt-6 pb-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="flex-1">
                <label
                  htmlFor="csv-upload"
                  className="flex items-center gap-3 px-4 py-3 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary hover:bg-muted/30 transition-colors"
                >
                  <FileText className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">
                      {fileName ? fileName : "Clique para selecionar um arquivo .csv"}
                    </p>
                    {!fileName && <p className="text-xs text-muted-foreground">Somente arquivos .csv</p>}
                  </div>
                </label>
                <input
                  id="csv-upload"
                  ref={fileRef}
                  type="file"
                  accept=".csv"
                  className="sr-only"
                  onChange={handleFileUpload}
                />
              </div>
              {csvRows.length > 0 && (
                <Button variant="outline" size="sm" onClick={reset}>
                  <X className="w-4 h-4 mr-1" />
                  Limpar
                </Button>
              )}
            </div>

            {csvRows.length > 0 && (
              <p className="text-sm text-muted-foreground mt-3">
                <strong>{csvRows.length}</strong> linhas lidas do CSV.
              </p>
            )}

            {error && (
              <div className="mt-3 flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="w-4 h-4" />
                {error}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Prévia */}
      {preview.length > 0 && !result && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-3">
              Pré-visualização
              <Badge variant="secondary">{novosCount} novos</Badge>
              {duplicadosCount > 0 && (
                <Badge variant="outline" className="text-amber-600 border-amber-300">
                  {duplicadosCount} duplicados (serão ignorados)
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Turno</TableHead>
                    <TableHead>Turma</TableHead>
                    <TableHead>Disciplina</TableHead>
                    <TableHead>Professor</TableHead>
                    <TableHead>Dia</TableHead>
                    <TableHead>Aula</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.slice(0, 100).map((row, i) => (
                    <TableRow key={i} className={row.status === "duplicado" ? "opacity-40" : ""}>
                      <TableCell className="text-xs">{row.turno}</TableCell>
                      <TableCell className="text-xs font-medium">{row.turma}</TableCell>
                      <TableCell className="text-xs">{row.disciplina}</TableCell>
                      <TableCell className="text-xs">{row.professor}</TableCell>
                      <TableCell className="text-xs">{row.dia}</TableCell>
                      <TableCell className="text-xs">{row.aula}ª</TableCell>
                      <TableCell>
                        {row.status === "novo"
                          ? <Badge className="text-[10px] py-0">Novo</Badge>
                          : <Badge variant="outline" className="text-[10px] py-0 text-amber-600 border-amber-300">Duplicado</Badge>
                        }
                      </TableCell>
                    </TableRow>
                  ))}
                  {preview.length > 100 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground text-xs py-3">
                        … e mais {preview.length - 100} linhas
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Ações */}
      {preview.length > 0 && !result && (
        <div className="flex items-center gap-3 justify-end">
          <Button variant="outline" onClick={reset}>
            <X className="w-4 h-4 mr-1.5" />
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={novosCount === 0}>
            <Database className="w-4 h-4 mr-1.5" />
            Salvar no Banco de Dados
            {novosCount > 0 && <Badge variant="secondary" className="ml-2">{novosCount}</Badge>}
          </Button>
        </div>
      )}

      {/* Resultado */}
      {result && (
        <Card className="border-green-300 bg-green-50 dark:border-green-900 dark:bg-green-950/30">
          <CardContent className="pt-6 pb-6 text-center space-y-4">
            <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto" />
            <div>
              <p className="font-semibold text-green-800 dark:text-green-300 text-lg">
                Importação concluída com sucesso!
              </p>
              <p className="text-sm text-green-700 dark:text-green-400 mt-1">
                Os dados novos foram somados ao Banco de Dados.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-3 mt-2">
              <Badge className="bg-green-600 text-white">{result.inseridos} alocações adicionadas</Badge>
              {result.turmasNovas  > 0 && <Badge variant="outline" className="border-green-500 text-green-700">{result.turmasNovas} turmas novas</Badge>}
              {result.profsNovos   > 0 && <Badge variant="outline" className="border-green-500 text-green-700">{result.profsNovos} professores novos</Badge>}
              {result.discsNovas   > 0 && <Badge variant="outline" className="border-green-500 text-green-700">{result.discsNovas} disciplinas novas</Badge>}
              {result.duplicados   > 0 && <Badge variant="outline" className="border-amber-400 text-amber-700">{result.duplicados} duplicados ignorados</Badge>}
            </div>
            <div className="flex justify-center gap-3 pt-2">
              <Button variant="outline" onClick={reset}>
                <Upload className="w-4 h-4 mr-1.5" />
                Importar mais
              </Button>
              <Button onClick={() => navigate("/")}>
                Ir ao Painel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const CRONOS_MOCK_1 = `Turno,Turma,Disciplina,Professor,Dia,Aula,Masp,Cargo
Manhã,101 - 1º EM,Matemática,Ana Paula Silva,Segunda,1,123456-7,Efetivo
Manhã,101 - 1º EM,Matemática,Ana Paula Silva,Segunda,2,123456-7,Efetivo
Manhã,101 - 1º EM,Português,Marcos Castro,Segunda,3,765432-1,Designado
Manhã,101 - 1º EM,Biologia,Mariana Costa,Segunda,4,987654-3,Efetivo
Manhã,101 - 1º EM,Física,Juliana Rocha,Segunda,5,543210-9,Efetivo
Manhã,201 - 2º EM,Biologia,Mariana Costa,Segunda,1,987654-3,Efetivo
Manhã,201 - 2º EM,Física,Juliana Rocha,Segunda,2,543210-9,Efetivo
Manhã,201 - 2º EM,Matemática,Ana Paula Silva,Segunda,3,123456-7,Efetivo
Manhã,201 - 2º EM,Matemática,Ana Paula Silva,Segunda,4,123456-7,Efetivo
Manhã,201 - 2º EM,Português,Marcos Castro,Segunda,5,765432-1,Designado
Manhã,301 - 3º EM,Português,Marcos Castro,Segunda,1,765432-1,Designado
Manhã,301 - 3º EM,Português,Marcos Castro,Segunda,2,765432-1,Designado
Manhã,301 - 3º EM,História,Sérgio Neves,Segunda,3,112233-4,Efetivo
Manhã,301 - 3º EM,Física,Juliana Rocha,Segunda,4,543210-9,Efetivo
Manhã,301 - 3º EM,Biologia,Mariana Costa,Segunda,5,987654-3,Efetivo
Manhã,101 - 1º EM,Português,Marcos Castro,Terça,1,765432-1,Designado
Manhã,101 - 1º EM,Português,Marcos Castro,Terça,2,765432-1,Designado
Manhã,101 - 1º EM,História,Sérgio Neves,Terça,3,112233-4,Efetivo
Manhã,101 - 1º EM,História,Sérgio Neves,Terça,4,112233-4,Efetivo
Manhã,101 - 1º EM,Biologia,Mariana Costa,Terça,5,987654-3,Efetivo
Manhã,201 - 2º EM,História,Sérgio Neves,Terça,1,112233-4,Efetivo
Manhã,201 - 2º EM,História,Sérgio Neves,Terça,2,112233-4,Efetivo
Manhã,201 - 2º EM,Biologia,Mariana Costa,Terça,3,987654-3,Efetivo
Manhã,201 - 2º EM,Português,Marcos Castro,Terça,4,765432-1,Designado
Manhã,201 - 2º EM,Física,Juliana Rocha,Terça,5,543210-9,Efetivo
Manhã,301 - 3º EM,Matemática,Ana Paula Silva,Terça,1,123456-7,Efetivo
Manhã,301 - 3º EM,Matemática,Ana Paula Silva,Terça,2,123456-7,Efetivo
Manhã,301 - 3º EM,Biologia,Mariana Costa,Terça,3,987654-3,Efetivo
Manhã,301 - 3º EM,Física,Juliana Rocha,Terça,4,543210-9,Efetivo
Manhã,301 - 3º EM,Português,Marcos Castro,Terça,5,765432-1,Designado
Manhã,101 - 1º EM,Biologia,Mariana Costa,Quarta,1,987654-3,Efetivo
Manhã,101 - 1º EM,Física,Juliana Rocha,Quarta,2,543210-9,Efetivo
Manhã,101 - 1º EM,Português,Marcos Castro,Quarta,3,765432-1,Designado
Manhã,101 - 1º EM,História,Sérgio Neves,Quarta,4,112233-4,Efetivo
Manhã,101 - 1º EM,Matemática,Ana Paula Silva,Quarta,5,123456-7,Efetivo
Manhã,201 - 2º EM,Matemática,Ana Paula Silva,Quarta,1,123456-7,Efetivo
Manhã,201 - 2º EM,História,Sérgio Neves,Quarta,2,112233-4,Efetivo
Manhã,201 - 2º EM,Português,Marcos Castro,Quarta,3,765432-1,Designado
Manhã,201 - 2º EM,Biologia,Mariana Costa,Quarta,4,987654-3,Efetivo
Manhã,201 - 2º EM,Física,Juliana Rocha,Quarta,5,543210-9,Efetivo
Manhã,301 - 3º EM,História,Sérgio Neves,Quarta,1,112233-4,Efetivo
Manhã,301 - 3º EM,Física,Juliana Rocha,Quarta,2,543210-9,Efetivo
Manhã,301 - 3º EM,Matemática,Ana Paula Silva,Quarta,3,123456-7,Efetivo
Manhã,301 - 3º EM,Português,Marcos Castro,Quarta,4,765432-1,Designado
Manhã,301 - 3º EM,Biologia,Mariana Costa,Quarta,5,987654-3,Efetivo
Manhã,101 - 1º EM,Matemática,Ana Paula Silva,Quinta,1,123456-7,Efetivo
Manhã,101 - 1º EM,Matemática,Ana Paula Silva,Quinta,2,123456-7,Efetivo
Manhã,101 - 1º EM,Português,Marcos Castro,Quinta,3,765432-1,Designado
Manhã,101 - 1º EM,Física,Juliana Rocha,Quinta,4,543210-9,Efetivo
Manhã,101 - 1º EM,Biologia,Mariana Costa,Quinta,5,987654-3,Efetivo
Manhã,201 - 2º EM,Física,Juliana Rocha,Quinta,1,543210-9,Efetivo
Manhã,201 - 2º EM,Biologia,Mariana Costa,Quinta,2,987654-3,Efetivo
Manhã,201 - 2º EM,Matemática,Ana Paula Silva,Quinta,3,123456-7,Efetivo
Manhã,201 - 2º EM,Matemática,Ana Paula Silva,Quinta,4,123456-7,Efetivo
Manhã,201 - 2º EM,Português,Marcos Castro,Quinta,5,765432-1,Designado
Manhã,301 - 3º EM,Português,Marcos Castro,Quinta,1,765432-1,Designado
Manhã,301 - 3º EM,História,Sérgio Neves,Quinta,2,112233-4,Efetivo
Manhã,301 - 3º EM,História,Sérgio Neves,Quinta,3,112233-4,Efetivo
Manhã,301 - 3º EM,Física,Juliana Rocha,Quinta,4,543210-9,Efetivo
Manhã,301 - 3º EM,Biologia,Mariana Costa,Quinta,5,987654-3,Efetivo
Manhã,101 - 1º EM,História,Sérgio Neves,Sexta,1,112233-4,Efetivo
Manhã,101 - 1º EM,História,Sérgio Neves,Sexta,2,112233-4,Efetivo
Manhã,101 - 1º EM,Física,Juliana Rocha,Sexta,3,543210-9,Efetivo
Manhã,101 - 1º EM,Português,Marcos Castro,Sexta,4,765432-1,Designado
Manhã,101 - 1º EM,Biologia,Mariana Costa,Sexta,5,987654-3,Efetivo
Manhã,201 - 2º EM,Português,Marcos Castro,Sexta,1,765432-1,Designado
Manhã,201 - 2º EM,Física,Juliana Rocha,Sexta,2,543210-9,Efetivo
Manhã,201 - 2º EM,História,Sérgio Neves,Sexta,3,112233-4,Efetivo
Manhã,201 - 2º EM,História,Sérgio Neves,Sexta,4,112233-4,Efetivo
Manhã,201 - 2º EM,Biologia,Mariana Costa,Sexta,5,987654-3,Efetivo
Manhã,301 - 3º EM,Biologia,Mariana Costa,Sexta,1,987654-3,Efetivo
Manhã,301 - 3º EM,Matemática,Ana Paula Silva,Sexta,2,123456-7,Efetivo
Manhã,301 - 3º EM,Matemática,Ana Paula Silva,Sexta,3,123456-7,Efetivo
Manhã,301 - 3º EM,Física,Juliana Rocha,Sexta,4,543210-9,Efetivo
Manhã,301 - 3º EM,Português,Marcos Castro,Sexta,5,765432-1,Designado`;

const CRONOS_MOCK_2 = `Turno,Turma,Disciplina,Professor,Dia,Aula,Masp,Cargo
Tarde,6º Ano A,Geografia,Beatriz Menta,Segunda,1,246813-5,Efetivo
Tarde,6º Ano A,Geografia,Beatriz Menta,Segunda,2,246813-5,Efetivo
Tarde,6º Ano A,Educação Física,Roberto Souza,Segunda,3,135792-4,Efetivo
Tarde,6º Ano A,Matemática,Ana Paula Silva,Segunda,4,123456-7,Efetivo
Tarde,6º Ano A,Português,Marcos Castro,Segunda,5,765432-1,Designado
Tarde,7º Ano B,Matemática,Ana Paula Silva,Segunda,1,123456-7,Efetivo
Tarde,7º Ano B,Matemática,Ana Paula Silva,Segunda,2,123456-7,Efetivo
Tarde,7º Ano B,Geografia,Beatriz Menta,Segunda,3,246813-5,Efetivo
Tarde,7º Ano B,Educação Física,Roberto Souza,Segunda,4,135792-4,Efetivo
Tarde,7º Ano B,Português,Marcos Castro,Segunda,5,765432-1,Designado
Tarde,8º Ano C,Português,Marcos Castro,Segunda,1,765432-1,Designado
Tarde,8º Ano C,Português,Marcos Castro,Segunda,2,765432-1,Designado
Tarde,8º Ano C,Química,Lucas Dias,Segunda,3,864209-1,Efetivo
Tarde,8º Ano C,Geografia,Beatriz Menta,Segunda,4,246813-5,Efetivo
Tarde,8º Ano C,Educação Física,Roberto Souza,Segunda,5,135792-4,Efetivo
Tarde,6º Ano A,Português,Marcos Castro,Terça,1,765432-1,Designado
Tarde,6º Ano A,Português,Marcos Castro,Terça,2,765432-1,Designado
Tarde,6º Ano A,Química,Lucas Dias,Terça,3,864209-1,Efetivo
Tarde,6º Ano A,Química,Lucas Dias,Terça,4,864209-1,Efetivo
Tarde,6º Ano A,Geografia,Beatriz Menta,Terça,5,246813-5,Efetivo
Tarde,7º Ano B,Química,Lucas Dias,Terça,1,864209-1,Efetivo
Tarde,7º Ano B,Química,Lucas Dias,Terça,2,864209-1,Efetivo
Tarde,7º Ano B,Geografia,Beatriz Menta,Terça,3,246813-5,Efetivo
Tarde,7º Ano B,Português,Marcos Castro,Terça,4,765432-1,Designado
Tarde,7º Ano B,Educação Física,Roberto Souza,Terça,5,135792-4,Efetivo
Tarde,8º Ano C,Matemática,Ana Paula Silva,Terça,1,123456-7,Efetivo
Tarde,8º Ano C,Matemática,Ana Paula Silva,Terça,2,123456-7,Efetivo
Tarde,8º Ano C,Geografia,Beatriz Menta,Terça,3,246813-5,Efetivo
Tarde,8º Ano C,Educação Física,Roberto Souza,Terça,4,135792-4,Efetivo
Tarde,8º Ano C,Português,Marcos Castro,Terça,5,765432-1,Designado
Tarde,6º Ano A,Geografia,Beatriz Menta,Quarta,1,246813-5,Efetivo
Tarde,6º Ano A,Educação Física,Roberto Souza,Quarta,2,135792-4,Efetivo
Tarde,6º Ano A,Português,Marcos Castro,Quarta,3,765432-1,Designado
Tarde,6º Ano A,Química,Lucas Dias,Quarta,4,864209-1,Efetivo
Tarde,6º Ano A,Matemática,Ana Paula Silva,Quarta,5,123456-7,Efetivo
Tarde,7º Ano B,Matemática,Ana Paula Silva,Quarta,1,123456-7,Efetivo
Tarde,7º Ano B,Química,Lucas Dias,Quarta,2,864209-1,Efetivo
Tarde,7º Ano B,Português,Marcos Castro,Quarta,3,765432-1,Designado
Tarde,7º Ano B,Geografia,Beatriz Menta,Quarta,4,246813-5,Efetivo
Tarde,7º Ano B,Educação Física,Roberto Souza,Quarta,5,135792-4,Efetivo
Tarde,8º Ano C,Química,Lucas Dias,Quarta,1,864209-1,Efetivo
Tarde,8º Ano C,Educação Física,Roberto Souza,Quarta,2,135792-4,Efetivo
Tarde,8º Ano C,Matemática,Ana Paula Silva,Quarta,3,123456-7,Efetivo
Tarde,8º Ano C,Português,Marcos Castro,Quarta,4,765432-1,Designado
Tarde,8º Ano C,Geografia,Beatriz Menta,Quarta,5,246813-5,Efetivo
Tarde,6º Ano A,Matemática,Ana Paula Silva,Quinta,1,123456-7,Efetivo
Tarde,6º Ano A,Matemática,Ana Paula Silva,Quinta,2,123456-7,Efetivo
Tarde,6º Ano A,Português,Marcos Castro,Quinta,3,765432-1,Designado
Tarde,6º Ano A,Educação Física,Roberto Souza,Quinta,4,135792-4,Efetivo
Tarde,6º Ano A,Geografia,Beatriz Menta,Quinta,5,246813-5,Efetivo
Tarde,7º Ano B,Educação Física,Roberto Souza,Quinta,1,135792-4,Efetivo
Tarde,7º Ano B,Geografia,Beatriz Menta,Quinta,2,246813-5,Efetivo
Tarde,7º Ano B,Matemática,Ana Paula Silva,Quinta,3,123456-7,Efetivo
Tarde,7º Ano B,Matemática,Ana Paula Silva,Quinta,4,123456-7,Efetivo
Tarde,7º Ano B,Português,Marcos Castro,Quinta,5,765432-1,Designado
Tarde,8º Ano C,Português,Marcos Castro,Quinta,1,765432-1,Designado
Tarde,8º Ano C,Química,Lucas Dias,Quinta,2,864209-1,Efetivo
Tarde,8º Ano C,Química,Lucas Dias,Quinta,3,864209-1,Efetivo
Tarde,8º Ano C,Educação Física,Roberto Souza,Quinta,4,135792-4,Efetivo
Tarde,8º Ano C,Geografia,Beatriz Menta,Quinta,5,246813-5,Efetivo
Tarde,6º Ano A,Química,Lucas Dias,Sexta,1,864209-1,Efetivo
Tarde,6º Ano A,Química,Lucas Dias,Sexta,2,864209-1,Efetivo
Tarde,6º Ano A,Educação Física,Roberto Souza,Sexta,3,135792-4,Efetivo
Tarde,6º Ano A,Português,Marcos Castro,Sexta,4,765432-1,Designado
Tarde,6º Ano A,Geografia,Beatriz Menta,Sexta,5,246813-5,Efetivo
Tarde,7º Ano B,Português,Marcos Castro,Sexta,1,765432-1,Designado
Tarde,7º Ano B,Educação Física,Roberto Souza,Sexta,2,135792-4,Efetivo
Tarde,7º Ano B,Química,Lucas Dias,Sexta,3,864209-1,Efetivo
Tarde,7º Ano B,Química,Lucas Dias,Sexta,4,864209-1,Efetivo
Tarde,7º Ano B,Geografia,Beatriz Menta,Sexta,5,246813-5,Efetivo
Tarde,8º Ano C,Geografia,Beatriz Menta,Sexta,1,246813-5,Efetivo
Tarde,8º Ano C,Matemática,Ana Paula Silva,Sexta,2,123456-7,Efetivo
Tarde,8º Ano C,Matemática,Ana Paula Silva,Sexta,3,123456-7,Efetivo
Tarde,8º Ano C,Educação Física,Roberto Souza,Sexta,4,135792-4,Efetivo
Tarde,8º Ano C,Português,Marcos Castro,Sexta,5,765432-1,Designado`;

