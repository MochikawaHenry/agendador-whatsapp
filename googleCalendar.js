// googleCalendar.js - VERSÃO FINAL COMPLETA COM IA E RECONHECIMENTO DE INTENÇÃO
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

    const prompt = `
        Sua tarefa é atuar como um assistente de agendamento inteligente.
        Primeiro, identifique a intenção principal da mensagem do usuário. As intenções possíveis são: "agendar_reuniao", "saudacao", ou "nao_relacionado".

        Se a intenção for "agendar_reuniao", extraia os seguintes detalhes: title, date (AAAA-MM-DD), time (HH:MM), duration (em minutos, padrão 60), e guests (usando a lista de contatos para resolver nomes para emails).
        
        A data de hoje é ${today}.
        A lista de contatos é: ${JSON.stringify(contacts, null, 2)}.

        Responda APENAS com um objeto JSON válido. O JSON deve ter um campo "intent" e, se a intenção for "agendar_reuniao", deve ter também um campo "details" com as informações extraídas.

        Exemplo 1:
        Mensagem do usuário: "bom dia!"
        JSON de Resposta: {"intent": "saudacao"}

        Exemplo 2:
        Mensagem do usuário: "vamos marcar um papo com o vini amanhã às 10h30 por 15 minutos sobre o projeto"
        JSON de Resposta: {"intent": "agendar_reuniao", "details": {"title": "Papo sobre o projeto", "date": "2025-06-18", "time": "10:30", "duration": 15, "guests": ["vinicius.lucio@polijunior.com.br"]}}

        Exemplo 3:
        Mensagem do usuário: "qual a previsão do tempo?"
        JSON de Resposta: {"intent": "nao_relacionado"}

        Mensagem do usuário: "${message}"

        JSON de resposta:
    `;

    try {
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        const jsonString = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        const aiResponse = JSON.parse(jsonString);

        switch (aiResponse.intent) {
            case 'agendar_reuniao':
                const details = aiResponse.details;
                if (!details || !details.title || !details.date || !details.time || !details.guests || details.guests.length === 0) {
                    return "Entendi que você quer agendar, mas preciso de mais detalhes. Por favor, me diga o título, data, hora e os convidados.";
                }
                const auth = await authorize();
                return await createCalendarEvent(auth, details);

            case 'saudacao':
                return "Olá! Sou seu assistente de agendamento. Como posso ajudar?";

            case 'nao_relacionado':
                return "Desculpe, sou um bot focado em agendamentos. Não consigo ajudar com isso. Posso marcar uma reunião para você?";
                
            default:
                return "Não entendi muito bem o que você quis dizer. Pode tentar de novo?";
        }

    } catch (e) {
        console.error("Erro no processamento da IA:", e);
        return "Estou com um pouco de dificuldade para processar os pedidos agora. Tente novamente em um instante.";
    }
}

// Exporta as funções necessárias
module.exports = { processMessage, authorize };