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

    console.log('[TB] Novo token obtido');
    return tbToken;
}

async function getTbToken() {
    if (!tbToken || !tbTokenExpires || Date.now() >= tbTokenExpires) {
        await loginToThingsBoard();
    }
    return tbToken;
}

/**
 * Vai ao ThingsBoard buscar os assets relacionados a um device
 * e já traz o atributo 'phone' (se estiver definido).
 * Usa o endpoint /api/entitiesQuery com um filtro de relações.
 */
async function getAssetsForDevice(deviceId) {
    const token = await getTbToken();

    const url = `${TB_URL}/api/assets`;

    const body = {
        parameters: {
            rootId: deviceId,
            rootType: 'DEVICE',
            direction: 'TO',              // como no teu curl
            relationTypeGroup: 'COMMON',
            maxLevel: 1,
            fetchLastLevelOnly: true
        },
        relationType: 'Manages',
        assetTypes: ['Tecnicos']
    };

    const resp = await tbAxios.post(url, body, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    });

    // No teu caso a resposta é um ARRAY diretamente
    const assets = Array.isArray(resp.data) ? resp.data : [];
    return assets;
}

async function getPhoneNumberForAsset(assetId) {
    const token = await getTbToken();

    const url = `${TB_URL}/api/plugins/telemetry/ASSET/${assetId}/values/attributes/SERVER_SCOPE?keys=phoneNumber`;

    const resp = await tbAxios.get(url, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });

    const data = resp.data;
    if (Array.isArray(data) && data.length > 0) {
        // Garante que fica string (para prefixos, zeros à esquerda, etc, se um dia mudares)
        return String(data[0].value);
    }

    return null;
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


// -------------- Funções auxiliares SMS -----------------

async function sendSms(phone, message) {
    // Aqui é um exemplo genérico com axios.
    // Substitui pelo formato da API do teu fornecedor de SMS (Twilio, etc).
    try {
        console.log('Enviando SMS para', phone, 'mensagem:', message);

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

        //console.log(resp);

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
        console.log(`[API] Pedido de envio SMS para device ${deviceId}`);

        // 1) Buscar assets relacionados
        const assets = await getAssetsForDevice(deviceId);

        // 2) Ir buscar phoneNumber de cada asset em paralelo
        const assetsWithPhone = await Promise.all(
            assets.map(async (asset) => {
                const assetId = asset.id?.id || asset.id; // do teu JSON: asset.id.id
                const phoneNumber = await getPhoneNumberForAsset(assetId);

                return {
                    id: assetId,
                    name: asset.name,
                    type: asset.type,
                    phone: phoneNumber
                };
            })
        );

        // 3) Filtrar quem tem phone
        const targets = assetsWithPhone.filter(a => !!a.phone);

        if (!targets.length) {
            return res.status(404).json({
                success: false,
                message: 'Nenhum técnico com phoneNumber encontrado para este device.',
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

            console.log(`initialGeradorInitiated: ${initialGeradorInitiated}`);
            console.log(`tensao: ${tensao}`);
            console.log(`tensao_min: ${tensao_min}`);
            console.log(`tensao_max: ${tensao_max}`);
            console.log(`lastGeradorInitiated: ${lastGeradorInitiated}`);
            console.log(`countGerador: ${countGerador}`);

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
                        assetId: t.id,
                        assetName: t.name,
                        phone: t.phone,
                        smsResult: smsResp
                    });
                } catch (err) {
                    results.push({
                        assetId: t.id,
                        assetName: t.name,
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

            console.log(`alarmTipo: ${alarmTipo}`);
            console.log(`valorAlarm: ${valorAlarm}`);
            console.log(`valorAlarmVariavel: ${valorAlarmVariavel}`);
            console.log(`unidadeVariavel: ${unidadeVariavel}`);
            console.log(`decimalsVariavel: ${decimalsVariavel}`);
            console.log(`type: ${type}`);
            

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
                        assetId: t.id,
                        assetName: t.name,
                        phone: t.phone,
                        smsResult: smsResp
                    });
                } catch (err) {
                    results.push({
                        assetId: t.id,
                        assetName: t.name,
                        phone: t.phone,
                        error: err.response?.data || err.message
                    });
                }
            }
        }

        return res.json({
            success: true,
            deviceId,
            totalAssets: assets.length,
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


// -------------- Arrancar servidor -----------------

const PORT = process.env.PORT || 5555;
app.listen(PORT, () => {
    console.log(`Node API a correr em http://localhost:${PORT}`);
});