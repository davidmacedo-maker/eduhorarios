// src/store/index.ts
import { useState, useCallback, useEffect } from "react";
import type {
  Turma,
  Disciplina,
  Professor,
  Alocacao,
  MatrizCurricular,
  ConfiguracaoHorarios,
  RegistroPonto,
  HorarioRaw,
  BancoDeDados,
  PlanejamentoItem,
  HistoricoAprendizado,
} from "@/types";
import {
  syncTurmas,
  syncDisciplinas,
  syncMatriz,
  syncProfessores,
  syncAlocacoes,
  syncRegistrosPonto,
  syncConfig,
  syncEscolaConfig,
  syncHorarios,
  fetchRemoteData,
} from "@/lib/apiSync";
import { validateSchedule } from "@/lib/allocation-engine";
import { auditoriaDbService } from "@/lib/database/auditoria.service";
import { realtimeSyncManager } from "@/lib/realtimeSync";

export let isRemoteSyncActive = false;
export let nextSnapshotDescription = "Edição Manual";

export function setNextSnapshotDescription(desc: string) {
  nextSnapshotDescription = desc;
}

export const storeListeners = new Map<string, Set<(val: any) => void>>();
export const professoresListeners = new Set<(val: Professor[]) => void>();
export const alocacoesListeners = new Set<(val: Alocacao[]) => void>();
export const registrosListeners = new Set<(val: RegistroPonto[]) => void>();
export const historicoListeners = new Set<(val: HistoricoAprendizado[]) => void>();

export let globalProfessores: Professor[] = [];
export let globalAlocacoes: Alocacao[] = [];
export let globalRegistros: RegistroPonto[] = [];
export let globalHistorico: HistoricoAprendizado[] = [];

export function setStoreValue(key: string, newValue: any) {
  try {
    localStorage.setItem(key, JSON.stringify(newValue));
  } catch {}

  // Update global instances and specific listeners if applicable
  if (key.endsWith("edu_professores") && Array.isArray(newValue)) {
    globalProfessores = newValue;
    professoresListeners.forEach((l) => {
      try {
        l(globalProfessores);
      } catch (err) {
        console.error("Error updating professor listener:", err);
      }
    });
  } else if (key.endsWith("edu_alocacoes") && Array.isArray(newValue)) {
    globalAlocacoes = newValue;
    alocacoesListeners.forEach((l) => {
      try {
        l(globalAlocacoes);
      } catch (err) {
        console.error("Error updating alocacoes listener:", err);
      }
    });
  } else if (key.endsWith("edu_registros_ponto") && Array.isArray(newValue)) {
    globalRegistros = newValue;
    registrosListeners.forEach((l) => {
      try {
        l(globalRegistros);
      } catch (err) {
        console.error("Error updating registros listener:", err);
      }
    });
  } else if (key.endsWith("edu_historico_aprendizado") && Array.isArray(newValue)) {
    globalHistorico = newValue;
    historicoListeners.forEach((l) => {
      try {
        l(globalHistorico);
      } catch (err) {
        console.error("Error updating historico listener:", err);
      }
    });
  }

  const listeners = storeListeners.get(key);
  if (listeners) {
    listeners.forEach((l) => {
      try {
        l(newValue);
      } catch (err) {
        console.error("Error updating store listener:", err);
      }
    });
  }
}

export function applyRealtimeBatchSync(
  data: {
    turmas?: Turma[];
    disciplinas?: Disciplina[];
    matriz?: MatrizCurricular[];
    professores?: Professor[];
    alocacoes?: Alocacao[];
    horarios?: BancoDeDados;
    registrosPonto?: RegistroPonto[];
  },
  userId?: string
) {
  const uid = userId || getUserId();
  const pfx = uid === "local" ? "" : `${uid}_`;

  isRemoteSyncActive = true;
  try {
    if (data.turmas && Array.isArray(data.turmas)) {
      setStoreValue(`${pfx}edu_turmas`, data.turmas);
    }
    if (data.disciplinas && Array.isArray(data.disciplinas)) {
      setStoreValue(`${pfx}edu_disciplinas`, data.disciplinas);
    }
    if (data.matriz && Array.isArray(data.matriz)) {
      setStoreValue(`${pfx}edu_matriz`, data.matriz);
    }
    if (data.professores && Array.isArray(data.professores)) {
      const norm = data.professores.map(normalizeProfessor);
      setStoreValue(`${pfx}edu_professores`, norm);
    }
    if (data.alocacoes && Array.isArray(data.alocacoes)) {
      setStoreValue(`${pfx}edu_alocacoes`, data.alocacoes);
    }
    if (data.horarios && typeof data.horarios === "object") {
      setStoreValue(`${pfx}edu_horarios`, data.horarios);
    }
    if (data.registrosPonto && Array.isArray(data.registrosPonto)) {
      setStoreValue(`${pfx}edu_registros_ponto`, data.registrosPonto);
    }

    try {
      localStorage.setItem(`${pfx}edu_last_saved`, new Date().toISOString());
    } catch {}
  } finally {
    setTimeout(() => {
      isRemoteSyncActive = false;
    }, 50);
  }
}

export function getStoreValue(key: string) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function getUserEmail(): string {
  try {
    const tokenKey = Object.keys(localStorage).find((k) => k.includes("-auth-token"));
    if (!tokenKey) return "Local / Convidado";
    const parsed = JSON.parse(localStorage.getItem(tokenKey) ?? "{}");
    return parsed?.user?.email ?? "Local / Convidado";
  } catch {
    return "Local / Convidado";
  }
}

export function getUserName(): string {
  try {
    const tokenKey = Object.keys(localStorage).find((k) => k.includes("-auth-token"));
    if (!tokenKey) return "Usuário Local";
    const parsed = JSON.parse(localStorage.getItem(tokenKey) ?? "{}");
    return (
      parsed?.user?.user_metadata?.full_name ??
      parsed?.user?.email?.split("@")[0] ??
      "Usuário"
    );
  } catch {
    return "Usuário Local";
  }
}

