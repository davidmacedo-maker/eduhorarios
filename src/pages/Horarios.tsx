import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useConfiguracaoHorarios, useNomeEscola, useCodigoEscola } from "@/store";
import { generateTimeSlotsForTurno } from "@/lib/schedule-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Save, Clock, School, Check, Sun, Sunset, Moon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useEffect } from "react";
import { useState } from "react";

const configSchema = z.object({
  // Matutino
  quantidadeHorariosPorDia:  z.coerce.number().min(1).max(12),
  duracaoAulaMinutos:        z.coerce.number().min(15).max(120),
  horarioInicial:            z.string().regex(/^\d{2}:\d{2}$/, "Formato HH:MM"),
  possuiIntervalo:           z.boolean(),
  horarioIntervalo:          z.coerce.number().min(1).max(12),
  duracaoIntervaloMinutos:   z.coerce.number().min(5).max(60),
  // Vespertino
  habilitarTarde:                z.boolean(),
  horarioInicialTarde:           z.string().regex(/^\d{2}:\d{2}$/, "Formato HH:MM"),
  quantidadeHorariosPorDiaTarde: z.coerce.number().min(1).max(12),
  duracaoAulaMinutosTarde:       z.coerce.number().min(15).max(120),
  possuiIntervaloTarde:          z.boolean(),
  horarioIntervaloTarde:         z.coerce.number().min(1).max(12),
  duracaoIntervaloMinutosTarde:  z.coerce.number().min(5).max(60),
  // Noturno
  habilitarNoite:                z.boolean().default(false),
  horarioInicialNoite:           z.string().regex(/^\d{2}:\d{2}$/, "Formato HH:MM").default("19:00"),
  quantidadeHorariosPorDiaNoite: z.coerce.number().min(1).max(12).default(4),
  duracaoAulaMinutosNoite:       z.coerce.number().min(15).max(120).default(50),
  possuiIntervaloNoite:          z.boolean().default(false),
  horarioIntervaloNoite:         z.coerce.number().min(1).max(12).default(2),
  duracaoIntervaloMinutosNoite:  z.coerce.number().min(5).max(60).default(15),
});

type ConfigForm = z.infer<typeof configSchema>;

