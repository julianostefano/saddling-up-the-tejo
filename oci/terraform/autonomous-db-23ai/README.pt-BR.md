# Oracle Autonomous Database 23ai - Deployment com Terraform

**Autor:** Juliano Stefano
**LinkedIn:** https://www.linkedin.com/in/julianostefano/
**Repositório:** https://github.com/julianostefano/saddling-up-the-tejo

**Português (PT-BR)** | [English](README.md)

---

## Visão Geral

Este módulo Terraform realiza o deploy de um Oracle Autonomous Database 23ai com capacidades de AI/ML na Oracle Cloud Infrastructure (OCI). Foi projetado para cargas de trabalho RAG (Retrieval-Augmented Generation) utilizando Vector Search.

### Recursos Principais

- Oracle Database 23ai com suporte a Vector Search
- Compatível com Always Free Tier (1 OCPU, 1 TB de armazenamento)
- Opções de configuração para produção
- Controles de segurança abrangentes (mTLS, whitelist de IPs)
- Suporte a Auto-scaling e Data Guard (tier pago)
- Integração completa com OCI Resource Manager

### O Que Será Implantado

- 1x instância Autonomous Database 23ai
- Acesso ao Service Console para monitoramento
- Database Actions (SQL Developer Web)
- Strings de conexão para níveis de serviço HIGH, MEDIUM e LOW

---

## Pré-requisitos

Antes de implantar esta infraestrutura, certifique-se de ter:

### 1. Configuração da Conta OCI

