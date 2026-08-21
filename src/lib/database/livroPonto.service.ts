import { supabase, isSupabaseConfigured } from "../supabase";

export interface RegistroPontoDbData {
  id?: string;
  escola_id?: string;
  user_id?: string;
  alocacao_id: string;
  professor_id?: string;
  data: string;
  presente: boolean;
  observacao?: string;
  valor?: string;
  created_at?: string;
  updated_at?: string;
}

export class LivroPontoDatabaseService {
  async listar(escolaId?: string, dataFiltro?: string): Promise<RegistroPontoDbData[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    let query = supabase.from("livro_ponto").select("*");
    if (escolaId) query = query.eq("escola_id", escolaId);
    if (dataFiltro) query = query.eq("data", dataFiltro);
    const { data, error } = await query;
    if (error || !data) return [];
    return data as RegistroPontoDbData[];
  }

  async salvar(registro: RegistroPontoDbData): Promise<RegistroPontoDbData | null> {
    if (!isSupabaseConfigured || !supabase) return registro;
    const { data, error } = await supabase.from("livro_ponto").upsert(registro).select().maybeSingle();
    if (error || !data) return null;
    return data as RegistroPontoDbData;
  }

  async excluir(id: string): Promise<boolean> {
    if (!isSupabaseConfigured || !supabase) return true;
    const { error } = await supabase.from("livro_ponto").delete().eq("id", id);
    return !error;
  }
}

export const livroPontoDbService = new LivroPontoDatabaseService();
