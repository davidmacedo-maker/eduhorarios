# EduHorários - Guia Completo de Implantação e Desacoplamento (React + PHP + MySQL)

Este guia descreve o procedimento de implantação em produção do **EduHorários**, dividindo a aplicação na arquitetura desacoplada **Frontend React / Vite**, **API Backend PHP** e **Banco de Dados MySQL**.

---

## 🏛️ Visão Geral da Arquitetura

```text
[ CLIENTE NAVEGADOR ]
          │
          ├──> Frontend React (Vite Build Static Files)
          │    URL: https://eduhorarios.com
          │    (Usa VITE_API_URL=https://api.eduhorarios.com)
          │
          └──> API Backend PHP (com PDO e Sessões HTTPOnly)
               URL: https://api.eduhorarios.com
               │
               └──> Banco de Dados MySQL / Cloud SQL
                    Host: IP / Hostname do servidor MySQL (porta 3306)
                    Database: eduhorarios
```

---

## 🚀 PASSO A PASSO DE IMPLANTAÇÃO (ETAPAS 1 A 11)

### 🗄️ ETAPA 1 — Criar o Banco de Dados MySQL
Acesse o MySQL (via MySQL CLI, cPanel, phpMyAdmin, DBeaver ou GCP Cloud SQL) e crie o banco de dados:

```sql
CREATE DATABASE eduhorarios CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

---

### 👤 ETAPA 2 — Criar o Usuário Dedicado do MySQL
Crie um usuário exclusivo para a aplicação com senha forte. Evite usar o usuário `root` em produção:

```sql
CREATE USER 'eduhorarios_user'@'%' IDENTIFIED BY 'SUA_SENHA_FORTE_AQUI';
GRANT ALL PRIVILEGES ON eduhorarios.* TO 'eduhorarios_user'@'%';
FLUSH PRIVILEGES;
```

---

### 📜 ETAPA 3 — Importar o Schema do Banco (`database/schema.sql`)
Importe a estrutura oficial das tabelas para o banco `eduhorarios`:

```bash
mysql -u eduhorarios_user -p eduhorarios < database/schema.sql
```

Ou execute o conteúdo do arquivo `/database/schema.sql` na sua ferramenta gráfica MySQL.

---

### ⚙️ ETAPA 4 — Configurar Variáveis do Backend PHP
No servidor PHP, configure as variáveis de ambiente ou o arquivo `.env` localizado na raiz do backend:

```env
DB_HOST=IP_DO_SEU_SERVIDOR_MYSQL
DB_PORT=3306
DB_NAME=eduhorarios
DB_USER=eduhorarios_user
DB_PASSWORD=SUA_SENHA_FORTE_AQUI
DB_CHARSET=utf8mb4
FRONTEND_URL=https://eduhorarios.com
```

---

### 📂 ETAPA 5 — Hospedar os Arquivos do Backend PHP
Envie a estrutura backend para o servidor web com PHP 8.1+ e extensão `pdo_mysql` habilitada:

**Arquivos necessários no servidor PHP:**
- `/auth/` (endpoints REST: `login.php`, `cadastro.php`, `logout.php`, `session.php`, `recuperar-senha.php`, `redefinir-senha.php`, `perfil.php`, `db-admin.php`)
- `/config/` (`database.php`)
- `/includes/` (`auth.php`, `session.php`)
- `/database/` (`schema.sql`)
- `/scripts/` (`export_db.php`, `import_db.php`)
- `/.env` (arquivo de ambiente das credenciais)

> **Nota de Segurança:** O código React de `/src/` e componentes JSX/TSX **NÃO** precisam nem devem ser enviados para a hospedagem do PHP.

---

### ⚛️ ETAPA 6 — Configurar `VITE_API_URL` no Frontend React
No ambiente onde o frontend React é construído (Vite build / Vercel / Netlify / Cloud Run static), defina a variável de ambiente:

```env
VITE_API_URL=https://api.eduhorarios.com
```

Se o frontend e a API PHP forem hospedados no mesmo domínio (ex: `https://eduhorarios.com` e `https://eduhorarios.com/auth/*`), deixe `VITE_API_URL=` em branco (o sistema usará caminhos relativos automaticamente).

Execute o build do frontend:
```bash
npm run build
```
E publique o conteúdo da pasta `dist/` no seu servidor de arquivos estáticos.

---

### 🛡️ ETAPA 7 — Configurar CORS no Backend
No arquivo `/.env` do backend PHP, defina o domínio exato do seu frontend React em `FRONTEND_URL`:

```env
FRONTEND_URL=https://eduhorarios.com
```

Isso garante que a API PHP enviará o cabeçalho:
`Access-Control-Allow-Origin: https://eduhorarios.com`
`Access-Control-Allow-Credentials: true`

Sem usar wildcard `*`, garantindo o envio seguro de cookies de sessão cross-origin.

---

### 🔒 ETAPA 8 — Configurar HTTPS
Tanto o frontend (`https://eduhorarios.com`) quanto o backend (`https://api.eduhorarios.com`) **devem utilizar HTTPS com certificado SSL válido**.
Isso é obrigatório para que os cookies de sessão com `Secure` e `SameSite=None` sejam transmitidos com segurança pelo navegador.

---

### 🧪 ETAPA 9 — Testar o Cadastro
1. Acesse o frontend na página de cadastro (`/cadastro`).
2. Cadastre um novo usuário de teste.
3. Verifique a resposta em JSON no console do navegador e confirme o registro na tabela `usuarios` do MySQL com hash BCRYPT na senha.

---

### 🔑 ETAPA 10 — Testar o Login
1. Acesse a página de login (`/login`).
2. Insira o e-mail e senha cadastrados.
3. Confirme que o cookie de sessão PHP HTTPOnly foi gravado e que o navegador redirecionou para o Dashboard.

---

### 🔄 ETAPA 11 — Testar Recuperação de Senha
1. Clique em "Esqueci minha senha" e insira o e-mail cadastrado.
2. Verifique na tabela `password_resets` do MySQL que o token foi gravado como hash SHA-256 e `usado = 0`.
3. Acesse o link de redefinição, cadastre a nova senha e confirme que o registro foi atualizado para `usado = 1` e a nova senha gravada via BCRYPT.