export interface GradeSnapshot {
  id: string;
  createdAt: string;
  userId: string;
  description: string;
  iqg: number;
  conflitos: number;
  gaps: number;
  totalAulas: number;
  alocacoes: Alocacao[];
  horarios: BancoDeDados;
  turmas: Turma[];
  disciplinas: Disciplina[];
  professores: Professor[];
  matriz: MatrizCurricular[];
  createdBy?: string;
  createdByEmail?: string;
}

export function compressSnapshot(snap: GradeSnapshot): any {
  const alocacoes =
    snap.alocacoes?.map((a) => ({
      i: a.id,
      t: a.turmaId,
      d: a.disciplinaId,
      p: a.professorId,
      w: a.diaSemana,
      h: a.horario,
      l: a.isLocked ? 1 : 0,
    })) ?? [];

  return {
    id: snap.id,
    c: snap.createdAt,
    u: snap.userId,
    de: snap.description,
    iq: snap.iqg,
    co: snap.conflitos,
    ga: snap.gaps,
    to: snap.totalAulas,
    al: alocacoes,
    ho: snap.horarios,
    tu: snap.turmas?.map((t) => ({
      i: t.id,
      n: t.nome,
      t: t.turno,
      s: t.serie,
      a: t.anoLetivo,
      ed: t.estrategiaDistribuicao,
      dp: t.diasPermitidos,
    })),
    di: snap.disciplinas?.map((d) => ({
      i: d.id,
      n: d.nome,
      a: d.abreviacao,
      c: d.cor,
      h: d.cargaHorariaSemanal,
    })),
    pr: snap.professores?.map((p) => ({
      i: p.id,
      n: p.nomeCompleto,
      d: p.disciplinas,
      t: p.turmas,
    })),
    ma: snap.matriz?.map((m) => ({
      t: m.turmaId,
      d: m.disciplinaId,
      a: m.aulasPorSemana,
    })),
    by: snap.createdBy,
    em: snap.createdByEmail,
  };
}

export function decompressSnapshot(compressed: any): GradeSnapshot {
  const alocacoes: Alocacao[] =
    compressed.al?.map((a: any) => ({
      id: a.i,
      turmaId: a.t,
      disciplinaId: a.d,
      professorId: a.p,
      diaSemana: a.w,
      horario: a.h,
      isLocked: a.l === 1,
    })) ?? [];

  const turmas: Turma[] =
    compressed.tu?.map((t: any) => ({
      id: t.i,
      nome: t.n,
      turno: t.t,
      serie: t.s,
      anoLetivo: t.a,
      estrategiaDistribuicao: t.ed,
      diasPermitidos: t.dp,
    })) ?? [];

  const disciplinas: Disciplina[] =
    compressed.di?.map((d: any) => ({
      id: d.i,
      nome: d.n,
      abreviacao: d.a,
      cor: d.c,
      cargaHorariaSemanal: d.h,
    })) ?? [];

  const professores: Professor[] =
    compressed.pr?.map((p: any) => ({
      id: p.i,
      nomeCompleto: p.n,
      disciplinas: p.d,
      turmas: p.t,
      disponibilidade: {},
      cargaHorariaMaximaSemanal: 40,
    })) ?? [];

  const matriz: MatrizCurricular[] =
    compressed.ma?.map((m: any) => ({
      turmaId: m.t,
      disciplinaId: m.d,
      aulasPorSemana: m.a,
    })) ?? [];

  return {
    id: compressed.id,
    createdAt: compressed.c,
    userId: compressed.u,
    description: compressed.de,
    iqg: compressed.iq,
    conflitos: compressed.co,
    gaps: compressed.ga,
    totalAulas: compressed.to,
    alocacoes,
    horarios: compressed.ho,
    turmas,
    disciplinas,
    professores,
    matriz,
    createdBy: compressed.by,
    createdByEmail: compressed.em,
  };
}

export function decompressIfNeeded(item: any): GradeSnapshot {
  if (!item) return item;
  if ("c" in item || "de" in item || "al" in item) {
    return decompressSnapshot(item);
  }
  return item;
}

export function saveSnapshotsSafely(key: string, list: any[]) {
  let success = false;
  let itemsToKeep = list.length;
  while (!success && itemsToKeep > 0) {
    try {
      localStorage.setItem(key, JSON.stringify(list.slice(0, itemsToKeep)));
      success = true;
    } catch (error: any) {
      if (
        error.name === "QuotaExceededError" ||
        error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
        error.code === 22
      ) {
        itemsToKeep = Math.floor(itemsToKeep * 0.7);
        if (itemsToKeep === 0) {
          try {
            localStorage.removeItem(key + "_archive");
          } catch (_) {}
          try {
            localStorage.setItem(key, JSON.stringify(list.slice(0, 1)));
            success = true;
          } catch (e) {
            break;
          }
        }
      } else {
        throw error;
      }
    }
  }
}

export async function getArchivedGradeSnapshots(): Promise<GradeSnapshot[]> {
  const uid = getUserId();
  const prefix = uid === "local" ? "" : `${uid}_`;
  const archiveKey = `${prefix}edu_grade_snapshots_archive`;
  const compressedList = tryParse<any[]>(archiveKey, []);
  return compressedList.map((item) => decompressIfNeeded(item));
}

