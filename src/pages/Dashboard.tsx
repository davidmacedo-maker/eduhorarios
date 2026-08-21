import { useMemo, useState } from "react";
import { useTurmas, useDisciplinas, useProfessores, useAlocacoes, useMatrizCurricular, useNomeEscola } from "@/store";
import { detectConflicts } from "@/lib/schedule-utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { generateDemoData } from "@/lib/optimization-utils";
import { toast } from "sonner";
import {
  Users,
  BookOpen,
  GraduationCap,
  AlertTriangle,
  Grid3x3,
  Shuffle,
  Clock,
  Download,
  CalendarDays,
  Percent,
  Sparkles,
  School,
  DatabaseBackup,
  Loader2
} from "lucide-react";
import { Link } from "wouter";

export default function Dashboard() {
  const [turmas, setTurmas] = useTurmas();
  const [disciplinas, setDisciplinas] = useDisciplinas();
  const [professores, setProfessores] = useProfessores();
  const [alocacoes, setAlocacoes] = useAlocacoes();
  const [matriz, setMatriz] = useMatrizCurricular();
  const [nomeEscola, setNomeEscola] = useNomeEscola();

  const [isSeeding, setIsSeeding] = useState(false);
  const [selectedSize, setSelectedSize] = useState<"pequena" | "media" | "grande" | null>(null);

  const conflitos = useMemo(
    () => detectConflicts(alocacoes, professores, disciplinas, turmas, matriz),
    [alocacoes, professores, disciplinas, turmas, matriz]
  );

  // Calculate stats
  const totalDemanded = useMemo(
    () => matriz.reduce((sum, m) => sum + (Number(m.aulasPorSemana) || 0), 0),
    [matriz]
  );

  const fillPercentage = useMemo(() => {
    if (totalDemanded === 0) return 0;
    return Math.min(100, Math.round((alocacoes.length / totalDemanded) * 100));
  }, [alocacoes, totalDemanded]);

  const stats = [
    {
      label: "Professores",
      value: professores.length,
      icon: GraduationCap,
      color: "text-purple-600 dark:text-purple-400",
      bg: "bg-purple-50 dark:bg-purple-950/40",
      href: "/professores",
      subtext: `${professores.filter(p => Object.values(p.disponibilidade || {}).some(l => l && l.length > 0)).length} ativos`
    },
    {
      label: "Turmas",
      value: turmas.length,
      icon: Users,
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-50 dark:bg-blue-950/40",
      href: "/turmas",
      subtext: `${turmas.filter(t => t.turno === "manha").length}M / ${turmas.filter(t => t.turno === "tarde").length}T`
    },
    {
      label: "Disciplinas",
      value: disciplinas.length,
      icon: BookOpen,
      color: "text-green-600 dark:text-green-400",
      bg: "bg-green-50 dark:bg-green-950/40",
      href: "/disciplinas",
      subtext: `${matriz.length} na matriz`
    },
    {
      label: "Carga Horária Semanal",
      value: `${alocacoes.length}h`,
      icon: CalendarDays,
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-50 dark:bg-amber-950/40",
      href: "/alocacao",
      subtext: `${totalDemanded}h demandadas`
    },
    {
      label: "Conflitos",
      value: conflitos.length,
      icon: AlertTriangle,
      color: conflitos.length > 0 ? "text-red-600 dark:text-red-400 font-bold" : "text-muted-foreground",
      bg: conflitos.length > 0 ? "bg-red-50 dark:bg-red-950/40" : "bg-muted/50",
      href: "/alocacao",
      subtext: conflitos.length > 0 ? "Ação necessária" : "Grade saudável"
    },
    {
      label: "Preenchimento Grid",
      value: `${fillPercentage}%`,
      icon: Percent,
      color: "text-indigo-650 dark:text-indigo-400",
      bg: "bg-indigo-50 dark:bg-indigo-950/40",
      href: "/alocacao",
      subtext: "Integralização"
    },
  ];

  const handleSeedDemo = async (size: "pequena" | "media" | "grande") => {
    setIsSeeding(true);
    setSelectedSize(size);
    toast.promise(
      new Promise<void>(async (resolve, reject) => {
        try {
          await new Promise((r) => setTimeout(r, 1200)); // smooth simulation
          const data = generateDemoData(size);
          
          // Seed name of school
          const schoolLabel = size === "pequena" 
            ? "E.E. de Demonstração - Pequeno Porte" 
            : size === "media" 
              ? "E.E. de Demonstração - Médio Porte" 
              : "E.E. de Demonstração - Grande Porte";
          setNomeEscola(schoolLabel);
          localStorage.setItem("eduhorarios_nome_escola", schoolLabel);

          setTurmas(data.turmas);
          setDisciplinas(data.disciplinas);
          setProfessores(data.professores);
          setMatriz(data.matriz);
          setAlocacoes(data.alocacoes);
          
          // Set last generated and synchronization indicators
          const lastGenStr = "Hoje " + new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
          localStorage.setItem("edu_last_gen_time", lastGenStr);
          localStorage.setItem("edu_last_sync_time", new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));

          resolve();
        } catch (err) {
          reject(err);
        } finally {
          setIsSeeding(false);
          setSelectedSize(null);
        }
      }),
      {
        loading: "Criando dados de teste, gerando matriz curricular e pré-alocando horários de forma otimizada...",
        success: `Modo Demonstração (${size === "pequena" ? "Escola Pequena" : size === "media" ? "Escola Média" : "Escola Grande"}) ativado!`,
        error: "Erro ao ativar o modo demonstração."
      }
    );
  };

  const quickActions = [
    { label: "Configurar Horários", icon: Clock, href: "/horarios" },
    { label: "Gerar Grade", icon: Shuffle, href: "/alocacao" },
    { label: "Visualizar Grade", icon: Grid3x3, href: "/grade" },
    { label: "Exportar / Imprimir", icon: Download, href: "/exportar" },
  ];

  const recentAlocacoes = alocacoes.slice(0, 6);
  const dayLabels: Record<string, string> = {
    segunda: "Segunda",
    terca: "Terça",
    quarta: "Quarta",
    quinta: "Quinta",
    sexta: "Sexta",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Painel Estatístico</h1>
        <p className="text-muted-foreground mt-1 text-sm">Visão geral compilada das alocações e conformidades pedagógicas.</p>
      </div>

      {/* Demo Mode Seeder Card */}
      {professores.length === 0 && (
        <Card className="border-indigo-200 dark:border-indigo-900 bg-indigo-50/20 dark:bg-indigo-950/10 shadow-md">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 rounded-lg">
                <Sparkles className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <CardTitle className="text-base font-extrabold text-indigo-900 dark:text-indigo-300">Modo Demonstração</CardTitle>
                <CardDescription className="text-xs text-indigo-700/80 dark:text-indigo-400/80">
                  Experimente a potência completa do EduHorários imediatamente, sem o trabalho de cadastrar tudo manualmente.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-slate-600 dark:text-slate-350 leading-relaxed font-semibold">
              Selecione um porte de escola abaixo. O sistema criará instantaneamente dezenas de turmas, disciplinas, professores com suas respectivas disponibilidades e gerará uma grade horária inicial inteligente.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { size: "pequena", label: "Escola Pequena", desc: "20 professores · 10 turmas · 12 disciplinas · 300 aulas" },
                { size: "media", label: "Escola Média", desc: "80 professores · 40 turmas · 18 disciplinas · 1.200 aulas" },
                { size: "grande", label: "Escola Grande", desc: "250 professores · 120 turmas · 25 disciplinas · 4.500 aulas" }
              ].map((item) => (
                <Button
                  key={item.size}
                  variant="outline"
                  onClick={() => handleSeedDemo(item.size as any)}
                  disabled={isSeeding}
                  className="flex flex-col items-center p-4 h-auto text-center border hover:border-indigo-400 hover:bg-indigo-50/35 dark:hover:bg-indigo-950/20 gap-2 shadow-2xs group relative overflow-hidden"
                >
                  {isSeeding && selectedSize === item.size ? (
                    <Loader2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400 animate-spin" />
                  ) : (
                    <School className="w-5 h-5 text-indigo-500 group-hover:scale-110 transition-transform duration-200" />
                  )}
                  <div>
                    <span className="text-xs font-extrabold text-slate-900 dark:text-slate-100 block">{item.label}</span>
                    <span className="text-[10px] text-muted-foreground font-semibold mt-0.5 block">{item.desc}</span>
                  </div>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats - Grid expand to 6 columns for absolute layouts */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Link href={stat.href} key={stat.label}>
              <Card
                className="cursor-pointer hover:shadow-md transition-all duration-200 border hover:border-primary/20 hover:scale-[1.01]"
                data-testid={`stat-card-${stat.label.toLowerCase().replace(/ /g, "-")}`}
              >
                <CardContent className="p-4 flex flex-col justify-between h-full space-y-3">
                  <div className="flex items-center justify-between">
                    <div className={`p-1.5 rounded-md ${stat.bg}`}>
                      <Icon className={`w-4 h-4 ${stat.color}`} />
                    </div>
                  </div>
                  <div>
                    <p className="text-xl font-extrabold tracking-tight text-foreground" data-testid={`stat-value-${stat.label.toLowerCase().replace(/ /g, "-")}`}>{stat.value}</p>
                    <p className="text-[11px] font-medium text-muted-foreground truncate" title={stat.label}>{stat.label}</p>
                    <p className="text-[10px] text-muted-foreground/80 mt-0.5 truncate">{stat.subtext}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Quick Actions */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold">Acesso Rápido</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <Link href={action.href} key={action.label}>
                  <Button
                    variant="outline"
                    className="w-full justify-start gap-2 h-auto py-3 border hover:border-primary/20 hover:bg-primary/5 shadow-2xs"
                    data-testid={`quick-action-${action.label.toLowerCase().replace(/ /g, "-")}`}
                  >
                    <Icon className="w-4 h-4 shrink-0 text-primary" />
                    <span className="text-xs text-left font-medium">{action.label}</span>
                  </Button>
                </Link>
              );
            })}
          </CardContent>
        </Card>

        {/* Recent allocations */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold">Alocações Recentes</CardTitle>
          </CardHeader>
          <CardContent>
            {recentAlocacoes.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm flex flex-col items-center justify-center space-y-1.5">
                <Shuffle className="w-8 h-8 opacity-40 text-primary animate-pulse" />
                <span>Nenhuma alocação registrada no momento</span>
              </div>
            ) : (
              <ul className="space-y-2">
                {recentAlocacoes.map((a) => {
                  const turma = turmas.find((t) => t.id === a.turmaId);
                  const disc = disciplinas.find((d) => d.id === a.disciplinaId);
                  const prof = professores.find((p) => p.id === a.professorId);
                  return (
                    <li
                      key={a.id}
                      className="flex items-center gap-3 text-sm p-1.5 border rounded-md shadow-3xs hover:bg-muted/10"
                      data-testid={`alocacao-item-${a.id}`}
                    >
                      <div
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: disc?.cor || "#6b7280" }}
                      />
                      <span className="font-semibold text-xs text-foreground truncate max-w-[120px]">{disc?.nome}</span>
                      <span className="text-muted-foreground text-xs shrink-0 font-medium">
                        {turma?.nome} — {dayLabels[a.diaSemana]} {a.horario}º
                      </span>
                      <Badge variant="secondary" className="ml-auto text-[10px] shrink-0 font-medium font-mono capitalize">
                        {prof?.nomeCompleto.split(" ")[0]}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Conflicts */}
      {conflitos.length > 0 && (
        <Card className="border-red-200 bg-red-500/[0.01]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold flex items-center gap-2 text-red-650">
              <AlertTriangle className="w-4 h-4" />
              Conflitos Detectados ({conflitos.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {conflitos.slice(0, 4).map((c, i) => (
                <li key={i} className="text-xs text-muted-foreground flex items-start gap-2 bg-background p-2 border rounded-md">
                  <span className="text-red-550 mt-0.5 shrink-0">•</span>
                  <span>{c.descricao}</span>
                </li>
              ))}
              {conflitos.length > 4 && (
                <li className="text-xs text-muted-foreground">
                  <Link href="/alocacao">
                    <span className="text-primary font-bold hover:underline cursor-pointer">
                      Ver todos os {conflitos.length} conflitos detectados
                    </span>
                  </Link>
                </li>
              )}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
