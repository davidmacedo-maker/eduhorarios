-- =============================================================================
-- EDUHORÁRIOS - MIGRATION OFICIAL SUPABASE POSTGRESQL (FASE 3)
-- Arquitetura: Multi-escola, Multiusuário com Suporte a Gestão Master/SUPER_ADMIN
-- =============================================================================

-- Habilita extensão pgcrypto para geração nativa de UUIDs
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── 1. FUNÇÃO UTILITÁRIA PARA ATUALIZAÇÃO AUTOMÁTICA DE TIMESTAMP ──
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- ── 2. TABELA: ESCOLAS ──
CREATE TABLE IF NOT EXISTS escolas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome VARCHAR(255) NOT NULL,
    codigo VARCHAR(100) UNIQUE,
    cidade VARCHAR(100),
    estado VARCHAR(50) DEFAULT 'MG',
    turnos JSONB DEFAULT '["manha", "tarde"]'::jsonb,
    configuracao_horarios JSONB DEFAULT '{}'::jsonb,
    ativo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER set_timestamp_escolas
BEFORE UPDATE ON escolas
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ── 3. TABELA: USUARIOS / PERFIS ──
CREATE TABLE IF NOT EXISTS usuarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID UNIQUE, -- Referência opcional ao auth.users do Supabase
    escola_id UUID REFERENCES escolas(id) ON DELETE SET NULL,
    nome_completo VARCHAR(255) NOT NULL,
    nome_usuario VARCHAR(100) UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    telefone VARCHAR(50),
    perfil VARCHAR(50) DEFAULT 'GESTOR_ESCOLA', -- 'SUPER_ADMIN' | 'GESTOR_ESCOLA' | 'PROFESSOR'
    cargo VARCHAR(100) DEFAULT 'Gestor Escolar',
    status VARCHAR(50) DEFAULT 'ativo', -- 'ativo' | 'inativo' | 'bloqueado'
    observacoes TEXT,
    is_super_admin BOOLEAN DEFAULT FALSE,
    foto_url TEXT,
    ultimo_acesso TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER set_timestamp_usuarios
BEFORE UPDATE ON usuarios
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ── 4. TABELA: PROFESSORES ──
CREATE TABLE IF NOT EXISTS professores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escola_id UUID REFERENCES escolas(id) ON DELETE CASCADE,
    user_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
    nome_completo VARCHAR(255) NOT NULL,
    masp VARCHAR(50),
    data_admissao VARCHAR(50),
    tipo_vinculo VARCHAR(50) DEFAULT 'efetivo', -- 'efetivo' | 'designado'
    cargo VARCHAR(100),
    disciplinas JSONB DEFAULT '[]'::jsonb,
    turmas JSONB DEFAULT '[]'::jsonb,
    disponibilidade JSONB DEFAULT '{}'::jsonb,
    carga_horaria_maxima_semanal INT DEFAULT 40,
    planejamento JSONB DEFAULT '[]'::jsonb,
    ativo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER set_timestamp_professores
BEFORE UPDATE ON professores
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ── 5. TABELA: TURMAS ──
CREATE TABLE IF NOT EXISTS turmas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escola_id UUID REFERENCES escolas(id) ON DELETE CASCADE,
    user_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
    nome VARCHAR(255) NOT NULL,
    turno VARCHAR(50) DEFAULT 'manha', -- 'manha' | 'tarde' | 'noite'
    serie VARCHAR(50),
    ano_letivo INT DEFAULT 2026,
    observacoes TEXT,
    dias_permitidos JSONB DEFAULT '["segunda", "terca", "quarta", "quinta", "sexta"]'::jsonb,
    estrategia_distribuicao VARCHAR(50) DEFAULT 'auto',
    ativo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER set_timestamp_turmas
BEFORE UPDATE ON turmas
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ── 6. TABELA: DISCIPLINAS ──
CREATE TABLE IF NOT EXISTS disciplinas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escola_id UUID REFERENCES escolas(id) ON DELETE CASCADE,
    user_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
    nome VARCHAR(255) NOT NULL,
    abreviacao VARCHAR(50) NOT NULL,
    cor VARCHAR(50) DEFAULT '#3b82f6',
    carga_horaria_semanal INT DEFAULT 0,
    maximo_aulas_por_dia INT,
    ativo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER set_timestamp_disciplinas
BEFORE UPDATE ON disciplinas
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ── 7. TABELA: MATRIZ CURRICULAR ──
CREATE TABLE IF NOT EXISTS matriz_curricular (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escola_id UUID REFERENCES escolas(id) ON DELETE CASCADE,
    user_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
    turma_id UUID NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
    disciplina_id UUID NOT NULL REFERENCES disciplinas(id) ON DELETE CASCADE,
    aulas_por_semana INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_matriz_turma_disciplina UNIQUE (escola_id, turma_id, disciplina_id)
);

CREATE TRIGGER set_timestamp_matriz_curricular
BEFORE UPDATE ON matriz_curricular
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ── 8. TABELA: ALOCACOES (GRADE DE HORÁRIOS) ──
CREATE TABLE IF NOT EXISTS alocacoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escola_id UUID REFERENCES escolas(id) ON DELETE CASCADE,
    user_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
    turma_id UUID NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
    disciplina_id UUID NOT NULL REFERENCES disciplinas(id) ON DELETE CASCADE,
    professor_id UUID NOT NULL REFERENCES professores(id) ON DELETE CASCADE,
    dia_semana VARCHAR(50) NOT NULL, -- 'segunda', 'terca', 'quarta', 'quinta', 'sexta'
    horario INT NOT NULL,           -- índice da aula (ex: 0 a 5)
    is_locked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER set_timestamp_alocacoes
