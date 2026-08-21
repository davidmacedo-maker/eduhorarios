-- =============================================================================
-- EDUHORÁRIOS - POLÍTICAS DE SEGURANÇA E RLS SUPABASE (FASE 4)
-- Isolamento Multi-tenant por Escola + Proteção ao MASTER / SUPER_ADMIN
-- =============================================================================

-- ── 1. FUNÇÕES AUXILIARES DE AUTORIZAÇÃO SEGURA NO BANCO (SECURITY DEFINER) ──

-- Retorna se o usuário autenticado atual é SUPER_ADMIN / MASTER
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM usuarios
        WHERE (auth_user_id = auth.uid() OR id = auth.uid())
          AND (is_super_admin = TRUE OR perfil = 'SUPER_ADMIN')
          AND status = 'ativo'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Retorna o ID da escola vinculada ao usuário autenticado atual
CREATE OR REPLACE FUNCTION get_user_escola_id()
RETURNS UUID AS $$
DECLARE
    v_escola_id UUID;
BEGIN
    SELECT escola_id INTO v_escola_id
    FROM usuarios
    WHERE (auth_user_id = auth.uid() OR id = auth.uid())
      AND status = 'ativo'
    LIMIT 1;

    RETURN v_escola_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Retorna o perfil do usuário autenticado atual
CREATE OR REPLACE FUNCTION get_user_perfil()
RETURNS VARCHAR AS $$
DECLARE
    v_perfil VARCHAR;
BEGIN
    SELECT perfil INTO v_perfil
    FROM usuarios
    WHERE (auth_user_id = auth.uid() OR id = auth.uid())
      AND status = 'ativo'
    LIMIT 1;

    RETURN v_perfil;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 2. HABILITAR ROW LEVEL SECURITY (RLS) EM TODAS AS TABELAS ──

ALTER TABLE escolas ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE professores ENABLE ROW LEVEL SECURITY;
ALTER TABLE turmas ENABLE ROW LEVEL SECURITY;
ALTER TABLE disciplinas ENABLE ROW LEVEL SECURITY;
ALTER TABLE matriz_curricular ENABLE ROW LEVEL SECURITY;
ALTER TABLE alocacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE horarios_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE livro_ponto ENABLE ROW LEVEL SECURITY;
ALTER TABLE atividades_extraclasse ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;

-- ── 3. POLÍTICAS: ESCOLAS ──

-- SELECT: SUPER_ADMIN vê todas; usuários comuns veem apenas a sua própria escola
CREATE POLICY "escolas_select_policy" ON escolas
FOR SELECT USING (
    is_super_admin() OR id = get_user_escola_id()
);

-- INSERT / UPDATE / DELETE: Somente SUPER_ADMIN pode criar/alterar/excluir escolas
CREATE POLICY "escolas_admin_insert_policy" ON escolas
FOR INSERT WITH CHECK (
    is_super_admin()
);

CREATE POLICY "escolas_admin_update_policy" ON escolas
FOR UPDATE USING (
    is_super_admin() OR (id = get_user_escola_id() AND get_user_perfil() = 'GESTOR_ESCOLA')
) WITH CHECK (
    is_super_admin() OR (id = get_user_escola_id() AND get_user_perfil() = 'GESTOR_ESCOLA')
);

CREATE POLICY "escolas_admin_delete_policy" ON escolas
FOR DELETE USING (
    is_super_admin()
);

-- ── 4. POLÍTICAS: USUARIOS / PERFIS ──

-- SELECT: SUPER_ADMIN vê todos; Gestor vê usuários da sua escola; Usuário vê a si mesmo
CREATE POLICY "usuarios_select_policy" ON usuarios
FOR SELECT USING (
    is_super_admin() 
    OR escola_id = get_user_escola_id()
    OR auth_user_id = auth.uid()
    OR id = auth.uid()
);

-- INSERT: SUPER_ADMIN pode inserir qualquer um; Gestor só pode criar usuários para sua escola (nunca SUPER_ADMIN)
CREATE POLICY "usuarios_insert_policy" ON usuarios
FOR INSERT WITH CHECK (
    is_super_admin()
    OR (
        escola_id = get_user_escola_id()
        AND get_user_perfil() = 'GESTOR_ESCOLA'
        AND is_super_admin = FALSE
        AND perfil != 'SUPER_ADMIN'
    )
);

