# ==============================================================================
# Oracle OCI Multicloud Portfolio - Terraform Outputs
# ==============================================================================
# Purpose: Export Autonomous Database connection information and metadata for
#          use in other modules or for reference.
#
# Example Usage:
#   terraform output
#   terraform output -json > db_config.json
#   terraform output database_connection_string_high
#
# Author: Juliano Stefano
# LinkedIn: https://www.linkedin.com/in/julianostefano/
# Repository: https://github.com/julianostefano/saddling-up-the-tejo
#
# Standards Compliance:
#   - Comprehensive output documentation
#   - Sensitive data handling
#   - Production-ready connection examples
#
# ==============================================================================

# ==============================================================================
# Database Identification Outputs
# ==============================================================================

output "autonomous_database_id" {
  description = "OCID of the Autonomous Database instance"
  value       = oci_database_autonomous_database.ai_lakehouse.id
}

output "autonomous_database_name" {
  description = "Database name (used in connection strings)"
  value       = oci_database_autonomous_database.ai_lakehouse.db_name
}

output "autonomous_database_display_name" {
  description = "Human-readable display name"
  value       = oci_database_autonomous_database.ai_lakehouse.display_name
}

# ==============================================================================
# Connection String Outputs
# ==============================================================================

output "database_connection_string_high" {
  description = <<-EOT
    Connection string for HIGH service level (maximum resources).

    Use for:
    - Critical reporting queries
    - Batch processing
    - Data loading operations

    Example JDBC URL:
    jdbc:oracle:thin:@<connection_string_from_output>

    Example SQL*Plus:
    sqlplus admin/password@AILAKE01_high
  EOT
  value       = try(oci_database_autonomous_database.ai_lakehouse.connection_strings[0].profiles[0].value, "")
}

output "database_connection_string_medium" {
  description = <<-EOT
    Connection string for MEDIUM service level (balanced resources).

    Use for:
    - OLTP transactions
    - Interactive queries
    - General application workloads

    Example JDBC URL:
    jdbc:oracle:thin:@<connection_string_from_output>

    Example SQL*Plus:
    sqlplus admin/password@AILAKE01_medium
  EOT
  value       = try(oci_database_autonomous_database.ai_lakehouse.connection_strings[0].profiles[1].value, "")
}

output "database_connection_string_low" {
  description = <<-EOT
    Connection string for LOW service level (minimum resources).

    Use for:
    - Background jobs
    - Non-urgent reporting
    - Development/testing

    Example JDBC URL:
    jdbc:oracle:thin:@<connection_string_from_output>

    Example SQL*Plus:
    sqlplus admin/password@AILAKE01_low
  EOT
  value       = try(oci_database_autonomous_database.ai_lakehouse.connection_strings[0].profiles[2].value, "")
}

output "database_connection_strings_all" {
  description = "All available connection strings and profiles"
  value       = oci_database_autonomous_database.ai_lakehouse.connection_strings
  sensitive   = false
}

# ==============================================================================
# Service URLs and Management Outputs
# ==============================================================================

output "service_console_url" {
  description = <<-EOT
    URL to access the Autonomous Database Service Console.

    Service Console provides:
    - Performance monitoring
    - Activity logs
    - SQL query history
    - Database Actions (SQL Developer Web)

    Access with ADMIN credentials.
  EOT
  value       = try(oci_database_autonomous_database.ai_lakehouse.service_console_url, "Provisioning - check OCI Console")
}

output "apex_url" {
  description = <<-EOT
    URL to access Oracle APEX development environment.

    Note: Only available if db_workload = "APEX"

    Default credentials:
    - Workspace: INTERNAL
    - Username: ADMIN
    - Password: [admin_password]
  EOT
  value       = try(oci_database_autonomous_database.ai_lakehouse.connection_urls[0].apex_url, "Not available for this workload type")
}

output "ords_url" {
  description = <<-EOT
    URL to access Oracle REST Data Services (ORDS).

    Use for:
    - RESTful API development
    - Database Actions interface
    - SQL Developer Web
  EOT
  value       = try(oci_database_autonomous_database.ai_lakehouse.connection_urls[0].ords_url, "")
}

# ==============================================================================
# Database State and Status Outputs
# ==============================================================================

output "lifecycle_state" {
  description = <<-EOT
    Current lifecycle state of the Autonomous Database.

    Possible states:
    - PROVISIONING: Database is being created
    - AVAILABLE: Database is ready for use
    - STOPPING: Database is being stopped
    - STOPPED: Database is stopped
    - STARTING: Database is being started
    - TERMINATING: Database is being deleted
    - TERMINATED: Database has been deleted
    - UNAVAILABLE: Database is unavailable
    - RESTORE_IN_PROGRESS: Restore operation in progress
    - BACKUP_IN_PROGRESS: Backup operation in progress
    - SCALE_IN_PROGRESS: Scaling operation in progress
    - UPDATING: Update operation in progress
  EOT
  value       = oci_database_autonomous_database.ai_lakehouse.state
}

output "time_created" {
  description = "Timestamp when the database was created (RFC3339 format)"
  value       = oci_database_autonomous_database.ai_lakehouse.time_created
}

output "is_free_tier" {
  description = "Whether the database is running on Always Free tier"
  value       = oci_database_autonomous_database.ai_lakehouse.is_free_tier
}

# ==============================================================================
# Configuration Details Outputs
# ==============================================================================

