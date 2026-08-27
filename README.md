# Saddling Up the Tejo

**Multicloud Database & Data Engineering Portfolio** — Enterprise-grade examples demonstrating advanced Oracle Database, OCI, Snowflake, and Modern Cloud Analytics expertise.

**Author:** Juliano Stefano  
**LinkedIn:** [linkedin.com/in/julianostefano](https://www.linkedin.com/in/julianostefano/)  
**Repository:** [github.com/julianostefano/saddling-up-the-tejo](https://github.com/julianostefano/saddling-up-the-tejo)

---

## Overview

This portfolio showcases end-to-end capabilities across **Cloud Database Architecture**, **Infrastructure as Code (IaC)**, and **Advanced Data Analytics**. Built to production standards, it bridges the gap between infrastructure automation (OCI, Terraform, Autonomous 23ai) and data analytics engineering (Snowflake, Advanced SQL, Python Data Visualization).

---

## Portfolio Modules

The repository is organized into distinct, modular pillars:

### 1. Data Analytics & SQL Engineering Notebooks (Active)
**Location:** [`notebooks/`](./notebooks/)

Interactive analytical notebooks demonstrating modern cloud data warehousing, complex SQL transformations (CTEs, window functions), and production-quality data visualization:

- **Exploring London's Travel Network (Snowflake + Plotly):**
  - **Platform:** Snowflake Cloud Data Platform & Jupyter/Notebook environment.
  - **SQL Engineering:** Advanced Common Table Expressions (CTEs), multi-level aggregation, data cleaning, and filtering on millions of transit records (`TFL.JOURNEYS`).
  - **Key Analysis:**
    - Network-wide transit mode popularity ranking.
    - Historical peak usage analysis for the Emirates Airline cable car (Top 5 months/years).
    - Longitudinal trend analysis identifying the lowest-volume years for the Underground & DLR.
  - **Visualizations:** Custom, interactive dark-theme horizontal bar charts built with **Plotly Express**, featuring dynamic label positioning, axis margin compensation, and custom color gradients.

*Explore the notebooks and queries in the [Notebooks Directory](./notebooks/).*

---

### 2. Infrastructure as Code (OCI & Terraform)
**Location:** [`oci/terraform/autonomous-db-23ai/`](./oci/terraform/autonomous-db-23ai/)  
**Status:** In Active Development

Production-ready Terraform configurations deploying Oracle Autonomous Database 23ai/26ai with AI Vector Search capabilities:

- **Database:** Autonomous Database 23ai/26ai configured for Lakehouse workloads.
- **AI/ML Ready:** Vector Search configuration for Retrieval-Augmented Generation (RAG).
- **Cost-Optimized:** Fully compatible with OCI Always Free tier resources.
- **Networking & Compute:** Application server VM with cloud-init, VCN, private/public subnets, and Network Security Groups (NSGs).
- **CI/CD & Management:** 100% compatible with OCI Resource Manager (deployable straight from GitHub).

**Quick Start:**
```bash
cd oci/terraform/autonomous-db-23ai
terraform init
terraform plan -var-file="terraform.tfvars"
terraform apply
