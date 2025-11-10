# Oracle Autonomous Database 23ai - Terraform Deployment

**Author:** Juliano Stefano
**LinkedIn:** https://www.linkedin.com/in/julianostefano/
**Repository:** https://github.com/julianostefano/saddling-up-the-tejo

[Português (PT-BR)](README.pt-BR.md) | **English**

---

## Overview

This Terraform module deploys an Oracle Autonomous Database 23ai with AI/ML capabilities on Oracle Cloud Infrastructure (OCI). It is designed for RAG (Retrieval-Augmented Generation) workloads using Vector Search.

### Key Features

- Oracle Database 23ai with Vector Search support
- Always Free Tier compatible (1 OCPU, 1 TB storage)
- Production-ready configuration options
- Comprehensive security controls (mTLS, IP whitelisting)
- Auto-scaling and Data Guard support (paid tier)
- Full integration with OCI Resource Manager

### What Gets Deployed

- 1x Autonomous Database 23ai instance
- Service Console access for monitoring
- Database Actions (SQL Developer Web)
- Connection strings for HIGH, MEDIUM, and LOW service levels

---

## Prerequisites

Before deploying this infrastructure, ensure you have:

### 1. OCI Account Setup

- Active OCI account (Free Tier or paid)
- Access to a compartment where you can create resources
- Compartment OCID (see [How to Find Your Compartment OCID](#how-to-find-your-compartment-ocid))

### 2. Required Tools

| Tool | Version | Installation |
|------|---------|--------------|
| **Terraform** | >= 1.5.0 | [Download](https://www.terraform.io/downloads) |
| **OCI CLI** | Latest | [Installation Guide](https://docs.oracle.com/en-us/iaas/Content/API/SDKDocs/cliinstall.htm) |

Verify installations:
```bash
terraform --version
oci --version
```

### 3. OCI CLI Configuration

Configure OCI CLI with your credentials:

```bash
oci setup config
```

You will be prompted for:
- **Location for config:** Press Enter for default `~/.oci/config`
- **User OCID:** Found in OCI Console > Profile > User Settings
- **Tenancy OCID:** Found in OCI Console > Profile > Tenancy
- **Region:** Your home region (e.g., `us-ashburn-1`)
- **Generate API signing key:** `Y` (creates new key pair)

Verify configuration:
```bash
oci iam region list
```

### 4. SSH Key Pair (Optional)

Not required for this module, but useful for future compute instances:
```bash
ssh-keygen -t rsa -b 4096 -f ~/.ssh/oci_key
```

---

## How to Find Your Compartment OCID

### Method 1: OCI Console

1. Log into [Oracle Cloud Console](https://cloud.oracle.com/)
2. Navigate to: **Identity & Security > Compartments**
3. Click on your desired compartment
4. Copy the OCID (starts with `ocid1.compartment.oc1..`)

### Method 2: OCI CLI

```bash
oci iam compartment list --compartment-id-in-subtree true
```

Look for your compartment name and copy its `id` field.

---

## Deployment Options

Choose your preferred deployment method:

### Option A: Deploy via OCI Resource Manager (No Local Setup Required)

Deploy directly from GitHub using OCI Console - **no local Terraform installation needed!**

1. **Open OCI Console**
   - Navigate to: **Developer Services > Resource Manager > Stacks**
   - Click **Create Stack**

2. **Configure Stack Source**
   - Select **Source Code Control System**
   - **Source Code Management Type:** GitHub
   - **Configuration Source Provider:** Create new or select existing
   - **Repository:** `https://github.com/julianostefano/saddling-up-the-tejo`
   - **Branch:** `main`
   - **Working Directory:** `oci/terraform/autonomous-db-23ai`
   - Click **Next**

3. **Configure Variables**
   The UI is automatically generated from `schema.yaml`:
   - **Required Configuration:**
     - Select compartment
     - Enter admin password (12-30 chars)
     - Paste SSH public key
   - **Database Configuration:**
     - Database name: `AILAKE01`
     - Version: `26ai` (recommended)
     - Workload: `LH` (Lakehouse)
   - **Network Configuration:**
     - Select existing VCN
     - Select public subnet (for application server)
     - Select private subnet (for database)
     - Select NSGs for compute and database
   - **Security:**
     - Enable mTLS (recommended)
     - Configure IP whitelist (optional)
   - Click **Next**

4. **Review and Create**
   - Review all settings
   - Click **Create**

5. **Apply Stack**
   - Click **Terraform Actions > Apply**
   - Confirm with **Apply**
   - Wait 5-15 minutes for completion

6. **View Outputs**
   - After successful apply, click **Outputs**
   - Copy database OCID, connection strings, application server IP
   - Use `app_server_ssh_command` to connect to application server

**Advantages:**
- No local Terraform installation
- UI-driven configuration
- Built-in validation
- State managed by OCI
- Team collaboration via OCI

---

### Option B: Deploy via Local Terraform (Advanced)

For local development and customization:

#### Step 1: Clone Repository

```bash
git clone https://github.com/julianostefano/saddling-up-the-tejo.git
cd saddling-up-the-tejo/oci/terraform/autonomous-db-23ai
```

#### Step 2: Configure Variables

Copy the example variables file:
```bash
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` with your values:
```hcl
# Required: Your compartment OCID
compartment_id = "ocid1.compartment.oc1..aaaaaaaXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"

# Required: Strong password for ADMIN user (12-30 chars)
admin_password = "YourSecurePassword123!"

# Optional: Customize database name and settings
db_name      = "AILAKE01"
display_name = "AI Data Lakehouse 23ai"
db_version   = "23ai"
db_workload  = "DW"
is_free_tier = true
```

**Important:** Never commit `terraform.tfvars` to version control. It's already in `.gitignore`.

#### Step 3: Initialize Terraform

```bash
terraform init
```

This downloads the OCI provider and initializes the backend.

#### Step 4: Validate Configuration

```bash
terraform validate
```

Expected output: `Success! The configuration is valid.`

#### Step 5: Preview Changes

```bash
terraform plan
```

Review the execution plan. You should see:
- `1 to add` (Autonomous Database)
- `0 to change`
- `0 to destroy`

#### Step 6: Deploy Infrastructure

```bash
terraform apply
```

Type `yes` when prompted. Deployment takes 5-15 minutes.

---

## Deployment Outputs

After successful deployment, Terraform outputs important information:

```bash
terraform output
```

### Key Outputs

| Output | Description |
|--------|-------------|
| `autonomous_database_id` | OCID of the database instance |
| `database_connection_string_high` | Connection string for HIGH service |
| `database_connection_string_medium` | Connection string for MEDIUM service |
| `database_connection_string_low` | Connection string for LOW service |
| `service_console_url` | URL to Service Console |
| `lifecycle_state` | Current state (should be `AVAILABLE`) |
| `next_steps` | Detailed next steps guide |

### View Specific Output

```bash
terraform output database_connection_string_high
terraform output service_console_url
```

### Export to JSON

```bash
terraform output -json > deployment_info.json
```

---

## Testing Your Deployment

### 1. Download Database Wallet (Regional)

The wallet contains certificates for secure mTLS connections. We use the **regional wallet** which works for all databases in the region.

#### Option A: Automated Script (Recommended)

```bash
# Download and extract regional wallet automatically
./download-wallet.sh
```

The script will:
- Fetch database OCID from Terraform outputs
- Download regional wallet (works for all databases in region)
- Extract wallet files to `./wallet/` directory
- Set correct permissions
- Display connection examples

#### Option B: Manual Download

```bash
# Set your database OCID from terraform output
DB_OCID=$(terraform output -raw autonomous_database_id)
DB_NAME=$(terraform output -raw autonomous_database_name)

# Download REGIONAL wallet (--generate-type ALL)
oci db autonomous-database generate-wallet \
  --autonomous-database-id $DB_OCID \
  --file wallet_${DB_NAME}.zip \
  --password 'WalletPassword123!' \
  --generate-type ALL

# Extract wallet
mkdir -p ./wallet
unzip wallet_${DB_NAME}.zip -d ./wallet
chmod 600 ./wallet/*
```

**Regional vs Instance Wallet:**
- **Regional Wallet:** Works for all databases in the region (recommended)
- **Instance Wallet:** Specific to one database only

### 2. Install Oracle Instant Client

**macOS (Homebrew):**
```bash
brew tap InstantClientTap/instantclient
brew install instantclient-basic instantclient-sqlplus
```

**Linux (Oracle Linux/RHEL):**
```bash
sudo yum install oracle-instantclient-basic oracle-instantclient-sqlplus
```

**Download manually:** [Oracle Instant Client Downloads](https://www.oracle.com/database/technologies/instant-client/downloads.html)

### 3. Test SQL*Plus Connection

```bash
# Set wallet location
export TNS_ADMIN=./wallet

# Connect using regional wallet
sqlplus admin/YourSecurePassword123!@ailake01_high
```

Expected output:
```
Oracle Database 23ai Enterprise Edition Release 23.0.0.0.0 - Production
Version 23.x.x.x.x

SQL>
```

Run a test query:
```sql
SELECT banner FROM v$version;
EXIT;
```

### 4. Access Service Console

Get the URL:
```bash
terraform output service_console_url
```

Open in browser and login with:
- **Username:** `ADMIN`
- **Password:** `YourSecurePassword123!`

### 5. Access Database Actions (SQL Developer Web)

From Service Console, click **Database Actions** or get URL:
```bash
terraform output ords_url
```

---

## Connection Examples

### Python (oracledb)

```python
import oracledb

# Initialize Oracle Client with regional wallet
oracledb.init_oracle_client(config_dir="./wallet")

# Connect to database
connection = oracledb.connect(
    user="ADMIN",
    password="YourSecurePassword123!",
    dsn="ailake01_high"
)

# Test query
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

oracledb.initOracleClient({ configDir: './wallet' });

async function testConnection() {
  const connection = await oracledb.getConnection({
    user: 'ADMIN',
    password: 'YourSecurePassword123!',
    connectString: 'ailake01_high'
  });

  const result = await connection.execute('SELECT banner FROM v$version');
  console.log(result.rows);

  await connection.close();
}

testConnection();
```

### Java (JDBC)

```java
import java.sql.*;

public class TestConnection {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:oracle:thin:@ailake01_high?TNS_ADMIN=./wallet";
        String user = "ADMIN";
        String password = "YourSecurePassword123!";

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

## Troubleshooting

### Error: "Service error: NotAuthorizedOrNotFound"

**Cause:** Incorrect compartment OCID or insufficient permissions.

**Solution:**
```bash
# Verify compartment exists
oci iam compartment get --compartment-id "your-compartment-ocid"

# Check your permissions in OCI Console > Identity > Policies
```

### Error: "Admin password does not meet requirements"

**Cause:** Password doesn't meet Oracle's complexity requirements.

**Requirements:**
- 12-30 characters
- At least 1 uppercase letter
- At least 1 lowercase letter
- At least 1 number
- Cannot contain "admin"
- No double quotes

**Solution:** Update `admin_password` in `terraform.tfvars` with a compliant password.

### Error: "Free tier limit exceeded"

**Cause:** You already have 2 Always Free Autonomous Databases.

**Solutions:**
1. Delete an existing Always Free database
2. Set `is_free_tier = false` and use paid tier
3. Use a different tenancy

### Error: "Cannot connect with SQL*Plus"

**Cause:** Missing TNS_ADMIN environment variable or wallet issues.

**Solution:**
```bash
# Verify wallet location
ls -la ./wallet/

# Set environment variable
export TNS_ADMIN=./wallet

# Check tnsnames.ora
cat $TNS_ADMIN/tnsnames.ora | grep ailake01_high

# Re-download wallet if corrupted
./download-wallet.sh
```

### Database State is "PROVISIONING"

**Cause:** Database is still being created.

**Solution:** Wait 5-15 minutes. Check status:
```bash
terraform output lifecycle_state
```

Or in OCI Console: **Oracle Database > Autonomous Database**

---

## Modifying Your Deployment

### Scale Up/Down (Paid Tier Only)

Edit `terraform.tfvars`:
```hcl
is_free_tier    = false
cpu_core_count  = 4  # Scale to 4 OCPUs
```

Apply changes:
```bash
terraform plan
terraform apply
```

### Enable Auto-Scaling (Paid Tier Only)

```hcl
is_free_tier             = false
is_auto_scaling_enabled  = true
```

### Add IP Whitelist

```hcl
whitelisted_ips = [
  "203.0.113.0/24",     # Corporate network
  "198.51.100.5/32",    # Application server
]
```

### Enable mTLS (Production)

```hcl
is_mtls_connection_required = true
```

---

## Cleanup

### Destroy All Resources

**Warning:** This permanently deletes your database and all data.

```bash
terraform destroy
```

Type `yes` when prompted.

### Verify Deletion

Check OCI Console or:
```bash
oci db autonomous-database list --compartment-id "your-compartment-ocid"
```

---

## Cost Estimation

### Always Free Tier

- **Cost:** $0.00/month (indefinitely)
- **Limits:** 2 databases per tenancy

### Paid Tier Example

| Configuration | Monthly Cost (USD)* |
|---------------|---------------------|
| 1 OCPU, 1 TB | ~$180 |
| 2 OCPUs, 2 TB | ~$360 |
| 4 OCPUs, 4 TB | ~$720 |

*Approximate costs. Check [OCI Pricing](https://www.oracle.com/cloud/price-list.html) for current rates.

---

## Next Steps

After successful deployment:

1. **Setup Vector Search Schema:**
   ```bash
   cd ../../../scripts/
   sqlplus admin/password@ailake01_high @setup_vector_schema.sql
   ```

2. **Proceed to Phase 2:**
   - Implement Python RAG application
   - Ingest documents and generate embeddings
   - Test Vector Search queries

3. **Explore Database Features:**
   - Access Database Actions for SQL development
   - Create additional database users
   - Configure Object Storage integration
   - Setup monitoring and alerts

---

## Security Best Practices

1. **Never commit credentials:**
   - Use `.gitignore` for `terraform.tfvars`
   - Consider OCI Vault for production secrets

2. **Enable mTLS for production:**
   ```hcl
   is_mtls_connection_required = true
   ```

3. **Configure IP whitelisting:**
   ```hcl
   whitelisted_ips = ["your-app-ip/32"]
   ```

4. **Use strong passwords:**
   - Minimum 16 characters for production
   - Use password managers
   - Rotate credentials regularly

5. **Enable audit logging:**
   - Monitor access via Service Console
   - Configure OCI Audit service
   - Review logs regularly

6. **Backup strategy:**
   - Always Free: No automatic backups
   - Paid tier: Configure automatic backups
   - Export data regularly using Data Pump

---

## Additional Resources

### Oracle Documentation

- [Autonomous Database 23ai Overview](https://www.oracle.com/autonomous-database/)
- [AI Vector Search Guide](https://docs.oracle.com/en/database/oracle/oracle-database/23/vecse/)
- [OCI Terraform Provider](https://registry.terraform.io/providers/oracle/oci/latest/docs)

### Terraform Resources

- [Terraform OCI Examples](https://github.com/oracle/terraform-provider-oci/tree/master/examples)
- [Terraform Best Practices](https://www.terraform.io/docs/cloud/guides/recommended-practices/index.html)

### Project Documentation

- [Main Project README](../../../README.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [QUICKSTART.md](QUICKSTART.md) - 5-minute quick start

---

## Support and Contributions

For issues, questions, or contributions:

- **GitHub Issues:** [Create an issue](https://github.com/julianostefano/saddling-up-the-tejo/issues)
- **LinkedIn:** [Juliano Stefano](https://www.linkedin.com/in/julianostefano/)
- **Email:** jsdealencar@ayesa.com

---

## License

This project is open source and available for educational and portfolio purposes.

**Author:** Juliano Stefano
**LinkedIn:** https://www.linkedin.com/in/julianostefano/
**Year:** 2025
