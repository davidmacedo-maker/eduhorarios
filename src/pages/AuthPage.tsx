import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Loader2, ArrowRight } from "lucide-react";
import { AuthService } from "@/services/AuthService";
import { useAuth } from "@/lib/auth";

interface AuthPageProps {
  mode?: "login" | "cadastro";
}

export default function AuthPage({ mode = "login" }: AuthPageProps) {
  const [, setLocation] = useLocation();
  const { refreshProfile } = useAuth();

  const [isRegistering, setIsRegistering] = useState(mode === "cadastro");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [nomeEscola, setNomeEscola] = useState("");
  const [responsavel, setResponsavel] = useState("");

  // Sincronizar modo quando a rota mudar (/login vs /cadastro)
  useEffect(() => {
    setIsRegistering(mode === "cadastro");
    setErrorMessage(null);
  }, [mode]);

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (loading) return;

    setErrorMessage(null);
    setSuccessMessage(null);

    const inputVal = (email || "").trim();
    const lowerInput = inputVal.toLowerCase();

    if (!inputVal) {
      const msg = "Informe o e-mail ou nome de usuário.";
      setErrorMessage(msg);
      toast.error(msg);
      return;
    }

    if (!password) {
      const msg = "Informe a senha.";
      setErrorMessage(msg);
      toast.error(msg);
      return;
    }

    setLoading(true);
    try {
      // 1. Autenticação via Supabase Auth
      const apiRes = await AuthService.loginWithApi(inputVal, password);

      if (apiRes && apiRes.success && apiRes.user) {
        setSuccessMessage(apiRes.message || "Login realizado com sucesso!");
        toast.success(apiRes.message || "Login realizado com sucesso!");

        // 2. Atualizar contexto global de autenticação
        try {
          await refreshProfile();
        } catch {}

        // 3. Redirecionamento baseado na role
        const isMaster =
          apiRes.user.perfil === "admin" ||
          apiRes.user.perfil === "SUPER_ADMIN" ||
          apiRes.user.role === "SUPER_ADMIN" ||
          apiRes.user.is_super_admin === true ||
          lowerInput.includes("admin") ||
          lowerInput.includes("master");

        if (isMaster) {
          setLocation("/master-control");
        } else {
          setLocation("/painel");
        }
        return;
      }

      if (apiRes && !apiRes.success && apiRes.message) {
        setErrorMessage(apiRes.message);
        toast.error(apiRes.message);
        return;
      }

      const fallbackMsg = "Erro ao autenticar. Verifique suas credenciais.";
      setErrorMessage(fallbackMsg);
      toast.error(fallbackMsg);
    } catch (err: any) {
      console.error("Erro no login:", err);
      const errMsg = err?.message || "Erro ao realizar login.";
      setErrorMessage(errMsg);
      toast.error(errMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (loading) return;

    setErrorMessage(null);
    setSuccessMessage(null);

    const trimmedNome = (responsavel || "").trim();
    const trimmedEmail = (email || "").trim();

    if (!trimmedNome) {
      const msg = "Informe o nome do responsável.";
      setErrorMessage(msg);
      toast.error(msg);
      return;
    }

    if (!trimmedEmail) {
      const msg = "Informe o e-mail.";
      setErrorMessage(msg);
      toast.error(msg);
      return;
    }

    if (!password) {
      const msg = "Informe a senha.";
      setErrorMessage(msg);
      toast.error(msg);
      return;
    }

    if (password.length < 6) {
      const msg = "A senha deve ter no mínimo 6 caracteres.";
      setErrorMessage(msg);
      toast.error(msg);
      return;
    }

    if (confirmPassword && password !== confirmPassword) {
      const msg = "As senhas não coincidem.";
      setErrorMessage(msg);
      toast.error(msg);
      return;
    }

    setLoading(true);
    try {
      const apiRes = await AuthService.registerWithApi(
        trimmedNome,
        trimmedEmail,
        password,
        confirmPassword || password,
        nomeEscola.trim()
      );

      if (apiRes && apiRes.success) {
        const okMsg = apiRes.message || "Cadastro realizado com sucesso! Faça login para continuar.";
        setSuccessMessage(okMsg);
        toast.success(okMsg);

        // Limpar campos confidenciais e mudar para a tela de login
        setPassword("");
        setConfirmPassword("");
        setNomeEscola("");
        setResponsavel("");
        setIsRegistering(false);
        setLocation("/login");
        return;
      }

      if (apiRes && !apiRes.success && apiRes.message) {
        setErrorMessage(apiRes.message);
        toast.error(apiRes.message);
        return;
      }

      const failMsg = "Não foi possível concluir o cadastro.";
      setErrorMessage(failMsg);
      toast.error(failMsg);
    } catch (err: any) {
      const errTxt = err.message || "Erro ao criar conta.";
      setErrorMessage(errTxt);
      toast.error(errTxt);
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    "mt-1 block w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3.5 py-2.5 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm transition-all";
  const labelCls = "block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider";

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 px-4 py-12">
      <div className="max-w-md w-full space-y-6 bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-700">
        <div className="text-center">
          <div className="w-12 h-12 rounded-xl bg-indigo-600 flex items-center justify-center mx-auto mb-3 shadow-md shadow-indigo-200 dark:shadow-none">
            <span className="text-xl font-extrabold text-white">E</span>
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">EduHorários</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {isRegistering ? "Crie a conta da sua escola" : "Faça login para acessar o sistema"}
          </p>
        </div>

        {/* Alternador de abas Login / Cadastro */}
        <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 p-1 gap-1 bg-slate-100 dark:bg-slate-800/80">
          <button
            type="button"
            id="tab-login-btn"
            onClick={() => {
              setErrorMessage(null);
              setIsRegistering(false);
              setLocation("/login");
            }}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
              !isRegistering
                ? "bg-white dark:bg-slate-700 text-indigo-600 dark:text-white shadow-sm"
                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            }`}
          >
            Entrar
          </button>
          <button
            type="button"
            id="tab-cadastro-btn"
            onClick={() => {
              setErrorMessage(null);
              setIsRegistering(true);
              setLocation("/cadastro");
            }}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
              isRegistering
                ? "bg-white dark:bg-slate-700 text-indigo-600 dark:text-white shadow-sm"
                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            }`}
          >
            Cadastrar
          </button>
        </div>

        {/* Mensagens de Feedback em destaque */}
        {errorMessage && (
          <div
            id="auth-error-alert"
            className="flex items-start gap-2.5 p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm animate-in fade-in duration-200"
          >
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <span className="font-medium leading-snug">{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div
            id="auth-success-alert"
            className="flex items-start gap-2.5 p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-sm animate-in fade-in duration-200"
          >
            <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
            <span className="font-medium leading-snug">{successMessage}</span>
          </div>
        )}

        <form
          noValidate
          className="space-y-4"
          onSubmit={isRegistering ? handleRegister : handleLogin}
        >
          {isRegistering && (
            <>
              <div>
                <label className={labelCls}>Nome da Escola</label>
                <input
                  type="text"
                  id="input-escola-nome"
                  value={nomeEscola}
                  onChange={(e) => setNomeEscola(e.target.value)}
                  className={inputCls}
                  placeholder="Ex: Escola Estadual São Paulo"
                />
              </div>
              <div>
                <label className={labelCls}>Nome do Responsável</label>
                <input
                  type="text"
                  id="input-responsavel-nome"
                  value={responsavel}
                  onChange={(e) => setResponsavel(e.target.value)}
                  className={inputCls}
                  placeholder="Ex: Prof. Carlos Eduardo"
                />
              </div>
            </>
          )}

          <div>
            <label className={labelCls}>{isRegistering ? "E-mail Institucional" : "E-mail ou Login"}</label>
            <input
              type={isRegistering ? "email" : "text"}
              id="input-login-email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
              className={inputCls}
              placeholder={isRegistering ? "gestor@escola.edu.br" : "seu-email@escola.edu.br"}
              autoComplete="username"
            />
          </div>

          <div>
            <label className={labelCls}>Senha</label>
            <input
              type="password"
              id="input-login-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
              className={inputCls}
              placeholder="••••••••"
              autoComplete={isRegistering ? "new-password" : "current-password"}
            />
          </div>

          {isRegistering && (
            <div>
              <label className={labelCls}>Confirmar Senha</label>
              <input
                type="password"
                id="input-cadastro-confirm-password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                className={inputCls}
                placeholder="Repita a senha"
                autoComplete="new-password"
              />
            </div>
          )}

          <button
            type="submit"
            id="auth-submit-btn"
            disabled={loading}
            className="w-full flex justify-center items-center gap-2 py-3 px-4 rounded-xl shadow-md font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60 transition-all cursor-pointer"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>{isRegistering ? "Cadastrando..." : "Entrando..."}</span>
              </>
            ) : isRegistering ? (
              <>
                <span>Criar Conta da Escola</span>
                <ArrowRight className="w-4 h-4" />
              </>
            ) : (
              <>
                <span>Entrar no Sistema</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Links adicionais de navegação */}
        <div className="space-y-3 pt-2 text-center text-xs">
          {!isRegistering ? (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                id="forgot-password-btn"
                onClick={() => {
                  setLocation("/recuperar-senha");
                }}
                className="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 font-medium transition-colors cursor-pointer"
              >
                Esqueci minha senha
              </button>

              <p className="text-slate-500 dark:text-slate-400">
                Não tem uma conta?{" "}
                <button
                  type="button"
                  id="switch-to-register-btn"
                  onClick={() => {
                    setErrorMessage(null);
                    setIsRegistering(true);
                    setLocation("/cadastro");
                  }}
                  className="font-semibold text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 underline cursor-pointer"
                >
                  Cadastre sua escola
                </button>
              </p>
            </div>
          ) : (
            <p className="text-slate-500 dark:text-slate-400">
              Já possui uma conta?{" "}
              <button
                type="button"
                id="switch-to-login-btn"
                onClick={() => {
                  setErrorMessage(null);
                  setIsRegistering(false);
                  setLocation("/login");
                }}
                className="font-semibold text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 underline cursor-pointer"
              >
                Voltar para Entrar
              </button>
            </p>
          )}

          <div className="pt-2 border-t border-slate-100 dark:border-slate-700/50">
            <button
              type="button"
              id="back-to-app-btn"
              onClick={() => {
                setLocation("/painel");
              }}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer"
            >
              ← Ir ao painel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
