# ==============================================================================
# Oracle OCI Multicloud Portfolio - Data Sources
# ==============================================================================
# Purpose: Fetch existing network infrastructure created by network-infrastructure
#          module for use with Autonomous Database and Compute instances.
#
# Author: Juliano Stefano
# LinkedIn: https://www.linkedin.com/in/julianostefano/
# Repository: https://github.com/julianostefano/saddling-up-the-tejo
#
# ==============================================================================

# ==============================================================================
# Identity Data Sources
# ==============================================================================

# Get list of availability domains
data "oci_identity_availability_domains" "ads" {
  compartment_id = var.compartment_id
}

# ==============================================================================
# Network Data Sources
# ==============================================================================

# Fetch VCN by OCID
data "oci_core_vcn" "vcn" {
  vcn_id = var.vcn_id
}

# Fetch public subnet by OCID
data "oci_core_subnet" "public_subnet" {
  subnet_id = var.public_subnet_id
}

# Fetch private subnet by OCID (optional - not used by public database)
data "oci_core_subnet" "private_subnet" {
  count     = var.private_subnet_id != "" ? 1 : 0
  subnet_id = var.private_subnet_id
}

# Fetch compute NSG by OCID
data "oci_core_network_security_group" "compute_nsg" {
  network_security_group_id = var.compute_nsg_id
}

# Fetch database NSG by OCID (optional - not used by public database)
# Database is PUBLIC and accessible from anywhere without NSG restrictions
data "oci_core_network_security_group" "adb_nsg" {
  count                     = var.adb_nsg_id != "" ? 1 : 0
  network_security_group_id = var.adb_nsg_id
}
