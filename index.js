// index.js
require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const { processMessage } = require('./googleCalendar');

const app = express();
app.use(express.urlencoded({ extended: false }));

app.post('/whatsapp', async (req, res) => {
    const incomingMsg = req.body.Body;
    const from = req.body.From;

    console.log(`Mensagem recebida de ${from}: ${incomingMsg}`);

    const replyMessage = await processMessage(incomingMsg);

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages.create({
        body: replyMessage,
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: from
    });

    res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});