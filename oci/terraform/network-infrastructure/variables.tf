# ==============================================================================
# Oracle OCI Multicloud Portfolio - Network Infrastructure Variables
# ==============================================================================
# Purpose: Define variables for VCN, Subnets, Gateways, and Security
#
# Author: Juliano Stefano
# LinkedIn: https://www.linkedin.com/in/julianostefano/
# Repository: https://github.com/julianostefano/saddling-up-the-tejo
#
# ==============================================================================

# ==============================================================================
# Required Variables
# ==============================================================================

variable "compartment_id" {
  description = <<-EOT
    OCID of the compartment where network resources will be created.

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

# ==============================================================================
# VCN Configuration Variables
# ==============================================================================

variable "vcn_cidr_block" {
  description = <<-EOT
    CIDR block for the Virtual Cloud Network (VCN).

    Default: 10.0.0.0/16 (65,536 IP addresses)

    Common options:
    - 10.0.0.0/16  (65,536 IPs)
    - 172.16.0.0/16 (65,536 IPs)
    - 192.168.0.0/16 (65,536 IPs)
  EOT
  type        = string
  default     = "10.0.0.0/16"

  validation {
    condition     = can(cidrhost(var.vcn_cidr_block, 0))
    error_message = "VCN CIDR block must be valid CIDR notation."
  }
}

variable "vcn_display_name" {
  description = "Display name for the VCN"
  type        = string
  default     = "ai-lakehouse-vcn"
}

variable "public_subnet_cidr" {
  description = "CIDR block for public subnet (for compute instances with internet access)"
  type        = string
  default     = "10.0.1.0/24"

  validation {
    condition     = can(cidrhost(var.public_subnet_cidr, 0))
    error_message = "Public subnet CIDR must be valid CIDR notation."
  }
}

variable "private_subnet_cidr" {
  description = "CIDR block for private subnet (for Autonomous Database)"
  type        = string
  default     = "10.0.2.0/24"

  validation {
    condition     = can(cidrhost(var.private_subnet_cidr, 0))
    error_message = "Private subnet CIDR must be valid CIDR notation."
  }
}

# ==============================================================================
# Tags and Metadata Variables
# ==============================================================================

variable "freeform_tags" {
  description = "Free-form tags for resource organization and tracking"
  type        = map(string)
  default = {
    "Project"     = "OCI-Multicloud-Portfolio"
    "Author"      = "Juliano Stefano"
    "Environment" = "Development"
    "Purpose"     = "Network-Infrastructure"
  }
}

variable "defined_tags" {
  description = "Defined tags for resource organization (requires tag namespace setup)"
  type        = map(string)
  default     = {}
}
