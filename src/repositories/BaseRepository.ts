import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export interface PaginationResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * BaseRepository
 * Camada base desacoplada de persistência.
 * Na Fase 1, mantém dados temporários em memória (sem depender de localStorage como banco principal),
 * estruturada para receber as chamadas diretas ao Supabase na Fase 2.
 */
export abstract class BaseRepository<T extends Record<string, any>> {
  // Armazenamento temporário em memória para o runtime
  protected memoryStore: Map<string, T> = new Map();

  constructor(protected tableName: string) {}

  /**
   * Listar todos os registros
   */
  async listar(tenantId?: string): Promise<T[]> {
    if (isSupabaseConfigured && supabase) {
      // Chamada preparada para Supabase
      const { data, error } = await supabase.from(this.tableName).select("*");
      if (!error && data) return data as T[];
    }
    const items = Array.from(this.memoryStore.values());
    if (tenantId) {
      return items.filter((item: any) => item.tenant_id === tenantId || item.user_id === tenantId);
    }
    return items;
  }

  /**
   * Buscar registro único por ID
   */
  async buscarPorId(id: string): Promise<T | null> {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.from(this.tableName).select("*").eq("id", id).maybeSingle();
      if (!error && data) return data as T;
    }
    return this.memoryStore.get(id) || null;
  }

  /**
   * Criar novo registro
   */
  async criar(item: T, tenantId?: string): Promise<T | null> {
    const payload = tenantId ? { ...item, tenant_id: tenantId, user_id: tenantId } : item;
    const id = payload.id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `item-${Date.now()}`);
    const record = { ...payload, id };

    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.from(this.tableName).insert(record as any).select().maybeSingle();
      if (!error && data) return data as T;
    }

    this.memoryStore.set(id, record as T);
    return record as T;
  }

  /**
   * Editar registro existente
   */
  async editar(id: string, changes: Partial<T>): Promise<T | null> {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.from(this.tableName).update(changes as any).eq("id", id).select().maybeSingle();
      if (!error && data) return data as T;
    }

    const current = this.memoryStore.get(id);
    if (!current) return null;
    const updated = { ...current, ...changes };
    this.memoryStore.set(id, updated);
    return updated;
  }

  /**
   * Excluir registro por ID
   */
  async excluir(id: string): Promise<boolean> {
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.from(this.tableName).delete().eq("id", id);
      return !error;
    }
    return this.memoryStore.delete(id);
  }

  /**
   * Listagem paginada
   */
  async paginar(
    page: number = 1,
    limit: number = 10,
    tenantId?: string,
    searchField?: string,
    searchValue?: string
  ): Promise<PaginationResult<T>> {
    let items = Array.from(this.memoryStore.values());

    if (tenantId) {
      items = items.filter((item: any) => item.tenant_id === tenantId || item.user_id === tenantId);
    }

    if (searchField && searchValue) {
      const term = searchValue.toLowerCase();
      items = items.filter((item: any) => {
        const val = item[searchField];
        return val && String(val).toLowerCase().includes(term);
      });
    }

    const total = items.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const from = (page - 1) * limit;
    const data = items.slice(from, from + limit);

    return {
      data,
      total,
      page,
      limit,
      totalPages,
    };
  }
}
