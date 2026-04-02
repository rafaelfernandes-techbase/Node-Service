require('./config'); // carrega dotenv antes de tudo
const express = require('express');
const { PORT } = require('./config');

const sendSmsRoute = require('./routes/sendsms');
const sendCodeSmsRoute = require('./routes/sendcodesms');
const sendManagerSmsRoute = require('./routes/sendmanagersms');

const app = express();
app.use(express.json());

app.use('/nodeapi/sendsms', sendSmsRoute);
app.use('/nodeapi/sendcodesms', sendCodeSmsRoute);
app.use('/nodeapi/sendmanagersms', sendManagerSmsRoute);

app.listen(PORT, () => {
    console.log(`Node API a correr em http://localhost:${PORT}`);
});
