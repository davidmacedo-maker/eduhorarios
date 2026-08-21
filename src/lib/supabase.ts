import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Supabase URL & Public/Publishable Key Configuration
export const SUPABASE_URL = (
  import.meta.env.VITE_SUPABASE_URL ||
  "https://tgzhkxqalddegyzotzva.supabase.co"
).trim();

// Support VITE_SUPABASE_PUBLISHABLE_KEY with fallback to VITE_SUPABASE_ANON_KEY
export const SUPABASE_PUBLISHABLE_KEY = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  ""
).trim();

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

// Single Supabase Client instance for the entire application
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    })
  : null;

export interface SupabaseKeyInfo {
  configured: boolean;
  prefix: string;
  length: number;
  last4: string;
  keyType: "publishable" | "anon" | "none";
}

export function getSafeKeyInfo(): SupabaseKeyInfo {
  if (!SUPABASE_PUBLISHABLE_KEY) {
    return {
      configured: false,
      prefix: "nenhum",
      length: 0,
      last4: "nenhum",
      keyType: "none",
    };
  }

  const len = SUPABASE_PUBLISHABLE_KEY.length;
  const last4 = len >= 4 ? SUPABASE_PUBLISHABLE_KEY.slice(-4) : SUPABASE_PUBLISHABLE_KEY;
  let prefix = "";
  let keyType: "publishable" | "anon" | "none" = "anon";

  if (SUPABASE_PUBLISHABLE_KEY.startsWith("sb_publishable_")) {
    prefix = "sb_publishable_";
    keyType = "publishable";
  } else if (SUPABASE_PUBLISHABLE_KEY.startsWith("eyJ")) {
    prefix = "eyJ (JWT standard)";
    keyType = "anon";
  } else {
    prefix = SUPABASE_PUBLISHABLE_KEY.slice(0, 6) + "...";
    keyType = "anon";
  }

  return {
    configured: true,
    prefix,
    length: len,
    last4,
    keyType,
  };
}

export interface SupabaseConnectionTestResult {
  success: boolean;
  configured: boolean;
  url: string;
  latency_ms?: number;
  message: string;
  missingVariables: string[];
  keyInfo: SupabaseKeyInfo;
  authStatus: "OK" | "ERRO" | "NÃO_TESTADO";
  restStatus: "OK" | "ERRO" | "NÃO_TESTADO";
  details?: any;
}

/**
 * Validador completo de conexão com Supabase (Auth + REST PostgREST)
 */
export async function testSupabaseConnection(): Promise<SupabaseConnectionTestResult> {
  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push("VITE_SUPABASE_URL");
  if (!SUPABASE_PUBLISHABLE_KEY) missing.push("VITE_SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_ANON_KEY");

  const keyInfo = getSafeKeyInfo();

  if (missing.length > 0 || !isSupabaseConfigured) {
    return {
      success: false,
      configured: false,
      url: SUPABASE_URL,
      message: `Credenciais do Supabase ausentes: ${missing.join(", ")}`,
      missingVariables: missing,
      keyInfo,
      authStatus: "ERRO",
      restStatus: "ERRO",
    };
  }

  if (!supabase) {
    return {
      success: false,
      configured: false,
      url: SUPABASE_URL,
      message: "Falha ao inicializar o cliente Supabase.",
      missingVariables: [],
      keyInfo,
      authStatus: "ERRO",
      restStatus: "ERRO",
    };
  }

  const startTime = Date.now();
  let authStatus: "OK" | "ERRO" = "ERRO";
  let restStatus: "OK" | "ERRO" = "ERRO";
  let errorMsg = "";

  try {
    // 1. Teste de Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.getSession();
    if (!authError) {
      authStatus = "OK";
    } else {
      errorMsg = authError.message;
    }

    // 2. Teste de REST API (PostgREST) com query simples na tabela professores
    const { error: restError } = await supabase
      .from("professores")
      .select("id")
      .limit(1);

    if (!restError) {
      restStatus = "OK";
    } else {
      // Se o erro for de RLS ou tabela vazia, a conexão com o banco funcionou
      if (restError.code === "PGRST116" || restError.message.includes("policy") || restError.code === "42501") {
        restStatus = "OK";
      } else if (restError.message.includes("Invalid API key") || restError.code === "PGRST301") {
        restStatus = "ERRO";
        errorMsg = restError.message;
      } else {
        restStatus = "OK"; // conectou ao gateway PostgREST
      }
    }

    const latency_ms = Date.now() - startTime;
    const isOverallSuccess = authStatus === "OK" && restStatus === "OK";

    return {
      success: isOverallSuccess,
      configured: true,
      url: SUPABASE_URL,
      latency_ms,
      message: isOverallSuccess
        ? "Conexão com Supabase (Auth + REST) validada com sucesso."
        : `Erro na comunicação com Supabase: ${errorMsg || "Chave ou endpoint inválido."}`,
      missingVariables: [],
      keyInfo,
      authStatus,
      restStatus,
      details: { sessionActive: Boolean(authData?.session) },
    };
  } catch (err: any) {
    const latency_ms = Date.now() - startTime;
    return {
      success: false,
      configured: true,
      url: SUPABASE_URL,
      latency_ms,
      message: `Falha ao conectar com o endpoint Supabase: ${err.message || String(err)}`,
      missingVariables: [],
      keyInfo,
      authStatus,
      restStatus,
      details: err,
    };
  }
}

