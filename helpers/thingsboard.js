const { TB_URL, TB_USER, TB_PASS, tbAxios, PIQUETE_ASSET_ID, CALL_QUEUE_ASSET_ID } = require('../config');

// Cache de token em memória (singleton por processo)
let tbToken = null;
let tbTokenExpires = null;

async function loginToThingsBoard() {
    const resp = await tbAxios.post(`${TB_URL}/api/auth/login`, {
        username: TB_USER,
        password: TB_PASS,
    }, {
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
    const resp = await tbAxios.get(
        `${TB_URL}/api/relations/info?toId=${deviceId}&toType=DEVICE&relationType=Manages&relationTypeGroup=COMMON`,
        { headers: { 'Authorization': `Bearer ${token}` } }
    );
    return (Array.isArray(resp.data) ? resp.data : [])
        .filter(r => r.from?.entityType === 'USER')
        .map(r => r.from.id);
}

async function getUserInfo(userId) {
    const token = await getTbToken();
    const resp = await tbAxios.get(`${TB_URL}/api/user/${userId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
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

async function fetchUsersWithPhone(userIds) {
    return Promise.all(
        userIds.map(async (userId) => {
            const info = await getUserInfo(userId);
            return {
                id: userId,
                name: `${info.firstName ?? ''} ${info.lastName ?? ''}`.trim(),
                phone: info.phone ?? null
            };
        })
    );
}

async function getPiqueteAttributes() {
    const token = await getTbToken();
    const resp = await tbAxios.get(
        `${TB_URL}/api/plugins/telemetry/ASSET/${PIQUETE_ASSET_ID}/values/attributes?keys=semanaHoraInicial,semanaHoraFinal,fimsemanaHoraInicial,fimsemanaHoraFinal,callQueue`,
        { headers: { Authorization: `Bearer ${token}` } }
    );
    const attrs = {};
    for (const item of (resp.data || [])) {
        attrs[item.key] = item.value;
    }
    return attrs;
}

async function getCallQueueUserIds() {
    const token = await getTbToken();
    const resp = await tbAxios.get(
        `${TB_URL}/api/plugins/telemetry/ASSET/${CALL_QUEUE_ASSET_ID}/values/attributes?keys=callQueue`,
        { headers: { Authorization: `Bearer ${token}` } }
    );
    const attrs = {};
    for (const item of (resp.data || [])) {
        attrs[item.key] = item.value;
    }
    let callQueue = attrs.callQueue;
    if (typeof callQueue === 'string') {
        try { callQueue = JSON.parse(callQueue); } catch { callQueue = []; }
    }
    return Array.isArray(callQueue) ? callQueue : [];
}

module.exports = {
    getTbToken,
    getUsersForDevice,
    getUserInfo,
    getUsersInGroup,
    fetchUsersWithPhone,
    getPiqueteAttributes,
    getCallQueueUserIds,
};
