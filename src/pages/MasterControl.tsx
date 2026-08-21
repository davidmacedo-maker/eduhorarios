import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { AuthService, UserProfile } from "@/services/AuthService";
import {
  usuariosRepository,
  MasterUserFilters,
  LogAuditoriaMaster,
} from "@/repositories/UsuariosRepository";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ShieldAlert,
  Search,
  Plus,
  RefreshCw,
  Edit2,
  Lock,
  Unlock,
  KeyRound,
  Trash2,
  ChevronLeft,
  ChevronRight,
  School,
  Users,
  UserCheck,
  UserX,
  Mail,
  X,
  CheckCircle2,
  AlertTriangle,
  Grid3x3,
  ArrowLeft,
  User,
  LogOut,
  Settings,
  Building2,
  ShieldCheck,
  Database,
  Sliders,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";

import { SupabaseDatabaseAdmin } from "@/components/master/SupabaseDatabaseAdmin";

interface MasterControlProps {
  tab?: "usuarios" | "escolas" | "auditoria" | "configuracoes" | "banco";
}

export default function MasterControl({ tab: initialTab }: MasterControlProps) {
  const { toast } = useToast();
  const [location, setLocation] = useLocation();

  // Active Tab derived from URL or props
  const activeTab = useMemo(() => {
    if (location.includes("/master-control/banco")) return "banco";
    if (location.includes("/master-control/escolas")) return "escolas";
    if (location.includes("/master-control/auditoria")) return "auditoria";
    if (location.includes("/master-control/configuracoes")) return "configuracoes";
    if (location.includes("/master-control/usuarios")) return "usuarios";
    return initialTab || "usuarios";
  }, [location, initialTab]);

  const [currentAdmin, setCurrentAdmin] = useState<UserProfile | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean>(true);
  const [checkingAuth, setCheckingAuth] = useState<boolean>(true);

  // Users & State
  const [usuarios, setUsuarios] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [page, setPage] = useState<number>(1);
  const [limit] = useState<number>(10);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [total, setTotal] = useState<number>(0);

  // Audit Logs State
  const [logsAuditoria, setLogsAuditoria] = useState<LogAuditoriaMaster[]>([]);
  const [loadingLogs, setLoadingLogs] = useState<boolean>(false);

  // Filters
  const [filters, setFilters] = useState<MasterUserFilters>({
    search: "",
    escola: "todas",
    cidade: "todas",
    status: "todos",
  });

  // Modal States
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [tempPassModalOpen, setTempPassModalOpen] = useState(false);

  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [userToDelete, setUserToDelete] = useState<UserProfile | null>(null);
  const [generatedTempPass, setGeneratedTempPass] = useState("");

  // Forms
  const [createForm, setCreateForm] = useState({
    nome_completo: "",
    email: "",
    senhaTemporaria: "Edu@" + Math.random().toString(36).substring(2, 8).toUpperCase() + "!",
    telefone: "",
    escola_nome: "",
    cidade: "",
    estado: "MG",
    perfil: "GESTOR_ESCOLA",
    status: "ativo",
  });

  const [editForm, setEditForm] = useState({
    nome_completo: "",
    nome_usuario: "",
    email: "",
    telefone: "",
    escola_nome: "",
    cidade: "",
    estado: "MG",
    perfil: "GESTOR_ESCOLA",
    status: "ativo",
    observacoes: "",
    nova_senha: "",
  });

  // Navigation back to login
  const handleBackToSchoolSystem = () => {
    setLocation("/login");
  };

  // Load Auth & Check Permissions
  useEffect(() => {
    async function verifyPermission() {
      setCheckingAuth(true);
      const profile = await AuthService.getCurrentProfile();
      setCurrentAdmin(profile);

      if (profile && (profile.force_password_change || profile.first_login || profile.is_bootstrap)) {
        setLocation("/configuracao-inicial");
        return;
      }

      const isSuper = await AuthService.isSuperAdmin();
      setIsSuperAdmin(isSuper);
      setCheckingAuth(false);
    }
    verifyPermission();
  }, []);

  // Fetch Users
  const fetchUsuarios = async () => {
    setLoading(true);
    try {
      const res = await usuariosRepository.listarPerfisMaster(page, limit, filters);
      setUsuarios(res.data);
      setTotalPages(res.totalPages);
      setTotal(res.total);
    } catch (err: any) {
      toast({
        title: "Erro ao carregar dados",
        description: err.message || "Falha na comunicação com Supabase.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Fetch Audit Logs when tab is auditoria
  const fetchAuditLogs = async () => {
    setLoadingLogs(true);
    try {
      const logs = await usuariosRepository.listarLogsAuditoriaMaster(50);
      setLogsAuditoria(logs);
    } catch {
      // Ignore fallback
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    if (isSuperAdmin) {
      fetchUsuarios();
    }
  }, [page, filters, isSuperAdmin]);

  useEffect(() => {
    if (isSuperAdmin && activeTab === "auditoria") {
      fetchAuditLogs();
    }
  }, [activeTab, isSuperAdmin]);

  // Derived Summary Counts
  const summary = useMemo(() => {
    const escolasSet = new Set<string>();
    let ativos = 0;
    let bloqueados = 0;

    usuarios.forEach((u) => {
      if (u.escola_nome) escolasSet.add(u.escola_nome);
      if (u.status === "ativo") ativos++;
      if (u.status === "bloqueado") bloqueados++;
    });

    return {
      totalEscolas: escolasSet.size,
      totalUsuarios: total || usuarios.length,
      usuariosAtivos: ativos,
      usuariosBloqueados: bloqueados,
    };
  }, [usuarios, total]);

  // Derived Unique Options for Select Filters
  const uniqueEscolas = useMemo(() => {
    const set = new Set<string>();
    usuarios.forEach((u) => u.escola_nome && set.add(u.escola_nome));
    return Array.from(set).sort();
  }, [usuarios]);

  const uniqueCidades = useMemo(() => {
    const set = new Set<string>();
    usuarios.forEach((u) => u.cidade && set.add(u.cidade));
    return Array.from(set).sort();
  }, [usuarios]);

  // Unique Schools List for Escolas View
  const escolasLista = useMemo(() => {
    const map = new Map<string, {
      escola_nome: string;
      cidade: string;
      estado: string;
      responsaveisCount: number;
      ultimoResponsavel: string;
      email: string;
      telefone: string;
      status: string;
    }>();

    usuarios.forEach((u) => {
      if (!u.escola_nome) return;
      const key = u.escola_nome.toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          escola_nome: u.escola_nome,
          cidade: u.cidade || "—",
          estado: u.estado || "MG",
          responsaveisCount: 1,
          ultimoResponsavel: u.nome_completo,
          email: u.email || "—",
          telefone: u.telefone || "—",
          status: u.status || "ativo",
        });
      } else {
        const item = map.get(key)!;
        item.responsaveisCount += 1;
      }
    });

    return Array.from(map.values());
  }, [usuarios]);

  // Logout handler
  const handleLogout = async () => {
    await AuthService.logout();
    toast({
      title: "Sessão encerrada",
      description: "Você saiu com sucesso do Master Control.",
    });
    setLocation("/login");
  };

  // Action: Create New User
  const handleCreateUser = async () => {
    if (!createForm.nome_completo || !createForm.email || !createForm.escola_nome) {
      toast({
        title: "Campos obrigatórios",
        description: "Preencha o Nome do Responsável, E-mail de Acesso e Nome da Escola.",
        variant: "destructive",
      });
      return;
    }

    try {
      const created = await usuariosRepository.criarUsuarioMaster({
        nome_completo: createForm.nome_completo,
        email: createForm.email,
        telefone: createForm.telefone,
        escola_nome: createForm.escola_nome,
        cidade: createForm.cidade,
        estado: createForm.estado,
        perfil: createForm.perfil as any,
        status: createForm.status as any,
        senhaTemporaria: createForm.senhaTemporaria,
      });

      await usuariosRepository.registrarAuditoriaMaster({
        admin_id: currentAdmin?.id || "admin-master",
        admin_nome: currentAdmin?.nome_completo || "Administrador Master",
        acao: "CRIACAO_USUARIO_ESCOLA",
        usuario_afetado_id: created.id,
        usuario_afetado_nome: created.nome_completo,
        escola: created.escola_nome,
        detalhes: `Novo responsável cadastrado para ${created.escola_nome} (${created.email})`,
      });

      toast({
        title: "Usuário cadastrado com sucesso!",
        description: `O perfil de ${created.nome_completo} para a escola ${created.escola_nome} foi registrado.`,
      });

      setCreateModalOpen(false);
      setCreateForm({
        nome_completo: "",
        email: "",
        senhaTemporaria: "Edu@" + Math.random().toString(36).substring(2, 8).toUpperCase() + "!",
        telefone: "",
        escola_nome: "",
        cidade: "",
        estado: "MG",
        perfil: "GESTOR_ESCOLA",
        status: "ativo",
      });

      fetchUsuarios();
    } catch (err: any) {
      toast({
        title: "Erro ao cadastrar usuário",
        description: err.message || "Ocorreu uma falha na criação do usuário.",
        variant: "destructive",
      });
    }
  };

  // Action: Open Edit Modal
  const handleOpenEdit = (user: UserProfile) => {
    setSelectedUser(user);
    setEditForm({
      nome_completo: user.nome_completo,
      nome_usuario: user.nome_usuario || user.email?.split("@")[0] || "",
      email: user.email || "",
      telefone: user.telefone || "",
      escola_nome: user.escola_nome || "",
      cidade: user.cidade || "",
      estado: user.estado || "MG",
      perfil: user.perfil || "GESTOR_ESCOLA",
      status: user.status || "ativo",
      observacoes: user.observacoes || "",
      nova_senha: "",
    });
    setEditModalOpen(true);
  };

  // Action: Save Edit
  const handleSaveEdit = async () => {
    if (!selectedUser) return;
    try {
      const updated = await usuariosRepository.redefinirSenhaEUsuarioMaster(selectedUser.id, editForm);
      if (updated) {
        setUsuarios((prev) =>
          prev.map((u) => (u.id === selectedUser.id ? { ...u, ...updated } : u))
        );
      } else {
        setUsuarios((prev) =>
          prev.map((u) => (u.id === selectedUser.id ? { ...u, ...editForm } : u))
        );
      }

      await usuariosRepository.registrarAuditoriaMaster({
        admin_id: currentAdmin?.id || "admin-master",
        admin_nome: currentAdmin?.nome_completo || "Administrador Master",
        acao: "EDICAO_USUARIO_ESCOLA",
        usuario_afetado_id: selectedUser.id,
        usuario_afetado_nome: editForm.nome_completo,
        escola: editForm.escola_nome,
        detalhes: `Dados do usuário/escola atualizados no Master Control. ${editForm.nova_senha ? "(Senha redefinida com sucesso)" : ""}`,
      });

      toast({
        title: "Cadastro atualizado!",
        description: `Dados de ${editForm.nome_completo} salvos com sucesso.`,
      });

      setEditModalOpen(false);
      setSelectedUser(null);
    } catch (err: any) {
      toast({
        title: "Erro na atualização",
        description: err.message || "Não foi possível salvar as alterações.",
        variant: "destructive",
      });
    }
  };

  // Action: Toggle Lock Status
  const handleToggleBlock = async (user: UserProfile) => {
    const newStatus = user.status === "bloqueado" ? "ativo" : "bloqueado";
    const acaoLabel = newStatus === "bloqueado" ? "BLOQUEIO_USUARIO" : "DESBLOQUEIO_USUARIO";

    try {
      await usuariosRepository.atualizarPerfilMaster(user.id, { status: newStatus });
      setUsuarios((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, status: newStatus } : u))
      );

      await usuariosRepository.registrarAuditoriaMaster({
        admin_id: currentAdmin?.id || "admin-master",
        admin_nome: currentAdmin?.nome_completo || "Administrador Master",
        acao: acaoLabel,
        usuario_afetado_id: user.id,
        usuario_afetado_nome: user.nome_completo,
        escola: user.escola_nome,
        detalhes: `Status alterado para: ${newStatus}`,
      });

      toast({
        title: newStatus === "bloqueado" ? "Acesso Bloqueado" : "Acesso Desbloqueado",
        description: `O login de ${user.nome_completo} foi ${newStatus === "bloqueado" ? "suspenso" : "liberado"}.`,
      });
    } catch (err: any) {
      toast({
        title: "Erro ao alterar status",
        description: err.message,
        variant: "destructive",
      });
    }
  };

  // Action: Reset Password
  const handleSendResetEmail = async (user: UserProfile) => {
    if (!user.email) return;
    try {
      await AuthService.sendPasswordResetEmail(user.email);
      await usuariosRepository.registrarAuditoriaMaster({
        admin_id: currentAdmin?.id || "admin-master",
        admin_nome: currentAdmin?.nome_completo || "Administrador Master",
        acao: "REDEFINICAO_SENHA_EMAIL",
        usuario_afetado_id: user.id,
        usuario_afetado_nome: user.nome_completo,
        escola: user.escola_nome,
        detalhes: `Link de redefinição enviado para: ${user.email}`,
      });

      toast({
        title: "E-mail enviado!",
        description: `Link de redefinição enviado para ${user.email}`,
      });
    } catch (err: any) {
      toast({
        title: "Erro ao enviar e-mail",
        description: err.message,
        variant: "destructive",
      });
    }
  };

  // Action: Generate Temp Password
  const handleGenerateTempPassword = async (user: UserProfile) => {
    setSelectedUser(user);
    const pass = "Edu@" + Math.random().toString(36).substring(2, 8).toUpperCase() + "!";
    setGeneratedTempPass(pass);
    setTempPassModalOpen(true);

    try {
      await usuariosRepository.redefinirSenhaEUsuarioMaster(user.id, {
        nova_senha: pass,
      });

      await usuariosRepository.registrarAuditoriaMaster({
        admin_id: currentAdmin?.id || "admin-master",
        admin_nome: currentAdmin?.nome_completo || "Administrador Master",
        acao: "GERACAO_SENHA_TEMPORARIA",
        usuario_afetado_id: user.id,
        usuario_afetado_nome: user.nome_completo,
        escola: user.escola_nome,
        detalhes: `Senha temporária emitida: ${pass}`,
      });
    } catch (err) {
      console.warn("Aviso ao registrar senha temporária:", err);
    }
  };

  // Action: Confirm Delete
  const handleConfirmDelete = async () => {
    if (!userToDelete) return;
    try {
      await usuariosRepository.excluirUsuarioMaster(userToDelete.id);
      setUsuarios((prev) => prev.filter((u) => u.id !== userToDelete.id));
      setTotal((t) => Math.max(0, t - 1));

      await usuariosRepository.registrarAuditoriaMaster({
        admin_id: currentAdmin?.id || "admin-master",
        admin_nome: currentAdmin?.nome_completo || "Administrador Master",
        acao: "EXCLUSAO_DEFINITIVA_USUARIO",
        usuario_afetado_id: userToDelete.id,
        usuario_afetado_nome: userToDelete.nome_completo,
        escola: userToDelete.escola_nome,
        detalhes: `Exclusão total de conta e vínculos com a escola ${userToDelete.escola_nome}`,
      });

      toast({
        title: "Usuário excluído com sucesso",
        description: `A conta de ${userToDelete.nome_completo} e os vínculos da escola ${userToDelete.escola_nome} foram removidos.`,
      });

      setDeleteModalOpen(false);
      setUserToDelete(null);
    } catch (err: any) {
      toast({
        title: "Erro ao excluir usuário",
        description: err.message,
        variant: "destructive",
      });
    }
  };

  // Access check loading state
  if (checkingAuth) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50 dark:bg-slate-950">
        <RefreshCw className="w-5 h-5 animate-spin text-indigo-600 mr-2" />
        <span className="text-xs font-mono text-slate-500">
          A verificar credenciais do Master Control...
        </span>
      </div>
    );
  }

  // 403 Forbidden Screen if not SUPER_ADMIN
  if (!isSuperAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-950">
        <div className="max-w-md w-full text-center space-y-4 p-8 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-md">
          <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-950/60 text-red-600 mx-auto flex items-center justify-center">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white uppercase tracking-wider">
            Acesso Restrito (403)
          </h2>
          <p className="text-xs text-slate-500 leading-relaxed">
            Acesso restrito ao Administrador Geral. Esta área é reservada para
            o controle master da plataforma EduHorários.
          </p>
          <Button
            size="sm"
            onClick={handleBackToSchoolSystem}
            className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-medium cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
            Voltar ao EduHorários
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      {/* ── HEADER DO MASTER CONTROL ── */}
      <header className="sticky top-0 z-30 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-8 py-3 flex flex-wrap items-center justify-between gap-4 shadow-xs">
        {/* Left Side: Logo EduHorários + Title */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
              <Grid3x3 className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="text-sm font-bold tracking-tight text-slate-900 dark:text-white hidden sm:inline">
              EduHorários
            </span>
          </div>

          <div className="h-6 w-px bg-slate-200 dark:bg-slate-800 mx-1" />

          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-black tracking-widest text-indigo-600 dark:text-indigo-400 uppercase">
                MASTER CONTROL
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium leading-none mt-0.5">
              Central Administrativa da Plataforma
            </p>
          </div>
        </div>

        {/* Right Side: Botão Voltar + User Info + Sair */}
        <div className="flex items-center gap-3 ml-auto">
          <Button
            size="sm"
            variant="outline"
            onClick={handleBackToSchoolSystem}
            className="h-8 text-xs font-semibold border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5 mr-1.5 text-indigo-600 dark:text-indigo-400" />
            Voltar ao EduHorários
          </Button>

          <div className="hidden lg:flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 border-l border-slate-200 dark:border-slate-800 pl-3">
            <User className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-medium max-w-[150px] truncate">
              {currentAdmin?.nome_completo || currentAdmin?.email || "Super Admin"}
            </span>
          </div>

          <Button
            size="sm"
            variant="ghost"
            onClick={handleLogout}
            className="h-8 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
            title="Sair da sessão"
          >
            <LogOut className="w-3.5 h-3.5 mr-1" />
            Sair
          </Button>
        </div>
      </header>

      {/* ── SUB-NAVIGATION TABS BAR ── */}
      <div className="bg-white dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-8">
        <div className="flex gap-2 py-2 overflow-x-auto">
          <button
            onClick={() => setLocation("/master-control/usuarios")}
            className={cn(
              "px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 cursor-pointer select-none",
              activeTab === "usuarios"
                ? "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 shadow-2xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            )}
          >
            <Users className="w-3.5 h-3.5" />
            Usuários & Responsáveis
          </button>

          <button
            onClick={() => setLocation("/master-control/escolas")}
            className={cn(
              "px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 cursor-pointer select-none",
              activeTab === "escolas"
                ? "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 shadow-2xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            )}
          >
            <School className="w-3.5 h-3.5" />
            Escolas Cadastradas
          </button>

          <button
            onClick={() => setLocation("/master-control/auditoria")}
            className={cn(
              "px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 cursor-pointer select-none",
              activeTab === "auditoria"
                ? "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 shadow-2xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            )}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            Auditoria Master
          </button>

          <button
            onClick={() => setLocation("/master-control/configuracoes")}
            className={cn(
              "px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 cursor-pointer select-none",
              activeTab === "configuracoes"
                ? "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 shadow-2xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            )}
          >
            <Settings className="w-3.5 h-3.5" />
            Configurações
          </button>

          <button
            onClick={() => setLocation("/master-control/banco")}
            className={cn(
              "px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 cursor-pointer select-none",
              activeTab === "banco"
                ? "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 shadow-2xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            )}
          >
            <Database className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            Banco Supabase
          </button>
        </div>
      </div>

      {/* ── MAIN CONTENT BODY ── */}
      <main className="flex-1 p-4 sm:p-8 space-y-6 max-w-7xl mx-auto w-full">
        {/* TAB 1: USUÁRIOS & RESPONSÁVEIS */}
        {activeTab === "usuarios" && (
          <>
            {/* Action Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Gestão de Usuários e Responsáveis
                </h2>
                <p className="text-xs text-slate-500">
                  Controle de contas, acessos e vínculos das escolas da rede.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={fetchUsuarios}
                  className="h-8 text-xs border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
                  Atualizar
                </Button>

                <Button
                  size="sm"
                  onClick={() => setCreateModalOpen(true)}
                  className="h-8 text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-medium"
                >
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  Novo Usuário
                </Button>
              </div>
            </div>

            {/* SUMMARY CARDS */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-4 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-2xs">
                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  Total de Escolas
                </div>
                <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                  {summary.totalEscolas}
                </div>
              </div>

              <div className="p-4 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-2xs">
                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  Total de Usuários
                </div>
                <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                  {summary.totalUsuarios}
                </div>
              </div>

              <div className="p-4 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-2xs">
                <div className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                  Usuários Ativos
                </div>
                <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                  {summary.usuariosAtivos}
                </div>
              </div>

              <div className="p-4 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-2xs">
                <div className="text-[11px] font-semibold text-red-600 dark:text-red-400 uppercase tracking-wider">
                  Usuários Bloqueados
                </div>
                <div className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1">
                  {summary.usuariosBloqueados}
                </div>
              </div>
            </div>

            {/* FILTERS & SEARCH */}
            <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row gap-3 items-center shadow-2xs">
              <div className="relative flex-1 w-full">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                <Input
                  placeholder="Pesquisar por nome, escola, e-mail ou cidade..."
                  value={filters.search}
                  onChange={(e) => {
                    setFilters((f) => ({ ...f, search: e.target.value }));
                    setPage(1);
                  }}
                  className="pl-8 h-8 text-xs border-slate-200 dark:border-slate-800"
                />
              </div>

              <div className="w-full md:w-48">
                <Select
                  value={filters.escola}
                  onValueChange={(val) => {
                    setFilters((f) => ({ ...f, escola: val }));
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="h-8 text-xs border-slate-200 dark:border-slate-800">
                    <SelectValue placeholder="Todas as Escolas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas as Escolas</SelectItem>
                    {uniqueEscolas.map((e) => (
                      <SelectItem key={e} value={e}>
                        {e}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="w-full md:w-44">
                <Select
                  value={filters.cidade}
                  onValueChange={(val) => {
                    setFilters((f) => ({ ...f, cidade: val }));
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="h-8 text-xs border-slate-200 dark:border-slate-800">
                    <SelectValue placeholder="Todas as Cidades" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas as Cidades</SelectItem>
                    {uniqueCidades.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="w-full md:w-36">
                <Select
                  value={filters.status}
                  onValueChange={(val) => {
                    setFilters((f) => ({ ...f, status: val }));
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="h-8 text-xs border-slate-200 dark:border-slate-800">
                    <SelectValue placeholder="Todos os Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos os Status</SelectItem>
                    <SelectItem value="ativo">Ativo</SelectItem>
                    <SelectItem value="bloqueado">Bloqueado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* TABELA PRINCIPAL DE USUÁRIOS */}
            <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100/70 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      <th className="p-3 pl-4">Responsável / Usuário</th>
                      <th className="p-3">Escola Vinculada</th>
                      <th className="p-3">Cidade / UF</th>
                      <th className="p-3">Contato</th>
                      <th className="p-3">Perfil</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Último Acesso</th>
                      <th className="p-3 pr-4 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {loading ? (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-slate-400">
                          <RefreshCw className="w-4 h-4 animate-spin inline mr-2" />
                          Carregando lista de usuários...
                        </td>
                      </tr>
                    ) : usuarios.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-slate-400">
                          Nenhum usuário encontrado para os filtros selecionados.
                        </td>
                      </tr>
                    ) : (
                      usuarios.map((u) => (
                        <tr
                          key={u.id}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="p-3 pl-4 font-medium text-slate-900 dark:text-white">
                            <div>{u.nome_completo}</div>
                            <div className="text-[10px] text-slate-400 font-mono">
                              {u.nome_usuario || u.email}
                            </div>
                          </td>

                          <td className="p-3 text-slate-700 dark:text-slate-300">
                            <div className="flex items-center gap-1.5 font-medium">
                              <School className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span className="truncate max-w-[180px]">
                                {u.escola_nome || "—"}
                              </span>
                            </div>
                          </td>

                          <td className="p-3 text-slate-600 dark:text-slate-400">
                            {u.cidade ? `${u.cidade} - ${u.estado || "MG"}` : "—"}
                          </td>

                          <td className="p-3 text-slate-600 dark:text-slate-400">
                            <div className="text-[11px] truncate max-w-[160px]">{u.email}</div>
                            {u.telefone && (
                              <div className="text-[10px] text-slate-400">{u.telefone}</div>
                            )}
                          </td>

                          <td className="p-3">
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] font-bold border-0 px-2 py-0.5",
                                u.perfil === "SUPER_ADMIN"
                                  ? "bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300"
                                  : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                              )}
                            >
                              {u.perfil === "SUPER_ADMIN" ? "SUPER_ADMIN" : "GESTOR_ESCOLA"}
                            </Badge>
                          </td>

                          <td className="p-3">
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] font-semibold border-0 px-2 py-0.5",
                                u.status === "ativo"
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                                  : "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300"
                              )}
                            >
                              {u.status === "ativo" ? "Ativo" : "Bloqueado"}
                            </Badge>
                          </td>

                          <td className="p-3 text-slate-500 text-[11px]">
                            {u.ultimo_acesso
                              ? new Date(u.ultimo_acesso).toLocaleDateString("pt-BR", {
                                  day: "2-digit",
                                  month: "2-digit",
                                  year: "2-digit",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "Nunca"}
                          </td>

                          <td className="p-3 pr-4 text-right space-x-1 whitespace-nowrap">
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Editar Informações"
                              onClick={() => handleOpenEdit(u)}
                              className="w-7 h-7 hover:bg-slate-200 dark:hover:bg-slate-800"
                            >
                              <Edit2 className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
                            </Button>

                            <Button
                              size="icon"
                              variant="ghost"
                              title={u.status === "bloqueado" ? "Desbloquear Acesso" : "Bloquear Acesso"}
                              onClick={() => handleToggleBlock(u)}
                              className="w-7 h-7 hover:bg-slate-200 dark:hover:bg-slate-800"
                            >
                              {u.status === "bloqueado" ? (
                                <Unlock className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Lock className="w-3.5 h-3.5 text-amber-600" />
                              )}
                            </Button>

                            <Button
                              size="icon"
                              variant="ghost"
                              title="Enviar Link de Senha por E-mail"
                              onClick={() => handleSendResetEmail(u)}
                              className="w-7 h-7 hover:bg-slate-200 dark:hover:bg-slate-800"
                            >
                              <Mail className="w-3.5 h-3.5 text-sky-600" />
                            </Button>

                            <Button
                              size="icon"
                              variant="ghost"
                              title="Gerar Senha Temporária"
                              onClick={() => handleGenerateTempPassword(u)}
                              className="w-7 h-7 hover:bg-slate-200 dark:hover:bg-slate-800"
                            >
                              <KeyRound className="w-3.5 h-3.5 text-purple-600" />
                            </Button>

                            <Button
                              size="icon"
                              variant="ghost"
                              title="Excluir Definitivamente"
                              onClick={() => {
                                setUserToDelete(u);
                                setDeleteModalOpen(true);
                              }}
                              className="w-7 h-7 hover:bg-red-100 dark:hover:bg-red-950/50"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-red-600" />
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* PAGINAÇÃO */}
              <div className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
                <div>
                  Página <strong className="text-slate-900 dark:text-white">{page}</strong> de{" "}
                  <strong className="text-slate-900 dark:text-white">{totalPages}</strong> (
                  {total} registros)
                </div>

                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="h-7 px-2 text-xs"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="h-7 px-2 text-xs"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* TAB 2: ESCOLAS CADASTRADAS */}
        {activeTab === "escolas" && (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Escolas Cadastradas na Plataforma
              </h2>
              <p className="text-xs text-slate-500">
                Visão consolidada das unidades escolares registradas e seus responsáveis principais.
              </p>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100/70 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      <th className="p-3 pl-4">Nome da Escola</th>
                      <th className="p-3">Cidade / Estado</th>
                      <th className="p-3">Responsável Principal</th>
                      <th className="p-3">E-mail de Contato</th>
                      <th className="p-3">Telefone</th>
                      <th className="p-3">Total Contas</th>
                      <th className="p-3 pr-4">Status Acesso</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {escolasLista.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-slate-400">
                          Nenhuma escola registrada no momento.
                        </td>
                      </tr>
                    ) : (
                      escolasLista.map((escola, idx) => (
                        <tr
                          key={idx}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="p-3 pl-4 font-bold text-slate-900 dark:text-white">
                            <div className="flex items-center gap-2">
                              <Building2 className="w-4 h-4 text-indigo-600 shrink-0" />
                              <span>{escola.escola_nome}</span>
                            </div>
                          </td>
                          <td className="p-3 text-slate-600 dark:text-slate-400">
                            {escola.cidade} - {escola.estado}
                          </td>
                          <td className="p-3 font-medium text-slate-800 dark:text-slate-200">
                            {escola.ultimoResponsavel}
                          </td>
                          <td className="p-3 text-slate-600 dark:text-slate-400 font-mono text-[11px]">
                            {escola.email}
                          </td>
                          <td className="p-3 text-slate-600 dark:text-slate-400">
                            {escola.telefone}
                          </td>
                          <td className="p-3 font-bold text-slate-700 dark:text-slate-300">
                            {escola.responsaveisCount}
                          </td>
                          <td className="p-3 pr-4">
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] font-semibold border-0 px-2 py-0.5",
                                escola.status === "ativo"
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                                  : "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300"
                              )}
                            >
                              {escola.status === "ativo" ? "Ativo" : "Bloqueado"}
                            </Badge>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: AUDITORIA MASTER */}
        {activeTab === "auditoria" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Logs de Auditoria Administrativa
                </h2>
                <p className="text-xs text-slate-500">
                  Registro completo de ações realizadas na Central Master Control.
                </p>
              </div>

              <Button
                size="sm"
                variant="outline"
                onClick={fetchAuditLogs}
                className="h-8 text-xs"
              >
                <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", loadingLogs && "animate-spin")} />
                Atualizar Logs
              </Button>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100/70 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      <th className="p-3 pl-4">Data / Hora</th>
                      <th className="p-3">Administrador</th>
                      <th className="p-3">Ação Realizada</th>
                      <th className="p-3">Usuário Afetado</th>
                      <th className="p-3">Escola</th>
                      <th className="p-3">Detalhes</th>
                      <th className="p-3 pr-4">Resultado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {loadingLogs ? (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-slate-400">
                          <RefreshCw className="w-4 h-4 animate-spin inline mr-2" />
                          Carregando histórico de auditoria...
                        </td>
                      </tr>
                    ) : logsAuditoria.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-slate-400">
                          Nenhum evento registrado no histórico recente.
                        </td>
                      </tr>
                    ) : (
                      logsAuditoria.map((log, idx) => (
                        <tr
                          key={log.id || idx}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="p-3 pl-4 font-mono text-[11px] text-slate-500">
                            {log.data_hora
                              ? new Date(log.data_hora).toLocaleString("pt-BR")
                              : "—"}
                          </td>
                          <td className="p-3 font-medium text-slate-900 dark:text-white">
                            {log.admin_nome}
                          </td>
                          <td className="p-3 font-bold text-indigo-600 dark:text-indigo-400">
                            {log.acao}
                          </td>
                          <td className="p-3 text-slate-700 dark:text-slate-300">
                            {log.usuario_afetado_nome || log.usuario_afetado_id}
                          </td>
                          <td className="p-3 text-slate-600 dark:text-slate-400">
                            {log.escola || "—"}
                          </td>
                          <td className="p-3 text-slate-500 max-w-xs truncate" title={log.detalhes}>
                            {log.detalhes || "—"}
                          </td>
                          <td className="p-3 pr-4">
                            <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-[10px] border-0">
                              {log.resultado || "SUCESSO"}
                            </Badge>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: CONFIGURAÇÕES DA PLATAFORMA */}
        {activeTab === "configuracoes" && (
          <div className="space-y-6 max-w-4xl">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Configurações da Central Master Control
              </h2>
              <p className="text-xs text-slate-500">
                Regras de segurança, políticas de vinculação e parâmetros da plataforma.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-5 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 space-y-3 shadow-2xs">
                <div className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-white">
                  <ShieldCheck className="w-4 h-4 text-indigo-600" />
                  Política de Vínculo das Escolas
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Modo padrão ativado: 1 Escola = 1 Usuário Responsável Principal. Previne duplicidade de contas na mesma unidade de ensino.
                </p>
                <div className="pt-2">
                  <Badge variant="outline" className="bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border-indigo-200 text-xs">
                    Regra Ativa: Restrição por Escola
                  </Badge>
                </div>
              </div>

              <div className="p-5 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 space-y-3 shadow-2xs">
                <div className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-white">
                  <Database className="w-4 h-4 text-indigo-600" />
                  Região e Parâmetros
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Estado Padrão: <strong>MG (Minas Gerais)</strong>. Fusos horários e validações de e-mail institucional pré-configurados.
                </p>
                <div className="pt-2">
                  <Badge variant="outline" className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300 text-xs">
                    UF Padrão: MG
                  </Badge>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: GESTÃO DO BANCO SUPABASE */}
        {activeTab === "banco" && (
          <SupabaseDatabaseAdmin />
        )}
      </main>

      {/* MODAL: NOVO USUÁRIO */}
      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
              <Plus className="w-4 h-4 text-indigo-600" />
              Novo Usuário e Escola
            </DialogTitle>
            <DialogDescription className="text-xs">
              Cadastre o responsável e os dados da escola vinculada.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2 text-xs">
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-[11px] font-semibold">Nome do Responsável *</Label>
              <Input
                placeholder="Ex: Prof. Roberto Carlos"
                value={createForm.nome_completo}
                onChange={(e) => setCreateForm({ ...createForm, nome_completo: e.target.value })}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] font-semibold">E-mail de Acesso *</Label>
              <Input
                placeholder="email@escola.mg.gov.br"
                value={createForm.email}
                onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] font-semibold">Telefone / WhatsApp</Label>
              <Input
                placeholder="(31) 99999-0000"
                value={createForm.telefone}
                onChange={(e) => setCreateForm({ ...createForm, telefone: e.target.value })}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label className="text-[11px] font-semibold">Nome da Escola *</Label>
              <Input
                placeholder="Ex: E.E. Governador Milton Campos"
                value={createForm.escola_nome}
                onChange={(e) => setCreateForm({ ...createForm, escola_nome: e.target.value })}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] font-semibold">Cidade</Label>
              <Input
                placeholder="Belo Horizonte"
                value={createForm.cidade}
                onChange={(e) => setCreateForm({ ...createForm, cidade: e.target.value })}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] font-semibold">Estado (UF)</Label>
              <Input
                placeholder="MG"
                value={createForm.estado}
                onChange={(e) => setCreateForm({ ...createForm, estado: e.target.value })}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] font-semibold">Perfil</Label>
              <Select
                value={createForm.perfil}
                onValueChange={(val) => setCreateForm({ ...createForm, perfil: val })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GESTOR_ESCOLA">GESTOR_ESCOLA (Padrão)</SelectItem>
                  <SelectItem value="SUPER_ADMIN">SUPER_ADMIN (Plataforma)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] font-semibold">Status Inicial</Label>
              <Select
                value={createForm.status}
                onValueChange={(val) => setCreateForm({ ...createForm, status: val })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ativo">Ativo</SelectItem>
                  <SelectItem value="bloqueado">Bloqueado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label className="text-[11px] font-semibold">Senha Temporária Gerada</Label>
              <Input
                readOnly
                value={createForm.senhaTemporaria}
                className="h-8 text-xs font-mono bg-slate-100 dark:bg-slate-800 text-emerald-600 font-bold"
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCreateModalOpen(false)}
              className="h-8 text-xs"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleCreateUser}
              className="h-8 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              Salvar Cadastro
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL: EDITAR USUÁRIO */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
              <Edit2 className="w-4 h-4 text-indigo-600" />
              Editar Cadastro do Responsável
            </DialogTitle>
            <DialogDescription className="text-xs">
              Atualize as informações do usuário e da escola.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2 text-xs">
            <div className="space-y-1">
              <Label className="text-[11px] font-semibold">Nome do Responsável</Label>
              <Input
                value={editForm.nome_completo}
                onChange={(e) => setEditForm({ ...editForm, nome_completo: e.target.value })}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] font-semibold">Nome de Usuário (Login)</Label>
              <Input
                value={editForm.nome_usuario}
                onChange={(e) => setEditForm({ ...editForm, nome_usuario: e.target.value })}
                placeholder="Ex: gestor.escola"
                className="h-8 text-xs font-mono"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] font-semibold">E-mail de Acesso</Label>
              <Input
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] font-semibold">Telefone / WhatsApp</Label>
              <Input
                value={editForm.telefone}
                onChange={(e) => setEditForm({ ...editForm, telefone: e.target.value })}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label className="text-[11px] font-semibold">Nome da Escola</Label>
              <Input
                value={editForm.escola_nome}
                onChange={(e) => setEditForm({ ...editForm, escola_nome: e.target.value })}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] font-semibold">Cidade</Label>
              <Input
                value={editForm.cidade}
                onChange={(e) => setEditForm({ ...editForm, cidade: e.target.value })}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] font-semibold">Estado (UF)</Label>
              <Input
                value={editForm.estado}
                onChange={(e) => setEditForm({ ...editForm, estado: e.target.value })}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] font-semibold">Perfil de Acesso</Label>
              <Select
                value={editForm.perfil}
                onValueChange={(val) => setEditForm({ ...editForm, perfil: val })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GESTOR_ESCOLA">Gestor Escolar</SelectItem>
                  <SelectItem value="SUPER_ADMIN">Super Administrador (Master)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] font-semibold">Status do Acesso</Label>
              <Select
                value={editForm.status}
                onValueChange={(val) => setEditForm({ ...editForm, status: val })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ativo">Ativo</SelectItem>
                  <SelectItem value="bloqueado">Bloqueado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-400">
                Redefinir Senha do Usuário (Opcional)
              </Label>
              <Input
                type="password"
                placeholder="Deixe em branco para manter a senha atual..."
                value={editForm.nova_senha}
                onChange={(e) => setEditForm({ ...editForm, nova_senha: e.target.value })}
                className="h-8 text-xs border-indigo-200 dark:border-indigo-800"
              />
              <p className="text-[10px] text-muted-foreground">
                Preencha caso deseje redefinir a senha deste usuário diretamente pelo Master Control.
              </p>
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label className="text-[11px] font-semibold">Observações Internas</Label>
              <Input
                placeholder="Anotações técnicas ou administrativas sobre este cliente..."
                value={editForm.observacoes}
                onChange={(e) => setEditForm({ ...editForm, observacoes: e.target.value })}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditModalOpen(false)}
              className="h-8 text-xs"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleSaveEdit}
              className="h-8 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              Salvar Alterações
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL: EXCLUIR USUÁRIO */}
      <Dialog open={deleteModalOpen} onOpenChange={setDeleteModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold text-red-600 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Confirmar Exclusão de Cadastro
            </DialogTitle>
          </DialogHeader>

          <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded space-y-2 text-xs">
            <div>
              <span className="text-slate-500">Escola:</span>{" "}
              <strong className="text-slate-900 dark:text-white">
                {userToDelete?.escola_nome || "—"}
              </strong>
            </div>
            <div>
              <span className="text-slate-500">Responsável:</span>{" "}
              <strong className="text-slate-900 dark:text-white">
                {userToDelete?.nome_completo} ({userToDelete?.email})
              </strong>
            </div>
            <div className="text-red-600 dark:text-red-400 font-bold text-[11px] pt-1">
              Esta ação não poderá ser desfeita. Todos os dados de autenticação e perfis vinculados a esta escola serão excluídos permanentemente.
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteModalOpen(false)}
              className="h-8 text-xs"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleConfirmDelete}
              className="h-8 text-xs"
            >
              Excluir Definitivamente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL: SENHA TEMPORÁRIA */}
      <Dialog open={tempPassModalOpen} onOpenChange={setTempPassModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-purple-600" />
              Senha Temporária Gerada
            </DialogTitle>
            <DialogDescription className="text-xs">
              Forneça a senha abaixo ao responsável da escola:
            </DialogDescription>
          </DialogHeader>

          <div className="p-4 bg-slate-900 text-emerald-400 font-mono text-center rounded text-sm font-bold tracking-widest my-2 select-all">
            {generatedTempPass}
          </div>

          <p className="text-[11px] text-slate-500 text-center">
            Esta senha permite o acesso imediato. O usuário deverá alterá-la no próximo login.
          </p>

          <DialogFooter>
            <Button
              size="sm"
              onClick={() => setTempPassModalOpen(false)}
              className="h-8 text-xs bg-slate-900 text-white"
            >
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
