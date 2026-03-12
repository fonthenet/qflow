#!/bin/bash
# QueueFlow iOS App Clip — One-command build script
# Run this on any Mac with Xcode 15+ installed:
#   cd apps/ios && chmod +x build.sh && ./build.sh
#
# For first-time setup, run:
#   ./build.sh setup
#
# To archive for App Store submission:
#   ./build.sh archive

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/QueueFlow" && pwd)"
cd "$PROJECT_DIR"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🏗️  QueueFlow iOS Build${NC}"
echo ""

# Step 1: Install XcodeGen if needed
if ! command -v xcodegen &> /dev/null; then
    echo "Installing XcodeGen..."
    brew install xcodegen
fi

# Step 2: Generate Xcode project
echo -e "${BLUE}📋 Generating Xcode project from project.yml...${NC}"
xcodegen generate
echo -e "${GREEN}✅ QueueFlow.xcodeproj generated${NC}"
echo ""

if [ "$1" = "setup" ]; then
    echo -e "${GREEN}✅ Setup complete! Open QueueFlow.xcodeproj in Xcode.${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Open QueueFlow.xcodeproj"
    echo "  2. Select your Team in Signing & Capabilities for both targets"
    echo "  3. Select QueueFlowClip scheme"
    echo "  4. Build & Run on your iPhone"
    open QueueFlow.xcodeproj
    exit 0
fi

if [ "$1" = "archive" ]; then
    echo -e "${BLUE}📦 Archiving for App Store...${NC}"
    xcodebuild archive \
        -project QueueFlow.xcodeproj \
        -scheme QueueFlow \
        -destination 'generic/platform=iOS' \
        -archivePath "$PROJECT_DIR/build/QueueFlow.xcarchive" \
        | tail -5
    echo ""
    echo -e "${GREEN}✅ Archive created at build/QueueFlow.xcarchive${NC}"
    echo "Open Xcode → Window → Organizer to upload to App Store Connect"
    exit 0
fi

# Default: build for simulator (no signing needed)
echo -e "${BLUE}🔨 Building App Clip for Simulator...${NC}"
xcodebuild build \
    -project QueueFlow.xcodeproj \
    -scheme QueueFlowClip \
    -destination 'platform=iOS Simulator,name=iPhone 15,OS=latest' \
    -configuration Debug \
    CODE_SIGN_IDENTITY="" \
    CODE_SIGNING_REQUIRED=NO \
    CODE_SIGNING_ALLOWED=NO \
    2>&1 | tail -5

echo ""
echo -e "${GREEN}✅ App Clip built successfully!${NC}"
echo ""

echo -e "${BLUE}🔨 Building Companion App for Simulator...${NC}"
xcodebuild build \
    -project QueueFlow.xcodeproj \
    -scheme QueueFlow \
    -destination 'platform=iOS Simulator,name=iPhone 15,OS=latest' \
    -configuration Debug \
    CODE_SIGN_IDENTITY="" \
    CODE_SIGNING_REQUIRED=NO \
    CODE_SIGNING_ALLOWED=NO \
    2>&1 | tail -5

echo ""
echo -e "${GREEN}✅ Both targets built successfully!${NC}"
echo ""
echo "To test on a real device:"
echo "  1. Open QueueFlow.xcodeproj in Xcode"
echo "  2. Select QueueFlowClip scheme"
echo "  3. Connect your iPhone and build"
