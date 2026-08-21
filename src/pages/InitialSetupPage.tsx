import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { AuthService, UserProfile } from "@/services/AuthService";
import { BootstrapService } from "@/services/BootstrapService";
import { toast } from "sonner";
import {
  ShieldCheck,
  Lock,
  KeyRound,
  User,
  Mail,
  Phone,
  Briefcase,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRight,
  Shield,
  Eye,
  EyeOff,
  Grid3x3,
  Camera,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export default function InitialSetupPage() {
  const [, setLocation] = useLocation();

  const navigate = (path: string) => {
    setLocation(path);
    window.location.hash = path;
  };

  const [currentProfile, setCurrentProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);

  // Form Fields
  const [novoLogin, setNovoLogin] = useState("");
  const [novoEmail, setNovoEmail] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [nomeCompleto, setNomeCompleto] = useState("");
  const [telefone, setTelefone] = useState("");
  const [cargo, setCargo] = useState("Super Administrador Master");
  const [fotoUrl, setFotoUrl] = useState("");

  // Visibility toggles
  const [showNovaSenha, setShowNovaSenha] = useState(false);
  const [showConfirmarSenha, setShowConfirmarSenha] = useState(false);

  useEffect(() => {
    async function loadUser() {
      setInitializing(true);
      const profile = await AuthService.getCurrentProfile();
      if (!profile) {
        // Fallback local check
        const local = localStorage.getItem("eduhorarios_bootstrap_root_profile");
        if (local) {
          try {
            setCurrentProfile(JSON.parse(local));
          } catch {
            // ignore
          }
        }
      } else {
        setCurrentProfile(profile);
        if (profile.nome_completo && profile.nome_completo !== "Super Administrador Master") {
          setNomeCompleto(profile.nome_completo);
        }
        if (profile.email && profile.email !== "root@educacao.mg.gov.br") {
          setNovoEmail(profile.email);
        }
      }
      setInitializing(false);
    }
    loadUser();
  }, []);

  // Password Validations
  const hasMinLength = novaSenha.length >= 8;
  const hasUppercase = /[A-Z]/.test(novaSenha);
  const hasLowercase = /[a-z]/.test(novaSenha);
  const hasNumber = /[0-9]/.test(novaSenha);
  const hasSpecial = /[^a-zA-Z0-9]/.test(novaSenha);
  const passwordsMatch = novaSenha.length > 0 && novaSenha === confirmarSenha;

  const forbiddenList = [
    "123456",
    "12345678",
    "123456789",
    "1234567890",
    "password",
    "admin",
    "root",
    "qwerty",
    "mudar123",
    "senha123",
    "12345678a",
    "12345678a!",
  ];
  const isForbidden = forbiddenList.some((f) => novaSenha.toLowerCase() === f);

  const isFormValid =
    novoLogin.trim().length >= 3 &&
    novoEmail.trim().length >= 5 &&
    novoEmail.includes("@") &&
    hasMinLength &&
    hasUppercase &&
    hasLowercase &&
    hasNumber &&
    hasSpecial &&
    !isForbidden &&
    passwordsMatch;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log("[PASSO 1: BOTÃO CLICADO - FORMULÁRIO ENVIADO]");

    console.log("[PASSO 2: VALIDAÇÃO INICIADA]", { novoLogin, novoEmail });

    if (novoLogin.trim().length < 3) {
      console.error("[PASSO 2: ERRO VALIDAÇÃO - LOGIN INVÁLIDO]", novoLogin);
      toast.error("Informe um novo login de acesso válido (mínimo de 3 caracteres).");
      return;
    }

    if (novoEmail.trim().length < 5 || !novoEmail.includes("@")) {
      console.error("[PASSO 2: ERRO VALIDAÇÃO - EMAIL INVÁLIDO]", novoEmail);
      toast.error("Informe um e-mail institucional válido.");
      return;
    }

    console.log("[PASSO 3: VALIDANDO SENHA]", {
      hasMinLength,
      hasUppercase,
      hasLowercase,
      hasNumber,
      hasSpecial,
      isForbidden,
      passwordsMatch,
    });

    if (!hasMinLength || !hasUppercase || !hasLowercase || !hasNumber || !hasSpecial) {
      console.error("[PASSO 3: ERRO VALIDAÇÃO - REQUISITOS DE SENHA NÃO ATENDIDOS]");
      toast.error("A nova senha precisa ter no mínimo 8 caracteres, com letra maiúscula, minúscula, número e símbolo (!@#$%^&* etc.).");
      return;
    }

    if (isForbidden) {
      console.error("[PASSO 3: ERRO VALIDAÇÃO - TERMO DE SENHA PROIBIDO]");
      toast.error("A senha informada é considerada muito simples. Escolha uma senha mais forte.");
      return;
    }

    if (!passwordsMatch) {
      console.error("[PASSO 3: ERRO VALIDAÇÃO - SENHAS NÃO COINCIDEM]");
      toast.error("A confirmação da senha não é igual à nova senha digitada.");
      return;
    }

    setLoading(true);
    try {
      const targetUserId = currentProfile?.id || "usr-root-bootstrap-master";

      const res = await BootstrapService.completeInitialSetup({
        userId: targetUserId,
        novoLogin: novoLogin.trim(),
        novoEmail: novoEmail.trim(),
        novaSenha,
        nomeCompleto: nomeCompleto.trim() || "Super Administrador Master",
        telefone: telefone.trim(),
        cargo: cargo.trim() || "admin",
        fotoUrl: fotoUrl.trim(),
      });

      console.log("[PASSO 9: CONFIRMAÇÃO DE SUCESSO]", res);
      toast.success(res.message || "Configuração inicial concluída com sucesso!");

      console.log("[PASSO 10: REDIRECIONANDO SEGURO PARA MASTER CONTROL]");
      navigate("/master-control");
    } catch (err: any) {
      console.error("[ERRO DURANTE CONFIGURAÇÃO INICIAL]", err);
      toast.error(err.message || "Erro ao salvar a configuração inicial.");
    } finally {
      setLoading(false);
    }
  };

  if (initializing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-indigo-600 dark:text-indigo-500 animate-pulse" />
          <span className="text-sm font-medium">Carregando painel de configuração inicial...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col justify-center items-center p-4 sm:p-8 transition-colors">
      <div className="max-w-2xl w-full space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-100 dark:bg-indigo-950/80 border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 mb-2 shadow-sm">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <div className="flex items-center justify-center gap-2">
            <Badge variant="outline" className="bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800 text-[10px] uppercase font-mono tracking-widest px-2.5 py-0.5">
              Bootstrap Inicial do Sistema
            </Badge>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Configuração Inicial do Administrador
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 max-w-lg mx-auto leading-relaxed">
            Sua conta de <strong className="text-indigo-600 dark:text-indigo-300">Super Administrador</strong> foi ativada com as credenciais padrão do Bootstrap (<code className="bg-slate-200 dark:bg-slate-900 px-1.5 py-0.5 rounded text-indigo-700 dark:text-indigo-300 border border-slate-300 dark:border-slate-800">Root</code> / <code className="bg-slate-200 dark:bg-slate-900 px-1.5 py-0.5 rounded text-indigo-700 dark:text-indigo-300 border border-slate-300 dark:border-slate-800">12345678</code>). Configure seus dados definitivos para liberar o acesso à plataforma.
          </p>
        </div>

        {/* Security Warning Notice */}
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-xl p-4 flex gap-3 text-amber-800 dark:text-amber-200 text-xs leading-relaxed">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <strong className="text-amber-900 dark:text-amber-300 font-semibold uppercase tracking-wider block text-[11px]">
              Substituição Obrigatória de Credenciais
            </strong>
            <p>
              Esta tela será exibida <strong>apenas uma vez</strong> no primeiro acesso do sistema. Após salvar estas informações, o usuário <code className="font-mono bg-amber-100 dark:bg-amber-900/60 px-1 rounded text-amber-900 dark:text-white">Root</code> e a senha temporária serão desativados permanentemente.
            </p>
          </div>
        </div>

        {/* Form Container */}
        <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-xl">
          {/* Section 1: Credenciais Obrigatórias */}
          <div className="space-y-4">
            <div className="border-b border-slate-200 dark:border-slate-800 pb-2 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 flex items-center gap-2">
                <KeyRound className="w-4 h-4" />
                Novas Credenciais de Acesso (Obrigatórias)
              </h2>
              <span className="text-[10px] text-slate-500 font-mono">* Obrigatório</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Novo Login */}
              <div className="space-y-1.5">
                <Label htmlFor="novoLogin" className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  Novo Login de Acesso *
                </Label>
                <Input
                  id="novoLogin"
                  type="text"
                  required
                  placeholder="ex: carlos.master"
                  value={novoLogin}
                  onChange={(e) => setNovoLogin(e.target.value.toLowerCase().replace(/\s+/g, ""))}
                  className="bg-background border-input text-foreground text-xs h-9 font-mono"
                />
                <p className="text-[10px] text-slate-500">Substituirá o login provisório 'Root'</p>
              </div>

              {/* Novo Email */}
              <div className="space-y-1.5">
                <Label htmlFor="novoEmail" className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  Novo E-mail Institucional *
                </Label>
                <Input
                  id="novoEmail"
                  type="email"
                  required
                  placeholder="ex: admin@educacao.mg.gov.br"
                  value={novoEmail}
                  onChange={(e) => setNovoEmail(e.target.value)}
                  className="bg-background border-input text-foreground text-xs h-9 font-mono"
                />
                <p className="text-[10px] text-slate-500">Utilizado para notificações e recuperação</p>
              </div>
            </div>

            {/* Senhas */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              {/* Nova Senha */}
              <div className="space-y-1.5">
                <Label htmlFor="novaSenha" className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  Nova Senha Forte *
                </Label>
                <div className="relative">
                  <Input
                    id="novaSenha"
                    type={showNovaSenha ? "text" : "password"}
                    required
                    placeholder="••••••••••••"
                    value={novaSenha}
                    onChange={(e) => setNovaSenha(e.target.value)}
                    className="bg-background border-input text-foreground text-xs h-9 pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNovaSenha(!showNovaSenha)}
                    className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                  >
                    {showNovaSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Confirmar Nova Senha */}
              <div className="space-y-1.5">
                <Label htmlFor="confirmarSenha" className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  Confirmar Nova Senha *
                </Label>
                <div className="relative">
                  <Input
                    id="confirmarSenha"
                    type={showConfirmarSenha ? "text" : "password"}
                    required
                    placeholder="••••••••••••"
                    value={confirmarSenha}
                    onChange={(e) => setConfirmarSenha(e.target.value)}
                    className="bg-background border-input text-foreground text-xs h-9 pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmarSenha(!showConfirmarSenha)}
                    className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                  >
                    {showConfirmarSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Checklist de Requisitos de Senha */}
            <div className="bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 space-y-2 text-xs">
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
                Requisitos da Nova Senha:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                <div className={`flex items-center gap-1.5 ${hasMinLength ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-slate-400"}`}>
                  {hasMinLength ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 shrink-0" />}
                  <span>Mínimo 8 caracteres</span>
                </div>

                <div className={`flex items-center gap-1.5 ${hasUppercase ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-slate-400"}`}>
                  {hasUppercase ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 shrink-0" />}
                  <span>Pelo menos 1 letra maiúscula (A-Z)</span>
                </div>

                <div className={`flex items-center gap-1.5 ${hasLowercase ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-slate-400"}`}>
                  {hasLowercase ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 shrink-0" />}
                  <span>Pelo menos 1 letra minúscula (a-z)</span>
                </div>

                <div className={`flex items-center gap-1.5 ${hasNumber ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-slate-400"}`}>
                  {hasNumber ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 shrink-0" />}
                  <span>Pelo menos 1 número (0-9)</span>
                </div>

                <div className={`flex items-center gap-1.5 ${hasSpecial ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-slate-400"}`}>
                  {hasSpecial ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 shrink-0" />}
                  <span>Caractere especial (!@#$%^&* etc.)</span>
                </div>

                <div className={`flex items-center gap-1.5 ${passwordsMatch ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-slate-400"}`}>
                  {passwordsMatch ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 shrink-0" />}
                  <span>Senhas coincidem</span>
                </div>
              </div>
              {isForbidden && (
                <div className="text-red-600 dark:text-red-400 text-[11px] font-semibold flex items-center gap-1 pt-1 border-t border-slate-200 dark:border-slate-800">
                  <XCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>A senha contém termos fracos proibidos (123456, admin, root, etc.).</span>
                </div>
              )}
            </div>
          </div>

          {/* Section 2: Dados Complementares (Opcionais) */}
          <div className="space-y-4 pt-2">
            <div className="border-b border-slate-200 dark:border-slate-800 pb-2 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-2">
                <User className="w-4 h-4 text-slate-500" />
                Perfil do Administrador (Opcional)
              </h2>
              <span className="text-[10px] text-slate-500 font-mono">Opcional</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Nome Completo */}
              <div className="space-y-1.5">
                <Label htmlFor="nomeCompleto" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Nome Completo
                </Label>
                <Input
                  id="nomeCompleto"
                  type="text"
                  placeholder="ex: Carlos Alberto de Macedo"
                  value={nomeCompleto}
                  onChange={(e) => setNomeCompleto(e.target.value)}
                  className="bg-background border-input text-foreground text-xs h-9"
                />
              </div>

              {/* Telefone */}
              <div className="space-y-1.5">
                <Label htmlFor="telefone" className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-slate-500" />
                  Telefone / WhatsApp
                </Label>
                <Input
                  id="telefone"
                  type="text"
                  placeholder="(31) 99887-6655"
                  value={telefone}
                  onChange={(e) => setTelefone(e.target.value)}
                  className="bg-background border-input text-foreground text-xs h-9"
                />
              </div>

              {/* Cargo */}
              <div className="space-y-1.5">
                <Label htmlFor="cargo" className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Briefcase className="w-3.5 h-3.5 text-slate-500" />
                  Cargo / Função
                </Label>
                <Input
                  id="cargo"
                  type="text"
                  placeholder="Super Administrador Geral"
                  value={cargo}
                  onChange={(e) => setCargo(e.target.value)}
                  className="bg-background border-input text-foreground text-xs h-9"
                />
              </div>

              {/* Foto URL */}
              <div className="space-y-1.5">
                <Label htmlFor="fotoUrl" className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Camera className="w-3.5 h-3.5 text-slate-500" />
                  URL da Foto de Perfil
                </Label>
                <Input
                  id="fotoUrl"
                  type="text"
                  placeholder="https://..."
                  value={fotoUrl}
                  onChange={(e) => setFotoUrl(e.target.value)}
                  className="bg-background border-input text-foreground text-xs h-9"
                />
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 text-xs font-bold uppercase tracking-wider bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                "Gravando configurações e revogando credenciais Root..."
              ) : (
                <span className="flex items-center justify-center gap-2">
                  Concluir Configuração e Acessar Master Control
                  <ArrowRight className="w-4 h-4" />
                </span>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