- Conta OCI ativa (Free Tier ou paga)
- Acesso a um compartment onde você pode criar recursos
- OCID do Compartment (veja [Como Encontrar o OCID do Seu Compartment](#como-encontrar-o-ocid-do-seu-compartment))

### 2. Ferramentas Necessárias

| Ferramenta | Versão | Instalação |
|------------|---------|------------|
| **Terraform** | >= 1.5.0 | [Download](https://www.terraform.io/downloads) |
| **OCI CLI** | Mais recente | [Guia de Instalação](https://docs.oracle.com/en-us/iaas/Content/API/SDKDocs/cliinstall.htm) |

Verifique as instalações:
```bash
terraform --version
oci --version
```

### 3. Configuração do OCI CLI

Configure o OCI CLI com suas credenciais:

```bash
oci setup config
```

Você será solicitado a fornecer:
- **Localização do config:** Pressione Enter para o padrão `~/.oci/config`
- **User OCID:** Encontrado em OCI Console > Perfil > User Settings
- **Tenancy OCID:** Encontrado em OCI Console > Perfil > Tenancy
- **Região:** Sua região home (ex: `us-ashburn-1`)
- **Gerar chave de assinatura da API:** `Y` (cria novo par de chaves)

Verifique a configuração:
```bash
oci iam region list
```

### 4. Par de Chaves SSH (Opcional)

Não é necessário para este módulo, mas útil para futuras instâncias compute:
```bash
ssh-keygen -t rsa -b 4096 -f ~/.ssh/oci_key
```

---

## Como Encontrar o OCID do Seu Compartment

### Método 1: Console OCI

1. Faça login no [Oracle Cloud Console](https://cloud.oracle.com/)
2. Navegue até: **Identity & Security > Compartments**
3. Clique no compartment desejado
4. Copie o OCID (começa com `ocid1.compartment.oc1..`)

### Método 2: OCI CLI

```bash
oci iam compartment list --compartment-id-in-subtree true
```

Procure pelo nome do seu compartment e copie o campo `id`.

---

## Início Rápido

### Passo 1: Clonar Repositório

```bash
git clone https://github.com/julianostefano/saddling-up-the-tejo.git
cd saddling-up-the-tejo/oci/terraform/autonomous-db-23ai
```

### Passo 2: Configurar Variáveis

Copie o arquivo de exemplo de variáveis:
```bash
cp terraform.tfvars.example terraform.tfvars
```

Edite `terraform.tfvars` com seus valores:
```hcl
# Obrigatório: OCID do seu compartment
compartment_id = "ocid1.compartment.oc1..aaaaaaaXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"

# Obrigatório: Senha forte para usuário ADMIN (12-30 caracteres)
admin_password = "SuaSenhaSegura123!"

# Opcional: Personalize nome e configurações do banco
db_name      = "AILAKE01"
display_name = "AI Data Lakehouse 23ai"
db_version   = "23ai"
db_workload  = "DW"
is_free_tier = true
```

**Importante:** Nunca faça commit de `terraform.tfvars` no controle de versão. Ele já está no `.gitignore`.

### Passo 3: Inicializar Terraform

```bash
terraform init
```

Isso baixa o provider OCI e inicializa o backend.

### Passo 4: Validar Configuração

```bash
terraform validate
```

Saída esperada: `Success! The configuration is valid.`

### Passo 5: Visualizar Mudanças

```bash
terraform plan
```

Revise o plano de execução. Você deve ver:
- `1 to add` (Autonomous Database)
- `0 to change`
- `0 to destroy`

### Passo 6: Implantar Infraestrutura

```bash
terraform apply
```

Digite `yes` quando solicitado. O deployment leva 5-15 minutos.

---

## Outputs do Deployment

Após o deployment bem-sucedido, o Terraform exibe informações importantes:

```bash
terraform output
```

### Outputs Principais

| Output | Descrição |
|--------|-----------|
| `autonomous_database_id` | OCID da instância do banco de dados |
| `database_connection_string_high` | String de conexão para serviço HIGH |
| `database_connection_string_medium` | String de conexão para serviço MEDIUM |
| `database_connection_string_low` | String de conexão para serviço LOW |
| `service_console_url` | URL do Service Console |
| `lifecycle_state` | Estado atual (deve ser `AVAILABLE`) |
| `next_steps` | Guia detalhado de próximos passos |

### Visualizar Output Específico

```bash
terraform output database_connection_string_high
terraform output service_console_url
```

### Exportar para JSON

```bash
terraform output -json > deployment_info.json
```

---

## Testando Seu Deployment

### 1. Baixar Database Wallet

O wallet contém certificados para conexões seguras mTLS:

```bash
# Defina o OCID do banco a partir do terraform output
DB_OCID=$(terraform output -raw autonomous_database_id)

# Baixe o wallet
oci db autonomous-database generate-wallet \
  --autonomous-database-id $DB_OCID \
  --file wallet_AILAKE01.zip \
  --password 'SenhaDoWallet123!'

# Extraia o wallet
mkdir -p ~/wallet_AILAKE01
unzip wallet_AILAKE01.zip -d ~/wallet_AILAKE01
```

### 2. Instalar Oracle Instant Client

**macOS (Homebrew):**
```bash
brew tap InstantClientTap/instantclient
brew install instantclient-basic instantclient-sqlplus
```

**Linux (Oracle Linux/RHEL):**
```bash
sudo yum install oracle-instantclient-basic oracle-instantclient-sqlplus
```

**Download manual:** [Oracle Instant Client Downloads](https://www.oracle.com/database/technologies/instant-client/downloads.html)

### 3. Testar Conexão com SQL*Plus

```bash
export TNS_ADMIN=~/wallet_AILAKE01

sqlplus admin/SuaSenhaSegura123!@ailake01_high
```

Saída esperada:
```
Oracle Database 23ai Enterprise Edition Release 23.0.0.0.0 - Production
Version 23.x.x.x.x

SQL>
```

Execute uma consulta de teste:
```sql
SELECT banner FROM v$version;
EXIT;
```

### 4. Acessar Service Console

Obtenha a URL:
```bash
terraform output service_console_url
```

Abra no navegador e faça login com:
- **Usuário:** `ADMIN`
- **Senha:** `SuaSenhaSegura123!`

### 5. Acessar Database Actions (SQL Developer Web)

No Service Console, clique em **Database Actions** ou obtenha a URL:
```bash
terraform output ords_url
```

---

## Exemplos de Conexão

### Python (oracledb)

```python
import oracledb

# Inicializar Oracle Client com wallet
oracledb.init_oracle_client(config_dir="/Users/seu-usuario/wallet_AILAKE01")

# Conectar ao banco de dados
connection = oracledb.connect(
    user="ADMIN",
    password="SuaSenhaSegura123!",
    dsn="ailake01_high"
)

# Consulta de teste
cursor = connection.cursor()
cursor.execute("SELECT banner FROM v$version")
for row in cursor:
    print(row)

cursor.close()
connection.close()
```

### Node.js (oracledb)

```javascript
const oracledb = require('oracledb');

oracledb.initOracleClient({ configDir: '/Users/seu-usuario/wallet_AILAKE01' });

async function testarConexao() {
  const connection = await oracledb.getConnection({
    user: 'ADMIN',
    password: 'SuaSenhaSegura123!',
    connectString: 'ailake01_high'
  });

  const result = await connection.execute('SELECT banner FROM v$version');
  console.log(result.rows);

  await connection.close();
}

testarConexao();
```

### Java (JDBC)

```java
import java.sql.*;

public class TestarConexao {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:oracle:thin:@ailake01_high?TNS_ADMIN=/Users/seu-usuario/wallet_AILAKE01";
        String user = "ADMIN";
        String password = "SuaSenhaSegura123!";

        Connection conn = DriverManager.getConnection(url, user, password);
        Statement stmt = conn.createStatement();
        ResultSet rs = stmt.executeQuery("SELECT banner FROM v$version");

        while (rs.next()) {
            System.out.println(rs.getString(1));
        }

        rs.close();
        stmt.close();
        conn.close();
    }
}
```

---

## Solução de Problemas

### Erro: "Service error: NotAuthorizedOrNotFound"

**Causa:** OCID do compartment incorreto ou permissões insuficientes.

**Solução:**
```bash
# Verifique se o compartment existe
oci iam compartment get --compartment-id "seu-compartment-ocid"

# Verifique suas permissões em OCI Console > Identity > Policies
```

### Erro: "Admin password does not meet requirements"

**Causa:** Senha não atende aos requisitos de complexidade do Oracle.

**Requisitos:**
- 12-30 caracteres
- Pelo menos 1 letra maiúscula
- Pelo menos 1 letra minúscula
- Pelo menos 1 número
- Não pode conter "admin"
- Sem aspas duplas

**Solução:** Atualize `admin_password` no `terraform.tfvars` com uma senha compatível.

### Erro: "Free tier limit exceeded"

**Causa:** Você já possui 2 Autonomous Databases Always Free.

**Soluções:**
1. Delete um banco Always Free existente
2. Configure `is_free_tier = false` e use tier pago
3. Use outro tenancy

### Erro: "Cannot connect with SQL*Plus"

**Causa:** Variável de ambiente TNS_ADMIN ausente ou problemas com o wallet.

**Solução:**
```bash
# Verifique a localização do wallet
ls -la ~/wallet_AILAKE01/

# Configure a variável de ambiente
export TNS_ADMIN=~/wallet_AILAKE01

# Verifique o tnsnames.ora
cat $TNS_ADMIN/tnsnames.ora | grep ailake01_high
```

### Estado do Banco é "PROVISIONING"

**Causa:** O banco ainda está sendo criado.

**Solução:** Aguarde 5-15 minutos. Verifique o status:
```bash
terraform output lifecycle_state
```

Ou no OCI Console: **Oracle Database > Autonomous Database**

---

## Modificando Seu Deployment

### Escalar Para Cima/Baixo (Somente Tier Pago)

Edite `terraform.tfvars`:
```hcl
is_free_tier    = false
cpu_core_count  = 4  # Escalar para 4 OCPUs
```

Aplique as mudanças:
```bash
terraform plan
terraform apply
```

### Habilitar Auto-Scaling (Somente Tier Pago)

```hcl
is_free_tier             = false
is_auto_scaling_enabled  = true
```

### Adicionar Whitelist de IPs

```hcl
whitelisted_ips = [
  "203.0.113.0/24",     # Rede corporativa
  "198.51.100.5/32",    # Servidor de aplicação
]
```

### Habilitar mTLS (Produção)

```hcl
is_mtls_connection_required = true
```

---

## Limpeza

### Destruir Todos os Recursos

**Aviso:** Isso exclui permanentemente seu banco de dados e todos os dados.

```bash
terraform destroy
```

Digite `yes` quando solicitado.

### Verificar Exclusão

Verifique no OCI Console ou:
```bash
oci db autonomous-database list --compartment-id "seu-compartment-ocid"
```

---

## Estimativa de Custos

### Always Free Tier

- **Custo:** R$ 0,00/mês (indefinidamente)
- **Limites:** 2 bancos de dados por tenancy

### Exemplo de Tier Pago

| Configuração | Custo Mensal (USD)* |
|--------------|---------------------|
| 1 OCPU, 1 TB | ~$180 |
| 2 OCPUs, 2 TB | ~$360 |
| 4 OCPUs, 4 TB | ~$720 |

*Custos aproximados. Verifique [Preços OCI](https://www.oracle.com/cloud/price-list.html) para valores atuais.

---

## Próximos Passos

Após o deployment bem-sucedido:

1. **Configurar Schema Vector Search:**
   ```bash
   cd ../../../scripts/
   sqlplus admin/senha@ailake01_high @setup_vector_schema.sql
   ```

2. **Prosseguir para a Fase 2:**
   - Implementar aplicação RAG em Python
   - Ingerir documentos e gerar embeddings
   - Testar consultas Vector Search

3. **Explorar Recursos do Banco:**
   - Acessar Database Actions para desenvolvimento SQL
   - Criar usuários adicionais do banco
   - Configurar integração com Object Storage
   - Configurar monitoramento e alertas

---

## Boas Práticas de Segurança

1. **Nunca faça commit de credenciais:**
   - Use `.gitignore` para `terraform.tfvars`
   - Considere OCI Vault para secrets de produção

2. **Habilite mTLS para produção:**
   ```hcl
   is_mtls_connection_required = true
   ```

3. **Configure whitelist de IPs:**
   ```hcl
   whitelisted_ips = ["ip-da-sua-app/32"]
   ```

4. **Use senhas fortes:**
   - Mínimo 16 caracteres para produção
   - Use gerenciadores de senhas
   - Rotacione credenciais regularmente

5. **Habilite logging de auditoria:**
   - Monitore acessos via Service Console
   - Configure serviço OCI Audit
   - Revise logs regularmente

6. **Estratégia de backup:**
   - Always Free: Sem backups automáticos
   - Tier pago: Configure backups automáticos
   - Exporte dados regularmente usando Data Pump

---

## Recursos Adicionais

### Documentação Oracle

- [Visão Geral Autonomous Database 23ai](https://www.oracle.com/autonomous-database/)
- [Guia AI Vector Search](https://docs.oracle.com/en/database/oracle/oracle-database/23/vecse/)
- [Provider Terraform OCI](https://registry.terraform.io/providers/oracle/oci/latest/docs)

### Recursos Terraform

- [Exemplos Terraform OCI](https://github.com/oracle/terraform-provider-oci/tree/master/examples)
- [Melhores Práticas Terraform](https://www.terraform.io/docs/cloud/guides/recommended-practices/index.html)

### Documentação do Projeto

- [README Principal do Projeto](../../../README.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [QUICKSTART.md](QUICKSTART.md) - Início rápido de 5 minutos

---

## Suporte e Contribuições

Para problemas, questões ou contribuições:

- **GitHub Issues:** [Criar issue](https://github.com/julianostefano/saddling-up-the-tejo/issues)
- **LinkedIn:** [Juliano Stefano](https://www.linkedin.com/in/julianostefano/)
- **Email:** jsdealencar@ayesa.com

---

## Licença

Este projeto é open source e disponível para fins educacionais e de portfólio.

**Autor:** Juliano Stefano
**LinkedIn:** https://www.linkedin.com/in/julianostefano/
**Ano:** 2025
