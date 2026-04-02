const { Router } = require('express');
const { getUsersForDevice, fetchUsersWithPhone } = require('../helpers/thingsboard');
const { dispatchSms, resolveStatusTargets } = require('../helpers/sms');

const router = Router();

router.get('/:deviceId', async (req, res) => {
    const { deviceId } = req.params;

    try {
        const userIds = await getUsersForDevice(deviceId);
        const usersWithPhone = await fetchUsersWithPhone(userIds);
        const targets = usersWithPhone.filter(u => !!u.phone);

        const gerador = req.query.gerador || false;
        const type = req.query.type || 'created';

        const isStatusType = type === 'device_status' || type === 'automato_status';
        if (!targets.length && !gerador && type !== 'rede' && !isStatusType) {
            return res.status(404).json({
                success: false,
                message: 'Nenhum utilizador com phone encontrado para este device.',
                deviceId
            });
        }

        const unidadeName = req.query.unidadeName || '';
        const variavelName = req.query.variavelName || '';
        let results = [];

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

            results = await dispatchSms(targets, message);

        } else if (type === 'rede') {
            const variavelValue = req.query.variavelValue || '';
            const lastVariavelValue = req.query.lastVariavelValue || '';
            const message = `Unidade ${unidadeName} mudou a sua configuração de rede atual de ${lastVariavelValue} para ${variavelValue}`;

            const usersSplitted = (req.query.users || '').split(',').filter(Boolean);
            const redeTargets = (await fetchUsersWithPhone(usersSplitted)).filter(u => u.phone);

            results = await dispatchSms(redeTargets, message);

        } else if (type === 'device_status' || type === 'automato_status') {
            const status = req.query.status || 'offline';
            const sendToUnit = req.query.sendToUnit;
            const explicitUserIds = req.query.users ? req.query.users.split(',') : [];

            const statusLabel = type === 'device_status'
                ? (status === 'online' ? 'ONLINE' : 'OFFLINE')
                : (status === 'online' ? 'voltou a ter comunicação com o autómato' : 'ficou sem comunicação com o autómato');

            const message = `${unidadeName}: Unidade ${statusLabel}`;

            const statusTargets = await resolveStatusTargets(targets, sendToUnit, explicitUserIds);

            if (!statusTargets.length) {
                return res.status(404).json({
                    success: false,
                    message: 'Nenhum utilizador com phone encontrado.',
                    deviceId
                });
            }

            results = await dispatchSms(statusTargets, message);

        } else {
            const alarmTipo = req.query.alarmTipo || '';
            const valorAlarm = req.query.valorAlarm || '';
            const valorAlarmVariavel = req.query.valorAlarmVariavel || '';
            const unidadeVariavel = req.query.unidadeVariavel || '';
            const decimalsVariavel = req.query.decimalsVariavel || 2;

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

            results = await dispatchSms(targets, message);
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

module.exports = router;
