-- =============================================================================
-- EDUHORÁRIOS - SEED INICIAL E PRESERVAÇÃO MASTER (FASE 3)
-- =============================================================================

-- Inserir Escola Padrão Inicial se não existir
INSERT INTO escolas (id, nome, codigo, cidade, estado)
VALUES ('00000000-0000-0000-0000-000000000001', 'Escola Modelo EduHorários', 'ESC-001', 'Belo Horizonte', 'MG')
ON CONFLICT (codigo) DO NOTHING;

-- Estrutura de Perfil MASTER Preservada
INSERT INTO perfis_usuarios (
    id,
    escola_id,
    nome,
    nome_completo,
    login,
    nome_usuario,
    email,
    telefone,
    role,
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
    'Administrador EduHorários',
    'admin',
    'admin',
    'admin@eduhorarios.com.br',
    '(31) 99887-6655',
    'SUPER_ADMIN',
    'SUPER_ADMIN',
    'admin',
    'ativo',
    'Conta MASTER oficial da plataforma EduHorários',
    TRUE
)
ON CONFLICT (email) DO NOTHING;

-- Tabela de compatibilidade usuarios
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
