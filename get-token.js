// get-token.js
const fs = require('fs').promises;
const path = require('path');
const {google} = require('googleapis');
const readline = require('readline');

const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

async function run() {
    const credentials = JSON.parse(await fs.readFile(CREDENTIALS_PATH));
    const {client_secret, client_id, redirect_uris} = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    console.log('--- ETAPA 1: GERAR URL DE AUTORIZAÇÃO ---');
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    console.log('Copie a URL abaixo e cole no seu navegador:');
    console.log(authUrl);

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    rl.question('\n--- ETAPA 2: Após autorizar, cole o CÓDIGO da URL de redirecionamento aqui e pressione Enter: ', async (code) => {
        rl.close();
        try {
            const {tokens} = await oAuth2Client.getToken(code);
            await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
            console.log('\n-------------------------------------------------------------------');
            console.log('✅ SUCESSO! O arquivo token.json foi criado.');
            console.log('-------------------------------------------------------------------');
        } catch (e) {
            console.error('Erro ao tentar obter o token:', e.message);
        }
    });
}

run().catch(console.error);