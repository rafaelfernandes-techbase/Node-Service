require('dotenv').config();
const express = require('express');
const axios = require('axios');
const https = require('https');

const app = express();
app.use(express.json());

const TB_URL = process.env.TB_URL;
const TB_USER = process.env.TB_USER;
const TB_PASS = process.env.TB_PASS;

const SMS_API_URL = process.env.SMS_API_URL;
const SMS_API_ACCOUNT = process.env.SMS_API_ACCOUNT;
const SMS_API_LICENSEKEY = process.env.SMS_API_LICENSEKEY;
const SMS_API_ALFASENDER = process.env.SMS_API_ALFASENDER;

const tbAxios = axios.create({
    baseURL: TB_URL,
    httpsAgent: new https.Agent({
        rejectUnauthorized: false, // IGNORA certificado self-signed
    }),
});

// Cache simples de token em memória
let tbToken = null;
let tbTokenExpires = null;

// -------------- Funções auxiliares ThingsBoard -----------------

async function loginToThingsBoard() {
    const url = `${TB_URL}/api/auth/login`;
    const body = {
        username: TB_USER,
        password: TB_PASS,
    };

    const resp = await tbAxios.post(url, body, {
        headers: { 'Content-Type': 'application/json' }
    });

    tbToken = resp.data.token;
    tbTokenExpires = Date.now() + 60 * 60 * 1000; // ~1h

    return tbToken;
}

async function getTbToken() {
    if (!tbToken || !tbTokenExpires || Date.now() >= tbTokenExpires) {
        await loginToThingsBoard();
    }
    return tbToken;
}

async function getUsersForDevice(deviceId) {
    const token = await getTbToken();

    const url = `${TB_URL}/api/relations/info?toId=${deviceId}&toType=DEVICE&relationType=Manages&relationTypeGroup=COMMON`;

    const resp = await tbAxios.get(url, {
        headers: { 'Authorization': `Bearer ${token}` }
    });

    const relations = Array.isArray(resp.data) ? resp.data : [];
    return relations
        .filter(r => r.from?.entityType === 'USER')
        .map(r => r.from.id);
}

async function getUserInfo(userId) {
    const token = await getTbToken();

    const url = `${TB_URL}/api/user/${userId}`;

    const resp = await tbAxios.get(url, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });

    return resp.data;
}


async function getUsersInGroup(groupId) {
    const token = await getTbToken();
    const resp = await tbAxios.get(
        `/api/entityGroup/${groupId}/entities?pageSize=100&page=0`,
        { headers: { 'Authorization': `Bearer ${token}` } }
    );
    return (resp.data.data || [])
        .filter(e => e.id?.entityType === 'USER')
        .map(e => e.id.id);
}


// -------------- Funções auxiliares SMS -----------------

