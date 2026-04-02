require('dotenv').config();
const axios = require('axios');
const https = require('https');

const TB_URL = process.env.TB_URL;
const TB_USER = process.env.TB_USER;
const TB_PASS = process.env.TB_PASS;

const SMS_API_URL = process.env.SMS_API_URL;
const SMS_API_ACCOUNT = process.env.SMS_API_ACCOUNT;
const SMS_API_LICENSEKEY = process.env.SMS_API_LICENSEKEY;
const SMS_API_ALFASENDER = process.env.SMS_API_ALFASENDER;

const PORT = process.env.PORT || 5555;

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
    SMS_API_ACCOUNT,
    SMS_API_LICENSEKEY,
    SMS_API_ALFASENDER,
    PORT,
    tbAxios,
};
