# Saddling Up the Tejo

**Multicloud Database Portfolio** - Code examples demonstrating advanced Oracle Database, OCI, and multicloud expertise.

**Author:** Juliano Stefano
**LinkedIn:** [linkedin.com/in/julianostefano](https://www.linkedin.com/in/julianostefano/)
**Repository:** [github.com/julianostefano/saddling-up-the-tejo](https://github.com/julianostefano/saddling-up-the-tejo)

---

## Overview

This portfolio project showcases enterprise-grade Oracle Cloud Infrastructure (OCI) deployments, AI/ML database capabilities, and multicloud database solutions. Built with production-ready infrastructure as code, comprehensive documentation, and best practices for Principal DBA and Cloud Architect roles.

## Project Architecture

The project is structured in **4 phases**, each demonstrating distinct technical capabilities:

### Phase 1: Infrastructure as Code (Current)
**Status:** In Development
**Location:** [`oci/terraform/autonomous-db-23ai/`](./oci/terraform/autonomous-db-23ai/)

Deploy Oracle Autonomous Database 23ai/26ai with AI Vector Search capabilities using Terraform:

- Autonomous Database 23ai/26ai with Lakehouse workload
- AI/ML capabilities with Vector Search for RAG applications
- Always Free tier compatible
- Application server VM for Bun runtime
- VCN, Subnets, Network Security Groups
- OCI Resource Manager compatible (deploy from GitHub)
- Comprehensive documentation and examples

**Quick Start:**
```bash
cd oci/terraform/autonomous-db-23ai
terraform init
terraform plan -var-file="terraform.tfvars"
terraform apply
```

See the [full documentation](./oci/terraform/autonomous-db-23ai/README.md) for details.

### Phase 2: Python RAG Implementation (Planned)
**Status:** Planned
**Location:** `python/rag-chatbot/` (coming soon)

Python-based Retrieval-Augmented Generation (RAG) system:

- Document processor for PDF/Word/Text ingestion
- Vector embeddings with Sentence Transformers
- Oracle 23ai Vector Search integration
- Semantic search with cosine similarity
- FastAPI chatbot application
- End-to-end RAG pipeline

### Phase 3: Bun/Elysia Chatbot + MCP Agents (Planned)
**Status:** Planned
**Location:** `bun/chatbot/` (coming soon)

Modern TypeScript chatbot with Model Context Protocol integration:

- Elysia server with MVC pattern
- MCP agent orchestration for OCI services
- RAG integration service
- React/Tailwind frontend
- Comprehensive integration tests

### Phase 4: Multicloud Exadata Deployment (Planned)
**Status:** Planned
**Location:** `multicloud/exadata/` (coming soon)

Enterprise Exadata deployments across cloud providers:

- Exadata Cloud@Customer (OCI)
- Exadata Cloud@AWS, Azure, GCP
- Cross-cloud networking and security
- Multi-region disaster recovery
- Cost analysis and compliance documentation

---

## Repository Structure

```
saddling-up-the-tejo/
├── README.md                 # This file
├── LICENSE                   # MIT License
├── oci/
│   └── terraform/
│       └── autonomous-db-23ai/
│           ├── README.md
│           ├── QUICKSTART.md
│           ├── main.tf
│           ├── variables.tf
│           ├── outputs.tf
│           └── schema.yaml
│
├── python/                   # Phase 2 (coming soon)
├── bun/                      # Phase 3 (coming soon)
└── multicloud/               # Phase 4 (coming soon)
```

---

## Technology Stack

### Current (Phase 1)
- **IaC:** Terraform >= 1.5.0
- **Cloud:** Oracle Cloud Infrastructure (OCI)
- **Database:** Oracle Autonomous Database 23ai/26ai
- **Compute:** Oracle Linux 8 (Always Free tier)
- **AI/ML:** Oracle AI Vector Search

### Upcoming Phases
- **Python:** Python 3.11+ with uv package manager
- **TypeScript:** Bun runtime with Elysia framework
- **Frontend:** React with Tailwind CSS
- **Testing:** pytest, Bun test runner
- **Documentation:** Markdown with MkDocs

---

## Getting Started

### Prerequisites

- OCI account (Always Free tier sufficient)
- Terraform >= 1.5.0
- OCI CLI configured (optional)
- SSH key pair

### Quick Deployment

1. **Clone the repository:**
   ```bash
   git clone https://github.com/julianostefano/saddling-up-the-tejo.git
   cd saddling-up-the-tejo
   ```

2. **Navigate to Phase 1:**
   ```bash
   cd oci/terraform/autonomous-db-23ai
   ```

3. **Configure variables:**
   ```bash
   cp terraform.tfvars.example terraform.tfvars
   # Edit terraform.tfvars with your OCI details
   ```

4. **Deploy:**
   ```bash
   terraform init
   terraform apply
   ```

For detailed instructions, see the [Phase 1 README](./oci/terraform/autonomous-db-23ai/README.md).

---

## Features

- Production-ready Terraform modules
- Comprehensive variable validation
- Always Free tier compatible
- OCI Resource Manager support (deploy from GitHub)
- Bilingual documentation (English/Portuguese)
- Enterprise security best practices
- Automated wallet download scripts
- Cloud-init VM configuration
- Comprehensive testing examples

---

## Documentation

Each phase includes comprehensive documentation:

- **README.md** - Overview, installation, usage
- **QUICKSTART.md** - Fast deployment guide
- **ARCHITECTURE.md** - System design and data flow (coming soon)
- **API.md** - API endpoints and examples (for application phases)

---

## Standards and Guidelines

This project follows enterprise development standards:

- **Terraform:** OCI Resource Manager compatible, comprehensive validation
- **Python:** PEP-8, type hints, Google-style docstrings
- **TypeScript:** Google TypeScript Style Guide, strict mode
- **SQL/PL-SQL:** Trivadis Coding Guidelines v4.5
- **Documentation:** Clear, concise, bilingual where applicable
---

## Roadmap

- [x] Phase 1: Infrastructure as Code (In Progress)
  - [x] Autonomous Database 23ai/26ai deployment
  - [x] Application server configuration
  - [x] Network infrastructure setup
  - [x] GitHub repository creation
  - [ ] Complete documentation
  - [ ] Demo video

- [ ] Phase 2: Python RAG Implementation (Week 2)
- [ ] Phase 3: Bun/Elysia Chatbot (Week 3)
- [ ] Phase 4: Multicloud Exadata (Week 4)

---

## License

MIT License - see [LICENSE](./LICENSE) for details.

---

## Contact

**Juliano Stefano**
Oracle DBA Expert & Multi-Cloud Architect | Cloud Solutions Architect
LinkedIn: [linkedin.com/in/julianostefano](https://www.linkedin.com/in/julianostefano/)

---

## Acknowledgments

This project is developed as a portfolio demonstration of advanced Oracle Cloud and database expertise. All code follows enterprise standards and best practices suitable for production environments.
