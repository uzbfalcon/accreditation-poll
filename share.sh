#!/bin/bash
# clamo.uz - Prezentatsiya uchun ommaviy HTTPS havola yaratuvchi skript

echo "=========================================="
echo " CLAMO Akkreditatsiya Tizimi Tunnel Skripti"
echo "=========================================="

# 1. Next.js server ishlab turganini tekshirish
if ! nc -z localhost 3000 2>/dev/null; then
    echo "⚠️  Next.js server (localhost:3000) o'chiq ko'rinadi."
    echo "🚀  Server ishga tushirilmoqda..."
    npm start &
    sleep 3
fi

# 2. Xavfsiz, tezkor va barqaror SSH Tunnel orqali ommaviy havola ochish
echo "🌐  Ommaviy HTTPS havola ochilmoqda..."
ssh -o StrictHostKeyChecking=no -R 80:localhost:3000 nokey@localhost.run
