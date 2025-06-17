// googleCalendar.js - VERSÃO COM GESTÃO DE DIÁLOGO, MEMÓRIA E DB INTEGRADO (incluindo salvar contato)
const fs = require('fs').promises;
const path = require('path');
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { connectAndCreateContactsTable, addContact, getEmailByName } = require('./db'); // Importa as funções do DB

// --- CONFIGURAÇÃO ---
const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- NOSSA "MEMÓRIA" VOLÁTIL (para gerenciar conversas com múltiplos passos) ---
const conversationStates = {}; // A chave será o número do usuário (ex: 'whatsapp:+5511...'), e o valor será o rascunho do evento.

// --- FUNÇÕES DO GOOGLE (sem alteração significativa na lógica principal) ---
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
        console.error('Erro ao carregar o token.json. É preciso gerar um novo token (execute o get-token.js).');
        throw err; // Lança o erro para parar a execução se o token não puder ser carregado.
    }
    return oAuth2Client;
}

async function createCalendarEvent(auth, details) {
    const calendar = google.calendar({version: 'v3', auth});
    
    // Calcula o tempo de término do evento
    const startDate = new Date(`${details.date}T${details.time}:00-03:00`); // Assumindo fuso de Brasília
    const endDate = new Date(startDate.getTime() + (details.duration || 60) * 60 * 1000); // Adiciona duração ou 60 minutos padrão

    const event = {
        summary: details.title,
        description: `Reunião agendada via WhatsApp. Convidado(s): ${(details.guests || []).join(', ')}`,
        start: {
            dateTime: startDate.toISOString(),
            timeZone: 'America/Sao_Paulo',
        },
        end: {
            dateTime: endDate.toISOString(),
            timeZone: 'America/Sao_Paulo',
        },
        attendees: (details.guests || []).map(email => ({ email })),
        reminders: { 'useDefault': false, 'overrides': [{ 'method': 'popup', 'minutes': 30 }] }, // Lembretes
    };

    try {
        const res = await calendar.events.insert({
            calendarId: 'primary',
            resource: event,
        });
        console.log('Evento criado:', res.data.htmlLink);
        return `✅ Reunião "${details.title}" agendada com sucesso! Link: ${res.data.htmlLink}`;
    } catch (err) {
        console.error('Erro ao criar o evento no Google Calendar:', err);
        return `❌ Ops! Algo deu errado ao criar o evento no Google Calendar. Detalhe: ${err.message}`;
    }
}

