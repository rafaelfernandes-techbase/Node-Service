const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'sms.log');
const CALL_LOG_FILE = path.join(LOG_DIR, 'calls.log');

function logSms({ userName, phone, message, error }) {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

    const ts = new Date().toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' });
    const status = error ? 'ERRO   ' : 'ENVIADO';
    const errPart = error ? ` | Erro: ${error}` : '';
    const line = `[${ts}] ${status} | Para: ${userName} (${phone}) | Mensagem: ${message}${errPart}\n`;

    fs.appendFileSync(LOG_FILE, line, 'utf8');
}

function logCall({ phone, message, error }) {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

    const ts = new Date().toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' });
    const status = error ? 'ERRO   ' : 'CHAMADA';
    const errPart = error ? ` | Erro: ${error}` : '';
    const line = `[${ts}] ${status} | Para: ${phone}) | Mensagem: ${message}${errPart}\n`;

    fs.appendFileSync(CALL_LOG_FILE, line, 'utf8');
}

module.exports = { logSms, logCall };
