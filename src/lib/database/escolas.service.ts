import { supabase, isSupabaseConfigured } from "../supabase";

export interface EscolaData {
  id: string;
  nome: string;
  codigo?: string;
  cidade?: string;
  estado?: string;
  turnos?: string[];
  configuracao_horarios?: any;
  ativo?: boolean;
  created_at?: string;
  updated_at?: string;
}

export class EscolasDatabaseService {
  async listar(): Promise<EscolaData[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    const { data, error } = await supabase.from("escolas").select("*").order("nome");
    if (error || !data) return [];
    return data as EscolaData[];
  }

  async getById(id: string): Promise<EscolaData | null> {
    if (!isSupabaseConfigured || !supabase) return null;
    const { data, error } = await supabase.from("escolas").select("*").eq("id", id).maybeSingle();
    if (error || !data) return null;
    return data as EscolaData;
  }

  async salvar(escola: Partial<EscolaData>): Promise<EscolaData | null> {
    if (!isSupabaseConfigured || !supabase) return (escola as EscolaData) || null;
    if (escola.id) {
      const { data } = await supabase.from("escolas").update(escola).eq("id", escola.id).select().maybeSingle();
      return (data as EscolaData) || null;
    } else {
      const { data } = await supabase.from("escolas").insert(escola).select().maybeSingle();
      return (data as EscolaData) || null;
    }
  }

  async excluir(id: string): Promise<boolean> {
    if (!isSupabaseConfigured || !supabase) return true;
    const { error } = await supabase.from("escolas").delete().eq("id", id);
    return !error;
  }
}

export const escolasDbService = new EscolasDatabaseService();
