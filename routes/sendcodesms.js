const { Router } = require('express');
const { getUserInfo, sendTbNotification } = require('../helpers/thingsboard');
const { sendSms } = require('../helpers/sms');
const { logSms } = require('../helpers/logger');

const router = Router();

router.get('/:userId', async (req, res) => {
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
        const codeMessage = `O seu código de verificação é: ${code}`;

        // SMS e notificação in-app são canais independentes: uma falha de SMS
        // não pode impedir a entrega do código por notificação (e vice-versa).
        let smsOk = false;
        let smsError = null;
        try {
            await sendSms(userInfo.phone, codeMessage);
            logSms({ userName: userInfo.name, phone: userInfo.phone, message: codeMessage });
            smsOk = true;
        } catch (e) {
            smsError = e.response?.data || e.message;
            logSms({ userName: userInfo.name, phone: userInfo.phone, message: codeMessage, error: smsError });
            console.error(`Erro ao enviar SMS de código para ${userInfo.phone}`, smsError);
        }

        let notifyOk = false;
        try {
            await sendTbNotification([userId], 'Código de Verificação', codeMessage);
            notifyOk = true;
        } catch (e) {
            console.error('Erro ao enviar notificação TB:', e.response?.data || e.message);
        }

        if (!smsOk && !notifyOk) {
            return res.status(500).json({
                success: false,
                message: 'Não foi possível entregar o código por SMS nem por notificação.',
                userId,
                error: smsError
            });
        }

        return res.json({ success: true, userId, phone: userInfo.phone, code, smsOk, notifyOk });

    } catch (err) {
        console.error('Erro em /nodeapi/sendcodesms', err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: 'Erro ao processar pedido.',
            error: err.response?.data || err.message
        });
    }
});

module.exports = router;