-- UPDATE:
-- - Usuários comuns não podem alterar seu próprio perfil para SUPER_ADMIN nem alterar sua própria escola
-- - SUPER_ADMIN pode atualizar qualquer usuário
-- - Gestor pode atualizar usuários da sua escola (sem poder promover a SUPER_ADMIN nem alterar conta MASTER)
CREATE POLICY "usuarios_update_policy" ON usuarios
FOR UPDATE USING (
    is_super_admin()
    OR (
        escola_id = get_user_escola_id()
        AND get_user_perfil() = 'GESTOR_ESCOLA'
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
        AND perfil != 'SUPER_ADMIN'
    )
);

-- DELETE: Somente SUPER_ADMIN ou Gestor na sua escola (com bloqueio estrito contra apagar contas MASTER)
CREATE POLICY "usuarios_delete_policy" ON usuarios
FOR DELETE USING (
    (is_super_admin() AND is_super_admin = FALSE) -- Mesmo SUPER_ADMIN não pode apagar o MASTER primário
    OR (
        escola_id = get_user_escola_id()
        AND get_user_perfil() = 'GESTOR_ESCOLA'
        AND is_super_admin = FALSE
        AND perfil != 'SUPER_ADMIN'
    )
);

-- ── 5. POLÍTICAS: PROFESSORES ──

CREATE POLICY "professores_select_policy" ON professores
FOR SELECT USING (
    is_super_admin() OR escola_id = get_user_escola_id()
);

CREATE POLICY "professores_insert_policy" ON professores
FOR INSERT WITH CHECK (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_perfil() = 'GESTOR_ESCOLA')
);

CREATE POLICY "professores_update_policy" ON professores
FOR UPDATE USING (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_perfil() = 'GESTOR_ESCOLA')
) WITH CHECK (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_perfil() = 'GESTOR_ESCOLA')
);

CREATE POLICY "professores_delete_policy" ON professores
FOR DELETE USING (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_perfil() = 'GESTOR_ESCOLA')
);

-- ── 6. POLÍTICAS: TURMAS ──

CREATE POLICY "turmas_select_policy" ON turmas
FOR SELECT USING (
    is_super_admin() OR escola_id = get_user_escola_id()
);

CREATE POLICY "turmas_insert_policy" ON turmas
FOR INSERT WITH CHECK (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_perfil() = 'GESTOR_ESCOLA')
);

CREATE POLICY "turmas_update_policy" ON turmas
FOR UPDATE USING (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_perfil() = 'GESTOR_ESCOLA')
) WITH CHECK (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_perfil() = 'GESTOR_ESCOLA')
);

CREATE POLICY "turmas_delete_policy" ON turmas
FOR DELETE USING (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_perfil() = 'GESTOR_ESCOLA')
);

-- ── 7. POLÍTICAS: DISCIPLINAS ──

CREATE POLICY "disciplinas_select_policy" ON disciplinas
FOR SELECT USING (
    is_super_admin() OR escola_id = get_user_escola_id()
);

CREATE POLICY "disciplinas_insert_policy" ON disciplinas
FOR INSERT WITH CHECK (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_perfil() = 'GESTOR_ESCOLA')
);

CREATE POLICY "disciplinas_update_policy" ON disciplinas
FOR UPDATE USING (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_perfil() = 'GESTOR_ESCOLA')
) WITH CHECK (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_perfil() = 'GESTOR_ESCOLA')
);

CREATE POLICY "disciplinas_delete_policy" ON disciplinas
FOR DELETE USING (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_perfil() = 'GESTOR_ESCOLA')
);

-- ── 8. POLÍTICAS: MATRIZ CURRICULAR ──

CREATE POLICY "matriz_select_policy" ON matriz_curricular
FOR SELECT USING (
    is_super_admin() OR escola_id = get_user_escola_id()
);

CREATE POLICY "matriz_insert_policy" ON matriz_curricular
FOR INSERT WITH CHECK (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_perfil() = 'GESTOR_ESCOLA')
);

