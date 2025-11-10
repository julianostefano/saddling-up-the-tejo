# ==============================================================================
# Oracle OCI Multicloud Portfolio - Terraform Variables
# ==============================================================================
# Purpose: Define variables for Autonomous Database 23ai deployment with
#          comprehensive validation and documentation.
#
# Example Usage:
#   terraform plan -var-file="dev.tfvars"
#   terraform apply -var="compartment_id=ocid1.compartment.oc1..."
#
# Author: Juliano Stefano
# LinkedIn: https://www.linkedin.com/in/julianostefano/
# Repository: https://github.com/julianostefano/saddling-up-the-tejo
#
# Standards Compliance:
#   - Comprehensive variable descriptions
#   - Input validation with regex
#   - Sensitive variable handling
#   - OCI Resource Manager compatible
#
# ==============================================================================

# ==============================================================================
# Required Variables
# ==============================================================================

variable "compartment_id" {
  description = <<-EOT
    OCID of the compartment where the Autonomous Database will be created.

    Example: ocid1.compartment.oc1..aaaaaaaxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

    How to find:
    - OCI Console: Identity & Security > Compartments
    - OCI CLI: oci iam compartment list --compartment-id-in-subtree true
  EOT
  type        = string

  validation {
    condition     = can(regex("^ocid1\\.compartment\\.oc1\\.", var.compartment_id))
    error_message = "Compartment ID must be a valid OCID starting with 'ocid1.compartment.oc1.'"
  }
}

variable "admin_password" {
  description = <<-EOT
    Password for the ADMIN user of the Autonomous Database.

    Requirements:
    - Between 12 and 30 characters
    - Must contain at least one uppercase letter
    - Must contain at least one lowercase letter
    - Must contain at least one number
    - Cannot contain the username "admin"
    - Cannot contain double quotes (")

    Example: SecureP@ssw0rd2025!
  EOT
  type        = string
  sensitive   = true

  validation {
    condition     = can(regex("^[A-Za-z0-9#_@!$%^&*()+=\\-]{12,30}$", var.admin_password))
    error_message = "Admin password must be between 12 and 30 characters and contain only allowed characters."
  }

  validation {
    condition     = can(regex("[A-Z]", var.admin_password))
    error_message = "Admin password must contain at least one uppercase letter."
  }

  validation {
    condition     = can(regex("[a-z]", var.admin_password))
    error_message = "Admin password must contain at least one lowercase letter."
  }

  validation {
    condition     = can(regex("[0-9]", var.admin_password))
    error_message = "Admin password must contain at least one number."
  }

  validation {
    condition     = !can(regex("(?i)admin", var.admin_password))
    error_message = "Admin password cannot contain the word 'admin'."
  }
}

# ==============================================================================
# Database Configuration Variables
# ==============================================================================

variable "db_name" {
  description = <<-EOT
    Database name for the Autonomous Database instance.

    Requirements:
    - Maximum 14 characters
    - Letters and numbers only
    - Must start with a letter
    - No special characters

    Example: AILAKE01
  EOT
  type        = string
  default     = "AILAKE01"

  validation {
    condition     = can(regex("^[A-Za-z][A-Za-z0-9]{0,13}$", var.db_name))
    error_message = "Database name must start with a letter, contain only letters and numbers, and be max 14 characters."
  }
}

variable "display_name" {
  description = <<-EOT
    Display name for the Autonomous Database instance.

    This is the human-readable name shown in the OCI Console.

    Example: AI Data Lakehouse 23ai
  EOT
  type        = string
  default     = "AI Data Lakehouse 23ai"
}

variable "db_version" {
  description = <<-EOT
    Oracle Database version for the Autonomous Database.

    Available versions:
    - 19c: Long-term support release
    - 21c: Innovation release
    - 23ai: AI/ML capabilities with Vector Search
    - 26ai: Latest with enhanced AI/ML and Lakehouse workload (recommended for RAG)

    For RAG workloads with Vector Search, use 23ai or 26ai.
  EOT
  type        = string
  default     = "23ai"

  validation {
    condition     = contains(["19c", "21c", "23ai", "26ai"], var.db_version)
    error_message = "Database version must be one of: 19c, 21c, 23ai, 26ai"
  }
}

variable "db_workload" {
  description = <<-EOT
    Workload type for the Autonomous Database.

    Options:
    - OLTP: Online Transaction Processing (transactional workloads)
    - DW: Data Warehouse (analytics and reporting)
    - AJD: Autonomous JSON Database
    - APEX: Application Express development
    - LH: Lakehouse (AI/ML and Vector Search - available in 26ai)

    For RAG with Vector Search:
    - 23ai or earlier: use DW
    - 26ai: use LH (recommended) or DW
  EOT
  type        = string
  default     = "DW"

  validation {
    condition     = contains(["OLTP", "DW", "AJD", "APEX", "LH"], var.db_workload)
    error_message = "Workload type must be one of: OLTP, DW, AJD, APEX, LH"
  }
}

variable "is_free_tier" {
  description = <<-EOT
    Enable Always Free tier for the Autonomous Database.

    Always Free specifications:
    - 1 OCPU
    - 1 TB storage
    - No auto-scaling
    - No backups

    Set to true for development/portfolio projects.
    Set to false for production workloads.
  EOT
  type        = bool
  default     = true
}

variable "cpu_core_count" {
  description = <<-EOT
    Number of OCPU cores for the Autonomous Database.

    Always Free: Must be 1
    Paid tier: Minimum 1, maximum depends on service limits

    Note: This is ignored if is_free_tier = true
  EOT
  type        = number
  default     = 1

  validation {
    condition     = var.cpu_core_count >= 1 && var.cpu_core_count <= 128
    error_message = "CPU core count must be between 1 and 128."
  }
}

variable "data_storage_size_in_tbs" {
  description = <<-EOT
    Storage size in terabytes for the Autonomous Database.

    Always Free: Must be 1 TB
    Paid tier: Minimum 1 TB, maximum 128 TB

    Note: This is ignored if is_free_tier = true
  EOT
  type        = number
  default     = 1

  validation {
    condition     = var.data_storage_size_in_tbs >= 1 && var.data_storage_size_in_tbs <= 128
    error_message = "Data storage size must be between 1 and 128 TB."
  }
}

variable "license_model" {
  description = <<-EOT
    License model for the Autonomous Database.

    Options:
    - LICENSE_INCLUDED: Oracle provides the database license (default)
    - BRING_YOUR_OWN_LICENSE: Use existing Oracle Database licenses

    Always Free tier requires LICENSE_INCLUDED.
  EOT
  type        = string
  default     = "LICENSE_INCLUDED"

  validation {
    condition     = contains(["LICENSE_INCLUDED", "BRING_YOUR_OWN_LICENSE"], var.license_model)
    error_message = "License model must be either LICENSE_INCLUDED or BRING_YOUR_OWN_LICENSE."
  }
}

# ==============================================================================
# Network and Security Variables
# ==============================================================================

variable "is_mtls_connection_required" {
  description = <<-EOT
    Require mutual TLS (mTLS) for database connections.

    true: Requires Oracle Wallet for connections (more secure)
    false: Allows SQL*Net connections without wallet

    For development/testing, set to false.
    For production, set to true.
  EOT
  type        = bool
  default     = false
}

variable "whitelisted_ips" {
  description = <<-EOT
    List of whitelisted IP addresses or CIDR blocks for database access.

    Example: ["203.0.113.0/24", "198.51.100.5/32"]

    Empty list means all IPs are allowed (not recommended for production).
  EOT
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for ip in var.whitelisted_ips : can(cidrhost(ip, 0))
    ])
    error_message = "All IP addresses must be valid CIDR notation (e.g., 192.168.1.0/24 or 10.0.0.1/32)."
  }
}

