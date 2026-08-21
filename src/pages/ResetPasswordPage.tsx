import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { AuthService } from "@/services/AuthService";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { toast } from "sonner";
import {
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  Mail,
  Send,
  ShieldCheck,
  KeyRound,
  RefreshCw,
} from "lucide-react";

export default function ResetPasswordPage() {
  const [, setLocation] = useLocation();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [verifyingToken, setVerifyingToken] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: "error" | "success" | "info";
    text: string;
  } | null>(null);

  const [recoveryToken, setRecoveryToken] = useState<string>("");
  const [userEmailMasked, setUserEmailMasked] = useState<string>("");
  const [isTokenValid, setIsTokenValid] = useState<boolean | null>(null);

  // Email request form state (when visiting without token)
  const [requestEmail, setRequestEmail] = useState("");
  const [requestSubmitted, setRequestSubmitted] = useState(false);

  useEffect(() => {
    // 1. Ouvir evento PASSWORD_RECOVERY do Supabase Auth
    if (isSupabaseConfigured && supabase) {
      // Checar se veio código de recuperação via PKCE (search ou hash)
      const fullUrl = window.location.href;
      const codeMatch = fullUrl.match(/[?&]code=([^&#]+)/);
      const code = codeMatch && codeMatch[1] ? decodeURIComponent(codeMatch[1]).trim() : null;

      if (code) {
        setVerifyingToken(true);
        supabase.auth
          .exchangeCodeForSession(code)
          .then(({ data, error }) => {
            setVerifyingToken(false);
            if (!error && data?.session) {
              setIsTokenValid(true);
              setRecoveryToken(data.session.access_token || "supabase-recovery-session");
              if (data.session.user?.email) {
                setUserEmailMasked(data.session.user.email);
              }
            }
          })
          .catch(() => {
            setVerifyingToken(false);
          });
      }

      // Checar sessão ativa no Supabase
      supabase.auth.getSession().then(({ data: { session } }) => {
        const hash = window.location.hash;
        if (session && (hash.includes("type=recovery") || hash.includes("access_token") || code)) {
          setIsTokenValid(true);
          setRecoveryToken(session.access_token || "supabase-recovery-session");
          if (session.user?.email) {
            setUserEmailMasked(session.user.email);
          }
        }
      });

      const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
        if (
          event === "PASSWORD_RECOVERY" ||
          (session && (window.location.hash.includes("type=recovery") || window.location.hash.includes("access_token")))
        ) {
          setIsTokenValid(true);
          setRecoveryToken(session?.access_token || "supabase-recovery-session");
          if (session?.user?.email) {
            setUserEmailMasked(session.user.email);
          }
        }
      });

      // Checar se já existe sessão de recuperação no hash da URL
      const hash = window.location.hash;
      if (hash.includes("access_token") || hash.includes("type=recovery") || hash.includes("code=")) {
        setIsTokenValid(true);
        setRecoveryToken("supabase-recovery-session");
      }

      return () => {
        authListener?.subscription.unsubscribe();
      };
    }

    // 2. Extrai o token da URL atual caso modo legado/param
    const fullUrl = window.location.href;
    const tokenMatch = fullUrl.match(/[?&]token=([^&#]+)/);
    const token = tokenMatch && tokenMatch[1] ? decodeURIComponent(tokenMatch[1]).trim() : "";

    if (token) {
      setRecoveryToken(token);
      validateToken(token);
    } else {
      setIsTokenValid(null);
    }
  }, []);

  const validateToken = async (token: string) => {
    setVerifyingToken(true);
    try {
      const res = await AuthService.verifyResetToken(token);
      if (res && res.valid) {
        setIsTokenValid(true);
        if (res.email) setUserEmailMasked(res.email);
      } else {
        setIsTokenValid(false);
        setStatusMessage({
          type: "error",
          text: res?.message || "O link de recuperação expirou ou já foi utilizado. Solicite um novo link abaixo.",
        });
      }
    } catch {
      setIsTokenValid(true); // Fallback amigável
    } finally {
      setVerifyingToken(false);
    }
  };

  // Solicitar envio de link de recuperação
  const handleRequestResetLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = requestEmail.trim().toLowerCase();

    if (!cleanEmail || !cleanEmail.includes("@")) {
      toast.error("Por favor, informe um endereço de e-mail válido.");
      return;
    }

    setLoading(true);
    setStatusMessage(null);

    try {
      const res = await AuthService.requestPasswordReset(cleanEmail);

      if (res && res.success) {
        setRequestSubmitted(true);
        setStatusMessage({
          type: "success",
          text: res.message || "Se o e-mail estiver cadastrado, você receberá as instruções em instantes.",
        });
        toast.success("Solicitação enviada com sucesso!");

        // Se o token vier na resposta (modo teste/dev), oferece navegação direta
        if (res.token) {
          setRecoveryToken(res.token);
          setTimeout(() => {
            validateToken(res.token!);
          }, 1500);
        }
      } else {
        toast.error(res?.message || "Erro ao processar solicitação.");
      }
    } catch (err: any) {
      toast.error(err.message || "Erro de conexão ao solicitar recuperação.");
    } finally {
      setLoading(false);
    }
  };

  // Redefinir senha com token
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 6) {
      setStatusMessage({ type: "error", text: "A nova senha deve ter no mínimo 6 caracteres." });
      toast.error("A senha deve ter no mínimo 6 caracteres.");
      return;
    }

    if (password !== confirmPassword) {
      setStatusMessage({ type: "error", text: "As senhas não coincidem. Verifique a digitação." });
      toast.error("As senhas não coincidem.");
      return;
    }

    setLoading(true);
    setStatusMessage(null);

    try {
      const res = await AuthService.resetPassword(recoveryToken, password, confirmPassword);

      if (res && res.success) {
        setStatusMessage({
          type: "success",
          text: res.message || "Sua senha foi redefinida com sucesso! Redirecionando para o login...",
        });
        toast.success("Senha redefinida com sucesso!");

        setTimeout(() => {
          setLocation("/login");
          window.location.hash = "/login";
        }, 2000);
      } else {
        setStatusMessage({
          type: "error",
          text: res?.message || "Não foi possível redefinir sua senha. O link pode ter expirado.",
        });
        toast.error(res?.message || "Erro ao redefinir senha.");
      }
    } catch (err: any) {
      const msg = err.message || "Erro ao redefinir senha no banco de dados.";
      setStatusMessage({ type: "error", text: msg });
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    "mt-1 block w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3.5 py-2.5 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm transition-all shadow-sm";
  const labelCls = "block text-sm font-medium text-slate-700 dark:text-slate-300";

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 px-4 py-12">
      <div className="max-w-md w-full space-y-6 bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-700">
        {/* Header */}
        <div className="text-center">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center mx-auto mb-3 shadow-md shadow-indigo-500/20">
            {recoveryToken && isTokenValid !== false ? (
              <KeyRound className="w-6 h-6 text-white" />
            ) : (
              <Lock className="w-6 h-6 text-white" />
            )}
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {recoveryToken && isTokenValid !== false ? "Criar Nova Senha" : "Recuperar Senha"}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {recoveryToken && isTokenValid !== false
              ? userEmailMasked
                ? `Redefinindo senha para a conta ${userEmailMasked}`
                : "Defina sua nova senha de acesso ao EduHorários."
              : "Informe seu e-mail cadastrado para receber o link seguro de recuperação."}
          </p>
        </div>

        {/* Database Persistence Status Badge */}
        <div className="bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
          <span>EduHorários • Supabase Auth • Criptografia e tokens seguros</span>
        </div>

        {/* Status Alerts */}
        {statusMessage && (
          <div
            className={`p-4 rounded-xl text-xs font-medium flex items-start gap-3 border ${
              statusMessage.type === "success"
                ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800"
                : statusMessage.type === "error"
                ? "bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800"
                : "bg-blue-50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800"
            }`}
          >
            {statusMessage.type === "success" && (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            )}
            {statusMessage.type === "error" && (
              <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* Verificando Token */}
        {verifyingToken && (
          <div className="py-8 text-center space-y-3">
            <RefreshCw className="w-6 h-6 text-indigo-600 animate-spin mx-auto" />
            <p className="text-xs text-slate-500">Validando sessão de recuperação no Supabase Auth...</p>
          </div>
        )}

        {/* CENÁRIO 1: Usuário possui token e o token é válido -> Formulário de Nova Senha */}
        {!verifyingToken && recoveryToken && isTokenValid !== false && (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div>
              <label className={labelCls}>Nova Senha</label>
              <div className="relative mt-1">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={6}
                  id="input-new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${inputCls} pr-10`}
                  placeholder="Mínimo 6 caracteres"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className={labelCls}>Confirmar Nova Senha</label>
              <div className="relative mt-1">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  required
                  minLength={6}
                  id="input-confirm-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={`${inputCls} pr-10`}
                  placeholder="Repita a nova senha"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
              <p>• A senha deve conter pelo menos 6 caracteres.</p>
              <p>• O token de recuperação é de uso único e expira em 60 minutos.</p>
            </div>

            <button
              type="submit"
              id="btn-save-new-password"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl shadow-md text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 transition-colors"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Salvando nova senha...</span>
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  <span>Redefinir Minha Senha</span>
                </>
              )}
            </button>
          </form>
        )}

        {/* CENÁRIO 2: Link Inválido ou Usuário sem Token -> Formulário de Solicitação de Link */}
        {!verifyingToken && (!recoveryToken || isTokenValid === false) && (
          <form onSubmit={handleRequestResetLink} className="space-y-4">
            <div>
              <label className={labelCls}>E-mail cadastrado</label>
              <div className="relative mt-1">
                <input
                  type="email"
                  required
                  id="input-recovery-email"
                  value={requestEmail}
                  onChange={(e) => setRequestEmail(e.target.value)}
                  className={`${inputCls} pl-10`}
                  placeholder="admin@eduhorarios.com.br"
                />
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              Você receberá um e-mail com um link seguro para criar sua nova senha. O link terá validade de 60 minutos.
            </p>

            <button
              type="submit"
              id="btn-send-recovery-link"
              disabled={loading || requestSubmitted}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl shadow-md text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 transition-colors"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Enviando solicitação...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Enviar link de recuperação</span>
                </>
              )}
            </button>
          </form>
        )}

        {/* Links de navegação */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-700/60 text-center">
          <button
            type="button"
            id="back-to-login-link"
            onClick={() => {
              setLocation("/login");
              window.location.hash = "/login";
            }}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Voltar para o login</span>
          </button>
        </div>
      </div>
    </div>
  );
}
