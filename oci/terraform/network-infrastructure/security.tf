# ==============================================================================
# Oracle OCI Multicloud Portfolio - Security Configuration
# ==============================================================================
# Purpose: Define Security Lists and Network Security Groups (NSGs) for
#          public and private subnets with proper ingress/egress rules.
#
# Author: Juliano Stefano
# LinkedIn: https://www.linkedin.com/in/julianostefano/
# Repository: https://github.com/julianostefano/saddling-up-the-tejo
#
# ==============================================================================

# ==============================================================================
# Security List for Public Subnet
# ==============================================================================

resource "oci_core_security_list" "public_security_list" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.main_vcn.id
  display_name   = "${var.vcn_display_name}-public-sl"

  # Ingress Rules for Public Subnet
  # ---------------------------------

  # Allow SSH from anywhere (port 22)
  ingress_security_rules {
    description = "Allow SSH from internet"
    protocol    = "6" # TCP
    source      = "0.0.0.0/0"
    source_type = "CIDR_BLOCK"
    stateless   = false

    tcp_options {
      min = 22
      max = 22
    }
  }

  # Allow SSH from VCN (private subnet, cloud console)
  ingress_security_rules {
    description = "Allow SSH from VCN (internal access)"
    protocol    = "6" # TCP
    source      = var.vcn_cidr_block
    source_type = "CIDR_BLOCK"
    stateless   = false

    tcp_options {
      min = 22
      max = 22
    }
  }

  # Allow HTTP from anywhere (port 80)
  ingress_security_rules {
    description = "Allow HTTP from anywhere"
    protocol    = "6" # TCP
    source      = "0.0.0.0/0"
    source_type = "CIDR_BLOCK"
    stateless   = false

    tcp_options {
      min = 80
      max = 80
    }
  }

  # Allow HTTPS from anywhere (port 443)
  ingress_security_rules {
    description = "Allow HTTPS from anywhere"
    protocol    = "6" # TCP
    source      = "0.0.0.0/0"
    source_type = "CIDR_BLOCK"
    stateless   = false

    tcp_options {
      min = 443
      max = 443
    }
  }

  # Allow ICMP Type 3 Code 4 (fragmentation needed)
  ingress_security_rules {
    description = "Allow ICMP Type 3 Code 4 for Path MTU Discovery"
    protocol    = "1" # ICMP
    source      = "0.0.0.0/0"
    source_type = "CIDR_BLOCK"
    stateless   = false

    icmp_options {
      type = 3
      code = 4
    }
  }

  # Allow ICMP Type 3 (destination unreachable) from VCN
  ingress_security_rules {
    description = "Allow ICMP Type 3 from VCN"
    protocol    = "1" # ICMP
    source      = var.vcn_cidr_block
    source_type = "CIDR_BLOCK"
    stateless   = false

    icmp_options {
      type = 3
    }
  }

  # Egress Rules for Public Subnet
  # -------------------------------

  # Allow all egress traffic
  egress_security_rules {
    description      = "Allow all outbound traffic"
    protocol         = "all"
    destination      = "0.0.0.0/0"
    destination_type = "CIDR_BLOCK"
    stateless        = false
  }

  freeform_tags = merge(
    var.freeform_tags,
    {
      "Name" = "${var.vcn_display_name}-public-sl"
    }
  )
}

# ==============================================================================
# Security List for Private Subnet
# ==============================================================================

resource "oci_core_security_list" "private_security_list" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.main_vcn.id
  display_name   = "${var.vcn_display_name}-private-sl"

  # Ingress Rules for Private Subnet
  # ---------------------------------

  # Allow Oracle Net Listener (1521) from VCN
  ingress_security_rules {
    description = "Allow Oracle Net Listener from VCN"
    protocol    = "6" # TCP
    source      = var.vcn_cidr_block
    source_type = "CIDR_BLOCK"
    stateless   = false

    tcp_options {
      min = 1521
      max = 1522
    }
  }

  # Allow HTTPS (443) from VCN for Autonomous Database APEX/ORDS
  ingress_security_rules {
    description = "Allow HTTPS from VCN for APEX/ORDS"
    protocol    = "6" # TCP
    source      = var.vcn_cidr_block
    source_type = "CIDR_BLOCK"
    stateless   = false

    tcp_options {
      min = 443
      max = 443
    }
  }

  # Allow all traffic within VCN
  ingress_security_rules {
    description = "Allow all traffic from VCN"
    protocol    = "all"
    source      = var.vcn_cidr_block
    source_type = "CIDR_BLOCK"
    stateless   = false
  }

  # Allow ICMP Type 3 Code 4 (fragmentation needed)
  ingress_security_rules {
    description = "Allow ICMP Type 3 Code 4 for Path MTU Discovery"
    protocol    = "1" # ICMP
    source      = "0.0.0.0/0"
    source_type = "CIDR_BLOCK"
    stateless   = false

    icmp_options {
      type = 3
      code = 4
    }
  }

  # Egress Rules for Private Subnet
  # --------------------------------

  # Allow SSH to public subnet (for bastion access from private subnet)
  egress_security_rules {
    description      = "Allow SSH to public subnet for bastion access"
    protocol         = "6" # TCP
    destination      = var.public_subnet_cidr
    destination_type = "CIDR_BLOCK"
    stateless        = false

    tcp_options {
      min = 22
      max = 22
    }
  }

  # Allow all egress traffic
  egress_security_rules {
    description      = "Allow all outbound traffic"
    protocol         = "all"
    destination      = "0.0.0.0/0"
    destination_type = "CIDR_BLOCK"
    stateless        = false
  }

  freeform_tags = merge(
    var.freeform_tags,
    {
      "Name" = "${var.vcn_display_name}-private-sl"
    }
  )
}

