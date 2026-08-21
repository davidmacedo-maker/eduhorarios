export type Turno = "manha" | "tarde" | "noite";
export type TipoVinculo = "efetivo" | "designado";

export interface HorarioRaw {
  id: string;           // chave interna: dia_turma_aula
  turno: string;        // label: "Matutino" | "Vespertino" | "Noturno"
  turma: string;
  disciplina: string;
  professor: string;
  dia: string;
  aula: number;
  horarioInicio?: string; // ex: "07:00" — coluna horario_inicio do CSV
  horarioFim?: string;    // ex: "07:50" — coluna horario_fim do CSV
  masp?: string;
  cargo?: string;
  importadoEm: string;  // ISO timestamp
}

/**
 * Estrutura hierárquica que espelha o Firebase /horarios/TURNO/idRegistro.
 * Cada turno fica numa "pasta" separada — Matutino nunca sobrescreve Vespertino.
 */
export type BancoDeDados = Record<string, Record<string, HorarioRaw>>;

export interface Turma {
  id: string;
  nome: string;
  turno: Turno;
  serie: string;
  anoLetivo: number;
  observacoes?: string;
  diasPermitidos?: string[];
  estrategiaDistribuicao?: "distribuir" | "concentrar" | "auto";
}

export interface ConfiguracaoHorarios {
  // ── Turno Matutino ──────────────────────────────
  quantidadeHorariosPorDia: number;
  duracaoAulaMinutos: number;
  horarioInicial: string;
  possuiIntervalo: boolean;
  horarioIntervalo: number;
  duracaoIntervaloMinutos: number;
  // ── Turno Vespertino ─────────────────────────────
  habilitarTarde: boolean;
  horarioInicialTarde: string;
  quantidadeHorariosPorDiaTarde: number;
  duracaoAulaMinutosTarde: number;
  possuiIntervaloTarde: boolean;
  horarioIntervaloTarde: number;
  duracaoIntervaloMinutosTarde: number;
  // ── Turno Noturno ────────────────────────────────
  habilitarNoite: boolean;
  horarioInicialNoite: string;
  quantidadeHorariosPorDiaNoite: number;
  duracaoAulaMinutosNoite: number;
  possuiIntervaloNoite: boolean;
  horarioIntervaloNoite: number;
  duracaoIntervaloMinutosNoite: number;
}

export interface Disciplina {
  id: string;
  nome: string;
  abreviacao: string;
  cor: string;
  cargaHorariaSemanal: number;
  maximoAulasPorDia?: number;
}

export interface MatrizCurricular {
  turmaId: string;
  disciplinaId: string;
  aulasPorSemana: number;
}

export interface Disponibilidade {
  [dia: string]: number[];
}

export interface PlanejamentoItem {
  disciplinaId: string;
  turmaId: string;
  aulasPorSemana: number;
  quantidadeAulas?: number;
  maximoAulasPorDia?: number;
  maximoConsecutivas?: number;
  exigeGeminacao?: boolean;
  prioridade?: "alta" | "media" | "baixa";
}

export interface Professor {
  id: string;
  nomeCompleto: string;
  masp?: string;
  dataAdmissao?: string;
  tipoVinculo?: TipoVinculo;
  cargo?: string;
  disciplinas: string[];
  turmas: string[];
  disponibilidade: Disponibilidade;
  cargaHorariaMaximaSemanal: number;
  planejamento?: PlanejamentoItem[];
}

export interface Alocacao {
  id: string;
  turmaId: string;
  disciplinaId: string;
  professorId: string;
  diaSemana: string;
  horario: number;
  isLocked?: boolean;
}

export interface RegistroPonto {
  id: string;
  alocacaoId: string;
  data: string;
  presente: boolean;
  observacao?: string;
  valor?: string;
}

export interface SugestaoAjuste {
  descricao: string;
  recuperadas: number;
  conflitosEliminados: number;
  geraNovosConflitos: boolean;
  nivelImpacto: "Baixo" | "Médio" | "Alto";
  rankLabel: "Melhor solução" | "Segunda melhor solução" | "Terceira melhor solução" | "Outro ajuste";
  actionType?: "liberar_disponibilidade" | "habilitar_regra" | "remover_limite_disciplina" | "remover_aula_conflito";
  actionPayload?: {
    professorId?: string;
    diaSemana?: string;
    horarioOffset?: number;
    ruleKey?: string;
  };
}

