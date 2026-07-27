require('dotenv').config();
const axios = require('axios');
const https = require('https');

const TB_URL = process.env.TB_URL;
const TB_USER = process.env.TB_USER;
const TB_PASS = process.env.TB_PASS;

const SMS_API_URL = process.env.SMS_API_URL || 'https://api.sms.to/sms/send';
const SMS_API_KEY = process.env.SMS_API_KEY;
const SMS_API_SENDER_ID = process.env.SMS_API_SENDER_ID;

const CALL_API_URL = process.env.CALL_API_URL;
const CALL_API_KEY = process.env.CALL_API_KEY;

const PORT = process.env.PORT || 5555;
const PIQUETE_ASSET_ID = process.env.PIQUETE_ASSET_ID;
const CALL_QUEUE_ASSET_ID = process.env.CALL_QUEUE_ASSET_ID;
const SENSORES_CRITICOS = process.env.SENSORES_CRITICOS ? process.env.SENSORES_CRITICOS.split(',').map(s => s.trim()) : [];

const tbAxios = axios.create({
    baseURL: TB_URL,
    httpsAgent: new https.Agent({
        rejectUnauthorized: false, // Ignora certificado self-signed
    }),
});

module.exports = {
    TB_URL,
    TB_USER,
    TB_PASS,
    SMS_API_URL,
    SMS_API_KEY,
    SMS_API_SENDER_ID,
    CALL_API_URL,
    CALL_API_KEY,
    PORT,
    PIQUETE_ASSET_ID,
    CALL_QUEUE_ASSET_ID,
    SENSORES_CRITICOS,
    tbAxios,
};
