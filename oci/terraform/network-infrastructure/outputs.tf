# ==============================================================================
# Oracle OCI Multicloud Portfolio - Network Infrastructure Outputs
# ==============================================================================
# Purpose: Export network infrastructure IDs and information for use by
#          other modules (autonomous-db-23ai)
#
# Author: Juliano Stefano
# LinkedIn: https://www.linkedin.com/in/julianostefano/
# Repository: https://github.com/julianostefano/saddling-up-the-tejo
#
# ==============================================================================

# ==============================================================================
# VCN and Network Outputs
# ==============================================================================

output "vcn_id" {
  description = "OCID of the Virtual Cloud Network"
  value       = oci_core_vcn.main_vcn.id
}

output "vcn_cidr_block" {
  description = "CIDR block of the VCN"
  value       = var.vcn_cidr_block
}

output "vcn_display_name" {
  description = "Display name of the VCN"
  value       = oci_core_vcn.main_vcn.display_name
}

# ==============================================================================
# Subnet Outputs
# ==============================================================================

output "public_subnet_id" {
  description = "OCID of the public subnet"
  value       = oci_core_subnet.public_subnet.id
}

output "public_subnet_cidr" {
  description = "CIDR block of the public subnet"
  value       = var.public_subnet_cidr
}

output "private_subnet_id" {
  description = "OCID of the private subnet"
  value       = oci_core_subnet.private_subnet.id
}

output "private_subnet_cidr" {
  description = "CIDR block of the private subnet"
  value       = var.private_subnet_cidr
}

# ==============================================================================
# Gateway Outputs
# ==============================================================================

output "internet_gateway_id" {
  description = "OCID of the Internet Gateway"
  value       = oci_core_internet_gateway.internet_gateway.id
}

# NAT Gateway output commented out - not available in Always Free tier
# output "nat_gateway_id" {
#   description = "OCID of the NAT Gateway"
#   value       = oci_core_nat_gateway.nat_gateway.id
# }

# Service Gateway output commented out - not available in Always Free tier
# output "service_gateway_id" {
#   description = "OCID of the Service Gateway"
#   value       = oci_core_service_gateway.service_gateway.id
# }

# ==============================================================================
# Security Outputs
# ==============================================================================

output "compute_nsg_id" {
  description = "OCID of the Compute Network Security Group"
  value       = oci_core_network_security_group.compute_nsg.id
}

output "adb_nsg_id" {
  description = "OCID of the Autonomous Database Network Security Group"
  value       = oci_core_network_security_group.adb_nsg.id
}

output "public_security_list_id" {
  description = "OCID of the public subnet security list"
  value       = oci_core_security_list.public_security_list.id
}

output "private_security_list_id" {
  description = "OCID of the private subnet security list"
  value       = oci_core_security_list.private_security_list.id
}

# ==============================================================================
# DHCP Options Output
# ==============================================================================

output "dhcp_options_id" {
  description = "OCID of the DHCP Options"
  value       = oci_core_dhcp_options.dhcp_options.id
}

# ==============================================================================
# Summary Output for Next Module
# ==============================================================================

output "network_summary" {
  description = "Summary of network infrastructure for use in autonomous-db-23ai module"
  value = {
    vcn_id            = oci_core_vcn.main_vcn.id
    vcn_cidr          = var.vcn_cidr_block
    public_subnet_id  = oci_core_subnet.public_subnet.id
    private_subnet_id = oci_core_subnet.private_subnet.id
    compute_nsg_id    = oci_core_network_security_group.compute_nsg.id
    adb_nsg_id        = oci_core_network_security_group.adb_nsg.id
  }
}

# ==============================================================================
# Next Steps Output
# ==============================================================================

output "next_steps" {
  description = "Next steps after network deployment"
  value       = <<-EOT
    Network infrastructure deployed successfully!

    === Network Details ===
    VCN OCID: ${oci_core_vcn.main_vcn.id}
    VCN CIDR: ${var.vcn_cidr_block}

    Public Subnet OCID: ${oci_core_subnet.public_subnet.id}
    Public Subnet CIDR: ${var.public_subnet_cidr}

    Private Subnet OCID: ${oci_core_subnet.private_subnet.id}
    Private Subnet CIDR: ${var.private_subnet_cidr}

    Compute NSG OCID: ${oci_core_network_security_group.compute_nsg.id}
    Database NSG OCID: ${oci_core_network_security_group.adb_nsg.id}

    === Next Steps ===
    1. Copy the network OCIDs above
    2. Navigate to autonomous-db-23ai module:
       cd ../autonomous-db-23ai

    3. Edit terraform.tfvars with these values:
       vcn_id            = "${oci_core_vcn.main_vcn.id}"
       public_subnet_id  = "${oci_core_subnet.public_subnet.id}"
       private_subnet_id = "${oci_core_subnet.private_subnet.id}"
       compute_nsg_id    = "${oci_core_network_security_group.compute_nsg.id}"
       adb_nsg_id        = "${oci_core_network_security_group.adb_nsg.id}"

    4. Deploy database and compute:
       terraform init
       terraform apply

    === Documentation ===
    - See README.md for detailed usage instructions
  EOT
}
