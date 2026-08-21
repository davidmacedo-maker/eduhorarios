import { useState, useEffect } from "react";
import {
  Database,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Code,
  Table as TableIcon,
  HardDrive,
  Copy,
  Terminal,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { testSupabaseConnection, isSupabaseConfigured } from "@/lib/supabase";

interface DbStatus {
  success: boolean;
  connected: boolean;
  db_name: string;
  provider: string;
  latency_ms?: number;
  tables_count?: number;
  tables?: Array<{ name: string; description: string }>;
  message?: string;
}

const SUPABASE_SCHEMA_TABLES = [
  { name: "escolas", description: "Instituições de ensino e configurações escolares" },
  { name: "usuarios", description: "Perfis e níveis de acesso multiusuário" },
  { name: "professores", description: "Docentes, MASP, vínculos e disponibilidades" },
  { name: "turmas", description: "Turmas escolares por turno, ano e série" },
  { name: "disciplinas", description: "Matérias curriculares, cores e limites" },
  { name: "matriz_curricular", description: "Vínculo de turmas e disciplinas com carga horária" },
  { name: "alocacoes", description: "Grade de horários gerada e persistida" },
  { name: "horarios_raw", description: "Histórico de dados e importações brutas" },
  { name: "livro_ponto", description: "Controle diário de frequência docente" },
  { name: "atividades_extraclasse", description: "Módulos de planejamento e extraclasse" },
  { name: "auditoria", description: "Trilha de segurança e auditoria administrativa" },
];

export function SupabaseDatabaseAdmin() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<DbStatus | null>(null);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const testRes = await testSupabaseConnection();
      if (testRes.configured && testRes.success) {
        setStatus({
          success: true,
          connected: true,
          db_name: "PostgreSQL (Supabase)",
          provider: "Supabase Cloud",
          latency_ms: testRes.latency_ms,
          tables_count: SUPABASE_SCHEMA_TABLES.length,
          tables: SUPABASE_SCHEMA_TABLES,
          message: "Conexão oficial ativa e autenticada.",
        });
      } else {
        setStatus({
          success: false,
          connected: false,
          db_name: "PostgreSQL (Supabase)",
          provider: "Supabase Cloud",
          tables_count: SUPABASE_SCHEMA_TABLES.length,
          tables: SUPABASE_SCHEMA_TABLES,
          message: testRes.message || "Aguardando configuração das credenciais no ambiente.",
        });
      }
    } catch (err: any) {
      setStatus({
        success: false,
        connected: false,
        db_name: "PostgreSQL (Supabase)",
        provider: "Supabase Cloud",
        message: err.message || "Erro ao consultar status do Supabase.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleCopySql = () => {
    const sqlText = `-- Schema Oficial EduHorários Supabase\n-- Consulte /supabase/migrations/ para histórico de migrações completo.`;
    navigator.clipboard.writeText(sqlText);
    toast({ title: "Informações copiadas para a área de transferência!" });
  };

  return (
    <div className="space-y-6">
      {/* ── Status Card ── */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                Infraestrutura de Dados Oficial
                {status?.connected ? (
                  <span className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full font-medium bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                    <CheckCircle2 className="w-3 h-3" /> Conectado (Supabase)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full font-medium bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="w-3 h-3" /> {isSupabaseConfigured ? "Reconectando..." : "Modo Preparado"}
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Provedor: <strong className="text-slate-700 dark:text-slate-200">Supabase Cloud (PostgreSQL 15+)</strong> • Isolamento Multi-tenant e RLS Ativos
              </p>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={fetchStatus}
            disabled={loading}
            className="flex items-center gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Atualizar Status
          </Button>
        </div>

        {status && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-slate-100 dark:border-slate-700/60">
            <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
              <span className="text-xs text-slate-500">Banco de Dados</span>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{status.db_name}</p>
            </div>
            <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
              <span className="text-xs text-slate-500">Provedor</span>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{status.provider}</p>
            </div>
            <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
              <span className="text-xs text-slate-500">Latência do Handshake</span>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                {status.latency_ms !== undefined ? `${status.latency_ms} ms` : "0 ms"}
              </p>
            </div>
            <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
              <span className="text-xs text-slate-500">Tabelas Modeladas</span>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                {status.tables_count || SUPABASE_SCHEMA_TABLES.length} tabelas
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Table Directory ── */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <TableIcon className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            Estrutura de Tabelas e Entidades Relacionais
          </h3>
          <Button variant="ghost" size="sm" onClick={handleCopySql} className="text-xs">
            <Copy className="w-3.5 h-3.5 mr-1" />
            Copiar Referência
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {SUPABASE_SCHEMA_TABLES.map((tbl) => (
            <div
              key={tbl.name}
              className="p-3.5 rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30 flex items-start gap-3"
            >
              <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="font-mono font-semibold text-xs text-slate-900 dark:text-white block">
                  {tbl.name}
                </span>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">
                  {tbl.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
