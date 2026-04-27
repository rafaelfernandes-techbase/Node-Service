const axios = require('axios');
const { SMS_API_URL, SMS_API_ACCOUNT, SMS_API_LICENSEKEY, SMS_API_ALFASENDER, CALL_API_URL, CALL_API_KEY } = require('../config');
const { fetchUsersWithPhone, getPiqueteAttributes } = require('./thingsboard');
const { logSms } = require('./logger');

async function sendSms(phone, message) {
    try {
        const formData = new URLSearchParams();
        formData.append('account', SMS_API_ACCOUNT);
        formData.append('licensekey', SMS_API_LICENSEKEY);
        formData.append('phoneNumber', phone);
        formData.append('messageText', message);
        formData.append('alfaSender', SMS_API_ALFASENDER);

        const resp = await axios.post(SMS_API_URL, formData.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        return resp.data;
    } catch (err) {
        console.error(`Erro ao enviar SMS para ${phone}`, err.response?.data || err.message);
        throw err;
    }
}

async function dispatchSms(targets, message) {
    const results = [];
    for (const t of targets) {
        try {
            const smsResp = await sendSms(t.phone, message);
            logSms({ userName: t.name, phone: t.phone, message });
            results.push({ userId: t.id, userName: t.name, phone: t.phone, smsResult: smsResp });
        } catch (err) {
            const error = err.response?.data || err.message;
            logSms({ userName: t.name, phone: t.phone, message, error });
            results.push({ userId: t.id, userName: t.name, phone: t.phone, error });
        }
    }
    return results;
}

async function resolveStatusTargets(unitTargets, sendToUnit, explicitUserIds) {
    const base = sendToUnit ? unitTargets : [];
    const explicit = await fetchUsersWithPhone(explicitUserIds);

    const seen = new Set();
    return [...base, ...explicit].filter(u => {
        if (!u.phone || seen.has(u.id)) return false;
        seen.add(u.id);
        return true;
    });
}

function isInPiqueteHours(horaInicial, horaFinal) {
    const now = new Date();
    const [iH, iM] = horaInicial.split(':').map(Number);
    const [fH, fM] = horaFinal.split(':').map(Number);
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const iniMins = iH * 60 + iM;
    const finMins = fH * 60 + fM;
    // horário que atravessa meia-noite (ex: 22:00 -> 08:00)
    if (iniMins > finMins) return nowMins >= iniMins || nowMins < finMins;
    return nowMins >= iniMins && nowMins < finMins;
}

async function applyPiqueteOverride(unitTargets) {
    const attrs = await getPiqueteAttributes();
    const day = new Date().getDay(); // 0=Dom, 6=Sáb
    const isWeekend = day === 0 || day === 6;
    const horaInicial = isWeekend ? attrs.fimsemanaHoraInicial : attrs.semanaHoraInicial;
    const horaFinal = isWeekend ? attrs.fimsemanaHoraFinal : attrs.semanaHoraFinal;

    if (!horaInicial || !horaFinal || !isInPiqueteHours(horaInicial, horaFinal)) {
        return unitTargets;
    }

    let callQueue = attrs.callQueue;
    if (typeof callQueue === 'string') {
        try { callQueue = JSON.parse(callQueue); } catch { callQueue = []; }
    }
    if (!Array.isArray(callQueue) || !callQueue.length) return unitTargets;

    const piqueteUsers = await fetchUsersWithPhone(callQueue);
    const piqueteTargets = piqueteUsers.filter(u => !!u.phone);
    return piqueteTargets.length ? piqueteTargets : unitTargets;
}

async function dispatchCall(phones, message) {
    const destination = phones.join(',');
    const resp = await axios.get(CALL_API_URL, {
        params: { message, destination },
        headers: { ApiKey: CALL_API_KEY }
    });
    return resp.data;
}

module.exports = { sendSms, dispatchSms, dispatchCall, resolveStatusTargets, applyPiqueteOverride };
