import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { useHashLocation } from "@/lib/hash-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import { AuthProvider, useAuth } from "@/lib/auth";
import { Layout } from "@/components/layout/Layout";
import { BootstrapService } from "@/services/BootstrapService";
import InitialSetupPage from "@/pages/InitialSetupPage";
import ErrorBoundary from "@/components/ErrorBoundary";
import LandingPage from "@/pages/LandingPage";
import PerfilPage from "@/pages/PerfilPage";
import Dashboard from "@/pages/Dashboard";
import Turmas from "@/pages/Turmas";
import Horarios from "@/pages/Horarios";
import Disciplinas from "@/pages/Disciplinas";
import Professores from "@/pages/Professores";
import Alocacao from "@/pages/Alocacao";
import Grade from "@/pages/Grade";
import GradeCompleta from "@/pages/GradeCompleta";
import Exportar from "@/pages/Exportar";
import ImportarArquivo from "@/pages/ImportarArquivo";
import ImportarBackup from "@/pages/ImportarBackup";
import HorariosGrade from "@/pages/HorariosGrade";
import LivroPonto from "@/pages/LivroPonto";
import ArquivoAnual from "@/pages/ArquivoAnual";
import ImportadorCSV from "@/pages/ImportadorCSV";
import AuthPage from "@/pages/AuthPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import Auditoria from "@/pages/Auditoria";
import Diagnostico from "@/pages/Diagnostico";
import Manutencao from "@/pages/Manutencao";
import MasterControl from "@/pages/MasterControl";

const queryClient = new QueryClient();

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, loading } = useAuth();
  const isModoLocal = localStorage.getItem("eduhorarios_modo_local") === "true";

  if (isModoLocal) return <Component />;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh]">
        <p className="text-sm text-muted-foreground animate-pulse">A verificar sessão…</p>
      </div>
    );
  }

  if (!user && !localStorage.getItem("eduhorarios_active_user_profile")) {
    return <Redirect to="/login" />;
  }

  return <Component />;
}

function Router() {
  useEffect(() => {
    // Run Bootstrap check on application initialization
    BootstrapService.executeBootstrapIfNeeded().catch((err) => {
      console.warn("Erro na inicialização do Bootstrap:", err);
    });
  }, []);

  return (
    <Switch>
      {/* ── Public / Master Control / Initial Setup ── */}
      <Route path="/">{() => <LandingPage />}</Route>
      <Route path="/login">{() => <AuthPage mode="login" />}</Route>
      <Route path="/cadastro">{() => <AuthPage mode="cadastro" />}</Route>
      <Route path="/recuperar-senha">{() => <ResetPasswordPage />}</Route>
      <Route path="/redefinir-senha">{() => <ResetPasswordPage />}</Route>
      <Route path="/reset-password">{() => <ResetPasswordPage />}</Route>
      <Route path="/configuracao-inicial">{() => <InitialSetupPage />}</Route>
      <Route path="/perfil">{() => <PerfilPage />}</Route>

      {/* ── Master Control Routes ── */}
      <Route path="/master-control">{() => <MasterControl tab="usuarios" />}</Route>
      <Route path="/master-control/usuarios">{() => <MasterControl tab="usuarios" />}</Route>
      <Route path="/master-control/escolas">{() => <MasterControl tab="escolas" />}</Route>
      <Route path="/master-control/auditoria">{() => <MasterControl tab="auditoria" />}</Route>
      <Route path="/master-control/configuracoes">{() => <MasterControl tab="configuracoes" />}</Route>
      <Route path="/master-control/banco">{() => <MasterControl tab="banco" />}</Route>
      <Route path="/admin/master">{() => <Redirect to="/master-control/usuarios" />}</Route>
      <Route path="/admin/usuarios">{() => <Redirect to="/master-control/usuarios" />}</Route>

      {/* ── Protected (sidebar Layout) ── */}
      <Route>
        {() => (
          <Layout>
            <Switch>
              <Route path="/painel">{() => <ProtectedRoute component={Dashboard} />}</Route>
              <Route path="/turmas">{() => <ProtectedRoute component={Turmas} />}</Route>
              <Route path="/horarios">{() => <ProtectedRoute component={Horarios} />}</Route>
              <Route path="/disciplinas">{() => <ProtectedRoute component={Disciplinas} />}</Route>
              <Route path="/professores">{() => <ProtectedRoute component={Professores} />}</Route>
              <Route path="/alocacao">{() => <ProtectedRoute component={Alocacao} />}</Route>
              <Route path="/grade">{() => <ProtectedRoute component={Grade} />}</Route>
              <Route path="/grade-completa">{() => <ProtectedRoute component={GradeCompleta} />}</Route>
              <Route path="/exportar">{() => <ProtectedRoute component={Exportar} />}</Route>
              <Route path="/importar">{() => <ProtectedRoute component={ImportarArquivo} />}</Route>
              <Route path="/importar-backup">{() => <ProtectedRoute component={ImportarBackup} />}</Route>
              <Route path="/horario">{() => <ProtectedRoute component={HorariosGrade} />}</Route>
              <Route path="/livro-ponto">{() => <ProtectedRoute component={LivroPonto} />}</Route>
              <Route path="/arquivo-anual">{() => <ProtectedRoute component={ArquivoAnual} />}</Route>
              <Route path="/importador-csv">{() => <ProtectedRoute component={ImportadorCSV} />}</Route>
              <Route path="/auditoria">{() => <ProtectedRoute component={Auditoria} />}</Route>
              <Route path="/diagnostico">{() => <ProtectedRoute component={Diagnostico} />}</Route>
              <Route path="/manutencao">{() => <ProtectedRoute component={Manutencao} />}</Route>
              <Route>{() => <Redirect to="/painel" />}</Route>
            </Switch>
          </Layout>
        )}
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <AuthProvider>
              <WouterRouter hook={useHashLocation}>
                <Router />
              </WouterRouter>
            </AuthProvider>
            <Toaster />
            <SonnerToaster position="top-right" richColors />
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
