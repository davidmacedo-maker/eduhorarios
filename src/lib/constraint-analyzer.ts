import type { Turma, Disciplina, Professor, MatrizCurricular, ConfiguracaoHorarios, Alocacao } from "@/types";
import { isProfAvailableAt } from "@/lib/schedule-utils";

export interface ProvaInviabilidadeMatematica {
  id: string;
  tipo: "sobrecarga_docente" | "saturacao_turma" | "restricao_intersecao";
  entidadeNome: string;
  exigido: number;
  disponivel: number;
  expressaoMatematica: string; // Ex: "28 > 25"
  descricao: string;
  conclusao: "Não existe solução matematicamente possível";
}

export interface AnaliseImpedimento {
  id: string;
  tipo: "erro" | "alerta";
  categoria: "professor" | "turma" | "contrato" | "turno";
  titulo: string;
  descricao: string;
  detalhes: string[];
  resolucao: string;
}

export function analyzeConstraints(
  turmas: Turma[],
  disciplinas: Disciplina[],
  professores: Professor[],
  matriz: MatrizCurricular[],
  config: ConfiguracaoHorarios
): AnaliseImpedimento[] {
  const impedimentos: AnaliseImpedimento[] = [];
  const DAYS = ["segunda", "terca", "quarta", "quinta", "sexta"];

  const profMap = new Map(professores.map((p) => [p.id, p]));
  const turmaMap = new Map(turmas.map((t) => [t.id, t]));
  const discMap = new Map(disciplinas.map((d) => [d.id, d]));

  // Helper to safely get planning item sum for a teacher
  const getProfTotalPlannedHours = (p: Professor): number => {
    if (!p.planejamento || !Array.isArray(p.planejamento)) return 0;
    return p.planejamento.reduce((sum, item) => {
      const hours = Number(item.aulasPorSemana || item.quantidadeAulas || 0);
      return sum + hours;
    }, 0);
  };

  // Helper to count available slots for a teacher in a given turno
  const countAvailableSlotsInTurno = (p: Professor, turno: "manha" | "tarde" | "noite"): number => {
    let count = 0;
    const slotsPerDay = turno === "noite"
      ? (config.quantidadeHorariosPorDiaNoite ?? 4)
      : turno === "tarde"
        ? (config.quantidadeHorariosPorDiaTarde ?? 5)
        : (config.quantidadeHorariosPorDia ?? 6);

    DAYS.forEach((dia) => {
      for (let h = 1; h <= slotsPerDay; h++) {
        if (isProfAvailableAt(p.disponibilidade, dia, h, turno)) {
          count++;
        }
      }
    });
    return count;
  };

  // ── 1. CHECK CLASS CAPACITY OVERFILL (Capacidade Física das Turmas) ──
  turmas.forEach((t) => {
    const turno = t.turno || "manha";
    const slotsPerDay = turno === "noite"
      ? (config.quantidadeHorariosPorDiaNoite ?? 4)
      : turno === "tarde"
        ? (config.quantidadeHorariosPorDiaTarde ?? 5)
        : (config.quantidadeHorariosPorDia ?? 6);

    const maxWeeklyCapacity = 5 * slotsPerDay;
    const requiredHours = matriz
      .filter((m) => m.turmaId === t.id)
      .reduce((sum, m) => sum + (m.aulasPorSemana || 0), 0);

    if (requiredHours > maxWeeklyCapacity) {
      impedimentos.push({
        id: `class-capacity-${t.id}`,
        tipo: "erro",
        categoria: "turma",
        titulo: `Sobrecarga Crítica na Turma ${t.nome}`,
        descricao: `A turma ${t.nome} exige ${requiredHours} aulas semanais, mas o turno ${turno === "manha" ? "Matutino" : turno === "tarde" ? "Vespertino" : "Noturno"} suporta no máximo ${maxWeeklyCapacity} aulas (${slotsPerDay} horários por dia, de segunda a sexta).`,
        detalhes: [
          `Aulas demandadas na matriz: ${requiredHours} horas`,
          `Capacidade física do turno: ${maxWeeklyCapacity} slots`,
          `Diferença inviável: ${requiredHours - maxWeeklyCapacity} aulas impossíveis de alocar`
        ],
        resolucao: `Aumente o número de horários de aulas diárias para o turno em Configurações de Horários ou remova matérias da matriz da turma.`
      });
    }
  });

  // ── 2. CHECK TEACHER CAPACITY AND AVAILABILITY DEFICIT (O caso clássico do Prof. João) ──
  professores.forEach((p) => {
    const totalPlanned = getProfTotalPlannedHours(p);
    
    // Check if planning exceeds contractual maximum limit
    if (totalPlanned > p.cargaHorariaMaximaSemanal) {
      impedimentos.push({
        id: `prof-max-contract-${p.id}`,
        tipo: "alerta",
        categoria: "contrato",
        titulo: `Carga Planejada Excede Limite Máximo: ${p.nomeCompleto}`,
        descricao: `O professor ${p.nomeCompleto} está planejado para ministrar ${totalPlanned} aulas na semana, mas possui carga horária máxima permitida de ${p.cargaHorariaMaximaSemanal} aulas.`,
        detalhes: [
          `Carga horária limite semanal: ${p.cargaHorariaMaximaSemanal} aulas`,
          `Total planejado nas turmas: ${totalPlanned} aulas`,
          `Excesso: ${totalPlanned - p.cargaHorariaMaximaSemanal} aulas`
        ],
        resolucao: `Ajuste a carga horária máxima cadastrada na ficha do professor ou reduza o número de aulas atribuídas a ele no planejamento.`
      });
    }

    // Check availability by shifts (turno)
    const turnosNeeded = new Set<"manha" | "tarde" | "noite">();
    if (p.planejamento && Array.isArray(p.planejamento)) {
      p.planejamento.forEach((item) => {
        const t = turmaMap.get(item.turmaId);
        if (t && t.turno) {
          turnosNeeded.add(t.turno);
        }
      });
    }

    turnosNeeded.forEach((turno) => {
      // Sum planning assigned to this teacher in this specific turno
      const plannedInTurno = (p.planejamento || [])
        .filter((item) => {
          const t = turmaMap.get(item.turmaId);
          return t && t.turno === turno;
        })
        .reduce((sum, item) => sum + Number(item.aulasPorSemana || item.quantidadeAulas || 0), 0);

      const availableInTurno = countAvailableSlotsInTurno(p, turno);

      if (plannedInTurno > availableInTurno) {
        impedimentos.push({
          id: `prof-deficit-${p.id}-${turno}`,
          tipo: "erro",
          categoria: "professor",
          titulo: `Disponibilidade Insuficiente para Prof. ${p.nomeCompleto} (${turno.toUpperCase()})`,
          descricao: `O professor possui ${plannedInTurno} aulas planejadas no turno ${turno === "manha" ? "Matutino" : turno === "tarde" ? "Vespertino" : "Noturno"}, mas sua disponibilidade declarada para este período só cobre ${availableInTurno} horários semanais.`,
          detalhes: [
            `Total de aulas planejadas para o turno: ${plannedInTurno} aulas`,
            `Horários disponíveis declarados pelo professor: ${availableInTurno} slots`,
            `Déficit insolúvel: faltam ${plannedInTurno - availableInTurno} horários de disponibilidade`
          ],
          resolucao: `Abra a Ficha do Professor, acesse a grade de disponibilidade e assinale mais horários para o período ${turno === "manha" ? "matutino" : turno === "tarde" ? "vespertino" : "noturno"}, ou remova aulas atribuídas.`
        });
      }
    });

    // ── 3. SHIFT MISMATCH DETECTOR (Professor alocado na tarde com disponibilidade só na manhã) ──
    if (p.planejamento && Array.isArray(p.planejamento)) {
      p.planejamento.forEach((item) => {
        const t = turmaMap.get(item.turmaId);
        if (!t) return;
        const tTurno = t.turno || "manha";
        const availCount = countAvailableSlotsInTurno(p, tTurno);
        const hours = Number(item.aulasPorSemana || item.quantidadeAulas || 0);

        if (hours > 0 && availCount === 0) {
          const disc = discMap.get(item.disciplinaId);
          impedimentos.push({
            id: `shift-mismatch-${p.id}-${t.id}-${item.disciplinaId}`,
            tipo: "erro",
            categoria: "turno",
            titulo: `Conflito de Turno: Prof. ${p.nomeCompleto} na turma ${t.nome}`,
            descricao: `O professor ${p.nomeCompleto} foi designado para dar ${hours} aulas de ${disc?.nome || "disciplina"} na turma ${t.nome} (Turno ${tTurno === "manha" ? "Matutino" : tTurno === "tarde" ? "Vespertino" : "Noturno"}), mas possui ZERO disponibilidade cadastrada nesse turno!`,
            detalhes: [
              `Turno da turma: ${tTurno === "manha" ? "Matutino" : tTurno === "tarde" ? "Vespertino" : "Noturno"}`,
              `Disponibilidade do professor neste turno: 0 horários`,
              `Aulas exigidas: ${hours} aulas`
            ],
            resolucao: `Cadastre disponibilidade do professor para o turno ${tTurno === "manha" ? "matutino" : tTurno === "tarde" ? "vespertino" : "noturno"} ou mude o professor responsável por essa disciplina na turma.`
          });
        }
      });
    }
  });

  // ── 4. UNASSIGNED SUBJECTS (Matéria cadastrada na turma mas sem professor correspondente) ──
  turmas.forEach((t) => {
    const turmaMatrizes = matriz.filter((m) => m.turmaId === t.id);
    turmaMatrizes.forEach((m) => {
      const disc = discMap.get(m.disciplinaId);
      // Look for a professor whose planning includes this class and this subject
      const hasProfAssigned = professores.some((p) => {
        return p.planejamento?.some(
          (pl) => pl.turmaId === t.id && pl.disciplinaId === m.disciplinaId && Number(pl.aulasPorSemana || pl.quantidadeAulas || 0) > 0
        );
      });

      if (!hasProfAssigned && m.aulasPorSemana > 0) {
        impedimentos.push({
          id: `unassigned-subject-${t.id}-${m.disciplinaId}`,
          tipo: "alerta",
          categoria: "contrato",
          titulo: `Disciplina sem Professor: ${disc?.nome || m.disciplinaId} no ${t.nome}`,
          descricao: `A disciplina ${disc?.nome || m.disciplinaId} está na matriz do ${t.nome} com carga de ${m.aulasPorSemana} aulas por semana, mas não existe nenhum professor com planejamento cadastrado para lecionar esta disciplina nesta turma.`,
          detalhes: [
            `Disciplina: ${disc?.nome || m.disciplinaId}`,
            `Turma: ${t.nome}`,
            `Carga horária órfã: ${m.aulasPorSemana} aulas semanais`
          ],
          resolucao: `Acesse a aba Professores, edite ou crie um docente e, em sua Ficha de Planejamento, adicione a turma ${t.nome} com a disciplina correspondente.`
        });
      }
    });
  });

  return impedimentos;
}

