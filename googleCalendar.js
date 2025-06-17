// googleCalendar.js - VERSÃO COM GESTÃO DE DIÁLOGO E MEMÓRIA
const fs = require('fs').promises;
const path = require('path');
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- CONFIGURAÇÃO ---
const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- NOSSA "MEMÓRIA" VOLÁTIL ---
// A chave será o número do usuário (ex: 'whatsapp:+5511...'), e o valor será o rascunho do evento.
const conversationStates = {};

// --- FUNÇÕES DO GOOGLE (sem alteração) ---
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
    console.error('Erro ao carregar o token.json.');
    throw err;
  }
  return oAuth2Client;
}

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
        const res = await calendar.events.insert({ calendarId: 'primary', resource: event });
        console.log('Evento criado:', res.data.htmlLink);
        return `✅ Reunião "${details.title}" agendada com sucesso!`;
    } catch (err) {
        console.error('Erro ao criar o evento no Google Calendar:', err);
        return `❌ Ops! Algo deu errado ao criar o evento no Google Calendar. Detalhe: ${err.message}`;
    }
}

// --- CÉREBRO DO BOT (Função principal com a nova lógica) ---
async function processMessage(message, from) { // 'from' é o número do usuário
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash"});
    const contacts = { /* ... sua lista de contatos ... */ };
    const today = new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    // Verifica se já existe uma conversa em andamento com este usuário
    let existingContext = '';
    if (conversationStates[from]) {
        existingContext = `O usuário já forneceu algumas informações para um agendamento. O rascunho atual é: ${JSON.stringify(conversationStates[from])}. A nova mensagem dele é uma continuação disso. Use a nova mensagem para preencher os campos que faltam.`;
    }

    const prompt = `
        Sua tarefa é extrair dados para um agendamento. Hoje é ${today}.
        A lista de contatos é: ${JSON.stringify(contacts)}. Se um nome for mencionado, use o email da lista.
        ${existingContext}
        Analise a mensagem do usuário e extraia: title, date (AAAA-MM-DD), time (HH:MM), duration (padrão 60 min), e guests (array de emails).
        Responda APENAS com um objeto JSON. Não inclua a chave "error".

        Mensagem do usuário: "${message}"

        JSON de resposta:
    `;

    try {
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        const jsonString = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        let details = JSON.parse(jsonString);

        // Se tínhamos um rascunho, une com as novas informações
        if (conversationStates[from]) {
            details = { ...conversationStates[from], ...details };
        }

        // Verifica se todas as informações necessárias estão presentes
        const missingFields = [];
        if (!details.title) missingFields.push('título');
        if (!details.date) missingFields.push('data');
        if (!details.time) missingFields.push('hora');
        if (!details.guests || details.guests.length === 0) missingFields.push('convidados');

        if (missingFields.length > 0) {
            // Se falta informação, salva o rascunho na memória e faz a pergunta
            conversationStates[from] = details;
            return `Entendido! Para continuar, preciso que me informe: ${missingFields.join(', ')}.`;
        } else {
            // Se temos tudo, agenda a reunião e limpa a memória
            delete conversationStates[from];
            const auth = await authorize();
            return await createCalendarEvent(auth, details);
        }

    } catch (e) {
        console.error("Erro no processamento da IA:", e);
        return "Tive um problema para processar seu pedido. Vamos tentar de novo. O que você gostaria de agendar?";
    }
}

// ATENÇÃO: Precisamos ajustar o module.exports.
// A função processMessage agora precisa do 'from', então o index.js também vai mudar.
module.exports = { processMessage }; // Exportamos apenas o processMessage