export async function createGradeSnapshot(description: string, force: boolean = false) {
  const uid = getUserId();
  const prefix = uid === "local" ? "" : `${uid}_`;

  const turmas = tryParse<Turma[]>(`${prefix}edu_turmas`, []);
  const disciplinas = tryParse<Disciplina[]>(`${prefix}edu_disciplinas`, []);
  const professores = globalProfessores;
  const alocacoes = globalAlocacoes;
  const matriz = tryParse<MatrizCurricular[]>(`${prefix}edu_matriz`, []);
  const horarios = tryParse<BancoDeDados>(`${prefix}edu_horarios`, {});

  const key = `${prefix}edu_grade_snapshots`;
  const existingRaw = tryParse<any[]>(key, []);
  const existing = existingRaw.map((item) => decompressIfNeeded(item));
  if (existing.length > 0 && !force) {
    const latest = existing[0];
    const candidateStr = JSON.stringify({ alocacoes, horarios, turmas, disciplinas, professores, matriz });
    const latestStr = JSON.stringify({
      alocacoes: latest.alocacoes,
      horarios: latest.horarios,
      turmas: latest.turmas,
      disciplinas: latest.disciplinas,
      professores: latest.professores,
      matriz: latest.matriz,
    });
    if (candidateStr === latestStr) {
      return;
    }
  }

  let iqg = 0;
  let conflitos = 0;
  let gaps = 0;
  let totalAulas = alocacoes.length;

  try {
    const summary = validateSchedule(alocacoes, turmas, disciplinas, professores, matriz);
    iqg = summary?.resumo?.iqg ?? 0;
    conflitos = summary?.resumo?.conflitos ?? 0;
    gaps = summary?.resumo?.buracosEvitaveis ?? 0;
  } catch (err) {
    console.error("Error running validateSchedule for snapshot:", err);
  }

  const createdBy = getUserName();
  const createdByEmail = getUserEmail();

  const snapshot: GradeSnapshot = {
    id: generateId(),
    createdAt: new Date().toISOString(),
    userId: uid,
    description,
    iqg,
    conflitos,
    gaps,
    totalAulas,
    alocacoes,
    horarios,
    turmas,
    disciplinas,
    professores,
    matriz,
    createdBy,
    createdByEmail,
  };

  const updatedAll = [snapshot, ...existing];
  const updatedActive = updatedAll.slice(0, 15);
  const overflow = updatedAll.slice(15);

  if (overflow.length > 0) {
    const archiveKey = `${prefix}edu_grade_snapshots_archive`;
    const existingArchive = tryParse<any[]>(archiveKey, []);
    const compressedOverflow = overflow.map((s) => compressSnapshot(s));
    const nextArchive = [...compressedOverflow, ...existingArchive].slice(0, 50);
    saveSnapshotsSafely(archiveKey, nextArchive);
  }

  const compressedActive = updatedActive.map((s) => compressSnapshot(s));
  saveSnapshotsSafely(key, compressedActive);

  if (uid !== "local") {
    try {
      const fullDescription = `${snapshot.description} (Por: ${createdBy})`;
      await auditoriaDbService.registrarLog({
        admin_id: uid,
        admin_nome: createdBy,
        acao: "salvar_snapshot_grade",
        detalhes: fullDescription,
        resultado: "sucesso",
      });
    } catch (err) {
      console.warn("Auditoria snapshot exception:", err);
    }
  }
}

export async function restoreGradeSnapshot(snapshot: GradeSnapshot) {
  const uid = getUserId();
  const prefix = uid === "local" ? "" : `${uid}_`;

  isRemoteSyncActive = true;
  try {
    localStorage.setItem(`${prefix}edu_turmas`, JSON.stringify(snapshot.turmas));
    localStorage.setItem(`${prefix}edu_disciplinas`, JSON.stringify(snapshot.disciplinas));
    localStorage.setItem(`${prefix}edu_matriz`, JSON.stringify(snapshot.matriz));
    localStorage.setItem(`${prefix}edu_horarios`, JSON.stringify(snapshot.horarios));

    globalProfessores = snapshot.professores;
    localStorage.setItem(`${prefix}edu_professores`, JSON.stringify(snapshot.professores));
    professoresListeners.forEach((l) => l(globalProfessores));

    globalAlocacoes = snapshot.alocacoes;
    localStorage.setItem(`${prefix}edu_alocacoes`, JSON.stringify(snapshot.alocacoes));
    alocacoesListeners.forEach((l) => l(globalAlocacoes));

    const keysToNotify = [
      { key: `${prefix}edu_turmas`, val: snapshot.turmas },
      { key: `${prefix}edu_disciplinas`, val: snapshot.disciplinas },
      { key: `${prefix}edu_matriz`, val: snapshot.matriz },
      { key: `${prefix}edu_horarios`, val: snapshot.horarios },
    ];
    keysToNotify.forEach(({ key, val }) => {
      const listeners = storeListeners.get(key);
      if (listeners) {
        listeners.forEach((l) => l(val));
      }
    });

    if (uid !== "local") {
      await Promise.all([
        syncTurmas(snapshot.turmas, uid),
        syncDisciplinas(snapshot.disciplinas, uid),
        syncProfessores(snapshot.professores, uid),
        syncMatriz(snapshot.matriz, uid),
        syncAlocacoes(snapshot.alocacoes, uid),
        syncHorarios(snapshot.horarios, uid),
      ]);
    }
  } catch (err) {
    console.error("Error restoring snapshot:", err);
  } finally {
    isRemoteSyncActive = false;
  }
}

