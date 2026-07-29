const { Router } = require('express');
const { getUsersForDevice, fetchUsersWithPhone, getCallQueueUserIds, sendTbNotification } = require('../helpers/thingsboard');
const { dispatchSms, resolveStatusTargets, dispatchCall, addPiqueteTargets } = require('../helpers/sms');
const { SENSORES_CRITICOS } = require('../config');
const { logCall } = require('../helpers/logger');

const router = Router();

//sensores criticos -> envia sms para os utilizadores associados à unidade do device e faz chamada para os utilizadores que estiverem configurados para receber chamada

router.get('/:deviceId', async (req, res) => {
    const { deviceId } = req.params;

    try {
        const userIds = await getUsersForDevice(deviceId);
        const usersWithPhone = await fetchUsersWithPhone(userIds);
        const targets = usersWithPhone.filter(u => !!u.phone);

        const gerador = req.query.gerador || false;
        const type = req.query.type || 'created';

        const isStatusType = type === 'device_status' || type === 'automato_status';
        // A notificação in-app vai para todos os utilizadores do device, mesmo sem telefone.
        // O SMS é que fica restrito a quem tem telefone (targets). Só termina aqui se não
        // houver de todo utilizadores associados ao device.
        if (!userIds.length && !gerador && type !== 'rede' && !isStatusType) {
            return res.status(404).json({
                success: false,
                message: 'Nenhum utilizador associado a este device.',
                deviceId
            });
        }

        const unidadeName = req.query.unidadeName || '';
        const variavelName = req.query.variavelName || '';
        let results = [];
        let piqueteActive = false;

        if (gerador) {
            const initialGeradorInitiated = req.query.initialGeradorInitiated || '';
            const tensao = req.query.tensao || '';
            const tensao_min = req.query.tensao_min || '';
            const tensao_max = req.query.tensao_max || '';
            const lastGeradorInitiated = req.query.lastGeradorInitiated || '';
            const countGerador = req.query.countGerador || 1;

            let message = `Unidade ${unidadeName} ->`;

            if (lastGeradorInitiated === initialGeradorInitiated) {
                message += ` Gerador em funcionamento à 1 Hora.`;
            } else {
                message += ` Na última hora, o gerador entrou em funcionamento ${countGerador} vez(es).`;
            }

            if (tensao > tensao_min && tensao < tensao_max) {
                message += ` Existe um possivel problema no Estabilizador.`;
            }

            const gerador = await addPiqueteTargets(targets, userIds);
            piqueteActive = gerador.piquete;

            results = await dispatchSms(gerador.targets, message);
            try {
                await sendTbNotification(gerador.userIds, 'Gerador', message);
            } catch (e) {
                console.error('Erro ao enviar notificação TB:', e.response?.data || e.message);
            }

        } else if (type === 'rede') {
            const variavelValue = req.query.variavelValue || '';
            const lastVariavelValue = req.query.lastVariavelValue || '';
            const message = `Unidade ${unidadeName} mudou a sua configuração de rede atual de ${lastVariavelValue} para ${variavelValue}`;

            const usersSplitted = (req.query.users || '').split(',').filter(Boolean);
            const redeTargets = (await fetchUsersWithPhone(usersSplitted)).filter(u => u.phone);

            results = await dispatchSms(redeTargets, message);
            try {
                // Notifica todos os utilizadores indicados, mesmo os que não têm telefone.
                await sendTbNotification(usersSplitted, 'Alteração de Rede', message);
            } catch (e) {
                console.error('Erro ao enviar notificação TB:', e.response?.data || e.message);
            }

        } else if (type === 'device_status' || type === 'automato_status') {
            const status = req.query.status || 'offline';
            const sendToUnit = req.query.sendToUnit;
            const explicitUserIds = req.query.users ? req.query.users.split(',') : [];

            const statusLabel = type === 'device_status'
                ? (status === 'online' ? 'ONLINE' : 'OFFLINE')
                : (status === 'online' ? 'voltou a ter comunicação com o autómato' : 'ficou sem comunicação com o autómato');

            const message = `${unidadeName}: Unidade ${statusLabel}`;

            // O piquete acresce à audiência da unidade, por isso só se aplica quando
            // é a unidade a ser notificada. Com sendToUnit falso o alerta é dirigido
            // apenas a quem vem em ?users=.
            const estado = sendToUnit
                ? await addPiqueteTargets(targets, userIds)
                : { targets, userIds, piquete: false };
            piqueteActive = estado.piquete;

            const statusTargets = await resolveStatusTargets(estado.targets, sendToUnit, explicitUserIds);

            // Audiência da notificação in-app: mesma lógica de destinatários, mas sem filtrar por telefone.
            const statusNotifyIds = [...new Set([
                ...(sendToUnit ? estado.userIds : []),
                ...explicitUserIds
            ])];

            if (!statusTargets.length && !statusNotifyIds.length) {
                return res.status(404).json({
                    success: false,
                    message: 'Nenhum utilizador encontrado.',
                    deviceId
                });
            }

            results = await dispatchSms(statusTargets, message);
            const statusSubject = type === 'device_status' ? 'Estado da Unidade' : 'Estado do Autómato';
            try {
                await sendTbNotification(statusNotifyIds, statusSubject, message);
            } catch (e) {
                console.error('Erro ao enviar notificação TB:', e.response?.data || e.message);
            }

        } else {
            const alarmTipo = req.query.alarmTipo || '';
            const valorAlarm = req.query.valorAlarm || '';
            const valorAlarmVariavel = req.query.valorAlarmVariavel || '';
            const unidadeVariavel = req.query.unidadeVariavel || '';
            const decimalsVariavel = req.query.decimalsVariavel || 2;
            const variavel = req.query.variavel || '';

            let indicacaoValor = '';
            if (alarmTipo !== 'boolean') {
                const num = Number(valorAlarmVariavel);
                indicacaoValor = !isNaN(num)
                    ? `= ${num.toFixed(decimalsVariavel)} ${unidadeVariavel} `
                    : `= ${valorAlarmVariavel} ${unidadeVariavel} `;
            }

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

            const alarme = await addPiqueteTargets(targets, userIds);
            piqueteActive = alarme.piquete;

            results = await dispatchSms(alarme.targets, message);

            const tbSubject = type === 'created' ? 'Alarme Acionado'
                : type === 'updated' ? 'Alarme Atualizado'
                : 'Alarme Corrigido';
            try {
                await sendTbNotification(alarme.userIds, tbSubject, message);
            } catch (e) {
                console.error('Erro ao enviar notificação TB:', e.response?.data || e.message);
            }

            if (SENSORES_CRITICOS.includes(variavel) && type === 'created') {
                // Get users to Call from call queue asset
                const callQueueUserIds = await getCallQueueUserIds();
                const callQueueUsers = await fetchUsersWithPhone(callQueueUserIds);
                const callTargets = callQueueUsers.filter(u => u.phone);
                
                const phonesToCall = callTargets.map(u => u.phone);
                if (phonesToCall.length) {
                    const callMessage = `Alarme Crítico: ${variavelName} na unidade ${unidadeName}.`;
                    await dispatchCall(phonesToCall, callMessage, 'loop');
                    logCall({ phone: phonesToCall.join(', '), message: callMessage })
                }
            }
        }

        return res.json({
            success: true,
            deviceId,
            totalUsers: userIds.length,
            targetsCount: targets.length,
            piquete: piqueteActive,
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

module.exports = router;
