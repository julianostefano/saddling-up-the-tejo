# Autonomous Database 23ai - Guia de Início Rápido

**Autor:** Juliano Stefano | **LinkedIn:** https://www.linkedin.com/in/julianostefano/

**Português (PT-BR)** | [English](QUICKSTART.md)

Tenha seu Oracle Autonomous Database 23ai rodando em 5 minutos.

---

## Checklist de Pré-requisitos

Antes de começar, certifique-se de ter:

- [ ] Conta OCI com Free Tier ou acesso pago
- [ ] Terraform >= 1.5.0 instalado ([Download](https://www.terraform.io/downloads))
- [ ] OCI CLI configurado (`oci setup config`)
- [ ] OCID do Compartment (encontrado em OCI Console > Identity > Compartments)
- [ ] Senha admin forte (12-30 caracteres, maiúscula, minúscula, número)

---

## Deployment em 5 Minutos

### Passo 1: Clonar e Navegar

```bash
git clone https://github.com/julianostefano/saddling-up-the-tejo.git
cd saddling-up-the-tejo/oci/terraform/autonomous-db-23ai
```

### Passo 2: Configurar Variáveis

```bash
cp terraform.tfvars.example terraform.tfvars
```

Edite `terraform.tfvars` com seus valores:

```hcl
compartment_id = "ocid1.compartment.oc1..aaaaaaaXXXXXXXXXXXXXXX"
admin_password = "SuaSenhaSegura123!"
```

### Passo 3: Implantar

```bash
terraform init
terraform apply -auto-approve
```

Aguarde 5-15 minutos para conclusão do deployment.

---

## Verificar Deployment

### Verificar Status

```bash
terraform output lifecycle_state
```

Esperado: `AVAILABLE`

### Obter Informações de Conexão

```bash
terraform output database_connection_string_high
terraform output service_console_url
```

---

## Teste Rápido de Conexão

### 1. Baixar Wallet

```bash
DB_OCID=$(terraform output -raw autonomous_database_id)

oci db autonomous-database generate-wallet \
  --autonomous-database-id $DB_OCID \
  --file wallet.zip \
  --password 'SenhaDoWallet123!'

mkdir -p ~/wallet_AILAKE01
unzip wallet.zip -d ~/wallet_AILAKE01
```

### 2. Testar Conexão

```bash
export TNS_ADMIN=~/wallet_AILAKE01
sqlplus admin/SuaSenhaSegura123!@ailake01_high
```

Execute consulta de teste:

```sql
SELECT banner FROM v$version;
EXIT;
```

---

## Acessar Interface Web

### Service Console

```bash
open $(terraform output -raw service_console_url)
```

Login: `ADMIN` / `SuaSenhaSegura123!`

### Database Actions (SQL Developer Web)

No Service Console, clique em **Database Actions**.

---

## Problemas Comuns

| Problema | Solução |
|----------|---------|
| **Erro de autenticação** | Verifique OCID do compartment: `oci iam compartment get --compartment-id "seu-ocid"` |
| **Senha rejeitada** | Deve ter 12-30 caracteres com maiúscula, minúscula e número |
| **Limite free tier** | Máximo 2 bancos Always Free por tenancy |
| **SQL*Plus falha** | Configure `export TNS_ADMIN=~/wallet_AILAKE01` |

---

## Próximos Passos

1. **Configurar schema Vector Search:**
   ```bash
   sqlplus admin/senha@ailake01_high @../../../scripts/setup_vector_schema.sql
   ```

2. **Prosseguir para Fase 2:**
   - Implementar aplicação RAG em Python
   - Ingerir documentos e gerar embeddings

3. **Ler documentação completa:**
   - [README Completo](README.pt-BR.md)
   - [Guia de Arquitetura](ARCHITECTURE.md)

---

## Limpeza

Excluir todos os recursos:

```bash
terraform destroy -auto-approve
```

---

## Precisa de Ajuda?

- **Documentação Completa:** [README.pt-BR.md](README.pt-BR.md)
- **GitHub Issues:** [Criar Issue](https://github.com/julianostefano/saddling-up-the-tejo/issues)
- **LinkedIn:** [Juliano Stefano](https://www.linkedin.com/in/julianostefano/)

---

**Autor:** Juliano Stefano
**Repositório:** https://github.com/julianostefano/saddling-up-the-tejo
