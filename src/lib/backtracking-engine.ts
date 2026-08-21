import type {
  Turma as AppTurma,
  Professor as AppProfessor,
  Disciplina as AppDisciplina,
  MatrizCurricular as AppMatriz,
  ConfiguracaoHorarios as AppConfig,
  Alocacao as AppAlocacao,
} from "@/types";

// Helper mappings between TypeScript app days/turnos and Python-like data types
export const DIA_MAP: Record<number, string> = {
  0: "segunda",
  1: "terca",
  2: "quarta",
  3: "quinta",
  4: "sexta"
};

export const DIA_REVERSE_MAP: Record<string, number> = {
  "segunda": 0,
  "terca": 1,
  "quarta": 2,
  "quinta": 3,
  "sexta": 4
};

export function mapTurno(t: string): string {
  if (t === "manha") return "manhã";
  return t;
}

export function unmapTurno(t: string): 'manha' | 'tarde' | 'noite' {
  if (t === "manhã") return "manha";
  return t as any;
}

// Helper combinations generator (translating itertools.combinations)
export function combinations<T>(arr: T[], k: number): T[][] {
  const result: T[][] = [];
  function backtrack(start: number, path: T[]) {
    if (path.length === k) {
      result.push([...path]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      path.push(arr[i]);
      backtrack(i + 1, path);
      path.pop();
    }
  }
  backtrack(0, []);
  return result;
}

// Helper product generator (translating itertools.product)
export function product<T>(...arrays: T[][]): T[][] {
  if (arrays.length === 0) return [[]];
  const result: T[][] = [];
  function backtrack(index: number, path: T[]) {
    if (index === arrays.length) {
      result.push([...path]);
      return;
    }
    for (const item of arrays[index]) {
      path.push(item);
      backtrack(index + 1, path);
      path.pop();
    }
  }
  backtrack(0, []);
  return result;
}

// --------------------- MOTOR DATA MODELS ---------------------

export interface Turma {
  id: string;
  turno: string; // 'manhã', 'tarde', 'noite'
}

export interface Disciplina {
  id: string;
  nome: string;
}

export interface Professor {
  id: string;
  nome: string;
}

export class Atribuicao {
  professor: Professor;
  turma: Turma;
  disciplina: Disciplina;
  aulas_semanais: number;
  dias_permitidos: number[]; // 0=seg, 1=ter, 2=qua, 3=qui, 4=sex
  distribuicao: number[]; // ex: [2,2,1]
  id: number;

  constructor(
    professor: Professor,
    turma: Turma,
    disciplina: Disciplina,
    aulas_semanais: number,
    dias_permitidos: number[],
    distribuicao?: number[] | null,
    id = -1
  ) {
    this.professor = professor;
    this.turma = turma;
    this.disciplina = disciplina;
    this.aulas_semanais = aulas_semanais;
    this.dias_permitidos = dias_permitidos;
    this.id = id;
    this.distribuicao = distribuicao || Atribuicao.gerar_distribuicao_padrao(aulas_semanais);
  }

  static gerar_distribuicao_padrao(total: number): number[] {
    if (total <= 0) return [];
    if (total === 1) return [1];
    if (total === 2) return [2];
    if (total === 3) return [2, 1];
    if (total === 4) return [2, 2];
    if (total === 5) return [2, 2, 1];
    
    const dist: number[] = [];
    let restante = total;
    while (restante > 3) {
      dist.push(2);
      restante -= 2;
    }
    if (restante === 3) {
      dist.push(2, 1);
    } else if (restante === 2) {
      dist.push(2);
    } else if (restante === 1) {
      dist.push(1);
    }
    return dist;
  }
}

export class Slot {
  turma: Turma;
  dia: number; // 0..4
  periodo: number; // 1-indexed

  constructor(turma: Turma, dia: number, periodo: number) {
    this.turma = turma;
    this.dia = dia;
    this.periodo = periodo;
  }

  getKey(): string {
    return `${this.turma.id}|${this.dia}|${this.periodo}`;
  }
}

export class AlocacaoEngine {
  atribuicao: Atribuicao;
  slot: Slot;
  bloqueado: boolean;

  constructor(atribuicao: Atribuicao, slot: Slot, bloqueado = false) {
    this.atribuicao = atribuicao;
    this.slot = slot;
    this.bloqueado = bloqueado;
  }
}

// --------------------- ADAPTIVE LEARNING CLASS ---------------------

export class Aprendizagem {
  theta: Record<string, number>;
  learning_rate: number;
  historico: [AlocacaoEngine, AlocacaoEngine][];

  constructor() {
    this.theta = {
      'consecutiva': 5.0,
      'isolada': 2.0,
      'primeira_aula': 0.5,
      'ultima_aula': 0.5,
      'intervalo_irregular': 2.0
    };
    this.learning_rate = 0.1;
    this.historico = [];
  }

  extrair_features(
    slot: Slot,
    max_periodo: number,
    professor_slots_dia: Record<number, number[]>
  ): Record<string, number> {
    const dia = slot.dia;
    const periodo = slot.periodo;
    const slots_no_dia = professor_slots_dia[dia] || [];
    return {
      'consecutiva': 0, // será determinado pelo contexto
      'isolada': slots_no_dia.length === 1 ? 1 : 0,
      'primeira_aula': periodo === 1 ? 1 : 0,
      'ultima_aula': periodo === max_periodo ? 1 : 0,
      'intervalo_irregular': 0 // será determinado pelo contexto
    };
  }

  registrar_alteracao(
    aloc_antiga: AlocacaoEngine,
    aloc_nova: AlocacaoEngine,
    contexto_antigo: Record<string, number>,
    contexto_novo: Record<string, number>
  ) {
    for (const feat of Object.keys(this.theta)) {
      const grad = (contexto_novo[feat] || 0) - (contexto_antigo[feat] || 0);
      this.theta[feat] += this.learning_rate * grad;
    }
    this.historico.push([aloc_antiga, aloc_nova]);
  }
}

// --------------------- MOTOR HORÁRIO OTIMIZADO ---------------------

export class MotorHorarioOtimizado {
  periodos_por_turno: Record<string, number>;
  professores: Map<string, Professor>;
  turmas: Map<string, Turma>;
  disciplinas: Map<string, Disciplina>;
  atribuicoes: Atribuicao[];
  alocacoes: AlocacaoEngine[];
  _slots_ocupados: Map<string, AlocacaoEngine>;
  erros_validacao: string[];
  aprendizagem: Aprendizagem;

  constructor(periodos_por_turno: Record<string, number>) {
    this.periodos_por_turno = periodos_por_turno;
    this.professores = new Map();
    this.turmas = new Map();
    this.disciplinas = new Map();
    this.atribuicoes = [];
    this.alocacoes = [];
    this._slots_ocupados = new Map();
    this.erros_validacao = [];
    this.aprendizagem = new Aprendizagem();
  }

  add_professor(prof: Professor) {
    this.professores.set(prof.id, prof);
  }

  add_turma(turma: Turma) {
    this.turmas.set(turma.id, turma);
  }

  add_disciplina(disc: Disciplina) {
    this.disciplinas.set(disc.id, disc);
  }

  add_atribuicao(
    prof_id: string,
    turma_id: string,
    disc_id: string,
    aulas_semanais: number,
    dias_permitidos: number[],
    distribuicao?: number[] | null
  ) {
    const prof = this.professores.get(prof_id);
    const turma = this.turmas.get(turma_id);
    const disc = this.disciplinas.get(disc_id);
    if (!prof || !turma || !disc) {
      throw new Error("Cadastro incompleto");
    }
    const attr = new Atribuicao(prof, turma, disc, aulas_semanais, dias_permitidos, distribuicao);
    attr.id = this.atribuicoes.length;
    this.atribuicoes.push(attr);
  }

  validar(): boolean {
    this.erros_validacao = [];
    const prof_turno_aulas: Record<string, Record<string, number>> = {};
    const prof_turno_dias: Record<string, Record<string, Set<number>>> = {};

    for (const attr of this.atribuicoes) {
      const pId = attr.professor.id;
      const turno = mapTurno(attr.turma.turno);
      
      if (!prof_turno_aulas[pId]) prof_turno_aulas[pId] = {};
      if (!prof_turno_aulas[pId][turno]) prof_turno_aulas[pId][turno] = 0;
      prof_turno_aulas[pId][turno] += attr.aulas_semanais;

      if (!prof_turno_dias[pId]) prof_turno_dias[pId] = {};
      if (!prof_turno_dias[pId][turno]) prof_turno_dias[pId][turno] = new Set();
      for (const d of attr.dias_permitidos) {
        prof_turno_dias[pId][turno].add(d);
      }
    }

    for (const [prof_id, turnos] of Object.entries(prof_turno_aulas)) {
      const prof = this.professores.get(prof_id)!;
      for (const [turno, total] of Object.entries(turnos)) {
        const dias = prof_turno_dias[prof_id]?.[turno] || new Set<number>();
        const max_aulas = dias.size * (this.periodos_por_turno[turno] || 0);
        if (total > max_aulas) {
          this.erros_validacao.push(
            `${prof.nome}: Atribuídas ${total} aulas no turno '${turno}' excede o máximo de ${max_aulas} horários disponíveis.`
          );
        }
      }
    }

    for (const attr of this.atribuicoes) {
      if (attr.distribuicao.length > attr.dias_permitidos.length) {
        this.erros_validacao.push(
          `Atribuição ${attr.professor.nome} -> ${attr.turma.id} (${attr.disciplina.nome}): Distribuição pedagógica [${attr.distribuicao.join(",")}] requer ${attr.distribuicao.length} dias, mas apenas ${attr.dias_permitidos.length} dias foram permitidos.`
        );
      }
    }

    return this.erros_validacao.length === 0;
  }

  _calcular_dificuldade(prof_id: string): number {
    let dificuldade = 0;
    for (const attr of this.atribuicoes) {
      if (attr.professor.id === prof_id) {
        dificuldade += attr.aulas_semanais * attr.distribuicao.length; // mais grupos, mais difícil
        dificuldade += (5 - attr.dias_permitidos.length) * 3;
      }
    }
    return dificuldade;
  }

  _marcar_slot(aloc: AlocacaoEngine) {
    const key = aloc.slot.getKey();
    this._slots_ocupados.set(key, aloc);
  }

  _desmarcar_slot(slot: Slot) {
    const key = slot.getKey();
    this._slots_ocupados.delete(key);
  }

  gerar_horario(): boolean {
    if (!this.validar()) {
      console.log("Erros de validação:");
      for (const err of this.erros_validacao) {
        console.log(" -", err);
      }
      return false;
    }

    // Limpar alocações não bloqueadas
    this.alocacoes = this.alocacoes.filter((a) => a.bloqueado);
    this._slots_ocupados.clear();
    for (const aloc of this.alocacoes) {
      this._marcar_slot(aloc);
    }

    // Ordenar professores
    const prof_ids = Array.from(this.professores.keys());
    prof_ids.sort((a, b) => this._calcular_dificuldade(b) - this._calcular_dificuldade(a));

    // Fase 1: Construção gulosa
    for (const pid of prof_ids) {
      if (!this._alocar_professor_guloso(pid)) {
        console.log(`Falha ao alocar professor ${this.professores.get(pid)!.nome}`);
        return false;
      }
    }

    // Fase 2: Busca local para melhoria de qualidade pedagógica
    this._busca_local();
    return true;
  }

  _alocar_professor_guloso(prof_id: string): boolean {
    const prof = this.professores.get(prof_id)!;
    // Lista de grupos a alocar
    const grupos: { attr: Atribuicao; tamanho: number }[] = [];
    for (const attr of this.atribuicoes) {
      if (attr.professor.id !== prof_id) continue;
      const bloqueadas = this.alocacoes.filter((a) => a.bloqueado && a.atribuicao.id === attr.id).length;
      const restante = attr.aulas_semanais - bloqueadas;
      if (restante <= 0) continue;

      // Distribuição para o restante
      const dist = Atribuicao.gerar_distribuicao_padrao(restante);
      for (const tam of dist) {
        grupos.push({ attr, tamanho: tam });
      }
    }

    if (grupos.length === 0) return true;

    // Para cada grupo, escolher o melhor slot
    for (const { attr, tamanho } of grupos) {
      if (!this._alocar_grupo(attr, tamanho)) {
        return false;
      }
    }
    return true;
  }

  _alocar_grupo(attr: Atribuicao, tamanho: number): boolean {
    const turnoMapeado = mapTurno(attr.turma.turno);
    const periodos = this.periodos_por_turno[turnoMapeado] || 5;
    const dias_possiveis = attr.dias_permitidos;

    let melhor_custo = Infinity;
    let melhor_slots: Slot[] | null = null;

    // Encontrar os dias já usados por esta mesma atribuição no estado atual
    const dias_usados_atribuicao = new Set<number>();
    for (const aloc of this.alocacoes) {
      if (aloc.atribuicao.id === attr.id) {
        dias_usados_atribuicao.add(aloc.slot.dia);
      }
    }

    for (const dia of dias_possiveis) {
      // Priorizar dias que ainda não foram utilizados por essa atribuição para respeitar a distribuição pedagógica
      if (dias_usados_atribuicao.has(dia) && dias_usados_atribuicao.size < dias_possiveis.length) {
        continue;
      }

      const periodos_disponiveis = Array.from({ length: periodos }, (_, i) => i + 1);
      const combinacoes_periodos = combinations(periodos_disponiveis, tamanho);

      for (const comb of combinacoes_periodos) {
        const slots_candidatos = comb.map((p) => new Slot(attr.turma, dia, p));
        
        // Verificar se todos os slots candidatos estão livres e sem colisão de professor
        if (this._slots_livres_para_atribuicao(attr, slots_candidatos)) {
          const prof_slots_dia = this._get_prof_slots_dia(attr.professor.id);
          const custo = this._avaliar_custo_adaptativo(slots_candidatos, prof_slots_dia);

          if (custo < melhor_custo) {
            melhor_custo = custo;
            melhor_slots = slots_candidatos;
          }
        }
      }
    }

    // Se não encontrou considerando dias não usados, tenta em qualquer dia permitido
    if (!melhor_slots) {
      for (const dia of dias_possiveis) {
        const periodos_disponiveis = Array.from({ length: periodos }, (_, i) => i + 1);
        const combinacoes_periodos = combinations(periodos_disponiveis, tamanho);

        for (const comb of combinacoes_periodos) {
          const slots_candidatos = comb.map((p) => new Slot(attr.turma, dia, p));
          if (this._slots_livres_para_atribuicao(attr, slots_candidatos)) {
            const prof_slots_dia = this._get_prof_slots_dia(attr.professor.id);
            const custo = this._avaliar_custo_adaptativo(slots_candidatos, prof_slots_dia);

            if (custo < melhor_custo) {
              melhor_custo = custo;
              melhor_slots = slots_candidatos;
            }
          }
        }
      }
    }

    if (melhor_slots) {
      for (const slot of melhor_slots) {
        const aloc = new AlocacaoEngine(attr, slot, false);
        this.alocacoes.push(aloc);
        this._marcar_slot(aloc);
      }
      return true;
    }

    return false;
  }

  _slots_livres_para_atribuicao(attr: Atribuicao, slots: Slot[]): boolean {
    for (const slot of slots) {
      const key = slot.getKey();
      if (this._slots_ocupados.has(key)) return false;
    }

    const prof = attr.professor;
    for (const slot of slots) {
      const dia = slot.dia;
      const periodo = slot.periodo;

      for (const aloc of this.alocacoes) {
        if (aloc.atribuicao.professor.id === prof.id) {
          if (aloc.slot.dia === dia && aloc.slot.periodo === periodo) {
            return false;
          }
        }
      }
    }
    return true;
  }

  _get_prof_slots_dia(
    prof_id: string,
    excluir_slot?: Slot,
    incluir_slot?: Slot
  ): Record<number, number[]> {
    const prof_slots_dia: Record<number, number[]> = {};
    for (let d = 0; d < 5; d++) {
      prof_slots_dia[d] = [];
    }

    for (const aloc of this.alocacoes) {
      if (aloc.atribuicao.professor.id === prof_id) {
        if (excluir_slot && aloc.slot.dia === excluir_slot.dia && aloc.slot.periodo === excluir_slot.periodo) {
          continue;
        }
        if (!prof_slots_dia[aloc.slot.dia]) prof_slots_dia[aloc.slot.dia] = [];
        prof_slots_dia[aloc.slot.dia].push(aloc.slot.periodo);
      }
    }

    if (incluir_slot) {
      if (!prof_slots_dia[incluir_slot.dia]) prof_slots_dia[incluir_slot.dia] = [];
      prof_slots_dia[incluir_slot.dia].push(incluir_slot.periodo);
    }

    return prof_slots_dia;
  }

  _avaliar_custo_adaptativo(slots: Slot[], prof_slots_dia: Record<number, number[]>): number {
    let custo = 0.0;
    const t = this.aprendizagem.theta;

    // Consecutividade por dia
    const por_dia: Record<number, number[]> = {};
    for (const s of slots) {
      if (!por_dia[s.dia]) por_dia[s.dia] = [];
      por_dia[s.dia].push(s.periodo);
    }

    for (const [diaStr, periodos] of Object.entries(por_dia)) {
      const dia = Number(diaStr);
      periodos.sort((a, b) => a - b);
      if (periodos.length === 2 && periodos[1] - periodos[0] === 1) {
        custo += t['consecutiva'];
      }
    }

    // Isolamento (aula única do professor no dia)
    for (const s of slots) {
      const total_aulas_dia = (prof_slots_dia[s.dia] || []).length;
      if (total_aulas_dia === 0) {
        custo += t['isolada'];
      }
    }

    // Primeira/última aula
    const max_p = Math.max(...slots.map((s) => s.periodo), 5);
    for (const s of slots) {
      if (s.periodo === 1) {
        custo += t['primeira_aula'];
      }
      if (s.periodo === max_p) {
        custo += t['ultima_aula'];
      }
    }

    // Irregularidade de intervalo de dias
    const dias = Object.keys(por_dia).map(Number).sort((a, b) => a - b);
    if (dias.length > 1) {
      const intervalos: number[] = [];
      for (let i = 0; i < dias.length - 1; i++) {
        intervalos.push(dias[i + 1] - dias[i]);
      }
      const max_int = Math.max(...intervalos);
      const min_int = Math.min(...intervalos);
      if (max_int - min_int > 1) {
        custo += t['intervalo_irregular'];
      }
    }

    return custo;
  }

  _extrair_features_slot(
    slot: Slot,
    max_periodo: number,
    prof_slots_dia: Record<number, number[]>
  ): Record<string, number> {
    return this.aprendizagem.extrair_features(slot, max_periodo, prof_slots_dia);
  }

  _busca_local() {
    let melhorou = true;
    let iteracoes = 0;
    const max_iteracoes = 50;

    while (melhorou && iteracoes < max_iteracoes) {
      melhorou = false;
      iteracoes++;

      for (let i = 0; i < this.alocacoes.length; i++) {
        const aloc = this.alocacoes[i];
        if (aloc.bloqueado) continue;

        const attr = aloc.atribuicao;
        const turnoMapeado = mapTurno(attr.turma.turno);
        const periodos = this.periodos_por_turno[turnoMapeado] || 5;

        const dia_atual = aloc.slot.dia;
        const periodo_atual = aloc.slot.periodo;

        const prof_slots_dia_atual = this._get_prof_slots_dia(attr.professor.id);
        const custo_atual = this._avaliar_custo_adaptativo([aloc.slot], prof_slots_dia_atual);

        for (const dia_novo of attr.dias_permitidos) {
          for (let p_novo = 1; p_novo <= periodos; p_novo++) {
            if (dia_novo === dia_atual && p_novo === periodo_atual) continue;

            const slot_novo = new Slot(attr.turma, dia_novo, p_novo);
            if (this._slots_livres_para_atribuicao(attr, [slot_novo])) {
              const prof_slots_dia_novo = this._get_prof_slots_dia(attr.professor.id, aloc.slot, slot_novo);
              const custo_novo = this._avaliar_custo_adaptativo([slot_novo], prof_slots_dia_novo);

              if (custo_novo < custo_atual) {
                this._desmarcar_slot(aloc.slot);
                aloc.slot = slot_novo;
                this._marcar_slot(aloc);
                melhorou = true;
                break;
              }
            }
          }
          if (melhorou) break;
        }
        if (melhorou) break;
      }
    }
  }

  registrar_alteracao_usuario(
    prof_id: string,
    turma_id: string,
    dia_antigo: number,
    periodo_antigo: number,
    dia_novo: number,
    periodo_novo: number
  ): boolean {
    const key_antiga = `${turma_id}|${dia_antigo}|${periodo_antigo}`;
    const aloc_antiga = this._slots_ocupados.get(key_antiga);
    if (!aloc_antiga || aloc_antiga.bloqueado) {
      return false;
    }

    this._desmarcar_slot(aloc_antiga.slot);
    this.alocacoes = this.alocacoes.filter((a) => a !== aloc_antiga);

    const t = this.turmas.get(turma_id)!;
    const novo_slot = new Slot(t, dia_novo, periodo_novo);
    const nova_aloc = new AlocacaoEngine(aloc_antiga.atribuicao, novo_slot, true);
    
    this.alocacoes.push(nova_aloc);
    this._marcar_slot(nova_aloc);

    const prof = aloc_antiga.atribuicao.professor;
    const turnoMapeado = mapTurno(t.turno);
    const max_periodo = this.periodos_por_turno[turnoMapeado] || 5;

    const prof_slots_dia_antigo = this._get_prof_slots_dia(prof.id, aloc_antiga.slot);
    const prof_slots_dia_novo = this._get_prof_slots_dia(prof.id, undefined, nova_aloc.slot);

    const feat_antigo = this._extrair_features_slot(aloc_antiga.slot, max_periodo, prof_slots_dia_antigo);
    const feat_novo = this._extrair_features_slot(nova_aloc.slot, max_periodo, prof_slots_dia_novo);

    this.aprendizagem.registrar_alteracao(aloc_antiga, nova_aloc, feat_antigo, feat_novo);
    return true;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION WRAPPER FOR APPLET SCHEDULER
// ════════════════════════════════════════════════════════════════════════════

export function executarNovoMotorBacktracking(
  turmas: AppTurma[],
  disciplinas: AppDisciplina[],
  professores: AppProfessor[],
  matriz: AppMatriz[],
  config: AppConfig,
  lockedAlocacoes: AppAlocacao[] = []
): { alocacoes: AppAlocacao[]; sucesso: boolean; erros: string[] } {
  const periodos_por_turno: Record<string, number> = {
    'manhã': config.quantidadeHorariosPorDia,
    'tarde': config.quantidadeHorariosPorDiaTarde ?? 5,
    'noite': config.quantidadeHorariosPorDiaNoite ?? 4,
  };
  
  const motor = new MotorHorarioOtimizado(periodos_por_turno);

  // 1. Add Turmas
  for (const t of turmas) {
    motor.add_turma({
      id: t.id,
      turno: mapTurno(t.turno || "manha")
    });
  }

  // 2. Add Professores
  for (const p of professores) {
    motor.add_professor({
      id: p.id,
      nome: p.nomeCompleto
    });
  }

  // 3. Add Disciplinas
  for (const d of disciplinas) {
    motor.add_disciplina({
      id: d.id,
      nome: d.nome
    });
  }

  // Map professors to each (turma, disciplina) based on planning
  const profDe = new Map<string, AppProfessor>();
  for (const p of professores) {
    const itens = Array.isArray(p.planejamento) ? p.planejamento : [];
    for (const it of itens) {
      profDe.set(`${it.turmaId}|${it.disciplinaId}`, p);
    }
  }

  // 4. Add Atribuicoes
  for (const m of matriz) {
    if (m.aulasPorSemana <= 0) continue;
    const prof = profDe.get(`${m.turmaId}|${m.disciplinaId}`);
    if (!prof) continue;

    // Get intersection of active days in availability and turma allowed days
    const diasPermitidos: number[] = [];
    const daysStr = ["segunda", "terca", "quarta", "quinta", "sexta"];
    const t = turmas.find(x => x.id === m.turmaId);
    const tAllowed = t?.diasPermitidos || ["segunda", "terca", "quarta", "quinta", "sexta"];

    daysStr.forEach((dia, index) => {
      const activeSlots = prof.disponibilidade?.[dia] || [];
      if (activeSlots.length > 0 && tAllowed.includes(dia)) {
        diasPermitidos.push(index);
      }
    });

    if (diasPermitidos.length === 0) {
      diasPermitidos.push(0, 1, 2, 3, 4); // default seg..sex
    }

    motor.add_atribuicao(
      prof.id,
      m.turmaId,
      m.disciplinaId,
      m.aulasPorSemana,
      diasPermitidos
    );
  }

  // 5. Prepopulate locked/fixed allocations:
  for (const locked of lockedAlocacoes) {
    const attr = motor.atribuicoes.find(
      a => a.professor.id === locked.professorId && a.turma.id === locked.turmaId && a.disciplina.id === locked.disciplinaId
    );
    if (attr) {
      const diaNum = DIA_REVERSE_MAP[locked.diaSemana] ?? 0;
      const slot = new Slot(attr.turma, diaNum, locked.horario);
      const alocEng = new AlocacaoEngine(attr, slot, true);
      motor.alocacoes.push(alocEng);
      motor._marcar_slot(alocEng);
    }
  }

  // 6. Run Horário Generation
  const sucesso = motor.gerar_horario();

  // 7. Map resulting allocations back
  const mappedAlocacoes: AppAlocacao[] = [];
  for (const aloc of motor.alocacoes) {
    const diaString = DIA_MAP[aloc.slot.dia] || "segunda";
    const alocId = `aloc-${aloc.atribuicao.professor.id}-${aloc.atribuicao.turma.id}-${aloc.atribuicao.disciplina.id}-${diaString}-${aloc.slot.periodo}`;
    mappedAlocacoes.push({
      id: alocId,
      turmaId: aloc.atribuicao.turma.id,
      disciplinaId: aloc.atribuicao.disciplina.id,
      professorId: aloc.atribuicao.professor.id,
      diaSemana: diaString,
      horario: aloc.slot.periodo,
      isLocked: aloc.bloqueado
    });
  }

  return {
    alocacoes: mappedAlocacoes,
    sucesso,
    erros: motor.erros_validacao
  };
}
