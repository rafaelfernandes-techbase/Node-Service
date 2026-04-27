const { Router } = require('express');
const { getUsersInGroup, fetchUsersWithPhone } = require('../helpers/thingsboard');
const { sendSms, dispatchCall } = require('../helpers/sms');

const router = Router();

router.post('/', async (req, res) => {
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

        const usersInfo = await fetchUsersWithPhone(userIds);

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

        // Chamada de voz para os mesmos utilizadores que receberam o SMS
        let callResult = null;
        try {
            const phones = usersInfo.map(u => u.phone).filter(Boolean);
            if (phones.length) {
                callResult = await dispatchCall(phones, message);
            }
        } catch (err) {
            console.error('Erro ao fazer chamada de voz', err.response?.data || err.message);
            callResult = { error: err.response?.data || err.message };
        }

        return res.json({ success: true, groupId, sent, failed, skipped_no_phone, callResult });

    } catch (err) {
        console.error('Erro em /nodeapi/sendmanagersms', err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: 'Erro ao processar pedido.',
            error: err.response?.data || err.message
        });
    }
});

module.exports = router;