# ==============================================================================
# Network Security Group for Autonomous Database
# ==============================================================================

resource "oci_core_network_security_group" "adb_nsg" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.main_vcn.id
  display_name   = "${var.vcn_display_name}-adb-nsg"

  freeform_tags = merge(
    var.freeform_tags,
    {
      "Name"    = "${var.vcn_display_name}-adb-nsg"
      "Purpose" = "Autonomous-Database"
    }
  )
}

# NSG Rule: Allow Oracle Net Listener from VCN
resource "oci_core_network_security_group_security_rule" "adb_nsg_ingress_1521" {
  network_security_group_id = oci_core_network_security_group.adb_nsg.id
  direction                 = "INGRESS"
  protocol                  = "6" # TCP
  source                    = var.vcn_cidr_block
  source_type               = "CIDR_BLOCK"
  description               = "Allow Oracle Net Listener from VCN"
  stateless                 = false

  tcp_options {
    destination_port_range {
      min = 1521
      max = 1522
    }
  }
}

# NSG Rule: Allow HTTPS for APEX/ORDS from VCN
resource "oci_core_network_security_group_security_rule" "adb_nsg_ingress_https" {
  network_security_group_id = oci_core_network_security_group.adb_nsg.id
  direction                 = "INGRESS"
  protocol                  = "6" # TCP
  source                    = var.vcn_cidr_block
  source_type               = "CIDR_BLOCK"
  description               = "Allow HTTPS for APEX/ORDS from VCN"
  stateless                 = false

  tcp_options {
    destination_port_range {
      min = 443
      max = 443
    }
  }
}

# NSG Rule: Allow all egress traffic
resource "oci_core_network_security_group_security_rule" "adb_nsg_egress_all" {
  network_security_group_id = oci_core_network_security_group.adb_nsg.id
  direction                 = "EGRESS"
  protocol                  = "all"
  destination               = "0.0.0.0/0"
  destination_type          = "CIDR_BLOCK"
  description               = "Allow all outbound traffic"
  stateless                 = false
}

# ==============================================================================
# Network Security Group for Compute Instance
# ==============================================================================

resource "oci_core_network_security_group" "compute_nsg" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.main_vcn.id
  display_name   = "${var.vcn_display_name}-compute-nsg"

  freeform_tags = merge(
    var.freeform_tags,
    {
      "Name"    = "${var.vcn_display_name}-compute-nsg"
      "Purpose" = "Compute-Instance"
    }
  )
}

# NSG Rule: Allow SSH from anywhere (internet)
resource "oci_core_network_security_group_security_rule" "compute_nsg_ingress_ssh_internet" {
  network_security_group_id = oci_core_network_security_group.compute_nsg.id
  direction                 = "INGRESS"
  protocol                  = "6" # TCP
  source                    = "0.0.0.0/0"
  source_type               = "CIDR_BLOCK"
  description               = "Allow SSH from anywhere (internet)"
  stateless                 = false

  tcp_options {
    destination_port_range {
      min = 22
      max = 22
    }
  }
}

# NSG Rule: Allow SSH from VCN (private subnet, cloud console, other hosts)
resource "oci_core_network_security_group_security_rule" "compute_nsg_ingress_ssh_vcn" {
  network_security_group_id = oci_core_network_security_group.compute_nsg.id
  direction                 = "INGRESS"
  protocol                  = "6" # TCP
  source                    = var.vcn_cidr_block
  source_type               = "CIDR_BLOCK"
  description               = "Allow SSH from VCN (private subnet, cloud console, other hosts)"
  stateless                 = false

  tcp_options {
    destination_port_range {
      min = 22
      max = 22
    }
  }
}

# NSG Rule: Allow SSH specifically from private subnet
resource "oci_core_network_security_group_security_rule" "compute_nsg_ingress_ssh_private" {
  network_security_group_id = oci_core_network_security_group.compute_nsg.id
  direction                 = "INGRESS"
  protocol                  = "6" # TCP
  source                    = var.private_subnet_cidr
  source_type               = "CIDR_BLOCK"
  description               = "Allow SSH from private subnet (database instances, apps)"
  stateless                 = false

  tcp_options {
    destination_port_range {
      min = 22
      max = 22
    }
  }
}

# NSG Rule: Allow all egress traffic
resource "oci_core_network_security_group_security_rule" "compute_nsg_egress_all" {
  network_security_group_id = oci_core_network_security_group.compute_nsg.id
  direction                 = "EGRESS"
  protocol                  = "all"
  destination               = "0.0.0.0/0"
  destination_type          = "CIDR_BLOCK"
  description               = "Allow all outbound traffic"
  stateless                 = false
}
