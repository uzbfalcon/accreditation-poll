// Plesk Node.js (Passenger) startup file — Next.js standalone serverini ishga tushiradi.
// Maxfiy sozlamalar (BACKOFFICE_USER, BACKOFFICE_PASSWORD) serverdagi backoffice.env faylidan yuklanadi;
// bu fayl deploy paketiga kirmaydi va deploy paytida o'chirilmaydi.
const path = require('path');

try {
  process.loadEnvFile(path.join(__dirname, 'backoffice.env'));
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}

require('./server.js');