export default function Horarios() {
  const [config, setConfig] = useConfiguracaoHorarios();
  const [nomeEscola, setNomeEscola] = useNomeEscola();
  const [codigoEscola, setCodigoEscola] = useCodigoEscola();
  
  const [escolaTemp, setEscolaTemp] = useState(nomeEscola);
  const [codigoTemp, setCodigoTemp] = useState(codigoEscola);
  const [editingEscola, setEditingEscola] = useState(false);
  const { toast } = useToast();

  function salvarEscola() {
    setNomeEscola(escolaTemp.trim() || nomeEscola);
    setCodigoEscola(codigoTemp.trim());
    setEditingEscola(false);
    toast({ title: "Dados da escola salvos com sucesso" });
  }

  const form = useForm<ConfigForm>({
    resolver: zodResolver(configSchema),
    defaultValues: {
      quantidadeHorariosPorDia:    config.quantidadeHorariosPorDia    ?? 6,
      duracaoAulaMinutos:          config.duracaoAulaMinutos          ?? 50,
      horarioInicial:              config.horarioInicial              ?? "07:00",
      possuiIntervalo:             config.possuiIntervalo             ?? true,
      horarioIntervalo:            config.horarioIntervalo            ?? 3,
      duracaoIntervaloMinutos:     config.duracaoIntervaloMinutos     ?? 20,
      habilitarTarde:              config.habilitarTarde              ?? false,
      horarioInicialTarde:         config.horarioInicialTarde         ?? "13:00",
      quantidadeHorariosPorDiaTarde: config.quantidadeHorariosPorDiaTarde ?? 5,
      duracaoAulaMinutosTarde:     config.duracaoAulaMinutosTarde     ?? 50,
      possuiIntervaloTarde:        config.possuiIntervaloTarde        ?? true,
      horarioIntervaloTarde:       config.horarioIntervaloTarde       ?? 3,
      duracaoIntervaloMinutosTarde: config.duracaoIntervaloMinutosTarde ?? 15,
      habilitarNoite:              config.habilitarNoite              ?? false,
      horarioInicialNoite:         config.horarioInicialNoite         ?? "19:00",
      quantidadeHorariosPorDiaNoite: config.quantidadeHorariosPorDiaNoite ?? 4,
      duracaoAulaMinutosNoite:     config.duracaoAulaMinutosNoite     ?? 50,
      possuiIntervaloNoite:        config.possuiIntervaloNoite        ?? false,
      horarioIntervaloNoite:       config.horarioIntervaloNoite       ?? 2,
      duracaoIntervaloMinutosNoite: config.duracaoIntervaloMinutosNoite ?? 15,
    },
  });

  useEffect(() => {
    form.reset({ ...form.getValues(), ...config });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const w = form.watch();

  const previewManha = (() => {
    try { return generateTimeSlotsForTurno({ ...w, quantidadeHorariosPorDia: Number(w.quantidadeHorariosPorDia) || 6, duracaoAulaMinutos: Number(w.duracaoAulaMinutos) || 50, horarioIntervalo: Number(w.horarioIntervalo) || 3, duracaoIntervaloMinutos: Number(w.duracaoIntervaloMinutos) || 20 } as ConfigForm, "manha"); }
    catch { return []; }
  })();

  const previewTarde = w.habilitarTarde ? (() => {
    try { return generateTimeSlotsForTurno({ ...w, quantidadeHorariosPorDiaTarde: Number(w.quantidadeHorariosPorDiaTarde) || 5, duracaoAulaMinutosTarde: Number(w.duracaoAulaMinutosTarde) || 50, horarioIntervaloTarde: Number(w.horarioIntervaloTarde) || 3, duracaoIntervaloMinutosTarde: Number(w.duracaoIntervaloMinutosTarde) || 15 } as ConfigForm, "tarde"); }
    catch { return []; }
  })() : [];

  const previewNoite = w.habilitarNoite ? (() => {
    try { return generateTimeSlotsForTurno({ ...w, quantidadeHorariosPorDiaNoite: Number(w.quantidadeHorariosPorDiaNoite) || 4, duracaoAulaMinutosNoite: Number(w.duracaoAulaMinutosNoite) || 50, horarioIntervaloNoite: Number(w.horarioIntervaloNoite) || 2, duracaoIntervaloMinutosNoite: Number(w.duracaoIntervaloMinutosNoite) || 15 } as ConfigForm, "noite"); }
    catch { return []; }
  })() : [];

  function onSubmit(data: ConfigForm) {
    setConfig(data);
    const turnos = ["Matutino", data.habilitarTarde && "Vespertino", data.habilitarNoite && "Noturno"].filter(Boolean).join(", ");
    toast({ title: "Configuração salva com sucesso", description: `${turnos} configurados.` });
  }

  function SlotPreview({ slots, turno }: { slots: typeof previewManha; turno: "manha" | "tarde" | "noite" }) {
    return (
      <div className="space-y-1.5">
        {slots.map((slot, i) => (
          <div
            key={i}
            className={`flex items-center justify-between px-3 py-2 rounded-md text-sm ${
              slot.isBreak
                ? "bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300"
                : turno === "noite"
                  ? "bg-purple-50 dark:bg-purple-950/60 border border-purple-100 dark:border-purple-900"
                  : turno === "manha"
                    ? "bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900"
                    : "bg-orange-50 dark:bg-orange-950/60 border border-orange-100 dark:border-orange-900"
            }`}
          >
            <span className="font-medium">{slot.isBreak ? "Intervalo" : `${slot.period}º Horário`}</span>
            <span className="font-mono text-muted-foreground">{slot.start} – {slot.end}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Configuração de Horários</h1>
        <p className="text-muted-foreground mt-1">Configure os turnos Matutino, Vespertino e Noturno</p>
      </div>

      {/* Nome e Código da Escola */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <School className="w-4 h-4" />
            Identificação da Escola e Código
          </CardTitle>
        </CardHeader>
        <CardContent>
          {editingEscola ? (
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <div className="w-full sm:max-w-sm space-y-1">
                <span className="text-xs text-muted-foreground font-semibold">Nome da Escola</span>
                <Input value={escolaTemp} onChange={(e) => setEscolaTemp(e.target.value)} onKeyDown={(e) => e.key === "Enter" && salvarEscola()} placeholder="Ex: Escola Estadual Sul América" className="w-full" autoFocus />
              </div>
              <div className="w-full sm:max-w-xs space-y-1">
                <span className="text-xs text-muted-foreground font-semibold">Código</span>
                <Input value={codigoTemp} onChange={(e) => setCodigoTemp(e.target.value)} onKeyDown={(e) => e.key === "Enter" && salvarEscola()} placeholder="Ex: 147613" className="w-full" />
              </div>
              <div className="flex items-center gap-2 pt-5">
                <Button size="sm" onClick={salvarEscola}><Check className="w-3.5 h-3.5 mr-1" />Salvar</Button>
                <Button size="sm" variant="ghost" onClick={() => { setEscolaTemp(nomeEscola); setCodigoTemp(codigoEscola); setEditingEscola(false); }}>Cancelar</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold">{nomeEscola}</span>
              {codigoEscola && (
                <Badge variant="secondary" className="font-mono text-xs">
                  Cód: {codigoEscola}
                </Badge>
              )}
              <Button size="sm" variant="outline" onClick={() => { setEscolaTemp(nomeEscola); setCodigoTemp(codigoEscola); setEditingEscola(true); }}>Alterar Nome / Código</Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-2">Aparece no cabeçalho do Livro de Ponto e Grade ao imprimir.</p>
        </CardContent>
      </Card>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

          {/* ── MATUTINO ── */}
          <Card className="border-blue-200 dark:border-blue-900">
            <CardHeader className="pb-3 bg-blue-50 dark:bg-blue-950/40 rounded-t-lg border-b border-blue-100 dark:border-blue-900">
              <CardTitle className="text-base flex items-center gap-2 text-blue-700 dark:text-blue-300">
                <Sun className="w-4 h-4" />
                Turno Matutino
                <Badge variant="secondary" className="ml-auto bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 border-0">
                  {w.horarioInicial || "07:00"} – {previewManha.filter(s => !s.isBreak).at(-1)?.end ?? "—"}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <FormField control={form.control} name="horarioInicial" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Horário de Início</FormLabel>
                      <FormControl><Input type="time" {...field} data-testid="input-horario-inicial" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="quantidadeHorariosPorDia" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Aulas por Dia</FormLabel>
                        <FormControl><Input type="number" min={1} max={12} {...field} data-testid="input-qtd-horarios" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="duracaoAulaMinutos" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Duração (min)</FormLabel>
                        <FormControl><Input type="number" min={15} max={120} {...field} data-testid="input-duracao-aula" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={form.control} name="possuiIntervalo" render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center gap-3">
                        <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-intervalo" /></FormControl>
                        <FormLabel className="!mt-0">Possui Intervalo</FormLabel>
                      </div>
                    </FormItem>
                  )} />
                  {w.possuiIntervalo && (
                    <div className="grid grid-cols-2 gap-4 p-3 bg-muted rounded-lg">
                      <FormField control={form.control} name="horarioIntervalo" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Após o horário nº</FormLabel>
                          <FormControl><Input type="number" min={1} max={12} {...field} data-testid="input-horario-intervalo" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="duracaoIntervaloMinutos" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Duração (min)</FormLabel>
                          <FormControl><Input type="number" min={5} max={60} {...field} data-testid="input-duracao-intervalo" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium mb-3 flex items-center gap-2 text-blue-700 dark:text-blue-300">
                    <Clock className="w-3.5 h-3.5" />
                    Pré-visualização
                  </p>
                  <SlotPreview slots={previewManha} turno="manha" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── VESPERTINO ── */}
          <Card className={w.habilitarTarde ? "border-orange-200 dark:border-orange-900" : ""}>
            <CardHeader className={`pb-3 rounded-t-lg border-b ${w.habilitarTarde ? "bg-orange-50 dark:bg-orange-950/40 border-orange-100 dark:border-orange-900" : "border-border"}`}>
              <CardTitle className={`text-base flex items-center gap-2 ${w.habilitarTarde ? "text-orange-700 dark:text-orange-300" : "text-muted-foreground"}`}>
                <Sunset className="w-4 h-4" />
                Turno Vespertino
                {w.habilitarTarde && previewTarde.length > 0 && (
                  <Badge variant="secondary" className="ml-1 bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300 border-0">
                    {w.horarioInicialTarde || "13:00"} – {previewTarde.filter(s => !s.isBreak).at(-1)?.end ?? "—"}
                  </Badge>
                )}
                <div className="ml-auto flex items-center gap-2">
                  <FormField control={form.control} name="habilitarTarde" render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center gap-2">
                        <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-habilitar-tarde" /></FormControl>
                        <FormLabel className="!mt-0 text-sm font-normal">Habilitar</FormLabel>
                      </div>
                    </FormItem>
                  )} />
                </div>
              </CardTitle>
            </CardHeader>
            {w.habilitarTarde && (
              <CardContent className="pt-4">
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <FormField control={form.control} name="horarioInicialTarde" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Horário de Início</FormLabel>
                        <FormControl><Input type="time" {...field} data-testid="input-horario-inicial-tarde" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <div className="grid grid-cols-2 gap-4">
                      <FormField control={form.control} name="quantidadeHorariosPorDiaTarde" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Aulas por Dia</FormLabel>
                          <FormControl><Input type="number" min={1} max={12} {...field} data-testid="input-qtd-horarios-tarde" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="duracaoAulaMinutosTarde" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Duração (min)</FormLabel>
                          <FormControl><Input type="number" min={15} max={120} {...field} data-testid="input-duracao-aula-tarde" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <FormField control={form.control} name="possuiIntervaloTarde" render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center gap-3">
                          <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-intervalo-tarde" /></FormControl>
                          <FormLabel className="!mt-0">Possui Intervalo</FormLabel>
                        </div>
                      </FormItem>
                    )} />
                    {w.possuiIntervaloTarde && (
                      <div className="grid grid-cols-2 gap-4 p-3 bg-muted rounded-lg">
                        <FormField control={form.control} name="horarioIntervaloTarde" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Após o horário nº</FormLabel>
                            <FormControl><Input type="number" min={1} max={12} {...field} data-testid="input-horario-intervalo-tarde" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="duracaoIntervaloMinutosTarde" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Duração (min)</FormLabel>
                            <FormControl><Input type="number" min={5} max={60} {...field} data-testid="input-duracao-intervalo-tarde" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-3 flex items-center gap-2 text-orange-700 dark:text-orange-300">
                      <Clock className="w-3.5 h-3.5" />
                      Pré-visualização
                    </p>
                    <SlotPreview slots={previewTarde} turno="tarde" />
                  </div>
                </div>
              </CardContent>
            )}
            {!w.habilitarTarde && (
              <CardContent className="py-6">
                <p className="text-sm text-muted-foreground text-center">
                  Ative o interruptor acima para configurar o turno vespertino.
                </p>
              </CardContent>
            )}
          </Card>

          {/* ── NOTURNO ── */}
          <Card className={w.habilitarNoite ? "border-purple-200 dark:border-purple-900" : ""}>
            <CardHeader className={`pb-3 rounded-t-lg border-b ${w.habilitarNoite ? "bg-purple-50 dark:bg-purple-950/40 border-purple-100 dark:border-purple-900" : "border-border"}`}>
              <CardTitle className={`text-base flex items-center gap-2 ${w.habilitarNoite ? "text-purple-700 dark:text-purple-300" : "text-muted-foreground"}`}>
                <Moon className="w-4 h-4" />
                Turno Noturno
                {w.habilitarNoite && previewNoite.length > 0 && (
                  <Badge variant="secondary" className="ml-1 bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 border-0">
                    {w.horarioInicialNoite || "19:00"} – {previewNoite.filter(s => !s.isBreak).at(-1)?.end ?? "—"}
                  </Badge>
                )}
                <div className="ml-auto flex items-center gap-2">
                  <FormField control={form.control} name="habilitarNoite" render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center gap-2">
                        <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-habilitar-noite" /></FormControl>
                        <FormLabel className="!mt-0 text-sm font-normal">Habilitar</FormLabel>
                      </div>
                    </FormItem>
                  )} />
                </div>
              </CardTitle>
            </CardHeader>
            {w.habilitarNoite && (
              <CardContent className="pt-4">
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <FormField control={form.control} name="horarioInicialNoite" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Horário de Início</FormLabel>
                        <FormControl><Input type="time" {...field} data-testid="input-horario-inicial-noite" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <div className="grid grid-cols-2 gap-4">
                      <FormField control={form.control} name="quantidadeHorariosPorDiaNoite" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Aulas por Dia</FormLabel>
                          <FormControl><Input type="number" min={1} max={12} {...field} data-testid="input-qtd-horarios-noite" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="duracaoAulaMinutosNoite" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Duração (min)</FormLabel>
                          <FormControl><Input type="number" min={15} max={120} {...field} data-testid="input-duracao-aula-noite" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <FormField control={form.control} name="possuiIntervaloNoite" render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center gap-3">
                          <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-intervalo-noite" /></FormControl>
                          <FormLabel className="!mt-0">Possui Intervalo</FormLabel>
                        </div>
                      </FormItem>
                    )} />
                    {w.possuiIntervaloNoite && (
                      <div className="grid grid-cols-2 gap-4 p-3 bg-muted rounded-lg">
                        <FormField control={form.control} name="horarioIntervaloNoite" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Após o horário nº</FormLabel>
                            <FormControl><Input type="number" min={1} max={12} {...field} data-testid="input-horario-intervalo-noite" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="duracaoIntervaloMinutosNoite" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Duração (min)</FormLabel>
                            <FormControl><Input type="number" min={5} max={60} {...field} data-testid="input-duracao-intervalo-noite" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-3 flex items-center gap-2 text-purple-700 dark:text-purple-300">
                      <Clock className="w-3.5 h-3.5" />
                      Pré-visualização
                    </p>
                    <SlotPreview slots={previewNoite} turno="noite" />
                  </div>
                </div>
              </CardContent>
            )}
            {!w.habilitarNoite && (
              <CardContent className="py-6">
                <p className="text-sm text-muted-foreground text-center">
                  Ative o interruptor acima para configurar o turno noturno.
                </p>
              </CardContent>
            )}
          </Card>

          <Button type="submit" className="w-full" data-testid="button-save-horarios">
            <Save className="w-4 h-4 mr-2" />
            Salvar Configuração
          </Button>
        </form>
      </Form>
    </div>
  );
}