// --- CÉREBRO DO BOT (Função principal com a nova lógica de PLN e DB) ---
async function processMessage(message, from) { // 'from' é o número do usuário, ESSENCIAL para a memória
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash"});
    
    const today = new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    // Pega o estado da conversa existente para este usuário
    let existingContext = '';
    if (conversationStates[from]) {
        existingContext = `O usuário já forneceu algumas informações para um agendamento. O rascunho atual é: ${JSON.stringify(conversationStates[from])}. A nova mensagem dele é uma continuação ou correção disso. Use a nova mensagem para preencher os campos que faltam ou substituir informações.`;
    }

    // O PROMPT para o Gemini - INSTRUÇÕES CLARAS PARA EXTRAÇÃO E INTENÇÃO
    const prompt = `
        Você é um assistente de agendamento e gerenciamento de contatos. Sua tarefa é extrair os detalhes da mensagem do usuário.
        A data de hoje é ${today}.

        Responda APENAS com um objeto JSON válido.
        O JSON deve ter um campo "intent" e, se aplicável, um campo "details" com as informações extraídas.

        As intenções possíveis são:
        - "agendar_reuniao": Para criar eventos no calendário.
        - "salvar_contato": Para adicionar ou atualizar um nome e email na lista de contatos.
        - "saudacao": Para cumprimentos simples.
        - "nao_relacionado": Para qualquer outra mensagem que não se encaixe nas categorias acima.

        Para a intenção "agendar_reuniao", extraia os seguintes detalhes no campo "details":
        - "title": Título da reunião (ex: "Reunião de Projeto"). Se não especificado, use "Reunião".
        - "date": Data no formato AAAA-MM-DD (ex: "2025-06-18"). Se o usuário disser "amanhã", calcule a data. Se disser "hoje", use a data de hoje.
        - "time": Hora no formato HH:MM (ex: "14:30"). Se não especificado, sugira perguntar.
        - "duration": Duração em minutos (número inteiro, padrão 60 se não especificado).
        - "guests": Array de nomes ou emails dos convidados (ex: ["João", "maria@email.com"]). Mantenha o que o usuário disser.

        Para a intenção "salvar_contato", extraia os seguintes detalhes no campo "details":
        - "name": Nome do contato (ex: "Vini").
        - "email": Email do contato (ex: "vinicius.lucio@polijunior.com.br").

        ${existingContext}

        --- Exemplos ---

        Exemplo de saudação:
        Mensagem do usuário: "Olá!"
        JSON de Resposta: {"intent": "saudacao"}

        Exemplo de agendamento:
        Mensagem do usuário: "agende um café com o allan amanhã às 10h"
        JSON de Resposta: {"intent": "agendar_reuniao", "details": {"title": "Café", "date": "2025-06-18", "time": "10:00", "duration": 60, "guests": ["allan"]}}

        Exemplo de agendamento com email:
        Mensagem do usuário: "reunião com carlos@empresa.com hoje as 14h"
        JSON de Resposta: {"intent": "agendar_reuniao", "details": {"title": "Reunião", "date": "2025-06-17", "time": "14:00", "duration": 60, "guests": ["carlos@empresa.com"]}}
        
        Exemplo de agendamento parcial e continuação:
        Usuário 1: "Agendar reunião de vendas"
        Bot: "Entendido! Para agendar, preciso que me informe a data, hora e convidados."
        Usuário 1: "será dia 20 de junho as 15h com o pino e o digão"
        JSON de Resposta (considerando o contexto anterior): {"intent": "agendar_reuniao", "details": {"title": "Reunião de vendas", "date": "2025-06-20", "time": "15:00", "duration": 60, "guests": ["pino", "digão"]}}

        Exemplo de salvar contato:
        Mensagem do usuário: "salvar o contato do Vini como vinicius.lucio@polijunior.com.br"
        JSON de Resposta: {"intent": "salvar_contato", "details": {"name": "Vini", "email": "vinicius.lucio@polijunior.com.br"}}

        Exemplo de não relacionado:
        Mensagem do usuário: "qual a temperatura em São Paulo?"
        JSON de Resposta: {"intent": "nao_relacionado"}

        Mensagem do usuário: "${message}"

        JSON de resposta:
    `;

    try {
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        console.log('Resposta bruta do Gemini:', responseText); // Log para depuração
        
        // Remove blocos de código e espaços em branco
        const jsonString = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        let aiResponse;
        try {
            aiResponse = JSON.parse(jsonString);
        } catch (parseError) {
            console.error('Erro ao fazer parse do JSON do Gemini:', parseError);
            console.error('JSON string que falhou:', jsonString);
            return "❌ Ops, tive um problema interno ao entender sua solicitação (formato JSON inválido). Por favor, tente novamente.";
        }

        // --- Lógica de Gestão de Diálogo e Resolução de Convidados/Contatos ---
        switch (aiResponse.intent) {
            case 'agendar_reuniao':
                let currentDetails = conversationStates[from] || {};
                currentDetails = { ...currentDetails, ...aiResponse.details }; // Mescla com o rascunho existente

                // Validação e Resolução dos convidados (nomes para emails do DB)
                const resolvedGuests = [];
                if (currentDetails.guests && currentDetails.guests.length > 0) {
                    for (const guest of currentDetails.guests) {
                        let email = null;
                        if (guest.includes('@')) { // Se já é um email, usa diretamente
                            email = guest;
                        } else { // Tenta buscar pelo nome no banco de dados
                            const dbEmail = await getEmailByName(guest);
                            if (dbEmail) {
                                email = dbEmail;
                            }
                        }
                        if (email) {
                            resolvedGuests.push(email);
                        } else {
                            console.warn(`Convidado '${guest}' não resolvido para um email válido e será ignorado.`);
                            // Você pode adicionar uma lógica para perguntar o email ou sugerir salvar o contato
                        }
                    }
                }
                currentDetails.guests = resolvedGuests; // Atualiza com os emails resolvidos

                // Verifica se todas as informações necessárias estão presentes
                const missingFields = [];
                if (!currentDetails.title) missingFields.push('título');
                if (!currentDetails.date) missingFields.push('data');
                if (!currentDetails.time) missingFields.push('hora');
                if (!currentDetails.guests || currentDetails.guests.length === 0) {
                     missingFields.push('convidados');
                }

                if (missingFields.length > 0) {
                    conversationStates[from] = currentDetails; // Salva o rascunho na memória
                    return `Entendido! Para agendar, preciso que me informe o(s) seguinte(s) dado(s): ${missingFields.join(', ')}.`;
                } else {
                    // Se temos tudo, agenda a reunião e limpa a memória
                    delete conversationStates[from];
                    const auth = await authorize();
                    return await createCalendarEvent(auth, currentDetails);
                }
            
            case 'salvar_contato': // NOVO CASE AQUI!
                const contactDetails = aiResponse.details;
                if (contactDetails && contactDetails.name && contactDetails.email) {
                    try {
                        await addContact(contactDetails.name, contactDetails.email); // Chama a função do seu db.js
                        delete conversationStates[from]; // Limpa o estado da conversa após salvar
                        return `✅ Contato "${contactDetails.name}" (${contactDetails.email}) salvo com sucesso!`;
                    } catch (dbError) {
                        console.error("Erro ao salvar contato no DB:", dbError);
                        // Verifica se é erro de duplicidade e dá uma mensagem mais amigável
                        if (dbError.message && dbError.message.includes('duplicate key value violates unique constraint')) {
                            return `❗ O nome ou email "${contactDetails.name}" já existe. Contato atualizado com o novo email.`;
                        }
                        return `❌ Ops! Não consegui salvar o contato. Detalhe: ${dbError.message}`;
                    }
                } else {
                    return "Entendi que você quer salvar um contato, mas preciso do nome e do email. Por favor, me diga em um formato claro, como 'salvar contato [Nome] como [email@dominio.com]'.";
                }
            
            case 'saudacao':
                delete conversationStates[from]; 
                return "Olá! Sou seu assistente de agendamento e contatos. Como posso ajudar?";

            case 'nao_relacionado':
                delete conversationStates[from]; 
                return "Desculpe, sou um bot focado em agendamentos e contatos. Não consigo ajudar com isso. Posso marcar uma reunião ou salvar um contato para você?";
                
            default:
                return "Não entendi muito bem o que você quis dizer ou não consegui extrair informações válidas. Por favor, tente reformular sua solicitação.";
        }

    } catch (e) {
        console.error("Erro no processamento principal da IA ou do fluxo:", e);
        // Verificar se o erro foi por falta da GEMINI_API_KEY
        if (e.message && e.message.includes('API key not found')) {
            return "❌ Ops! Minha inteligência artificial não está funcionando. Por favor, verifique se a GEMINI_API_KEY está configurada corretamente.";
        }
        return "Estou com um pouco de dificuldade para processar os pedidos agora. Tente novamente em um instante.";
    }
}

// --- EXPORTAÇÕES E CONEXÃO INICIAL DO BANCO DE DADOS ---
module.exports = { processMessage, authorize };

// Conecta ao banco de dados quando este módulo é carregado (ao iniciar o index.js)
// IMPORTANTE: Isso cria a tabela 'contacts' se ela não existir.
connectAndCreateContactsTable().catch(err => {
    console.error("❌ ERRO CRÍTICO: Falha fatal ao conectar ou criar tabela do banco de dados na inicialização:", err);
    process.exit(1); // Encerra a aplicação se não conseguir conectar ao DB, pois ela não funcionará sem ele.
});