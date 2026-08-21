-- =============================================================================
-- EDUHORÁRIOS - SCHEMA DEFINITIVO SUPABASE POSTGRESQL (FASE 3)
-- Multi-tenant (Isolamento por escola_id) + RLS + Suporte a Gestão MASTER
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── 0. FUNÇÕES GERAIS DE SUPORTE E TIMESTAMPS ──────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 1. TABELA: ESCOLAS ───────────────────────────────────────────────────────

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

DROP TRIGGER IF EXISTS set_timestamp_escolas ON escolas;
CREATE TRIGGER set_timestamp_escolas
BEFORE UPDATE ON escolas
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ── 2. TABELA: PERFIS DE USUÁRIOS ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS perfis_usuarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE,
    auth_user_id UUID,
    escola_id UUID REFERENCES escolas(id) ON DELETE SET NULL,
    nome VARCHAR(255) NOT NULL,
    nome_completo VARCHAR(255),
    login VARCHAR(100) UNIQUE,
    nome_usuario VARCHAR(100),
    email VARCHAR(255) NOT NULL UNIQUE,
    telefone VARCHAR(50),
    role VARCHAR(50) DEFAULT 'GESTOR_ESCOLA',
    perfil VARCHAR(50) DEFAULT 'GESTOR_ESCOLA',
    cargo VARCHAR(100) DEFAULT 'Gestor Escolar',
    status VARCHAR(50) DEFAULT 'ativo',
    observacoes TEXT,
    is_super_admin BOOLEAN DEFAULT FALSE,
    foto_url TEXT,
    ultimo_acesso TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS set_timestamp_perfis_usuarios ON perfis_usuarios;
CREATE TRIGGER set_timestamp_perfis_usuarios
BEFORE UPDATE ON perfis_usuarios
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ── 2.1 TABELA COMPATÍVEL: USUARIOS ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS usuarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID UNIQUE,
    escola_id UUID REFERENCES escolas(id) ON DELETE SET NULL,
    nome_completo VARCHAR(255) NOT NULL,
    nome_usuario VARCHAR(100) UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    telefone VARCHAR(50),
    perfil VARCHAR(50) DEFAULT 'GESTOR_ESCOLA',
    cargo VARCHAR(100) DEFAULT 'Gestor Escolar',
    status VARCHAR(50) DEFAULT 'ativo',
    observacoes TEXT,
    is_super_admin BOOLEAN DEFAULT FALSE,
    foto_url TEXT,
    ultimo_acesso TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS set_timestamp_usuarios ON usuarios;
CREATE TRIGGER set_timestamp_usuarios
BEFORE UPDATE ON usuarios
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ── 3. TABELA: PROFESSORES ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS professores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escola_id UUID REFERENCES escolas(id) ON DELETE CASCADE,
    user_id UUID,
    nome_completo VARCHAR(255) NOT NULL,
    masp VARCHAR(50),
    data_admissao VARCHAR(50),
    tipo_vinculo VARCHAR(50) DEFAULT 'efetivo',
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

DROP TRIGGER IF EXISTS set_timestamp_professores ON professores;
CREATE TRIGGER set_timestamp_professores
BEFORE UPDATE ON professores
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ── 4. TABELA: TURMAS ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS turmas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escola_id UUID REFERENCES escolas(id) ON DELETE CASCADE,
    user_id UUID,
    nome VARCHAR(255) NOT NULL,
    turno VARCHAR(50) DEFAULT 'manha',
    serie VARCHAR(50),
    ano_letivo INT DEFAULT 2026,
    observacoes TEXT,
    dias_permitidos JSONB DEFAULT '["segunda", "terca", "quarta", "quinta", "sexta"]'::jsonb,
    estrategia_distribuicao VARCHAR(50) DEFAULT 'auto',
    ativo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS set_timestamp_turmas ON turmas;