export async function restoreGradeSnapshotPartially(
  snapshot: GradeSnapshot,
  type: "turma" | "professor",
  targetId: string
) {
  const uid = getUserId();
  const prefix = uid === "local" ? "" : `${uid}_`;

  const currentTurmas = tryParse<Turma[]>(`${prefix}edu_turmas`, []);
  const currentProfessores = globalProfessores;
  const currentAlocacoes = globalAlocacoes;
  const currentHorarios = tryParse<BancoDeDados>(`${prefix}edu_horarios`, {});

  isRemoteSyncActive = true;
  try {
    let nextAlocacoes = [...currentAlocacoes];
    let nextHorarios = { ...currentHorarios };

    if (type === "turma") {
      const targetTurma = currentTurmas.find((t) => t.id === targetId);
      const targetName = targetTurma?.nome;

      nextAlocacoes = [
        ...currentAlocacoes.filter((a) => a.turmaId !== targetId),
        ...snapshot.alocacoes.filter((a) => a.turmaId === targetId),
      ];

      if (targetName) {
        Object.keys(nextHorarios).forEach((turno) => {
          const rawEntries = { ...nextHorarios[turno] };
          Object.keys(rawEntries).forEach((k) => {
            if (rawEntries[k]?.turma === targetName) {
              delete rawEntries[k];
            }
          });
          if (snapshot.horarios && snapshot.horarios[turno]) {
            Object.values(snapshot.horarios[turno]).forEach((row: any) => {
              if (row && row.turma === targetName) {
                rawEntries[row.id] = row;
              }
            });
          }
          nextHorarios[turno] = rawEntries;
        });
      }
    } else {
      const targetProf = currentProfessores.find((p) => p.id === targetId);
      const targetName = targetProf?.nomeCompleto;

      nextAlocacoes = [
        ...currentAlocacoes.filter((a) => a.professorId !== targetId),
        ...snapshot.alocacoes.filter((a) => a.professorId === targetId),
      ];

      if (targetName) {
        Object.keys(nextHorarios).forEach((turno) => {
          const rawEntries = { ...nextHorarios[turno] };
          Object.keys(rawEntries).forEach((k) => {
            if (rawEntries[k]?.professor === targetName) {
              delete rawEntries[k];
            }
          });
          if (snapshot.horarios && snapshot.horarios[turno]) {
            Object.values(snapshot.horarios[turno]).forEach((row: any) => {
              if (row && row.professor === targetName) {
                rawEntries[row.id] = row;
              }
            });
          }
          nextHorarios[turno] = rawEntries;
        });
      }
    }

    globalAlocacoes = nextAlocacoes;
    localStorage.setItem(`${prefix}edu_alocacoes`, JSON.stringify(nextAlocacoes));
    alocacoesListeners.forEach((l) => l(globalAlocacoes));

    localStorage.setItem(`${prefix}edu_horarios`, JSON.stringify(nextHorarios));
    const listeners = storeListeners.get(`${prefix}edu_horarios`);
    if (listeners) {
      listeners.forEach((l) => l(nextHorarios));
    }

    if (uid !== "local") {
      await Promise.all([
        syncAlocacoes(nextAlocacoes, uid),
        syncHorarios(nextHorarios, uid),
      ]);
    }
  } catch (err) {
    console.error("Error doing partial restore:", err);
  } finally {
    isRemoteSyncActive = false;
  }
}

export async function getGradeSnapshots(): Promise<GradeSnapshot[]> {
  const uid = getUserId();
  const prefix = uid === "local" ? "" : `${uid}_`;
  const localList = tryParse<any[]>(`${prefix}edu_grade_snapshots`, []);
  return localList.map((item) => decompressIfNeeded(item));
}

export function setupRealtimeSync(userId: string, escolaId?: string) {
  if (!userId || userId === "local") {
    realtimeSyncManager.stop();
    return;
  }

  realtimeSyncManager.start(userId, escolaId);

  const initialFetch = async () => {
    if (isRemoteSyncActive) return;
    try {
      const data = await fetchRemoteData(userId);
      if (data) {
        applyRealtimeBatchSync(data, userId);
      }
    } catch {}
  };

  initialFetch();
}

export function getUserId(): string {
  try {
    const tokenKey = Object.keys(localStorage).find((k) => k.includes("-auth-token"));
    if (tokenKey) {
      const parsed = JSON.parse(localStorage.getItem(tokenKey) ?? "{}");
      if (parsed?.user?.id) return parsed.user.id;
    }
    const activeLocalStr = localStorage.getItem("eduhorarios_active_user_profile");
    if (activeLocalStr) {
      const parsed = JSON.parse(activeLocalStr);
      if (parsed?.id) return parsed.id;
    }
    return "local";
  } catch {
    return "local";
  }
}

export function storePrefix(): string {
  const uid = getUserId();
  return uid === "local" ? "" : `${uid}_`;
}

export function storageKey(base: string): string {
  return storePrefix() + base;
}

const SCHEMA_VERSION = "4";

export const SEED_TURMAS: Turma[] = [
  { id: "t1", nome: "6º Ano A", turno: "manha", serie: "6º Ano", anoLetivo: 2025, observacoes: "Turma do período da manhã" },
  { id: "t2", nome: "7º Ano B", turno: "tarde", serie: "7º Ano", anoLetivo: 2025, observacoes: "" },
  { id: "t3", nome: "8º Ano A", turno: "manha", serie: "8º Ano", anoLetivo: 2025, observacoes: "" },
];

export const SEED_DISCIPLINAS: Disciplina[] = [
  { id: "d1", nome: "Matemática", abreviacao: "MAT", cor: "#3B82F6", cargaHorariaSemanal: 5 },
  { id: "d2", nome: "Português", abreviacao: "POR", cor: "#22C55E", cargaHorariaSemanal: 5 },
  { id: "d3", nome: "Ciências", abreviacao: "CIE", cor: "#F97316", cargaHorariaSemanal: 3 },
  { id: "d4", nome: "História", abreviacao: "HIS", cor: "#A855F7", cargaHorariaSemanal: 2 },
  { id: "d5", nome: "Ed. Física", abreviacao: "EDF", cor: "#EF4444", cargaHorariaSemanal: 2 },
];

export const SEED_MATRIZ: MatrizCurricular[] = [
  { turmaId: "t1", disciplinaId: "d1", aulasPorSemana: 4 },
  { turmaId: "t1", disciplinaId: "d2", aulasPorSemana: 4 },
  { turmaId: "t1", disciplinaId: "d3", aulasPorSemana: 3 },
  { turmaId: "t1", disciplinaId: "d4", aulasPorSemana: 2 },
  { turmaId: "t1", disciplinaId: "d5", aulasPorSemana: 2 },
  { turmaId: "t2", disciplinaId: "d1", aulasPorSemana: 4 },
  { turmaId: "t2", disciplinaId: "d2", aulasPorSemana: 4 },
  { turmaId: "t2", disciplinaId: "d3", aulasPorSemana: 3 },
  { turmaId: "t2", disciplinaId: "d4", aulasPorSemana: 2 },
  { turmaId: "t2", disciplinaId: "d5", aulasPorSemana: 2 },
  { turmaId: "t3", disciplinaId: "d1", aulasPorSemana: 5 },
  { turmaId: "t3", disciplinaId: "d2", aulasPorSemana: 4 },
  { turmaId: "t3", disciplinaId: "d3", aulasPorSemana: 3 },
  { turmaId: "t3", disciplinaId: "d4", aulasPorSemana: 2 },
  { turmaId: "t3", disciplinaId: "d5", aulasPorSemana: 2 },
];

