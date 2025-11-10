# Quick Start - Deploy from GitHub in 5 Minutes

**Author:** Juliano Stefano
**Repository:** https://github.com/julianostefano/saddling-up-the-tejo

Deploy Oracle Autonomous Database 23ai/26ai with Vector Search directly from GitHub using OCI Resource Manager - **no local setup required!**

---

## Prerequisites

1. **OCI Account** - Free Tier or Paid
2. **Existing VCN** - Create via OCI Console wizard first:
   - Navigate to: **Networking > Virtual Cloud Networks**
   - Click **Start VCN Wizard** > **Create VCN with Internet Connectivity**
   - Note down: VCN OCID, Public Subnet OCID, Private Subnet OCID
3. **SSH Key Pair** - Generate if needed:
   ```bash
   ssh-keygen -t rsa -b 4096 -f ~/.ssh/oci_key
   cat ~/.ssh/oci_key.pub  # Copy this
   ```

---

## Step-by-Step Deployment

### 1. Open OCI Console

Login to [Oracle Cloud Console](https://cloud.oracle.com/)

### 2. Create Resource Manager Stack

Navigate to: **Developer Services > Resource Manager > Stacks**

Click **Create Stack**

### 3. Configure Stack Source

| Field | Value |
|-------|-------|
| **Stack Configuration** | Source Code Control System |
| **Source Code Management Type** | GitHub |
| **Repository URL** | `https://github.com/julianostefano/saddling-up-the-tejo` |
| **Branch** | `main` |
| **Working Directory** | `oci/terraform/autonomous-db-23ai` |

Click **Next**

### 4. Configure Variables

The UI is auto-generated from `schema.yaml`. Fill in:

#### Required Configuration
- **Compartment:** Select your compartment
- **Admin Password:** Strong password (12-30 chars)
  - Example: `MySecurePass123!`
- **SSH Public Key:** Paste contents of `~/.ssh/oci_key.pub`

#### Database Configuration
- **Database Name:** `AILAKE01`
- **Display Name:** `AI Data Lakehouse 26ai`
- **Database Version:** `26ai` ✓ (recommended)
- **Workload Type:** `LH` (Lakehouse) ✓

#### Always Free Tier
- **Enable Always Free Tier:** ✓ Yes (for free deployment)

#### Network Configuration
- **VCN:** Select your existing VCN
- **Public Subnet:** Select public subnet (for application server)
- **Private Subnet:** Select private subnet (for database)
- **Compute NSG:** Select or create NSG allowing SSH (port 22)
- **Database NSG:** Select or create NSG allowing Oracle Net (1521-1522)

#### Security Configuration
- **Require mTLS:** ✓ Yes (recommended)
- **IP Whitelist:** Leave empty (allow all) or add your IP

#### Application Server
- **Compute Shape:** `VM.Standard.E2.1.Micro` (Always Free)
- **Display Name:** `autonomous-db-app-server`

Click **Next**

### 5. Review and Create

- Review all settings
- Click **Create**

### 6. Apply Stack

- Click **Terraform Actions > Apply**
- Confirm with **Apply**
- Wait 5-15 minutes ⏱️

### 7. View Outputs

After successful deployment, click **Outputs** tab:

| Output | Description |
|--------|-------------|
| `autonomous_database_id` | Database OCID |
| `service_console_url` | Management console URL |
| `app_server_public_ip` | SSH to app server: `ssh opc@<IP>` |
| `database_connection_string_high` | HIGH service connection |
| `next_steps` | Post-deployment instructions |

---

## Next Steps

### Download Database Wallet

Back in your terminal (or use OCI Cloud Shell):

```bash
# Set database OCID from outputs
DB_OCID="<paste from outputs>"

# Download regional wallet
oci db autonomous-database generate-wallet \
  --autonomous-database-id $DB_OCID \
  --file wallet_AILAKE01.zip \
  --password 'WalletPassword123!' \
  --generate-type ALL

# Extract wallet
mkdir -p ./wallet
unzip wallet_AILAKE01.zip -d ./wallet
chmod 600 ./wallet/*
```

### SSH to Application Server

```bash
# Get application server IP from outputs
APP_SERVER_IP="<paste from outputs>"

# SSH to application server
ssh -i ~/.ssh/oci_key opc@$APP_SERVER_IP
```

### Test Database Connection from Application Server

```bash
# On application server
export TNS_ADMIN=/opt/oracle/wallet

# Copy wallet to application server (from local machine)
scp -i ~/.ssh/oci_key -r ./wallet opc@$APP_SERVER_IP:/opt/oracle/

# Test connection
sqlplus admin/<your_password>@AILAKE01_high

# Run test query
SQL> SELECT banner FROM v$version;
SQL> EXIT;
```

### Access Service Console

Click the `service_console_url` from outputs or navigate to:
- **Oracle Database > Autonomous Databases**
- Click on your database name
- Click **Service Console**

Login:
- **Username:** `ADMIN`
- **Password:** `<your_password>`

---

## Common Issues

### Error: "VCN not found"

**Solution:** Create VCN first via **Networking > Virtual Cloud Networks > Start VCN Wizard**

### Error: "NSG not found"

**Solution:** Create NSGs:
1. **Networking > Network Security Groups**
2. Create two NSGs (compute and database)
3. Add ingress rules:
   - Compute NSG: TCP port 22 (SSH)
   - Database NSG: TCP ports 1521-1522 (Oracle Net)

### Error: "Free tier limit exceeded"

**Solutions:**
- Delete existing Always Free database
- Use paid tier (uncheck "Enable Always Free Tier")
- Use different tenancy

### Cannot connect to database

**Check:**
1. Wallet downloaded correctly
2. TNS_ADMIN set: `export TNS_ADMIN=./wallet`
3. Check tnsnames.ora: `cat ./wallet/tnsnames.ora`
4. Verify password is correct

---

## Cost

### Always Free Tier
- **Cost:** $0.00/month forever
- **Limits:** 1 OCPU, 1 TB storage
- **Maximum:** 2 databases per tenancy

### Paid Tier
- Estimated ~$180/month for 1 OCPU, 1 TB
- Scales based on OCPUs and storage

---

## Clean Up

To delete all resources:

1. Navigate to **Resource Manager > Stacks**
2. Select your stack
3. Click **Terraform Actions > Destroy**
4. Confirm with **Destroy**

**Warning:** This permanently deletes database and all data!

---

## Support

- **GitHub Issues:** [Create Issue](https://github.com/julianostefano/saddling-up-the-tejo/issues)
- **LinkedIn:** [Juliano Stefano](https://www.linkedin.com/in/julianostefano/)
- **Full Documentation:** [README.md](README.md)

---

**Author:** Juliano Stefano
**Year:** 2025