output "db_version" {
  description = "Oracle Database version (19c, 21c, or 23ai)"
  value       = oci_database_autonomous_database.ai_lakehouse.db_version
}

output "db_workload" {
  description = "Database workload type (OLTP, DW, AJD, or APEX)"
  value       = oci_database_autonomous_database.ai_lakehouse.db_workload
}

output "cpu_core_count" {
  description = "Number of OCPU cores allocated to the database"
  value       = oci_database_autonomous_database.ai_lakehouse.cpu_core_count
}

output "data_storage_size_in_tbs" {
  description = "Storage size in terabytes"
  value       = oci_database_autonomous_database.ai_lakehouse.data_storage_size_in_tbs
}

# ==============================================================================
# Wallet Download Instructions Output
# ==============================================================================

output "wallet_download_instructions" {
  description = <<-EOT
    Instructions to download the database wallet for secure connections.

    Using OCI CLI:
    --------------
    oci db autonomous-database generate-wallet \
      --autonomous-database-id <DATABASE_OCID> \
      --file wallet_AILAKE01.zip \
      --password 'WalletPassword123!'

    Using OCI Console:
    -----------------
    1. Navigate to: OCI Console > Autonomous Database > Your Database
    2. Click: "Database Connection"
    3. Click: "Download Wallet"
    4. Enter wallet password
    5. Save wallet.zip file

    Using the Wallet:
    ----------------
    1. Unzip wallet to a directory (e.g., /path/to/wallet)
    2. Set environment variables:
       export TNS_ADMIN=/path/to/wallet
       export LD_LIBRARY_PATH=/path/to/instantclient:$LD_LIBRARY_PATH
    3. Connect using wallet:
       sqlplus admin/password@AILAKE01_high

    Python Connection with Wallet:
    -----------------------------
    import oracledb

    oracledb.init_oracle_client(config_dir="/path/to/wallet")

    connection = oracledb.connect(
        user="ADMIN",
        password="your_password",
        dsn="AILAKE01_high"
    )
  EOT
  value       = "See description for detailed wallet download and usage instructions"
}

# ==============================================================================
# Next Steps Output
# ==============================================================================

output "next_steps" {
  description = "Recommended next steps after deployment"
  value       = "Autonomous Database deployed successfully! Run 'terraform output deployment_summary' for details, and 'terraform output wallet_download_instructions' for wallet setup."
}

# ==============================================================================
# Application Server (Compute Instance) Outputs
# ==============================================================================

output "app_server_public_ip" {
  description = <<-EOT
    Public IP address of the application server for SSH access.

    Use this IP to SSH into the server and run Bun applications.

    Example SSH command:
    ssh -i ~/.ssh/id_rsa opc@<public_ip>
  EOT
  value       = oci_core_instance.app_server.public_ip
}

output "app_server_private_ip" {
  description = "Private IP address of the application server within the VCN"
  value       = oci_core_instance.app_server.private_ip
}

output "app_server_instance_id" {
  description = "OCID of the application server compute instance"
  value       = oci_core_instance.app_server.id
}

output "app_server_ssh_command" {
  description = <<-EOT
    SSH command to connect to the application server.

    Copy and run this command (replace path to your private key):
  EOT
  value       = "ssh -i ~/.ssh/id_rsa opc@${oci_core_instance.app_server.public_ip}"
}

output "database_connection_from_app_server" {
  description = <<-EOT
    Instructions to connect to the database from the application server.

    After SSH into the application server:
  EOT
  value       = <<-EOT
    1. SSH into application server:
       ssh -i ~/.ssh/id_rsa opc@${oci_core_instance.app_server.public_ip}

    2. Connect to database (requires wallet for mTLS):
       sqlplus admin/<password>@${oci_database_autonomous_database.ai_lakehouse.db_name}_high

    3. Test Vector Search capabilities:
       SELECT banner FROM v$version;
       SELECT * FROM v$option WHERE parameter = 'Vector';

    Note: Oracle Instant Client and tools are pre-installed via cloud-init.
  EOT
}

# ==============================================================================
# Summary Output (for quick reference)
# ==============================================================================

output "deployment_summary" {
  description = "Deployment summary with key information"
  value = {
    database_id            = oci_database_autonomous_database.ai_lakehouse.id
    database_name          = oci_database_autonomous_database.ai_lakehouse.db_name
    display_name           = oci_database_autonomous_database.ai_lakehouse.display_name
    state                  = oci_database_autonomous_database.ai_lakehouse.state
    db_version             = oci_database_autonomous_database.ai_lakehouse.db_version
    db_workload            = oci_database_autonomous_database.ai_lakehouse.db_workload
    is_free_tier           = oci_database_autonomous_database.ai_lakehouse.is_free_tier
    cpu_cores              = oci_database_autonomous_database.ai_lakehouse.cpu_core_count
    storage_tbs            = oci_database_autonomous_database.ai_lakehouse.data_storage_size_in_tbs
    service_console_url    = try(oci_database_autonomous_database.ai_lakehouse.service_console_url, "Provisioning - check OCI Console")
    time_created           = oci_database_autonomous_database.ai_lakehouse.time_created
    app_server_public_ip   = oci_core_instance.app_server.public_ip
    app_server_ssh_command = "ssh -i ~/.ssh/id_rsa opc@${oci_core_instance.app_server.public_ip}"
  }
}