# ==============================================================================
# Tags and Metadata Variables
# ==============================================================================

variable "freeform_tags" {
  description = <<-EOT
    Free-form tags for resource organization and tracking.

    Example:
    {
      "Project"     = "OCI-Multicloud-Portfolio"
      "Author"      = "Juliano Stefano"
      "Environment" = "Development"
      "Purpose"     = "RAG-AI-Chatbot"
    }
  EOT
  type        = map(string)
  default = {
    "Project"     = "OCI-Multicloud-Portfolio"
    "Author"      = "Juliano Stefano"
    "Environment" = "Development"
    "Purpose"     = "RAG-AI-Chatbot"
  }
}

variable "defined_tags" {
  description = <<-EOT
    Defined tags for resource organization (requires tag namespace setup).

    Example:
    {
      "Operations.CostCenter" = "42"
      "Security.Compliance"   = "PCI-DSS"
    }
  EOT
  type        = map(string)
  default     = {}
}

# ==============================================================================
# Optional Features Variables
# ==============================================================================

variable "is_auto_scaling_enabled" {
  description = <<-EOT
    Enable automatic scaling of OCPU resources based on workload.

    true: Database scales up to 3x base OCPU count during high load
    false: Database runs at fixed OCPU count

    Note: Auto-scaling is NOT available on Always Free tier.
  EOT
  type        = bool
  default     = false
}

variable "is_data_guard_enabled" {
  description = <<-EOT
    Enable Autonomous Data Guard for high availability and disaster recovery.

    true: Creates a standby database in another availability domain
    false: Single instance only

    Note: Data Guard is NOT available on Always Free tier.
  EOT
  type        = bool
  default     = false
}

