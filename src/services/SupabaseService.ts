export class SupabaseService {
  async execute<T = any>(fn: () => Promise<any>): Promise<{ data: T | null; error: any }> {
    try {
      const res = await fn();
      if (res && typeof res === 'object' && 'data' in res) {
        return { data: (res.data ?? null) as T, error: res.error || null };
      }
      return { data: (res ?? null) as T, error: null };
    } catch (error) {
      console.warn("SupabaseService.execute error:", error);
      return { data: null, error };
    }
  }
}

export const supabaseService = new SupabaseService();
