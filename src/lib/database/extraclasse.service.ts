import { supabase, isSupabaseConfigured } from "../supabase";

export interface AtividadeExtraclasseData {
  id?: string;
  escola_id?: string;
  user_id?: string;
  professor_id: string;
  tipo: string;
  descricao?: string;
  carga_horaria?: number;
  dia_semana?: string;
  horario?: string;
  created_at?: string;
  updated_at?: string;
}

export class ExtraclasseDatabaseService {
  async listar(escolaId?: string, professorId?: string): Promise<AtividadeExtraclasseData[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    let query = supabase.from("atividades_extraclasse").select("*");
    if (escolaId) query = query.eq("escola_id", escolaId);
    if (professorId) query = query.eq("professor_id", professorId);
    const { data, error } = await query;
    if (error || !data) return [];
    return data as AtividadeExtraclasseData[];
  }

  async salvar(atividade: AtividadeExtraclasseData): Promise<AtividadeExtraclasseData | null> {
    if (!isSupabaseConfigured || !supabase) return atividade;
    const { data, error } = await supabase.from("atividades_extraclasse").upsert(atividade).select().maybeSingle();
    if (error || !data) return null;
    return data as AtividadeExtraclasseData;
  }

  async excluir(id: string): Promise<boolean> {
    if (!isSupabaseConfigured || !supabase) return true;
    const { error } = await supabase.from("atividades_extraclasse").delete().eq("id", id);
    return !error;
  }
}

export const extraclasseDbService = new ExtraclasseDatabaseService();