export const SEED_PROFESSORES: Professor[] = [
  {
    id: "p1",
    nomeCompleto: "Ana Paula Silva",
    disciplinas: ["d1"],
    turmas: ["t1", "t2", "t3"],
    disponibilidade: {
      segunda: [1, 2, 3, 4, 5, 6],
      terca: [1, 2, 3, 4, 5, 6],
      quarta: [1, 2, 3, 4, 5, 6],
      quinta: [1, 2, 3, 4, 5, 6],
      sexta: [1, 2, 3, 4, 5, 6],
    },
    cargaHorariaMaximaSemanal: 20,
  },
  {
    id: "p2",
    nomeCompleto: "Carlos Roberto Lima",
    disciplinas: ["d2", "d4"],
    turmas: ["t1", "t2", "t3"],
    disponibilidade: {
      segunda: [1, 2, 3, 4, 5, 6],
      terca: [1, 2, 3, 4, 5, 6],
      quarta: [1, 2, 3, 4, 5, 6],
      quinta: [1, 2, 3, 4, 5, 6],
      sexta: [1, 2, 3, 4, 5, 6],
    },
    cargaHorariaMaximaSemanal: 20,
  },
  {
    id: "p3",
    nomeCompleto: "Mariana Santos Oliveira",
    disciplinas: ["d3", "d5"],
    turmas: ["t1", "t2", "t3"],
    disponibilidade: {
      segunda: [1, 2, 3, 4, 5, 6],
      terca: [1, 2, 3, 4, 5, 6],
      quarta: [1, 2, 3, 4, 5, 6],
      quinta: [1, 2, 3, 4, 5, 6],
      sexta: [1, 2, 3, 4, 5, 6],
    },
    cargaHorariaMaximaSemanal: 20,
  },
];

const TARDE_DEFAULTS = {
  habilitarTarde: true,
  horarioInicialTarde: "12:00",
  quantidadeHorariosPorDiaTarde: 5,
  duracaoAulaMinutosTarde: 50,
  possuiIntervaloTarde: true,
  horarioIntervaloTarde: 3,
  duracaoIntervaloMinutosTarde: 15,
} as const;

const NOITE_DEFAULTS = {
  habilitarNoite: false,
  horarioInicialNoite: "19:00",
  quantidadeHorariosPorDiaNoite: 4,
  duracaoAulaMinutosNoite: 50,
  possuiIntervaloNoite: false,
  horarioIntervaloNoite: 2,
  duracaoIntervaloMinutosNoite: 15,
} as const;

export const SEED_CONFIG: ConfiguracaoHorarios = {
  quantidadeHorariosPorDia: 6,
  duracaoAulaMinutos: 50,
  horarioInicial: "07:00",
  possuiIntervalo: true,
  horarioIntervalo: 3,
  duracaoIntervaloMinutos: 15,
  ...TARDE_DEFAULTS,
  ...NOITE_DEFAULTS,
};

export const SEED_ALOCACOES: Alocacao[] = [
  { id: "a1", turmaId: "t1", disciplinaId: "d1", professorId: "p1", diaSemana: "segunda", horario: 1 },
  { id: "a2", turmaId: "t1", disciplinaId: "d2", professorId: "p2", diaSemana: "segunda", horario: 2 },
  { id: "a3", turmaId: "t1", disciplinaId: "d3", professorId: "p3", diaSemana: "segunda", horario: 3 },
  { id: "a4", turmaId: "t1", disciplinaId: "d1", professorId: "p1", diaSemana: "terca", horario: 1 },
  { id: "a5", turmaId: "t1", disciplinaId: "d4", professorId: "p2", diaSemana: "terca", horario: 2 },
  { id: "a6", turmaId: "t1", disciplinaId: "d5", professorId: "p3", diaSemana: "quarta", horario: 1 },
  { id: "a7", turmaId: "t1", disciplinaId: "d2", professorId: "p2", diaSemana: "quarta", horario: 2 },
  { id: "a8", turmaId: "t1", disciplinaId: "d1", professorId: "p1", diaSemana: "quinta", horario: 1 },
  { id: "a9", turmaId: "t1", disciplinaId: "d4", professorId: "p2", diaSemana: "quinta", horario: 2 },
  { id: "a10", turmaId: "t1", disciplinaId: "d2", professorId: "p2", diaSemana: "sexta", horario: 1 },
  { id: "a11", turmaId: "t1", disciplinaId: "d3", professorId: "p3", diaSemana: "sexta", horario: 2 },
  { id: "a12", turmaId: "t1", disciplinaId: "d1", professorId: "p1", diaSemana: "sexta", horario: 3 },
  { id: "a13", turmaId: "t2", disciplinaId: "d1", professorId: "p1", diaSemana: "segunda", horario: 1 },
  { id: "a14", turmaId: "t2", disciplinaId: "d2", professorId: "p2", diaSemana: "segunda", horario: 2 },
  { id: "a15", turmaId: "t2", disciplinaId: "d3", professorId: "p3", diaSemana: "terca", horario: 1 },
  { id: "a16", turmaId: "t2", disciplinaId: "d1", professorId: "p1", diaSemana: "terca", horario: 2 },
  { id: "a17", turmaId: "t2", disciplinaId: "d2", professorId: "p2", diaSemana: "quarta", horario: 1 },
  { id: "a18", turmaId: "t2", disciplinaId: "d5", professorId: "p3", diaSemana: "quinta", horario: 1 },
];

function atomicSave(state: {
  turmas?: Turma[];
  disciplinas?: Disciplina[];
  professores?: Professor[];
  alocacoes?: Alocacao[];
  config?: ConfiguracaoHorarios;
  matriz?: MatrizCurricular[];
}) {
  try {
    if (state.turmas !== undefined) localStorage.setItem(storageKey("edu_turmas"), JSON.stringify(state.turmas));
    if (state.disciplinas !== undefined) localStorage.setItem(storageKey("edu_disciplinas"), JSON.stringify(state.disciplinas));
    if (state.professores !== undefined) localStorage.setItem(storageKey("edu_professores"), JSON.stringify(state.professores));
    if (state.alocacoes !== undefined) localStorage.setItem(storageKey("edu_alocacoes"), JSON.stringify(state.alocacoes));
    if (state.config !== undefined) localStorage.setItem(storageKey("edu_config"), JSON.stringify(state.config));
    if (state.matriz !== undefined) localStorage.setItem(storageKey("edu_matriz"), JSON.stringify(state.matriz));
    localStorage.setItem(storageKey("edu_last_saved"), new Date().toISOString());
  } catch {}
}

