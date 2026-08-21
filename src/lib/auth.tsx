import { createContext, useContext, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "./supabase";
import { AuthService, UserProfile } from "@/services/AuthService";
import { setupRealtimeSync } from "@/store";
import { realtimeSyncManager } from "./realtimeSync";

export interface AuthUser {
  id: string;
  email?: string;
  user_metadata?: {
    full_name?: string;
    username?: string;
  };
}

interface AuthCtx {
  user: AuthUser | null;
  profile: UserProfile | null;
  loading: boolean;
  isSuperAdmin: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  profile: null,
  loading: true,
  isSuperAdmin: false,
  refreshProfile: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const loadUserData = async () => {
    try {
      if (isSupabaseConfigured && supabase) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const authUser: AuthUser = {
            id: session.user.id,
            email: session.user.email,
            user_metadata: session.user.user_metadata,
          };
          setUser(authUser);

          const profileData = await AuthService.getCurrentProfile();
          if (profileData) {
            setProfile(profileData);
            const isSuper = Boolean(
              profileData.is_super_admin ||
              profileData.perfil === "SUPER_ADMIN" ||
              profileData.role === "SUPER_ADMIN" ||
              profileData.cargo === "admin"
            );
            setIsSuperAdmin(isSuper);
            setupRealtimeSync(authUser.id, profileData.escola_id);
          } else {
            const fallbackAuthProfile: UserProfile = {
              id: authUser.id,
              auth_user_id: authUser.id,
              nome_completo: authUser.user_metadata?.full_name || authUser.email?.split("@")[0] || "Usuário",
              email: authUser.email || "",
              role: "GESTOR_ESCOLA",
              perfil: "GESTOR_ESCOLA",
              cargo: "Gestor Escolar",
              status: "ativo",
              is_super_admin: false,
            };
            setProfile(fallbackAuthProfile);
            setIsSuperAdmin(false);
            setupRealtimeSync(authUser.id, fallbackAuthProfile.escola_id);
          }
          setLoading(false);
          return;
        }
      }

      // Check localStorage fallback when Supabase session is not active
      const activeProfile = await AuthService.getCurrentProfile();
      if (activeProfile) {
        setUser({
          id: activeProfile.id,
          email: activeProfile.email,
          user_metadata: {
            full_name: activeProfile.nome_completo,
            username: activeProfile.nome_usuario || activeProfile.login,
          },
        });
        setProfile(activeProfile);
        const isSuper = Boolean(
          activeProfile.is_super_admin ||
          activeProfile.perfil === "SUPER_ADMIN" ||
          activeProfile.role === "SUPER_ADMIN" ||
          activeProfile.cargo === "admin"
        );
        setIsSuperAdmin(isSuper);
        setupRealtimeSync(activeProfile.id, activeProfile.escola_id);
        setLoading(false);
        return;
      }

      setUser(null);
      setProfile(null);
      setIsSuperAdmin(false);
      realtimeSyncManager.stop();
    } catch (err) {
      console.error("Erro ao carregar dados de autenticação:", err);
      setUser(null);
      setProfile(null);
      setIsSuperAdmin(false);
      realtimeSyncManager.stop();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUserData();

    if (isSupabaseConfigured && supabase) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
        if (session?.user) {
          await loadUserData();
        } else {
          setUser(null);
          setProfile(null);
          setIsSuperAdmin(false);
          setLoading(false);
          realtimeSyncManager.stop();
        }
      });

      return () => {
        subscription.unsubscribe();
        realtimeSyncManager.stop();
      };
    }
  }, []);

  const refreshProfile = async () => {
    await loadUserData();
  };

  const signOut = async () => {
    realtimeSyncManager.stop();
    await AuthService.logout();
    setUser(null);
    setProfile(null);
    setIsSuperAdmin(false);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        isSuperAdmin,
        refreshProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthCtx {
  return useContext(AuthContext);
}
