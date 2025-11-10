# ==============================================================================
# Oracle OCI Multicloud Portfolio - Autonomous Database 23ai Deployment
# ==============================================================================
# Purpose: Deploy Oracle Autonomous Database 23ai with AI/ML capabilities for
#          RAG (Retrieval-Augmented Generation) workloads using Vector Search.
#
# Example Usage:
#   terraform init
#   terraform plan -var-file="dev.tfvars"
#   terraform apply -auto-approve
#
# Author: Juliano Stefano
# LinkedIn: https://www.linkedin.com/in/julianostefano/
# Repository: https://github.com/julianostefano/saddling-up-the-tejo
#
# Standards Compliance:
#   - Terraform >= 1.5.0
#   - OCI Resource Manager compatible
#   - Always Free tier compatible
#   - Production-ready with comprehensive documentation
#
# ==============================================================================

# ==============================================================================
# Autonomous Database Instance
# ==============================================================================
# Note: Data sources are defined in data-sources.tf

resource "oci_database_autonomous_database" "ai_lakehouse" {
  # ------------------------------------------------------------------------------
  # Required Attributes
  # ------------------------------------------------------------------------------

  compartment_id = var.compartment_id
  db_name        = var.db_name
  display_name   = var.display_name

  # ------------------------------------------------------------------------------
  # Database Configuration
  # ------------------------------------------------------------------------------

  db_version  = var.db_version
  db_workload = var.db_workload

  # Admin password for ADMIN user
  # IMPORTANT: Store this securely - use environment variables or OCI Vault
  admin_password = var.admin_password

  # ------------------------------------------------------------------------------
  # Compute & Storage Configuration
  # ------------------------------------------------------------------------------

  # Always Free tier settings
  is_free_tier = var.is_free_tier

  # OCPU configuration
  # Always Free: 1 OCPU (fixed)
  # Paid tier: 1-128 OCPUs
  cpu_core_count = var.cpu_core_count

  # Storage configuration
  # Always Free: 1 TB (fixed)
  # Paid tier: 1-128 TB
  data_storage_size_in_tbs = var.data_storage_size_in_tbs

  # ------------------------------------------------------------------------------
  # Network & Security Configuration
  # ------------------------------------------------------------------------------

  # Database Access Type: PUBLIC (no private endpoint, no NSGs)
  # The database is accessible from anywhere on the internet.
  # Access control is managed via:
  # 1. mTLS requirement (wallet-based authentication)
  # 2. IP whitelisting (currently disabled - allows all IPs)

  # Mutual TLS (mTLS) connection requirement
  # true: Requires Oracle Wallet for connections (more secure)
  # false: Allows SQL*Net connections without wallet (easier for development)
  is_mtls_connection_required = var.is_mtls_connection_required

  # IP whitelist for database access
  # Empty list/null = allow all IPs from anywhere (current configuration)
  # For production, specify allowed CIDR blocks: ["203.0.113.0/24"]
  whitelisted_ips = length(var.whitelisted_ips) > 0 ? var.whitelisted_ips : null

  # NO subnet_id = Public database (not in VCN)
  # NO nsg_ids = No Network Security Group restrictions
  # NO private_endpoint = Public internet access

  # ------------------------------------------------------------------------------
  # High Availability & Scaling
  # ------------------------------------------------------------------------------

  # Auto-scaling (NOT available on Always Free tier)
  # When enabled, database can scale up to 3x base OCPU count
  is_auto_scaling_enabled = var.is_free_tier ? false : var.is_auto_scaling_enabled

  # Autonomous Data Guard (NOT available on Always Free tier)
  # Creates standby database for HA/DR
  is_data_guard_enabled = var.is_free_tier ? false : var.is_data_guard_enabled

  # ------------------------------------------------------------------------------
  # Backup Configuration
  # ------------------------------------------------------------------------------

  # Backup retention period in days
  # Always Free: Backups are not available (retention = 0)
  # Paid tier: 1-60 days (default: 60)
  # Setting to 7 days for development to reduce storage costs
  backup_retention_period_in_days = var.is_free_tier ? null : 7

  # ------------------------------------------------------------------------------
  # Licensing
  # ------------------------------------------------------------------------------

  # License model
  # LICENSE_INCLUDED: Oracle provides license (required for Always Free)
  # BRING_YOUR_OWN_LICENSE: Use existing Oracle licenses
  license_model = var.license_model

  # ------------------------------------------------------------------------------
  # Tags for Organization & Cost Tracking
  # ------------------------------------------------------------------------------

  freeform_tags = merge(
    var.freeform_tags,
    {
      "Created"   = timestamp()
      "Terraform" = "true"
      "ManagedBy" = "Terraform"
      "Phase"     = "Phase-1-Infrastructure"
    }
  )

  defined_tags = var.defined_tags

  # ------------------------------------------------------------------------------
  # Lifecycle Management
  # ------------------------------------------------------------------------------

  lifecycle {
    # Prevent accidental deletion of database
    prevent_destroy = false # Set to true for production

    # Ignore changes to these attributes after creation
    ignore_changes = [
      freeform_tags["Created"],
      # Add other attributes to ignore here
    ]

    # Create replacement before destroying (safer for state changes)
    create_before_destroy = false # Set to true for zero-downtime updates
  }

  # ------------------------------------------------------------------------------
  # Timeouts
  # ------------------------------------------------------------------------------

  timeouts {
    create = "60m" # Autonomous DB creation typically takes 5-15 minutes
    update = "30m"
    delete = "30m"
  }
}

# ==============================================================================
# Local Values for Computed Attributes
# ==============================================================================

locals {
  # Parse connection strings for different service levels
  connection_string_high   = try(oci_database_autonomous_database.ai_lakehouse.connection_strings[0].profiles[0].value, "")
  connection_string_medium = try(oci_database_autonomous_database.ai_lakehouse.connection_strings[0].profiles[1].value, "")
  connection_string_low    = try(oci_database_autonomous_database.ai_lakehouse.connection_strings[0].profiles[2].value, "")

  # Database OCID for reference in other modules
  database_id = oci_database_autonomous_database.ai_lakehouse.id

  # Service console URL
  service_console_url = oci_database_autonomous_database.ai_lakehouse.service_console_url

  # Database lifecycle state
  lifecycle_state = oci_database_autonomous_database.ai_lakehouse.state

  # Tags for outputs
  creation_timestamp = oci_database_autonomous_database.ai_lakehouse.time_created
}

# ==============================================================================
# Null Resource for Post-Deployment Tasks (Optional)
# ==============================================================================

# Uncomment to run SQL scripts after database creation
# resource "null_resource" "setup_vector_schema" {
#   depends_on = [oci_database_autonomous_database.ai_lakehouse]
#
#   provisioner "local-exec" {
#     command = <<-EOT
#       echo "Autonomous Database created successfully!"
#       echo "Database OCID: ${local.database_id}"
#       echo "Connection String (HIGH): ${local.connection_string_high}"
#       echo ""
#       echo "To setup Vector Search schema, run:"
#       echo "sqlplus admin/${var.admin_password}@${var.db_name}_high @scripts/setup_vector_schema.sql"
#     EOT
#   }
#
#   triggers = {
#     always_run = timestamp()
#   }
# }
