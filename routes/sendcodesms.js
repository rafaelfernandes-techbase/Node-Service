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
        await sendSms(userInfo.phone, codeMessage);
        logSms({ userName: userInfo.name, phone: userInfo.phone, message: codeMessage });
        try {
            await sendTbNotification([userId], 'Código de Verificação', codeMessage);
        } catch (e) {
            console.error('Erro ao enviar notificação TB:', e.response?.data || e.message);
        }

        return res.json({ success: true, userId, phone: userInfo.phone, code });

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
