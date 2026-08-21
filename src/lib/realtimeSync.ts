// src/lib/realtimeSync.ts
import { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "./supabase";
import { fetchRemoteData, resolveUserId } from "./apiSync";
import { applyRealtimeBatchSync } from "@/store";
import { toast } from "@/hooks/use-toast";
import { AuthService } from "@/services/AuthService";

export type RealtimeStatus = "connected" | "connecting" | "disconnected" | "error";

type StatusListener = (status: RealtimeStatus) => void;

class RealtimeSyncManager {
  private channel: RealtimeChannel | null = null;
  private status: RealtimeStatus = "disconnected";
  private statusListeners = new Set<StatusListener>();
  private activeUserId: string | null = null;
  private activeEscolaId: string | null = null;
  private isSuperAdmin: boolean = false;
  private debounceTimer: any = null;
  private reconnectTimer: any = null;
  private isSubscribed = false;
  private lastConflictToast = 0;

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => this.handleOnline());
      window.addEventListener("offline", () => this.handleOffline());
      window.addEventListener("focus", () => this.handleFocus());
    }
  }

  public getStatus(): RealtimeStatus {
    return this.status;
  }

  public subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private setStatus(newStatus: RealtimeStatus) {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.statusListeners.forEach((fn) => {
        try {
          fn(newStatus);
        } catch (err) {
          console.error("Error notifying status listener:", err);
        }
      });
    }
  }

  public async start(userId: string, escolaId?: string) {
    if (!isSupabaseConfigured || !supabase) {
      this.setStatus("disconnected");
      return;
    }

    const resolved = resolveUserId(userId);
    if (!resolved || resolved === "local") {
      this.setStatus("disconnected");
      return;
    }

    // Determine school context if not passed
    let currentEscolaId = escolaId;
    if (!currentEscolaId) {
      try {
        const profile = await AuthService.getCurrentProfile();
        if (profile?.escola_id) {
          currentEscolaId = profile.escola_id;
        }
        this.isSuperAdmin = Boolean(
          profile?.is_super_admin ||
          profile?.perfil === "SUPER_ADMIN" ||
          profile?.role === "SUPER_ADMIN"
        );
      } catch {}
    }

    if (
      this.isSubscribed &&
      this.activeUserId === resolved &&
      this.activeEscolaId === (currentEscolaId || null)
    ) {
      return;
    }

    this.activeUserId = resolved;
    this.activeEscolaId = currentEscolaId || null;
    this.initChannel();
  }

  public stop() {
    if (this.channel) {
      try {
        supabase?.removeChannel(this.channel);
      } catch (err) {
        console.warn("Erro ao remover canal Realtime:", err);
      }
      this.channel = null;
    }
    this.isSubscribed = false;
    this.setStatus("disconnected");
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  private initChannel() {
    if (!supabase || !this.activeUserId) return;

    this.stop();
    this.setStatus("connecting");

    try {
      const schoolTag = this.activeEscolaId ? `esc-${this.activeEscolaId}` : `usr-${this.activeUserId}`;
      const channelName = `eduhorarios-sync-${schoolTag}-${Date.now()}`;

      this.channel = supabase
        .channel(channelName)
        // 1. Professores
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "professores" },
          (payload) => this.handleTableChange("professores", payload)
        )
        // 2. Turmas
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "turmas" },
          (payload) => this.handleTableChange("turmas", payload)
        )
        // 3. Disciplinas
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "disciplinas" },
          (payload) => this.handleTableChange("disciplinas", payload)
        )
        // 4. Matriz Curricular
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "matriz_curricular" },
          (payload) => this.handleTableChange("matriz_curricular", payload)
        )
        // 5. Alocações (Grade)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "alocacoes" },
          (payload) => this.handleTableChange("alocacoes", payload)
        )
        // 6. Horários Brutos
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "horarios_raw" },
          (payload) => this.handleTableChange("horarios_raw", payload)
        )
        // 7. Livro Ponto
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "livro_ponto" },
          (payload) => this.handleTableChange("livro_ponto", payload)
        )
        // 8. Histórico de Grades (Snapshots)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "historico_grades" },
          (payload) => this.handleTableChange("historico_grades", payload)
        )
        .subscribe((status, err) => {
          if (status === "SUBSCRIBED") {
            this.isSubscribed = true;
            this.setStatus("connected");
          } else if (status === "CLOSED" || status === "TIMED_OUT") {
            this.isSubscribed = false;
            this.setStatus("disconnected");
            this.scheduleReconnect();
          } else if (status === "CHANNEL_ERROR") {
            console.warn("Erro no canal Supabase Realtime:", err);
            this.isSubscribed = false;
            this.setStatus("error");
            this.scheduleReconnect();
          }
        });
    } catch (err) {
      console.error("Falha ao inicializar Supabase Realtime:", err);
      this.setStatus("error");
      this.scheduleReconnect();
    }
  }

  private isEventAllowedForCurrentTenant(payload: any): boolean {
    if (this.isSuperAdmin && !this.activeEscolaId) {
      return true;
    }

    const newRecord = payload.new as any;
    const oldRecord = payload.old as any;

    // School Isolation check
    if (this.activeEscolaId) {
      if (newRecord && newRecord.escola_id && newRecord.escola_id !== this.activeEscolaId) {
        return false;
      }
      if (oldRecord && oldRecord.escola_id && oldRecord.escola_id !== this.activeEscolaId) {
        return false;
      }
    }

    // User Isolation check if no school is set
    if (!this.activeEscolaId && this.activeUserId) {
      if (newRecord && newRecord.user_id && newRecord.user_id !== this.activeUserId) {
        return false;
      }
      if (oldRecord && oldRecord.user_id && oldRecord.user_id !== this.activeUserId) {
        return false;
      }
    }

    return true;
  }

  private handleTableChange(tableName: string, payload: any) {
    if (!this.activeUserId) return;

    // Validate multi-tenant school isolation
    if (!this.isEventAllowedForCurrentTenant(payload)) {
      return;
    }

    // Check conflict notice on concurrent edits
    if (tableName === "alocacoes" || tableName === "historico_grades") {
      const now = Date.now();
      if (now - this.lastConflictToast > 10000) {
        this.lastConflictToast = now;
        try {
          toast({
            title: "Sincronização em tempo real",
            description: "Alterações recebidas remotamente via Supabase Realtime.",
          });
        } catch {}
      }
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // Debounce to batch multiple rapid changes (e.g. bulk allocation drop or grade reload)
    this.debounceTimer = setTimeout(async () => {
      if (!this.activeUserId) return;
      try {
        const data = await fetchRemoteData(this.activeUserId);
        if (data) {
          applyRealtimeBatchSync(data, this.activeUserId);
        }
      } catch (err) {
        console.warn("Erro ao processar atualização Realtime:", err);
      }
    }, 150);
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (this.activeUserId && !this.isSubscribed) {
        this.initChannel();
      }
    }, 4000);
  }

  private async handleOnline() {
    if (this.activeUserId) {
      this.setStatus("connecting");
      this.initChannel();
      try {
        const data = await fetchRemoteData(this.activeUserId);
        if (data) {
          applyRealtimeBatchSync(data, this.activeUserId);
        }
      } catch {}
    }
  }

  private handleOffline() {
    this.setStatus("disconnected");
  }

  private handleFocus() {
    if (this.activeUserId && (!this.isSubscribed || this.status !== "connected")) {
      this.initChannel();
    }
  }
}

export const realtimeSyncManager = new RealtimeSyncManager();

import { useState, useEffect } from "react";

export function useRealtimeStatus(): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>(() => realtimeSyncManager.getStatus());

  useEffect(() => {
    return realtimeSyncManager.subscribeStatus(setStatus);
  }, []);

  return status;
}