CREATE POLICY "matriz_update_policy" ON matriz_curricular
FOR UPDATE USING (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_perfil() = 'GESTOR_ESCOLA')
) WITH CHECK (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_perfil() = 'GESTOR_ESCOLA')
);

CREATE POLICY "matriz_delete_policy" ON matriz_curricular
FOR DELETE USING (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_perfil() = 'GESTOR_ESCOLA')
);

-- ── 9. POLÍTICAS: ALOCACOES (GRADE) ──

CREATE POLICY "alocacoes_select_policy" ON alocacoes
FOR SELECT USING (
    is_super_admin() OR escola_id = get_user_escola_id()
);

CREATE POLICY "alocacoes_insert_policy" ON alocacoes
FOR INSERT WITH CHECK (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_perfil() = 'GESTOR_ESCOLA')
);

CREATE POLICY "alocacoes_update_policy" ON alocacoes
FOR UPDATE USING (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_perfil() = 'GESTOR_ESCOLA')
) WITH CHECK (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_perfil() = 'GESTOR_ESCOLA')
);

CREATE POLICY "alocacoes_delete_policy" ON alocacoes
FOR DELETE USING (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_perfil() = 'GESTOR_ESCOLA')
);

-- ── 10. POLÍTICAS: HORARIOS RAW / IMPORTAÇÃO ──

CREATE POLICY "horarios_raw_select_policy" ON horarios_raw
FOR SELECT USING (
    is_super_admin() OR escola_id = get_user_escola_id()
);

CREATE POLICY "horarios_raw_insert_policy" ON horarios_raw
FOR INSERT WITH CHECK (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_perfil() = 'GESTOR_ESCOLA')
);

CREATE POLICY "horarios_raw_delete_policy" ON horarios_raw
FOR DELETE USING (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_perfil() = 'GESTOR_ESCOLA')
);

-- ── 11. POLÍTICAS: LIVRO PONTO ──

CREATE POLICY "livro_ponto_select_policy" ON livro_ponto
FOR SELECT USING (
    is_super_admin() OR escola_id = get_user_escola_id()
);

CREATE POLICY "livro_ponto_insert_policy" ON livro_ponto
FOR INSERT WITH CHECK (
    is_super_admin() OR escola_id = get_user_escola_id()
);

CREATE POLICY "livro_ponto_update_policy" ON livro_ponto
FOR UPDATE USING (
    is_super_admin() OR escola_id = get_user_escola_id()
) WITH CHECK (
    is_super_admin() OR escola_id = get_user_escola_id()
);

CREATE POLICY "livro_ponto_delete_policy" ON livro_ponto
FOR DELETE USING (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_perfil() = 'GESTOR_ESCOLA')
);

-- ── 12. POLÍTICAS: ATIVIDADES EXTRACLASSE ──

CREATE POLICY "extraclasse_select_policy" ON atividades_extraclasse
FOR SELECT USING (
    is_super_admin() OR escola_id = get_user_escola_id()
);

CREATE POLICY "extraclasse_insert_policy" ON atividades_extraclasse
FOR INSERT WITH CHECK (
    is_super_admin() OR escola_id = get_user_escola_id()
);

CREATE POLICY "extraclasse_update_policy" ON atividades_extraclasse
FOR UPDATE USING (
    is_super_admin() OR escola_id = get_user_escola_id()
) WITH CHECK (
    is_super_admin() OR escola_id = get_user_escola_id()
);

CREATE POLICY "extraclasse_delete_policy" ON atividades_extraclasse
FOR DELETE USING (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_perfil() = 'GESTOR_ESCOLA')
);

-- ── 13. POLÍTICAS: AUDITORIA ──

-- Somente SUPER_ADMIN e Gestores da própria escola podem visualizar logs
CREATE POLICY "auditoria_select_policy" ON auditoria
FOR SELECT USING (
    is_super_admin() OR (escola_id = get_user_escola_id() AND get_user_perfil() = 'GESTOR_ESCOLA')
);

-- Qualquer usuário autenticado pode registrar logs de suas próprias ações
CREATE POLICY "auditoria_insert_policy" ON auditoria
FOR INSERT WITH CHECK (
    is_super_admin() OR escola_id = get_user_escola_id() OR escola_id IS NULL
);
