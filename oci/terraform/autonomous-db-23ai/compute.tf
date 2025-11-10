# ==============================================================================
# Oracle OCI Multicloud Portfolio - Compute Instance (Application Server)
# ==============================================================================
# Purpose: Deploy Always Free VM instance as application server for running
#          Bun applications and accessing Autonomous Database.
#
# Author: Juliano Stefano
# LinkedIn: https://www.linkedin.com/in/julianostefano/
# Repository: https://github.com/julianostefano/saddling-up-the-tejo
#
# ==============================================================================

# ==============================================================================
# Data Sources for Compute
# ==============================================================================

# Get latest Oracle Linux 8 image
data "oci_core_images" "oracle_linux_8" {
  compartment_id           = var.compartment_id
  operating_system         = "Oracle Linux"
  operating_system_version = "8"
  shape                    = var.compute_shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"

  filter {
    name   = "display_name"
    values = ["^.*Oracle-Linux-8.*-\\d{4}\\.\\d{2}\\.\\d{2}-\\d+$"]
    regex  = true
  }
}

# ==============================================================================
# Compute Instance (Application Server)
# ==============================================================================

resource "oci_core_instance" "app_server" {
  compartment_id      = var.compartment_id
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  display_name        = var.compute_display_name
  shape               = var.compute_shape

  # Use latest Oracle Linux 8 image or custom image
  source_details {
    source_id   = var.compute_image_id != "" ? var.compute_image_id : data.oci_core_images.oracle_linux_8.images[0].id
    source_type = "image"
  }

  # Create in public subnet with public IP
  create_vnic_details {
    subnet_id        = data.oci_core_subnet.public_subnet.id
    display_name     = "${var.compute_display_name}-vnic"
    assign_public_ip = true
    nsg_ids          = [data.oci_core_network_security_group.compute_nsg.id]
    hostname_label   = "app-server"
  }

  # SSH public key for access
  metadata = {
    ssh_authorized_keys = var.ssh_public_key
    user_data = base64encode(templatefile("${path.module}/cloud-init.yaml", {
      db_name = var.db_name
    }))
  }

  # Preserve boot volume on instance termination
  preserve_boot_volume = false

  freeform_tags = merge(
    var.freeform_tags,
    {
      "Name" = var.compute_display_name
      "Role" = "Application-Server"
    }
  )

  defined_tags = var.defined_tags

  timeouts {
    create = "15m"
  }
}