export function exportFullState() {
  return {
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      turmas: tryParse<Turma[]>(storageKey("edu_turmas"), []),
      disciplinas: tryParse<Disciplina[]>(storageKey("edu_disciplinas"), []),
      professores: tryParse<Professor[]>(storageKey("edu_professores"), []),
      alocacoes: tryParse<Alocacao[]>(storageKey("edu_alocacoes"), []),
      config: tryParse<ConfiguracaoHorarios>(storageKey("edu_config"), SEED_CONFIG),
      matriz: tryParse<MatrizCurricular[]>(storageKey("edu_matriz"), []),
    },
  };
}

function tryParse<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function migrateIfNeeded() {
  const savedVersion = localStorage.getItem(storageKey("edu_schema_version"));

  const storedConfig = tryParse<Record<string, unknown>>(storageKey("edu_config"), {});
  if (storedConfig && !("habilitarTarde" in storedConfig)) {
    localStorage.setItem(storageKey("edu_config"), JSON.stringify({ ...storedConfig, ...TARDE_DEFAULTS }));
  }
  if (storedConfig && !("habilitarNoite" in storedConfig)) {
    const current = tryParse<Record<string, unknown>>(storageKey("edu_config"), {});
    localStorage.setItem(storageKey("edu_config"), JSON.stringify({ ...current, ...NOITE_DEFAULTS }));
  }

  if (savedVersion === SCHEMA_VERSION) return;

  if (savedVersion !== "4") {
    const cfg = tryParse<Record<string, unknown>>(storageKey("edu_config"), {});
    const patches: Record<string, unknown> = {};
    if (cfg["duracaoIntervaloMinutos"] === 20) patches["duracaoIntervaloMinutos"] = 15;
    if (cfg["horarioInicialTarde"] === "13:00") patches["horarioInicialTarde"] = "12:00";
    if (cfg["habilitarTarde"] === false) patches["habilitarTarde"] = true;
    if (Object.keys(patches).length > 0) {
      localStorage.setItem(storageKey("edu_config"), JSON.stringify({ ...cfg, ...patches }));
    }
  }

  localStorage.setItem(storageKey("edu_schema_version"), SCHEMA_VERSION);
}

function initializeSeedData() {
  migrateIfNeeded();
  const initialized = localStorage.getItem(storageKey("edu_initialized"));
  if (!initialized) {
    atomicSave({
      turmas: SEED_TURMAS,
      disciplinas: SEED_DISCIPLINAS,
      professores: SEED_PROFESSORES,
      config: SEED_CONFIG,
      alocacoes: SEED_ALOCACOES,
      matriz: SEED_MATRIZ,
    });
    localStorage.setItem(storageKey("edu_initialized"), "true");
  }
}

initializeSeedData();

function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [storedValue, setStoredValue] = useState<T>(() => tryParse<T>(key, initialValue));

  useEffect(() => {
    if (!storeListeners.has(key)) {
      storeListeners.set(key, new Set());
    }
    const listener = (val: T) => {
      setStoredValue(val);
    };
    storeListeners.get(key)!.add(listener);

    return () => {
      const listeners = storeListeners.get(key);
      if (listeners) {
        listeners.delete(listener);
        if (listeners.size === 0) {
          storeListeners.delete(key);
        }
      }
    };
  }, [key]);

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStoredValue((prev) => {
        const newValue = typeof value === "function" ? (value as (prev: T) => T)(prev) : value;
        try {
          localStorage.setItem(key, JSON.stringify(newValue));
          localStorage.setItem(storageKey("edu_last_saved"), new Date().toISOString());
        } catch {}

        const listeners = storeListeners.get(key);
        if (listeners) {
          listeners.forEach((l) => {
            if (l !== setStoredValue) {
              try {
                l(newValue);
              } catch {}
            }
          });
        }

        const uid = getUserId();
        if (uid !== "local" && !isRemoteSyncActive) {
          const baseKey = key.replace(`${uid}_`, "");
          setTimeout(async () => {
            try {
              if (baseKey === "edu_turmas") await syncTurmas(newValue as any, uid);
              else if (baseKey === "edu_disciplinas") await syncDisciplinas(newValue as any, uid);
              else if (baseKey === "edu_matriz") await syncMatriz(newValue as any, uid);
              else if (baseKey === "edu_professores") await syncProfessores(newValue as any, uid);
              else if (baseKey === "edu_config") await syncConfig(newValue as any, uid);
              else if (baseKey === "edu_alocacoes") await syncAlocacoes(newValue as any, uid);
              else if (baseKey === "edu_registros_ponto") await syncRegistrosPonto(newValue as any, uid);
              else if (baseKey === "edu_escola_nome") {
                const cod = tryParse(storageKey("edu_escola_codigo"), "");
                await syncEscolaConfig(newValue as string, cod, uid);
              } else if (baseKey === "edu_escola_codigo") {
                const nom = tryParse(storageKey("edu_escola_nome"), "Escola Municipal");
                await syncEscolaConfig(nom, newValue as string, uid);
              } else if (baseKey === "edu_horarios") await syncHorarios(newValue as any, uid);
            } catch (err) {
              console.error(`Error in background entity sync for key ${baseKey}:`, err);
            }
          }, 50);
        }

        return newValue;
      });
    },
    [key]
  );

  return [storedValue, setValue];
}

export function useTurmas() {
  return useLocalStorage<Turma[]>(storageKey("edu_turmas"), []);
}

export function useDisciplinas() {
  return useLocalStorage<Disciplina[]>(storageKey("edu_disciplinas"), []);
}