CREATE TRIGGER set_timestamp_turmas
BEFORE UPDATE ON turmas
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ── 5. TABELA: DISCIPLINAS ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS disciplinas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escola_id UUID REFERENCES escolas(id) ON DELETE CASCADE,
    user_id UUID,
    nome VARCHAR(255) NOT NULL,
    abreviacao VARCHAR(50) NOT NULL,
    cor VARCHAR(50) DEFAULT '#3b82f6',
    carga_horaria_semanal INT DEFAULT 0,
    maximo_aulas_por_dia INT,
    ativo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS set_timestamp_disciplinas ON disciplinas;
CREATE TRIGGER set_timestamp_disciplinas
BEFORE UPDATE ON disciplinas
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ── 6. TABELA: MATRIZ CURRICULAR ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS matriz_curricular (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escola_id UUID REFERENCES escolas(id) ON DELETE CASCADE,
    user_id UUID,
    turma_id UUID NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
    disciplina_id UUID NOT NULL REFERENCES disciplinas(id) ON DELETE CASCADE,
    aulas_por_semana INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_matriz_turma_disciplina UNIQUE (escola_id, turma_id, disciplina_id)
);

DROP TRIGGER IF EXISTS set_timestamp_matriz_curricular ON matriz_curricular;
CREATE TRIGGER set_timestamp_matriz_curricular
BEFORE UPDATE ON matriz_curricular
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ── 7. TABELA: ALOCAÇÕES ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alocacoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escola_id UUID REFERENCES escolas(id) ON DELETE CASCADE,
    user_id UUID,
    turma_id UUID NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
    disciplina_id UUID NOT NULL REFERENCES disciplinas(id) ON DELETE CASCADE,
    professor_id UUID NOT NULL REFERENCES professores(id) ON DELETE CASCADE,
    dia_semana VARCHAR(50) NOT NULL,
    horario INT NOT NULL,
    is_locked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS set_timestamp_alocacoes ON alocacoes;
