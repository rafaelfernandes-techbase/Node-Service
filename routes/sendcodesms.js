const { Router } = require('express');
const { getUserInfo } = require('../helpers/thingsboard');
const { sendSms } = require('../helpers/sms');

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
        await sendSms(userInfo.phone, `O seu código de verificação é: ${code}`);

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
