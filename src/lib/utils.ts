import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const DIA_LABEL_MAP: Record<string, string> = {
  segunda: "Segunda-feira",
  terca: "Terça-feira",
  quarta: "Quarta-feira",
  quinta: "Quinta-feira",
  sexta: "Sexta-feira",
  sabado: "Sábado",
};

export function formatarDia(dia: string): string {
  return DIA_LABEL_MAP[dia] || dia;
}

export function formatarTurno(turno: string): string {
  if (turno === "manha") return "Matutino";
  if (turno === "tarde") return "Vespertino";
  if (turno === "noite") return "Noturno";
  return turno;
}

