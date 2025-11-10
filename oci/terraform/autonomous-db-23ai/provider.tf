# ==============================================================================
# Oracle OCI Multicloud Portfolio - Terraform Provider Configuration
# ==============================================================================
# Purpose: Configure Oracle Cloud Infrastructure (OCI) provider for
#          Autonomous Database 23ai deployment with AI/ML capabilities.
#
# Example Usage:
#   terraform init
#   terraform providers
#
# Author: Juliano Stefano
# LinkedIn: https://www.linkedin.com/in/julianostefano/
# Repository: https://github.com/julianostefano/saddling-up-the-tejo
#
# Standards Compliance:
#   - Terraform >= 1.5.0
#   - OCI Provider ~> 5.0
#   - OCI Resource Manager compatible
#
# ==============================================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 5.0"
    }
  }

  # Backend configuration for state management
  # Use local backend for development
  # For production, consider using OCI Object Storage backend
  backend "local" {
    path = "terraform.tfstate"
  }
}

# OCI Provider Configuration
# Authentication can be done via:
# 1. OCI CLI config file (~/.oci/config) - Recommended for local development
# 2. Instance Principal - For running on OCI Compute
# 3. Environment variables - For CI/CD pipelines
provider "oci" {
  # If not specified, reads from ~/.oci/config DEFAULT profile
  # You can override with:
  # region           = var.region
  # tenancy_ocid     = var.tenancy_ocid
  # user_ocid        = var.user_ocid
  # fingerprint      = var.fingerprint
  # private_key_path = var.private_key_path
}
