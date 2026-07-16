#!/bin/bash
# TaskFlow — Start Script
# Run this file to start the backend server

echo "🚀 Starting TaskFlow backend..."

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python3 not found. Please install Python 3.8+"
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
pip install flask --break-system-packages -q 2>/dev/null || pip install flask -q

# Initialize DB & start server
echo "🗄  Initializing database..."
cd "$(dirname "$0")"
python3 app.py

# Server runs on http://localhost:5000
