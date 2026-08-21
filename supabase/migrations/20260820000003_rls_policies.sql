-- =============================================================================
-- EDUHORÁRIOS - POLÍTICAS DE SEGURANÇA E RLS SUPABASE (FASE 4)
-- Isolamento Multi-tenant por Escola + Proteção Estrita ao MASTER / SUPER_ADMIN
-- =============================================================================

-- ── 1. FUNÇÕES AUXILIARES DE AUTORIZAÇÃO SEGURA (SECURITY DEFINER) ──
-- Estas funções executam com privilégios de proprietário (postgres) para evitar
-- recursão de políticas RLS ao consultar os perfis dos usuários.

-- Verifica se o usuário autenticado atual é SUPER_ADMIN / MASTER
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM perfis_usuarios
        WHERE (user_id = auth.uid() OR auth_user_id = auth.uid() OR id = auth.uid())
          AND (is_super_admin = TRUE OR role = 'SUPER_ADMIN' OR perfil = 'SUPER_ADMIN')
          AND status = 'ativo'
    ) OR EXISTS (
        SELECT 1 FROM usuarios
        WHERE (auth_user_id = auth.uid() OR id = auth.uid())
          AND (is_super_admin = TRUE OR perfil = 'SUPER_ADMIN')
          AND status = 'ativo'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Retorna o ID da escola vinculada ao usuário autenticado atual
CREATE OR REPLACE FUNCTION get_user_escola_id()
RETURNS UUID AS $$
DECLARE
    v_escola_id UUID;
BEGIN
    SELECT escola_id INTO v_escola_id
    FROM perfis_usuarios
    WHERE (user_id = auth.uid() OR auth_user_id = auth.uid() OR id = auth.uid())
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Retorna o papel/cargo do usuário autenticado atual
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS VARCHAR AS $$
DECLARE
    v_role VARCHAR;
BEGIN
    SELECT COALESCE(role, perfil) INTO v_role
    FROM perfis_usuarios
    WHERE (user_id = auth.uid() OR auth_user_id = auth.uid() OR id = auth.uid())
      AND status = 'ativo'
    LIMIT 1;

    IF v_role IS NULL THEN
        SELECT perfil INTO v_role
        FROM usuarios
        WHERE (auth_user_id = auth.uid() OR id = auth.uid())
          AND status = 'ativo'
        LIMIT 1;
    END IF;

    RETURN COALESCE(v_role, 'USUARIO');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 2. HABILITAR ROW LEVEL SECURITY (RLS) EM TODAS AS TABELAS ──

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

-- ── 3. POLÍTICAS: ESCOLAS ──

DROP POLICY IF EXISTS "escolas_select_policy" ON escolas;
CREATE POLICY "escolas_select_policy" ON escolas
FOR SELECT USING (
    is_super_admin() OR id = get_user_escola_id()
);

DROP POLICY IF EXISTS "escolas_insert_policy" ON escolas;
CREATE POLICY "escolas_insert_policy" ON escolas
FOR INSERT WITH CHECK (
    is_super_admin()
);

DROP POLICY IF EXISTS "escolas_update_policy" ON escolas;
CREATE POLICY "escolas_update_policy" ON escolas
FOR UPDATE USING (
    is_super_admin() OR (id = get_user_escola_id() AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN'))
) WITH CHECK (
    is_super_admin() OR (id = get_user_escola_id() AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN'))
);

DROP POLICY IF EXISTS "escolas_delete_policy" ON escolas;
CREATE POLICY "escolas_delete_policy" ON escolas
FOR DELETE USING (
    is_super_admin()
);

-- ── 4. POLÍTICAS: PERFIS_USUARIOS ──

DROP POLICY IF EXISTS "perfis_select_policy" ON perfis_usuarios;
CREATE POLICY "perfis_select_policy" ON perfis_usuarios
FOR SELECT USING (
    is_super_admin() 
    OR escola_id = get_user_escola_id()
    OR user_id = auth.uid()
    OR auth_user_id = auth.uid()
    OR id = auth.uid()
);

DROP POLICY IF EXISTS "perfis_insert_policy" ON perfis_usuarios;
CREATE POLICY "perfis_insert_policy" ON perfis_usuarios
FOR INSERT WITH CHECK (
    is_super_admin()
    OR (
        escola_id = get_user_escola_id()
        AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN')
        AND is_super_admin = FALSE
        AND role NOT IN ('SUPER_ADMIN', 'MASTER')
        AND perfil NOT IN ('SUPER_ADMIN', 'MASTER')
    )
);

DROP POLICY IF EXISTS "perfis_update_policy" ON perfis_usuarios;
CREATE POLICY "perfis_update_policy" ON perfis_usuarios
FOR UPDATE USING (
    is_super_admin()
    OR (
        escola_id = get_user_escola_id()
        AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN')
        AND is_super_admin = FALSE
    )
    OR (
        (user_id = auth.uid() OR auth_user_id = auth.uid() OR id = auth.uid())
        AND is_super_admin = FALSE
    )
) WITH CHECK (
    is_super_admin()
    OR (
        escola_id = get_user_escola_id()
        AND is_super_admin = FALSE
        AND role NOT IN ('SUPER_ADMIN', 'MASTER')
        AND perfil NOT IN ('SUPER_ADMIN', 'MASTER')
    )
);

DROP POLICY IF EXISTS "perfis_delete_policy" ON perfis_usuarios;
CREATE POLICY "perfis_delete_policy" ON perfis_usuarios
FOR DELETE USING (
    (is_super_admin() AND is_super_admin = FALSE) -- Proteção do MASTER mesmo contra exclusão administrativa acidental
    OR (
        escola_id = get_user_escola_id()
        AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN')
        AND is_super_admin = FALSE
        AND role NOT IN ('SUPER_ADMIN', 'MASTER')
        AND perfil NOT IN ('SUPER_ADMIN', 'MASTER')
    )
);

-- ── 4.1 POLÍTICAS: TABELA USUARIOS (COMPATIBILIDADE) ──

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
    OR (
        escola_id = get_user_escola_id()
        AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN')
        AND is_super_admin = FALSE
        AND perfil NOT IN ('SUPER_ADMIN', 'MASTER')
    )
);

DROP POLICY IF EXISTS "usuarios_update_policy" ON usuarios;
CREATE POLICY "usuarios_update_policy" ON usuarios
FOR UPDATE USING (
    is_super_admin()
    OR (
        escola_id = get_user_escola_id()
        AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN')
        AND is_super_admin = FALSE
    )
    OR (
        (auth_user_id = auth.uid() OR id = auth.uid())
        AND is_super_admin = FALSE
    )
) WITH CHECK (
    is_super_admin()
    OR (
        escola_id = get_user_escola_id()
        AND is_super_admin = FALSE
        AND perfil NOT IN ('SUPER_ADMIN', 'MASTER')
    )
);

DROP POLICY IF EXISTS "usuarios_delete_policy" ON usuarios;
CREATE POLICY "usuarios_delete_policy" ON usuarios
FOR DELETE USING (
    (is_super_admin() AND is_super_admin = FALSE)
    OR (
        escola_id = get_user_escola_id()
        AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN')
        AND is_super_admin = FALSE
        AND perfil NOT IN ('SUPER_ADMIN', 'MASTER')
    )
);

-- ── 5. POLÍTICAS: PROFESSORES ──

DROP POLICY IF EXISTS "professores_select_policy" ON professores;
CREATE POLICY "professores_select_policy" ON professores
FOR SELECT USING (
    is_super_admin() OR escola_id = get_user_escola_id()
);

DROP POLICY IF EXISTS "professores_insert_policy" ON professores;
CREATE POLICY "professores_insert_policy" ON professores
FOR INSERT WITH CHECK (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN'))
);

DROP POLICY IF EXISTS "professores_update_policy" ON professores;
CREATE POLICY "professores_update_policy" ON professores
FOR UPDATE USING (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN'))
) WITH CHECK (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN'))
);

DROP POLICY IF EXISTS "professores_delete_policy" ON professores;
CREATE POLICY "professores_delete_policy" ON professores
FOR DELETE USING (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN'))
);

-- ── 6. POLÍTICAS: TURMAS ──

DROP POLICY IF EXISTS "turmas_select_policy" ON turmas;
CREATE POLICY "turmas_select_policy" ON turmas
FOR SELECT USING (
    is_super_admin() OR escola_id = get_user_escola_id()
);

DROP POLICY IF EXISTS "turmas_insert_policy" ON turmas;
CREATE POLICY "turmas_insert_policy" ON turmas
FOR INSERT WITH CHECK (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN'))
);

DROP POLICY IF EXISTS "turmas_update_policy" ON turmas;
CREATE POLICY "turmas_update_policy" ON turmas
FOR UPDATE USING (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN'))
) WITH CHECK (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN'))
);

DROP POLICY IF EXISTS "turmas_delete_policy" ON turmas;
CREATE POLICY "turmas_delete_policy" ON turmas
FOR DELETE USING (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN'))
);

-- ── 7. POLÍTICAS: DISCIPLINAS ──

DROP POLICY IF EXISTS "disciplinas_select_policy" ON disciplinas;
CREATE POLICY "disciplinas_select_policy" ON disciplinas
FOR SELECT USING (
    is_super_admin() OR escola_id = get_user_escola_id()
);

DROP POLICY IF EXISTS "disciplinas_insert_policy" ON disciplinas;
CREATE POLICY "disciplinas_insert_policy" ON disciplinas
FOR INSERT WITH CHECK (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN'))
);

DROP POLICY IF EXISTS "disciplinas_update_policy" ON disciplinas;
CREATE POLICY "disciplinas_update_policy" ON disciplinas
FOR UPDATE USING (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN'))
) WITH CHECK (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN'))
);

DROP POLICY IF EXISTS "disciplinas_delete_policy" ON disciplinas;
CREATE POLICY "disciplinas_delete_policy" ON disciplinas
FOR DELETE USING (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN'))
);

-- ── 8. POLÍTICAS: MATRIZ CURRICULAR ──

DROP POLICY IF EXISTS "matriz_select_policy" ON matriz_curricular;
CREATE POLICY "matriz_select_policy" ON matriz_curricular
FOR SELECT USING (
    is_super_admin() OR escola_id = get_user_escola_id()
);

DROP POLICY IF EXISTS "matriz_insert_policy" ON matriz_curricular;
CREATE POLICY "matriz_insert_policy" ON matriz_curricular
FOR INSERT WITH CHECK (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN'))
);

DROP POLICY IF EXISTS "matriz_update_policy" ON matriz_curricular;
CREATE POLICY "matriz_update_policy" ON matriz_curricular
FOR UPDATE USING (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN'))
) WITH CHECK (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN'))
);

DROP POLICY IF EXISTS "matriz_delete_policy" ON matriz_curricular;
CREATE POLICY "matriz_delete_policy" ON matriz_curricular
FOR DELETE USING (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN'))
);

-- ── 9. POLÍTICAS: ALOCAÇÕES (GRADE) ──

DROP POLICY IF EXISTS "alocacoes_select_policy" ON alocacoes;
CREATE POLICY "alocacoes_select_policy" ON alocacoes
FOR SELECT USING (
    is_super_admin() OR escola_id = get_user_escola_id()
);

DROP POLICY IF EXISTS "alocacoes_insert_policy" ON alocacoes;
CREATE POLICY "alocacoes_insert_policy" ON alocacoes
FOR INSERT WITH CHECK (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN'))
);

DROP POLICY IF EXISTS "alocacoes_update_policy" ON alocacoes;
CREATE POLICY "alocacoes_update_policy" ON alocacoes
FOR UPDATE USING (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN'))
) WITH CHECK (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN'))
);

DROP POLICY IF EXISTS "alocacoes_delete_policy" ON alocacoes;
CREATE POLICY "alocacoes_delete_policy" ON alocacoes
FOR DELETE USING (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN'))
);

-- ── 10. POLÍTICAS: HORÁRIOS RAW (IMPORTAÇÃO) ──

DROP POLICY IF EXISTS "horarios_raw_select_policy" ON horarios_raw;
CREATE POLICY "horarios_raw_select_policy" ON horarios_raw
FOR SELECT USING (
    is_super_admin() OR escola_id = get_user_escola_id()
);

DROP POLICY IF EXISTS "horarios_raw_insert_policy" ON horarios_raw;
CREATE POLICY "horarios_raw_insert_policy" ON horarios_raw
FOR INSERT WITH CHECK (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN'))
);

DROP POLICY IF EXISTS "horarios_raw_delete_policy" ON horarios_raw;
CREATE POLICY "horarios_raw_delete_policy" ON horarios_raw
FOR DELETE USING (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN'))
);

-- ── 11. POLÍTICAS: LIVRO PONTO ──

DROP POLICY IF EXISTS "livro_ponto_select_policy" ON livro_ponto;
CREATE POLICY "livro_ponto_select_policy" ON livro_ponto
FOR SELECT USING (
    is_super_admin() OR escola_id = get_user_escola_id()
);

DROP POLICY IF EXISTS "livro_ponto_insert_policy" ON livro_ponto;
CREATE POLICY "livro_ponto_insert_policy" ON livro_ponto
FOR INSERT WITH CHECK (
    is_super_admin() OR escola_id = get_user_escola_id()
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
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN'))
);

-- ── 12. POLÍTICAS: ATIVIDADES EXTRACLASSE ──

DROP POLICY IF EXISTS "extraclasse_select_policy" ON atividades_extraclasse;
CREATE POLICY "extraclasse_select_policy" ON atividades_extraclasse
FOR SELECT USING (
    is_super_admin() OR escola_id = get_user_escola_id()
);

DROP POLICY IF EXISTS "extraclasse_insert_policy" ON atividades_extraclasse;
CREATE POLICY "extraclasse_insert_policy" ON atividades_extraclasse
FOR INSERT WITH CHECK (
    is_super_admin() OR escola_id = get_user_escola_id()
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
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN'))
);

-- ── 13. POLÍTICAS: HISTÓRICO DE GRADES ──

DROP POLICY IF EXISTS "historico_grades_select_policy" ON historico_grades;
CREATE POLICY "historico_grades_select_policy" ON historico_grades
FOR SELECT USING (
    is_super_admin() OR escola_id = get_user_escola_id()
);

DROP POLICY IF EXISTS "historico_grades_insert_policy" ON historico_grades;
CREATE POLICY "historico_grades_insert_policy" ON historico_grades
FOR INSERT WITH CHECK (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN'))
);

DROP POLICY IF EXISTS "historico_grades_delete_policy" ON historico_grades;
CREATE POLICY "historico_grades_delete_policy" ON historico_grades
FOR DELETE USING (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN'))
);

-- ── 14. POLÍTICAS: HISTÓRICO DE APRENDIZADO ──

DROP POLICY IF EXISTS "historico_aprendizado_select_policy" ON historico_aprendizado;
CREATE POLICY "historico_aprendizado_select_policy" ON historico_aprendizado
FOR SELECT USING (
    is_super_admin() OR escola_id = get_user_escola_id()
);

DROP POLICY IF EXISTS "historico_aprendizado_insert_policy" ON historico_aprendizado;
CREATE POLICY "historico_aprendizado_insert_policy" ON historico_aprendizado
FOR INSERT WITH CHECK (
    is_super_admin() OR escola_id = get_user_escola_id()
);

-- ── 15. POLÍTICAS: AUDITORIA ──

DROP POLICY IF EXISTS "auditoria_select_policy" ON auditoria;
CREATE POLICY "auditoria_select_policy" ON auditoria
FOR SELECT USING (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_role() IN ('GESTOR_ESCOLA', 'SUPER_ADMIN'))
);

DROP POLICY IF EXISTS "auditoria_insert_policy" ON auditoria;
CREATE POLICY "auditoria_insert_policy" ON auditoria
FOR INSERT WITH CHECK (
    is_super_admin() OR escola_id = get_user_escola_id() OR escola_id IS NULL
);