BEFORE UPDATE ON alocacoes
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ── 9. TABELA: HORARIOS BRUTOS / IMPORTAÇÃO ──
CREATE TABLE IF NOT EXISTS horarios_raw (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escola_id UUID REFERENCES escolas(id) ON DELETE CASCADE,
    user_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
    turno VARCHAR(50),
    turma VARCHAR(255),
    disciplina VARCHAR(255),
    professor VARCHAR(255),
    dia VARCHAR(50),
    aula INT,
    horario_inicio VARCHAR(50),
    horario_fim VARCHAR(50),
    masp VARCHAR(50),
    cargo VARCHAR(100),
    importado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ── 10. TABELA: LIVRO PONTO (REGISTROS DE PONTO) ──
CREATE TABLE IF NOT EXISTS livro_ponto (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escola_id UUID REFERENCES escolas(id) ON DELETE CASCADE,
    user_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
    alocacao_id UUID REFERENCES alocacoes(id) ON DELETE CASCADE,
    professor_id UUID REFERENCES professores(id) ON DELETE SET NULL,
    data VARCHAR(50) NOT NULL,
    presente BOOLEAN DEFAULT TRUE,
    observacao TEXT,
    valor VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER set_timestamp_livro_ponto
BEFORE UPDATE ON livro_ponto
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ── 11. TABELA: ATIVIDADES EXTRACLASSE ──
CREATE TABLE IF NOT EXISTS atividades_extraclasse (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escola_id UUID REFERENCES escolas(id) ON DELETE CASCADE,
    user_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
    professor_id UUID NOT NULL REFERENCES professores(id) ON DELETE CASCADE,
    tipo VARCHAR(100) NOT NULL,
    descricao TEXT,
    carga_horaria INT DEFAULT 0,
    dia_semana VARCHAR(50),
    horario VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER set_timestamp_atividades_extraclasse
BEFORE UPDATE ON atividades_extraclasse
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ── 12. TABELA: AUDITORIA ──
CREATE TABLE IF NOT EXISTS auditoria (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escola_id UUID REFERENCES escolas(id) ON DELETE SET NULL,
    admin_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    admin_nome VARCHAR(255),
    usuario_afetado_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    usuario_afetado_nome VARCHAR(255),
    acao VARCHAR(100) NOT NULL,
    detalhes TEXT,
    resultado VARCHAR(50) DEFAULT 'sucesso',
    ip_origem VARCHAR(100),
    data_hora TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- ÍNDICES DE PERFORMANCE E INTEGRIDADE RELACIONAL
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_usuarios_escola ON usuarios(escola_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_perfil ON usuarios(perfil);
CREATE INDEX IF NOT EXISTS idx_professores_escola ON professores(escola_id);
CREATE INDEX IF NOT EXISTS idx_professores_user ON professores(user_id);
CREATE INDEX IF NOT EXISTS idx_professores_masp ON professores(masp);
CREATE INDEX IF NOT EXISTS idx_turmas_escola ON turmas(escola_id);
CREATE INDEX IF NOT EXISTS idx_turmas_user ON turmas(user_id);
CREATE INDEX IF NOT EXISTS idx_disciplinas_escola ON disciplinas(escola_id);
CREATE INDEX IF NOT EXISTS idx_disciplinas_user ON disciplinas(user_id);
CREATE INDEX IF NOT EXISTS idx_matriz_escola ON matriz_curricular(escola_id);
CREATE INDEX IF NOT EXISTS idx_matriz_turma ON matriz_curricular(turma_id);
CREATE INDEX IF NOT EXISTS idx_matriz_disciplina ON matriz_curricular(disciplina_id);
CREATE INDEX IF NOT EXISTS idx_alocacoes_escola ON alocacoes(escola_id);
CREATE INDEX IF NOT EXISTS idx_alocacoes_turma ON alocacoes(turma_id);
CREATE INDEX IF NOT EXISTS idx_alocacoes_professor ON alocacoes(professor_id);
CREATE INDEX IF NOT EXISTS idx_alocacoes_grade_slot ON alocacoes(turma_id, dia_semana, horario);
CREATE INDEX IF NOT EXISTS idx_livro_ponto_escola ON livro_ponto(escola_id);
CREATE INDEX IF NOT EXISTS idx_livro_ponto_alocacao ON livro_ponto(alocacao_id);
CREATE INDEX IF NOT EXISTS idx_livro_ponto_data ON livro_ponto(data);
CREATE INDEX IF NOT EXISTS idx_extraclasse_escola ON atividades_extraclasse(escola_id);
CREATE INDEX IF NOT EXISTS idx_extraclasse_prof ON atividades_extraclasse(professor_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_escola ON auditoria(escola_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_data ON auditoria(data_hora);

-- =============================================================================
-- SEED INICIAL: CONTA MASTER / SUPER_ADMIN OFICIAL
-- =============================================================================

INSERT INTO escolas (id, nome, codigo, cidade, estado)
VALUES ('00000000-0000-0000-0000-000000000001', 'Escola Modelo EduHorários', 'ESC-001', 'Belo Horizonte', 'MG')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO usuarios (
    id,
    escola_id,
    nome_completo,
    nome_usuario,
    email,
    telefone,
    perfil,
    cargo,
    status,
    observacoes,
    is_super_admin
)
VALUES (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'Administrador EduHorários',
    'admin',
    'admin@eduhorarios.com.br',
    '(31) 99887-6655',
    'SUPER_ADMIN',
    'admin',
    'ativo',
    'Conta MASTER oficial da plataforma EduHorários',
    TRUE
)
ON CONFLICT (email) DO NOTHING;