/**
 * 1. PROVAS MATEMÁTICAS DE INVIABILIDADE (Demonstra quando não existe solução física)
 */
export function provarInviabilidadeMatematica(
  turmas: Turma[],
  professores: Professor[],
  disciplinas: Disciplina[],
  matriz: MatrizCurricular[],
  config: ConfiguracaoHorarios,
  alocacoesAtuais: Alocacao[] = []
): ProvaInviabilidadeMatematica[] {
  const provas: ProvaInviabilidadeMatematica[] = [];
  const DIAS_SEMANA = ["segunda", "terca", "quarta", "quinta", "sexta"];

  // A) Prova por Sobrecarga de Docente (Carga Exigida > Slots Disponíveis)
  for (const prof of professores) {
    let cargaExigida = 0;
    const itensPlan = Array.isArray(prof.planejamento) ? prof.planejamento : [];
    
    // Soma aulas no planejamento
    for (const pl of itensPlan) {
      cargaExigida += Number(pl.aulasPorSemana || pl.quantidadeAulas || 0);
    }

    // Se planejamento estiver vazio, calcula pela matriz onde ele está alocado ou vinculado
    if (cargaExigida === 0) {
      for (const m of matriz) {
        if (Array.isArray(prof.disciplinas) && prof.disciplinas.includes(m.disciplinaId)) {
          const jaTem = alocacoesAtuais.some(a => a.professorId === prof.id && a.turmaId === m.turmaId && a.disciplinaId === m.disciplinaId);
          if (jaTem) {
            cargaExigida += m.aulasPorSemana;
          }
        }
      }
    }

    if (cargaExigida <= 0) continue;

    // Contar slots físicos disponíveis na grade do professor
    let slotsDisponiveis = 0;
    if (prof.disponibilidade) {
      for (const dia of DIAS_SEMANA) {
        const arr = (prof.disponibilidade[dia] || []).map(Number);
        slotsDisponiveis += arr.length;
      }
    } else {
      // Se não houver objeto restritivo, assume disponibilidade padrão cheia (ex: 25 ou 30)
      slotsDisponiveis = 25;
    }

    if (cargaExigida > slotsDisponiveis) {
      provas.push({
        id: `inv_prof_${prof.id}`,
        tipo: "sobrecarga_docente",
        entidadeNome: `Professor(a) ${prof.nomeCompleto}`,
        exigido: cargaExigida,
        disponivel: slotsDisponiveis,
        expressaoMatematica: `${cargaExigida} > ${slotsDisponiveis}`,
        descricao: `A carga horária semanal atribuída (${cargaExigida} aulas) ultrapassa a quantidade absoluta de horários livres marcados em sua disponibilidade (${slotsDisponiveis} horários). Impossibilidade física insuperável.`,
        conclusao: "Não existe solução matematicamente possível",
      });
    }
  }

  // B) Prova por Saturação de Turma (Aulas Exigidas na Matriz > Slots da Semana)
  for (const turma of turmas) {
    const turno = turma.turno || "manha";
    const slotsDia = turno === "noite"
      ? (config.quantidadeHorariosPorDiaNoite ?? 4)
      : turno === "tarde"
        ? (config.quantidadeHorariosPorDiaTarde ?? 5)
        : (config.quantidadeHorariosPorDia ?? 5);

    const slotsSemanaTurma = DIAS_SEMANA.length * slotsDia;

    let aulasExigidasTurma = 0;
    for (const m of matriz) {
      if (m.turmaId === turma.id && m.aulasPorSemana > 0) {
        aulasExigidasTurma += m.aulasPorSemana;
      }
    }

    if (aulasExigidasTurma > slotsSemanaTurma) {
      provas.push({
        id: `inv_turma_${turma.id}`,
        tipo: "saturacao_turma",
        entidadeNome: `Turma ${turma.nome} (${turno.toUpperCase()})`,
        exigido: aulasExigidasTurma,
        disponivel: slotsSemanaTurma,
        expressaoMatematica: `${aulasExigidasTurma} > ${slotsSemanaTurma}`,
        descricao: `A matriz curricular exige um total de ${aulasExigidasTurma} aulas semanais, mas o turno da turma comporta no máximo ${slotsSemanaTurma} horários físicos (${DIAS_SEMANA.length} dias × ${slotsDia} horários).`,
        conclusao: "Não existe solução matematicamente possível",
      });
    }
  }

  return provas;
}

