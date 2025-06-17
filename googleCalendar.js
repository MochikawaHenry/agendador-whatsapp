// googleCalendar.js - VERSÃO FINAL CORRIGIDA
const fs = require('fs').promises;
const path = require('path');
const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');
const TOKEN_PATH = path.join(process.cwd(), 'token.json');

/**
 * Carrega as credenciais do cliente, depois carrega o token salvo (se existir)
 * e retorna um cliente OAuth2 autorizado.
 */
async function authorize() {
  const credentialsContent = await fs.readFile(CREDENTIALS_PATH);
  const credentials = JSON.parse(credentialsContent);
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  // Checa se já temos um token salvo.
  try {
    const tokenContent = await fs.readFile(TOKEN_PATH);
    const token = JSON.parse(tokenContent);
    oAuth2Client.setCredentials(token);
  } catch (err) {
    console.error('Erro ao carregar o token.json. Execute o script get-token.js para criar um novo.');
    throw err; // Lança o erro para parar a execução se o token não puder ser carregado.
  }
  return oAuth2Client;
}

/**
 * Cria um evento no calendário do usuário.
 * @param {google.auth.OAuth2} auth Um cliente OAuth2 autorizado.
 */
async function createCalendarEvent(auth, details) {
    const calendar = google.calendar({version: 'v3', auth});
    
    const event = {
        summary: details.title,
        description: `Reunião agendada via WhatsApp. Convidado(s): ${details.guests.join(', ')}`,
        start: {
            dateTime: `${details.date}T${details.time}:00-03:00`,
            timeZone: 'America/Sao_Paulo',
        },
        end: {
            dateTime: new Date(new Date(`${details.date}T${details.time}:00-03:00`).getTime() + 60 * 60 * 1000).toISOString(),
            timeZone: 'America/Sao_Paulo',
        },
        attendees: details.guests.map(email => ({ email })),
    };

    try {
        const res = await calendar.events.insert({
            calendarId: 'primary',
            resource: event,
        });
        console.log('Evento criado:', res.data.htmlLink);
        return `✅ Reunião "${details.title}" agendada com sucesso!`;
    } catch (err) {
        console.error('Erro ao criar o evento no Google Calendar:', err);
        return `❌ Ops! Algo deu errado ao criar o evento no Google Calendar. Detalhe: ${err.message}`;
    }
}

async function processMessage(message) {
    if (!message.toLowerCase().startsWith('/agendar')) {
        return "Comando inválido. Use: /agendar <título> <data_YYYY-MM-DD> <hora_HH:MM> <emails...>";
    }

    const parts = message.split(' ');
    if (parts.length < 5) {
        return "Faltam informações. Use: /agendar <título> <data_YYYY-MM-DD> <hora_HH:MM> <email_do_convidado1> ...";
    }

    const details = {
        title: parts[1].replace(/_/g, ' '),
        date: parts[2],
        time: parts[3],
        guests: parts.slice(4)
    };
    
    if (!/^\d{4}-\d{2}-\d{2}$/.test(details.date) || !/^\d{2}:\d{2}$/.test(details.time)) {
        return "❌ Formato de data ou hora inválido. Use AAAA-MM-DD e HH:MM.";
    }

    // A autorização agora é mais direta e robusta
    const auth = await authorize();
    return await createCalendarEvent(auth, details);
}

// Exporta apenas o que o index.js precisa
module.exports = { processMessage };