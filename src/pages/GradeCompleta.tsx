import { useMemo, Fragment, useEffect, useState } from "react";
import { useTurmas, useProfessores, useDisciplinas, useAlocacoes, useConfiguracaoHorarios, useNomeEscola } from "@/store";
import { generateTimeSlotsForTurno } from "@/lib/schedule-utils";
import { Button } from "@/components/ui/button";
import { Printer, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import type { Alocacao } from "@/types";

const DIAS = ["segunda", "terca", "quarta", "quinta", "sexta"] as const;
type Dia = typeof DIAS[number];

const DIA_LABELS: Record<Dia, string> = {
  segunda: "Segunda-feira",
  terca: "Terça-feira",
  quarta: "Quarta-feira",
  quinta: "Quinta-feira",
  sexta: "Sexta-feira",
};

const DIA_SHORT: Record<Dia, string> = {
  segunda: "Seg", terca: "Ter", quarta: "Qua", quinta: "Qui", sexta: "Sex",
};

function shortTurma(nome: string): string {
  return nome.replace(/º\s*/g, "").replace(/\s*-\s*/g, "-").replace(/\s+EM\s*/gi, "EM").replace(/\s+Ano\s*/gi, "").trim();
}

export default function GradeCompleta() {
  const [turmas]      = useTurmas();
  const [professores] = useProfessores();
  const [disciplinas] = useDisciplinas();
  const [alocacoes]   = useAlocacoes();
  const [config]      = useConfiguracaoHorarios();
  const [nomeEscola]  = useNomeEscola();

  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);

  const handleDownloadPDF = async () => {
    const element = document.getElementById("grade-completa-pdf-content");
    if (!element) return;
    setIsGeneratingPDF(true);

    const styleTags = Array.from(document.querySelectorAll("style"));
    const originalStyles = styleTags.map((tag) => ({
      tag,
      originalText: tag.textContent || ""
    }));

    try {
      const oklchToRgb = (l: number, c: number, h: number): [number, number, number] => {
        const l_ = l;
        const lab_a = c * Math.cos((h * Math.PI) / 180);
        const lab_b = c * Math.sin((h * Math.PI) / 180);

        const l_cube = (l_ + 0.3963377774 * lab_a + 0.2158037573 * lab_b) ** 3;
        const m_cube = (l_ - 0.1055613458 * lab_a - 0.0638541728 * lab_b) ** 3;
        const s_cube = (l_ - 0.0894841775 * lab_a - 1.291485548 * lab_b) ** 3;

        const x = +4.0767416621 * l_cube - 3.3077115913 * m_cube + 0.2309699292 * s_cube;
        const y = -1.2684380046 * l_cube + 2.6097574011 * m_cube - 0.3413193965 * s_cube;
        const z = -0.0041960863 * l_cube - 0.7034186147 * m_cube + 1.7076147010 * s_cube;

        let rLinear = +3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
        let gLinear = -0.9692660 * x + 1.8760108 * y + 0.0415560 * z;
        let bLinear = +0.0556434 * x - 0.2040259 * y + 1.0572252 * z;

        const gamma = (val: number) => {
          return val <= 0.0031308 ? 12.92 * val : 1.055 * Math.pow(val, 1 / 2.4) - 0.055;
        };

        const r = Math.round(Math.max(0, Math.min(1, gamma(rLinear))) * 255);
        const g = Math.round(Math.max(0, Math.min(1, gamma(gLinear))) * 255);
        const b = Math.round(Math.max(0, Math.min(1, gamma(bLinear))) * 255);

        return [r, g, b];
      };

      const replaceOklchInStyleText = (cssText: string): string => {
        const oklchRegex = /oklch\s*\(\s*([0-9.]+%?)\s+([0-9.]+)\s+([0-9.]+)(?:\s*\/\s*([0-9.]+%?))?\s*\)/gi;
        return cssText.replace(oklchRegex, (match, p1, p2, p3, p4) => {
          try {
            let l = parseFloat(p1);
            if (p1.endsWith("%")) {
              l = l / 100;
            }
            const c = parseFloat(p2);
            const h = parseFloat(p3);

            const [r, g, b] = oklchToRgb(l, c, h);

            if (p4) {
              let a = parseFloat(p4);
              if (p4.endsWith("%")) {
                a = a / 100;
              }
              return `rgba(${r}, ${g}, ${b}, ${a})`;
            } else {
              return `rgb(${r}, ${g}, ${b})`;
            }
          } catch (err) {
            return "rgb(120, 120, 120)";
          }
        });
      };

      styleTags.forEach((tag) => {
        if (tag.textContent && tag.textContent.includes("oklch")) {
          tag.textContent = replaceOklchInStyleText(tag.textContent);
        }
      });

      const html2pdfModule = await import("html2pdf.js");
      const html2pdf = html2pdfModule.default;

      element.classList.add("js-pdf-active");

      const opt = {
        margin:       [8, 8, 8, 8],
        filename:     `horario_completo_${nomeEscola ? nomeEscola.toLowerCase().replace(/[^a-z0-9]+/g, "_") : "escola"}.pdf`,
        image:        { type: "jpeg", quality: 0.98 },
        html2canvas:  { 
          scale: 2, 
          useCORS: true, 
          logging: false,
          backgroundColor: "#ffffff",
          windowWidth: 1120,
          width: 1120
        },
        jsPDF:        { unit: "mm", format: "a4", orientation: "landscape" },
        pagebreak:    { mode: ["avoid-all", "css"] }
      };

      await html2pdf().set(opt).from(element).save();
    } catch (err) {
      console.error("Erro ao gerar PDF:", err);
    } finally {
      originalStyles.forEach(({ tag, originalText }) => {
        tag.textContent = originalText;
      });
      element.classList.remove("js-pdf-active");
      setIsGeneratingPDF(false);
    }
  };

  // ── Slot generation ────────────────────────────────────────────────────────
  const manhaSlots = useMemo(() => generateTimeSlotsForTurno(config, "manha"), [config]);
  const tardeSlots = useMemo(
    () => config.habilitarTarde ? generateTimeSlotsForTurno(config, "tarde") : [],
    [config]
  );
  const noiteSlots = useMemo(
    () => config.habilitarNoite ? generateTimeSlotsForTurno(config, "noite") : [],
    [config]
  );

  const manhaPeriods = useMemo(() => manhaSlots.filter((s) => !s.isBreak), [manhaSlots]);
  const tardePeriods = useMemo(() => tardeSlots.filter((s) => !s.isBreak), [tardeSlots]);
  const noitePeriods = useMemo(() => noiteSlots.filter((s) => !s.isBreak), [noiteSlots]);
  const manhaBreak   = useMemo(() => manhaSlots.find((s) => s.isBreak), [manhaSlots]);
  const tardeBreak   = useMemo(() => tardeSlots.find((s) => s.isBreak), [tardeSlots]);
  const noiteBreak   = useMemo(() => noiteSlots.find((s) => s.isBreak), [noiteSlots]);

  const manhaBreakAfter = config.possuiIntervalo      ? config.horarioIntervalo      : null;
  const tardeBreakAfter = config.possuiIntervaloTarde  ? config.horarioIntervaloTarde  : null;
  const noiteBreakAfter = config.possuiIntervaloNoite  ? config.horarioIntervaloNoite  : null;

  // ── Turma grouping ─────────────────────────────────────────────────────────
  const manhaTurmas = useMemo(
    () => [...turmas].filter((t) => !t.turno || t.turno === "manha").sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [turmas]
  );
  const tardeTurmas = useMemo(
    () => [...turmas].filter((t) => t.turno === "tarde").sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [turmas]
  );
  const noiteTurmas = useMemo(
    () => [...turmas].filter((t) => t.turno === "noite").sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [turmas]
  );
  const profsOrdenados = useMemo(
    () => [...professores].sort((a, b) => a.nomeCompleto.localeCompare(b.nomeCompleto, "pt-BR")),
    [professores]
  );

  const hasTarde = config.habilitarTarde && tardeTurmas.length > 0;
  const hasNoite = config.habilitarNoite && noiteTurmas.length > 0;

  // Cache lookups in a map to achieve O(1) access instead of O(N) filters on every cellular render tick
  const alocacoesMap = useMemo(() => {
    const map = new Map<string, Alocacao[]>();
    alocacoes.forEach((a) => {
      const key = `${a.diaSemana}-${a.horario}-${a.turmaId}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    });
    return map;
  }, [alocacoes]);

  const profAlocacoesMap = useMemo(() => {
    const map = new Map<string, Alocacao[]>();
    const turboTurmaMap = new Map(turmas.map((t) => [t.id, t.turno ?? "manha"]));
    alocacoes.forEach((a) => {
      const turno = turboTurmaMap.get(a.turmaId) ?? "manha";
      const key = `${a.professorId}-${a.diaSemana}-${a.horario}-${turno}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    });
    return map;
  }, [alocacoes, turmas]);

  function getCells(dia: Dia, period: number, turmaId: string) {
    return alocacoesMap.get(`${dia}-${period}-${turmaId}`) ?? [];
  }

  function getProfCells(profId: string, dia: Dia, period: number, turno: "manha" | "tarde" | "noite") {
    return profAlocacoesMap.get(`${profId}-${dia}-${period}-${turno}`) ?? [];
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("autoprint") !== "1") return;
    const timer = setTimeout(() => {
      handleDownloadPDF();
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  // ── Shared cell renderer ───────────────────────────────────────────────────
  function TurmaCell({ dia, period, turmaId }: { dia: Dia; period: number; turmaId: string }) {
    const cells = getCells(dia, period, turmaId);
    return (
      <td className="border border-gray-300 px-0.5 py-0.5 text-center align-middle" style={{ minWidth: 0 }}>
        {cells.length === 0 ? (
          <span className="text-gray-300 text-[9px]">—</span>
        ) : (
          <div className="space-y-0.5">
            {cells.map((aloc) => {
              const disc = disciplinas.find((d) => d.id === aloc.disciplinaId);
              const prof = professores.find((p) => p.id === aloc.professorId);
              const firstName = prof ? prof.nomeCompleto.split(" ")[0].toUpperCase() : "";
              return (
                <div key={aloc.id} className="leading-tight">
                  <span className="font-bold text-[9px]">{disc?.abreviacao ?? "?"}</span>
                  {" / "}
                  <span className="text-[9px]">{firstName}</span>
                </div>
              );
            })}
          </div>
        )}
      </td>
    );
  }

  // ── Shift grid renderer ────────────────────────────────────────────────────
  function ShiftGrid({
    turno,
    turmList,
    periods,
    breakSlot,
    breakAfter,
  }: {
    turno: "manha" | "tarde";
    turmList: typeof manhaTurmas;
    periods: typeof manhaPeriods;
    breakSlot: typeof manhaBreak;
    breakAfter: number | null;
  }) {
    const isManha = turno === "manha";
    const headerBg = "bg-blue-700 text-white";
    const subHeaderBg = "bg-blue-50 print:bg-blue-50";
    const label = isManha ? "☀ MATUTINO" : "☾ VESPERTINO";

    if (turmList.length === 0) return null;

    return (
      <>
        {/* Shift sub-header */}
        {hasTarde && (
          <div className={`${headerBg} text-center text-[10px] font-bold uppercase tracking-widest py-0.5 mt-1`}>
            {label}
          </div>
        )}
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full border-collapse text-[10px] leading-tight" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "80px" }} />
              {turmList.map((t) => <col key={t.id} />)}
            </colgroup>
            <thead>
              <tr className={subHeaderBg}>
                <th className="border border-gray-400 px-1 py-0.5 text-center font-bold text-[9px]">Horário</th>
                {turmList.map((t) => (
                  <th key={t.id} className="border border-gray-400 px-1 py-0.5 text-center font-bold text-[9px]">
                    {shortTurma(t.nome)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.map((slot, idx) => {
                const showBreak = breakAfter !== null && idx > 0 && periods[idx - 1].period === breakAfter;
                return (
                  <Fragment key={`${turno}-${slot.period}`}>
                    {showBreak && breakSlot && (
                      <tr className="bg-gray-50">
                        <td
                          colSpan={turmList.length + 1}
                          className="border border-gray-300 text-center text-[8px] font-semibold text-gray-500 italic py-0.5"
                        >
                          Intervalo {breakSlot.start} – {breakSlot.end}
                        </td>
                      </tr>
                    )}
                    <tr className="border-b border-gray-300">
                      <td className={`border border-gray-400 px-1 py-0.5 text-center align-middle ${subHeaderBg}`}>
                        <div className="font-mono text-[9px] font-semibold whitespace-nowrap">
                          {slot.start}–{slot.end}
                        </div>
                      </td>
                      {turmList.map((turma) => (
                        <TurmaCell key={turma.id} dia={DIAS[DIAS.indexOf(DIAS[0])]} period={slot.period} turmaId={turma.id} />
                      ))}
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-white text-black">
      {/* Screen-only toolbar */}
      <div className="print:hidden sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between gap-4 justify-items-center">
        <div className="flex items-center gap-3">
          <Link href="/grade">
            <Button variant="outline" size="sm">
              <ArrowLeft className="w-4 h-4 mr-1.5" />
              Voltar
            </Button>
          </Link>
          <span className="text-sm font-semibold text-gray-700">Horário Completo — {nomeEscola}</span>
          {(hasTarde || hasNoite) && (
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
              {["Matutino", hasTarde && "Vespertino", hasNoite && "Noturno"].filter(Boolean).join(" + ")}
            </span>
          )}

          <div className="h-4 w-px bg-gray-200 mx-1" />

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-gray-550">Visualizar Turma:</span>
            <select
              onChange={(e) => {
                if (e.target.value) {
                  window.location.hash = `/grade?turmaId=${e.target.value}`;
                }
              }}
              defaultValue=""
              className="h-8 text-xs bg-slate-50 border border-gray-200 rounded-md px-2 outline-none cursor-pointer hover:bg-slate-100 transition-all font-semibold text-gray-700"
            >
              <option value="" disabled>Selecione...</option>
              {turmas.map((t) => (
                <option key={t.id} value={t.id}>{t.nome}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            onClick={handleDownloadPDF} 
            disabled={isGeneratingPDF} 
            size="sm" 
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium animate-pulse-once"
          >
            <Printer className="w-4 h-4 mr-1.5" />
            {isGeneratingPDF ? "Gerando PDF..." : "Baixar PDF (Otimizado A4)"}
          </Button>
          <Button onClick={() => window.print()} variant="outline" size="sm" className="font-medium">
            Imprimir via Navegador
          </Button>
        </div>
      </div>

      <div id="grade-completa-pdf-content" className="px-4 py-4 print:px-0 print:py-0 bg-white">
        {/* Document header */}
        <div className="text-center mb-4 border-b-2 border-black pb-2">
          <p className="text-base font-extrabold uppercase tracking-widest leading-tight">{nomeEscola || "ESCOLA MUNICIPAL"}</p>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-600 mt-0.5">
            Horário de Aulas
            {[" — Turnos:", hasTarde || hasNoite ? null : " Matutino"].filter(Boolean).join("")}
            {!(hasTarde || hasNoite) ? null : [" Matutino", hasTarde && " + Vespertino", hasNoite && " + Noturno"].filter(Boolean).join("")}
            {" — Ano Letivo "}{new Date().getFullYear()}
          </p>
        </div>

        {/* ─── Grade por dia ─── */}
        {DIAS.map((dia) => (
          <div key={dia} className="mb-6 day-container border border-gray-200 p-4 rounded-lg bg-white" style={{ breakInside: "avoid", pageBreakInside: "avoid" }}>
            {/* Day header */}
            <div
              className="bg-gray-800 text-white text-center text-[11px] font-bold uppercase tracking-widest py-1 print:py-0.5"
              style={{ breakAfter: "avoid", breakBefore: "auto" }}
            >
              {DIA_LABELS[dia]}
            </div>

            {/* Matutino grid */}
            {manhaTurmas.length > 0 && (
              <>
                {(hasTarde || hasNoite) && (
                  <div className="bg-blue-700 text-white text-center text-[9px] font-bold uppercase tracking-widest py-0.5">
                    ☀ MATUTINO
                  </div>
                )}
                <div className="overflow-x-auto print:overflow-visible">
                  <table className="w-full border-collapse text-[10px] leading-tight" style={{ tableLayout: "fixed" }}>
                    <colgroup>
                      <col style={{ width: "80px" }} />
                      {manhaTurmas.map((t) => <col key={t.id} />)}
                    </colgroup>
                    <thead>
                      <tr className="bg-blue-50 print:bg-blue-50">
                        <th className="border border-gray-400 px-1 py-0.5 text-center font-bold text-[9px]">Horário</th>
                        {manhaTurmas.map((t) => (
                          <th key={t.id} className="border border-gray-400 px-1 py-0.5 text-center font-bold text-[9px]">
                            {shortTurma(t.nome)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {manhaPeriods.map((slot, idx) => {
                        const showBreak = manhaBreakAfter !== null && idx > 0 && manhaPeriods[idx - 1].period === manhaBreakAfter;
                        return (
                          <Fragment key={`manha-${dia}-${slot.period}`}>
                            {showBreak && manhaBreak && (
                              <tr className="bg-gray-50">
                                <td colSpan={manhaTurmas.length + 1} className="border border-gray-300 text-center text-[8px] font-semibold text-gray-500 italic py-0.5">
                                  Intervalo {manhaBreak.start} – {manhaBreak.end}
                                </td>
                              </tr>
                            )}
                            <tr className="border-b border-gray-300">
                              <td className="border border-gray-400 px-1 py-0.5 text-center align-middle bg-blue-50 print:bg-blue-50">
                                <div className="font-mono text-[9px] font-semibold whitespace-nowrap">{slot.start}–{slot.end}</div>
                              </td>
                              {manhaTurmas.map((turma) => {
                                const cells = getCells(dia, slot.period, turma.id);
                                return (
                                  <td key={turma.id} className="border border-gray-300 px-0.5 py-0.5 text-center align-middle" style={{ minWidth: 0 }}>
                                    {cells.length === 0 ? (
                                      <span className="text-gray-300 text-[9px]">—</span>
                                    ) : (
                                      <div className="space-y-0.5">
                                        {cells.map((aloc) => {
                                          const disc = disciplinas.find((d) => d.id === aloc.disciplinaId);
                                          const prof = professores.find((p) => p.id === aloc.professorId);
                                          return (
                                            <div key={aloc.id} className="leading-tight">
                                              <span className="font-bold text-[9px]">{disc?.abreviacao ?? "?"}</span>
                                              {" / "}
                                              <span className="text-[9px]">{prof ? prof.nomeCompleto.split(" ")[0].toUpperCase() : ""}</span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* Noturno grid */}
            {hasNoite && noiteTurmas.length > 0 && (
              <>
                <div className="bg-purple-700 text-white text-center text-[9px] font-bold uppercase tracking-widest py-0.5 mt-0.5">
                  🌙 NOTURNO
                </div>
                <div className="overflow-x-auto print:overflow-visible">
                  <table className="w-full border-collapse text-[10px] leading-tight" style={{ tableLayout: "fixed" }}>
                    <colgroup>
                      <col style={{ width: "80px" }} />
                      {noiteTurmas.map((t) => <col key={t.id} />)}
                    </colgroup>
                    <thead>
                      <tr className="bg-purple-50 print:bg-purple-50">
                        <th className="border border-gray-400 px-1 py-0.5 text-center font-bold text-[9px]">Horário</th>
                        {noiteTurmas.map((t) => (
                          <th key={t.id} className="border border-gray-400 px-1 py-0.5 text-center font-bold text-[9px]">
                            {shortTurma(t.nome)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {noitePeriods.map((slot, idx) => {
                        const showBreak = noiteBreakAfter !== null && idx > 0 && noitePeriods[idx - 1].period === noiteBreakAfter;
                        return (
                          <Fragment key={`noite-${dia}-${slot.period}`}>
                            {showBreak && noiteBreak && (
                              <tr className="bg-gray-50">
                                <td colSpan={noiteTurmas.length + 1} className="border border-gray-300 text-center text-[8px] font-semibold text-gray-500 italic py-0.5">
                                  Intervalo {noiteBreak.start} – {noiteBreak.end}
                                </td>
                              </tr>
                            )}
                            <tr className="border-b border-gray-300">
                              <td className="border border-gray-400 px-1 py-0.5 text-center align-middle bg-purple-50 print:bg-purple-50">
                                <div className="font-mono text-[9px] font-semibold whitespace-nowrap">{slot.start}–{slot.end}</div>
                              </td>
                              {noiteTurmas.map((turma) => {
                                const cells = getCells(dia, slot.period, turma.id);
                                return (
                                  <td key={turma.id} className="border border-gray-300 px-0.5 py-0.5 text-center align-middle" style={{ minWidth: 0 }}>
                                    {cells.length === 0 ? (
                                      <span className="text-gray-300 text-[9px]">—</span>
                                    ) : (
                                      <div className="space-y-0.5">
                                        {cells.map((aloc) => {
                                          const disc = disciplinas.find((d) => d.id === aloc.disciplinaId);
                                          const prof = professores.find((p) => p.id === aloc.professorId);
                                          return (
                                            <div key={aloc.id} className="leading-tight">
                                              <span className="font-bold text-[9px]">{disc?.abreviacao ?? "?"}</span>
                                              {" / "}
                                              <span className="text-[9px]">{prof ? prof.nomeCompleto.split(" ")[0].toUpperCase() : ""}</span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* Vespertino grid */}
            {hasTarde && tardeTurmas.length > 0 && (
              <>
                <div className="bg-blue-700 text-white text-center text-[9px] font-bold uppercase tracking-widest py-0.5 mt-0.5">
                  🌅 VESPERTINO
                </div>
                <div className="overflow-x-auto print:overflow-visible">
                  <table className="w-full border-collapse text-[10px] leading-tight" style={{ tableLayout: "fixed" }}>
                    <colgroup>
                      <col style={{ width: "80px" }} />
                      {tardeTurmas.map((t) => <col key={t.id} />)}
                    </colgroup>
                    <thead>
                      <tr className="bg-blue-50 print:bg-blue-50">
                        <th className="border border-gray-400 px-1 py-0.5 text-center font-bold text-[9px]">Horário</th>
                        {tardeTurmas.map((t) => (
                          <th key={t.id} className="border border-gray-400 px-1 py-0.5 text-center font-bold text-[9px]">
                            {shortTurma(t.nome)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tardePeriods.map((slot, idx) => {
                        const showBreak = tardeBreakAfter !== null && idx > 0 && tardePeriods[idx - 1].period === tardeBreakAfter;
                        return (
                          <Fragment key={`tarde-${dia}-${slot.period}`}>
                            {showBreak && tardeBreak && (
                              <tr className="bg-gray-50">
                                <td colSpan={tardeTurmas.length + 1} className="border border-gray-300 text-center text-[8px] font-semibold text-gray-500 italic py-0.5">
                                  Intervalo {tardeBreak.start} – {tardeBreak.end}
                                </td>
                              </tr>
                            )}
                            <tr className="border-b border-gray-300">
                              <td className="border border-gray-400 px-1 py-0.5 text-center align-middle bg-blue-50 print:bg-blue-50">
                                <div className="font-mono text-[9px] font-semibold whitespace-nowrap">{slot.start}–{slot.end}</div>
                              </td>
                              {tardeTurmas.map((turma) => {
                                const cells = getCells(dia, slot.period, turma.id);
                                return (
                                  <td key={turma.id} className="border border-gray-300 px-0.5 py-0.5 text-center align-middle" style={{ minWidth: 0 }}>
                                    {cells.length === 0 ? (
                                      <span className="text-gray-300 text-[9px]">—</span>
                                    ) : (
                                      <div className="space-y-0.5">
                                        {cells.map((aloc) => {
                                          const disc = disciplinas.find((d) => d.id === aloc.disciplinaId);
                                          const prof = professores.find((p) => p.id === aloc.professorId);
                                          return (
                                            <div key={aloc.id} className="leading-tight">
                                              <span className="font-bold text-[9px]">{disc?.abreviacao ?? "?"}</span>
                                              {" / "}
                                              <span className="text-[9px]">{prof ? prof.nomeCompleto.split(" ")[0].toUpperCase() : ""}</span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        ))}

        {/* ─── Grade por Professor ─── */}
        {profsOrdenados.length > 0 && (
          <div className="mt-6 print:mt-4">
            <div className="border-t-2 border-b border-gray-800 mb-3 py-1 text-center">
              <p className="text-[11px] font-extrabold uppercase tracking-widest">Grade por Professor</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3 gap-3">
              {profsOrdenados.map((prof) => {
                const profAlocs = alocacoes.filter((a) => a.professorId === prof.id);
                if (profAlocs.length === 0) return null;

                const profTurmas = new Set(profAlocs.map((a) => turmas.find((t) => t.id === a.turmaId)?.turno ?? "manha"));
                const hasManhaAlocs = profTurmas.has("manha");
                const hasTardeAlocs = profTurmas.has("tarde") && config.habilitarTarde;
                const hasNoiteAlocs = profTurmas.has("noite") && config.habilitarNoite;

                return (
                  <div key={prof.id} className="border border-gray-400 break-inside-avoid print:break-inside-avoid">
                    <div className="bg-gray-200 border-b border-gray-400 px-1 py-0.5 text-center">
                      <p className="text-[9px] font-bold uppercase tracking-wide">{prof.nomeCompleto.toUpperCase()}</p>
                      <p className="text-[7px] text-gray-500">
                        {[hasManhaAlocs && "Matutino", hasTardeAlocs && "Vespertino", hasNoiteAlocs && "Noturno"].filter(Boolean).join(" + ")}
                      </p>
                    </div>

                    {/* Manha sub-table */}
                    {hasManhaAlocs && (
                      <>
                        {hasTardeAlocs && (
                          <div className="bg-blue-100 text-blue-800 text-center text-[7px] font-bold py-0.5">☀ MATUTINO</div>
                        )}
                        <table className="w-full border-collapse text-[8px]">
                          <thead>
                            <tr className="bg-gray-50">
                              <th className="border border-gray-300 px-0.5 py-0.5 text-center font-semibold text-[8px]">#</th>
                              {DIAS.map((d) => <th key={d} className="border border-gray-300 px-0.5 py-0.5 text-center font-semibold text-[8px]">{DIA_SHORT[d]}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {manhaPeriods.map((slot, idx) => {
                              const showBreak = manhaBreakAfter !== null && idx > 0 && manhaPeriods[idx - 1].period === manhaBreakAfter;
                              return (
                                <Fragment key={`prof-manha-${prof.id}-${slot.period}`}>
                                  {showBreak && <tr><td colSpan={6} className="border border-gray-200 text-center text-[7px] text-gray-400 italic py-0.5 bg-gray-50">Intervalo</td></tr>}
                                  <tr>
                                    <td className="border border-gray-300 px-0.5 py-0.5 text-center font-mono text-[7px] bg-gray-50 whitespace-nowrap">{slot.start}</td>
                                    {DIAS.map((dia) => {
                                      const cells = getProfCells(prof.id, dia, slot.period, "manha");
                                      return (
                                        <td key={dia} className="border border-gray-300 px-0.5 py-0.5 text-center">
                                          {cells.length === 0 ? <span className="text-gray-300">__</span> : cells.map((aloc) => {
                                            const turma = turmas.find((t) => t.id === aloc.turmaId);
                                            const disc  = disciplinas.find((d) => d.id === aloc.disciplinaId);
                                            return <div key={aloc.id} className="leading-tight"><span className="font-semibold">{shortTurma(turma?.nome ?? "")}</span><span className="text-gray-500"> ({disc?.abreviacao ?? "?"})</span></div>;
                                          })}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </>
                    )}

                    {/* Tarde sub-table */}
                    {hasTardeAlocs && (
                      <>
                        <div className="bg-blue-100 text-blue-800 text-center text-[7px] font-bold py-0.5">🌅 VESPERTINO</div>
                        <table className="w-full border-collapse text-[8px]">
                          <thead>
                            <tr className="bg-gray-50">
                              <th className="border border-gray-300 px-0.5 py-0.5 text-center font-semibold text-[8px]">#</th>
                              {DIAS.map((d) => <th key={d} className="border border-gray-300 px-0.5 py-0.5 text-center font-semibold text-[8px]">{DIA_SHORT[d]}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {tardePeriods.map((slot, idx) => {
                              const showBreak = tardeBreakAfter !== null && idx > 0 && tardePeriods[idx - 1].period === tardeBreakAfter;
                              return (
                                <Fragment key={`prof-tarde-${prof.id}-${slot.period}`}>
                                  {showBreak && <tr><td colSpan={6} className="border border-gray-200 text-center text-[7px] text-gray-400 italic py-0.5 bg-gray-50">Intervalo</td></tr>}
                                  <tr>
                                    <td className="border border-gray-300 px-0.5 py-0.5 text-center font-mono text-[7px] bg-gray-50 whitespace-nowrap">{slot.start}</td>
                                    {DIAS.map((dia) => {
                                      const cells = getProfCells(prof.id, dia, slot.period, "tarde");
                                      return (
                                        <td key={dia} className="border border-gray-300 px-0.5 py-0.5 text-center">
                                          {cells.length === 0 ? <span className="text-gray-300">__</span> : cells.map((aloc) => {
                                            const turma = turmas.find((t) => t.id === aloc.turmaId);
                                            const disc  = disciplinas.find((d) => d.id === aloc.disciplinaId);
                                            return <div key={aloc.id} className="leading-tight"><span className="font-semibold">{shortTurma(turma?.nome ?? "")}</span><span className="text-gray-500"> ({disc?.abreviacao ?? "?"})</span></div>;
                                          })}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </>
                    )}

                    {/* Noite sub-table */}
                    {hasNoiteAlocs && (
                      <>
                        <div className="bg-purple-100 text-purple-800 text-center text-[7px] font-bold py-0.5">🌙 NOTURNO</div>
                        <table className="w-full border-collapse text-[8px]">
                          <thead>
                            <tr className="bg-gray-50">
                              <th className="border border-gray-300 px-0.5 py-0.5 text-center font-semibold text-[8px]">#</th>
                              {DIAS.map((d) => <th key={d} className="border border-gray-300 px-0.5 py-0.5 text-center font-semibold text-[8px]">{DIA_SHORT[d]}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {noitePeriods.map((slot, idx) => {
                              const showBreak = noiteBreakAfter !== null && idx > 0 && noitePeriods[idx - 1].period === noiteBreakAfter;
                              return (
                                <Fragment key={`prof-noite-${prof.id}-${slot.period}`}>
                                  {showBreak && <tr><td colSpan={6} className="border border-gray-200 text-center text-[7px] text-gray-400 italic py-0.5 bg-gray-50">Intervalo</td></tr>}
                                  <tr>
                                    <td className="border border-gray-300 px-0.5 py-0.5 text-center font-mono text-[7px] bg-gray-50 whitespace-nowrap">{slot.start}</td>
                                    {DIAS.map((dia) => {
                                      const cells = getProfCells(prof.id, dia, slot.period, "noite");
                                      return (
                                        <td key={dia} className="border border-gray-300 px-0.5 py-0.5 text-center">
                                          {cells.length === 0 ? <span className="text-gray-300">__</span> : cells.map((aloc) => {
                                            const turma = turmas.find((t) => t.id === aloc.turmaId);
                                            const disc  = disciplinas.find((d) => d.id === aloc.disciplinaId);
                                            return <div key={aloc.id} className="leading-tight"><span className="font-semibold">{shortTurma(turma?.nome ?? "")}</span><span className="text-gray-500"> ({disc?.abreviacao ?? "?"})</span></div>;
                                          })}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="hidden print:block mt-6 pt-2 border-t border-gray-300 text-center text-[8px] text-gray-500">
          <p>{nomeEscola} — Horário Provisório — Gerado automaticamente pelo EduHorários</p>
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 8mm; }
          body { 
            -webkit-print-color-adjust: exact; 
            print-color-adjust: exact; 
            background-color: white !important;
          }
          .day-container {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
            margin-bottom: 24px !important;
            border: 1px solid #d1d5db !important;
            padding: 12px !important;
          }
          .break-inside-avoid {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
          /* Prevent standard browser print overflows by making cells and font slightly smaller */
          table {
            font-size: 8px !important;
            width: 100% !important;
          }
          td, th {
            padding: 2px 1px !important;
          }
        }

        /* Classes e Estilos para Baixar PDF via html2pdf com Escala e Ajustes A4 perfeitos */
        #grade-completa-pdf-content.js-pdf-active {
          width: 1120px !important;
          max-width: none !important;
          min-width: 1120px !important;
          padding: 15px !important;
          margin: 0 !important;
          background-color: white !important;
          box-sizing: border-box !important;
          transform: none !important;
          zoom: normal !important;
          display: block !important;
        }
        #grade-completa-pdf-content.js-pdf-active .day-container {
          break-inside: avoid !important;
          page-break-inside: avoid !important;
          margin-bottom: 20px !important;
          border: 1px solid #d1d5db !important;
          border-radius: 8px !important;
          padding: 14px !important;
          background-color: white !important;
          width: 100% !important;
          max-width: none !important;
          min-width: 0 !important;
          box-sizing: border-box !important;
          transform: none !important;
        }
        #grade-completa-pdf-content.js-pdf-active table {
          font-size: 8px !important;
          width: 100% !important;
          min-width: 100% !important;
          max-width: 100% !important;
          table-layout: auto !important;
          border-collapse: collapse !important;
        }
        #grade-completa-pdf-content.js-pdf-active td, #grade-completa-pdf-content.js-pdf-active th {
          padding: 1.5px 1px !important;
          word-wrap: break-word !important;
          word-break: break-all !important;
        }
      `}</style>
    </div>
  );
}
