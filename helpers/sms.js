const axios = require('axios');
const { SMS_API_URL, SMS_API_KEY, SMS_API_SENDER_ID, CALL_API_URL, CALL_API_KEY, PIQUETE_ASSET_ID } = require('../config');
const { fetchUsersWithPhone, getPiqueteAttributes } = require('./thingsboard');
const { logSms } = require('./logger');

// A API sms.to exige o número em formato E.164 (ex: +351912345678).
// Os números vêm do ThingsBoard e nem sempre trazem indicativo.
function normalizePhone(phone) {
    let p = String(phone).replace(/[\s()-]/g, '');
    if (p.startsWith('+')) return p;
    if (p.startsWith('00')) return `+${p.slice(2)}`;
    if (p.startsWith('351')) return `+${p}`;
    return `+351${p}`;
}

async function sendSms(phone, message) {
    try {
        const resp = await axios.post(SMS_API_URL, {
            message,
            to: normalizePhone(phone),
            bypass_optout: true,
            sender_id: SMS_API_SENDER_ID,
        }, {
            headers: {
                Authorization: `Bearer ${SMS_API_KEY}`,
                'Content-Type': 'application/json',
            }
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

// ---------------------------------------------------------------------------
// Piquete — atributos de servidor do asset PIQUETE_ASSET_ID:
//
//   featureEnabled              true/false, liga/desliga sem redeploy
//   semanaHoraInicial/Final     ms desde a meia-noite (72000000 = 20:00)
//   fimsemanaHoraInicial/Final  idem; início igual ao fim significa 24 horas
//   holidays                    ["2026-01-01", ...]
//   callQueue                   [{ weekStart: "2026-08-03", techIds: [...] }, ...]
//
// A semana de piquete corre de segunda-feira à hora de fim do turno noturno
// (semanaHoraFinal) até à segunda seguinte à mesma hora, para não trocar de
// técnico a meio da noite. Os técnicos de escala são acrescentados aos
// destinatários habituais, nunca os substituem.
// ---------------------------------------------------------------------------

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const MS_DAY = 86400000;

// O serviço pode correr com o TZ do sistema diferente de Portugal (o logger já
// força Europe/Lisbon), por isso data, dia e hora são calculados nesse fuso.
function getLisbonNow() {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Lisbon',
        weekday: 'short',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(new Date());

    const get = (type) => parts.find(p => p.type === type)?.value;
    return {
        date: `${get('year')}-${get('month')}-${get('day')}`,
        day: WEEKDAYS[get('weekday')],                                  // 0=Dom, 6=Sáb
        minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')),
    };
}

// Desloca uma data "YYYY-MM-DD" em N dias. Ancora ao meio-dia UTC para o
// cálculo ficar imune às mudanças de hora.
function shiftDate(date, days) {
    const anchor = new Date(`${date}T12:00:00Z`).getTime();
    return new Date(anchor + days * MS_DAY).toISOString().slice(0, 10);
}

function msToMinutes(value) {
    const ms = Number(value);
    return Number.isFinite(ms) ? Math.floor(ms / 60000) : null;
}

function isInWindow(iniMins, finMins, nowMins) {
    if (iniMins === null || finMins === null) return false;
    if (iniMins === finMins) return true;                                       // 24 horas (0 -> 0)
    if (iniMins > finMins) return nowMins >= iniMins || nowMins < finMins;      // atravessa a meia-noite
    return nowMins >= iniMins && nowMins < finMins;
}

// Os atributos JSON do ThingsBoard chegam umas vezes como objeto, outras como string.
function parseJsonAttr(value, fallback) {
    if (typeof value !== 'string') return value ?? fallback;
    try { return JSON.parse(value); } catch { return fallback; }
}

// Kill switch. Ausente ou falso => comportamento normal, sem piquete.
function isPiqueteEnabled(featureEnabled) {
    if (typeof featureEnabled === 'string') return featureEnabled.trim().toLowerCase() === 'true';
    return featureEnabled === true;
}

// Segunda-feira da semana de piquete em curso. Na segunda, antes da hora de
// passagem de turno, ainda pertence à semana anterior.
function currentWeekStart({ date, day, minutes }, handoverMins) {
    const daysSinceMonday = (day + 6) % 7;                              // 0=Dom -> 6, 1=Seg -> 0
    const beforeHandover = daysSinceMonday === 0 && minutes < handoverMins;
    return shiftDate(date, -(daysSinceMonday + (beforeHandover ? 7 : 0)));
}

// Decide se um instante cai em horário de piquete. Pura e sem I/O, para ser
// testável com instantes fabricados.
function isPiqueteWindow(attrs, now) {
    const holidays = parseJsonAttr(attrs.holidays, []);
    const isHoliday = (d) => Array.isArray(holidays) && holidays.includes(d);

    const semanaIni = msToMinutes(attrs.semanaHoraInicial);
    const semanaFim = msToMinutes(attrs.semanaHoraFinal);
    const fimSemanaIni = msToMinutes(attrs.fimsemanaHoraInicial);
    const fimSemanaFim = msToMinutes(attrs.fimsemanaHoraFinal);

    // Fim de semana e feriados usam a janela de fim de semana.
    const diaCompleto = now.day === 0 || now.day === 6 || isHoliday(now.date);
    if (diaCompleto ? isInWindow(fimSemanaIni, fimSemanaFim, now.minutes)
                    : isInWindow(semanaIni, semanaFim, now.minutes)) {
        return true;
    }

    // Véspera de feriado: a noite anterior conta como piquete.
    return semanaIni !== null && now.minutes >= semanaIni && isHoliday(shiftDate(now.date, 1));
}

// Dentro do horário de piquete os técnicos de escala são acrescentados aos
// destinatários da unidade — tanto no SMS (targets) como na notificação in-app
// (userIds). Os utilizadores da unidade continuam a receber sempre.
// Qualquer falha ou configuração incompleta devolve apenas os destinatários da
// unidade: um problema no asset de piquete nunca deve impedir o envio do alerta.
async function addPiqueteTargets(unitTargets, unitUserIds = []) {
    const semPiquete = { targets: unitTargets, userIds: unitUserIds, piquete: false };
    if (!PIQUETE_ASSET_ID) return semPiquete;

    try {
        const attrs = await getPiqueteAttributes();
        if (!isPiqueteEnabled(attrs.featureEnabled)) return semPiquete;

        const now = getLisbonNow();
        if (!isPiqueteWindow(attrs, now)) return semPiquete;

        const escalas = parseJsonAttr(attrs.callQueue, []);
        if (!Array.isArray(escalas) || !escalas.length) return semPiquete;

        const weekStart = currentWeekStart(now, msToMinutes(attrs.semanaHoraFinal) ?? 0);
        const escala = escalas.find(e => e && e.weekStart === weekStart);
        if (!escala || !Array.isArray(escala.techIds) || !escala.techIds.length) {
            console.warn(`Piquete ativo mas sem escala para a semana de ${weekStart}; a enviar só para os utilizadores da unidade.`);
            return semPiquete;
        }

        // União com os destinatários da unidade, sem duplicar quem já lá está.
        const jaIncluidos = new Set(unitTargets.map(t => t.id));
        const piqueteUsers = await fetchUsersWithPhone(escala.techIds);
        const extraTargets = piqueteUsers.filter(u => u.phone && !jaIncluidos.has(u.id));

        if (!piqueteUsers.some(u => u.phone)) {
            console.warn(`Escala de ${weekStart}: nenhum técnico de piquete tem telefone, só recebem notificação in-app.`);
        }

        return {
            targets: [...unitTargets, ...extraTargets],
            userIds: [...new Set([...unitUserIds, ...escala.techIds])],
            piquete: true,
        };
    } catch (err) {
        console.error('Erro ao aplicar piquete, a enviar só para os utilizadores da unidade:', err.response?.data || err.message);
        return semPiquete;
    }
}

async function dispatchCall(phones, message, mode = 'all') {
    const destination = phones.join(',');
    const resp = await axios.get(CALL_API_URL, {
        params: { message, destination, mode },
        headers: { ApiKey: CALL_API_KEY }
    });
    return resp.data;
}

module.exports = {
    sendSms,
    dispatchSms,
    dispatchCall,
    resolveStatusTargets,
    addPiqueteTargets,
    // Expostos apenas para testes da lógica de horário/escala.
    _piquete: { getLisbonNow, isPiqueteWindow, currentWeekStart, isPiqueteEnabled, msToMinutes },
};
