import { Link } from "wouter";
import { Grid3x3, CalendarDays, ClipboardList, GraduationCap, ChevronRight, BookOpen, ShieldCheck } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col">

      {/* ── Nav ── */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
              <Grid3x3 className="w-4 h-4 text-white" />
            </div>
            <span className="text-base font-bold text-slate-900 dark:text-white">EduHorários</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login">
              <span className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer">
                Entrar
              </span>
            </Link>
            <Link href="/cadastro">
              <span className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors cursor-pointer">
                Cadastrar
              </span>
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <main className="flex-1">
        <section className="max-w-5xl mx-auto px-6 py-16 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/40 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs font-semibold mb-6">
            <ShieldCheck className="w-3 h-3" />
            Sistema gratuito para escolas públicas
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-slate-900 dark:text-white leading-tight mb-4">
            Gestão de Horários<br />
            <span className="text-indigo-600">Escolar Simplificada</span>
          </h1>
          <p className="text-lg text-slate-500 dark:text-slate-400 max-w-2xl mx-auto mb-8">
            EduHorários é um sistema completo para gestão de grade horária e livro de ponto
            — tudo em um só lugar, offline e seguro.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/cadastro">
              <span className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors cursor-pointer shadow-sm">
                Criar conta gratuita
                <ChevronRight className="w-4 h-4" />
              </span>
            </Link>
            <Link href="/login">
              <span className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors cursor-pointer shadow-sm">
                Já tenho conta — Entrar
              </span>
            </Link>
          </div>
        </section>

        {/* ── Features ── */}
        <section className="max-w-5xl mx-auto px-6 pb-12">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                icon: CalendarDays,
                title: "Grade de Horários",
                desc: "Monte e visualize a grade completa de horários por turma, professor e turno.",
              },
              {
                icon: ClipboardList,
                title: "Livro de Ponto",
                desc: "Registre a frequência diária dos professores com preenchimento rápido e símbolos oficiais.",
              },
              {
                icon: GraduationCap,
                title: "Gestão de Professores",
                desc: "Cadastre professores, disciplinas e disponibilidade. Alocação automática sem conflitos.",
              },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-xl p-5 shadow-sm">
                <div className="w-9 h-9 rounded-lg bg-indigo-50 dark:bg-indigo-900/40 flex items-center justify-center mb-3">
                  <Icon className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                </div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1">{title}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── How to use ── */}
        <section className="max-w-5xl mx-auto px-6 pb-16">
          <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-xl p-8 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-6 text-center">
              Como começar em 4 passos
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { step: "1", title: "Crie sua conta", desc: "Clique em Cadastrar e crie sua conta com e-mail e senha." },
                { step: "2", title: "Configure a escola", desc: "Cadastre turmas, disciplinas e professores no menu Cadastros." },
                { step: "3", title: "Monte a grade", desc: "Use a Alocação Automática ou monte a grade manualmente." },
                { step: "4", title: "Registre o ponto", desc: "Acesse o Livro de Ponto para registrar a frequência diária." },
              ].map(({ step, title, desc }) => (
                <div key={step} className="flex flex-col items-center text-center">
                  <div className="w-9 h-9 rounded-full bg-indigo-600 text-white text-sm font-bold flex items-center justify-center mb-3 shrink-0">
                    {step}
                  </div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-1">{title}</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-4 text-center text-xs text-slate-400">
        EduHorários — Sistema de Gestão Escolar · {new Date().getFullYear()}
      </footer>
    </div>
  );
}
