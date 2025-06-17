// googleCalendar.js - VERSÃO FINAL COMPLETA COM IA E CONTEXTO
const fs = require('fs').promises;
const path = require('path');
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');
const TOKEN_PATH = path.join(process.cwd(), 'token.json');

// Inicializa o cliente do Gemini com sua API Key (ele vai ler do .env)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Carrega as credenciais do cliente, depois carrega o token salvo
 * e retorna um cliente OAuth2 autorizado.
 */
async function authorize() {
  const credentialsContent = await fs.readFile(CREDENTIALS_PATH);
  const credentials = JSON.parse(credentialsContent);
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  try {
    const tokenContent = await fs.readFile(TOKEN_PATH);
    const token = JSON.parse(tokenContent);
    oAuth2Client.setCredentials(token);
  } catch (err) {
    console.error('Erro ao carregar o token.json. É preciso gerar um novo token.');
    throw err;
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
        description: `Reunião agendada via WhatsApp. Convidado(s): ${(details.guests || []).join(', ')}`,
        start: {
            dateTime: `${details.date}T${details.time}:00-03:00`,
            timeZone: 'America/Sao_Paulo',
        },
        end: {
            dateTime: new Date(new Date(`${details.date}T${details.time}:00-03:00`).getTime() + (details.duration || 60) * 60 * 1000).toISOString(),
            timeZone: 'America/Sao_Paulo',
        },
        attendees: (details.guests || []).map(email => ({ email })),
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

/**
 * Processa a mensagem do usuário usando IA para extrair detalhes do evento.
 */
async function processMessage(message) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash"});
    
    // "Memória" - Definimos la lista de contatos do seu núcleo
    const contacts = {
        "lucas": "lucas.siomi@polijunior.com.br",
        "allan": "allan.doval@polijunior.com.br",
        "gonça": "eduardo.goncalves@polijunior.com.br",
        "gonca": "eduardo.goncalves@polijunior.com.br",
        "enrico": "enrico.soares@polijunior.com.br",
        "kelly": "kelly.flores@polijunior.com.br",
        "lh": "luis.machado@polijunior.com.br",
        "becker": "matheus.becker@polijunior.com.br",
        "vini": "vinicius.lucio@polijunior.com.br",
        "jaques": "carlos.jaques@polijunior.com.br",
        "carol": "carolina.blazek@polijunior.com.br",
        "pino": "joaogabriel.costa@polijunior.com.br",
        "mineiro": "pedro.ferraz@polijunior.com.br",
        "digão": "rodrigo.chojniak@polijunior.com.br"
    };

    const today = new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    // Melhorar o Prompt com a lista de contatos
    const prompt = `
        Sua tarefa é extrair dados de agendamento de uma mensagem. A data de hoje é ${today}.

        Você tem acesso à seguinte lista de contatos (nome/apelido: email):
        ${JSON.stringify(contacts, null, 2)}

        Se a mensagem do usuário mencionar um nome ou apelido da lista (ex: 'vini', 'gonça'), use o email correspondente da lista para o campo "guests". Se um email completo já for fornecido, use o email diretamente.

        Analise a mensagem do usuário e extraia: um título (title), a data no formato AAAA-MM-DD (date), a hora no formato HH:MM (time), uma duração em minutos (duration), e uma lista de e-mails de convidados (guests).
        A duração padrão, se não mencionada, é 60 minutos.
        Responda APENAS com um objeto JSON válido. Se informações essenciais não forem encontradas, retorne um JSON com um campo "error".

        Mensagem do usuário: "${message}"

        JSON de resposta:
    `;

    try {
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        const jsonString = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        const details = JSON.parse(jsonString);

        if (details.error) {
            return details.error;
        }

        if (!details.title || !details.date || !details.time || !details.guests || details.guests.length === 0) {
            return "Não consegui entender todos os detalhes. Preciso de um título, data, hora e pelo menos um convidado (seja o nome ou o email).";
        }
        
        const auth = await authorize();
        return await createCalendarEvent(auth, details);

    } catch (e) {
        console.error("Erro ao processar resposta da IA ou agendar:", e);
        return "Tive um problema para entender seu pedido. Pode reformular, por favor?";
    }
}


// Exporta as funções necessárias para outros arquivos
module.exports = { processMessage, authorize };