export function useMatrizCurricular() {
  return useLocalStorage<MatrizCurricular[]>(storageKey("edu_matriz"), []);
}

export function normalizeProfessor(prof: any): Professor {
  if (!prof) return prof;
  let normalizedPlan: PlanejamentoItem[] = [];
  if (Array.isArray(prof.planejamento)) {
    normalizedPlan = prof.planejamento.map((item: any) => {
      const rawVal = item?.aulasPorSemana !== undefined ? item.aulasPorSemana : item?.quantidadeAulas;
      const parsedVal = typeof rawVal === "number" ? rawVal : parseInt(rawVal) || 0;
      return {
        disciplinaId: typeof item?.disciplinaId === "string" ? item.disciplinaId : "",
        turmaId: typeof item?.turmaId === "string" ? item.turmaId : "",
        aulasPorSemana: parsedVal,
        quantidadeAulas: parsedVal,
        maximoAulasPorDia:
          item?.maximoAulasPorDia !== undefined && item?.maximoAulasPorDia !== null
            ? Number(item.maximoAulasPorDia)
            : undefined,
        maximoConsecutivas:
          item?.maximoConsecutivas !== undefined && item?.maximoConsecutivas !== null
            ? Number(item.maximoConsecutivas)
            : undefined,
        exigeGeminacao: item?.exigeGeminacao ?? false,
        prioridade: item?.prioridade || undefined,
      } as any;
    });
  } else if (prof.planejamento && typeof prof.planejamento === "object") {
    normalizedPlan = Object.entries(prof.planejamento)
      .map(([disciplinaId, aulas]) => {
        const parsedVal = Number(aulas) || 0;
        return {
          disciplinaId,
          turmaId: (prof.turmas && prof.turmas[0]) || "",
          aulasPorSemana: parsedVal,
          quantidadeAulas: parsedVal,
          maximoAulasPorDia: undefined,
          maximoConsecutivas: undefined,
          exigeGeminacao: false,
          prioridade: undefined,
        } as any;
      })
      .filter((item) => item.aulasPorSemana > 0);
  }

  const cleanDispo: Record<string, number[]> = {};
  if (prof.disponibilidade && typeof prof.disponibilidade === "object") {
    Object.entries(prof.disponibilidade).forEach(([dia, list]) => {
      if (Array.isArray(list)) {
        const rawList = list.map(Number).filter((n) => !isNaN(n));
        const hasOnlyLegacyValues = rawList.every((v: number) => v <= 10);
        if (hasOnlyLegacyValues && rawList.length > 0) {
          cleanDispo[dia] = rawList.map((v) => (v > 5 ? v + 5 : v)).sort((a, b) => a - b);
        } else {
          cleanDispo[dia] = rawList.sort((a, b) => a - b);
        }
      } else {
        cleanDispo[dia] = [];
      }
    });
  } else {
    ["segunda", "terca", "quarta", "quinta", "sexta"].forEach((dia) => {
      cleanDispo[dia] = [];
    });
  }

  return {
    ...prof,
    disponibilidade: cleanDispo,
    planejamento: normalizedPlan,
  };
}

export function useProfessores(): [
  Professor[],
  (val: Professor[] | ((prev: Professor[]) => Professor[])) => void
] {
  const [state, setState] = useState(() => {
    if (globalProfessores.length > 0) return globalProfessores;
    try {
      const key = storageKey("edu_professores");
      const raw = localStorage.getItem(key);
      if (raw) {
        globalProfessores = (JSON.parse(raw) as any[]).map(normalizeProfessor);
      } else {
        const initialized = localStorage.getItem(storageKey("edu_initialized"));
        globalProfessores = initialized ? [] : SEED_PROFESSORES.map(normalizeProfessor);
      }
    } catch {
      globalProfessores = [];
    }
    return globalProfessores;
  });

  useEffect(() => {
    professoresListeners.add(setState);
    return () => {
      professoresListeners.delete(setState);
    };
  }, []);

  const setGlobal = useCallback((val: Professor[] | ((prev: Professor[]) => Professor[])) => {
    const next = typeof val === "function" ? val(globalProfessores) : val;
    globalProfessores = next;

    try {
      const key = storageKey("edu_professores");
      localStorage.setItem(key, JSON.stringify(next));
      localStorage.setItem(storageKey("edu_last_saved"), new Date().toISOString());
    } catch {}

    const uid = getUserId();
    if (uid !== "local" && !isRemoteSyncActive) {
      setTimeout(async () => {
        try {
          await syncProfessores(next, uid);
        } catch (err) {
          console.error("Error syncing professors to Supabase:", err);
        }
      }, 50);
    }

    professoresListeners.forEach((l) => l(next));
  }, []);

  return [state, setGlobal];
}

export function useConfiguracaoHorarios() {
  return useLocalStorage<ConfiguracaoHorarios>(storageKey("edu_config"), SEED_CONFIG);
}

export function useAlocacoes(): [
  Alocacao[],
  (val: Alocacao[] | ((prev: Alocacao[]) => Alocacao[])) => void
] {
  const [state, setState] = useState(() => {
    if (globalAlocacoes.length > 0) return globalAlocacoes;
    try {
      const key = storageKey("edu_alocacoes");
      const raw = localStorage.getItem(key);
      if (raw) {
        globalAlocacoes = JSON.parse(raw) as Alocacao[];
      } else {
        const initialized = localStorage.getItem(storageKey("edu_initialized"));
        globalAlocacoes = initialized ? [] : SEED_ALOCACOES;
      }
    } catch {
      globalAlocacoes = [];
    }
    return globalAlocacoes;
  });

  useEffect(() => {
    alocacoesListeners.add(setState);
    return () => {
      alocacoesListeners.delete(setState);
    };
  }, []);

  const setGlobal = useCallback((val: Alocacao[] | ((prev: Alocacao[]) => Alocacao[])) => {
    const next = typeof val === "function" ? val(globalAlocacoes) : val;

    if (!isRemoteSyncActive) {
      createGradeSnapshot(nextSnapshotDescription);
      registrarAjustesHistorico(globalAlocacoes, next);
      nextSnapshotDescription = "Edição Manual";
    }

    globalAlocacoes = next;

    try {
      const key = storageKey("edu_alocacoes");
      localStorage.setItem(key, JSON.stringify(next));
      localStorage.setItem(storageKey("edu_last_saved"), new Date().toISOString());
    } catch {}

    const uid = getUserId();
    if (uid !== "local" && !isRemoteSyncActive) {
      setTimeout(async () => {
        try {
          await syncAlocacoes(next, uid);
        } catch (err) {
          console.error("Error syncing allocations to Supabase:", err);
        }
      }, 50);
    }

    alocacoesListeners.forEach((l) => l(next));
  }, []);

  return [state, setGlobal];
}