export interface PendenciaCausaRaiz {
  disciplinaId: string;
  disciplinaNome: string;
  turmaId: string;
  turmaNome: string;
  professorId: string;
  professorNome: string;
  aulasFaltantes: number;
  motivoExato: string;
  sugestoes: SugestaoAjuste[];
  cargaSemanal?: number;
  maximoAulasPorDia?: number;
  diasDisponiveis?: number;
  capacidadeSemanalCalculada?: number;
  avisoErroHeuristico?: string;
}

export interface DiagnosticoGeracao {
  professoresSemHorario?: string[];
  disciplinasSemAlocacao?: string[];
  turmasIncompletas?: { nome: string; atual: number; total: number }[];
  conflitos?: string[];
  decisoes?: string[];
  regrasFlexibilizadas?: string[];
  regrasMantidas?: string[];
  regrasRelaxadas?: string[];
  aulasImpactadas?: {
    professor: string;
    disciplina: string;
    turma: string;
    motivo: string;
  }[];
  modoConfigurado?: "rigido" | "equilibrado" | "emergencial" | "personalizado";
  pendenciasCausaRaiz?: PendenciaCausaRaiz[];
  sucesso?: boolean;
  mensagens?: string[];
  taxaAlocacao?: number;
  aulasPlanejadas?: number;
  aulasAlocadas?: number;
  motivoEncerrado?: string;
  tempoProcessamentoMs?: number;
}

export interface RegrasRelaxamento {
  modo: "rigido" | "equilibrado" | "emergencial" | "personalizado";
  permitirMaisDeDuasAulasMesmoDia: boolean;
  permitirTresAulasConsecutivas: boolean;
  permitirOcuparHorariosLivresEntreAulas: boolean;
  permitirAumentarLimiteDiario: boolean;
  permitirAlocarQualquerHorarioDisponivel: boolean;
}

export interface Conflito {
  descricao: string;
  tipo: "professor_duplo" | "turma_dupla" | "carga_excedida" | "disponibilidade";
  dia?: string;
  horario?: number;
  turmaId?: string;
  professorId?: string;
}

export interface HistoricoAprendizado {
  id: string;
  professorId: string;
  turmaId: string;
  disciplinaId: string;
  diaSemana: string;
  horario: number;
  operacao: 'insercao' | 'remocao' | 'bloqueio';
  justificativa: string;
  timestamp: string;
  tenant_id: string;
}

export interface PerfilEscola {
  totalProfessores: number;
  totalTurmas: number;
  totalDisciplinas: number;
  pctContraturno: number;
  pctIntegral: number;
  disponibilidadeMedia: number;
  cargaMedia: number;
  indiceRestricoes: "Baixo" | "Médio" | "Alto";
  perfil: string;
}

export interface MbigExperiencia {
  id: string;
  nProfs: number;
  nTurmas: number;
  nDisciplinas: number;
  nAulas: number;
  pctContraturno: number;
  pctIntegral: number;
  mediaRestricoes: number;
  estrategiaUtilizada: string;
  ordemProcessamento: string[];
  tempoMs: number;
  cobertura: number;
  conflitosCount: number;
  notaFinal: number;
  timestamp: string;
  oQueFuncionou: string[];
  oQueNaoFuncionou: string[];
  estrategiaMelhorou: string;
  estrategiaPiorou: string;
  estrategiaResolveuConflitos?: string;
}

export interface PadraoAjusteManual {
  id: string;
  tipo: "preferencia_dia" | "preferencia_horario" | "concentracao_aulas" | "geminacao_professor";
  descricao: string;
  turmaId?: string;
  professorId?: string;
  disciplinaId?: string;
  diaSemana?: string;
  horario?: number;
  frequencia: number;
  ativo: boolean;
}

export interface MemoriaConflitos {
  professorIndisponivel: number;
  contraturno: number;
  limiteDiario: number;
  geminacao: number;
  choqueHorario: number;
}