# ==============================================================================
# Network Variables (from network-infrastructure module)
# ==============================================================================

variable "vcn_id" {
  description = <<-EOT
    OCID of the existing Virtual Cloud Network (VCN).

    Obtain this from the network-infrastructure module output or OCI Console.

    Example: ocid1.vcn.oc1.sa-vinhedo-1.amaaaaaa...
  EOT
  type        = string

  validation {
    condition     = can(regex("^ocid1\\.vcn\\.oc1\\.", var.vcn_id))
    error_message = "VCN ID must be a valid OCID starting with 'ocid1.vcn.oc1.'"
  }
}

variable "public_subnet_id" {
  description = <<-EOT
    OCID of the public subnet for the application server VM.

    This subnet must have internet access via an Internet Gateway.

    Example: ocid1.subnet.oc1.sa-vinhedo-1.aaaaaaaaa...
  EOT
  type        = string

  validation {
    condition     = can(regex("^ocid1\\.subnet\\.oc1\\.", var.public_subnet_id))
    error_message = "Public subnet ID must be a valid OCID starting with 'ocid1.subnet.oc1.'"
  }
}

variable "private_subnet_id" {
  description = <<-EOT
    OCID of the private subnet (OPTIONAL - not used for public database).

    This is only needed if you plan to use private endpoint in the future.
    Currently the database is deployed as PUBLIC with no subnet/NSG restrictions.

    Example: ocid1.subnet.oc1.sa-vinhedo-1.aaaaaaaaa...
  EOT
  type        = string
  default     = ""

  validation {
    condition     = var.private_subnet_id == "" || can(regex("^ocid1\\.subnet\\.oc1\\.", var.private_subnet_id))
    error_message = "Private subnet ID must be empty or a valid OCID starting with 'ocid1.subnet.oc1.'"
  }
}

variable "compute_nsg_id" {
  description = <<-EOT
    OCID of the Network Security Group (NSG) for the compute instance.

    This NSG should allow SSH (port 22) inbound access.

    Example: ocid1.networksecuritygroup.oc1.sa-vinhedo-1.aaaaaaaaa...
  EOT
  type        = string

  validation {
    condition     = can(regex("^ocid1\\.networksecuritygroup\\.oc1\\.", var.compute_nsg_id))
    error_message = "Compute NSG ID must be a valid OCID starting with 'ocid1.networksecuritygroup.oc1.'"
  }
}

variable "adb_nsg_id" {
  description = <<-EOT
    OCID of the Network Security Group for Autonomous Database (OPTIONAL - not used).

    The database is configured as PUBLIC and accessible from anywhere.
    NSGs are NOT applied to the database for maximum accessibility.
    Access control is managed via:
    - mTLS requirement (wallet-based authentication)
    - whitelisted_ips (currently empty = allow all)

    Example: ocid1.networksecuritygroup.oc1.sa-vinhedo-1.aaaaaaaaa...
  EOT
  type        = string
  default     = ""

  validation {
    condition     = var.adb_nsg_id == "" || can(regex("^ocid1\\.networksecuritygroup\\.oc1\\.", var.adb_nsg_id))
    error_message = "ADB NSG ID must be empty or a valid OCID starting with 'ocid1.networksecuritygroup.oc1.'"
  }
}

# ==============================================================================
# Compute Instance Variables (Application Server)
# ==============================================================================

variable "ssh_public_key" {
  description = <<-EOT
    SSH public key for accessing the application server compute instance.

    Example: ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ...

    Generate with: ssh-keygen -t rsa -b 4096 -C "your_email@example.com"
  EOT
  type        = string

  validation {
    condition     = can(regex("^ssh-(rsa|ed25519|ecdsa)", var.ssh_public_key))
    error_message = "SSH public key must start with 'ssh-rsa', 'ssh-ed25519', or 'ssh-ecdsa'."
  }
}

variable "compute_shape" {
  description = <<-EOT
    Compute shape for the application server instance.

    Always Free shapes:
    - VM.Standard.E2.1.Micro (AMD, 1 OCPU, 1 GB RAM)
    - VM.Standard.A1.Flex (ARM Ampere, flexible OCPUs)

    For Always Free tier, use VM.Standard.E2.1.Micro
  EOT
  type        = string
  default     = "VM.Standard.E2.1.Micro"
}

variable "compute_display_name" {
  description = <<-EOT
    Display name for the application server compute instance.

    Example: autonomous-db-app-server
  EOT
  type        = string
  default     = "autonomous-db-app-server"
}

variable "compute_image_id" {
  description = <<-EOT
    OCID of the compute image to use for the application server.

    Leave empty to use the latest Oracle Linux 8 image (recommended).

    Example: ocid1.image.oc1.sa-vinhedo-1.aaaaaaaaa...
  EOT
  type        = string
  default     = ""
}