CREATE TRIGGER set_timestamp_alocacoes
BEFORE UPDATE ON alocacoes
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ── 8. TABELA: HORÁRIOS RAW (IMPORTAÇÃO) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS horarios_raw (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escola_id UUID REFERENCES escolas(id) ON DELETE CASCADE,
    user_id UUID,
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

-- ── 9. TABELA: LIVRO PONTO ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS livro_ponto (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escola_id UUID REFERENCES escolas(id) ON DELETE CASCADE,
    user_id UUID,
    alocacao_id UUID REFERENCES alocacoes(id) ON DELETE CASCADE,
    professor_id UUID REFERENCES professores(id) ON DELETE SET NULL,
    data VARCHAR(50) NOT NULL,
    presente BOOLEAN DEFAULT TRUE,
    observacao TEXT,
    valor VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS set_timestamp_livro_ponto ON livro_ponto;
CREATE TRIGGER set_timestamp_livro_ponto
BEFORE UPDATE ON livro_ponto
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ── 10. TABELA: ATIVIDADES EXTRACLASSE ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS atividades_extraclasse (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escola_id UUID REFERENCES escolas(id) ON DELETE CASCADE,
    user_id UUID,
    professor_id UUID NOT NULL REFERENCES professores(id) ON DELETE CASCADE,
    tipo VARCHAR(100) NOT NULL,
    descricao TEXT,
    carga_horaria INT DEFAULT 0,
    dia_semana VARCHAR(50),
    horario VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS set_timestamp_atividades_extraclasse ON atividades_extraclasse;
CREATE TRIGGER set_timestamp_atividades_extraclasse
BEFORE UPDATE ON atividades_extraclasse
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ── 11. TABELA: HISTÓRICO DE GRADES ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS historico_grades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escola_id UUID REFERENCES escolas(id) ON DELETE CASCADE,
    user_id UUID,
    versao INT DEFAULT 1,
    titulo VARCHAR(255),
    descricao TEXT,
    alocacoes JSONB NOT NULL DEFAULT '[]'::jsonb,
    diagnostico JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ── 12. TABELA: HISTÓRICO DE APRENDIZADO ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS historico_aprendizado (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escola_id UUID REFERENCES escolas(id) ON DELETE CASCADE,
    user_id UUID,
    professor_id UUID REFERENCES professores(id) ON DELETE SET NULL,
    turma_id UUID REFERENCES turmas(id) ON DELETE SET NULL,
    disciplina_id UUID REFERENCES disciplinas(id) ON DELETE SET NULL,
    dia_semana VARCHAR(50),
    horario INT,
    operacao VARCHAR(50),
    justificativa TEXT,
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ── 13. TABELA: AUDITORIA ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS auditoria (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escola_id UUID REFERENCES escolas(id) ON DELETE SET NULL,
    admin_id UUID,
    admin_nome VARCHAR(255),
    usuario_afetado_id UUID,
    usuario_afetado_nome VARCHAR(255),
    acao VARCHAR(100) NOT NULL,
    detalhes TEXT,
    resultado VARCHAR(50) DEFAULT 'sucesso',
    ip_origem VARCHAR(100),
    data_hora TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ── 14. ÍNDICES DE PERFORMANCE E INTEGRIDADE ────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_perfis_escola ON perfis_usuarios(escola_id);
CREATE INDEX IF NOT EXISTS idx_perfis_user_id ON perfis_usuarios(user_id);
CREATE INDEX IF NOT EXISTS idx_perfis_auth_user ON perfis_usuarios(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_perfis_role ON perfis_usuarios(role);
CREATE INDEX IF NOT EXISTS idx_perfis_email ON perfis_usuarios(email);

CREATE INDEX IF NOT EXISTS idx_usuarios_escola ON usuarios(escola_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_auth_user ON usuarios(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_perfil ON usuarios(perfil);
CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);

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

CREATE INDEX IF NOT EXISTS idx_horarios_raw_escola ON horarios_raw(escola_id);
CREATE INDEX IF NOT EXISTS idx_livro_ponto_escola ON livro_ponto(escola_id);
CREATE INDEX IF NOT EXISTS idx_livro_ponto_alocacao ON livro_ponto(alocacao_id);
CREATE INDEX IF NOT EXISTS idx_livro_ponto_data ON livro_ponto(data);

CREATE INDEX IF NOT EXISTS idx_extraclasse_escola ON atividades_extraclasse(escola_id);
CREATE INDEX IF NOT EXISTS idx_extraclasse_prof ON atividades_extraclasse(professor_id);

CREATE INDEX IF NOT EXISTS idx_historico_grades_escola ON historico_grades(escola_id);
CREATE INDEX IF NOT EXISTS idx_historico_aprendizado_escola ON historico_aprendizado(escola_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_escola ON auditoria(escola_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_data ON auditoria(data_hora);

-- ── 15. FUNÇÕES DE AUTORIZAÇÃO RLS (SECURITY DEFINER) ───────────────────────

CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM perfis_usuarios
        WHERE (auth_user_id = auth.uid() OR user_id = auth.uid() OR id = auth.uid())
          AND (is_super_admin = TRUE OR role = 'SUPER_ADMIN' OR perfil = 'SUPER_ADMIN')
          AND status = 'ativo'
    ) OR EXISTS (
        SELECT 1 FROM usuarios
        WHERE (auth_user_id = auth.uid() OR id = auth.uid())
          AND (is_super_admin = TRUE OR perfil = 'SUPER_ADMIN')
          AND status = 'ativo'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_user_escola_id()
RETURNS UUID AS $$
DECLARE
    v_escola_id UUID;
BEGIN
    SELECT escola_id INTO v_escola_id
    FROM perfis_usuarios
    WHERE (auth_user_id = auth.uid() OR user_id = auth.uid() OR id = auth.uid())
      AND status = 'ativo'
    LIMIT 1;

    IF v_escola_id IS NULL THEN
        SELECT escola_id INTO v_escola_id
        FROM usuarios
        WHERE (auth_user_id = auth.uid() OR id = auth.uid())
          AND status = 'ativo'
        LIMIT 1;
    END IF;

    RETURN v_escola_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 16. HABILITAÇÃO DO ROW LEVEL SECURITY (RLS) ─────────────────────────────

ALTER TABLE escolas ENABLE ROW LEVEL SECURITY;
ALTER TABLE perfis_usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE professores ENABLE ROW LEVEL SECURITY;
ALTER TABLE turmas ENABLE ROW LEVEL SECURITY;
ALTER TABLE disciplinas ENABLE ROW LEVEL SECURITY;
ALTER TABLE matriz_curricular ENABLE ROW LEVEL SECURITY;
ALTER TABLE alocacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE horarios_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE livro_ponto ENABLE ROW LEVEL SECURITY;
ALTER TABLE atividades_extraclasse ENABLE ROW LEVEL SECURITY;
ALTER TABLE historico_grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE historico_aprendizado ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;

-- ── 17. POLÍTICAS RLS COM ISOLAMENTO MULTI-TENANT ───────────────────────────

-- ESCOLAS
DROP POLICY IF EXISTS "escolas_select_policy" ON escolas;
CREATE POLICY "escolas_select_policy" ON escolas
FOR SELECT USING (
    is_super_admin() OR id = get_user_escola_id() OR auth.role() = 'authenticated'
);

DROP POLICY IF EXISTS "escolas_insert_policy" ON escolas;
CREATE POLICY "escolas_insert_policy" ON escolas
FOR INSERT WITH CHECK (
    is_super_admin() OR auth.role() = 'authenticated'
);

DROP POLICY IF EXISTS "escolas_update_policy" ON escolas;
CREATE POLICY "escolas_update_policy" ON escolas
FOR UPDATE USING (
    is_super_admin() OR id = get_user_escola_id()
) WITH CHECK (
    is_super_admin() OR id = get_user_escola_id()
);

-- PERFIS_USUARIOS
DROP POLICY IF EXISTS "perfis_usuarios_select_policy" ON perfis_usuarios;
CREATE POLICY "perfis_usuarios_select_policy" ON perfis_usuarios
FOR SELECT USING (
    is_super_admin() 
    OR escola_id = get_user_escola_id()
    OR auth_user_id = auth.uid()
    OR user_id = auth.uid()
    OR id = auth.uid()
    OR email = (auth.jwt() ->> 'email')
);

DROP POLICY IF EXISTS "perfis_usuarios_insert_policy" ON perfis_usuarios;
CREATE POLICY "perfis_usuarios_insert_policy" ON perfis_usuarios
FOR INSERT WITH CHECK (
    is_super_admin() 
    OR auth_user_id = auth.uid()
    OR user_id = auth.uid()
    OR id = auth.uid()
    OR auth.role() = 'authenticated'
);

DROP POLICY IF EXISTS "perfis_usuarios_update_policy" ON perfis_usuarios;
CREATE POLICY "perfis_usuarios_update_policy" ON perfis_usuarios
FOR UPDATE USING (
    is_super_admin() 
    OR auth_user_id = auth.uid()
    OR user_id = auth.uid()
    OR id = auth.uid()
    OR (escola_id = get_user_escola_id() AND is_super_admin = FALSE)
) WITH CHECK (
    is_super_admin() 
    OR auth_user_id = auth.uid()
    OR user_id = auth.uid()
    OR id = auth.uid()
    OR (escola_id = get_user_escola_id() AND is_super_admin = FALSE)
);

-- USUARIOS
DROP POLICY IF EXISTS "usuarios_select_policy" ON usuarios;
CREATE POLICY "usuarios_select_policy" ON usuarios
FOR SELECT USING (
    is_super_admin() 
    OR escola_id = get_user_escola_id()
    OR auth_user_id = auth.uid()
    OR id = auth.uid()
);

DROP POLICY IF EXISTS "usuarios_insert_policy" ON usuarios;
CREATE POLICY "usuarios_insert_policy" ON usuarios
FOR INSERT WITH CHECK (
    is_super_admin() 
    OR auth_user_id = auth.uid()
    OR id = auth.uid()
    OR auth.role() = 'authenticated'
);

DROP POLICY IF EXISTS "usuarios_update_policy" ON usuarios;
CREATE POLICY "usuarios_update_policy" ON usuarios
FOR UPDATE USING (
    is_super_admin() 
    OR auth_user_id = auth.uid()
    OR id = auth.uid()
    OR (escola_id = get_user_escola_id() AND is_super_admin = FALSE)
) WITH CHECK (
    is_super_admin() 
    OR auth_user_id = auth.uid()
    OR id = auth.uid()
    OR (escola_id = get_user_escola_id() AND is_super_admin = FALSE)
);

-- PROFESSORES
DROP POLICY IF EXISTS "professores_select_policy" ON professores;
CREATE POLICY "professores_select_policy" ON professores
FOR SELECT USING (
    is_super_admin() OR escola_id = get_user_escola_id() OR escola_id IS NULL
);

DROP POLICY IF EXISTS "professores_insert_policy" ON professores;
CREATE POLICY "professores_insert_policy" ON professores
FOR INSERT WITH CHECK (
    is_super_admin() OR escola_id = get_user_escola_id() OR auth.role() = 'authenticated'
);

DROP POLICY IF EXISTS "professores_update_policy" ON professores;
CREATE POLICY "professores_update_policy" ON professores
FOR UPDATE USING (
    is_super_admin() OR escola_id = get_user_escola_id()
) WITH CHECK (
    is_super_admin() OR escola_id = get_user_escola_id()
);

DROP POLICY IF EXISTS "professores_delete_policy" ON professores;
CREATE POLICY "professores_delete_policy" ON professores
FOR DELETE USING (
    is_super_admin() OR escola_id = get_user_escola_id()
);

-- TURMAS
DROP POLICY IF EXISTS "turmas_select_policy" ON turmas;
CREATE POLICY "turmas_select_policy" ON turmas
FOR SELECT USING (
    is_super_admin() OR escola_id = get_user_escola_id() OR escola_id IS NULL
);

DROP POLICY IF EXISTS "turmas_insert_policy" ON turmas;
CREATE POLICY "turmas_insert_policy" ON turmas
FOR INSERT WITH CHECK (
    is_super_admin() OR escola_id = get_user_escola_id() OR auth.role() = 'authenticated'
);

DROP POLICY IF EXISTS "turmas_update_policy" ON turmas;
CREATE POLICY "turmas_update_policy" ON turmas
FOR UPDATE USING (
    is_super_admin() OR escola_id = get_user_escola_id()
) WITH CHECK (
    is_super_admin() OR escola_id = get_user_escola_id()
);

DROP POLICY IF EXISTS "turmas_delete_policy" ON turmas;
CREATE POLICY "turmas_delete_policy" ON turmas
FOR DELETE USING (
    is_super_admin() OR escola_id = get_user_escola_id()
);

-- DISCIPLINAS
DROP POLICY IF EXISTS "disciplinas_select_policy" ON disciplinas;
CREATE POLICY "disciplinas_select_policy" ON disciplinas
FOR SELECT USING (
    is_super_admin() OR escola_id = get_user_escola_id() OR escola_id IS NULL
);

DROP POLICY IF EXISTS "disciplinas_insert_policy" ON disciplinas;
CREATE POLICY "disciplinas_insert_policy" ON disciplinas
FOR INSERT WITH CHECK (
    is_super_admin() OR escola_id = get_user_escola_id() OR auth.role() = 'authenticated'
);

DROP POLICY IF EXISTS "disciplinas_update_policy" ON disciplinas;
CREATE POLICY "disciplinas_update_policy" ON disciplinas
FOR UPDATE USING (
    is_super_admin() OR escola_id = get_user_escola_id()
) WITH CHECK (
    is_super_admin() OR escola_id = get_user_escola_id()
);

DROP POLICY IF EXISTS "disciplinas_delete_policy" ON disciplinas;
CREATE POLICY "disciplinas_delete_policy" ON disciplinas
FOR DELETE USING (
    is_super_admin() OR escola_id = get_user_escola_id()
);

-- MATRIZ CURRICULAR
DROP POLICY IF EXISTS "matriz_select_policy" ON matriz_curricular;
CREATE POLICY "matriz_select_policy" ON matriz_curricular
FOR SELECT USING (
    is_super_admin() OR escola_id = get_user_escola_id() OR escola_id IS NULL
);

DROP POLICY IF EXISTS "matriz_insert_policy" ON matriz_curricular;
CREATE POLICY "matriz_insert_policy" ON matriz_curricular
FOR INSERT WITH CHECK (
    is_super_admin() OR escola_id = get_user_escola_id() OR auth.role() = 'authenticated'
);

DROP POLICY IF EXISTS "matriz_update_policy" ON matriz_curricular;
CREATE POLICY "matriz_update_policy" ON matriz_curricular
FOR UPDATE USING (
    is_super_admin() OR escola_id = get_user_escola_id()
) WITH CHECK (
    is_super_admin() OR escola_id = get_user_escola_id()
);

DROP POLICY IF EXISTS "matriz_delete_policy" ON matriz_curricular;
CREATE POLICY "matriz_delete_policy" ON matriz_curricular
FOR DELETE USING (
    is_super_admin() OR escola_id = get_user_escola_id()
);

-- ALOCAÇÕES
DROP POLICY IF EXISTS "alocacoes_select_policy" ON alocacoes;
CREATE POLICY "alocacoes_select_policy" ON alocacoes
FOR SELECT USING (
    is_super_admin() OR escola_id = get_user_escola_id() OR escola_id IS NULL
);

DROP POLICY IF EXISTS "alocacoes_insert_policy" ON alocacoes;
CREATE POLICY "alocacoes_insert_policy" ON alocacoes
FOR INSERT WITH CHECK (
    is_super_admin() OR escola_id = get_user_escola_id() OR auth.role() = 'authenticated'
);

DROP POLICY IF EXISTS "alocacoes_update_policy" ON alocacoes;
CREATE POLICY "alocacoes_update_policy" ON alocacoes
FOR UPDATE USING (
    is_super_admin() OR escola_id = get_user_escola_id()
) WITH CHECK (
    is_super_admin() OR escola_id = get_user_escola_id()
);

DROP POLICY IF EXISTS "alocacoes_delete_policy" ON alocacoes;
CREATE POLICY "alocacoes_delete_policy" ON alocacoes
FOR DELETE USING (
    is_super_admin() OR escola_id = get_user_escola_id()
);

-- HORÁRIOS RAW
DROP POLICY IF EXISTS "horarios_raw_select_policy" ON horarios_raw;
CREATE POLICY "horarios_raw_select_policy" ON horarios_raw
FOR SELECT USING (
    is_super_admin() OR escola_id = get_user_escola_id() OR escola_id IS NULL
);

DROP POLICY IF EXISTS "horarios_raw_insert_policy" ON horarios_raw;
CREATE POLICY "horarios_raw_insert_policy" ON horarios_raw
FOR INSERT WITH CHECK (
    is_super_admin() OR escola_id = get_user_escola_id() OR auth.role() = 'authenticated'
);

DROP POLICY IF EXISTS "horarios_raw_delete_policy" ON horarios_raw;
CREATE POLICY "horarios_raw_delete_policy" ON horarios_raw
FOR DELETE USING (
    is_super_admin() OR escola_id = get_user_escola_id()
);

-- LIVRO PONTO
DROP POLICY IF EXISTS "livro_ponto_select_policy" ON livro_ponto;
CREATE POLICY "livro_ponto_select_policy" ON livro_ponto
FOR SELECT USING (
    is_super_admin() OR escola_id = get_user_escola_id() OR escola_id IS NULL
);

DROP POLICY IF EXISTS "livro_ponto_insert_policy" ON livro_ponto;
CREATE POLICY "livro_ponto_insert_policy" ON livro_ponto
FOR INSERT WITH CHECK (
    is_super_admin() OR escola_id = get_user_escola_id() OR auth.role() = 'authenticated'
);

DROP POLICY IF EXISTS "livro_ponto_update_policy" ON livro_ponto;
CREATE POLICY "livro_ponto_update_policy" ON livro_ponto
FOR UPDATE USING (
    is_super_admin() OR escola_id = get_user_escola_id()
) WITH CHECK (
    is_super_admin() OR escola_id = get_user_escola_id()
);

DROP POLICY IF EXISTS "livro_ponto_delete_policy" ON livro_ponto;
CREATE POLICY "livro_ponto_delete_policy" ON livro_ponto
FOR DELETE USING (
    is_super_admin() OR escola_id = get_user_escola_id()
);

-- ATIVIDADES EXTRACLASSE
DROP POLICY IF EXISTS "extraclasse_select_policy" ON atividades_extraclasse;
CREATE POLICY "extraclasse_select_policy" ON atividades_extraclasse
FOR SELECT USING (
    is_super_admin() OR escola_id = get_user_escola_id() OR escola_id IS NULL
);

DROP POLICY IF EXISTS "extraclasse_insert_policy" ON atividades_extraclasse;
CREATE POLICY "extraclasse_insert_policy" ON atividades_extraclasse
FOR INSERT WITH CHECK (
    is_super_admin() OR escola_id = get_user_escola_id() OR auth.role() = 'authenticated'
);

DROP POLICY IF EXISTS "extraclasse_update_policy" ON atividades_extraclasse;
CREATE POLICY "extraclasse_update_policy" ON atividades_extraclasse
FOR UPDATE USING (
    is_super_admin() OR escola_id = get_user_escola_id()
) WITH CHECK (
    is_super_admin() OR escola_id = get_user_escola_id()
);

DROP POLICY IF EXISTS "extraclasse_delete_policy" ON atividades_extraclasse;
CREATE POLICY "extraclasse_delete_policy" ON atividades_extraclasse
FOR DELETE USING (
    is_super_admin() OR escola_id = get_user_escola_id()
);

-- HISTÓRICO DE GRADES
DROP POLICY IF EXISTS "historico_grades_select_policy" ON historico_grades;
CREATE POLICY "historico_grades_select_policy" ON historico_grades
FOR SELECT USING (
    is_super_admin() OR escola_id = get_user_escola_id() OR escola_id IS NULL
);

DROP POLICY IF EXISTS "historico_grades_insert_policy" ON historico_grades;
CREATE POLICY "historico_grades_insert_policy" ON historico_grades
FOR INSERT WITH CHECK (
    is_super_admin() OR escola_id = get_user_escola_id() OR auth.role() = 'authenticated'
);

-- HISTÓRICO DE APRENDIZADO
DROP POLICY IF EXISTS "historico_aprendizado_select_policy" ON historico_aprendizado;
CREATE POLICY "historico_aprendizado_select_policy" ON historico_aprendizado
FOR SELECT USING (
    is_super_admin() OR escola_id = get_user_escola_id() OR escola_id IS NULL
);

DROP POLICY IF EXISTS "historico_aprendizado_insert_policy" ON historico_aprendizado;
CREATE POLICY "historico_aprendizado_insert_policy" ON historico_aprendizado
FOR INSERT WITH CHECK (
    is_super_admin() OR escola_id = get_user_escola_id() OR auth.role() = 'authenticated'
);

-- AUDITORIA
DROP POLICY IF EXISTS "auditoria_select_policy" ON auditoria;
CREATE POLICY "auditoria_select_policy" ON auditoria
FOR SELECT USING (
    is_super_admin() OR (escola_id = get_user_escola_id() AND escola_id IS NOT NULL)
);

DROP POLICY IF EXISTS "auditoria_insert_policy" ON auditoria;
CREATE POLICY "auditoria_insert_policy" ON auditoria
FOR INSERT WITH CHECK (
    auth.role() = 'authenticated'
);

-- ── 18. SEED INICIAL DE COMPATIBILIDADE (ESCOLA PADRÃO) ─────────────────────

INSERT INTO escolas (id, nome, codigo, cidade, estado, turnos, ativo)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Escola Estadual Modelo EduHorários',
    'ESC-MG-001',
    'Belo Horizonte',
    'MG',
    '["manha", "tarde"]'::jsonb,
    TRUE
)
ON CONFLICT (id) DO UPDATE 
SET nome = EXCLUDED.nome,
    codigo = EXCLUDED.codigo;
