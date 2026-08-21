import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AuthService, UserProfile } from "@/services/AuthService";
import { toast } from "sonner";
import { Grid3x3, LogOut, LayoutDashboard, User, Save, Building, Briefcase, Mail, CheckCircle2 } from "lucide-react";

export default function PerfilPage() {
  const [, setLocation] = useLocation();
  const [perfil, setPerfil] = useState<UserProfile | null>(null);
  const [email, setEmail] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form states for profile edit
  const [nome, setNome] = useState("");
  const [escolaNome, setEscolaNome] = useState("");
  const [cargo, setCargo] = useState("");

  // ── Load profile ──
  useEffect(() => {
    async function load() {
      try {
        const p = await AuthService.getCurrentProfile();
        if (p) {
          setEmail(p.email || "");
          setNome(p.nome_completo || "");
          setEscolaNome(p.escola_nome || "");
          setCargo(p.cargo || "Gestor Escolar");
          setPerfil(p);
        } else {
          setLocation("/login");
        }
      } catch (err) {
        console.error("Erro ao carregar perfil:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [setLocation]);

  async function handleLogout() {
    await AuthService.logout();
    toast.success("Sessão encerrada com sucesso.");
    setLocation("/login");
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await AuthService.updateProfile({
        nome_completo: nome,
        escola_nome: escolaNome,
        cargo,
      });

      if (res && res.success) {
        toast.success("Perfil atualizado com sucesso!");
        const updated: UserProfile = {
          ...perfil,
          id: perfil?.id || "local",
          nome_completo: nome,
          escola_nome: escolaNome,
          cargo: cargo,
        };
        setPerfil(updated);
      } else {
        toast.error("Erro ao atualizar perfil.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Erro ao salvar alterações no perfil.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="text-slate-400 text-sm animate-pulse">Carregando perfil do usuário…</div>
      </div>
    );
  }

  const nomeExibido = nome || perfil?.nome_completo || perfil?.nome_usuario || email.split("@")[0] || "Usuário";
  const iniciais = nomeExibido.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col">
      {/* ── Header ── */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="max-w-xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setLocation("/painel")}>
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
              <Grid3x3 className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-sm font-bold text-slate-900 dark:text-white">EduHorários</span>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-600 dark:hover:text-red-400 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sair
          </button>
        </div>
      </header>

      {/* ── Profile card ── */}
      <main className="flex-1 flex items-start justify-center pt-8 pb-12 px-4">
        <div className="w-full max-w-lg">
          <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
            {/* Avatar strip */}
            <div className="bg-gradient-to-r from-indigo-600 to-indigo-800 h-24 relative px-6 flex items-end justify-between pb-3">
              <span className="text-xs text-indigo-100 font-medium">Página Individual do Usuário</span>
            </div>

            <div className="px-6 pb-6">
              <div className="-mt-10 mb-4 flex items-end justify-between">
                <div className="w-20 h-20 rounded-2xl bg-white dark:bg-slate-700 border-4 border-white dark:border-slate-800 shadow-md flex items-center justify-center">
                  {iniciais ? (
                    <span className="text-2xl font-extrabold text-indigo-600 dark:text-indigo-400">
                      {iniciais}
                    </span>
                  ) : (
                    <User className="w-8 h-8 text-slate-400" />
                  )}
                </div>
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  <CheckCircle2 className="w-3 h-3" /> Conta Ativa
                </span>
              </div>

              <h1 className="text-xl font-bold text-slate-900 dark:text-white">{nomeExibido}</h1>
              {email && (
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5" /> {email}
                </p>
              )}

              {/* Form de Edição de Dados */}
              <form onSubmit={handleSaveProfile} className="mt-6 space-y-4 pt-4 border-t border-slate-100 dark:border-slate-700">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Dados do Usuário
                </h2>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Nome Completo
                  </label>
                  <input
                    type="text"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Seu nome"
                    required
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                      <Building className="w-3 h-3" /> Escola
                    </label>
                    <input
                      type="text"
                      value={escolaNome}
                      onChange={(e) => setEscolaNome(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Nome da Escola"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                      <Briefcase className="w-3 h-3" /> Cargo / Função
                    </label>
                    <input
                      type="text"
                      value={cargo}
                      onChange={(e) => setCargo(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Gestor, Diretor..."
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={saving}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
                >
                  <Save className="w-4 h-4" />
                  {saving ? "Salvando..." : "Salvar Alterações de Perfil"}
                </button>
              </form>

              <div className="mt-6 space-y-2 pt-4 border-t border-slate-100 dark:border-slate-700">
                <button
                  onClick={() => setLocation("/painel")}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors shadow-sm"
                >
                  <LayoutDashboard className="w-4 h-4" />
                  Entrar no Sistema de Horários
                </button>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 border border-slate-200 dark:border-slate-600 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sair da Conta
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