async function sendSms(phone, message) {
    // Aqui é um exemplo genérico com axios.
    // Substitui pelo formato da API do teu fornecedor de SMS (Twilio, etc).
    try {
        const formData = new URLSearchParams();
        formData.append('account', SMS_API_ACCOUNT);
        formData.append('licensekey', SMS_API_LICENSEKEY);
        formData.append('phoneNumber', phone);
        formData.append('messageText', message);
        formData.append('alfaSender', SMS_API_ALFASENDER);

        const resp = await axios.post(
            SMS_API_URL,
            formData.toString(),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        return resp.data;
    } catch (err) {
        console.error(`Erro ao enviar SMS para ${phone}`, err.response?.data || err.message);
        throw err;
    }
}

// -------------- Rota principal: /nodeapi/sendsms/:deviceId -----------------

app.get('/nodeapi/sendsms/:deviceId', async (req, res) => {
    const { deviceId } = req.params;

    try {

        // 1) Buscar users relacionados ao device
        const userIds = await getUsersForDevice(deviceId);

        // 2) Ir buscar info de cada user em paralelo
        const usersWithPhone = await Promise.all(
            userIds.map(async (userId) => {
                const userInfo = await getUserInfo(userId);
                return {
                    id: userId,
                    name: `${userInfo.firstName ?? ''} ${userInfo.lastName ?? ''}`.trim(),
                    phone: userInfo.phone ?? null
                };
            })
        );

        // 3) Filtrar quem tem phone
        const targets = usersWithPhone.filter(u => !!u.phone);

        if (!targets.length) {
            return res.status(404).json({
                success: false,
                message: 'Nenhum utilizador com phone encontrado para este device.',
                deviceId
            });
        }

        const gerador = req.query.gerador || false;
        const type = req.query.type || 'created';
        const unidadeName = req.query.unidadeName || '';
        const variavelName = req.query.variavelName || '';
        const results = [];

        if (gerador) {
            const initialGeradorInitiated = req.query.initialGeradorInitiated || '';
            const tensao = req.query.tensao || '';
            const tensao_min = req.query.tensao_min || '';
            const tensao_max = req.query.tensao_max || '';
            const lastGeradorInitiated = req.query.lastGeradorInitiated || '';
            const countGerador = req.query.countGerador || 1;

            let message = `Unidade ${unidadeName} ->`;

            if (lastGeradorInitiated == initialGeradorInitiated){
                //Ativo à 1 hora
                message += ` Gerador em funcionamento à 1 Hora.`;
            }
            else{
                message += ` Na última hora, o gerador entrou em funcionamento ${countGerador} vez(es).`;
            }

            if (tensao > tensao_min && tensao < tensao_max){
                message += ` Existe um possivel problema no Estabilizador.`;
            }

            for (const t of targets) {
                try {
                    const smsResp = await sendSms(t.phone, message);
                    results.push({
                        userId: t.id,
                        userName: t.name,
                        phone: t.phone,
                        smsResult: smsResp
                    });
                } catch (err) {
                    results.push({
                        userId: t.id,
                        userName: t.name,
                        phone: t.phone,
                        error: err.response?.data || err.message
                    });
                }
            }
            
        }
        else if (type == "rede"){
            //Notificações de Rede
            const variavelValue = req.query.variavelValue || '';
            const lastVariavelValue = req.query.lastVariavelValue || '';

            let message = `Unidade ${unidadeName} mudou a sua configuração de rede atual de ${lastVariavelValue} para ${variavelValue}`;

            const users = req.query.users || '';
            let usersSplitted = users.split(",");
            
            for (const user of usersSplitted) {
                let userInfo = await getUserInfo(user);

                try {
                    const smsResp = await sendSms(userInfo.phone, message);
                    results.push({
                        assetId: user,
                        assetName: `${userInfo.firstName} ${userInfo.lastName}`,
                        phone: userInfo.phone,
                        smsResult: smsResp
                    });
                } catch (err) {
                    results.push({
                        assetId: user,
                        assetName: `${userInfo.firstName} ${userInfo.lastName}`,
                        phone: userInfo.phone,
                        error: err.response?.data || err.message
                    });
                }
            }
        }
        else {
            const alarmTipo = req.query.alarmTipo || '';
            const valorAlarm = req.query.valorAlarm || '';
            const valorAlarmVariavel = req.query.valorAlarmVariavel || '';
            const unidadeVariavel = req.query.unidadeVariavel || '';
            const decimalsVariavel = req.query.decimalsVariavel || 2;
            

            let indicacaoValor = "";
            if (alarmTipo != "boolean"){
                if (Number(valorAlarmVariavel) != null){
                    let newvalorAlarmVariavel = Number(valorAlarmVariavel);
                    indicacaoValor = `= ${newvalorAlarmVariavel.toFixed(decimalsVariavel)} ${unidadeVariavel} `;
                }
                else{
                    indicacaoValor = `= ${valorAlarmVariavel} ${unidadeVariavel} `;
                }
                
            }

            // 4) Mensagem (podes enviar por query, body, etc.)
            let message = `Mensagem automática para o device ${deviceId}`;

            switch (type) {
                case 'created':
                    message = `${unidadeName}: Alarme Acionado - ${variavelName} ${indicacaoValor}(${valorAlarm})`;
                    break;
                case 'updated':
                    message = `Alarme Atualizado: ${variavelName} na unidade ${unidadeName}.`;
                    break;
                case 'cleared':
                    message = `${unidadeName}: Alarme Corrigido - ${variavelName} ${indicacaoValor}`;
                    break;
            }

            // 5) Enviar SMS para todos os técnicos
            for (const t of targets) {
                try {
                    const smsResp = await sendSms(t.phone, message);
                    results.push({
                        userId: t.id,
                        userName: t.name,
                        phone: t.phone,
                        smsResult: smsResp
                    });
                } catch (err) {
                    results.push({
                        userId: t.id,
                        userName: t.name,
                        phone: t.phone,
                        error: err.response?.data || err.message
                    });
                }
            }
        }

        return res.json({
            success: true,
            deviceId,
            totalUsers: userIds.length,
            targetsCount: targets.length,
            details: results
        });
    } catch (err) {
        console.error('Erro em /nodeapi/sendsms', err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: 'Erro ao processar pedido.',
            error: err.response?.data || err.message
        });
    }
});


