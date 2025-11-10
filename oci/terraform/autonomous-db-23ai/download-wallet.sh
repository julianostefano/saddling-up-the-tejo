#!/bin/bash
# ==============================================================================
# Oracle Autonomous Database - Regional Wallet Download Script
# ==============================================================================
# Purpose: Download regional wallet for Autonomous Database connection with mTLS
#
# Author: Juliano Stefano
# LinkedIn: https://www.linkedin.com/in/julianostefano/
# Repository: https://github.com/julianostefano/saddling-up-the-tejo
#
# ==============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ==============================================================================
# Configuration
# ==============================================================================

# Get Autonomous Database OCID from Terraform output
ADB_OCID=$(terraform output -raw autonomous_database_id 2>/dev/null)
DB_NAME=$(terraform output -raw autonomous_database_name 2>/dev/null)

# Wallet configuration
WALLET_PASSWORD=${WALLET_PASSWORD:-"WalletPassword123!"}
WALLET_DIR=${WALLET_DIR:-"./wallet"}
WALLET_FILE="${WALLET_DIR}/wallet_${DB_NAME}.zip"

# ==============================================================================
# Functions
# ==============================================================================

print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_prerequisites() {
    print_info "Checking prerequisites..."

    # Check if OCI CLI is installed
    if ! command -v oci &> /dev/null; then
        print_error "OCI CLI not found. Please install it first:"
        echo "  https://docs.oracle.com/en-us/iaas/Content/API/SDKDocs/cliinstall.htm"
        exit 1
    fi

    # Check if OCI CLI is configured
    if [ ! -f ~/.oci/config ]; then
        print_error "OCI CLI not configured. Run: oci setup config"
        exit 1
    fi

    # Check if Terraform outputs are available
    if [ -z "$ADB_OCID" ]; then
        print_error "Cannot get Autonomous Database OCID from Terraform."
        print_error "Make sure you have run 'terraform apply' successfully."
        exit 1
    fi

    print_info "Prerequisites check passed"
}

create_wallet_directory() {
    if [ ! -d "$WALLET_DIR" ]; then
        print_info "Creating wallet directory: $WALLET_DIR"
        mkdir -p "$WALLET_DIR"
    fi
}

download_regional_wallet() {
    print_info "Downloading REGIONAL wallet for Autonomous Database..."
    print_info "Database OCID: $ADB_OCID"
    print_info "Database Name: $DB_NAME"
    print_info "Wallet file: $WALLET_FILE"

    # Download regional wallet (ALL = regional wallet that works for all databases in region)
    # SINGLE = instance-specific wallet (only for one database)
    if oci db autonomous-database generate-wallet \
        --autonomous-database-id "$ADB_OCID" \
        --file "$WALLET_FILE" \
        --password "$WALLET_PASSWORD" \
        --generate-type ALL; then

        print_info "Regional wallet downloaded successfully!"
    else
        print_error "Failed to download wallet"
        exit 1
    fi
}

extract_wallet() {
    print_info "Extracting wallet..."

    if command -v unzip &> /dev/null; then
        unzip -o "$WALLET_FILE" -d "$WALLET_DIR" > /dev/null
        print_info "Wallet extracted to: $WALLET_DIR"
    else
        print_warning "unzip not found. Wallet remains as ZIP file: $WALLET_FILE"
    fi
}

set_permissions() {
    print_info "Setting wallet permissions..."
    chmod 600 "$WALLET_DIR"/*
    print_info "Wallet files secured (chmod 600)"
}

display_connection_info() {
    echo ""
    echo "=================================================================="
    echo "Wallet Download Complete!"
    echo "=================================================================="
    echo ""
    echo "Wallet Location: $WALLET_DIR"
    echo "Wallet Password: $WALLET_PASSWORD"
    echo ""
    echo "Connection Examples:"
    echo "------------------------------------------------------------------"
    echo ""
    echo "1. SQL*Plus (with TNS_ADMIN):"
    echo "   export TNS_ADMIN=$WALLET_DIR"
    echo "   sqlplus admin/<password>@${DB_NAME}_high"
    echo ""
    echo "2. SQL*Plus (with connection string from wallet):"
    echo "   sqlplus admin/<password>@${DB_NAME}_high"
    echo ""
    echo "3. Python with oracledb:"
    echo "   import oracledb"
    echo "   oracledb.init_oracle_client(config_dir='$WALLET_DIR')"
    echo "   conn = oracledb.connect("
    echo "       user='ADMIN',"
    echo "       password='<your_password>',"
    echo "       dsn='${DB_NAME}_high'"
    echo "   )"
    echo ""
    echo "Available TNS Names (check tnsnames.ora in wallet):"
    echo "   - ${DB_NAME}_high    (maximum resources)"
    echo "   - ${DB_NAME}_medium  (balanced)"
    echo "   - ${DB_NAME}_low     (minimal resources)"
    echo ""
    echo "=================================================================="
    echo ""
}

# ==============================================================================
# Main Execution
# ==============================================================================

main() {
    echo ""
    echo "=================================================================="
    echo "Oracle Autonomous Database - Regional Wallet Download"
    echo "=================================================================="
    echo ""

    check_prerequisites
    create_wallet_directory
    download_regional_wallet
    extract_wallet
    set_permissions
    display_connection_info

    print_info "Wallet download complete!"
    echo ""
}

# Run main function
main
