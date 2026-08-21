import { supabase, isSupabaseConfigured } from "../supabase";

export interface LogAuditoriaData {
  id?: string;
  escola_id?: string;
  admin_id?: string;
  admin_nome?: string;
  usuario_afetado_id?: string;
  usuario_afetado_nome?: string;
  acao: string;
  detalhes?: string;
  resultado?: string;
  ip_origem?: string;
  data_hora?: string;
  created_at?: string;
}

export class AuditoriaDatabaseService {
  async registrarLog(log: LogAuditoriaData): Promise<boolean> {
    if (!isSupabaseConfigured || !supabase) return true;
    try {
      const { error } = await supabase.from("auditoria").insert(log);
      return !error;
    } catch {
      return false;
    }
  }

  async listarLogs(escolaId?: string, limit: number = 50): Promise<LogAuditoriaData[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    let query = supabase.from("auditoria").select("*").order("data_hora", { ascending: false }).limit(limit);
    if (escolaId) {
      query = query.eq("escola_id", escolaId);
    }
    const { data, error } = await query;
    if (error || !data) return [];
    return data as LogAuditoriaData[];
  }
}

export const auditoriaDbService = new AuditoriaDatabaseService();