// -------------- Rota: /nodeapi/sendcodesms/:userId -----------------

app.get('/nodeapi/sendcodesms/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        const userInfo = await getUserInfo(userId);

        if (!userInfo.phone) {
            return res.status(404).json({
                success: false,
                message: 'Utilizador sem número de phone definido.',
                userId
            });
        }

        const code = String(Math.floor(100000 + Math.random() * 900000));
        const message = `O seu código de verificação é: ${code}`;

        await sendSms(userInfo.phone, message);

        return res.json({
            success: true,
            userId,
            phone: userInfo.phone,
            code
        });
    } catch (err) {
        console.error('Erro em /nodeapi/sendcodesms', err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: 'Erro ao processar pedido.',
            error: err.response?.data || err.message
        });
    }
});


// -------------- Rota: /nodeapi/sendmanagersms -----------------

app.post('/nodeapi/sendmanagersms', async (req, res) => {
    const { groupId, message } = req.body || {};

    if (!groupId || !message) {
        return res.status(400).json({
            success: false,
            message: 'Os campos "groupId" e "message" são obrigatórios.'
        });
    }

    try {
        const userIds = await getUsersInGroup(groupId);

        if (!userIds.length) {
            return res.status(404).json({
                success: false,
                message: 'Nenhum utilizador encontrado no grupo.',
                groupId
            });
        }

        const usersInfo = await Promise.all(
            userIds.map(async (userId) => {
                const info = await getUserInfo(userId);
                return {
                    id: userId,
                    name: `${info.firstName ?? ''} ${info.lastName ?? ''}`.trim(),
                    phone: info.phone ?? null
                };
            })
        );

        const sent = [];
        const failed = [];
        const skipped_no_phone = [];

        for (const user of usersInfo) {
            if (!user.phone) {
                skipped_no_phone.push({ userId: user.id, userName: user.name });
                continue;
            }
            try {
                const smsResp = await sendSms(user.phone, message);
                sent.push({ userId: user.id, userName: user.name, phone: user.phone, smsResult: smsResp });
            } catch (err) {
                failed.push({ userId: user.id, userName: user.name, phone: user.phone, error: err.response?.data || err.message });
            }
        }

        return res.json({ success: true, groupId, sent, failed, skipped_no_phone });
    } catch (err) {
        console.error('Erro em /nodeapi/sendmanagersms', err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: 'Erro ao processar pedido.',
            error: err.response?.data || err.message
        });
    }
});


// -------------- Arrancar servidor -----------------

const PORT = process.env.PORT || 5555;
app.listen(PORT, () => {
    console.log(`Node API a correr em http://localhost:${PORT}`);
});