export function useHistoricoAprendizado(): [
  HistoricoAprendizado[],
  (val: HistoricoAprendizado[] | ((prev: HistoricoAprendizado[]) => HistoricoAprendizado[])) => void
] {
  const [state, setState] = useState(() => {
    if (globalHistorico.length > 0) return globalHistorico;
    try {
      const key = storageKey("edu_historico_aprendizado");
      const raw = localStorage.getItem(key);
      if (raw) {
        globalHistorico = JSON.parse(raw) as HistoricoAprendizado[];
      }
    } catch {
      globalHistorico = [];
    }
    return globalHistorico;
  });

  useEffect(() => {
    historicoListeners.add(setState);
    return () => {
      historicoListeners.delete(setState);
    };
  }, []);

  const setGlobal = useCallback((val: HistoricoAprendizado[] | ((prev: HistoricoAprendizado[]) => HistoricoAprendizado[])) => {
    const next = typeof val === "function" ? val(globalHistorico) : val;
    globalHistorico = next;

    try {
      const key = storageKey("edu_historico_aprendizado");
      localStorage.setItem(key, JSON.stringify(next));
    } catch {}

    historicoListeners.forEach((l) => l(next));
  }, []);

  return [state, setGlobal];
}

function registrarAjustesHistorico(prev: Alocacao[], next: Alocacao[]) {
  const uid = getUserId();
  const timestamp = new Date().toISOString();
  const novasInclusoes: HistoricoAprendizado[] = [];

  const removidos = prev.filter((p) => !next.some((n) => n.id === p.id));
  removidos.forEach((r) => {
    novasInclusoes.push({
      id: generateId(),
      professorId: r.professorId,
      turmaId: r.turmaId,
      disciplinaId: r.disciplinaId,
      diaSemana: r.diaSemana,
      horario: r.horario,
      operacao: "remocao",
      justificativa: "Remoção manual realizada pelo usuário",
      timestamp,
      tenant_id: uid,
    });
  });

  const inseridos = next.filter((n) => !prev.some((p) => p.id === n.id));
  inseridos.forEach((i) => {
    novasInclusoes.push({
      id: generateId(),
      professorId: i.professorId,
      turmaId: i.turmaId,
      disciplinaId: i.disciplinaId,
      diaSemana: i.diaSemana,
      horario: i.horario,
      operacao: "insercao",
      justificativa: "Inserção manual realizada pelo usuário",
      timestamp,
      tenant_id: uid,
    });
  });

  if (novasInclusoes.length > 0) {
    const key = storageKey("edu_historico_aprendizado");
    let currentHist: HistoricoAprendizado[] = [];
    try {
      const raw = localStorage.getItem(key);
      if (raw) currentHist = JSON.parse(raw);
    } catch {}

    const novoHist = [...novasInclusoes, ...currentHist].slice(0, 500);
    try {
      localStorage.setItem(key, JSON.stringify(novoHist));
    } catch {}

    globalHistorico = novoHist;
    historicoListeners.forEach((l) => l(novoHist));

    if (uid !== "local") {
      setTimeout(async () => {
        try {
          await auditoriaDbService.registrarLog({
            admin_id: uid,
            admin_nome: getUserName(),
            acao: "ajuste_manual_alocacoes",
            detalhes: `Ajuste manual com ${novasInclusoes.length} modificação(ões)`,
            resultado: "sucesso",
          });
        } catch {}
      }, 100);
    }
  }
}

export function useNomeEscola() {
  return useLocalStorage<string>(storageKey("edu_escola_nome"), "Escola Municipal");
}

export function useCodigoEscola() {
  return useLocalStorage<string>(storageKey("edu_escola_codigo"), "");
}

export function useRegistrosPonto(): [
  RegistroPonto[],
  (val: RegistroPonto[] | ((prev: RegistroPonto[]) => RegistroPonto[])) => void
] {
  const [state, setState] = useState(() => {
    if (globalRegistros.length > 0) return globalRegistros;
    try {
      const key = storageKey("edu_registros_ponto");
      const raw = localStorage.getItem(key);
      if (raw) {
        globalRegistros = JSON.parse(raw) as RegistroPonto[];
      }
    } catch {
      globalRegistros = [];
    }
    return globalRegistros;
  });

  useEffect(() => {
    registrosListeners.add(setState);
    return () => {
      registrosListeners.delete(setState);
    };
  }, []);

  const setGlobal = useCallback((val: RegistroPonto[] | ((prev: RegistroPonto[]) => RegistroPonto[])) => {
    const next = typeof val === "function" ? val(globalRegistros) : val;
    globalRegistros = next;
    registrosListeners.forEach((l) => l(next));
  }, []);

  return [state, setGlobal];
}

export function useHorarios() {
  return useLocalStorage<BancoDeDados>(storageKey("edu_horarios"), {});
}

export function mergeHorarios(existentes: BancoDeDados, novos: BancoDeDados): BancoDeDados {
  const resultado: BancoDeDados = { ...existentes };
  for (const turno of Object.keys(novos)) {
    resultado[turno] = { ...(resultado[turno] ?? {}), ...novos[turno] };
  }
  return resultado;
}

export function horariosParaLista(banco: BancoDeDados): HorarioRaw[] {
  return Object.values(banco).flatMap((grupo) => Object.values(grupo));
}

export function horariosDoTurno(banco: BancoDeDados, turno: string): HorarioRaw[] {
  return Object.values(banco[turno] ?? {});
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
