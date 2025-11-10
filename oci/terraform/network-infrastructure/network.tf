# ==============================================================================
# Oracle OCI Multicloud Portfolio - Network Infrastructure
# ==============================================================================
# Purpose: Create VCN, Subnets, Internet Gateway, and Route Tables for
#          Autonomous Database and Compute instances (Always Free tier).
#
# Author: Juliano Stefano
# LinkedIn: https://www.linkedin.com/in/julianostefano/
# Repository: https://github.com/julianostefano/saddling-up-the-tejo
#
# ==============================================================================

# ==============================================================================
# Data Sources
# ==============================================================================

# Get list of availability domains
data "oci_identity_availability_domains" "ads" {
  compartment_id = var.compartment_id
}

# Service Gateway data source commented out - not available in Always Free tier
# data "oci_core_services" "all_services" {
#   filter {
#     name   = "name"
#     values = ["All .* Services In Oracle Services Network"]
#     regex  = true
#   }
# }

# ==============================================================================
# Virtual Cloud Network (VCN)
# ==============================================================================

resource "oci_core_vcn" "main_vcn" {
  compartment_id = var.compartment_id
  cidr_blocks    = [var.vcn_cidr_block]
  display_name   = var.vcn_display_name
  dns_label      = "ailakehouse"

  freeform_tags = merge(
    var.freeform_tags,
    {
      "Name" = var.vcn_display_name
    }
  )

  defined_tags = var.defined_tags
}

# ==============================================================================
# DHCP Options (for DNS resolution)
# ==============================================================================

resource "oci_core_dhcp_options" "dhcp_options" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.main_vcn.id
  display_name   = "${var.vcn_display_name}-dhcp-options"

  # DNS resolution using VCN's internal DNS
  options {
    type        = "DomainNameServer"
    server_type = "VcnLocalPlusInternet"
  }

  # Search domain
  options {
    type                = "SearchDomain"
    search_domain_names = ["ailakehouse.oraclevcn.com"]
  }

  freeform_tags = merge(
    var.freeform_tags,
    {
      "Name" = "${var.vcn_display_name}-dhcp-options"
    }
  )
}

# ==============================================================================
# Internet Gateway (for public subnet)
# ==============================================================================

resource "oci_core_internet_gateway" "internet_gateway" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.main_vcn.id
  display_name   = "${var.vcn_display_name}-igw"
  enabled        = true

  freeform_tags = merge(
    var.freeform_tags,
    {
      "Name" = "${var.vcn_display_name}-igw"
    }
  )
}

# ==============================================================================
# NAT Gateway (for private subnet outbound internet access)
# ==============================================================================
# NOTE: NAT Gateway is NOT available in Always Free tier (limit = 0)
# Commented out to comply with Always Free tier restrictions

# resource "oci_core_nat_gateway" "nat_gateway" {
#   compartment_id = var.compartment_id
#   vcn_id         = oci_core_vcn.main_vcn.id
#   display_name   = "${var.vcn_display_name}-nat-gw"
#   block_traffic  = false
#
#   freeform_tags = merge(
#     var.freeform_tags,
#     {
#       "Name" = "${var.vcn_display_name}-nat-gw"
#     }
#   )
# }

# ==============================================================================
# Service Gateway (for private subnet access to OCI services)
# ==============================================================================
# NOTE: Service Gateway is NOT available in Always Free tier (limit = 0)
# Commented out to comply with Always Free tier restrictions

# resource "oci_core_service_gateway" "service_gateway" {
#   compartment_id = var.compartment_id
#   vcn_id         = oci_core_vcn.main_vcn.id
#   display_name   = "${var.vcn_display_name}-service-gw"
#
#   services {
#     service_id = data.oci_core_services.all_services.services[0].id
#   }
#
#   freeform_tags = merge(
#     var.freeform_tags,
#     {
#       "Name" = "${var.vcn_display_name}-service-gw"
#     }
#   )
# }

# ==============================================================================
# Route Table for Public Subnet
# ==============================================================================

resource "oci_core_route_table" "public_route_table" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.main_vcn.id
  display_name   = "${var.vcn_display_name}-public-rt"

  route_rules {
    description       = "Route to Internet Gateway"
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.internet_gateway.id
  }

  freeform_tags = merge(
    var.freeform_tags,
    {
      "Name" = "${var.vcn_display_name}-public-rt"
    }
  )
}

# ==============================================================================
# Route Table for Private Subnet
# ==============================================================================

resource "oci_core_route_table" "private_route_table" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.main_vcn.id
  display_name   = "${var.vcn_display_name}-private-rt"

  # NAT Gateway route commented out - not available in Always Free tier
  # route_rules {
  #   description       = "Route to NAT Gateway for outbound internet"
  #   destination       = "0.0.0.0/0"
  #   destination_type  = "CIDR_BLOCK"
  #   network_entity_id = oci_core_nat_gateway.nat_gateway.id
  # }

  # Service Gateway route commented out - not available in Always Free tier
  # route_rules {
  #   description       = "Route to Service Gateway for OCI services"
  #   destination       = data.oci_core_services.all_services.services[0].cidr_block
  #   destination_type  = "SERVICE_CIDR_BLOCK"
  #   network_entity_id = oci_core_service_gateway.service_gateway.id
  # }

  freeform_tags = merge(
    var.freeform_tags,
    {
      "Name" = "${var.vcn_display_name}-private-rt"
    }
  )
}

# ==============================================================================
# Public Subnet (for compute instances with internet access)
# ==============================================================================

resource "oci_core_subnet" "public_subnet" {
  compartment_id             = var.compartment_id
  vcn_id                     = oci_core_vcn.main_vcn.id
  cidr_block                 = var.public_subnet_cidr
  display_name               = "${var.vcn_display_name}-public-subnet"
  dns_label                  = "public"
  prohibit_public_ip_on_vnic = false
  route_table_id             = oci_core_route_table.public_route_table.id
  security_list_ids          = [oci_core_security_list.public_security_list.id]
  dhcp_options_id            = oci_core_dhcp_options.dhcp_options.id

  freeform_tags = merge(
    var.freeform_tags,
    {
      "Name" = "${var.vcn_display_name}-public-subnet"
      "Type" = "Public"
    }
  )
}

# ==============================================================================
# Private Subnet (for Autonomous Database)
# ==============================================================================

resource "oci_core_subnet" "private_subnet" {
  compartment_id             = var.compartment_id
  vcn_id                     = oci_core_vcn.main_vcn.id
  cidr_block                 = var.private_subnet_cidr
  display_name               = "${var.vcn_display_name}-private-subnet"
  dns_label                  = "private"
  prohibit_public_ip_on_vnic = true
  route_table_id             = oci_core_route_table.private_route_table.id
  security_list_ids          = [oci_core_security_list.private_security_list.id]
  dhcp_options_id            = oci_core_dhcp_options.dhcp_options.id

  freeform_tags = merge(
    var.freeform_tags,
    {
      "Name" = "${var.vcn_display_name}-private-subnet"
      "Type" = "Private"
    }
  )
}
