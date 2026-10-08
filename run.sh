#!/bin/bash
# clamo.uz - Tibbiyot Akkreditatsiyasi Mahalliy Serverini Ishga Tushirish

echo "================================================================="
echo "🏥 clamo.uz Tibbiyot Akkreditatsiyasi Tizimi (Python 3 Server)"
echo "75 ta Standart va 275 ta Mezon Asosida"
echo "================================================================="

cd "$(dirname "$0")"

# Initialize DB if not exists
python3 database.py

# Start Server
echo "🚀 Server ishga tushmoqda..."
python3 server.py
